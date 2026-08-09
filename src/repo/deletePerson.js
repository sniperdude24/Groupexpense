import { db } from '../db.js';
import { computeEvenSplit } from '../lib/splits.js';

export async function previewDeletePerson(personId) {
  const person = await db.people.get(personId);
  if (!person) throw new Error('Person not found');

  const payerCount = await db.expenses.where('payer_id').equals(personId).count();
  const settlementCount = await db.settlements
    .filter((s) => s.from_person === personId || s.to_person === personId)
    .count();
  const mySplits = await db.splits.where('person_id').equals(personId).toArray();

  let settledTripExpense = null;
  let soleParticipantExpense = null;
  for (const split of mySplits) {
    const expense = await db.expenses.get(split.expense_id);
    if (!expense) continue;
    const trip = await db.trips.get(expense.trip_id);
    if (!settledTripExpense && trip && trip.status === 'settled') {
      settledTripExpense = expense;
    }
    const otherCount = await db.splits
      .where('expense_id')
      .equals(split.expense_id)
      .and((s) => s.person_id !== personId)
      .count();
    if (!soleParticipantExpense && otherCount === 0) {
      soleParticipantExpense = expense;
    }
  }

  return {
    isMe: person.is_me,
    payerCount,
    settlementCount,
    splitExpenseCount: mySplits.length,
    settledTripExpense,
    soleParticipantExpense,
    canDelete:
      !person.is_me &&
      payerCount === 0 &&
      settlementCount === 0 &&
      !settledTripExpense &&
      !soleParticipantExpense
  };
}

export async function deletePerson(personId) {
  return db.transaction(
    'rw',
    db.people,
    db.expenses,
    db.splits,
    db.memberships,
    db.settlements,
    db.trips,
    async (tx) => {
      const person = await tx.people.get(personId);
      if (!person) return;
      if (person.is_me) {
        throw new Error("You can't delete yourself. Mark someone else as \"me\" first if you need to.");
      }

      const payerCount = await tx.expenses.where('payer_id').equals(personId).count();
      if (payerCount > 0) {
        throw new Error(
          `${person.name} is the payer on ${payerCount} expense${payerCount === 1 ? '' : 's'}. Reassign the payer on those first.`
        );
      }

      const settlementCount = await tx.settlements
        .filter((s) => s.from_person === personId || s.to_person === personId)
        .count();
      if (settlementCount > 0) {
        throw new Error(
          `${person.name} has ${settlementCount} recorded payment${settlementCount === 1 ? '' : 's'}. Delete ${settlementCount === 1 ? 'it' : 'those'} first.`
        );
      }

      const mySplits = await tx.splits.where('person_id').equals(personId).toArray();
      for (const split of mySplits) {
        const expense = await tx.expenses.get(split.expense_id);
        if (!expense) continue;

        const trip = await tx.trips.get(expense.trip_id);
        if (trip && trip.status === 'settled') {
          throw new Error(`"${expense.description}" is in a settled trip. Reopen it first.`);
        }

        const otherSplits = await tx.splits
          .where('expense_id')
          .equals(split.expense_id)
          .and((s) => s.person_id !== personId)
          .toArray();
        if (otherSplits.length === 0) {
          throw new Error(`${person.name} is the only person on "${expense.description}". Edit that expense first.`);
        }

        const extra = computeEvenSplit(split.share_cents, otherSplits.map((s) => s.person_id));
        const extraById = new Map(extra.map((e) => [e.person_id, e.share_cents]));
        for (const other of otherSplits) {
          await tx.splits.update(other.id, {
            share_cents: other.share_cents + (extraById.get(other.person_id) || 0)
          });
        }
        await tx.splits.delete(split.id);
      }

      const memberships = await tx.memberships.where('person_id').equals(personId).toArray();
      await tx.memberships.bulkDelete(memberships.map((m) => m.id));

      await tx.people.delete(personId);
    }
  );
}
