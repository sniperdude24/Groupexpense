import { describe, it, expect } from 'vitest';
import { parseAmountToCents, formatCents } from '../src/lib/money.js';

describe('parseAmountToCents', () => {
  it('parses whole dollars', () => {
    expect(parseAmountToCents('10')).toBe(1000);
  });
  it('parses cents', () => {
    expect(parseAmountToCents('10.00')).toBe(1000);
    expect(parseAmountToCents('24.99')).toBe(2499);
  });
  it('pads single-digit cents', () => {
    expect(parseAmountToCents('10.5')).toBe(1050);
  });
  it('handles a leading dot', () => {
    expect(parseAmountToCents('.99')).toBe(99);
  });
  it('rejects garbage', () => {
    expect(parseAmountToCents('abc')).toBe(null);
    expect(parseAmountToCents('')).toBe(null);
    expect(parseAmountToCents('12.345')).toBe(null);
    expect(parseAmountToCents('-5')).toBe(null);
  });
});

describe('formatCents', () => {
  it('formats positive amounts', () => {
    expect(formatCents(1999)).toBe('$19.99');
    expect(formatCents(100000)).toBe('$1,000.00');
  });
  it('formats negative amounts', () => {
    expect(formatCents(-1999)).toBe('-$19.99');
  });
  it('pads single-digit cents', () => {
    expect(formatCents(1005)).toBe('$10.05');
  });
});
