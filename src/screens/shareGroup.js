import qrcode from 'qrcode-generator';
import { getGroup } from '../repo/groups.js';
import { getTrip } from '../repo/trips.js';
import { getExpenseWithSplits } from '../repo/expenses.js';
import { exportGroup, exportTrip, exportExpense } from '../repo/exportImport.js';
import { encodeTransfer } from '../lib/qrtransfer.js';
import { escapeHtml, topbarNav } from '../ui/helpers.js';

/**
 * Broadcast a group or a single trip as a rotating sequence of QR codes.
 *
 * The receiver doesn't need every frame in one pass -- their collector keeps
 * whatever it catches and the rotation just keeps looping until they're
 * done -- so the only controls that matter are pausing on a frame the other
 * camera is struggling with, and stepping by hand.
 */

const FRAME_MS = 400;

function frameToSvg(text) {
  const qr = qrcode(0, 'M');
  qr.addData(text, 'Byte');
  qr.make();
  // cellSize 4 with the default 4-module quiet zone; the svg scales to fit.
  return qr.createSvgTag({ cellSize: 4, margin: 4, scalable: true });
}

export async function render(container, { groupId, tripId, expenseId }) {
  let title, backPath, payload;
  if (expenseId) {
    const expense = (await getExpenseWithSplits(expenseId))?.expense;
    if (!expense) {
      container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
      return;
    }
    title = `Share expense &ldquo;${escapeHtml(expense.description)}&rdquo;`;
    backPath = `/trips/${expense.trip_id}`;
    payload = await exportExpense(expenseId);
  } else if (tripId) {
    const trip = await getTrip(tripId);
    if (!trip) {
      container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
      return;
    }
    title = `Share trip &ldquo;${escapeHtml(trip.name)}&rdquo;`;
    backPath = `/trips/${tripId}`;
    payload = await exportTrip(tripId);
  } else {
    const group = await getGroup(groupId);
    if (!group) {
      container.innerHTML = `<div class="topbar"><a class="back-btn" href="#/">&larr;</a><h1>Not found</h1></div>`;
      return;
    }
    title = `Share &ldquo;${escapeHtml(group.name)}&rdquo;`;
    backPath = `/groups/${groupId}`;
    payload = await exportGroup(groupId);
  }

  const frames = await encodeTransfer(payload);
  const svgs = frames.map(frameToSvg);

  container.innerHTML = `
    <div class="topbar">
      ${topbarNav(backPath)}
      <h1>${title}</h1>
    </div>
    <div class="screen">
      <p style="color:var(--text-dim); font-size:14px; margin:0;">
        On the other phone, open Split and choose <b>Receive a share</b>, then point its camera
        here. The codes repeat until it has caught them all &mdash; order doesn't matter.
      </p>
      <div class="card" style="display:flex; flex-direction:column; align-items:center; gap:10px;">
        <div id="qr-frame" class="qr-frame"></div>
        <div id="qr-counter" style="font-variant-numeric:tabular-nums; color:var(--text-dim); font-size:14px;"></div>
        <div class="btn-row" style="width:100%;">
          <button class="btn secondary" id="qr-prev">&larr;</button>
          <button class="btn secondary" id="qr-pause">Pause</button>
          <button class="btn secondary" id="qr-next">&rarr;</button>
        </div>
      </div>
      <p style="color:var(--text-dim); font-size:13px; margin:0;">
        If the receiver reports missing codes, pause and step to them with the arrows.
        Sharing again later is safe &mdash; the other phone only adds what it doesn't have.
      </p>
    </div>
  `;

  let index = 0;
  let paused = false;

  const frameEl = container.querySelector('#qr-frame');
  const counterEl = container.querySelector('#qr-counter');
  const pauseBtn = container.querySelector('#qr-pause');

  function show(i) {
    index = ((i % svgs.length) + svgs.length) % svgs.length;
    frameEl.innerHTML = svgs[index];
    const svg = frameEl.querySelector('svg');
    if (svg) {
      svg.style.width = '100%';
      svg.style.height = '100%';
    }
    counterEl.textContent = `Code ${index + 1} of ${svgs.length}`;
  }

  const timer = setInterval(() => {
    if (!paused) show(index + 1);
  }, FRAME_MS);

  container.querySelector('#qr-prev').addEventListener('click', () => {
    paused = true;
    pauseBtn.textContent = 'Resume';
    show(index - 1);
  });
  container.querySelector('#qr-next').addEventListener('click', () => {
    paused = true;
    pauseBtn.textContent = 'Resume';
    show(index + 1);
  });
  pauseBtn.addEventListener('click', () => {
    paused = !paused;
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  });

  show(0);

  // The router calls this on the next navigation; without it the interval
  // would keep cycling forever behind whatever screen comes next.
  return () => clearInterval(timer);
}
