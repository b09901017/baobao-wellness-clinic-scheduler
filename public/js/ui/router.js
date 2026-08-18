// Hash 路由。沒有框架、沒有 build，就是監聽 hashchange。
// 用 hash 而不是 history API，這樣 Firebase Hosting 不用特別設定也不會 404。
//
// 支援一層參數：'/settings/:type' 會匹配 '#/settings/rooms'，
// 並把 'rooms' 當作參數傳給 render。

/** @type {Map<string, {title: string, icon?: string, nav?: boolean, render: Function}>} */
const routes = new Map();

export function register(path, route) {
  routes.set(path, route);
}

/** 只有這些會出現在底部導覽。子頁不進導覽列。 */
export function navRoutes() {
  return [...routes.entries()]
    .filter(([, r]) => r.nav !== false)
    .map(([path, r]) => ({ path, ...r }));
}

function match(path, pattern) {
  const a = path.split('/').filter(Boolean);
  const b = pattern.split('/').filter(Boolean);
  if (a.length !== b.length) return null;
  const params = [];
  for (let i = 0; i < b.length; i += 1) {
    if (b[i].startsWith(':')) params.push(decodeURIComponent(a[i]));
    else if (b[i] !== a[i]) return null;
  }
  return params;
}

/** @returns {{path: string, route: object, params: string[]}} */
export function resolve(hash = location.hash) {
  const path = hash.replace(/^#/, '') || '/';

  const exact = routes.get(path);
  if (exact) return { path, route: exact, params: [] };

  for (const [pattern, route] of routes) {
    if (!pattern.includes(':')) continue;
    const params = match(path, pattern);
    if (params) return { path, route, params };
  }

  return { path: '/', route: routes.get('/'), params: [] };
}

/** 導覽列要標示哪一個分頁。子頁會標示它的父分頁。 */
export function activeNavPath(path) {
  const nav = navRoutes().map((r) => r.path);
  if (nav.includes(path)) return path;
  return nav
    .filter((p) => p !== '/' && path.startsWith(p))
    .sort((a, b) => b.length - a.length)[0] ?? '/';
}

export function go(path) {
  location.hash = path;
}

export function start(onChange) {
  window.addEventListener('hashchange', () => onChange(resolve()));
  onChange(resolve());
}
