/**
 * Backup-as-a-link: the whole export, deflated and base64url-encoded into a
 * URL fragment. Opening the link on another device launches the app, which
 * spots the fragment and offers to import.
 *
 * Why a fragment: it never leaves the browser -- fragments are not sent in
 * HTTP requests, so GitHub Pages never sees the data. The link's *contents*
 * still travel through whatever channel carries it (AirDrop, Messages, email),
 * which is exactly as private as sharing the backup file itself.
 *
 * Why a size cap: messaging apps mangle very long URLs. Under the cap the
 * share button sends a link; over it, it falls back to sharing the file. Both
 * arrive at the same import screen.
 */

export const FRAGMENT_PREFIX = '#import=';

/**
 * Longest link the share button will produce, in characters. Deliberately
 * conservative: URLs beyond ~8k get truncated by some messaging apps and
 * some in-app browsers, and a truncated backup must fail loudly (base64 +
 * deflate make silent corruption effectively impossible) rather than import
 * half a ledger.
 */
export const LINK_MAX_CHARS = 8000;

function bytesToBase64Url(bytes) {
  let binary = '';
  // Chunked to keep the argument list small -- String.fromCharCode(...all)
  // overflows the call stack on large arrays.
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(text) {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function throughStream(bytes, transform) {
  const stream = new Blob([bytes]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Export data -> full link, e.g. "https://.../#import=eNq..." */
export async function encodeBackupLink(data, baseUrl) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  const deflated = await throughStream(json, new CompressionStream('deflate'));
  return `${baseUrl}${FRAGMENT_PREFIX}${bytesToBase64Url(deflated)}`;
}

/** The "#import=..." fragment (or a whole pasted link) -> export data. */
export async function decodeBackupFragment(fragment) {
  const at = fragment.indexOf(FRAGMENT_PREFIX);
  if (at === -1) throw new Error('That is not a backup link');
  const payload = fragment.slice(at + FRAGMENT_PREFIX.length);
  if (!payload) throw new Error('That backup link is empty');

  try {
    const deflated = base64UrlToBytes(payload);
    const json = await throughStream(deflated, new DecompressionStream('deflate'));
    return JSON.parse(new TextDecoder().decode(json));
  } catch {
    // atob, inflate and JSON.parse all throw their own flavours of noise;
    // the user-facing story is the same for each.
    throw new Error('That backup link is damaged or incomplete -- share the backup as a file instead');
  }
}

export function linkFitsInUrl(link) {
  return link.length <= LINK_MAX_CHARS;
}
