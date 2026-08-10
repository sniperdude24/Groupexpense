// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup, deleteGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip, setTripExcluded } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { createSettlement } from '../src/repo/settlements.js';
import { computeGroupBalance, computeTripBalance } from '../src/repo/queries.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderHome } from '../src/screens/home.js';
import { render as renderTripDetail } from '../src/screens/tripDetail.js';

beforeEach(resetDb);

/** Crew with two trips: boise (me owed $50) and vegas (I owe $30). */
async function crew() {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const bob = await createPerson({ name: 'bob' });
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  await addMember(group.id, bob.id);
  const boise = await createTrip({ groupId: group.id, name: 'boise' });
  const vegas = await createTrip({ groupId: group.id, name: 'vegas' });
  await createExpense({
    tripId: boise.id, payerId: me.id, amountCents: 10000,
    description: 'gunrange', spentAt: Date.now(),
    splits: computeEvenSplit(10000, [me.id, bob.id])
  });
  await createExpense({
    tripId: vegas.id, payerId: bob.id, amountCents: 6000,
    description: 'tickets', spentAt: Date.now(),
    splits: computeEvenSplit(6000, [me.id, bob.id])
  });
  return { me, bob, group, boise, vegas };
}

describe('excluding a trip from the group balance', () => {
  it('drops the trip from the group ledger but not from its own', async () => {
    const { me, group, vegas } = await crew();

    expect((await computeGroupBalance(group.id)).net.get(me.id)).toBe(2000);

    await setTripExcluded(vegas.id, true);
    expect((await computeGroupBalance(group.id)).net.get(me.id)).toBe(5000);

    // The trip's own books are untouched.
    expect((await computeTripBalance(vegas.id)).net.get(me.id)).toBe(-3000);

    await setTripExcluded(vegas.id, false);
    expect((await computeGroupBalance(group.id)).net.get(me.id)).toBe(2000);
  });

  it("an excluded trip's own settlements drop out with it", async () => {
    const { me, bob, group, vegas } = await crew();
    await createSettlement({
      groupId: group.id, tripId: vegas.id,
      fromPerson: me.id, toPerson: bob.id, amountCents: 3000
    });

    // Settled within vegas: group total back to just boise's +5000.
    expect((await computeGroupBalance(group.id)).net.get(me.id)).toBe(5000);

    // Excluding vegas removes its expense AND its settlement -- same +5000,
    // not +5000 plus a dangling repayment.
    await setTripExcluded(vegas.id, true);
    expect((await computeGroupBalance(group.id)).net.get(me.id)).toBe(5000);
  });

  it('exclusion cannot make a group with debts deletable', async () => {
    const { group, boise, vegas } = await crew();
    await setTripExcluded(boise.id, true);
    await setTripExcluded(vegas.id, true);

    // Display says settled; the deletion guard must still see the debts.
    await expect(deleteGroup(group.id)).rejects.toThrow(/outstanding balance/);
  });

  it('the trip screen toggles it, with the note and no covered-note', async () => {
    const { me, bob, group, vegas } = await crew();
    await createSettlement({
      groupId: group.id, tripId: null,
      fromPerson: bob.id, toPerson: me.id, amountCents: 1000
    });

    const screen = document.createElement('div');
    await renderTripDetail(screen, { tripId: vegas.id });
    expect(screen.querySelector('#covered-note')).toBeTruthy();
    expect(screen.querySelector('#excluded-note')).toBeNull();

    screen.querySelector('#exclude-btn').click();
    await new Promise((r) => setTimeout(r, 80));

    expect(screen.querySelector('#excluded-note').textContent).toContain('The crew');
    expect(screen.querySelector('#covered-note')).toBeNull();
    expect(screen.querySelector('#exclude-btn').textContent).toContain('Include in group balance');

    screen.querySelector('#exclude-btn').click();
    await new Promise((r) => setTimeout(r, 80));
    expect(screen.querySelector('#excluded-note')).toBeNull();
  });

  it('home shows the badge and the corrected main balance', async () => {
    const { vegas } = await crew();
    await setTripExcluded(vegas.id, true);

    const container = document.createElement('div');
    await renderHome(container);

    expect(container.querySelector('#main-group-card').textContent).toContain("you're owed $50.00");
    const vegasRow = [...container.querySelectorAll('#trip-list a.row')].find((a) =>
      a.textContent.includes('vegas')
    );
    expect(vegasRow.textContent).toContain('excluded');
  });
});
