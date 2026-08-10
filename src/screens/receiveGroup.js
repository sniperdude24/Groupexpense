import jsQR from 'jsqr';
import { importData } from '../repo/exportImport.js';
import { FrameCollector } from '../lib/qrtransfer.js';
import { toast } from '../ui/helpers.js';
import { navigate } from '../router.js';

/**
 * Catch a group broadcast from another phone's screen.
 *
 * The camera feed is sampled through a canvas and each video frame is handed
 * to jsQR. Frames arrive in whatever order the camera manages to lock on;
 * the collector tracks which slots are filled and the bar underneath shows
 * progress, so holding steady until it reaches the end is the whole job.
 */
export async function render(container) {
  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/">&larr;</a>
      <h1>Receive a group</h1>
    </div>
    <div class="screen">
      <p style="color:var(--text-dim); font-size:14px; margin:0;">
        Point the camera at the other phone's rotating codes and hold steady.
      </p>
      <div class="card" style="display:flex; flex-direction:column; gap:10px; align-items:center;">
        <video id="rx-video" playsinline muted
          style="width:100%; max-width:320px; aspect-ratio:1; object-fit:cover; border-radius:8px; background:#000;"></video>
        <div id="rx-status" style="font-variant-numeric:tabular-nums; color:var(--text-dim); font-size:14px;">
          Starting camera&hellip;
        </div>
        <div style="width:100%; max-width:320px; height:6px; border-radius:3px; background:var(--border, #333); overflow:hidden;">
          <div id="rx-bar" style="height:100%; width:0%; background:var(--accent); transition:width 0.2s;"></div>
        </div>
      </div>
      <button class="btn secondary" id="rx-restart" hidden>Start over</button>
    </div>
  `;

  const video = container.querySelector('#rx-video');
  const statusEl = container.querySelector('#rx-status');
  const barEl = container.querySelector('#rx-bar');
  const restartBtn = container.querySelector('#rx-restart');

  let collector = new FrameCollector();
  let stream = null;
  let stopped = false;
  let importing = false;

  function stop() {
    stopped = true;
    if (stream) for (const track of stream.getTracks()) track.stop();
  }
  // Leaving the screen must release the camera, or the light stays on and the
  // next visit fights the old stream for the device.
  window.addEventListener('hashchange', stop, { once: true });

  restartBtn.addEventListener('click', () => {
    collector = new FrameCollector();
    restartBtn.hidden = true;
    statusEl.textContent = 'Scanning…';
    barEl.style.width = '0%';
  });

  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false
    });
  } catch {
    statusEl.textContent = 'Camera unavailable. Allow camera access for Split and come back.';
    return;
  }
  if (stopped) {
    // Navigated away while the permission prompt was up.
    for (const track of stream.getTracks()) track.stop();
    return;
  }
  video.srcObject = stream;
  await video.play();
  statusEl.textContent = 'Scanning…';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function complete() {
    importing = true;
    stop();
    statusEl.textContent = 'Importing…';
    try {
      const payload = await collector.assemble();
      const summary = await importData(payload, { mode: 'merge' });
      const added = Object.values(summary).reduce((s, t) => s + t.imported, 0);
      const groupId = payload.groups && payload.groups[0] && payload.groups[0].id;
      toast(
        added === 0
          ? 'Already up to date — nothing new in that share'
          : `Group received — ${added} new record${added === 1 ? '' : 's'}`
      );
      navigate(groupId ? `/groups/${groupId}` : '/');
    } catch (err) {
      statusEl.textContent = err.message;
      restartBtn.hidden = false;
      importing = false;
    }
  }

  function tick() {
    if (stopped || importing) return;
    if (video.readyState >= video.HAVE_CURRENT_DATA) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const found = jsQR(image.data, image.width, image.height, {
        inversionAttempts: 'dontInvert'
      });
      if (found && found.data) {
        try {
          const result = collector.add(found.data);
          if (result.total !== null && result.status !== 'ignored') {
            const missing = collector.missing;
            statusEl.textContent = collector.done
              ? 'All codes received'
              : `${result.have} of ${result.total} codes` +
                (missing.length <= 3 ? ` — missing ${missing.join(', ')}` : '');
            barEl.style.width = `${Math.round((result.have / result.total) * 100)}%`;
          }
          if (collector.done) {
            complete();
            return;
          }
        } catch (err) {
          // A conflicting share is not recoverable mid-scan; say so and offer
          // a clean restart rather than silently assembling garbage.
          statusEl.textContent = err.message;
          restartBtn.hidden = false;
        }
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}
