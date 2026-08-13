export function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[c]));
}

/**
 * Topbar navigation: the back arrow, plus a home link whenever "back" isn't
 * already Home -- deep screens (an expense form, settle up) are otherwise
 * several taps from the top, and a phone app should never be.
 */
export function topbarNav(backPath) {
  const back = `<a class="back-btn" href="#${backPath}">&larr;</a>`;
  return backPath === '/'
    ? back
    : `${back}<a class="back-btn" href="#/" title="Home" aria-label="Home">&#127968;</a>`;
}

export function formatDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function onActivate(el, handler) {
  el.addEventListener('click', handler);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handler(e);
    }
  });
}

export function qs(root, sel) {
  return root.querySelector(sel);
}

export function qsa(root, sel) {
  return Array.from(root.querySelectorAll(sel));
}

/**
 * Best-available transport for a link: the share sheet, then the clipboard.
 * Returns what happened -- 'shared' | 'copied' | 'cancelled' | 'unavailable' --
 * so the caller decides what a fallback looks like (Settings falls through to
 * a file; the share screens just apologise). A user-cancelled share sheet is
 * 'cancelled', not a fallthrough: they changed their mind, nothing else
 * should pop up.
 */
export async function sendLink(link, title) {
  if (navigator.share) {
    try {
      await navigator.share({ title, url: link });
      return 'shared';
    } catch (err) {
      if (err.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    await navigator.clipboard.writeText(link);
    return 'copied';
  } catch {
    return 'unavailable';
  }
}

let toastTimer = null;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
