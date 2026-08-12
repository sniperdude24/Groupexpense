import { getTrip } from '../repo/trips.js';
import { getGroup } from '../repo/groups.js';
import { listPeople } from '../repo/people.js';
import { computeTripBalance, computeGroupBalance } from '../repo/queries.js';
import { createSettlement } from '../repo/settlements.js';
import { parseAmountToCents, formatCents } from '../lib/money.js';
import { escapeHtml, toast, onActivate, submitOnEnter } from '../ui/helpers.js';
import { navigate } from '../router.js';

export async function render(container, { tripId, groupId }) {
  let scope, groupIdForSettlement, backPath, pairwise, simplified;

  // Which list the suggestions come from. Simplified is the default because
  // it is the answer to "what do we actually pay?" -- but it can suggest a
  // payment between two people who never shared an expense, so the raw
  // who-owes-whom view stays one tap away for anyone who wants to check.
  let mode = 'simplified';

  // The whole roster is selectable here, not just current members: a
  // settlement isn't membership-gated in the data model, and someone who
  // still owes money (or is owed) needs to stay reachable even after
  // leaving the group.
  const people = await listPeople();

  if (tripId) {
    const trip = await getTrip(tripId);
    if (!trip) {
      container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
      return;
    }
    groupIdForSettlement = trip.group_id;
    backPath = `/trips/${tripId}`;
    scope = { type: 'trip', tripId, label: trip.name };
    ({ pairwise, simplified } = await computeTripBalance(tripId));
  } else {
    const group = await getGroup(groupId);
    if (!group) {
      container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
      return;
    }
    groupIdForSettlement = groupId;
    backPath = `/groups/${groupId}`;
    scope = { type: 'group', groupId, label: group.name };
    ({ pairwise, simplified } = await computeGroupBalance(groupId));
  }

  const peopleById = new Map(people.map((p) => [p.id, p]));

  function renderForm(prefill) {
    const suggestions = mode === 'simplified' ? simplified : pairwise;
    const state = {
      fromPerson: prefill?.from || people[0]?.id,
      toPerson: prefill?.to || people[1]?.id || people[0]?.id,
      amountStr: prefill ? (prefill.amount_cents / 100).toFixed(2) : ''
    };

    const saved = pairwise.length - simplified.length;
    const blurb =
      mode === 'simplified'
        ? `Fewest payments that settle everyone up${saved > 0 ? ` &mdash; ${saved} fewer than paying each debt directly` : ''}.`
        : 'Every debt exactly as it was incurred, before simplifying.';

    container.innerHTML = `
      <div class="topbar">
        <a class="back-btn" href="#${backPath}">&larr;</a>
        <h1>Settle up</h1>
      </div>
      <div class="screen">
        <p style="color:var(--text-dim); font-size:13px; margin:0;">Recording at ${scope.type} level: ${escapeHtml(scope.label)}</p>

        ${
          suggestions.length
            ? `<div>
                <div class="section-title" style="margin-bottom:8px; display:flex; align-items:baseline; justify-content:space-between; gap:8px;">
                  <span>${mode === 'simplified' ? 'Suggested' : 'Who owes whom'}</span>
                  <a href="#" id="toggle-mode" style="font-size:13px; font-weight:400; text-transform:none; letter-spacing:normal; color:var(--accent); text-decoration:none; white-space:nowrap;">${
                    mode === 'simplified' ? 'Show who owes whom' : 'Show fewest payments'
                  }</a>
                </div>
                <p style="color:var(--text-dim); font-size:13px; margin:0 0 8px;">${blurb}</p>
                <div class="list">
                  ${suggestions
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
        renderForm(suggestions[Number(row.dataset.i)]);
      });
    });

    const toggle = container.querySelector('#toggle-mode');
    if (toggle) {
      toggle.addEventListener('click', (e) => {
        e.preventDefault();
        mode = mode === 'simplified' ? 'pairwise' : 'simplified';
        // Re-prefill from the newly shown list rather than keeping a payment
        // the user can no longer see in front of them.
        renderForm((mode === 'simplified' ? simplified : pairwise)[0]);
      });
    }

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
    submitOnEnter(container.querySelector('#s-save'), container.querySelector('#s-amount'));
  }

  renderForm(simplified[0]);
}
