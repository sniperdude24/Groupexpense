/**
 * Moving a payload phone-to-phone through a sequence of QR codes.
 *
 * A single QR tops out around 2-3KB, and a shared group is bigger than that,
 * so the payload is striped across several codes: gzip the JSON, base64 it,
 * slice it into chunks, and wrap each chunk in a small header. The sender
 * cycles through the frames on screen; the receiver's camera catches them in
 * whatever order they happen to be seen, and order doesn't matter -- each
 * frame says which slot it fills. When every slot is filled the payload is
 * reassembled and decompressed.
 *
 * Frame format (all printable ASCII, so any QR reader can see it's text):
 *
 *   SPLITQR/1|<transferId>|<index>/<total>|<base64 chunk>
 *
 * The transferId is random per encode. Its whole job is to stop two
 * broadcasts from being mixed together: if someone scans half of one share
 * and then a re-generated one, the ids differ and the collector says so
 * loudly instead of assembling a corrupt half-and-half payload.
 */

const MAGIC = 'SPLITQR';
const VERSION = 1;

/**
 * How much base64 rides in each frame. With the ~25-char header this keeps a
 * frame near 800 bytes -- QR version ~20 at medium error correction, which is
 * dense enough to need few frames but coarse enough for a mid-range phone
 * camera to lock onto quickly.
 */
const CHUNK_SIZE = 760;

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Encode a JSON-serialisable payload into an ordered list of frame strings. */
export async function encodeTransfer(payload) {
  const compressed = await gzip(new TextEncoder().encode(JSON.stringify(payload)));
  const base64 = toBase64(compressed);
  const transferId = Math.random().toString(36).slice(2, 8);

  const total = Math.max(1, Math.ceil(base64.length / CHUNK_SIZE));
  const frames = [];
  for (let i = 0; i < total; i++) {
    const chunk = base64.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
    frames.push(`${MAGIC}/${VERSION}|${transferId}|${i + 1}/${total}|${chunk}`);
  }
  return frames;
}

/**
 * Collects frames in any order until the payload is complete.
 *
 * `add` is deliberately forgiving about *noise* -- a frame that isn't ours at
 * all (someone pointed the camera at a menu's QR code) is reported as
 * ignored, not thrown -- but strict about *conflicts*: a frame from a
 * different transfer, or one that disagrees with the established total, is an
 * error the UI must surface, because continuing would assemble garbage.
 */
export class FrameCollector {
  constructor() {
    this.transferId = null;
    this.total = null;
    this.chunks = new Map();
  }

  /** @returns {{status: 'accepted'|'duplicate'|'ignored', have: number, total: number|null}} */
  add(text) {
    const match = /^SPLITQR\/(\d+)\|([a-z0-9]+)\|(\d+)\/(\d+)\|([A-Za-z0-9+/=]+)$/.exec(text);
    if (!match) return { status: 'ignored', have: this.chunks.size, total: this.total };

    const [, version, transferId, indexStr, totalStr, chunk] = match;
    if (Number(version) !== VERSION) {
      throw new Error('This code was made by a newer version of Split -- update this app to receive it');
    }

    if (this.transferId === null) {
      this.transferId = transferId;
      this.total = Number(totalStr);
    } else if (transferId !== this.transferId) {
      throw new Error(
        'This code belongs to a different share. Finish scanning one share at a time, or start over.'
      );
    } else if (Number(totalStr) !== this.total) {
      throw new Error('This code disagrees with the ones already scanned -- start over.');
    }

    const index = Number(indexStr);
    if (index < 1 || index > this.total) {
      throw new Error('This code disagrees with the ones already scanned -- start over.');
    }

    if (this.chunks.has(index)) {
      return { status: 'duplicate', have: this.chunks.size, total: this.total };
    }
    this.chunks.set(index, chunk);
    return { status: 'accepted', have: this.chunks.size, total: this.total };
  }

  get done() {
    return this.total !== null && this.chunks.size === this.total;
  }

  /** Which frame numbers are still missing -- shown so the sender can slow down. */
  get missing() {
    if (this.total === null) return [];
    const out = [];
    for (let i = 1; i <= this.total; i++) if (!this.chunks.has(i)) out.push(i);
    return out;
  }

  async assemble() {
    if (!this.done) {
      throw new Error(`Still missing ${this.missing.length} of ${this.total ?? '?'} codes`);
    }
    let base64 = '';
    for (let i = 1; i <= this.total; i++) base64 += this.chunks.get(i);
    let bytes;
    try {
      bytes = await gunzip(fromBase64(base64));
    } catch {
      throw new Error('The scanned codes did not assemble into a valid share -- start over.');
    }
    try {
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      throw new Error('The scanned codes did not assemble into a valid share -- start over.');
    }
  }
}
