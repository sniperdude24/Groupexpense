// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe, getMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { setMetaValue, getMetaValue } from '../src/repo/meta.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderSettings } from '../src/screens/settings.js';
import { closeModal } from '../src/ui/modal.js';
import { db, SCHEMA_VERSION } from '../src/db.js';

beforeEach(resetDb);
afterEach(closeModal);

async function seededSettings() {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const bob = await createPerson({ name: 'bob' });
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  await addMember(group.id, bob.id);
  const trip = await createTrip({ groupId: group.id, name: 'boise' });
  await createExpense({
    tripId: trip.id, payerId: me.id, amountCents: 5000,
    description: 'Dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [me.id, bob.id])
  });
  await setMetaValue('last_backup_at', Date.now());

  const container = document.createElement('div');
  await renderSettings(container);
  return container;
}

const type = (input, text) => {
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

describe('the reset button in Settings', () => {
  it('warns that deletion is permanent and stays disabled until RESET is typed', async () => {
    const container = await seededSettings();
    container.querySelector('#reset-btn').click();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = document.getElementById('modal-overlay');
    expect(overlay.textContent).toContain('cannot be undone');
    expect(overlay.textContent).toContain('permanently deletes');

    const confirmBtn = overlay.querySelector('#reset-confirm');
    const input = overlay.querySelector('#reset-confirm-input');
    expect(confirmBtn.disabled).toBe(true);

    type(input, 'reset');
    expect(confirmBtn.disabled).toBe(true);
    type(input, 'RESE');
    expect(confirmBtn.disabled).toBe(true);
    type(input, '  RESET  ');
    expect(confirmBtn.disabled).toBe(false);
  });

  it('confirming erases everything, back to the fresh-install state', async () => {
    const container = await seededSettings();
    container.querySelector('#reset-btn').click();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = document.getElementById('modal-overlay');
    type(overlay.querySelector('#reset-confirm-input'), 'RESET');
    overlay.querySelector('#reset-confirm').click();
    await new Promise((r) => setTimeout(r, 100));

    expect(await db.people.count()).toBe(0);
    expect(await db.groups.count()).toBe(0);
    expect(await db.expenses.count()).toBe(0);
    expect(await db.splits.count()).toBe(0);
    expect(await getMe()).toBeFalsy();
    // Meta wiped too -- "last backed up" must not survive the data it
    // described -- but the schema version is reseeded.
    expect(await getMetaValue('last_backup_at')).toBeUndefined();
    expect(await getMetaValue('schema_version')).toBe(SCHEMA_VERSION);
    expect(document.getElementById('modal-overlay')).toBeNull();
  });

  it('cancel leaves every row exactly where it was', async () => {
    const container = await seededSettings();
    container.querySelector('#reset-btn').click();
    await new Promise((r) => setTimeout(r, 30));

    const overlay = document.getElementById('modal-overlay');
    type(overlay.querySelector('#reset-confirm-input'), 'RESET');
    overlay.querySelector('#reset-cancel').click();
    await new Promise((r) => setTimeout(r, 50));

    expect(await db.people.count()).toBe(2);
    expect(await db.expenses.count()).toBe(1);
    expect(await getMetaValue('last_backup_at')).toBeDefined();
  });
});
