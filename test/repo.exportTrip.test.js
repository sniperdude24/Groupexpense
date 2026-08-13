import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { exportTrip, importData } from '../src/repo/exportImport.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { computeTripBalance } from '../src/repo/queries.js';
import { encodeTransfer, FrameCollector } from '../src/lib/qrtransfer.js';

beforeEach(resetDb);

/**
 * One group, two trips, plus a group-level settlement -- so a trip share has
 * both a sibling trip and an out-of-scope payment to leak if the scoping is
 * wrong.
 */
async function groupWithTwoTrips() {
  const crew = await createGroup('Crew');
  const boise = await createTrip({ groupId: crew.id, name: 'boise' });
  const vegas = await createTrip({ groupId: crew.id, name: 'vegas' });

  const ana = await createPerson({ name: 'ana' });
  const ben = await createPerson({ name: 'ben' });
  const cleo = await createPerson({ name: 'cleo' }); // only on vegas
  await addMember(crew.id, ana.id);
  await addMember(crew.id, ben.id);
  await addMember(crew.id, cleo.id);

  await createExpense({
    tripId: boise.id, payerId: ana.id, amountCents: 5000,
    description: 'Boise dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [ana.id, ben.id])
  });
  await createExpense({
    tripId: vegas.id, payerId: cleo.id, amountCents: 3000,
    description: 'Vegas tickets', spentAt: Date.now(),
    splits: computeEvenSplit(3000, [ana.id, cleo.id])
  });
  // One payment inside boise, one at group level.
  await createSettlement({
    groupId: crew.id, tripId: boise.id,
    fromPerson: ben.id, toPerson: ana.id, amountCents: 1000
  });
  await createSettlement({
    groupId: crew.id, tripId: null,
    fromPerson: ana.id, toPerson: cleo.id, amountCents: 500
  });

  return { crew, boise, vegas, ana, ben, cleo };
}

describe('exportTrip', () => {
  it("contains only that trip's graph -- the sibling trip stays home", async () => {
    const { crew, boise } = await groupWithTwoTrips();
    const dump = await exportTrip(boise.id);

    expect(dump.groups.map((g) => g.id)).toEqual([crew.id]);
    expect(dump.trips.map((t) => t.name)).toEqual(['boise']);
    expect(dump.expenses.map((e) => e.description)).toEqual(['Boise dinner']);
    expect(dump.splits).toHaveLength(2);
    expect(new Set(dump.people.map((p) => p.name))).toEqual(new Set(['ana', 'ben']));
  });

  it('includes trip-scoped payments but not group-level ones', async () => {
    const { boise } = await groupWithTwoTrips();
    const dump = await exportTrip(boise.id);

    expect(dump.settlements).toHaveLength(1);
    expect(dump.settlements[0].trip_id).toBe(boise.id);
    expect(dump.settlements[0].amount_cents).toBe(1000);
  });

  it('memberships come along only for the people included', async () => {
    const { crew, boise, cleo } = await groupWithTwoTrips();
    const dump = await exportTrip(boise.id);

    expect(dump.memberships.every((m) => m.group_id === crew.id)).toBe(true);
    expect(dump.memberships.map((m) => m.person_id)).not.toContain(cleo.id);
    expect(dump.memberships).toHaveLength(2);
  });

  it('strips is_me, and refuses an unknown trip', async () => {
    const { boise, ana } = await groupWithTwoTrips();
    await setIsMe(ana.id);
    const dump = await exportTrip(boise.id);
    expect(dump.people.every((p) => p.is_me === false)).toBe(true);

    await expect(exportTrip('nope')).rejects.toThrow(/not found/i);
  });

  it('QR frames -> import reproduces the trip balances exactly on a fresh device', async () => {
    const { boise } = await groupWithTwoTrips();
    const before = await computeTripBalance(boise.id);
    const frames = await encodeTransfer(await exportTrip(boise.id));

    await resetDb();
    const collector = new FrameCollector();
    for (const frame of [...frames].reverse()) collector.add(frame);
    const summary = await importData(await collector.assemble(), { mode: 'merge' });

    expect(summary.trips.imported).toBe(1);
    expect(summary.settlements.imported).toBe(1);
    const after = await computeTripBalance(boise.id);
    expect([...after.net.entries()].sort()).toEqual([...before.net.entries()].sort());
  });
});
