export function computeEvenSplit(amountCents, personIds) {
  const n = personIds.length;
  if (n === 0) throw new Error('Cannot split an expense among zero people');
  const sorted = [...personIds].sort();
  const base = Math.floor(amountCents / n);
  const remainder = amountCents - base * n;
  return sorted.map((person_id, i) => ({
    person_id,
    share_cents: base + (i < remainder ? 1 : 0)
  }));
}

export function sumShares(splits) {
  return splits.reduce((sum, s) => sum + s.share_cents, 0);
}

export function splitsSumToAmount(amountCents, splits) {
  return sumShares(splits) === amountCents;
}
