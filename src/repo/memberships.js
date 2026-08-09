import { db } from '../db.js';
import { newId } from '../lib/util.js';

export async function addMember(groupId, personId) {
  const existing = await db.memberships
    .where('group_id')
    .equals(groupId)
    .and((m) => m.person_id === personId)
    .first();
  if (existing) return existing;
  const membership = { id: newId(), group_id: groupId, person_id: personId };
  await db.memberships.add(membership);
  return membership;
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
