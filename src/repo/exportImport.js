import { db, SCHEMA_VERSION, TABLES } from '../db.js';

export async function exportData() {
  const results = await Promise.all(TABLES.map((t) => db[t].toArray()));
  const data = { schema_version: SCHEMA_VERSION, exported_at: Date.now() };
  TABLES.forEach((t, i) => {
    data[t] = results[i];
  });
  return data;
}

/**
 * Export one group's complete graph -- the group row, its memberships, every
 * person referenced anywhere in it, its trips, their expenses and splits, and
 * the group's settlements. Same top-level shape as a full export, so
 * importData() on the receiving device consumes it unchanged; merge mode plus
 * UUID ids means re-sharing the same group later just fills in whatever the
 * other phone doesn't have yet.
 */
export async function exportGroup(groupId) {
  const group = await db.groups.get(groupId);
  if (!group) throw new Error('Group not found');

  const memberships = await db.memberships.where('group_id').equals(groupId).toArray();
  const trips = await db.trips.where('group_id').equals(groupId).toArray();
  const tripIds = trips.map((t) => t.id);
  const expenses = tripIds.length
    ? await db.expenses.where('trip_id').anyOf(tripIds).toArray()
    : [];
  const expenseIds = expenses.map((e) => e.id);
  const splits = expenseIds.length
    ? await db.splits.where('expense_id').anyOf(expenseIds).toArray()
    : [];
  const settlements = await db.settlements.where('group_id').equals(groupId).toArray();

  // Everyone the graph mentions, not just current members -- a person who
  // left the group can still be on old expenses, and the receiving device
  // needs their row to show those.
  const personIds = new Set(memberships.map((m) => m.person_id));
  for (const e of expenses) personIds.add(e.payer_id);
  for (const s of splits) personIds.add(s.person_id);
  for (const s of settlements) {
    personIds.add(s.from_person);
    personIds.add(s.to_person);
  }
  const people = (await db.people.bulkGet([...personIds]))
    .filter(Boolean)
    // is_me is who *this* device's owner is. Shipped as-is it would plant a
    // second "me" on the receiving phone, so it is stripped on the way out.
    .map((p) => ({ ...p, is_me: false }));

  return {
    schema_version: SCHEMA_VERSION,
    exported_at: Date.now(),
    groups: [group],
    people,
    memberships,
    trips,
    expenses,
    splits,
    settlements
  };
}

export async function importData(data, { mode = 'merge' } = {}) {
  if (!data || typeof data !== 'object') throw new Error('Invalid import file');
  if (data.schema_version !== SCHEMA_VERSION) {
    throw new Error(`Unsupported schema version: ${data.schema_version}`);
  }
  if (mode !== 'replace' && mode !== 'merge') {
    throw new Error(`Unknown import mode: ${mode}`);
  }

  const summary = {};
  await db.transaction('rw', TABLES.map((t) => db[t]), async () => {
    if (mode === 'replace') {
      for (const t of TABLES) await db[t].clear();
    }
    for (const t of TABLES) {
      const rows = Array.isArray(data[t]) ? data[t] : [];
      if (!rows.length) {
        summary[t] = { imported: 0, skipped: 0 };
        continue;
      }
      if (mode === 'merge') {
        const existingIds = new Set(await db[t].toCollection().primaryKeys());
        const toAdd = rows.filter((r) => !existingIds.has(r.id));
        if (toAdd.length) await db[t].bulkAdd(toAdd);
        summary[t] = { imported: toAdd.length, skipped: rows.length - toAdd.length };
      } else {
        await db[t].bulkAdd(rows);
        summary[t] = { imported: rows.length, skipped: 0 };
      }
    }
  });
  return summary;
}

export function downloadExport(data) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date(data.exported_at).toISOString().slice(0, 10);
  a.href = url;
  a.download = `split-export-${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function readImportFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(reader.result));
      } catch (err) {
        reject(new Error('That file is not valid JSON'));
      }
    };
    reader.onerror = () => reject(new Error('Could not read the file'));
    reader.readAsText(file);
  });
}
