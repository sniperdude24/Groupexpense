import { db, SCHEMA_VERSION, TABLES } from '../db.js';

export async function exportData() {
  const results = await Promise.all(TABLES.map((t) => db[t].toArray()));
  const data = { schema_version: SCHEMA_VERSION, exported_at: Date.now() };
  TABLES.forEach((t, i) => {
    data[t] = results[i];
  });
  return data;
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
