import { db } from '../db.js';
import { newId, now } from '../lib/util.js';

export async function createTrip({ groupId, name, startDate = null, endDate = null }) {
  const trip = {
    id: newId(),
    group_id: groupId,
    name,
    start_date: startDate,
    end_date: endDate,
    status: 'open',
    settled_at: null
  };
  await db.trips.add(trip);
  return trip;
}

export async function updateTrip(tripId, { name, startDate, endDate }) {
  const patch = {};
  if (name !== undefined) patch.name = name;
  if (startDate !== undefined) patch.start_date = startDate;
  if (endDate !== undefined) patch.end_date = endDate;
  await db.trips.update(tripId, patch);
}

export async function settleTrip(tripId) {
  await db.trips.update(tripId, { status: 'settled', settled_at: now() });
}

export async function reopenTrip(tripId) {
  await db.trips.update(tripId, { status: 'open', settled_at: null });
}

/**
 * An excluded trip keeps its own books but stays out of the group ledger --
 * for the trip everyone agreed to call even, or the one-off that shouldn't
 * skew the crew's running total. Display state, not a lock: the trip stays
 * fully editable, and the deletion safety check deliberately ignores this
 * flag so an excluded debt can still never be silently erased.
 */
export async function setTripExcluded(tripId, excluded) {
  await db.trips.update(tripId, { excluded: !!excluded });
}

export async function listTripsOfGroup(groupId) {
  return db.trips.where('group_id').equals(groupId).toArray();
}

export async function getTrip(tripId) {
  return db.trips.get(tripId);
}

export async function isTripSettled(tripId) {
  const trip = await db.trips.get(tripId);
  return trip ? trip.status === 'settled' : false;
}
