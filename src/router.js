const routes = [];
let container = null;
let currentCleanup = null;

export function registerRoute(pattern, render) {
  const paramNames = [];
  const regex = new RegExp(
    '^' +
      pattern.replace(/:[a-zA-Z]+/g, (m) => {
        paramNames.push(m.slice(1));
        return '([^/]+)';
      }) +
      '$'
  );
  routes.push({ regex, paramNames, render });
}

function matchRoute(path) {
  for (const route of routes) {
    const m = path.match(route.regex);
    if (m) {
      const params = {};
      route.paramNames.forEach((name, i) => {
        params[name] = decodeURIComponent(m[i + 1]);
      });
      return { render: route.render, params };
    }
  }
  return null;
}

export function navigate(path) {
  if (location.hash.slice(1) === path) {
    handleRoute();
  } else {
    location.hash = path;
  }
}

async function handleRoute() {
  const path = location.hash.slice(1) || '/';
  const match = matchRoute(path);
  if (typeof currentCleanup === 'function') {
    try {
      currentCleanup();
    } catch {
      /* ignore cleanup errors */
    }
    currentCleanup = null;
  }
  if (!match) {
    container.innerHTML = '<div class="screen"><p class="empty">Not found.</p></div>';
    return;
  }
  const result = await match.render(container, match.params);
  if (typeof result === 'function') currentCleanup = result;
}

export function startRouter(rootEl) {
  container = rootEl;
  window.addEventListener('hashchange', handleRoute);
  handleRoute();
}
