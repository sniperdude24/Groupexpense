// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderTripDetail } from '../src/screens/tripDetail.js';

beforeEach(async () => {
  await resetDb();
  location.hash = '';
});

async function tripWithExpenses() {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const bob = await createPerson({ name: 'bob' });
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  await addMember(group.id, bob.id);
  const boise = await createTrip({ groupId: group.id, name: 'boise' });
  const dinner = await createExpense({
    tripId: boise.id, payerId: me.id, amountCents: 5000,
    description: 'dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [me.id, bob.id])
  });
  const fuel = await createExpense({
    tripId: boise.id, payerId: bob.id, amountCents: 3000,
    description: 'fuel', spentAt: Date.now(),
    splits: computeEvenSplit(3000, [me.id, bob.id])
  });
  return { boise, dinner, fuel };
}

describe('the per-expense share button', () => {
  it('every expense row gets one, aimed at its own expense', async () => {
    const { boise, dinner, fuel } = await tripWithExpenses();
    const screen = document.createElement('div');
    await renderTripDetail(screen, { tripId: boise.id });

    const buttons = [...screen.querySelectorAll('.share-expense')];
    expect(buttons).toHaveLength(2);
    expect(new Set(buttons.map((b) => b.dataset.id))).toEqual(new Set([dinner.id, fuel.id]));
  });

  it('tapping it goes to the share screen, not the edit screen', async () => {
    const { boise, dinner } = await tripWithExpenses();
    const screen = document.createElement('div');
    await renderTripDetail(screen, { tripId: boise.id });

    const btn = screen.querySelector(`.share-expense[data-id="${dinner.id}"]`);
    // The button lives inside the row's edit link; the handler must both
    // navigate to the share route and stop the click from reaching the anchor.
    const row = btn.closest('a.expense-row');
    let anchorSawClick = false;
    row.addEventListener('click', () => { anchorSawClick = true; });

    btn.click();
    expect(location.hash).toBe(`#/expenses/${dinner.id}/share`);
    expect(anchorSawClick).toBe(false);
  });
});
