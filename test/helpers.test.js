import { describe, it, expect } from 'vitest';
import { formatDateTime } from '../src/ui/helpers.js';

describe('formatDateTime', () => {
  it('formats a PM time with the exact requested layout', () => {
    const ms = new Date(2026, 7, 12, 12, 34).getTime(); // Aug 12 2026, 12:34 PM
    expect(formatDateTime(ms)).toBe('12 Aug 26 at 12:34 PM');
  });

  it('formats an AM time and pads single-digit minutes', () => {
    const ms = new Date(2026, 0, 5, 9, 5).getTime(); // Jan 5 2026, 9:05 AM
    expect(formatDateTime(ms)).toBe('5 Jan 26 at 9:05 AM');
  });

  it('converts midnight to 12 AM', () => {
    const ms = new Date(2026, 2, 1, 0, 0).getTime();
    expect(formatDateTime(ms)).toBe('1 Mar 26 at 12:00 AM');
  });

  it('converts noon to 12 PM', () => {
    const ms = new Date(2026, 2, 1, 12, 0).getTime();
    expect(formatDateTime(ms)).toBe('1 Mar 26 at 12:00 PM');
  });
});
