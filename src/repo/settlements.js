import { db } from '../db.js';
import { newId, now } from '../lib/util.js';

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

export async function deleteSettlement(settlementId) {
  await db.settlements.delete(settlementId);
}
