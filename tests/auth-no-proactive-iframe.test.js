// 開機登入不先載 Google 的那一塊（ADR-0173，`.scratch/ipad-photo-and-speed/issues/02`）。
//
// `getAuth()` 帶著彈窗／轉頁登入用的那一塊，在 iPad、手機、Safari 上一打開就先載它才還原登入
// （她 iPad 上「登入」那一格 1.4～3.1 秒）。改成開機不帶、按「登入」時才帶，這裡盯三件改了一邊另一邊不會自己跟的事：
//
// 1. `firebase.js` 不叫 `getAuth()`、`initializeAuth()` 不帶 `popupRedirectResolver`（帶了就又先載）
// 2. 存登入的地方跟 `getAuth()` 同一組、同一個順序 —— 少一個或換順序，既有的登入讀不到、每一台都要重新登入
// 3. 兩條登入都自己帶那一塊、轉頁回來那一次有人收（`getRedirectResult()`）—— 少了的話主畫面那一顆登入之後回不來
//
// 開機真的沒有打到那一塊，量的是 E2E `81` 的 P14（用 iPad 的 UA）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const code = (path) => readFileSync(fromRoot(path), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/\s\/\/.*$/gm, '');

const FIREBASE = code('public/js/data/firebase.js');
const AUTH = code('public/js/data/auth.js');

describe('開機登入不先載 Google 的那一塊', () => {
  test('firebase.js 不叫 getAuth()，initializeAuth() 不帶 popupRedirectResolver', () => {
    assert.doesNotMatch(FIREBASE, /\bgetAuth\b/);
    const init = FIREBASE.match(/initializeAuth\(app,\s*\{([\s\S]*?)\}\);/)?.[1];
    assert.ok(init, 'firebase.js 找不到 initializeAuth(app, {…})');
    assert.doesNotMatch(init, /popupRedirectResolver/);
  });

  test('存登入的地方跟 getAuth() 同一組、同一個順序（既有的登入照樣讀得到）', () => {
    const list = FIREBASE.match(/persistence:\s*\[([^\]]+)\]/)?.[1].split(',').map((s) => s.trim()).filter(Boolean);
    assert.deepEqual(list, ['indexedDBLocalPersistence', 'browserLocalPersistence', 'browserSessionPersistence']);
  });

  test('兩條登入都自己帶 browserPopupRedirectResolver', () => {
    assert.match(AUTH, /signInWithRedirect\(auth, provider, browserPopupRedirectResolver\)/);
    assert.match(AUTH, /signInWithPopup\(auth, provider, browserPopupRedirectResolver\)/);
  });

  test('轉頁回來那一次有人收，而且 watchAuth() 等它收完才開始聽', () => {
    assert.match(AUTH, /getRedirectResult\(getAuthInstance\(\), browserPopupRedirectResolver\)/);
    const watch = AUTH.slice(AUTH.indexOf('export function watchAuth'));
    assert.ok(watch.indexOf('finishRedirect()') >= 0, 'watchAuth() 沒有先收轉頁登入');
    assert.ok(watch.indexOf('finishRedirect()') < watch.indexOf('onAuthStateChanged('), '要先收完再開始聽');
  });
});
