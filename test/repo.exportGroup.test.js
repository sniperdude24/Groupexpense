import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { db } from '../src/db.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember, removeMember, listMembersOfGroup } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { exportGroup, importData } from '../src/repo/exportImport.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { computeGroupBalance } from '../src/repo/queries.js';
import { encodeTransfer, FrameCollector } from '../src/lib/qrtransfer.js';

beforeEach(resetDb);

/** Two groups side by side, so scoping failures have something to leak. */
async function twoGroups() {
  const crew = await createGroup('Crew');
  const other = await createGroup('Other');
  const crewTrip = await createTrip({ groupId: crew.id, name: 'Cabin' });
  const otherTrip = await createTrip({ groupId: other.id, name: 'Elsewhere' });

  const ana = await createPerson({ name: 'ana' });
  const ben = await createPerson({ name: 'ben' });
  const zoe = await createPerson({ name: 'zoe' }); // only in Other
  await addMember(crew.id, ana.id);
  await addMember(crew.id, ben.id);
  await addMember(other.id, zoe.id);

  await createExpense({
    tripId: crewTrip.id, payerId: ana.id, amountCents: 5000,
    description: 'Crew dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [ana.id, ben.id])
  });
  await createExpense({
    tripId: otherTrip.id, payerId: zoe.id, amountCents: 999,
    description: 'Other snack', spentAt: Date.now(),
    splits: computeEvenSplit(999, [zoe.id])
  });
  await createSettlement({
    groupId: crew.id, tripId: crewTrip.id,
    fromPerson: ben.id, toPerson: ana.id, amountCents: 1000
  });

  return { crew, other, crewTrip, ana, ben, zoe };
}

describe('exportGroup', () => {
  it("contains the group's whole graph and nothing from other groups", async () => {
    const { crew, ana, ben } = await twoGroups();
    const dump = await exportGroup(crew.id);

    expect(dump.groups.map((g) => g.name)).toEqual(['Crew']);
    expect(dump.trips.map((t) => t.name)).toEqual(['Cabin']);
    expect(dump.expenses.map((e) => e.description)).toEqual(['Crew dinner']);
    expect(dump.splits).toHaveLength(2);
    expect(dump.settlements).toHaveLength(1);
    expect(new Set(dump.people.map((p) => p.name))).toEqual(new Set(['ana', 'ben']));
    expect(dump.memberships.every((m) => m.group_id === crew.id)).toBe(true);
    expect([ana.id, ben.id]).toContain(dump.expenses[0].payer_id);
  });

  it('strips is_me so the sender does not hijack the receiving phone', async () => {
    const { crew, ana } = await twoGroups();
    await setIsMe(ana.id);
    const dump = await exportGroup(crew.id);
    expect(dump.people.every((p) => p.is_me === false)).toBe(true);
  });

  it('still includes a person who left the group but is on an old expense', async () => {
    const { crew, ben } = await twoGroups();
    const memberships = await listMembersOfGroup(crew.id);
    const bensMembership = memberships.find((m) => m.person.id === ben.id);
    await removeMember(bensMembership.membership.id);

    const dump = await exportGroup(crew.id);
    expect(dump.people.map((p) => p.name)).toContain('ben');
    expect(dump.memberships.map((m) => m.person_id)).not.toContain(ben.id);
  });

  it('refuses an unknown group', async () => {
    await expect(exportGroup('nope')).rejects.toThrow(/not found/i);
  });
});

describe('receiving a shared group', () => {
  it('QR frames -> import reproduces the group balances exactly on a fresh device', async () => {
    const { crew } = await twoGroups();
    const before = await computeGroupBalance(crew.id);
    const frames = await encodeTransfer(await exportGroup(crew.id));

    // "Fresh device": wipe this database and replay the frames into it.
    await resetDb();
    const collector = new FrameCollector();
    for (const frame of [...frames].reverse()) collector.add(frame);
    const summary = await importData(await collector.assemble(), { mode: 'merge' });

    expect(summary.groups.imported).toBe(1);
    const after = await computeGroupBalance(crew.id);
    expect([...after.net.entries()].sort()).toEqual([...before.net.entries()].sort());
    expect((await db.groups.toArray()).map((g) => g.name)).toEqual(['Crew']);
  });

  it('re-receiving the same share is a no-op, and only fills gaps', async () => {
    const { crew } = await twoGroups();
    const dump = await exportGroup(crew.id);

    const first = await importData(dump, { mode: 'merge' });
    expect(Object.values(first).every((t) => t.imported === 0)).toBe(true);

    // Simulate the sender having one expense the receiver lost.
    const lost = (await db.expenses.toArray()).find((e) => e.description === 'Crew dinner');
    await db.splits.where('expense_id').equals(lost.id).delete();
    await db.expenses.delete(lost.id);

    const second = await importData(dump, { mode: 'merge' });
    expect(second.expenses.imported).toBe(1);
    expect(second.splits.imported).toBe(2);
    expect(second.groups.imported).toBe(0);
    expect(second.people.imported).toBe(0);
  });
});
