import { getTrip, settleTrip, reopenTrip } from '../repo/trips.js';
import { getGroup } from '../repo/groups.js';
import { listMembersOfGroup } from '../repo/memberships.js';
import { listExpensesOfTrip, deleteExpense } from '../repo/expenses.js';
import { computeTripBalance } from '../repo/queries.js';
import { getMe } from '../repo/people.js';
import { formatCents } from '../lib/money.js';
import { escapeHtml, formatDate, toast } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
import { navigate } from '../router.js';

function balanceClass(cents) {
  if (cents > 0) return 'positive';
  if (cents < 0) return 'negative';
  return 'zero';
}

export async function render(container, { tripId }) {
  const trip = await getTrip(tripId);
  if (!trip) {
    container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
    return;
  }
  const group = await getGroup(trip.group_id);
  const members = await listMembersOfGroup(trip.group_id);
  const peopleById = new Map(members.map((m) => [m.person.id, m.person]));
  const me = await getMe();

  const expenses = await listExpensesOfTrip(tripId);
  expenses.sort((a, b) => b.spent_at - a.spent_at);
  const { net } = await computeTripBalance(tripId);
  const settled = trip.status === 'settled';

  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/groups/${group.id}">&larr;</a>
      <h1>${escapeHtml(trip.name)}</h1>
    </div>
    <div class="screen">
      ${
        settled
          ? `<div class="settled-banner">This trip is settled and read-only.
              <button class="btn ghost" id="reopen-btn" style="margin-top:10px; width:100%;">Reopen trip</button>
            </div>`
          : ''
      }

      <div class="card">
        <div class="section-title" style="margin-bottom:10px;">Trip balance</div>
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
        <div class="btn-row" style="margin-top:14px;">
          <button class="btn secondary" id="settle-up-btn">Settle up</button>
          ${!settled ? '<button class="btn ghost" id="mark-settled-btn">Mark settled</button>' : ''}
        </div>
      </div>

      <div>
        <div class="section-title" style="margin-bottom:8px;">Expenses</div>
        <div class="list">
          ${
            expenses.length === 0
              ? '<p class="empty">No expenses yet.</p>'
              : expenses
                  .map((e) => {
                    const payer = peopleById.get(e.payer_id);
                    return `<a class="row expense-row" href="#/trips/${tripId}/expenses/${e.id}/edit">
                      <div class="meta">
                        <div class="desc">${escapeHtml(e.description)}</div>
                        <div class="sub">${payer ? escapeHtml(payer.name) : 'Unknown'} paid &middot; ${formatDate(e.spent_at)}${e.category ? ' &middot; ' + escapeHtml(e.category) : ''}</div>
                      </div>
                      <div class="amount">${formatCents(e.amount_cents)}</div>
                    </a>`;
                  })
                  .join('')
          }
        </div>
      </div>
    </div>
    ${!settled ? `<div class="fab"><button class="btn" id="add-expense-btn">+ Add expense</button></div>` : ''}
  `;

  container.querySelector('#settle-up-btn').addEventListener('click', () => navigate(`/trips/${tripId}/settle`));

  const addBtn = container.querySelector('#add-expense-btn');
  if (addBtn) addBtn.addEventListener('click', () => navigate(`/trips/${tripId}/expenses/new`));

  const markSettledBtn = container.querySelector('#mark-settled-btn');
  if (markSettledBtn) {
    markSettledBtn.addEventListener('click', () => {
      openModal(`
        <h2>Mark trip as settled?</h2>
        <p style="color:var(--text-dim); font-size:14px;">
          The trip becomes read-only — no more expenses can be added or edited until you reopen it.
        </p>
        <div class="btn-row">
          <button class="btn secondary" id="settle-cancel">Cancel</button>
          <button class="btn" id="settle-confirm">Mark settled</button>
        </div>
      `);
      const overlay = document.getElementById('modal-overlay');
      overlay.querySelector('#settle-cancel').addEventListener('click', closeModal);
      overlay.querySelector('#settle-confirm').addEventListener('click', async () => {
        await settleTrip(tripId);
        closeModal();
        toast('Trip settled');
        render(container, { tripId });
      });
    });
  }

  const reopenBtn = container.querySelector('#reopen-btn');
  if (reopenBtn) {
    reopenBtn.addEventListener('click', () => {
      openModal(`
        <h2>Reopen this trip?</h2>
        <p style="color:var(--text-dim); font-size:14px;">
          This invalidates the completed settlement. Balances may no longer match payments
          people already made against this trip.
        </p>
        <div class="btn-row">
          <button class="btn secondary" id="reopen-cancel">Cancel</button>
          <button class="btn danger" id="reopen-confirm">Reopen</button>
        </div>
      `);
      const overlay = document.getElementById('modal-overlay');
      overlay.querySelector('#reopen-cancel').addEventListener('click', closeModal);
      overlay.querySelector('#reopen-confirm').addEventListener('click', async () => {
        await reopenTrip(tripId);
        closeModal();
        toast('Trip reopened');
        render(container, { tripId });
      });
    });
  }
}
