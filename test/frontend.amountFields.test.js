// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { render as renderExpenseForm } from '../src/screens/expenseForm.js';
import { render as renderSettleUp } from '../src/screens/settleUp.js';
import { formatDateTime } from '../src/ui/helpers.js';

beforeEach(resetDb);

// Faithfully simulates a user typing character by character: each keystroke
// appends to whatever the field *currently* displays and fires a real
// `input` event, re-reading the element from the DOM each time. This is the
// only way to catch a handler that quietly rewrites the field's value out
// from under the user mid-typing (the amount-field bug: the input handler
// reformatted the value from parsed cents and rebuilt the whole form on
// every keystroke, so typing "1" snapped the field to "1.00", and the next
// keystroke appended onto that instead of where the user actually typed).
function typeIntoById(container, id, chars) {
  for (const ch of chars) {
    const el = container.querySelector(`#${id}`);
    el.value = el.value + ch;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }
  return container.querySelector(`#${id}`);
}

describe('amount field does not eat keystrokes', () => {
  it('expense form: typing "12.50" character by character lands exactly on 12.50', async () => {
    const group = await createGroup('Cabin weekend');
    const trip = await createTrip({ groupId: group.id, name: 'Cabin weekend' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await addMember(group.id, a.id);
    await addMember(group.id, b.id);

    const container = document.createElement('div');
    await renderExpenseForm(container, { tripId: trip.id });

    const amountInput = typeIntoById(container, 'f-amount', '12.50');
    expect(amountInput.value).toBe('12.50');

    // Split still auto-balances live: $12.50 across 2 people is exact.
    const remaining = container.querySelector('.remaining-bar strong').textContent;
    expect(remaining).toBe('$0.00');
    const shares = Array.from(container.querySelectorAll('.p-amount')).map((i) => i.value).sort();
    expect(shares).toEqual(['6.25', '6.25']);
  });

  it('settle up: typing "7.25" character by character lands exactly on 7.25', async () => {
    const group = await createGroup('Roomies');
    const trip = await createTrip({ groupId: group.id, name: 'March rent' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await addMember(group.id, a.id);
    await addMember(group.id, b.id);

    const container = document.createElement('div');
    await renderSettleUp(container, { tripId: trip.id });

    const amountInput = typeIntoById(container, 's-amount', '7.25');
    expect(amountInput.value).toBe('7.25');
  });
});

describe('expense form description quick-fill chips', () => {
  it('clicking a chip fills the description with "<Label>: <now>" and updates save-button state', async () => {
    const group = await createGroup('Cabin weekend');
    const trip = await createTrip({ groupId: group.id, name: 'Cabin weekend' });
    const a = await createPerson({ name: 'Alice' });
    const b = await createPerson({ name: 'Bob' });
    await addMember(group.id, a.id);
    await addMember(group.id, b.id);

    const container = document.createElement('div');
    await renderExpenseForm(container, { tripId: trip.id });

    const foodChip = Array.from(container.querySelectorAll('.description-chip')).find(
      (c) => c.dataset.label === 'Food'
    );
    expect(foodChip).toBeTruthy();

    const before = Date.now();
    foodChip.click();
    const after = Date.now();

    const descInput = container.querySelector('#f-description');
    expect(descInput.value.startsWith('Food: ')).toBe(true);
    // Reconstruct the timestamp window the click could have landed in and
    // confirm the label's suffix matches formatDateTime for some ms in it --
    // avoids re-deriving the exact format here (already covered by
    // helpers.test.js) while still proving the real value made it into the DOM.
    const suffix = descInput.value.slice('Food: '.length);
    let matched = false;
    for (let ms = before; ms <= after; ms++) {
      if (formatDateTime(ms) === suffix) {
        matched = true;
        break;
      }
    }
    expect(matched).toBe(true);
  });
});
