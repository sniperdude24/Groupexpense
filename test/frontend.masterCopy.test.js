// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup, getGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { exportGroup, importData } from '../src/repo/exportImport.js';
import { validateShare } from '../src/repo/incomingShare.js';
import { render as renderHome } from '../src/screens/home.js';
import { render as renderShare } from '../src/screens/shareGroup.js';
import { openGroupSettingsModal } from '../src/ui/groupSettingsModal.js';
import { closeModal } from '../src/ui/modal.js';
import { db } from '../src/db.js';

beforeEach(resetDb);
afterEach(closeModal);

async function seedCreatedGroup(name = 'Homemade') {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const group = await createGroup(name);
  await addMember(group.id, me.id);
  await createTrip({ groupId: group.id, name: 'trip' });
  return { me, group };
}

/** A second group that arrived through the share gate -- a copy. */
async function importCopyGroup() {
  const ghost = await createGroup('Borrowed');
  await new Promise((r) => setTimeout(r, 3)); // keep main-group pick deterministic
  const share = await validateShare(await exportGroup(ghost.id));
  await db.groups.delete(ghost.id);
  await importData(share, { mode: 'merge' });
  return getGroup(ghost.id);
}

describe('master copy vs copy', () => {
  it('home badges the created group as master and the received one as copy', async () => {
    const { group } = await seedCreatedGroup();
    const copy = await importCopyGroup();
    expect(copy.origin).toBe('received');

    const container = document.createElement('div');
    await renderHome(container);

    expect(container.querySelector('#main-group-card').innerHTML).toContain('Master copy');
    const otherRow = [...container.querySelectorAll('.group-row')].find((r) =>
      r.textContent.includes('Borrowed')
    );
    expect(otherRow.querySelector('.badge').textContent).toBe('Copy');
    expect(group.origin).toBe('created');
  });

  it('a legacy group with no origin shows as a copy until claimed in settings', async () => {
    const { group } = await seedCreatedGroup('Oldtimer');
    await db.groups.update(group.id, { origin: undefined });

    const container = document.createElement('div');
    await renderHome(container);
    expect(container.querySelector('#main-group-card').innerHTML).not.toContain('Master copy');
    expect(container.querySelector('#main-group-card .badge').textContent).toBe('Copy');

    let rerendered = false;
    openGroupSettingsModal(await getGroup(group.id), () => (rerendered = true));
    const overlay = document.getElementById('modal-overlay');
    expect(overlay.querySelector('#origin-toggle-btn').textContent).toContain('Mark as master copy');
    overlay.querySelector('#origin-toggle-btn').click();
    await new Promise((r) => setTimeout(r, 50));

    expect((await getGroup(group.id)).origin).toBe('created');
    expect(rerendered).toBe(true);
  });

  it('the share screen warns when broadcasting a copy, and stays quiet for the master', async () => {
    const { group } = await seedCreatedGroup();
    const copy = await importCopyGroup();

    const masterScreen = document.createElement('div');
    await renderShare(masterScreen, { groupId: group.id });
    expect(masterScreen.querySelector('#copy-warning')).toBeNull();

    const copyScreen = document.createElement('div');
    await renderShare(copyScreen, { groupId: copy.id });
    expect(copyScreen.querySelector('#copy-warning')?.textContent).toContain("You're sharing a copy");
  });
});
