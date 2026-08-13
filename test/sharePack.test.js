import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { exportData, exportGroup, exportTrip, exportExpense } from '../src/repo/exportImport.js';
import { packShare, unpackShare } from '../src/lib/sharePack.js';
import { encodeShareLink } from '../src/lib/backupLink.js';
import { encodeTransfer } from '../src/lib/qrtransfer.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { gzipSync } from 'node:zlib';

beforeEach(resetDb);

async function seed() {
  const crew = await createGroup('Crew');
  const boise = await createTrip({ groupId: crew.id, name: 'boise' });
  const ana = await createPerson({ name: 'ana' });
  const ben = await createPerson({ name: 'ben' });
  await setIsMe(ana.id);
  await addMember(crew.id, ana.id);
  await addMember(crew.id, ben.id);
  const dinner = await createExpense({
    tripId: boise.id, payerId: ana.id, amountCents: 5000,
    description: 'Dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [ana.id, ben.id])
  });
  // Both settlement flavours: trip-scoped and group-level (null trip_id).
  await createSettlement({
    groupId: crew.id, tripId: boise.id,
    fromPerson: ben.id, toPerson: ana.id, amountCents: 1000
  });
  await createSettlement({
    groupId: crew.id, tripId: null,
    fromPerson: ana.id, toPerson: ben.id, amountCents: 300
  });
  return { crew, boise, ana, dinner };
}

describe('packShare / unpackShare', () => {
  it('round-trips every exporter output exactly', async () => {
    const { crew, boise, dinner } = await seed();
    for (const payload of [
      await exportData(), // full backup, is_me: true included
      await exportGroup(crew.id),
      await exportTrip(boise.id),
      await exportExpense(dinner.id)
    ]) {
      expect(unpackShare(packShare(payload))).toEqual(payload);
    }
  });

  it('survives non-UUID ids and non-table extras verbatim', () => {
    const payload = {
      schema_version: 1,
      exported_at: 1755000000000,
      note_to_self: 'not a table',
      groups: [{ id: 'hand-written-id', name: 'Crew' }],
      expenses: [],
      splits: [{ id: 'their-split', expense_id: 'their-extra', person_id: 'ghost', share_cents: 700 }]
    };
    expect(unpackShare(packShare(payload))).toEqual(payload);
  });

  it('passes anything that is not a v2 wrapper through untouched', async () => {
    const { crew } = await seed();
    const plain = await exportGroup(crew.id);
    // Old links and old QR shares arrive as plain payloads.
    expect(unpackShare(plain)).toBe(plain);
    expect(unpackShare(null)).toBe(null);
    expect(unpackShare({ v: 3, t: {} })).toEqual({ v: 3, t: {} });
    expect(unpackShare({ v: 2, nonsense: true })).toEqual({ v: 2, nonsense: true });
  });

  it('the wrapper hides schema_version from old apps', async () => {
    const { crew } = await seed();
    const packed = packShare(await exportGroup(crew.id));
    // An old validateShare/importData must see "incompatible", not a payload
    // of silently-empty tables.
    expect(packed.schema_version).toBeUndefined();
    expect(unpackShare(packed).schema_version).toBe(1);
  });
});

describe('packing actually shrinks the wire', () => {
  it('a realistic trip gets a shorter link and fewer QR frames', async () => {
    const { crew, boise, ana } = await seed();
    const others = [];
    for (const name of ['cleo', 'dana']) {
      const p = await createPerson({ name });
      await addMember(crew.id, p.id);
      others.push(p);
    }
    for (let i = 0; i < 50; i++) {
      await createExpense({
        tripId: boise.id, payerId: ana.id, amountCents: 1000 + i * 10,
        description: `Food: ${10 + (i % 18)} Aug 26 at ${1 + (i % 12)}:15 PM`,
        spentAt: Date.now() + i, splits: computeEvenSplit(1000 + i * 10, [ana.id, others[0].id, others[1].id])
      });
    }
    const payload = await exportTrip(boise.id);
    const base = 'https://example.test/app/';

    const packedLink = await encodeShareLink(payload, base);
    const plainJson = JSON.stringify(payload);
    const packedJson = JSON.stringify(packShare(payload));
    expect(packedJson.length).toBeLessThan(plainJson.length * 0.7);

    const frames = await encodeTransfer(payload);
    // The packed link and frame count are what the user actually feels; pin
    // that they reflect the packed encoding, not the plain one. 760 is
    // qrtransfer's CHUNK_SIZE; the plain-frame count mirrors its
    // gzip -> base64 -> chunk pipeline on the unpacked payload.
    const plainFrames = Math.ceil(Math.ceil(gzipSync(plainJson).length * 4 / 3) / 760);
    expect(packedLink.length).toBeLessThan(8000);
    expect(frames.length).toBeLessThan(plainFrames);
  });
});
