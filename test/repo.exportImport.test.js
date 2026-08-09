import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { computeGroupBalance } from '../src/repo/queries.js';
import { exportData, importData } from '../src/repo/exportImport.js';

beforeEach(resetDb);

async function buildScenario() {
  const group = await createGroup('Cabin weekend');
  const trip = await createTrip({ groupId: group.id, name: 'Cabin weekend' });
  const a = await createPerson({ name: 'Alice' });
  const b = await createPerson({ name: 'Bob' });
  const c = await createPerson({ name: 'Carl' });
  await createExpense({
    tripId: trip.id,
    payerId: a.id,
    amountCents: 1000,
    description: 'Firewood',
    spentAt: Date.now(),
    splits: [
      { person_id: a.id, share_cents: 334 },
      { person_id: b.id, share_cents: 333 },
      { person_id: c.id, share_cents: 333 }
    ]
  });
  await createSettlement({ groupId: group.id, tripId: trip.id, fromPerson: c.id, toPerson: a.id, amountCents: 333 });
  return { group, a, b, c };
}

describe('export / import', () => {
  it('acceptance: importing an export into a fresh install reproduces every balance identically', async () => {
    const { group, a, b, c } = await buildScenario();
    const before = await computeGroupBalance(group.id);

    const exported = await exportData();
    expect(exported.schema_version).toBe(1);
    expect(exported.groups).toHaveLength(1);

    await resetDb();
    const summary = await importData(exported, { mode: 'replace' });
    expect(summary.groups.imported).toBe(1);

    const after = await computeGroupBalance(group.id);
    expect(after.net.get(a.id)).toBe(before.net.get(a.id));
    expect(after.net.get(b.id)).toBe(before.net.get(b.id));
    expect(after.net.get(c.id)).toBe(before.net.get(c.id));
    expect(after.pairwise).toEqual(before.pairwise);
  });

  it('merge mode skips records whose ids already exist', async () => {
    const { group } = await buildScenario();
    const exported = await exportData();

    const extraPerson = await createPerson({ name: 'Dana' });
    exported.people.push(extraPerson);

    const summary = await importData(exported, { mode: 'merge' });
    expect(summary.people.skipped).toBeGreaterThan(0);
    expect(summary.people.imported).toBe(0); // Dana already exists locally too

    const after = await computeGroupBalance(group.id);
    expect(after.net.size).toBeGreaterThan(0);
  });

  it('rejects a file with a mismatched schema version', async () => {
    await expect(importData({ schema_version: 999 }, { mode: 'merge' })).rejects.toThrow();
  });
});
