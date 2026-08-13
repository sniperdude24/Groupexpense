import { db, SCHEMA_VERSION, TABLES } from '../db.js';

export async function ensureMeta() {
  const existing = await db.meta.get('schema_version');
  if (!existing) {
    await db.meta.put({ key: 'schema_version', value: SCHEMA_VERSION });
  }
}

export async function getMetaValue(key) {
  const row = await db.meta.get(key);
  return row ? row.value : undefined;
}

export async function setMetaValue(key, value) {
  await db.meta.put({ key, value });
}

/**
 * Erase everything and return to the fresh-install state: every table
 * including meta (so "last backed up" doesn't survive the data it described),
 * then the schema version reseeded. One transaction -- there is no partially
 * reset state to land in.
 */
export async function resetAllData() {
  await db.transaction('rw', [...TABLES.map((t) => db[t]), db.meta], async () => {
    for (const t of TABLES) await db[t].clear();
    await db.meta.clear();
  });
  await ensureMeta();
}
