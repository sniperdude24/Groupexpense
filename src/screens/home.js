import { listGroups, createGroup } from '../repo/groups.js';
import { createTrip } from '../repo/trips.js';
import { createPerson, getMe } from '../repo/people.js';
import { computeGroupBalance } from '../repo/queries.js';
import { toast } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
import { groupRowHtml, wireGroupRowActions } from '../ui/groupRow.js';
import { navigate } from '../router.js';

async function renderOnboarding(container) {
  container.innerHTML = `
    <div class="topbar"><h1>Welcome</h1></div>
    <div class="screen">
      <div class="card">
        <p>Before you start tracking expenses, tell Split who you are. This name is used to show
          your balance across every group.</p>
        <div class="field">
          <label for="me-name">Your name</label>
          <input id="me-name" type="text" placeholder="e.g. David" autocomplete="off" />
        </div>
        <button class="btn" id="me-save">Get started</button>
      </div>
    </div>
  `;
  container.querySelector('#me-save').addEventListener('click', async () => {
    const input = container.querySelector('#me-name');
    const name = input.value.trim();
    if (!name) {
      input.focus();
      return;
    }
    await createPerson({ name, is_me: true });
    render(container);
  });
}

export async function render(container) {
  const me = await getMe();
  if (!me) {
    await renderOnboarding(container);
    return;
  }

  const groups = await listGroups();
  const rows = await Promise.all(
    groups.map(async (g) => {
      const { net } = await computeGroupBalance(g.id);
      const mine = net.get(me.id) || 0;
      return { group: g, mine };
    })
  );

  container.innerHTML = `
    <div class="topbar">
      <h1>Split</h1>
      <a class="nav-link" href="#/people">People</a>
      <a class="nav-link" href="#/settings" style="margin-left:12px;">Settings</a>
    </div>
    <div class="screen">
      ${
        rows.length === 0
          ? `<p class="empty">No groups yet. Tap "New group" to start tracking shared expenses.</p>`
          : `<div class="list">${rows.map(groupRowHtml).join('')}</div>`
      }
      <a class="nav-link" href="#/archived" style="text-align:center;">Archived groups</a>
    </div>
    <div class="fab"><button class="btn" id="new-group-btn">+ New group</button></div>
  `;

  wireGroupRowActions(container, () => render(container));

  container.querySelector('#new-group-btn').addEventListener('click', () => {
    openModal(`
      <h2>New group</h2>
      <div class="field">
        <label for="group-name">Group name</label>
        <input id="group-name" type="text" placeholder="e.g. Fishing crew" autocomplete="off" />
      </div>
      <div class="btn-row">
        <button class="btn secondary" id="group-cancel">Cancel</button>
        <button class="btn" id="group-create">Create</button>
      </div>
    `);
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('#group-cancel').addEventListener('click', closeModal);
    const nameInput = overlay.querySelector('#group-name');
    nameInput.focus();
    overlay.querySelector('#group-create').addEventListener('click', async () => {
      const name = nameInput.value.trim();
      if (!name) {
        nameInput.focus();
        return;
      }
      const group = await createGroup(name);
      await createTrip({ groupId: group.id, name });
      closeModal();
      toast('Group created — add people, then start adding expenses');
      navigate(`/groups/${group.id}/members`);
    });
  });
}
