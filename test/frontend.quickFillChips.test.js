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

describe('the condensed form', () => {
  it('has no category chips; the category input stands alone', async () => {
    const container = await openExpenseForm();
    expect(container.querySelectorAll('.category-chip')).toHaveLength(0);
    expect(container.querySelector('#f-category')).toBeTruthy();
  });

  it('hides the date behind an edit button until asked for', async () => {
    const container = await openExpenseForm();

    const field = container.querySelector('#date-field');
    const button = container.querySelector('#edit-date-btn');
    expect(field.hidden).toBe(true);
    expect(button.hidden).toBe(false);
    // The button shows today's date so nothing is hidden blind.
    expect(button.textContent).toContain(container.querySelector('#f-date').value);

    button.click();
    expect(field.hidden).toBe(false);
    expect(button.hidden).toBe(true);
  });

  it('a date changed after revealing is what actually gets saved', async () => {
    const container = await openExpenseForm();

    container.querySelector('#f-description').value = 'Backdated dinner';
    container.querySelector('#f-description').dispatchEvent(new Event('input', { bubbles: true }));
    container.querySelector('#f-amount').value = '10.00';
    container.querySelector('#f-amount').dispatchEvent(new Event('input', { bubbles: true }));

    container.querySelector('#edit-date-btn').click();
    const dateInput = container.querySelector('#f-date');
    dateInput.value = '2026-08-01';
    dateInput.dispatchEvent(new Event('change', { bubbles: true }));

    [...container.querySelectorAll('button')]
      .find((b) => b.textContent.trim() === 'Add expense')
      .click();
    await new Promise((r) => setTimeout(r, 100));

    const { db } = await import('../src/db.js');
    const [expense] = await db.expenses.toArray();
    expect(expense.description).toBe('Backdated dinner');
    expect(new Date(expense.spent_at).getDate()).toBe(1);
  });
});
