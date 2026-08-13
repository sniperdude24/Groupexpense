import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { ensureMeta } from './repo/meta.js';
import { decodeBackupFragment, FRAGMENT_PREFIX } from './lib/backupLink.js';
import { offerImport } from './ui/importModal.js';
import { toast } from './ui/helpers.js';
import { startRouter, registerRoute, navigate } from './router.js';
import { render as renderHome } from './screens/home.js';
import { render as renderGroupDetail } from './screens/groupDetail.js';
import { render as renderMembers } from './screens/members.js';
import { render as renderTripDetail } from './screens/tripDetail.js';
import { render as renderExpenseForm } from './screens/expenseForm.js';
import { render as renderSettleUp } from './screens/settleUp.js';
import { render as renderPeople } from './screens/people.js';
import { render as renderSettings } from './screens/settings.js';
import { render as renderArchived } from './screens/archived.js';
import { render as renderShare } from './screens/shareGroup.js';
import { render as renderReceiveShare } from './screens/receiveShare.js';

registerSW({ immediate: true });

registerRoute('/', renderHome);
registerRoute('/groups/:groupId', renderGroupDetail);
registerRoute('/groups/:groupId/members', renderMembers);
registerRoute('/groups/:groupId/settle', renderSettleUp);
registerRoute('/groups/:groupId/share', renderShare);
registerRoute('/trips/:tripId/share', renderShare);
registerRoute('/receive', renderReceiveShare);
registerRoute('/trips/:tripId', renderTripDetail);
registerRoute('/trips/:tripId/settle', renderSettleUp);
registerRoute('/trips/:tripId/expenses/new', renderExpenseForm);
registerRoute('/trips/:tripId/expenses/:expenseId/edit', renderExpenseForm);
registerRoute('/people', renderPeople);
registerRoute('/settings', renderSettings);
registerRoute('/archived', renderArchived);

async function boot() {
  await ensureMeta();

  // Ask the browser not to evict our storage under disk pressure. Advisory
  // and one-way -- but this app's data lives nowhere else, so it's worth
  // asking on every boot until granted.
  navigator.storage?.persist?.().catch(() => {});

  // A "#import=..." fragment means someone opened a backup link. Capture it
  // and put a normal route in its place *before* the router starts, so the
  // payload never hits route matching and a reload won't re-offer the import.
  const capturedFragment = () => {
    if (!location.hash.startsWith(FRAGMENT_PREFIX)) return null;
    const fragment = location.hash;
    history.replaceState(null, '', location.pathname + '#/');
    return fragment;
  };

  const offerFromFragment = async (fragment) => {
    try {
      offerImport(await decodeBackupFragment(fragment), { source: 'link' });
    } catch (err) {
      toast(err.message);
    }
  };

  const bootFragment = capturedFragment();
  startRouter(document.getElementById('app'));
  if (bootFragment) await offerFromFragment(bootFragment);

  // A backup link can also arrive in an *already-open* tab -- following one
  // there only fires hashchange, with no reload and so no boot. Same capture,
  // same offer.
  window.addEventListener('hashchange', () => {
    const fragment = capturedFragment();
    if (!fragment) return;
    // The router saw the raw "#import=" hash first and rendered "Not found";
    // the hash is already back to "#/", so this re-renders home beneath the
    // offer instead of leaving that behind a Cancel.
    navigate('/');
    offerFromFragment(fragment);
  });
}

boot();
