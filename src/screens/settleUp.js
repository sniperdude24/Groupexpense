import { getTrip } from '../repo/trips.js';
import { getGroup } from '../repo/groups.js';
import { listMembersOfGroup } from '../repo/memberships.js';
import { computeTripBalance, computeGroupBalance } from '../repo/queries.js';
import { createSettlement } from '../repo/settlements.js';
import { parseAmountToCents, formatCents } from '../lib/money.js';
import { escapeHtml, toast, onActivate } from '../ui/helpers.js';
import { navigate } from '../router.js';

export async function render(container, { tripId, groupId }) {
  let scope, groupIdForSettlement, backPath, people, pairwise;

  if (tripId) {
    const trip = await getTrip(tripId);
    if (!trip) {
      container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
      return;
    }
    const members = await listMembersOfGroup(trip.group_id);
    people = members.map((m) => m.person);
    groupIdForSettlement = trip.group_id;
    backPath = `/trips/${tripId}`;
    scope = { type: 'trip', tripId, label: trip.name };
    ({ pairwise } = await computeTripBalance(tripId));
  } else {
    const group = await getGroup(groupId);
    if (!group) {
      container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
      return;
    }
    const members = await listMembersOfGroup(groupId);
    people = members.map((m) => m.person);
    groupIdForSettlement = groupId;
    backPath = `/groups/${groupId}`;
    scope = { type: 'group', groupId, label: group.name };
    ({ pairwise } = await computeGroupBalance(groupId));
  }

  const peopleById = new Map(people.map((p) => [p.id, p]));

  function renderForm(prefill) {
    const state = {
      fromPerson: prefill?.from || people[0]?.id,
      toPerson: prefill?.to || people[1]?.id || people[0]?.id,
      amountStr: prefill ? (prefill.amount_cents / 100).toFixed(2) : ''
    };

    container.innerHTML = `
      <div class="topbar">
        <a class="back-btn" href="#${backPath}">&larr;</a>
        <h1>Settle up</h1>
      </div>
      <div class="screen">
        <p style="color:var(--text-dim); font-size:13px; margin:0;">Recording at ${scope.type} level: ${escapeHtml(scope.label)}</p>

        ${
          pairwise.length
            ? `<div>
                <div class="section-title" style="margin-bottom:8px;">Suggested</div>
                <div class="list">
                  ${pairwise
                    .map((b, i) => {
                      const from = peopleById.get(b.from);
                      const to = peopleById.get(b.to);
                      return `<div class="row suggestion" data-i="${i}" role="button" tabindex="0">
                        <div class="row-title">${from ? escapeHtml(from.name) : '?'} &rarr; ${to ? escapeHtml(to.name) : '?'}</div>
                        <div class="amount">${formatCents(b.amount_cents)}</div>
                      </div>`;
                    })
                    .join('')}
                </div>
              </div>`
            : '<p class="empty">No outstanding balances in this scope.</p>'
        }

        <div class="card">
          <div class="field">
            <label for="s-from">From</label>
            <select id="s-from">
              ${people.map((p) => `<option value="${p.id}" ${p.id === state.fromPerson ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="s-to">To</label>
            <select id="s-to">
              ${people.map((p) => `<option value="${p.id}" ${p.id === state.toPerson ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
            </select>
          </div>
          <div class="field">
            <label for="s-amount">Amount</label>
            <input id="s-amount" type="text" inputmode="decimal" placeholder="0.00" value="${state.amountStr}" />
          </div>
          <button class="btn" id="s-save">Record payment</button>
        </div>
      </div>
    `;

    container.querySelectorAll('.suggestion').forEach((row) => {
      onActivate(row, () => {
        const b = pairwise[Number(row.dataset.i)];
        renderForm(b);
      });
    });

    container.querySelector('#s-from').addEventListener('change', (e) => {
      state.fromPerson = e.target.value;
    });
    container.querySelector('#s-to').addEventListener('change', (e) => {
      state.toPerson = e.target.value;
    });
    container.querySelector('#s-amount').addEventListener('input', (e) => {
      state.amountStr = e.target.value;
    });

    container.querySelector('#s-save').addEventListener('click', async () => {
      const amountCents = parseAmountToCents(state.amountStr);
      if (!amountCents || amountCents <= 0) {
        toast('Enter a valid amount');
        return;
      }
      if (state.fromPerson === state.toPerson) {
        toast('Pick two different people');
        return;
      }
      try {
        await createSettlement({
          groupId: groupIdForSettlement,
          tripId: scope.type === 'trip' ? scope.tripId : null,
          fromPerson: state.fromPerson,
          toPerson: state.toPerson,
          amountCents
        });
        toast('Payment recorded');
        navigate(backPath);
      } catch (err) {
        toast(err.message || 'Could not record payment');
      }
    });
  }

  renderForm(pairwise[0]);
}
