import { describe, it, expect, beforeEach } from 'vitest';
import {
  encodeBackupLink,
  decodeBackupFragment,
  encodeShareLink,
  decodeShareFragment,
  linkFitsInUrl,
  LINK_MAX_CHARS,
  FRAGMENT_PREFIX,
  SHARE_FRAGMENT_PREFIX
} from '../src/lib/backupLink.js';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { exportData, importData } from '../src/repo/exportImport.js';
import { computeTripBalance } from '../src/repo/queries.js';
import { computeEvenSplit } from '../src/lib/splits.js';

const BASE = 'https://example.test/app/';

describe('the backup link codec', () => {
  it('round-trips arbitrary export data exactly', async () => {
    const data = {
      schema_version: 1,
      exported_at: 1754800000000,
      groups: [{ id: 'g1', name: 'Crew — with dashes & "quotes"', archived: false }],
      people: [{ id: 'p1', name: 'ana', note: null, is_me: true }],
      expenses: []
    };
    const link = await encodeBackupLink(data, BASE);
    expect(link.startsWith(`${BASE}${FRAGMENT_PREFIX}`)).toBe(true);
    expect(await decodeBackupFragment(new URL(link).hash)).toEqual(data);
  });

  it('produces URL-safe payloads: no +, /, =, spaces or #', async () => {
    // Enough varied data that plain base64 would certainly emit + and /.
    const data = { blob: Array.from({ length: 400 }, (_, i) => `item-${i}-é你`) };
    const link = await encodeBackupLink(data, BASE);
    const payload = link.split(FRAGMENT_PREFIX)[1];
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('accepts a whole pasted link, not just the bare fragment', async () => {
    const data = { schema_version: 1, groups: [] };
    const link = await encodeBackupLink(data, BASE);
    expect(await decodeBackupFragment(link)).toEqual(data);
  });

  it('rejects damage with one friendly message, whatever actually broke', async () => {
    const link = await encodeBackupLink({ schema_version: 1, trips: [] }, BASE);
    const truncated = link.slice(0, link.length - 10);
    await expect(decodeBackupFragment(new URL(truncated).hash)).rejects.toThrow(/damaged or incomplete/);
    await expect(decodeBackupFragment('#import=!!!not-base64!!!')).rejects.toThrow(/damaged or incomplete/);
    await expect(decodeBackupFragment('#import=')).rejects.toThrow(/empty/);
    await expect(decodeBackupFragment('#/trips/abc')).rejects.toThrow(/not a backup link/);
  });

  it('draws the link-versus-file line at LINK_MAX_CHARS', () => {
    expect(linkFitsInUrl('x'.repeat(LINK_MAX_CHARS))).toBe(true);
    expect(linkFitsInUrl('x'.repeat(LINK_MAX_CHARS + 1))).toBe(false);
  });

  it('compresses: a realistic export links far smaller than its JSON', async () => {
    const rows = Array.from({ length: 200 }, (_, i) => ({
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
      trip_id: 'trip-1',
      payer_id: `person-${i % 6}`,
      amount_cents: 1000 + i,
      description: `Everyday expense number ${i}`,
      category: 'Food',
      spent_at: 1754800000000 + i,
      created_at: 1754800000000 + i
    }));
    const data = { schema_version: 1, expenses: rows };
    const link = await encodeBackupLink(data, BASE);
    expect(link.length).toBeLessThan(JSON.stringify(data).length / 3);
  });
});

describe('the share link codec', () => {
  it('round-trips a payload under its own prefix', async () => {
    const data = { schema_version: 1, groups: [{ id: 'g1', name: 'Crew' }], expenses: [] };
    const link = await encodeShareLink(data, BASE);
    expect(link.startsWith(`${BASE}${SHARE_FRAGMENT_PREFIX}`)).toBe(true);
    expect(await decodeShareFragment(new URL(link).hash)).toEqual(data);
    expect(await decodeShareFragment(link)).toEqual(data); // whole pasted link too
  });

  it('the prefixes do not cross: each decoder refuses the other kind of link', async () => {
    const data = { schema_version: 1, groups: [] };
    const shareLink = await encodeShareLink(data, BASE);
    const backupLink = await encodeBackupLink(data, BASE);
    // Routing is decided by prefix; a mixup must fail loudly, not import
    // someone else's share through the backup flow (or vice versa).
    await expect(decodeBackupFragment(shareLink)).rejects.toThrow(/not a backup link/);
    await expect(decodeShareFragment(backupLink)).rejects.toThrow(/not a share link/);
    await expect(decodeShareFragment('#share=')).rejects.toThrow(/empty/);
    await expect(decodeShareFragment('#share=!!!broken!!!')).rejects.toThrow(/damaged or incomplete/);
  });
});

describe('a backup link, imported into a fresh device', () => {
  beforeEach(resetDb);

  it('reproduces every balance identically', async () => {
    const group = await createGroup('Weekenders');
    const trip = await createTrip({ groupId: group.id, name: 'Cabin' });
    const ids = [];
    for (const name of ['ana', 'ben', 'cleo']) {
      const p = await createPerson({ name });
      await addMember(group.id, p.id);
      ids.push(p.id);
    }
    await createExpense({
      tripId: trip.id, payerId: ids[0], amountCents: 10001,
      description: 'Lunch', spentAt: Date.now(),
      splits: computeEvenSplit(10001, ids)
    });
    await createSettlement({
      groupId: group.id, tripId: trip.id,
      fromPerson: ids[1], toPerson: ids[0], amountCents: 1500
    });

    const before = await computeTripBalance(trip.id);
    const link = await encodeBackupLink(await exportData(), BASE);

    // Wipe, as a brand-new device would be, then arrive via the link.
    await resetDb();
    const decoded = await decodeBackupFragment(new URL(link).hash);
    await importData(decoded, { mode: 'replace' });

    const after = await computeTripBalance(trip.id);
    expect([...after.net.entries()].sort()).toEqual([...before.net.entries()].sort());
    expect(after.simplified).toEqual(before.simplified);
  });
});
