// Hash 路由。沒有框架、沒有 build，就是監聽 hashchange。
// 用 hash 而不是 history API，這樣 Firebase Hosting 不用特別設定也不會 404。
//
// 支援一層參數：'/settings/:type' 會匹配 '#/settings/rooms'，
// 並把 'rooms' 當作參數傳給 render。

import { noteRoutePush } from './nav.js';

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

/**
 * 前往某一頁。**這是往前走，不是回上一頁** —— 回上一頁用 `nav.js` 的 `back()`。
 *
 * 兩個動詞分開之後，「客戶列表 → 客戶詳情 → 回客戶列表」在瀏覽器紀錄裡
 * 是兩筆而不是三筆，手機返回鍵才不會把她送回剛剛離開的那一頁。
 */
export function go(path) {
  if (path === location.hash.replace(/^#/, '')) return;
  noteRoutePush();
  location.hash = path;
}

let repaint = null;

export function start(onChange) {
  repaint = onChange;
  window.addEventListener('hashchange', () => onChange(resolve()));
  onChange(resolve());
}

/**
 * 重畫目前這一頁。復原之後畫面上的資料就過期了 ——
 * 讓她看著已經被還原掉的東西是最糟的，那會讓人以為復原沒生效。
 */
export function reload() {
  repaint?.(resolve());
}
