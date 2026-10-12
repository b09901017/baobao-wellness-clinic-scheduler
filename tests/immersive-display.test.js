// 裝到主畫面的那一顆是全螢幕的（ADR-0147）。
//
// 這裡盯的是三件「改了一邊、另一邊不會自己跟」的事：
//
// 1. manifest 寫哪一種 display，`data/auth.js` 問「是不是裝到主畫面的」時就要認得那一種 ——
//    不認得的話 Android 上裝好的那一顆會被當成瀏覽器分頁，登入從 redirect 悄悄換成 popup。
// 2. 全螢幕時畫面畫到前鏡頭底下，那個高度只有 `viewport-fit=cover` 的頁面拿得到。
// 3. 讓開最上面那一條的是殼（`.app__body`），不是捲動區的內距 —— 寫回捲動區的話內容會從鏡頭底下穿過去。
//
// 畫面上真的讓開了沒有，量的是 E2E `66-immersive-top-inset`（桌機瀏覽器那個值永遠是 0，這裡量不到）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const MANIFEST = JSON.parse(readFileSync(fromRoot('public/manifest.webmanifest'), 'utf8'));
const INDEX = readFileSync(fromRoot('public/index.html'), 'utf8');
const AUTH = readFileSync(fromRoot('public/js/data/auth.js'), 'utf8');
const CSS = readFileSync(fromRoot('public/css/app.css'), 'utf8');

/** 某一條規則的本體（第一個完全相符的選擇器）。 */
function ruleOf(selector) {
  const at = CSS.search(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{`));
  assert.notEqual(at, -1, `app.css 找不到 ${selector} 那一條`);
  return CSS.slice(at, CSS.indexOf('}', at));
}

describe('全螢幕', () => {
  test('manifest 寫的是 fullscreen', () => {
    assert.equal(MANIFEST.display, 'fullscreen');
  });

  test('問「是不是裝到主畫面的」時，manifest 那一種與 iOS 退回的那一種都認得', () => {
    const query = AUTH.match(/const INSTALLED = '([^']+)';/)?.[1];
    assert.ok(query, 'auth.js 找不到 INSTALLED');
    assert.ok(query.includes(`(display-mode: ${MANIFEST.display})`), `INSTALLED 不認得 ${MANIFEST.display}`);
    assert.ok(query.includes('(display-mode: standalone)'), 'iOS 不認得 fullscreen、退回 standalone');
    // 另外寫一句 `(display-mode: …)` 的話，那一句不會跟著 manifest 改
    assert.equal(AUTH.split('display-mode:').length - 1, 2, 'auth.js 裡 display-mode 只准出現在 INSTALLED 那一行');
  });

  test('index.html 是 viewport-fit=cover（沒有它拿不到前鏡頭的高度，最上面會是一條黑的）', () => {
    assert.match(INDEX, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  });

  test('啟動那一瞬間的顏色跟 app 的同一個', () => {
    const meta = INDEX.match(/<meta name="theme-color" content="([^"]+)"/)?.[1];
    assert.equal(MANIFEST.theme_color, meta);
  });
});

describe('最上面那一條由殼讓開', () => {
  test('.app__body 讓出前鏡頭的高度', () => {
    assert.match(ruleOf('.app__body'), /padding-top: env\(safe-area-inset-top\);/);
  });

  test('捲動區自己不讓（讓了內容會從鏡頭底下穿過去）', () => {
    assert.ok(!ruleOf('.app__main').includes('safe-area-inset-top'));
  });
});
