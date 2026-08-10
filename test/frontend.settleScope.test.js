// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { listSettlementsForGroup } from '../src/repo/settlements.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderSettleUp } from '../src/screens/settleUp.js';
import { render as renderTripDetail } from '../src/screens/tripDetail.js';

beforeEach(resetDb);

/** The reported shape: a single-trip group, where the group screen is never seen. */
async function singleTripGroup() {
  const group = await createGroup('boise');
  const trip = await createTrip({ groupId: group.id, name: 'boise' });
  const ana = await createPerson({ name: 'ana' });
  const ben = await createPerson({ name: 'ben' });
  await setIsMe(ana.id);
  await addMember(group.id, ana.id);
  await addMember(group.id, ben.id);
  await createExpense({
    tripId: trip.id, payerId: ana.id, amountCents: 5000,
    description: 'Dinner', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [ana.id, ben.id])
  });
  return { group, trip, ana, ben };
}

function fillAndSave(container, amount) {
  const amountInput = container.querySelector('#s-amount');
  amountInput.value = amount;
  amountInput.dispatchEvent(new Event('input', { bubbles: true }));
  container.querySelector('#s-save').click();
}

describe('settle-up scope choice', () => {
  it('arriving from a trip offers both scopes, preselecting the trip', async () => {
    const { trip } = await singleTripGroup();
    const container = document.createElement('div');
    await renderSettleUp(container, { tripId: trip.id });

    expect(container.querySelector('#scope-trip')).toBeTruthy();
    expect(container.querySelector('#scope-group')).toBeTruthy();
    expect(container.querySelector('#scope-line').textContent).toContain('Recording on this trip');
  });

  it('records at trip level by default', async () => {
    const { group, trip } = await singleTripGroup();
    const container = document.createElement('div');
    await renderSettleUp(container, { tripId: trip.id });

    fillAndSave(container, '25.00');
    await new Promise((r) => setTimeout(r, 50));

    const [settlement] = await listSettlementsForGroup(group.id);
    expect(settlement.trip_id).toBe(trip.id);
  });

  it('the reported gap: group-level payment from a single-trip group, labels and all', async () => {
    const { group, trip } = await singleTripGroup();
    const container = document.createElement('div');
    await renderSettleUp(container, { tripId: trip.id });

    container.querySelector('#scope-group').click();
    await new Promise((r) => setTimeout(r, 50));
    expect(container.querySelector('#scope-line').textContent).toContain('group level');

    fillAndSave(container, '25.00');
    await new Promise((r) => setTimeout(r, 50));

    const [settlement] = await listSettlementsForGroup(group.id);
    expect(settlement.trip_id).toBeNull();
    expect(settlement.group_id).toBe(group.id);

    // The whole point: the trip screen now explains itself.
    const tripScreen = document.createElement('div');
    await renderTripDetail(tripScreen, { tripId: trip.id });
    expect(tripScreen.querySelector('#covered-note')).toBeTruthy();
  });

  it('suggestions follow the scope: a second trip only counts at group level', async () => {
    const { group, trip, ana, ben } = await singleTripGroup();
    const other = await createTrip({ groupId: group.id, name: 'side trip' });
    await createExpense({
      tripId: other.id, payerId: ben.id, amountCents: 5000,
      description: 'Gas', spentAt: Date.now(),
      splits: computeEvenSplit(5000, [ana.id, ben.id])
    });

    const container = document.createElement('div');
    await renderSettleUp(container, { tripId: trip.id });

    // Trip scope: ben owes ana $25 for dinner.
    expect(container.textContent).toContain('$25.00');

    // Group scope: the two trips cancel out exactly.
    container.querySelector('#scope-group').click();
    await new Promise((r) => setTimeout(r, 50));
    expect(container.textContent).toContain('No outstanding balances in this scope');
  });

  it('arriving from the group screen offers no trip option', async () => {
    const { group } = await singleTripGroup();
    const container = document.createElement('div');
    await renderSettleUp(container, { groupId: group.id });

    expect(container.querySelector('#scope-trip')).toBeNull();
    expect(container.querySelector('#scope-group')).toBeNull();
    expect(container.querySelector('#scope-line').textContent).toContain('group level');
  });
});
