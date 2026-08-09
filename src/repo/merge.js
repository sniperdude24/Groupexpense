import { db } from '../db.js';

async function affectedCounts(personId) {
  const [expenses, splits, memberships, settlements] = await Promise.all([
    db.expenses.where('payer_id').equals(personId).count(),
    db.splits.where('person_id').equals(personId).count(),
    db.memberships.where('person_id').equals(personId).count(),
    db.settlements.filter((s) => s.from_person === personId || s.to_person === personId).count()
  ]);
  return { expenses, splits, memberships, settlements };
}

export async function previewMerge(sourceId) {
  return affectedCounts(sourceId);
}

// Merging is allowed to touch settled trips: unlike editing an amount, this
// corrects who a historical row belongs to, and the spec's whole point for
// this feature is fixing an identity mistake discovered after the fact --
// often only noticed once a trip is already settled.
export async function mergePeople(sourceId, targetId) {
  if (sourceId === targetId) throw new Error('Cannot merge a person into themselves');

  return db.transaction(
    'rw',
    db.people,
    db.expenses,
    db.splits,
    db.memberships,
    db.settlements,
    async (tx) => {
      const source = await tx.people.get(sourceId);
      const target = await tx.people.get(targetId);
      if (!source || !target) throw new Error('Person not found');

      const paidBySource = await tx.expenses.where('payer_id').equals(sourceId).toArray();
      await Promise.all(paidBySource.map((e) => tx.expenses.update(e.id, { payer_id: targetId })));

      const sourceSplits = await tx.splits.where('person_id').equals(sourceId).toArray();
      for (const split of sourceSplits) {
        const dupe = await tx.splits
          .where('expense_id')
          .equals(split.expense_id)
          .and((s) => s.person_id === targetId)
          .first();
        if (dupe) {
          await tx.splits.update(dupe.id, { share_cents: dupe.share_cents + split.share_cents });
          await tx.splits.delete(split.id);
        } else {
          await tx.splits.update(split.id, { person_id: targetId });
        }
      }

      const sourceMemberships = await tx.memberships.where('person_id').equals(sourceId).toArray();
      for (const m of sourceMemberships) {
        const dupe = await tx.memberships
          .where('group_id')
          .equals(m.group_id)
          .and((x) => x.person_id === targetId)
          .first();
        if (dupe) {
          await tx.memberships.delete(m.id);
        } else {
          await tx.memberships.update(m.id, { person_id: targetId });
        }
      }

      const allSettlements = await tx.settlements.toArray();
      for (const s of allSettlements) {
        const fromIsSource = s.from_person === sourceId;
        const toIsSource = s.to_person === sourceId;
        if (!fromIsSource && !toIsSource) continue;
        const newFrom = fromIsSource ? targetId : s.from_person;
        const newTo = toIsSource ? targetId : s.to_person;
        if (newFrom === newTo) {
          await tx.settlements.delete(s.id);
        } else {
          await tx.settlements.update(s.id, { from_person: newFrom, to_person: newTo });
        }
      }

      if (source.is_me && !target.is_me) {
        await tx.people.update(targetId, { is_me: true });
      }

      await tx.people.delete(sourceId);
    }
  );
}
