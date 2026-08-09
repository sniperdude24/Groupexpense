export function parseAmountToCents(input) {
  const cleaned = String(input).trim();
  if (!cleaned) return null;
  if (!/^\d*\.?\d{0,2}$/.test(cleaned) || cleaned === '.') return null;
  const [wholeRaw, fracRaw = ''] = cleaned.split('.');
  const whole = wholeRaw === '' ? 0 : parseInt(wholeRaw, 10);
  const frac = (fracRaw + '00').slice(0, 2);
  return whole * 100 + parseInt(frac, 10);
}

export function formatCents(cents) {
  const value = Number.isFinite(cents) ? cents : 0;
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  const dollars = Math.floor(abs / 100);
  const remainder = String(abs % 100).padStart(2, '0');
  return `${sign}$${dollars.toLocaleString('en-US')}.${remainder}`;
}
