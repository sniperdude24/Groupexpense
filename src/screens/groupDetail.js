import { getGroup } from '../repo/groups.js';
import { listMembersOfGroup } from '../repo/memberships.js';
import { createTrip, sortTripsForDisplay } from '../repo/trips.js';
import { computeGroupBalance, computeGroupTripSummaries } from '../repo/queries.js';
import { listGroupLevelSettlements, deleteSettlement } from '../repo/settlements.js';
import { getMe, listPeople } from '../repo/people.js';
import { formatCents } from '../lib/money.js';
import { escapeHtml, toast, formatDate, originBadge } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
import { openGroupSettingsModal } from '../ui/groupSettingsModal.js';
import { navigate } from '../router.js';

function balanceClass(cents) {
  if (cents > 0) return 'positive';
  if (cents < 0) return 'negative';
  return 'zero';
}

export async function render(container, { groupId }) {
  const group = await getGroup(groupId);
  if (!group) {
    container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
    return;
  }

  const me = await getMe();
  const members = await listMembersOfGroup(groupId);
  const { net } = await computeGroupBalance(groupId);
  const settlements = await listGroupLevelSettlements(groupId);
  settlements.sort((a, b) => b.settled_at - a.settled_at);
  // A group-level payment is deliberately never allocated across trips (see
  // the spec's scope rules), so the trips it covered keep their own non-zero
  // balances. These two labels are how that stays legible instead of looking
  // like a bookkeeping error: the group says how much was settled at its
  // level, and each still-open trip says its numbers may already be covered.
  const groupSettledCents = settlements.reduce((sum, s) => sum + s.amount_cents, 0);
  const trips = await computeGroupTripSummaries(groupId);
  const displayOrder = sortTripsForDisplay(trips.map((s) => s.trip)).map((t) => t.id);
  trips.sort((a, b) => displayOrder.indexOf(a.trip.id) - displayOrder.indexOf(b.trip.id));

  const peopleById = new Map((await listPeople()).map((p) => [p.id, p]));

  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/">&larr;</a>
      <h1>${escapeHtml(group.name)} ${originBadge(group)}</h1>
      <button class="icon-btn" id="group-menu">&#8942;</button>
    </div>
    <div class="screen">
      <div class="card">
        <div class="section-title" style="margin-bottom:10px;">Group balance</div>
        <div class="list">
          ${[...net.entries()]
            .filter(([, cents]) => cents !== 0)
            .map(([personId, cents]) => {
              const person = peopleById.get(personId);
              const name = person ? person.name : 'Unknown';
              return `<div class="split-row">
                <div class="name">${escapeHtml(name)}${personId === me?.id ? ' (you)' : ''}</div>
                <div class="amount ${balanceClass(cents)}">${formatCents(Math.abs(cents))} ${cents > 0 ? 'owed' : 'owes'}</div>
              </div>`;
            })
            .join('') || '<p class="empty" style="padding:8px 0;">Everyone is settled up.</p>'}
        </div>
        ${
          groupSettledCents > 0
            ? `<p id="group-settled-note" style="color:var(--text-dim); font-size:12px; margin:10px 0 0;">
                Includes ${formatCents(groupSettledCents)} settled at group level.
              </p>`
            : ''
        }
        <div style="margin-top:14px;">
          <button class="btn secondary" id="group-settle">Settle up</button>
        </div>
      </div>

      <div>
        <div class="section-title" style="margin-bottom:8px;">Payments</div>
        <div class="list">
          ${
            settlements.length === 0
              ? '<p class="empty">No group-level payments recorded yet.</p>'
              : settlements
                  .map((s) => {
                    const from = peopleById.get(s.from_person);
                    const to = peopleById.get(s.to_person);
                    return `<div class="row" style="cursor:default;">
                      <div>
                        <div class="row-title">${from ? escapeHtml(from.name) : 'Unknown'} &rarr; ${to ? escapeHtml(to.name) : 'Unknown'}</div>
                        <div class="row-sub">${formatDate(s.settled_at)}</div>
                      </div>
                      <div style="display:flex; align-items:center; gap:10px;">
                        <div class="amount">${formatCents(s.amount_cents)}</div>
                        <button class="icon-btn delete-settlement" data-id="${s.id}">&#128465;</button>
                      </div>
                    </div>`;
                  })
                  .join('')
          }
        </div>
      </div>

      <div>
        <div class="section-title" style="margin-bottom:8px;">Members</div>
        <div class="list">
          ${members
            .map(
              (m) => `<div class="row" style="cursor:default;">
                <div>
                  <div class="row-title">${escapeHtml(m.person.name)}${m.person.id === me?.id ? ' (you)' : ''}</div>
                  ${m.person.note ? `<div class="row-sub">${escapeHtml(m.person.note)}</div>` : ''}
                </div>
              </div>`
            )
            .join('') || '<p class="empty">No members yet.</p>'}
        </div>
        <div style="margin-top:10px;">
          <button class="btn ghost" id="manage-members">Manage members</button>
        </div>
      </div>

      <div>
        <div class="section-title" style="margin-bottom:8px;">Trips</div>
        <div class="list">
          ${
            trips.length === 0
              ? '<p class="empty">No trips yet.</p>'
              : trips
                  .map(({ trip, net: tripNet }) => {
                    const mine = tripNet.get(me?.id) || 0;
                    const tripUnsettled = [...tripNet.values()].some((cents) => cents !== 0);
                    const maybeCovered =
                      groupSettledCents > 0 && trip.status === 'open' && tripUnsettled && !trip.excluded;
                    return `<a class="row" href="#/trips/${trip.id}">
                      <div>
                        <div class="row-title">${escapeHtml(trip.name)}</div>
                        <div class="row-sub">
                          <span class="badge ${trip.status === 'settled' ? 'settled' : ''}">${trip.status}</span>
                          ${trip.excluded ? '<span class="badge">excluded</span>' : ''}
                          ${maybeCovered ? '<span class="covered-note">group payments may cover part of this</span>' : ''}
                        </div>
                      </div>
                      <div class="amount ${balanceClass(mine)}">${mine === 0 ? '—' : formatCents(Math.abs(mine))}</div>
                    </a>`;
                  })
                  .join('')
          }
        </div>
      </div>
    </div>
    <div class="fab"><button class="btn" id="add-trip-btn">+ Add trip</button></div>
  `;

  container.querySelector('#manage-members').addEventListener('click', () => navigate(`/groups/${groupId}/members`));
  container.querySelector('#group-settle').addEventListener('click', () => navigate(`/groups/${groupId}/settle`));

  container.querySelectorAll('.delete-settlement').forEach((btn) => {
    btn.addEventListener('click', () => {
      openModal(`
        <h2>Delete this payment?</h2>
        <p style="color:var(--text-dim); font-size:14px;">
          This undoes the payment. Balances update immediately. This can't be undone.
        </p>
        <div class="btn-row">
          <button class="btn secondary" id="del-settlement-cancel">Cancel</button>
          <button class="btn danger" id="del-settlement-confirm">Delete</button>
        </div>
      `);
      const overlay = document.getElementById('modal-overlay');
      overlay.querySelector('#del-settlement-cancel').addEventListener('click', closeModal);
      overlay.querySelector('#del-settlement-confirm').addEventListener('click', async () => {
        try {
          await deleteSettlement(btn.dataset.id);
          closeModal();
          toast('Payment deleted');
          render(container, { groupId });
        } catch (err) {
          closeModal();
          toast(err.message || 'Could not delete payment');
        }
      });
    });
  });

  container.querySelector('#add-trip-btn').addEventListener('click', () => {
    openModal(`
      <h2>Add trip</h2>
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
  });

  container.querySelector('#group-menu').addEventListener('click', () => {
    openGroupSettingsModal(group, () => render(container, { groupId }));
  });
}
