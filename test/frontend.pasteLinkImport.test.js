// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { exportData } from '../src/repo/exportImport.js';
import { encodeBackupLink } from '../src/lib/backupLink.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderSettings } from '../src/screens/settings.js';
import { closeModal } from '../src/ui/modal.js';
import { db } from '../src/db.js';

beforeEach(resetDb);
afterEach(closeModal);

async function seededBackupLink() {
  const group = await createGroup('Boise');
  const trip = await createTrip({ groupId: group.id, name: 'Boise' });
  const a = await createPerson({ name: 'david' });
  const b = await createPerson({ name: 'bob' });
  await addMember(group.id, a.id);
  await addMember(group.id, b.id);
  await createExpense({
    tripId: trip.id, payerId: a.id, amountCents: 6737,
    description: 'fun', spentAt: Date.now(),
    splits: computeEvenSplit(6737, [a.id, b.id])
  });
  return encodeBackupLink(await exportData(), 'https://example.test/app/');
}

describe('paste-a-link import on Settings', () => {
  it('pasting a backup link and clicking Import offers the same Merge/Replace sheet', async () => {
    const link = await seededBackupLink();
    await resetDb(); // the receiving device is empty

    const container = document.createElement('div');
    await renderSettings(container);

    container.querySelector('#import-link').value = `  ${link}  `; // survives sloppy paste
    container.querySelector('#import-link-btn').click();
    await new Promise((r) => setTimeout(r, 50));

    const overlay = document.getElementById('modal-overlay');
    expect(overlay, 'the import offer must appear').toBeTruthy();
    expect(overlay.textContent).toContain('1 groups, 1 trips,');
    expect(overlay.textContent).toContain('1 expenses');

    // And the offer is real: Merge lands the data.
    overlay.querySelector('#import-merge').click();
    await new Promise((r) => setTimeout(r, 100));
    expect(await db.expenses.count()).toBe(1);
    expect(await db.people.count()).toBe(2);
  });

  it('a damaged pasted link gets the friendly error and imports nothing', async () => {
    const link = await seededBackupLink();
    await resetDb();

    const container = document.createElement('div');
    await renderSettings(container);

    container.querySelector('#import-link').value = link.slice(0, link.length - 8);
    container.querySelector('#import-link-btn').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(document.getElementById('modal-overlay')).toBeNull();
    expect(document.getElementById('toast')?.textContent).toMatch(/damaged or incomplete/);
    expect(await db.expenses.count()).toBe(0);
  });

  it('an empty box nudges instead of erroring', async () => {
    const container = document.createElement('div');
    await renderSettings(container);

    container.querySelector('#import-link-btn').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(document.getElementById('modal-overlay')).toBeNull();
    expect(document.getElementById('toast')?.textContent).toMatch(/Paste a backup or share link first/);
  });
});
