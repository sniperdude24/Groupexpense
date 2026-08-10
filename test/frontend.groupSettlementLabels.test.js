// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip, settleTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { computeGroupBalance } from '../src/repo/queries.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderGroupDetail } from '../src/screens/groupDetail.js';
import { render as renderTripDetail } from '../src/screens/tripDetail.js';

beforeEach(resetDb);

/**
 * The acceptance-check-6 shape: ana fronts an expense on a trip, ben pays her
 * back at *group* level. The group nets to zero; the trip, computed in
 * isolation, still shows non-zero balances -- correct, but in need of a label.
 */
async function groupPaidScenario() {
  const group = await createGroup('Crew');
  const trip = await createTrip({ groupId: group.id, name: 'Lake weekend' });
  const ana = await createPerson({ name: 'ana' });
  const ben = await createPerson({ name: 'ben' });
  await setIsMe(ana.id);
  await addMember(group.id, ana.id);
  await addMember(group.id, ben.id);
  await createExpense({
    tripId: trip.id, payerId: ana.id, amountCents: 5000,
    description: 'Boat fuel', spentAt: Date.now(),
    splits: computeEvenSplit(5000, [ana.id, ben.id])
  });
  // Ben pays his $25 back at group level (trip_id null).
  await createSettlement({
    groupId: group.id, tripId: null,
    fromPerson: ben.id, toPerson: ana.id, amountCents: 2500
  });
  return { group, trip, ana, ben };
}

describe('group-level settlement labeling (acceptance check 6)', () => {
  it('group zeroes, trip stays non-zero, and both carry the labels', async () => {
    const { group, trip } = await groupPaidScenario();

    // The math half of the acceptance check.
    const { net } = await computeGroupBalance(group.id);
    expect([...net.values()].every((cents) => cents === 0)).toBe(true);

    const groupScreen = document.createElement('div');
    await renderGroupDetail(groupScreen, { groupId: group.id });
    expect(groupScreen.querySelector('#group-settled-note').textContent)
      .toMatch(/Includes \$25\.00 settled at group level/);
    expect(groupScreen.querySelector('.covered-note').textContent)
      .toBe('group payments may cover part of this');

    const tripScreen = document.createElement('div');
    await renderTripDetail(tripScreen, { tripId: trip.id });
    const note = tripScreen.querySelector('#covered-note');
    expect(note.textContent.replace(/\s+/g, ' ')).toMatch(/Group payments may cover part of this\./);
    expect(note.querySelector('a').getAttribute('href')).toBe(`#/groups/${group.id}`);
  });

  it('shows no labels when nothing was settled at group level', async () => {
    const group = await createGroup('Crew');
    const trip = await createTrip({ groupId: group.id, name: 'Lake weekend' });
    const ana = await createPerson({ name: 'ana' });
    const ben = await createPerson({ name: 'ben' });
    await setIsMe(ana.id);
    await addMember(group.id, ana.id);
    await addMember(group.id, ben.id);
    await createExpense({
      tripId: trip.id, payerId: ana.id, amountCents: 5000,
      description: 'Boat fuel', spentAt: Date.now(),
      splits: computeEvenSplit(5000, [ana.id, ben.id])
    });

    const groupScreen = document.createElement('div');
    await renderGroupDetail(groupScreen, { groupId: group.id });
    expect(groupScreen.querySelector('#group-settled-note')).toBeNull();
    expect(groupScreen.querySelector('.covered-note')).toBeNull();

    const tripScreen = document.createElement('div');
    await renderTripDetail(tripScreen, { tripId: trip.id });
    expect(tripScreen.querySelector('#covered-note')).toBeNull();
  });

  it('a trip-level payment alone does not produce the group-level label', async () => {
    const group = await createGroup('Crew');
    const trip = await createTrip({ groupId: group.id, name: 'Lake weekend' });
    const ana = await createPerson({ name: 'ana' });
    const ben = await createPerson({ name: 'ben' });
    await setIsMe(ana.id);
    await addMember(group.id, ana.id);
    await addMember(group.id, ben.id);
    await createExpense({
      tripId: trip.id, payerId: ana.id, amountCents: 5000,
      description: 'Boat fuel', spentAt: Date.now(),
      splits: computeEvenSplit(5000, [ana.id, ben.id])
    });
    await createSettlement({
      groupId: group.id, tripId: trip.id,
      fromPerson: ben.id, toPerson: ana.id, amountCents: 1000
    });

    const groupScreen = document.createElement('div');
    await renderGroupDetail(groupScreen, { groupId: group.id });
    expect(groupScreen.querySelector('#group-settled-note')).toBeNull();
    expect(groupScreen.querySelector('.covered-note')).toBeNull();
  });

  it('a settled (locked) trip does not get the covered note', async () => {
    const { group, trip } = await groupPaidScenario();
    await settleTrip(trip.id);

    const groupScreen = document.createElement('div');
    await renderGroupDetail(groupScreen, { groupId: group.id });
    expect(groupScreen.querySelector('.covered-note')).toBeNull();

    const tripScreen = document.createElement('div');
    await renderTripDetail(tripScreen, { tripId: trip.id });
    expect(tripScreen.querySelector('#covered-note')).toBeNull();
  });
});
