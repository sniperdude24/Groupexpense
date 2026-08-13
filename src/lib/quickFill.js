/**
 * Quick-fill helpers for the expense form's description chips.
 *
 * The timestamp is hand-built rather than toLocaleDateString on purpose: the
 * day-month-year ordering, the English month names and the 2-digit year are
 * part of the format's contract, and locale formatting guarantees none of
 * them.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const DESCRIPTION_QUICK_FILLS = ['Food', 'Uber', 'Other'];

/** "<day> <Mon> <yy> at <h>:<mm> <AM/PM>", e.g. "12 Aug 26 at 8:49 PM". */
export function formatChipTimestamp(date) {
  const day = date.getDate();
  const mon = MONTHS[date.getMonth()];
  const yy = String(date.getFullYear() % 100).padStart(2, '0');
  const hours = date.getHours();
  const period = hours < 12 ? 'AM' : 'PM';
  // 12-hour clock: 0 and 12 both display as 12, everything else mod 12.
  const h = hours % 12 === 0 ? 12 : hours % 12;
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${day} ${mon} ${yy} at ${h}:${mm} ${period}`;
}

/** What a description chip writes into the field: "Food: 12 Aug 26 at 8:49 PM". */
export function quickFillDescription(label, date = new Date()) {
  return `${label}: ${formatChipTimestamp(date)}`;
}
