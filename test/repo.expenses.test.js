import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip, settleTrip, reopenTrip } from '../src/repo/trips.js';
import {
  createExpense,
  updateExpense,
  deleteExpense,
  listExpensesOfTrip,
  getExpenseWithSplits,
  SettledTripError,
  SplitMismatchError
} from '../src/repo/expenses.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { computeTripBalance } from '../src/repo/queries.js';

beforeEach(resetDb);

async function makeTripWithThreePeople() {
  const group = await createGroup('Fishing crew');
  const trip = await createTrip({ groupId: group.id, name: 'Lake trip' });
  const a = await createPerson({ name: 'Alice' });
  const b = await createPerson({ name: 'Bob' });
  const c = await createPerson({ name: 'Carl' });
  return { group, trip, a, b, c };
}

describe('createExpense', () => {
  it('acceptance: $10.00 split 3 ways produces splits summing to exactly 1000', async () => {
    const { trip, a, b, c } = await makeTripWithThreePeople();
    const splits = computeEvenSplit(1000, [a.id, b.id, c.id]);
    const expense = await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Dinner',
      spentAt: Date.now(),
      splits
    });
    const { splits: saved } = await getExpenseWithSplits(expense.id);
    const total = saved.reduce((s, x) => s + x.share_cents, 0);
    expect(total).toBe(1000);
    const sorted = [...saved].sort((x, y) => (x.person_id < y.person_id ? -1 : 1));
    expect(sorted.map((s) => s.share_cents).sort((x, y) => y - x)).toEqual([334, 333, 333]);
  });

  it('rejects an expense whose splits do not sum to the total', async () => {
    const { trip, a, b } = await makeTripWithThreePeople();
    await expect(
      createExpense({
        tripId: trip.id,
        payerId: a.id,
        amountCents: 1000,
        description: 'Bad split',
        spentAt: Date.now(),
        splits: [
          { person_id: a.id, share_cents: 400 },
          { person_id: b.id, share_cents: 400 }
        ]
      })
    ).rejects.toThrow(SplitMismatchError);
  });

  it('blocks creating an expense in a settled trip', async () => {
    const { trip, a, b } = await makeTripWithThreePeople();
    await settleTrip(trip.id);
    await expect(
      createExpense({
        tripId: trip.id,
        payerId: a.id,
        amountCents: 500,
        description: 'Too late',
        spentAt: Date.now(),
        splits: [{ person_id: b.id, share_cents: 500 }]
      })
    ).rejects.toThrow(SettledTripError);
  });
});

describe('editing and deleting', () => {
  it('blocks editing an expense in a settled trip until reopened', async () => {
    const { trip, a, b } = await makeTripWithThreePeople();
    const expense = await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Dinner',
      spentAt: Date.now(),
      splits: [{ person_id: b.id, share_cents: 1000 }]
    });
    await settleTrip(trip.id);

    await expect(
      updateExpense(expense.id, {
        payerId: a.id,
        amountCents: 2000,
        description: 'Dinner',
        spentAt: Date.now(),
        splits: [{ person_id: b.id, share_cents: 2000 }]
      })
    ).rejects.toThrow(SettledTripError);
    await expect(deleteExpense(expense.id)).rejects.toThrow(SettledTripError);

    await reopenTrip(trip.id);
    await updateExpense(expense.id, {
      payerId: a.id,
      amountCents: 2000,
      description: 'Dinner',
      spentAt: Date.now(),
      splits: [{ person_id: b.id, share_cents: 2000 }]
    });
    const { expense: updated } = await getExpenseWithSplits(expense.id);
    expect(updated.amount_cents).toBe(2000);
  });

  it('acceptance: deleting an expense updates balances immediately with no stale totals', async () => {
    const { trip, a, b } = await makeTripWithThreePeople();
    const expense = await createExpense({
      tripId: trip.id,
      payerId: a.id,
      amountCents: 1000,
      description: 'Dinner',
      spentAt: Date.now(),
      splits: [{ person_id: b.id, share_cents: 1000 }]
    });
    let { net } = await computeTripBalance(trip.id);
    expect(net.get(a.id)).toBe(1000);
    expect(net.get(b.id)).toBe(-1000);

    await deleteExpense(expense.id);
    ({ net } = await computeTripBalance(trip.id));
    expect(net.get(a.id) || 0).toBe(0);
    expect(net.get(b.id) || 0).toBe(0);

    const remaining = await listExpensesOfTrip(trip.id);
    expect(remaining).toEqual([]);
  });
});
