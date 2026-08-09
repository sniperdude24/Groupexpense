import { getTrip } from '../repo/trips.js';
import { getGroup } from '../repo/groups.js';
import { listMembersOfGroup } from '../repo/memberships.js';
import { createExpense, updateExpense, deleteExpense, getExpenseWithSplits } from '../repo/expenses.js';
import { computeEvenSplit } from '../lib/splits.js';
import { parseAmountToCents, formatCents } from '../lib/money.js';
import { escapeHtml, toast } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
import { navigate } from '../router.js';

function dateInputValue(ms) {
  const d = ms ? new Date(ms) : new Date();
  return d.toISOString().slice(0, 10);
}

function dateStringToMs(str) {
  if (!str) return Date.now();
  const [y, m, d] = str.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0).getTime();
}

export async function render(container, { tripId, expenseId }) {
  const trip = await getTrip(tripId);
  if (!trip) {
    container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
    return;
  }
  const group = await getGroup(trip.group_id);
  const members = await listMembersOfGroup(trip.group_id);
  const people = members.map((m) => m.person);

  let existing = null;
  if (expenseId) {
    existing = await getExpenseWithSplits(expenseId);
  }

  if (trip.status === 'settled') {
    renderReadOnly(container, { trip, group, people, existing });
    return;
  }

  const state = {
    amountCents: existing ? existing.expense.amount_cents : 0,
    description: existing ? existing.expense.description : '',
    category: existing ? existing.expense.category || '' : '',
    payerId: existing ? existing.expense.payer_id : people[0]?.id,
    spentAtStr: dateInputValue(existing ? existing.expense.spent_at : Date.now()),
    participants: people.map((p) => {
      const split = existing ? existing.splits.find((s) => s.person_id === p.id) : null;
      return {
        person_id: p.id,
        name: p.name,
        included: existing ? Boolean(split) : true,
        dirty: existing ? Boolean(split) : false,
        shareCents: split ? split.share_cents : 0
      };
    })
  };

  function recompute() {
    const totalDirty = state.participants
      .filter((p) => p.included && p.dirty)
      .reduce((s, p) => s + p.shareCents, 0);
    const nonDirtyIncluded = state.participants.filter((p) => p.included && !p.dirty);
    const remainderForEven = state.amountCents - totalDirty;

    state.participants.forEach((p) => {
      if (!p.included) {
        p.shareCents = 0;
      }
    });

    if (nonDirtyIncluded.length > 0) {
      if (remainderForEven >= 0) {
        const evenSplits = computeEvenSplit(
          remainderForEven,
          nonDirtyIncluded.map((p) => p.person_id)
        );
        const byId = new Map(evenSplits.map((s) => [s.person_id, s.share_cents]));
        nonDirtyIncluded.forEach((p) => {
          p.shareCents = byId.get(p.person_id) || 0;
        });
      } else {
        nonDirtyIncluded.forEach((p) => {
          p.shareCents = 0;
        });
      }
    }

    const allocated = state.participants.filter((p) => p.included).reduce((s, p) => s + p.shareCents, 0);
    return state.amountCents - allocated;
  }

  function renderForm() {
    const remaining = recompute();
    const canSave =
      state.amountCents > 0 &&
      state.description.trim() &&
      state.payerId &&
      remaining === 0 &&
      state.participants.some((p) => p.included);

    container.innerHTML = `
      <div class="topbar">
        <a class="back-btn" href="#/trips/${tripId}">&larr;</a>
        <h1>${existing ? 'Edit expense' : 'Add expense'}</h1>
        ${existing ? '<button class="icon-btn" id="delete-expense">&#128465;</button>' : ''}
      </div>
      <div class="screen">
        <div class="field">
          <label for="f-description">Description</label>
          <input id="f-description" type="text" value="${escapeHtml(state.description)}" placeholder="e.g. Dinner" autocomplete="off" />
        </div>
        <div class="field">
          <label for="f-amount">Amount</label>
          <input id="f-amount" type="text" inputmode="decimal" value="${state.amountCents ? (state.amountCents / 100).toFixed(2) : ''}" placeholder="0.00" />
        </div>
        <div class="field">
          <label for="f-payer">Paid by</label>
          <select id="f-payer">
            ${people.map((p) => `<option value="${p.id}" ${p.id === state.payerId ? 'selected' : ''}>${escapeHtml(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="field">
          <label for="f-date">Date</label>
          <input id="f-date" type="date" value="${state.spentAtStr}" />
        </div>
        <div class="field">
          <label for="f-category">Category (optional)</label>
          <input id="f-category" type="text" value="${escapeHtml(state.category)}" placeholder="e.g. Food" autocomplete="off" />
        </div>

        <div>
          <div class="section-title" style="margin-bottom:8px;">Split</div>
          <div class="card">
            ${state.participants
              .map(
                (p) => `<div class="split-row">
                  <label class="checkbox-row" style="flex:1;">
                    <input type="checkbox" class="p-include" data-person="${p.person_id}" ${p.included ? 'checked' : ''} />
                    <span class="name">${escapeHtml(p.name)}</span>
                  </label>
                  <input type="text" inputmode="decimal" class="p-amount" data-person="${p.person_id}"
                    value="${p.included ? (p.shareCents / 100).toFixed(2) : ''}" ${p.included ? '' : 'disabled'} />
                </div>`
              )
              .join('')}
          </div>
          <div class="remaining-bar ${remaining === 0 ? 'balanced' : 'off'}" style="margin-top:10px;">
            <span>Remaining to allocate</span>
            <strong>${formatCents(remaining)}</strong>
          </div>
        </div>

        <button class="btn" id="save-expense" ${canSave ? '' : 'disabled'}>${existing ? 'Save changes' : 'Add expense'}</button>
      </div>
    `;

    container.querySelector('#f-description').addEventListener('input', (e) => {
      state.description = e.target.value;
      container.querySelector('#save-expense').disabled = !(
        state.amountCents > 0 &&
        state.description.trim() &&
        recompute() === 0 &&
        state.participants.some((p) => p.included)
      );
    });

    container.querySelector('#f-amount').addEventListener('input', (e) => {
      const cents = parseAmountToCents(e.target.value);
      state.amountCents = cents ?? 0;
      renderForm();
      const val = container.querySelector('#f-amount');
      val.focus();
      val.selectionStart = val.selectionEnd = val.value.length;
    });

    container.querySelector('#f-payer').addEventListener('change', (e) => {
      state.payerId = e.target.value;
    });

    container.querySelector('#f-date').addEventListener('change', (e) => {
      state.spentAtStr = e.target.value;
    });

    container.querySelector('#f-category').addEventListener('input', (e) => {
      state.category = e.target.value;
    });

    container.querySelectorAll('.p-include').forEach((cb) => {
      cb.addEventListener('change', (e) => {
        const p = state.participants.find((x) => x.person_id === e.target.dataset.person);
        p.included = e.target.checked;
        if (!p.included) p.dirty = false;
        renderForm();
      });
    });

    container.querySelectorAll('.p-amount').forEach((inp) => {
      inp.addEventListener('input', (e) => {
        const p = state.participants.find((x) => x.person_id === e.target.dataset.person);
        const cents = parseAmountToCents(e.target.value);
        p.dirty = true;
        p.shareCents = cents ?? 0;
        recompute();
        const remainingNow =
          state.amountCents - state.participants.filter((x) => x.included).reduce((s, x) => s + x.shareCents, 0);
        const bar = container.querySelector('.remaining-bar');
        bar.className = `remaining-bar ${remainingNow === 0 ? 'balanced' : 'off'}`;
        bar.querySelector('strong').textContent = formatCents(remainingNow);
        container.querySelector('#save-expense').disabled = !(
          state.amountCents > 0 &&
          state.description.trim() &&
          remainingNow === 0 &&
          state.participants.some((x) => x.included)
        );
        container.querySelectorAll('.p-amount').forEach((otherInp) => {
          if (otherInp === e.target) return;
          const other = state.participants.find((x) => x.person_id === otherInp.dataset.person);
          if (other.included && !other.dirty) {
            otherInp.value = (other.shareCents / 100).toFixed(2);
          }
        });
      });
    });

    container.querySelector('#save-expense').addEventListener('click', async () => {
      recompute();
      const splits = state.participants
        .filter((p) => p.included)
        .map((p) => ({ person_id: p.person_id, share_cents: p.shareCents }));
      const payload = {
        tripId,
        payerId: state.payerId,
        amountCents: state.amountCents,
        description: state.description.trim(),
        category: state.category.trim() || null,
        spentAt: dateStringToMs(state.spentAtStr),
        splits
      };
      try {
        if (existing) {
          await updateExpense(existing.expense.id, payload);
          toast('Expense updated');
        } else {
          await createExpense(payload);
          toast('Expense added');
        }
        navigate(`/trips/${tripId}`);
      } catch (err) {
        toast(err.message || 'Could not save expense');
      }
    });

    const deleteBtn = container.querySelector('#delete-expense');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        openModal(`
          <h2>Delete this expense?</h2>
          <p style="color:var(--text-dim); font-size:14px;">This can't be undone.</p>
          <div class="btn-row">
            <button class="btn secondary" id="del-cancel">Cancel</button>
            <button class="btn danger" id="del-confirm">Delete</button>
          </div>
        `);
        const overlay = document.getElementById('modal-overlay');
        overlay.querySelector('#del-cancel').addEventListener('click', closeModal);
        overlay.querySelector('#del-confirm').addEventListener('click', async () => {
          await deleteExpense(existing.expense.id);
          closeModal();
          toast('Expense deleted');
          navigate(`/trips/${tripId}`);
        });
      });
    }
  }

  renderForm();
}

function renderReadOnly(container, { trip, group, people, existing }) {
  const peopleById = new Map(people.map((p) => [p.id, p]));
  if (!existing) {
    container.innerHTML = `
      <div class="topbar"><a class="back-btn" href="#/trips/${trip.id}">&larr;</a><h1>Trip settled</h1></div>
      <div class="screen"><p class="empty">This trip is settled. Reopen it from the trip page to add expenses.</p></div>
    `;
    return;
  }
  const payer = peopleById.get(existing.expense.payer_id);
  container.innerHTML = `
    <div class="topbar"><a class="back-btn" href="#/trips/${trip.id}">&larr;</a><h1>${escapeHtml(existing.expense.description)}</h1></div>
    <div class="screen">
      <div class="settled-banner">This trip is settled and read-only. Reopen it from the trip page to edit.</div>
      <div class="card">
        <div class="split-row"><div class="name">Amount</div><div>${formatCents(existing.expense.amount_cents)}</div></div>
        <div class="split-row"><div class="name">Paid by</div><div>${payer ? escapeHtml(payer.name) : 'Unknown'}</div></div>
        ${existing.splits
          .map((s) => {
            const p = peopleById.get(s.person_id);
            return `<div class="split-row"><div class="name">${p ? escapeHtml(p.name) : 'Unknown'}</div><div>${formatCents(s.share_cents)}</div></div>`;
          })
          .join('')}
      </div>
    </div>
  `;
}
