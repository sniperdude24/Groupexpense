import { db } from '../db.js';
import { newId, now } from '../lib/util.js';
import { computeGroupBalance } from './queries.js';

export async function createGroup(name) {
  // origin marks provenance: the device that creates a group holds its
  // master copy; the share gate rewrites incoming groups to 'received'.
  const group = { id: newId(), name, created_at: now(), archived: false, origin: 'created' };
  await db.groups.add(group);
  return group;
}

/**
 * Claim or demote a group's master-copy status by hand. Exists for groups
 * made before origin tracking (their rows carry no origin at all) and as
 * the escape hatch when the label is simply wrong.
 */
export async function setGroupOrigin(groupId, origin) {
  if (origin !== 'created' && origin !== 'received') {
    throw new Error(`Unknown group origin: ${origin}`);
  }
  await db.groups.update(groupId, { origin });
}

export async function renameGroup(groupId, name) {
  await db.groups.update(groupId, { name });
}

export async function setGroupArchived(groupId, archived) {
  await db.groups.update(groupId, { archived });
}

/**
 * The oldest unarchived group is the "main" one -- the group Home is built
 * around. Stateless on purpose: with one group there is nothing to choose,
 * and with several the rule is at least predictable. Archiving the main
 * group promotes the next oldest automatically.
 */
export function pickMainGroup(groups) {
  // Tie-break by id: two groups created in the same millisecond would
  // otherwise leave "main" to storage order, which can differ between reads.
  return (
    [...groups].sort(
      (a, b) => a.created_at - b.created_at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    )[0] ?? null
  );
}

export async function getMainGroupId() {
  return pickMainGroup(await listGroups())?.id ?? null;
}

export async function listGroups({ includeArchived = false } = {}) {
  const all = await db.groups.toArray();
  return includeArchived ? all : all.filter((g) => !g.archived);
}

export async function listArchivedGroups() {
  const all = await db.groups.toArray();
  return all.filter((g) => g.archived);
}

export async function getGroup(groupId) {
  return db.groups.get(groupId);
}

export async function isGroupSettledUp(groupId) {
  // includeExcluded: this guards deletion, and excluding a trip from the
  // group's *display* must never make its debts deletable.
  const { net } = await computeGroupBalance(groupId, { includeExcluded: true });
  return [...net.values()].every((v) => v === 0);
}

// Only allowed once every balance in the group nets to zero -- deleting an
// active group would silently erase an unresolved debt, which is exactly
// the kind of silent-loss this app otherwise goes out of its way to avoid.
export async function deleteGroup(groupId) {
  if (!(await isGroupSettledUp(groupId))) {
    throw new Error('This group still has an outstanding balance. Settle up first.');
  }
  return db.transaction(
    'rw',
    db.groups,
    db.trips,
    db.expenses,
    db.splits,
    db.memberships,
    db.settlements,
    async (tx) => {
      const trips = await tx.trips.where('group_id').equals(groupId).toArray();
      for (const trip of trips) {
        const expenses = await tx.expenses.where('trip_id').equals(trip.id).toArray();
        for (const expense of expenses) {
          const splits = await tx.splits.where('expense_id').equals(expense.id).toArray();
          await tx.splits.bulkDelete(splits.map((s) => s.id));
          await tx.expenses.delete(expense.id);
        }
      }
      await tx.trips.where('group_id').equals(groupId).delete();

      const settlements = await tx.settlements.where('group_id').equals(groupId).toArray();
      await tx.settlements.bulkDelete(settlements.map((s) => s.id));

      const memberships = await tx.memberships.where('group_id').equals(groupId).toArray();
      await tx.memberships.bulkDelete(memberships.map((m) => m.id));

      await tx.groups.delete(groupId);
    }
  );
}
