// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip, setTripOrder, sortTripsForDisplay, listTripsOfGroup } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { render as renderHome } from '../src/screens/home.js';

beforeEach(resetDb);

async function crewWithTrips(names) {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  const trips = [];
  for (const name of names) trips.push(await createTrip({ groupId: group.id, name }));
  return { me, group, trips };
}

const rowTitles = (container) =>
  [...container.querySelectorAll('#trip-list .row .row-title')].map((el) => el.textContent);

describe('sortTripsForDisplay', () => {
  it('manual order wins; unordered trips keep their old date order at the end', () => {
    const trips = [
      { id: 'a', sort_order: 1, start_date: null, settled_at: null },
      { id: 'b', sort_order: 0, start_date: null, settled_at: null },
      { id: 'c', start_date: 500, settled_at: null },
      { id: 'd', start_date: 900, settled_at: null }
    ];
    expect(sortTripsForDisplay(trips).map((t) => t.id)).toEqual(['b', 'a', 'd', 'c']);
  });
});

describe('reordering trips on Home', () => {
  it('moves a trip up, persists, and survives a fresh render', async () => {
    const { group } = await crewWithTrips(['alpha', 'bravo', 'charlie']);

    const container = document.createElement('div');
    await renderHome(container);
    const before = rowTitles(container);
    expect(before).toHaveLength(3);

    container.querySelector('#reorder-toggle').click();
    await new Promise((r) => setTimeout(r, 30));

    // Move the last row to the top with two taps.
    const last = () => [...container.querySelectorAll('.move-up')].at(-1);
    last().click();
    await new Promise((r) => setTimeout(r, 60));
    container.querySelectorAll('.move-up')[1].click();
    await new Promise((r) => setTimeout(r, 60));

    const movedName = before[2];
    expect(rowTitles(container)[0]).toBe(movedName);

    // Done, then a completely fresh render: the order must come from the DB.
    container.querySelector('#reorder-toggle').click();
    await new Promise((r) => setTimeout(r, 30));
    const fresh = document.createElement('div');
    await renderHome(fresh);
    expect(rowTitles(fresh)[0]).toBe(movedName);

    const stored = await listTripsOfGroup(group.id);
    const byName = new Map(stored.map((t) => [t.name, t.sort_order]));
    expect(byName.get(movedName)).toBe(0);
  });

  it('reorder mode swaps links for arrows and Done swaps them back', async () => {
    await crewWithTrips(['alpha', 'bravo']);

    const container = document.createElement('div');
    await renderHome(container);
    expect(container.querySelectorAll('#trip-list a.row')).toHaveLength(2);

    container.querySelector('#reorder-toggle').click();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelectorAll('#trip-list a.row')).toHaveLength(0);
    expect(container.querySelectorAll('.move-up')).toHaveLength(2);
    expect(container.querySelector('.move-up').disabled).toBe(true);
    expect([...container.querySelectorAll('.move-down')].at(-1).disabled).toBe(true);

    container.querySelector('#reorder-toggle').click();
    await new Promise((r) => setTimeout(r, 30));
    expect(container.querySelectorAll('#trip-list a.row')).toHaveLength(2);
  });

  it('a single trip offers no reorder toggle', async () => {
    await crewWithTrips(['alpha']);
    const container = document.createElement('div');
    await renderHome(container);
    expect(container.querySelector('#reorder-toggle')).toBeNull();
  });

  it('setTripOrder is the whole order: reassigning is idempotent and complete', async () => {
    const { group, trips } = await crewWithTrips(['alpha', 'bravo', 'charlie']);
    const ids = trips.map((t) => t.id);

    await setTripOrder([ids[2], ids[0], ids[1]]);
    await setTripOrder([ids[2], ids[0], ids[1]]);

    const stored = sortTripsForDisplay(await listTripsOfGroup(group.id));
    expect(stored.map((t) => t.name)).toEqual(['charlie', 'alpha', 'bravo']);
  });
});
