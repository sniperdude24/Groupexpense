import { db } from '../db.js';
import { newId } from '../lib/util.js';
import { MAX_GROUP_MEMBERS, GroupFullError } from '../lib/limits.js';

export async function addMember(groupId, personId) {
  const existing = await db.memberships
    .where('group_id')
    .equals(groupId)
    .and((m) => m.person_id === personId)
    .first();
  // Someone already in the group is a no-op, so it stays allowed at the cap --
  // only a genuinely new member counts against it.
  if (existing) return existing;
  const headcount = await db.memberships.where('group_id').equals(groupId).count();
  if (headcount >= MAX_GROUP_MEMBERS) throw new GroupFullError();
  const membership = { id: newId(), group_id: groupId, person_id: personId };
  await db.memberships.add(membership);
  return membership;
}

/** Whether another *new* member would still fit. */
export async function groupHasRoom(groupId) {
  const headcount = await db.memberships.where('group_id').equals(groupId).count();
  return headcount < MAX_GROUP_MEMBERS;
}

export async function removeMember(membershipId) {
  await db.memberships.delete(membershipId);
}

export async function listMembersOfGroup(groupId) {
  const memberships = await db.memberships.where('group_id').equals(groupId).toArray();
  const people = await db.people.bulkGet(memberships.map((m) => m.person_id));
  return memberships.map((m, i) => ({ membership: m, person: people[i] })).filter((r) => r.person);
}

export async function listGroupsOfPerson(personId) {
  return db.memberships.where('person_id').equals(personId).toArray();
}
