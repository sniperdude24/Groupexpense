// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup, setGroupArchived } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip, listTripsOfGroup } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { createExpense } from '../src/repo/expenses.js';
import { computeEvenSplit } from '../src/lib/splits.js';
import { render as renderHome } from '../src/screens/home.js';

beforeEach(resetDb);

async function crewWithTwoTrips() {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const bob = await createPerson({ name: 'bob' });
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  await addMember(group.id, bob.id);
  const boise = await createTrip({ groupId: group.id, name: 'boise' });
  const vegas = await createTrip({ groupId: group.id, name: 'vegas' });
  // An amount that splits two ways without a leftover cent: the extra cent in
  // an odd split goes to whichever random person_id sorts first, so asserting
  // an exact figure on an odd amount is asserting a coin flip.
  await createExpense({
    tripId: boise.id, payerId: me.id, amountCents: 10000,
    description: 'gunrange', spentAt: Date.now(),
    splits: computeEvenSplit(10000, [me.id, bob.id])
  });
  return { me, bob, group, boise, vegas };
}

describe('home is built around the main group', () => {
  it('shows the main group card with the overall balance, and its trips below', async () => {
    const { group, boise, vegas } = await crewWithTwoTrips();

    const container = document.createElement('div');
    await renderHome(container);

    const card = container.querySelector('#main-group-card');
    expect(card.textContent).toContain('The crew');
    expect(card.textContent).toContain("you're owed $50.00");
    expect(card.getAttribute('href')).toBe(`#/groups/${group.id}`);

    const tripLinks = [...container.querySelectorAll('#trip-list a.row')].map((a) =>
      a.getAttribute('href')
    );
    expect(tripLinks).toContain(`#/trips/${boise.id}`);
    expect(tripLinks).toContain(`#/trips/${vegas.id}`);
    expect(container.textContent).not.toContain('Other groups');
  });

  it('"+ New trip" creates a trip in the main group, not a new group', async () => {
    const { group } = await crewWithTwoTrips();

    const container = document.createElement('div');
    await renderHome(container);

    container.querySelector('#new-trip-btn').click();
    await new Promise((r) => setTimeout(r, 50));
    const nameInput = document.getElementById('trip-name');
    nameInput.value = 'tahoe';
    nameInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('trip-create').click();
    await new Promise((r) => setTimeout(r, 80));

    const trips = await listTripsOfGroup(group.id);
    expect(trips.map((t) => t.name).sort()).toEqual(['boise', 'tahoe', 'vegas']);
  });

  it('a second group lands under "Other groups", unchanged', async () => {
    await crewWithTwoTrips();
    await new Promise((r) => setTimeout(r, 2)); // strictly later created_at
    const work = await createGroup('Work lunches');
    await createTrip({ groupId: work.id, name: 'Work lunches' });

    const container = document.createElement('div');
    await renderHome(container);

    expect(container.textContent).toContain('Other groups');
    expect(container.querySelector('#main-group-card').textContent).toContain('The crew');
    expect(container.textContent).toContain('Work lunches');
  });

  it('archiving the main group promotes the next oldest', async () => {
    const { group } = await crewWithTwoTrips();
    await new Promise((r) => setTimeout(r, 2)); // strictly later created_at
    const work = await createGroup('Work lunches');
    await createTrip({ groupId: work.id, name: 'Work lunches' });
    await setGroupArchived(group.id, true);

    const container = document.createElement('div');
    await renderHome(container);

    expect(container.querySelector('#main-group-card').textContent).toContain('Work lunches');
    expect(container.textContent).not.toContain('Other groups');
  });
});
