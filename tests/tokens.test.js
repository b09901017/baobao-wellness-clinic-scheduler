// 設計變數的守衛。
//
// `tokens.css` 有兩組值：淺色（`:root`）與深色（`:root[data-theme='dark']`）。
// ADR-0039 拿掉了「深色直接指到既有語意色」那種別名寫法，換來六個分得開的顏色，
// 代價正是**兩份值要各自維護**。加一個新 token 卻忘了深色那一份，症狀是
// 「切到深色之後某一塊還是淺的」—— 而那只有真的把 app 切成深色才看得到。
//
// 這一支不執行任何程式碼，只讀 CSS 問兩件事，跟 `module-names.test.js`
// 同一個路數。第二段順便盯著行內的開機腳本沒有跟 `ui/theme.js` 走散。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8');

const CSS = read('css/tokens.css');
const LIGHT_MARK = '---------- 淺色 ----------';
const DARK_MARK = "root[data-theme='dark']";

/** 一段 CSS 裡定義了哪些變數，以及它們的值。 */
function varsIn(text) {
  const out = new Map();
  for (const m of text.matchAll(/^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm)) {
    out.set(m[1], m[2].trim());
  }
  return out;
}

describe('淺色與深色兩份值', () => {
  const light = varsIn(CSS.slice(CSS.indexOf(LIGHT_MARK), CSS.indexOf(DARK_MARK)));
  const dark = varsIn(CSS.slice(CSS.indexOf(DARK_MARK)));

  test('兩段都找得到', () => {
    assert.ok(light.size > 30, '淺色那一段不見了？');
    assert.ok(dark.size > 30, '深色那一段不見了？');
  });

  test('淺色定義的每一個顏色，深色都要有一份', () => {
    // 值本身就是 `var(--別的)` 的不用：它跟著它指到的那一個一起變，
    // 而那一個已經在這份名單裡了（例：--visit-cancelled → --text-mute）。
    const missing = [...light]
      .filter(([, value]) => !value.startsWith('var('))
      .map(([name]) => name)
      .filter((name) => !dark.has(name));

    assert.deepEqual(
      missing,
      [],
      `這些 token 只有淺色那一份，切到深色之後那一塊還是淺的：${missing.join(', ')}`,
    );
  });

  test('深色沒有多出淺色沒有的 token —— 那種只在深色下才長出來的東西沒有人在用', () => {
    const orphans = [...dark.keys()].filter((name) => !light.has(name));
    assert.deepEqual(orphans, [], `深色多出來的：${orphans.join(', ')}`);
  });

  test('深色只有一份，沒有 @media 的複本', () => {
    // 兩份就會有一份忘了跟。第一次繪製之前由 <head> 的行內腳本蓋 data-theme，
    // 所以不需要 media query 的備援（ADR-0055）。
    // 註解裡提到它是可以的 —— 那一段正是在解釋為什麼不用它。
    const code = CSS.replace(/\/\*[\s\S]*?\*\//g, '');
    assert.equal(
      /@media[^{]*prefers-color-scheme/.test(code),
      false,
      'tokens.css 又出現 @media (prefers-color-scheme) 了 —— 深色的值會變成兩份',
    );
  });
});

describe('開機時蓋上去的那一段', () => {
  const THEME = read('js/ui/theme.js');
  const boots = [read('index.html'), read('form.html')];

  test('兩個 HTML 都在第一次繪製之前蓋 data-theme', () => {
    for (const html of boots) {
      assert.match(html, /documentElement\.dataset\.theme/);
      // 不可以是 module —— module 是 defer 的，來不及，畫面會閃一下白的。
      // **換行用 `\s*` 帶過，不要寫死 `\n`**：Windows 上簽出來的是 CRLF，
      // 寫死換行字元的比對只有在那台會紅，而它紅的原因跟主題一點關係都沒有。
      assert.match(
        html,
        /<script>\s*\(function \(\) \{/,
        '開機那一段要是行內的普通 script',
      );
    }
  });

  test('key 與三個選項跟 ui/theme.js 一致', () => {
    assert.match(THEME, /THEME_KEY = 'scheduler\.theme'/);
    assert.match(boots[0], /localStorage\.getItem\('scheduler\.theme'\)/,
      'index.html 的行內腳本用的 key 跟 ui/theme.js 走散了');

    for (const value of ['system', 'light', 'dark']) {
      assert.ok(THEME.includes(`value: '${value}'`), `ui/theme.js 少了 ${value}`);
      assert.ok(boots[0].includes(`'${value}'`), `index.html 的行內腳本少了 ${value}`);
    }
  });

  test('深色的網址列顏色兩邊一樣', () => {
    const fromModule = /BAR_COLOR = \{ light: '(#[0-9a-f]{6})', dark: '(#[0-9a-f]{6})' \}/.exec(THEME);
    assert.ok(fromModule, 'ui/theme.js 的 BAR_COLOR 形狀變了');
    for (const html of boots) {
      assert.ok(html.includes(fromModule[1]) && html.includes(fromModule[2]),
        '行內腳本的網址列顏色跟 ui/theme.js 對不起來');
    }
  });
});
