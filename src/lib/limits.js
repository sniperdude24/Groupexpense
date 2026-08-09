import { formatCents } from './money.js';

/**
 * Sanity caps on what a group can hold.
 *
 * These are policy limits, not arithmetic ones. Their job is to catch entries
 * that are obviously wrong for what this app is: a tracker for a group of
 * people splitting many small real-world costs between them.
 */

/**
 * The largest group we allow. The split editor, balance list and settle-up
 * screen all still work above this on a phone, but past roughly this size a
 * "group splitting costs" turns into an event roster, and the far likelier
 * cause of a 26th person is someone adding to the wrong group.
 */
export const MAX_GROUP_MEMBERS = 25;

/**
 * The most a single expense or settlement can be: $10,000.00.
 *
 * The app is built for many small transactions -- dinners, rides, groceries --
 * with different people paying each time. The largest genuine single entry is
 * someone fronting a whole accommodation, which this clears comfortably.
 * Anything past it is far more likely a slipped keystroke ("99000" meant as
 * $990.00) than a real shared cost, and one wrong entry that size silently
 * distorts every balance in the group until somebody works out why.
 */
export const MAX_ENTRY_AMOUNT_CENTS = 1_000_000;

export class GroupFullError extends Error {
  constructor() {
    super(`A group can hold at most ${MAX_GROUP_MEMBERS} people.`);
    this.name = 'GroupFullError';
  }
}

export class AmountTooLargeError extends Error {
  constructor(amountCents) {
    super(`A single entry can be at most ${formatCents(MAX_ENTRY_AMOUNT_CENTS)}.`);
    this.name = 'AmountTooLargeError';
    this.amountCents = amountCents;
  }
}

/** Guard for every path that accepts an amount in cents. */
export function assertAmountWithinLimit(amountCents) {
  if (Number.isInteger(amountCents) && amountCents > MAX_ENTRY_AMOUNT_CENTS) {
    throw new AmountTooLargeError(amountCents);
  }
}
