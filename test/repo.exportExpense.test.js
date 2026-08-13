import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense, listExpensesOfTrip } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { exportExpense, importData } from '../src/repo/exportImport.js';
import { validateShare, previewShare } from '../src/repo/incomingShare.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { db } from '../src/db.js';

beforeEach(resetDb);

/**
 * One trip, two expenses, three members -- cleo is a bystander on the shared
 * expense, and there's a trip-scoped payment. All three are leaks if the
 * single-expense scoping is wrong.
 */
async function tripWithTwoExpenses() {
  const crew = await createGroup('Crew');
  const boise = await createTrip({ groupId: crew.id, name: 'boise' });

  const ana = await createPerson({ name: 'ana' });
  const ben = await createPerson({ name: 'ben' });
  const cleo = await createPerson({ name: 'cleo' }); // not on the dinner
  await addMember(crew.id, ana.id);
  await addMember(crew.id, ben.id);
  await addMember(crew.id, cleo.id);

  const dinner = await createExpense({
    tripId: boise.id, payerId: ana.id, amountCents: 5000,
    description: 'Dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [ana.id, ben.id])
  });
  await createExpense({
    tripId: boise.id, payerId: cleo.id, amountCents: 3000,
    description: 'Museum', spentAt: Date.now(),
    splits: computeEvenSplit(3000, [ana.id, cleo.id])
  });
  await createSettlement({
    groupId: crew.id, tripId: boise.id,
    fromPerson: ben.id, toPerson: ana.id, amountCents: 1000
  });

  return { crew, boise, ana, ben, cleo, dinner };
}

describe('exportExpense', () => {
  it('contains only that expense -- the sibling expense and all payments stay home', async () => {
    const { crew, boise, dinner } = await tripWithTwoExpenses();
    const dump = await exportExpense(dinner.id);

    expect(dump.groups.map((g) => g.id)).toEqual([crew.id]);
    expect(dump.trips.map((t) => t.id)).toEqual([boise.id]);
    expect(dump.expenses.map((e) => e.description)).toEqual(['Dinner']);
    expect(dump.splits).toHaveLength(2);
    expect(dump.splits.every((s) => s.expense_id === dinner.id)).toBe(true);
    expect(dump.settlements).toEqual([]);
  });

  it('brings only the people the expense mentions, with their memberships', async () => {
    const { ana, ben, cleo, dinner } = await tripWithTwoExpenses();
    const dump = await exportExpense(dinner.id);

    expect(new Set(dump.people.map((p) => p.name))).toEqual(new Set(['ana', 'ben']));
    expect(new Set(dump.memberships.map((m) => m.person_id))).toEqual(new Set([ana.id, ben.id]));
    expect(dump.people.map((p) => p.id)).not.toContain(cleo.id);
  });

  it('strips is_me, and refuses an unknown expense', async () => {
    const { ana, dinner } = await tripWithTwoExpenses();
    await setIsMe(ana.id);
    const dump = await exportExpense(dinner.id);
    expect(dump.people.every((p) => p.is_me === false)).toBe(true);

    await expect(exportExpense('nope')).rejects.toThrow(/not found/i);
  });

  it('passes validation on a fresh device and lands as a one-expense trip', async () => {
    const { dinner } = await tripWithTwoExpenses();
    const dump = await exportExpense(dinner.id);

    await resetDb();
    const validated = await validateShare(dump);
    await importData(validated, { mode: 'merge' });

    expect(await db.trips.count()).toBe(1);
    expect((await db.expenses.toArray()).map((e) => e.description)).toEqual(['Dinner']);
    expect(await db.people.count()).toBe(2);
  });

  it('on a device that already has the trip, previews as an existing-trip addition and merges only the expense', async () => {
    const { boise, ana, ben, dinner } = await tripWithTwoExpenses();
    const dump = await exportExpense(dinner.id);

    // The receiving phone: same group/trip/people, but not the dinner.
    await db.expenses.delete(dinner.id);
    await db.splits.where('expense_id').equals(dinner.id).delete();

    const validated = await validateShare(dump);
    expect(await previewShare(validated)).toMatchObject({
      newGroups: [],
      newTrips: [],
      existingTripAdditions: [{ name: 'boise', expenses: 1, settlements: 0 }]
    });

    const summary = await importData(validated, { mode: 'merge' });
    expect(summary.expenses).toEqual({ imported: 1, skipped: 0 });
    expect(summary.groups.imported).toBe(0);
    expect(summary.people.imported).toBe(0);
    expect((await listExpensesOfTrip(boise.id)).map((e) => e.description).sort())
      .toEqual(['Dinner', 'Museum']);
    expect(ana.id && ben.id).toBeTruthy();
  });
});
