import { db } from '../db.js';
import { newId, now } from '../lib/util.js';
import { assertTripOpen } from './tripLock.js';

export async function createSettlement({ groupId, tripId = null, fromPerson, toPerson, amountCents }) {
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error('amount_cents must be a positive integer');
  }
  if (fromPerson === toPerson) {
    throw new Error('A settlement must be between two different people');
  }
  const settlement = {
    id: newId(),
    group_id: groupId,
    trip_id: tripId,
    from_person: fromPerson,
    to_person: toPerson,
    amount_cents: amountCents,
    settled_at: now()
  };
  await db.settlements.add(settlement);
  return settlement;
}

export async function listSettlementsForGroup(groupId) {
  return db.settlements.where('group_id').equals(groupId).toArray();
}

export async function listSettlementsForTrip(tripId) {
  return db.settlements.where('trip_id').equals(tripId).toArray();
}

// Group-level settlements only (trip_id null) -- trip-scoped ones show on
// their own trip page instead, so a group and its trips never list the same
// row twice.
export async function listGroupLevelSettlements(groupId) {
  const all = await db.settlements.where('group_id').equals(groupId).toArray();
  return all.filter((s) => s.trip_id === null);
}

export async function deleteSettlement(settlementId) {
  return db.transaction('rw', db.trips, db.settlements, async (tx) => {
    const settlement = await tx.settlements.get(settlementId);
    if (!settlement) return;
    if (settlement.trip_id) {
      await assertTripOpen(tx, settlement.trip_id);
    }
    await tx.settlements.delete(settlementId);
  });
}
