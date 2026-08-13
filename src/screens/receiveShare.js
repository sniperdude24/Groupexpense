import jsQR from 'jsqr';
import { FrameCollector } from '../lib/qrtransfer.js';
import { validateShare } from '../repo/incomingShare.js';
import { offerReceivedShare } from '../ui/receiveConfirmModal.js';
import { topbarNav } from '../ui/helpers.js';
import { navigate } from '../router.js';

/**
 * Catch a share broadcast from another phone's screen.
 *
 * The camera feed is sampled through a canvas and each video frame is handed
 * to jsQR. Frames arrive in whatever order the camera manages to lock on;
 * the collector tracks which slots are filled and the bar underneath shows
 * progress, so holding steady until it reaches the end is the whole job.
 */
export async function render(container) {
  container.innerHTML = `
    <div class="topbar">
      ${topbarNav('/')}
      <h1>Receive a share</h1>
    </div>
    <div class="screen">
      <p style="color:var(--text-dim); font-size:14px; margin:0;">
        Point the camera at the other phone's rotating codes and hold steady.
      </p>
      <div class="card" style="display:flex; flex-direction:column; gap:10px; align-items:center;">
        <video id="rx-video" playsinline muted class="rx-video"></video>
        <div id="rx-status" style="font-variant-numeric:tabular-nums; color:var(--text-dim); font-size:14px;">
          Starting camera&hellip;
        </div>
        <div class="rx-track">
          <div id="rx-bar" class="rx-bar"></div>
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

  // Registered synchronously, before the getUserMedia await: if the user
  // navigates away while the permission prompt is still up, this render
  // hasn't returned yet, so the router has no cleanup to call -- only this
  // listener can set `stopped` for the race guard below. The returned
  // cleanup covers every later navigation; stop() is idempotent.
  window.addEventListener('hashchange', stop, { once: true });

  restartBtn.addEventListener('click', () => {
    // After a completed-but-rejected share the camera is already stopped, so
    // an in-place reset would scan nothing -- re-render to reacquire it. A
    // mid-scan conflict still resets in place, keeping the camera warm.
    if (stopped) {
      navigate('/receive');
      return;
    }
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
    // Still return the teardown: `stopped` also gates the scan loop.
    return stop;
  }
  if (stopped) {
    // Navigated away while the permission prompt was up.
    for (const track of stream.getTracks()) track.stop();
    return stop;
  }
  video.srcObject = stream;
  await video.play();
  statusEl.textContent = 'Scanning…';

  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  async function complete() {
    importing = true;
    stop();
    statusEl.textContent = 'Checking the share…';
    try {
      // Nothing touches the ledger yet: assemble, validate against a rogue or
      // corrupt payload, then put a confirmation between the scan and the
      // write. Only "Add to my ledger" imports.
      const payload = await validateShare(await collector.assemble());
      statusEl.textContent = 'All codes received';
      await offerReceivedShare(payload, {
        onDone(outcome) {
          if (outcome === 'added') return; // navigated away already
          // Cancelled / nothing new: re-render the screen fresh, which is
          // the one reliable way to reacquire the camera after stop().
          navigate('/receive');
        }
      });
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

  // Leaving the screen must release the camera, or the light stays on and the
  // next visit fights the old stream for the device. The router calls this on
  // the next navigation.
  return stop;
}
