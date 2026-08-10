import { listGroups, createGroup, pickMainGroup } from '../repo/groups.js';
import { createTrip, listTripsOfGroup } from '../repo/trips.js';
import { createPerson, getMe } from '../repo/people.js';
import { computeGroupBalance, computeGroupTripSummaries } from '../repo/queries.js';
import { listGroupLevelSettlements } from '../repo/settlements.js';
import { formatCents } from '../lib/money.js';
import { escapeHtml, toast } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
import { groupRowHtml, wireGroupRowActions, balanceClass, balanceLabel } from '../ui/groupRow.js';
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

function addTripModal(groupId) {
  openModal(`
    <h2>New trip</h2>
    <div class="field">
      <label for="trip-name">Trip name</label>
      <input id="trip-name" type="text" placeholder="e.g. Ski trip 2026" autocomplete="off" />
    </div>
    <div class="btn-row">
      <button class="btn secondary" id="trip-cancel">Cancel</button>
      <button class="btn" id="trip-create">Create</button>
    </div>
  `);
  const overlay = document.getElementById('modal-overlay');
  overlay.querySelector('#trip-cancel').addEventListener('click', closeModal);
  const nameInput = overlay.querySelector('#trip-name');
  nameInput.focus();
  overlay.querySelector('#trip-create').addEventListener('click', async () => {
    const name = nameInput.value.trim();
    if (!name) {
      nameInput.focus();
      return;
    }
    const trip = await createTrip({ groupId, name });
    closeModal();
    navigate(`/trips/${trip.id}`);
  });
}

export async function render(container) {
  const me = await getMe();
  if (!me) {
    await renderOnboarding(container);
    return;
  }

  const groups = await listGroups();
  const main = pickMainGroup(groups);

  // No groups at all: first-run state. The first group created becomes main.
  if (!main) {
    container.innerHTML = `
      <div class="topbar">
        <h1>Split</h1>
        <a class="nav-link" href="#/people">People</a>
        <a class="nav-link" href="#/settings" style="margin-left:12px;">Settings</a>
      </div>
      <div class="screen">
        <p class="empty">No group yet. Tap "New group" to start tracking shared expenses.</p>
        <a class="nav-link" href="#/archived" style="text-align:center;">Archived groups</a>
      </div>
      <div class="fab"><button class="btn" id="new-group-btn">+ New group</button></div>
    `;
    wireNewGroup(container);
    return;
  }

  const { net } = await computeGroupBalance(main.id);
  const mine = net.get(me.id) || 0;
  const groupSettledCents = (await listGroupLevelSettlements(main.id))
    .reduce((sum, s) => sum + s.amount_cents, 0);

  const trips = await computeGroupTripSummaries(main.id);
  trips.sort(
    (a, b) =>
      (b.trip.start_date || b.trip.settled_at || 0) - (a.trip.start_date || a.trip.settled_at || 0)
  );

  // Any other groups keep working exactly as before, in their own section.
  const others = await Promise.all(
    groups
      .filter((g) => g.id !== main.id)
      .map(async (g) => {
        const { net: gNet } = await computeGroupBalance(g.id);
        const gTrips = await listTripsOfGroup(g.id);
        return {
          group: g,
          mine: gNet.get(me.id) || 0,
          linkTo: gTrips.length === 1 ? `/trips/${gTrips[0].id}` : `/groups/${g.id}`
        };
      })
  );

  container.innerHTML = `
    <div class="topbar">
      <h1>Split</h1>
      <a class="nav-link" href="#/people">People</a>
      <a class="nav-link" href="#/settings" style="margin-left:12px;">Settings</a>
    </div>
    <div class="screen">
      <a class="card" id="main-group-card" href="#/groups/${main.id}"
        style="display:block; text-decoration:none; color:inherit;">
        <div class="section-title" style="margin-bottom:6px;">Main group</div>
        <div style="display:flex; align-items:baseline; justify-content:space-between; gap:10px;">
          <div class="row-title" style="font-size:18px;">${escapeHtml(main.name)}</div>
          <div class="amount ${balanceClass(mine)}">${mine === 0 ? '' : formatCents(Math.abs(mine))}</div>
        </div>
        <div class="row-sub">${balanceLabel(mine)}${
          groupSettledCents > 0
            ? ` &middot; includes ${formatCents(groupSettledCents)} settled at group level`
            : ''
        }</div>
      </a>

      <div>
        <div class="section-title" style="margin-bottom:8px;">Trips</div>
        <div class="list" id="trip-list">
          ${
            trips.length === 0
              ? '<p class="empty">No trips yet. Tap "New trip" to start one.</p>'
              : trips
                  .map(({ trip, net: tripNet }) => {
                    const my = tripNet.get(me.id) || 0;
                    const tripUnsettled = [...tripNet.values()].some((cents) => cents !== 0);
                    const maybeCovered =
                      groupSettledCents > 0 && trip.status === 'open' && tripUnsettled;
                    return `<a class="row" href="#/trips/${trip.id}">
                      <div>
                        <div class="row-title">${escapeHtml(trip.name)}</div>
                        <div class="row-sub">
                          <span class="badge ${trip.status === 'settled' ? 'settled' : ''}">${trip.status}</span>
                          ${maybeCovered ? '<span class="covered-note">group payments may cover part of this</span>' : ''}
                        </div>
                      </div>
                      <div class="amount ${balanceClass(my)}">${my === 0 ? '&mdash;' : formatCents(Math.abs(my))}</div>
                    </a>`;
                  })
                  .join('')
          }
        </div>
      </div>

      ${
        others.length
          ? `<div>
              <div class="section-title" style="margin-bottom:8px;">Other groups</div>
              <div class="list">${others.map(groupRowHtml).join('')}</div>
            </div>`
          : ''
      }

      <div style="display:flex; justify-content:center; gap:18px;">
        <a class="nav-link" href="#" id="new-group-link">New group</a>
        <a class="nav-link" href="#/archived">Archived groups</a>
      </div>
    </div>
    <div class="fab"><button class="btn" id="new-trip-btn">+ New trip</button></div>
  `;

  wireGroupRowActions(container, () => render(container));
  container.querySelector('#new-trip-btn').addEventListener('click', () => addTripModal(main.id));
  container.querySelector('#new-group-link').addEventListener('click', (e) => {
    e.preventDefault();
    wireNewGroupModal(container);
  });
}

function wireNewGroup(container) {
  container.querySelector('#new-group-btn').addEventListener('click', () => {
    wireNewGroupModal(container);
  });
}

function wireNewGroupModal(container) {
  openModal(`
    <h2>New group</h2>
    <p style="color:var(--text-dim); font-size:13px; margin-top:-6px;">
      A separate group has its own people and its own trips &mdash; use it for a
      different circle, not for the next trip with this one.
    </p>
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
}
