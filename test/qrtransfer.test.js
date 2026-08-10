import { describe, it, expect } from 'vitest';
import { encodeTransfer, FrameCollector } from '../src/lib/qrtransfer.js';

/** Feed frames to a fresh collector and assemble the payload back. */
async function roundTrip(frames) {
  const collector = new FrameCollector();
  for (const frame of frames) collector.add(frame);
  return collector.assemble();
}

/** A payload roughly the size of a real shared group. */
function bigPayload() {
  const expenses = Array.from({ length: 120 }, (_, i) => ({
    id: `expense-${i}-${'x'.repeat(20)}`,
    description: `Expense number ${i} with a fairly ordinary description`,
    amount_cents: 1000 + i * 7,
    spent_at: 1754700000000 + i
  }));
  return { schema_version: 1, groups: [{ id: 'g1', name: 'Big crew' }], expenses };
}

describe('encodeTransfer', () => {
  it('round-trips a small payload through a single frame', async () => {
    const payload = { hello: 'world', amount_cents: 1234 };
    const frames = await encodeTransfer(payload);
    expect(frames).toHaveLength(1);
    expect(frames[0]).toMatch(/^SPLITQR\/1\|[a-z0-9]+\|1\/1\|/);
    expect(await roundTrip(frames)).toEqual(payload);
  });

  it('splits a large payload across frames that reassemble exactly', async () => {
    const payload = bigPayload();
    const frames = await encodeTransfer(payload);
    expect(frames.length).toBeGreaterThan(1);
    expect(await roundTrip(frames)).toEqual(payload);
  });

  it('every frame stays small enough for a scannable QR code', async () => {
    const frames = await encodeTransfer(bigPayload());
    for (const frame of frames) expect(frame.length).toBeLessThanOrEqual(800);
  });
});

describe('FrameCollector', () => {
  it('accepts frames in any order, and duplicates are harmless', async () => {
    const payload = bigPayload();
    const frames = await encodeTransfer(payload);

    const collector = new FrameCollector();
    const shuffled = [...frames].reverse();
    for (const frame of shuffled) collector.add(frame);
    // A camera sees the same code many times; every re-sight is a no-op.
    expect(collector.add(frames[0]).status).toBe('duplicate');
    expect(collector.done).toBe(true);
    expect(await collector.assemble()).toEqual(payload);
  });

  it('reports progress and which frames are still missing', async () => {
    const frames = await encodeTransfer(bigPayload());
    const collector = new FrameCollector();

    const result = collector.add(frames[2]);
    expect(result).toMatchObject({ status: 'accepted', have: 1, total: frames.length });
    expect(collector.done).toBe(false);
    expect(collector.missing).not.toContain(3); // frame index 3 = frames[2]
    expect(collector.missing).toHaveLength(frames.length - 1);
    await expect(collector.assemble()).rejects.toThrow(/missing/i);
  });

  it('ignores QR codes that are not Split shares at all', () => {
    const collector = new FrameCollector();
    expect(collector.add('https://example.com/menu').status).toBe('ignored');
    expect(collector.add('WIFI:S:cafe;;').status).toBe('ignored');
    expect(collector.chunks.size).toBe(0);
  });

  it('refuses to mix two different shares together', async () => {
    const [a] = await encodeTransfer({ from: 'share one' });
    const [b] = await encodeTransfer({ from: 'share two' });
    const collector = new FrameCollector();
    collector.add(a);
    expect(() => collector.add(b)).toThrow(/different share/i);
  });

  it('rejects a frame that contradicts the established frame count', async () => {
    const frames = await encodeTransfer(bigPayload());
    const collector = new FrameCollector();
    collector.add(frames[0]);
    const [, transferId] = frames[0].split('|');
    expect(() => collector.add(`SPLITQR/1|${transferId}|1/99|AAAA`)).toThrow(/disagrees/i);
    expect(() => collector.add(`SPLITQR/1|${transferId}|0/${frames.length}|AAAA`)).toThrow(
      /disagrees/i
    );
  });

  it('rejects a future protocol version with an upgrade message', () => {
    const collector = new FrameCollector();
    expect(() => collector.add('SPLITQR/2|abc123|1/1|AAAA')).toThrow(/newer version/i);
  });

  it('fails loudly when assembled bytes are not a valid share', async () => {
    const collector = new FrameCollector();
    // Well-formed frame, but the chunk is garbage that won't gunzip.
    collector.add('SPLITQR/1|abc123|1/1|Tm90R3ppcERhdGE=');
    expect(collector.done).toBe(true);
    await expect(collector.assemble()).rejects.toThrow(/did not assemble/i);
  });
});
