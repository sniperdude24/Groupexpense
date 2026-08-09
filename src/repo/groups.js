import { db } from '../db.js';
import { newId, now } from '../lib/util.js';

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

export async function listGroups({ includeArchived = false } = {}) {
  const all = await db.groups.toArray();
  return includeArchived ? all : all.filter((g) => !g.archived);
}

export async function getGroup(groupId) {
  return db.groups.get(groupId);
}
