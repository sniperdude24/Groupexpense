import { importData } from '../repo/exportImport.js';
import { openModal, closeModal } from './modal.js';
import { toast } from './helpers.js';
import { navigate } from '../router.js';

/**
 * The one import-confirmation flow, whether the backup arrived as a picked
 * file or a tapped link. Shows what's inside before anything is written, and
 * makes Replace visibly the destructive option.
 */
export function offerImport(data, { source = 'file' } = {}) {
  const counts = `${data.groups?.length ?? 0} groups, ${data.trips?.length ?? 0} trips,
    ${data.expenses?.length ?? 0} expenses`;
  const when = Number.isFinite(data.exported_at)
    ? new Date(data.exported_at).toLocaleDateString()
    : null;

  openModal(`
    <h2>${source === 'link' ? 'Import from backup link' : 'Import data'}</h2>
    <p style="color:var(--text-dim); font-size:14px;">
      ${counts}${when ? ` &middot; exported ${when}` : ''}.
    </p>
    <p style="color:var(--text-dim); font-size:13px;">
      <strong>Merge</strong> skips anything already on this device;
      <strong>Replace</strong> wipes this device first.
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
}
