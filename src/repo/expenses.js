import Dexie from 'dexie';
import { db } from '../db.js';
import { newId, now } from '../lib/util.js';
import { splitsSumToAmount } from '../lib/splits.js';
import { assertAmountWithinLimit, AmountTooLargeError } from '../lib/limits.js';
import { SettledTripError, assertTripOpen } from './tripLock.js';

class SplitMismatchError extends Error {
  constructor(amountCents, sum) {
    super(`Splits sum to ${sum} cents, but the expense is ${amountCents} cents.`);
    this.name = 'SplitMismatchError';
  }
}

function assertValidSplits(amountCents, splits) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amount_cents must be a positive integer');
  }
  // Checked here rather than only in the form, so an edit is held to the same
  // ceiling as a create and an import can't carry a bad amount in behind them.
  assertAmountWithinLimit(amountCents);
  if (!splits.length) throw new Error('An expense must have at least one split');
  for (const s of splits) {
    if (!Number.isInteger(s.share_cents) || s.share_cents < 0) {
      throw new Error('share_cents must be a non-negative integer');
    }
  }
  if (!splitsSumToAmount(amountCents, splits)) {
    const sum = splits.reduce((s, x) => s + x.share_cents, 0);
    throw new SplitMismatchError(amountCents, sum);
  }
}

export async function createExpense({
  tripId,
  payerId,
  amountCents,
  description,
  category = null,
  spentAt,
  splits
}) {
  assertValidSplits(amountCents, splits);
  return db.transaction('rw', db.trips, db.expenses, db.splits, async (tx) => {
    await assertTripOpen(tx, tripId);
    const expense = {
      id: newId(),
      trip_id: tripId,
      payer_id: payerId,
      amount_cents: amountCents,
      description,
      category,
      spent_at: spentAt,
      created_at: now()
    };
    await tx.expenses.add(expense);
    await tx.splits.bulkAdd(
      splits.map((s) => ({ id: newId(), expense_id: expense.id, person_id: s.person_id, share_cents: s.share_cents }))
    );
    return expense;
  });
}

export async function updateExpense(expenseId, { payerId, amountCents, description, category, spentAt, splits }) {
  assertValidSplits(amountCents, splits);
  return db.transaction('rw', db.trips, db.expenses, db.splits, async (tx) => {
    const existing = await tx.expenses.get(expenseId);
    if (!existing) throw new Error('Expense not found');
    await assertTripOpen(tx, existing.trip_id);
    await tx.expenses.update(expenseId, {
      payer_id: payerId,
      amount_cents: amountCents,
      description,
      category: category ?? null,
      spent_at: spentAt
    });
    const oldSplits = await tx.splits.where('expense_id').equals(expenseId).toArray();
    await tx.splits.bulkDelete(oldSplits.map((s) => s.id));
    await tx.splits.bulkAdd(
      splits.map((s) => ({ id: newId(), expense_id: expenseId, person_id: s.person_id, share_cents: s.share_cents }))
    );
  });
}

export async function deleteExpense(expenseId) {
  return db.transaction('rw', db.trips, db.expenses, db.splits, async (tx) => {
    const existing = await tx.expenses.get(expenseId);
    if (!existing) return;
    await assertTripOpen(tx, existing.trip_id);
    const oldSplits = await tx.splits.where('expense_id').equals(expenseId).toArray();
    await tx.splits.bulkDelete(oldSplits.map((s) => s.id));
    await tx.expenses.delete(expenseId);
  });
}

export async function listExpensesOfTrip(tripId) {
  return db.expenses
    .where('[trip_id+spent_at]')
    .between([tripId, Dexie.minKey], [tripId, Dexie.maxKey])
    .toArray();
}

export async function getExpenseWithSplits(expenseId) {
  const expense = await db.expenses.get(expenseId);
  if (!expense) return null;
  const splits = await db.splits.where('expense_id').equals(expenseId).toArray();
  return { expense, splits };
}

export { SettledTripError, SplitMismatchError, AmountTooLargeError };
