// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resetDb } from './helpers.js';
import { formatChipTimestamp, quickFillDescription } from '../src/lib/quickFill.js';
import { createGroup } from '../src/repo/groups.js';
import { createPerson, setIsMe } from '../src/repo/people.js';
import { createTrip } from '../src/repo/trips.js';
import { addMember } from '../src/repo/memberships.js';
import { render as renderExpenseForm } from '../src/screens/expenseForm.js';

beforeEach(resetDb);
afterEach(() => vi.useRealTimers());

describe('formatChipTimestamp', () => {
  it('matches the contract exactly: unpadded day and hour, padded minutes, 2-digit year', () => {
    expect(formatChipTimestamp(new Date(2026, 7, 12, 20, 49))).toBe('12 Aug 26 at 8:49 PM');
    expect(formatChipTimestamp(new Date(2026, 0, 2, 9, 5))).toBe('2 Jan 26 at 9:05 AM');
    expect(formatChipTimestamp(new Date(2031, 11, 31, 23, 59))).toBe('31 Dec 31 at 11:59 PM');
  });

  it('handles the 12-hour edge cases: midnight is 12 AM, noon is 12 PM', () => {
    expect(formatChipTimestamp(new Date(2026, 7, 12, 0, 0))).toBe('12 Aug 26 at 12:00 AM');
    expect(formatChipTimestamp(new Date(2026, 7, 12, 12, 0))).toBe('12 Aug 26 at 12:00 PM');
    // Just around the boundaries, for good measure.
    expect(formatChipTimestamp(new Date(2026, 7, 12, 11, 59))).toBe('12 Aug 26 at 11:59 AM');
    expect(formatChipTimestamp(new Date(2026, 7, 12, 13, 1))).toBe('12 Aug 26 at 1:01 PM');
  });

  it('pads a single-digit year and keeps day-month-year order regardless of locale', () => {
    expect(formatChipTimestamp(new Date(2109, 2, 3, 15, 30))).toBe('3 Mar 09 at 3:30 PM');
  });

  it('quickFillDescription prefixes the label', () => {
    expect(quickFillDescription('Food', new Date(2026, 7, 12, 20, 49))).toBe(
      'Food: 12 Aug 26 at 8:49 PM'
    );
  });
});

async function openExpenseForm() {
  const me = await createPerson({ name: 'david' });
  await setIsMe(me.id);
  const group = await createGroup('The crew');
  await addMember(group.id, me.id);
  const trip = await createTrip({ groupId: group.id, name: 'boise' });
  const container = document.createElement('div');
  await renderExpenseForm(container, { tripId: trip.id });
  return container;
}

describe('description quick-fill chips', () => {
  it('clicking a chip stamps the field with the label and the current time', async () => {
    const container = await openExpenseForm();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12, 20, 49));

    const uber = [...container.querySelectorAll('.desc-chip')].find(
      (c) => c.dataset.label === 'Uber'
    );
    uber.click();

    expect(container.querySelector('#f-description').value).toBe('Uber: 12 Aug 26 at 8:49 PM');
  });

  it('shows exactly Food, Uber, Other, and none of them ever look selected', async () => {
    const container = await openExpenseForm();
    const chips = [...container.querySelectorAll('.desc-chip')];
    expect(chips.map((c) => c.textContent)).toEqual(['Food', 'Uber', 'Other']);

    chips[0].click();
    chips[0].click();
    expect(container.querySelectorAll('.desc-chip.selected')).toHaveLength(0);
    // Two clicks do not toggle the field empty -- each click just re-stamps.
    expect(container.querySelector('#f-description').value).toMatch(/^Food: /);
  });
});

describe('category chips (existing behavior, pinned)', () => {
  it('click fills and highlights; the same chip again clears; typing re-syncs', async () => {
    const container = await openExpenseForm();
    const input = container.querySelector('#f-category');
    const chip = (name) =>
      [...container.querySelectorAll('.category-chip')].find((c) => c.dataset.category === name);

    chip('Gas').click();
    expect(input.value).toBe('Gas');
    expect(chip('Gas').classList.contains('selected')).toBe(true);

    chip('Gas').click();
    expect(input.value).toBe('');
    expect(chip('Gas').classList.contains('selected')).toBe(false);

    input.value = 'Lodging';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(chip('Lodging').classList.contains('selected')).toBe(true);
    expect(chip('Gas').classList.contains('selected')).toBe(false);
  });
});
