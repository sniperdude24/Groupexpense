// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { exportExpense, exportGroup } from '../src/repo/exportImport.js';
import { encodeShareLink, decodeShareFragment, SHARE_FRAGMENT_PREFIX } from '../src/lib/backupLink.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderSettings } from '../src/screens/settings.js';
import { render as renderShare } from '../src/screens/shareGroup.js';
import { closeModal } from '../src/ui/modal.js';
import { db } from '../src/db.js';

const BASE = 'https://example.test/app/';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});
afterEach(() => {
  closeModal();
  delete navigator.clipboard;
});

function stubClipboard() {
  const writes = [];
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: async (text) => { writes.push(text); } }
  });
  return writes;
}

async function seedTrip() {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const bob = await createPerson({ name: 'bob' });
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  await addMember(group.id, bob.id);
  const boise = await createTrip({ groupId: group.id, name: 'boise' });
  const dinner = await createExpense({
    tripId: boise.id, payerId: me.id, amountCents: 5000,
    description: 'dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [me.id, bob.id])
  });
  return { me, bob, group, boise, dinner };
}

describe('sending a share as a link', () => {
  it('the share screen button produces a #share= link that decodes to the payload', async () => {
    const { dinner } = await seedTrip();
    const writes = stubClipboard(); // no navigator.share in jsdom -> clipboard branch

    const screen = document.createElement('div');
    await renderShare(screen, { expenseId: dinner.id });
    screen.querySelector('#send-link-btn').click();
    await new Promise((r) => setTimeout(r, 80));

    expect(writes).toHaveLength(1);
    expect(writes[0]).toContain(SHARE_FRAGMENT_PREFIX);
    const payload = await decodeShareFragment(writes[0]);
    expect(payload.expenses.map((e) => e.description)).toEqual(['dinner']);
    expect(document.getElementById('toast')?.textContent).toMatch(/Share link copied/);
  });

  it('a share too big for a link is refused, not silently truncated', async () => {
    const { group, boise, me, bob } = await seedTrip();
    // Incompressible bulk: long random descriptions defeat deflate.
    for (let i = 0; i < 30; i++) {
      const noise = Array.from({ length: 100 }, () => Math.random().toString(36).slice(2)).join('');
      await createExpense({
        tripId: boise.id, payerId: me.id, amountCents: 1000,
        description: noise, spentAt: Date.now(),
        splits: computeEvenSplit(1000, [me.id, bob.id])
      });
    }
    const writes = stubClipboard();

    const screen = document.createElement('div');
    await renderShare(screen, { groupId: group.id });
    screen.querySelector('#send-link-btn').click();
    await new Promise((r) => setTimeout(r, 200));

    expect(writes).toHaveLength(0);
    expect(document.getElementById('toast')?.textContent).toMatch(/too big for a link/);
  });
});

describe('receiving a share link', () => {
  it('a pasted share link lands in the gated sheet -- with no Replace anywhere', async () => {
    const { dinner } = await seedTrip();
    const link = await encodeShareLink(await exportExpense(dinner.id), BASE);
    await resetDb(); // the receiving device is empty

    const container = document.createElement('div');
    await renderSettings(container);
    container.querySelector('#import-link').value = `  ${link}  `;
    container.querySelector('#import-link-btn').click();
    await new Promise((r) => setTimeout(r, 100));

    const overlay = document.getElementById('modal-overlay');
    expect(overlay, 'the share confirmation must appear').toBeTruthy();
    expect(overlay.textContent).toContain('Add this share?');
    // The backup importer's destructive option must be unreachable from a
    // link someone else composed.
    expect(overlay.textContent).not.toContain('Replace');
    expect(overlay.querySelector('#import-replace')).toBeNull();

    overlay.querySelector('#rx-cancel').click();
    await new Promise((r) => setTimeout(r, 50));
    expect(await db.expenses.count()).toBe(0);
    expect(await db.groups.count()).toBe(0);
  });

  it('accepting a share link lands exactly the shared rows', async () => {
    const { dinner } = await seedTrip();
    const link = await encodeShareLink(await exportExpense(dinner.id), BASE);
    await resetDb();

    const container = document.createElement('div');
    await renderSettings(container);
    container.querySelector('#import-link').value = link;
    container.querySelector('#import-link-btn').click();
    await new Promise((r) => setTimeout(r, 100));

    document.getElementById('modal-overlay').querySelector('#rx-accept').click();
    await new Promise((r) => setTimeout(r, 100));

    expect(await db.expenses.count()).toBe(1);
    expect(await db.splits.count()).toBe(2);
    expect(await db.people.count()).toBe(2);
    expect(document.getElementById('toast')?.textContent).toMatch(/Share received/);
  });

  it('a tampered share link is rejected before any sheet appears', async () => {
    const { group } = await seedTrip();
    const payload = await exportGroup(group.id);
    payload.splits = payload.splits.map((s, i) => (i === 0 ? { ...s, share_cents: s.share_cents + 1 } : s));
    const link = await encodeShareLink(payload, BASE);
    await resetDb();

    const container = document.createElement('div');
    await renderSettings(container);
    container.querySelector('#import-link').value = link;
    container.querySelector('#import-link-btn').click();
    await new Promise((r) => setTimeout(r, 100));

    expect(document.getElementById('modal-overlay')).toBeNull();
    expect(document.getElementById('toast')?.textContent).toMatch(/don't add up/);
    expect(await db.expenses.count()).toBe(0);
  });
});
