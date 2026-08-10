import { exportData, downloadExport, readImportFile } from '../repo/exportImport.js';
import { encodeBackupLink, decodeBackupFragment, linkFitsInUrl } from '../lib/backupLink.js';
import { getMetaValue, setMetaValue } from '../repo/meta.js';
import { toast } from '../ui/helpers.js';
import { offerImport } from '../ui/importModal.js';
import { SCHEMA_VERSION } from '../db.js';

function describeLastBackup(timestamp) {
  if (!Number.isFinite(timestamp)) return 'Never backed up';
  const days = Math.floor((Date.now() - timestamp) / 86_400_000);
  if (days <= 0) return 'Last backed up today';
  if (days === 1) return 'Last backed up yesterday';
  return `Last backed up ${days} days ago`;
}

export async function render(container) {
  const lastBackupAt = await getMetaValue('last_backup_at');

  // Whether the browser has promised not to evict our storage under pressure.
  // Advisory only, but worth surfacing: this app's data lives nowhere else.
  let persisted = null;
  try {
    persisted = navigator.storage?.persisted ? await navigator.storage.persisted() : null;
  } catch {
    persisted = null;
  }

  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/">&larr;</a>
      <h1>Settings</h1>
    </div>
    <div class="screen">
      <div class="card">
        <p style="margin-top:0;">Your data lives only on this device. <strong>Share backup</strong>
          sends it as a link (or a file when it's large) — open it on another device to move
          everything across, or keep it somewhere safe as a backup.</p>
        <div class="btn-row">
          <button class="btn" id="share-btn">Share backup</button>
          <button class="btn secondary" id="export-btn">Download file</button>
        </div>
        <p id="backup-status" style="color:var(--text-dim); font-size:12px; margin:10px 0 0;">
          ${describeLastBackup(lastBackupAt)}${
            persisted === null ? '' : persisted
              ? ' &middot; storage protected from cleanup'
              : ' &middot; storage not yet protected — the browser may reclaim it, so back up often'
          }
        </p>
      </div>

      <div class="card">
        <p style="margin-top:0;">Import a backup from another device. <strong>Merge</strong> skips
          anything already on this device; <strong>Replace</strong> wipes this device first.</p>
        <input type="file" id="import-file" accept="application/json" style="display:none;" />
        <button class="btn secondary" id="import-btn">Import a file</button>
        <div class="field" style="margin-top:12px;">
          <label for="import-link">Or paste a backup link</label>
          <input id="import-link" type="text" inputmode="url" autocomplete="off"
            spellcheck="false" placeholder="https://&hellip;#import=&hellip;" />
        </div>
        <button class="btn secondary" id="import-link-btn">Import from link</button>
      </div>

      <p style="color:var(--text-dim); font-size:12px; text-align:center;">Schema version ${SCHEMA_VERSION}</p>
    </div>
  `;

  const recordBackup = async () => {
    await setMetaValue('last_backup_at', Date.now());
    const status = container.querySelector('#backup-status');
    if (status) status.textContent = describeLastBackup(Date.now());
  };

  /**
   * One button, best available transport. Preference order:
   *   1. share sheet with the link (small data)
   *   2. clipboard with the link
   *   3. share sheet with the file (large data, or no clipboard)
   *   4. plain download
   * A user-cancelled share sheet is not a fallthrough -- they changed their
   * mind, so nothing else should pop up and no backup is recorded.
   */
  container.querySelector('#share-btn').addEventListener('click', async () => {
    const data = await exportData();
    const link = await encodeBackupLink(data, location.origin + location.pathname);

    if (linkFitsInUrl(link)) {
      if (navigator.share) {
        try {
          await navigator.share({ title: 'Split backup', url: link });
          await recordBackup();
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      try {
        await navigator.clipboard.writeText(link);
        toast('Backup link copied — open it on your other device');
        await recordBackup();
        return;
      } catch {
        // No clipboard either; fall through to the file path.
      }
    }

    const stamp = new Date(data.exported_at).toISOString().slice(0, 10);
    const file = new File([JSON.stringify(data, null, 2)], `split-backup-${stamp}.json`, {
      type: 'application/json'
    });
    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'Split backup' });
        await recordBackup();
        return;
      } catch (err) {
        if (err.name === 'AbortError') return;
      }
    }
    downloadExport(data);
    toast('Backup downloaded');
    await recordBackup();
  });

  container.querySelector('#export-btn').addEventListener('click', async () => {
    const data = await exportData();
    downloadExport(data);
    toast('Backup downloaded');
    await recordBackup();
  });

  const fileInput = container.querySelector('#import-file');
  container.querySelector('#import-btn').addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', async () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (!file) return;
    let data;
    try {
      data = await readImportFile(file);
    } catch (err) {
      toast(err.message);
      return;
    }
    offerImport(data, { source: 'file' });
  });

  // The escape hatch for platforms where tapping a backup link opens the
  // browser instead of this app (iOS home-screen apps have their own storage,
  // separate from Safari's): paste the link here and the same import offer
  // comes up inside the app.
  const linkInput = container.querySelector('#import-link');
  container.querySelector('#import-link-btn').addEventListener('click', async () => {
    const text = linkInput.value.trim();
    if (!text) {
      toast('Paste a backup link first');
      linkInput.focus();
      return;
    }
    let data;
    try {
      data = await decodeBackupFragment(text);
    } catch (err) {
      toast(err.message);
      return;
    }
    linkInput.value = '';
    offerImport(data, { source: 'link' });
  });
}
