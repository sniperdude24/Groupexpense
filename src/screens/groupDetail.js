import { getGroup, renameGroup, setGroupArchived } from '../repo/groups.js';
import { listMembersOfGroup } from '../repo/memberships.js';
import { createTrip } from '../repo/trips.js';
import { computeGroupBalance, computeGroupTripSummaries } from '../repo/queries.js';
import { listGroupLevelSettlements, deleteSettlement } from '../repo/settlements.js';
import { getMe, listPeople } from '../repo/people.js';
import { formatCents } from '../lib/money.js';
import { escapeHtml, toast, formatDate } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
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
  const trips = await computeGroupTripSummaries(groupId);
  trips.sort((a, b) => (b.trip.start_date || b.trip.settled_at || 0) - (a.trip.start_date || a.trip.settled_at || 0));

  const peopleById = new Map((await listPeople()).map((p) => [p.id, p]));

  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/">&larr;</a>
      <h1>${escapeHtml(group.name)}</h1>
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
                    return `<a class="row" href="#/trips/${trip.id}">
                      <div>
                        <div class="row-title">${escapeHtml(trip.name)}</div>
                        <div class="row-sub">
                          <span class="badge ${trip.status === 'settled' ? 'settled' : ''}">${trip.status}</span>
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
    openModal(`
      <h2>${escapeHtml(group.name)}</h2>
      <div class="field">
        <label for="rename-input">Rename group</label>
        <input id="rename-input" type="text" value="${escapeHtml(group.name)}" />
      </div>
      <div class="btn-row" style="margin-bottom:10px;">
        <button class="btn secondary" id="rename-save">Save name</button>
      </div>
      <button class="btn ghost" id="archive-btn">${group.archived ? 'Unarchive group' : 'Archive group'}</button>
    `);
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('#rename-save').addEventListener('click', async () => {
      const val = overlay.querySelector('#rename-input').value.trim();
      if (!val) return;
      await renameGroup(groupId, val);
      closeModal();
      render(container, { groupId });
    });
    overlay.querySelector('#archive-btn').addEventListener('click', async () => {
      await setGroupArchived(groupId, !group.archived);
      closeModal();
      toast(group.archived ? 'Group unarchived' : 'Group archived');
      navigate('/');
    });
  });
}
