import { db, TABLES } from '../src/db.js';

export async function resetDb() {
  await Promise.all(TABLES.map((t) => db[t].clear()));
  await db.meta.clear();
}
