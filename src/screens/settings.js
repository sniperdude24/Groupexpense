import { exportData, importData, downloadExport, readImportFile } from '../repo/exportImport.js';
import { toast } from '../ui/helpers.js';
import { openModal, closeModal } from '../ui/modal.js';
import { navigate } from '../router.js';
import { SCHEMA_VERSION } from '../db.js';

export async function render(container) {
  container.innerHTML = `
    <div class="topbar">
      <a class="back-btn" href="#/">&larr;</a>
      <h1>Settings</h1>
    </div>
    <div class="screen">
      <div class="card">
        <p style="margin-top:0;">Export writes every group, trip, expense and payment to a single JSON
          file — this is your only backup and the only way to move data to another device.</p>
        <button class="btn secondary" id="export-btn">Export data</button>
      </div>

      <div class="card">
        <p style="margin-top:0;">Import reads that file back in. <strong>Merge</strong> skips anything
          already on this device; <strong>Replace</strong> wipes this device first.</p>
        <input type="file" id="import-file" accept="application/json" style="display:none;" />
        <button class="btn secondary" id="import-btn">Import data</button>
      </div>

      <p style="color:var(--text-dim); font-size:12px; text-align:center;">Schema version ${SCHEMA_VERSION}</p>
    </div>
  `;

  container.querySelector('#export-btn').addEventListener('click', async () => {
    const data = await exportData();
    downloadExport(data);
    toast('Export downloaded');
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

    openModal(`
      <h2>Import data</h2>
      <p style="color:var(--text-dim); font-size:14px;">
        ${data.groups?.length ?? 0} groups, ${data.trips?.length ?? 0} trips,
        ${data.expenses?.length ?? 0} expenses in this file.
      </p>
      <div class="btn-row" style="margin-bottom:10px;">
        <button class="btn secondary" id="import-merge">Merge</button>
        <button class="btn danger" id="import-replace">Replace everything</button>
      </div>
      <button class="btn ghost" id="import-cancel">Cancel</button>
    `);
    const overlay = document.getElementById('modal-overlay');
    overlay.querySelector('#import-cancel').addEventListener('click', closeModal);

    const runImport = async (mode) => {
      try {
        await importData(data, { mode });
        closeModal();
        toast('Import complete');
        navigate('/');
      } catch (err) {
        toast(err.message || 'Import failed');
      }
    };
    overlay.querySelector('#import-merge').addEventListener('click', () => runImport('merge'));
    overlay.querySelector('#import-replace').addEventListener('click', () => runImport('replace'));
  });
}
