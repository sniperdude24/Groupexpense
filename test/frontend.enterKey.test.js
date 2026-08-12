// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { db } from '../src/db.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { render as renderExpenseForm } from '../src/screens/expenseForm.js';
import { render as renderSettleUp } from '../src/screens/settleUp.js';

beforeEach(resetDb);

function pressEnter(el) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
}

function typeInto(container, id, text) {
  const el = container.querySelector(`#${id}`);
  el.value = text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return container.querySelector(`#${id}`);
}

async function makeTripWithTwoPeople() {
  const group = await createGroup('Cabin');
  const trip = await createTrip({ groupId: group.id, name: 'Cabin' });
  const a = await createPerson({ name: 'Alice' });
  const b = await createPerson({ name: 'Bob' });
  await addMember(group.id, a.id);
  await addMember(group.id, b.id);
  return { group, trip, a, b };
}

describe('Enter key submits', () => {
  it('expense form: Enter in the amount field saves a valid expense', async () => {
    const { trip } = await makeTripWithTwoPeople();
    const container = document.createElement('div');
    await renderExpenseForm(container, { tripId: trip.id });

    typeInto(container, 'f-description', 'Firewood');
    const amount = typeInto(container, 'f-amount', '10.00');
    pressEnter(amount);
    // save handler is async (navigates after the IndexedDB write)
    await new Promise((r) => setTimeout(r, 50));

    const expenses = await db.expenses.toArray();
    expect(expenses).toHaveLength(1);
    expect(expenses[0].description).toBe('Firewood');
    expect(expenses[0].amount_cents).toBe(1000);
  });

  it('expense form: Enter does nothing while the form is invalid', async () => {
    const { trip } = await makeTripWithTwoPeople();
    const container = document.createElement('div');
    await renderExpenseForm(container, { tripId: trip.id });

    // Amount set but description empty -> save button stays disabled.
    const amount = typeInto(container, 'f-amount', '10.00');
    pressEnter(amount);
    await new Promise((r) => setTimeout(r, 50));

    expect(await db.expenses.toArray()).toHaveLength(0);
  });

  it('settle up: Enter in the amount field records the payment', async () => {
    const { trip } = await makeTripWithTwoPeople();
    const container = document.createElement('div');
    await renderSettleUp(container, { tripId: trip.id });

    const amount = typeInto(container, 's-amount', '7.25');
    pressEnter(amount);
    await new Promise((r) => setTimeout(r, 50));

    const settlements = await db.settlements.toArray();
    expect(settlements).toHaveLength(1);
    expect(settlements[0].amount_cents).toBe(725);
  });
});
