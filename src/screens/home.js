import { listGroups, createGroup, pickMainGroup } from '../repo/groups.js';
import { createTrip, listTripsOfGroup, setTripOrder, sortTripsForDisplay } from '../repo/trips.js';
import { createPerson, getMe } from '../repo/people.js';
import { computeGroupBalance, computeGroupTripSummaries } from '../repo/queries.js';
import { listGroupLevelSettlements } from '../repo/settlements.js';
import { formatCents } from '../lib/money.js';
import { escapeHtml, toast, originBadge } from '../ui/helpers.js';
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

  const summaries = await computeGroupTripSummaries(main.id);
  const displayOrder = sortTripsForDisplay(summaries.map((s) => s.trip)).map((t) => t.id);
  summaries.sort((a, b) => displayOrder.indexOf(a.trip.id) - displayOrder.indexOf(b.trip.id));

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
          <div class="row-title" style="font-size:18px;">${escapeHtml(main.name)} ${originBadge(main)}</div>
          <div class="amount ${balanceClass(mine)}">${mine === 0 ? '' : formatCents(Math.abs(mine))}</div>
        </div>
        <div class="row-sub">${balanceLabel(mine)}${
          groupSettledCents > 0
            ? ` &middot; includes ${formatCents(groupSettledCents)} settled at group level`
            : ''
        }</div>
      </a>

      <div id="trips-section"></div>

      <details class="card" id="howto" ${summaries.length === 0 ? 'open' : ''}>
        <summary style="cursor:pointer; font-weight:600;">How to use Split</summary>
        <ol style="margin:10px 0 0; padding-left:20px; color:var(--text-dim); font-size:14px; line-height:1.6;">
          <li><strong>Start a trip</strong> with "+ New trip", then tap the &#128101; icon on it
            to add the people who are along.</li>
          <li><strong>Log expenses</strong> as they happen &mdash; pick who paid, uncheck anyone
            who sat one out, or type exact amounts for uneven splits. Balances update instantly.</li>
          <li><strong>Settle up</strong> shows the fewest payments that square everyone away.
            Record each one as it's actually paid &mdash; choose "Whole group" for a payment
            that isn't tied to one trip.</li>
          <li><strong>Mark settled</strong> locks a finished trip read-only;
            "Exclude from group balance" keeps a trip out of the group total without
            deleting anything.</li>
          <li><strong>Back up</strong> from Settings &mdash; share the backup link to your other
            device or keep the file somewhere safe. Your data lives only on this phone.</li>
        </ol>
      </details>

      ${
        others.length
          ? `<div>
              <div class="section-title" style="margin-bottom:8px;">Other groups</div>
              <div class="list">${others.map(groupRowHtml).join('')}</div>
            </div>`
          : ''
      }

      <div style="display:flex; justify-content:center; gap:18px; flex-wrap:wrap;">
        <a class="nav-link" href="#/receive">Receive a share</a>
        <a class="nav-link" href="#" id="new-group-link">New group</a>
        <a class="nav-link" href="#/archived">Archived groups</a>
      </div>
    </div>
    <div class="fab"><button class="btn" id="new-trip-btn">+ New trip</button></div>
  `;

  // The trips section re-renders in place when toggling reorder mode, so the
  // rest of the screen (and scroll position) stays put.
  let reorderMode = false;
  const tripsSection = container.querySelector('#trips-section');

  function tripRowBody(trip, tripNet) {
    const my = tripNet.get(me.id) || 0;
    const tripUnsettled = [...tripNet.values()].some((cents) => cents !== 0);
    const maybeCovered =
      groupSettledCents > 0 && trip.status === 'open' && tripUnsettled && !trip.excluded;
    return `
      <div>
        <div class="row-title">${escapeHtml(trip.name)}</div>
        <div class="row-sub">
          <span class="badge ${trip.status === 'settled' ? 'settled' : ''}">${trip.status}</span>
          ${trip.excluded ? '<span class="badge">excluded</span>' : ''}
          ${maybeCovered ? '<span class="covered-note">group payments may cover part of this</span>' : ''}
        </div>
      </div>
      <div class="amount ${balanceClass(my)}">${my === 0 ? '&mdash;' : formatCents(Math.abs(my))}</div>`;
  }

  function renderTrips() {
    tripsSection.innerHTML = `
      <div class="section-title" style="margin-bottom:8px; display:flex; align-items:baseline; justify-content:space-between; gap:8px;">
        <span>Trips</span>
        ${
          summaries.length > 1
            ? `<a href="#" id="reorder-toggle" style="font-size:13px; font-weight:400; text-transform:none; letter-spacing:normal; color:var(--accent); text-decoration:none;">${
                reorderMode ? 'Done' : 'Reorder'
              }</a>`
            : ''
        }
      </div>
      <div class="list" id="trip-list">
        ${
          summaries.length === 0
            ? '<p class="empty">No trips yet. Tap "New trip" to start one.</p>'
            : summaries
                .map(({ trip, net: tripNet }, i) =>
                  reorderMode
                    ? `<div class="row" style="cursor:default;">
                        <div style="display:flex; flex-direction:column; gap:2px; margin-right:10px;">
                          <button class="icon-btn move-up" data-i="${i}" ${i === 0 ? 'disabled' : ''} title="Move up">&#9650;</button>
                          <button class="icon-btn move-down" data-i="${i}" ${i === summaries.length - 1 ? 'disabled' : ''} title="Move down">&#9660;</button>
                        </div>
                        ${tripRowBody(trip, tripNet)}
                      </div>`
                    : `<a class="row" href="#/trips/${trip.id}">${tripRowBody(trip, tripNet)}</a>`
                )
                .join('')
        }
      </div>
    `;

    const toggle = tripsSection.querySelector('#reorder-toggle');
    if (toggle) {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        reorderMode = !reorderMode;
        renderTrips();
      });
    }

    const move = async (from, to) => {
      const [entry] = summaries.splice(from, 1);
      summaries.splice(to, 0, entry);
      // Persist the whole visible order; the array is already the truth.
      await setTripOrder(summaries.map((s) => s.trip.id));
      renderTrips();
    };
    tripsSection.querySelectorAll('.move-up').forEach((btn) => {
      btn.addEventListener('click', () => move(Number(btn.dataset.i), Number(btn.dataset.i) - 1));
    });
    tripsSection.querySelectorAll('.move-down').forEach((btn) => {
      btn.addEventListener('click', () => move(Number(btn.dataset.i), Number(btn.dataset.i) + 1));
    });
  }

  renderTrips();

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
