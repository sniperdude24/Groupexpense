import { db } from '../db.js';
import { newId } from '../lib/util.js';

export async function createPerson({ name, note = '', is_me = false }) {
  return db.transaction('rw', db.people, async () => {
    if (is_me) {
      const existing = await db.people.toArray();
      if (existing.some((p) => p.is_me)) {
        throw new Error('A person is already marked as "me"');
      }
    }
    const person = { id: newId(), name, note, is_me };
    await db.people.add(person);
    return person;
  });
}

export async function renamePerson(personId, name) {
  await db.people.update(personId, { name });
}

export async function setPersonNote(personId, note) {
  await db.people.update(personId, { note });
}

export async function listPeople() {
  return db.people.toArray();
}

export async function getPerson(personId) {
  return db.people.get(personId);
}

export async function getMe() {
  const all = await db.people.toArray();
  return all.find((p) => p.is_me) || null;
}

export async function setIsMe(personId) {
  return db.transaction('rw', db.people, async () => {
    const all = await db.people.toArray();
    await Promise.all(
      all.map((p) => db.people.update(p.id, { is_me: p.id === personId }))
    );
  });
}
