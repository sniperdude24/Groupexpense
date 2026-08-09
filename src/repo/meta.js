import { db, SCHEMA_VERSION } from '../db.js';

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
