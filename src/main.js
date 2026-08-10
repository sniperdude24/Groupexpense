import './style.css';
import { registerSW } from 'virtual:pwa-register';
import { ensureMeta } from './repo/meta.js';
import { startRouter, registerRoute } from './router.js';
import { render as renderHome } from './screens/home.js';
import { render as renderGroupDetail } from './screens/groupDetail.js';
import { render as renderMembers } from './screens/members.js';
import { render as renderTripDetail } from './screens/tripDetail.js';
import { render as renderExpenseForm } from './screens/expenseForm.js';
import { render as renderSettleUp } from './screens/settleUp.js';
import { render as renderPeople } from './screens/people.js';
import { render as renderSettings } from './screens/settings.js';
import { render as renderArchived } from './screens/archived.js';
import { render as renderShareGroup } from './screens/shareGroup.js';
import { render as renderReceiveGroup } from './screens/receiveGroup.js';

// The service worker is the PWA's install/offline story. Inside the native
// (Capacitor) shell it's redundant -- assets are served from local files --
// and a stale SW cache can mask a freshly shipped bundle, so skip it there.
if (!window.Capacitor) {
  registerSW({ immediate: true });
}

registerRoute('/', renderHome);
registerRoute('/groups/:groupId', renderGroupDetail);
registerRoute('/groups/:groupId/members', renderMembers);
registerRoute('/groups/:groupId/settle', renderSettleUp);
registerRoute('/groups/:groupId/share', renderShareGroup);
registerRoute('/receive', renderReceiveGroup);
registerRoute('/trips/:tripId', renderTripDetail);
registerRoute('/trips/:tripId/settle', renderSettleUp);
registerRoute('/trips/:tripId/expenses/new', renderExpenseForm);
registerRoute('/trips/:tripId/expenses/:expenseId/edit', renderExpenseForm);
registerRoute('/people', renderPeople);
registerRoute('/settings', renderSettings);
registerRoute('/archived', renderArchived);

async function boot() {
  await ensureMeta();
  startRouter(document.getElementById('app'));
}

boot();
