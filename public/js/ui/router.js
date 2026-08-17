// Hash 路由。沒有框架、沒有 build，就是監聽 hashchange。
// 用 hash 而不是 history API，這樣 Firebase Hosting 不用特別設定也不會 404。

/** @type {Map<string, {title: string, icon: string, render: (el: HTMLElement) => void}>} */
const routes = new Map();

export function register(path, route) {
  routes.set(path, route);
}

export function routeList() {
  return [...routes.entries()].map(([path, r]) => ({ path, ...r }));
}

export function current() {
  const path = location.hash.replace(/^#/, '') || '/';
  return routes.has(path) ? path : '/';
}

export function go(path) {
  location.hash = path;
}

export function start(onChange) {
  window.addEventListener('hashchange', () => onChange(current()));
  onChange(current());
}
