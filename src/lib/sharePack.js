/**
 * The packed wire format for shares and backups.
 *
 * A plain export is mostly UUIDs -- every row has one, references repeat
 * them, and JSON repeats every key name per row. Packing rewrites that into
 * (1) one deduplicated id dictionary, dashes stripped and concatenated into
 * a single hex string, which deflate then halves, and (2) columnar tables
 * whose key names ship once. Measured on realistic data this makes links
 * 13-31% shorter and QR transfers 25-30% fewer frames.
 *
 * Pack and unpack live only at the wire boundary (backupLink, qrtransfer);
 * everything inland -- validateShare, importData, the screens -- keeps
 * seeing plain payloads. unpackShare passes anything that isn't a v2
 * wrapper through untouched, so every link and QR share made before this
 * format keeps working. The wrapper deliberately has no top-level
 * schema_version: an old app receiving a packed payload fails with its
 * existing "incompatible version of Split" message instead of silently
 * importing nothing.
 */

const PACK_VERSION = 2;

const TABLES = ['groups', 'people', 'memberships', 'trips', 'expenses', 'splits', 'settlements'];

// Which fields hold row ids or references to them.
const isIdField = (key) => key === 'id' || key.endsWith('_id') || key === 'from_person' || key === 'to_person';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const hexToUuid = (hex) =>
  `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;

export function packShare(data) {
  const ids = [];
  const index = new Map();
  // UUID-shaped id values become dictionary indexes; anything else -- null
  // trip_ids, crafted string ids -- stays inline verbatim. Unpack tells them
  // apart by type: number means index, string means literal.
  const ref = (value) => {
    if (typeof value !== 'string' || !UUID_RE.test(value)) return value ?? null;
    const key = value.toLowerCase();
    if (!index.has(key)) {
      index.set(key, ids.length);
      ids.push(key.replace(/-/g, ''));
    }
    return index.get(key);
  };

  const rest = {};
  for (const [key, value] of Object.entries(data)) {
    if (key === 'schema_version' || (TABLES.includes(key) && Array.isArray(value))) continue;
    rest[key] = value;
  }

  const t = {};
  for (const table of TABLES) {
    const rows = data[table];
    if (!Array.isArray(rows)) continue;
    if (!rows.length) {
      t[table] = [];
      continue;
    }
    // Rows from the exporters are homogeneous, so one key row describes all.
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    t[table] = [keys, ...rows.map((r) => keys.map((k) => (isIdField(k) ? ref(r[k]) : r[k] ?? null)))];
  }

  return { ...rest, v: PACK_VERSION, s: data.schema_version, ids: ids.join(''), t };
}

/** A v2 wrapper -> the original payload; anything else passes through untouched. */
export function unpackShare(parsed) {
  if (!parsed || typeof parsed !== 'object' || parsed.v !== PACK_VERSION) return parsed;
  if (typeof parsed.ids !== 'string' || !parsed.t || typeof parsed.t !== 'object') return parsed;

  const ids = [];
  for (let i = 0; i + 32 <= parsed.ids.length; i += 32) ids.push(hexToUuid(parsed.ids.slice(i, i + 32)));
  const deref = (value) => (typeof value === 'number' ? ids[value] ?? null : value);

  const data = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'v' || key === 's' || key === 'ids' || key === 't') continue;
    data[key] = value;
  }
  if (parsed.s !== undefined) data.schema_version = parsed.s;

  for (const table of TABLES) {
    const packed = parsed.t[table];
    if (!Array.isArray(packed)) continue;
    if (!packed.length) {
      data[table] = [];
      continue;
    }
    const [keys, ...rows] = packed;
    data[table] = rows.map((values) => {
      const row = {};
      keys.forEach((k, i) => {
        row[k] = isIdField(k) ? deref(values[i]) : values[i];
      });
      return row;
    });
  }
  return data;
}
