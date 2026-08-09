import { describe, it, expect } from 'vitest';
import { computeEvenSplit, sumShares, splitsSumToAmount } from '../src/lib/splits.js';

describe('computeEvenSplit', () => {
  it('spec example: $10.00 across 3 people -> 334, 333, 333', () => {
    const ids = ['c', 'a', 'b'];
    const splits = computeEvenSplit(1000, ids);
    const byId = Object.fromEntries(splits.map((s) => [s.person_id, s.share_cents]));
    expect(byId.a).toBe(334);
    expect(byId.b).toBe(333);
    expect(byId.c).toBe(333);
    expect(sumShares(splits)).toBe(1000);
  });

  it('is deterministic regardless of input order', () => {
    const s1 = computeEvenSplit(1000, ['c', 'a', 'b']);
    const s2 = computeEvenSplit(1000, ['b', 'c', 'a']);
    expect(s1).toEqual(s2);
  });

  it('divides evenly with no remainder', () => {
    const splits = computeEvenSplit(900, ['a', 'b', 'c']);
    expect(splits.every((s) => s.share_cents === 300)).toBe(true);
  });

  it('always sums exactly to the amount, for many amounts and group sizes', () => {
    for (let n = 1; n <= 12; n++) {
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      for (let amount = 0; amount <= 5000; amount += 137) {
        const splits = computeEvenSplit(amount, ids);
        expect(sumShares(splits)).toBe(amount);
        expect(splitsSumToAmount(amount, splits)).toBe(true);
      }
    }
  });

  it('throws for zero people', () => {
    expect(() => computeEvenSplit(1000, [])).toThrow();
  });
});
