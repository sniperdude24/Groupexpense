// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { resetDb } from './helpers.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { render as renderHome } from '../src/screens/home.js';
import { render as renderTripDetail } from '../src/screens/tripDetail.js';
import { render as renderSettleUp } from '../src/screens/settleUp.js';
import { render as renderSettings } from '../src/screens/settings.js';

beforeEach(resetDb);

async function crew() {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  return { me, group };
}

describe('the HOW-TO section on Home', () => {
  it('is open for a brand-new user with no trips', async () => {
    await crew();
    const container = document.createElement('div');
    await renderHome(container);

    const howto = container.querySelector('#howto');
    expect(howto.hasAttribute('open')).toBe(true);
    const text = howto.textContent;
    for (const phrase of ['Start a trip', 'Log expenses', 'Settle up', 'Back up']) {
      expect(text).toContain(phrase);
    }
  });

  it('collapses once trips exist, but stays available', async () => {
    const { group } = await crew();
    await createTrip({ groupId: group.id, name: 'boise' });

    const container = document.createElement('div');
    await renderHome(container);
    const howto = container.querySelector('#howto');
    expect(howto).toBeTruthy();
    expect(howto.hasAttribute('open')).toBe(false);
  });
});

describe('the home link in the topbar', () => {
  it('deep screens get a home link next to back', async () => {
    const { group } = await crew();
    const trip = await createTrip({ groupId: group.id, name: 'boise' });

    // Settle up from a trip: back goes to the trip, so home rides along.
    const settle = document.createElement('div');
    await renderSettleUp(settle, { tripId: trip.id });
    const homeLink = settle.querySelector('a[aria-label="Home"]');
    expect(homeLink).toBeTruthy();
    expect(homeLink.getAttribute('href')).toBe('#/');
  });

  it('screens whose back already goes home do not show a duplicate', async () => {
    const { group } = await crew();
    const trip = await createTrip({ groupId: group.id, name: 'boise' });

    // A main-group trip's back IS home.
    const tripScreen = document.createElement('div');
    await renderTripDetail(tripScreen, { tripId: trip.id });
    expect(tripScreen.querySelector('a[aria-label="Home"]')).toBeNull();

    const settings = document.createElement('div');
    await renderSettings(settings);
    expect(settings.querySelector('a[aria-label="Home"]')).toBeNull();
  });

  it("another group's trip shows the home link, since its back goes to the group", async () => {
    await crew();
    await new Promise((r) => setTimeout(r, 2)); // strictly later created_at
    const other = await createGroup('Work lunches');
    const trip = await createTrip({ groupId: other.id, name: 'lunches' });

    const tripScreen = document.createElement('div');
    await renderTripDetail(tripScreen, { tripId: trip.id });
    expect(tripScreen.querySelector('a[aria-label="Home"]')).toBeTruthy();
  });
});
