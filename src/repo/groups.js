import { db } from '../db.js';
import { newId, now } from '../lib/util.js';
import { computeGroupBalance } from './queries.js';

export async function createGroup(name) {
  const group = { id: newId(), name, created_at: now(), archived: false };
  await db.groups.add(group);
  return group;
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
  return [...groups].sort((a, b) => a.created_at - b.created_at)[0] ?? null;
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
