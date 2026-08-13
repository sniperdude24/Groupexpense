import { db } from '../db.js';
import { MAX_ENTRY_AMOUNT_CENTS } from '../lib/limits.js';

/**
 * The receiving side of a QR share trusts nothing.
 *
 * A share arrives from another phone's screen, which means it arrives from
 * another person -- and anyone who ever received this group knows its UUIDs,
 * so a crafted payload could aim rows straight at the local ledger. Before
 * anything is offered to the user, the payload is validated structurally
 * (references resolve, splits sum, amounts are sane) and sanitized (is_me is
 * stripped no matter what the sender claimed). Only a payload that passes
 * gets as far as the confirmation sheet, and only the confirmation actually
 * writes.
 */

const bad = (message) => {
  throw new Error(message);
};

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

const isMoney = (v) => Number.isInteger(v) && v > 0 && v <= MAX_ENTRY_AMOUNT_CENTS;

function checkNoDuplicateIds(rows, table) {
  const seen = new Set();
  for (const row of rows) {
    if (!isNonEmptyString(row?.id)) bad(`This share is malformed (${table} without an id).`);
    if (seen.has(row.id)) bad(`This share is malformed (duplicate ${table} entry).`);
    seen.add(row.id);
  }
}

/**
 * Validate a received share and return a sanitized copy, or throw one
 * user-facing Error. References may resolve either inside the payload or to
 * rows already on this device -- additions to an existing group or trip are
 * legitimate (that's what re-sharing is) and the preview surfaces them.
 */
export async function validateShare(payload) {
  if (!payload || typeof payload !== 'object') bad('This share is not readable.');
  if (payload.schema_version !== 1) {
    bad('This share was made by an incompatible version of Split.');
  }

  const tables = ['groups', 'people', 'memberships', 'trips', 'expenses', 'splits', 'settlements'];
  const data = {};
  for (const t of tables) {
    const rows = payload[t] ?? [];
    if (!Array.isArray(rows)) bad('This share is malformed.');
    data[t] = rows;
    checkNoDuplicateIds(rows, t);
  }

  // Reference targets: the payload's own rows plus what this device already has.
  const localGroupIds = new Set(await db.groups.toCollection().primaryKeys());
  const localPeopleIds = new Set(await db.people.toCollection().primaryKeys());
  const localTripIds = new Set(await db.trips.toCollection().primaryKeys());

  const groupIds = new Set([...localGroupIds, ...data.groups.map((g) => g.id)]);
  const peopleIds = new Set([...localPeopleIds, ...data.people.map((p) => p.id)]);
  const tripIds = new Set([...localTripIds, ...data.trips.map((t) => t.id)]);
  const payloadExpenseIds = new Set(data.expenses.map((e) => e.id));

  // A received group is by definition a copy -- the master copy lives on
  // whichever device created it. Rewritten here, next to the is_me strip,
  // no matter what the sender's row claimed.
  const groups = data.groups.map((g) => {
    if (!isNonEmptyString(g.name)) bad('This share is malformed (a group has no name).');
    return { ...g, origin: 'received' };
  });
  // is_me is who THIS device's owner is. The sender strips it, but a crafted
  // payload could lie -- so the receiver strips it again, trusting no one.
  const people = data.people.map((p) => {
    if (!isNonEmptyString(p.name)) bad('This share is malformed (a person has no name).');
    return { ...p, is_me: false };
  });

  for (const m of data.memberships) {
    if (!groupIds.has(m.group_id) || !peopleIds.has(m.person_id)) {
      bad('This share is malformed (a membership points at nothing).');
    }
  }
  for (const t of data.trips) {
    if (!groupIds.has(t.group_id)) bad('This share is malformed (a trip without its group).');
    if (t.status !== 'open' && t.status !== 'settled') {
      bad('This share is malformed (unrecognised trip status).');
    }
  }
  for (const e of data.expenses) {
    if (!tripIds.has(e.trip_id)) bad('This share is malformed (an expense without its trip).');
    if (!peopleIds.has(e.payer_id)) bad('This share is malformed (an expense without its payer).');
    if (!isMoney(e.amount_cents)) bad('This share contains an invalid expense amount.');
  }

  // Splits must come WITH their expense. A split aimed at an expense already
  // on this device would silently break that expense's sum invariant -- the
  // exact kind of injection this validation exists to stop.
  const sums = new Map();
  for (const s of data.splits) {
    if (!payloadExpenseIds.has(s.expense_id)) {
      bad('This share is malformed (a split without its expense).');
    }
    if (!peopleIds.has(s.person_id)) bad('This share is malformed (a split without its person).');
    if (!Number.isInteger(s.share_cents) || s.share_cents < 0 || s.share_cents > MAX_ENTRY_AMOUNT_CENTS) {
      bad('This share contains an invalid split amount.');
    }
    sums.set(s.expense_id, (sums.get(s.expense_id) ?? 0) + s.share_cents);
  }
  for (const e of data.expenses) {
    if ((sums.get(e.id) ?? 0) !== e.amount_cents) {
      bad("This share's numbers don't add up (splits disagree with their expense).");
    }
  }

  for (const s of data.settlements) {
    if (!groupIds.has(s.group_id)) bad('This share is malformed (a payment without its group).');
    if (s.trip_id != null && !tripIds.has(s.trip_id)) {
      bad('This share is malformed (a payment without its trip).');
    }
    if (!peopleIds.has(s.from_person) || !peopleIds.has(s.to_person)) {
      bad('This share is malformed (a payment without its people).');
    }
    if (s.from_person === s.to_person) {
      bad('This share is malformed (a payment from someone to themselves).');
    }
    if (!isMoney(s.amount_cents)) bad('This share contains an invalid payment amount.');
  }

  return { ...payload, ...data, groups, people };
}

/**
 * What the confirmation sheet shows: exactly what would be added, and --
 * most importantly -- what lands inside groups and trips that already exist
 * on this device.
 */
export async function previewShare(payload) {
  const newRows = {};
  for (const t of ['groups', 'people', 'memberships', 'trips', 'expenses', 'splits', 'settlements']) {
    const existing = new Set(await db[t].toCollection().primaryKeys());
    newRows[t] = (payload[t] ?? []).filter((r) => !existing.has(r.id));
  }

  const newTripIds = new Set(newRows.trips.map((t) => t.id));
  const newGroupIds = new Set(newRows.groups.map((g) => g.id));
  const groupName = async (id) =>
    (payload.groups ?? []).find((g) => g.id === id)?.name ?? (await db.groups.get(id))?.name ?? '?';

  const newTrips = [];
  for (const trip of newRows.trips) {
    newTrips.push({
      name: trip.name,
      groupName: await groupName(trip.group_id),
      groupIsNew: newGroupIds.has(trip.group_id),
      expenses: newRows.expenses.filter((e) => e.trip_id === trip.id).length
    });
  }

  // Additions aimed at trips already on this device -- the case the user
  // must not be able to miss.
  const byExistingTrip = new Map();
  for (const e of newRows.expenses) {
    if (newTripIds.has(e.trip_id)) continue;
    const entry = byExistingTrip.get(e.trip_id) ?? { expenses: 0, settlements: 0 };
    entry.expenses += 1;
    byExistingTrip.set(e.trip_id, entry);
  }
  for (const s of newRows.settlements) {
    if (s.trip_id == null || newTripIds.has(s.trip_id)) continue;
    const entry = byExistingTrip.get(s.trip_id) ?? { expenses: 0, settlements: 0 };
    entry.settlements += 1;
    byExistingTrip.set(s.trip_id, entry);
  }
  const existingTripAdditions = [];
  for (const [tripId, counts] of byExistingTrip) {
    const trip = await db.trips.get(tripId);
    existingTripAdditions.push({ name: trip?.name ?? '?', ...counts });
  }

  return {
    newGroups: newRows.groups.map((g) => g.name),
    newTrips,
    newPeople: newRows.people.map((p) => p.name),
    existingTripAdditions,
    totalNewRows: Object.values(newRows).reduce((sum, rows) => sum + rows.length, 0)
  };
}
