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

// 這一輪動到 UI 的地方（名稱怎麼寫、備忘錄的分段切換、批次取消、抽屜收合）
// 都要守住同一條線：**用既有的動作 token，不新增第四種時長。**
//
// 新增一個 motion token 的代價是淺色深色兩份都要改（CLAUDE.md 那一列），
// 而且下一個人會不知道該用哪一個。三段時長對到三件事，那個對照表就是判準。
describe('動作與觸控的底線', () => {
  const CSS = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  const TOKENS = readFileSync(new URL('../public/css/tokens.css', import.meta.url), 'utf8');

  test('只有三種時長，一種曲線', () => {
    const names = [...TOKENS.matchAll(/--motion-[a-z]+:/g)].map((m) => m[0]);
    assert.deepEqual([...new Set(names)].sort(),
      ['--motion-base:', '--motion-fast:', '--motion-slow:']);
  });

  // **只盯這一輪加的那幾塊。** 樣式表裡還有九條 2026-08 寫死的秒數
  // （`0.16s`、`0.15s` 那些），把它們一起改是一次沒有人要求的重構，
  // 而且會動到每一個畫面的手感。這一支要防的是**新的**再長出來。
  test('這一輪新加的過場都走 --motion-*', () => {
    const BLOCKS = ['.namerow__edit', '.seg__btn', '.bulkrow', '.bulkrow__box', '.bulkcal__day'];
    for (const cls of BLOCKS) {
      const at = CSS.indexOf(`${cls} {`);
      assert.ok(at > 0, `找不到 ${cls}`);
      const body = CSS.slice(at, CSS.indexOf('}', at));
      if (!body.includes('transition:')) continue;
      assert.match(body, /var\(--motion-/, `${cls} 的過場要用 --motion-*`);
    }
  });

  test('`prefers-reduced-motion` 那一段還在，而且是對 * 生效的', () => {
    assert.match(CSS, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(CSS, /transition-duration: 0\.01ms !important/);
  });

  test('這一輪新加的過場沒有人用 !important 蓋掉它', () => {
    // 蓋掉的話那一段動畫在她開了「減少動態效果」之後照樣會動
    const forced = [...CSS.matchAll(/transition[^;]*!important/g)].map((m) => m[0]);
    assert.deepEqual(forced.filter((t) => !t.includes('0.01ms')), []);
  });

  test('新加的可點元素都撐得到 44px', () => {
    // 視覺上可以小，靠 ::after 把感應範圍撐回去（`.drawer__grip` 的做法）
    for (const cls of ['.namerow__edit', '.seg__btn']) {
      const at = CSS.indexOf(`${cls}::after`);
      assert.ok(at > 0, `${cls} 少了撐開感應範圍的 ::after`);
    }
    // 這幾種本來就給得起整列的高度
    for (const cls of ['.bulkrow', '.bulkcal__day']) {
      const at = CSS.indexOf(`${cls} {`);
      const body = CSS.slice(at, at + 500);
      assert.match(body, /min-height: var\(--tap-min\)/, `${cls} 要有 --tap-min`);
    }
  });
});

// 她 2026-09-08：「壓表點月份進去，左上角的那個返回 壓表 有點太突兀了，
// 請參考其他頁面的那個返回。」
//
// 根因不在那一頁：`.backlink` 全站 29 個地方，28 個是 `<a>`、一個是 `<button>`，
// 而那條規則沒有寫按鈕的重置 —— `<a>` 不需要，`<button>` 頂著瀏覽器預設的
// 灰底、邊框與系統字。
//
// **壓表那一頁必須是 `<button>`**：它退的是 `pushLayer()` 疊的一層，
// 不是一個網址（`view.batchId` 不在網址裡）。改成 `<a>` 會讓左上角與返回鍵
// 走兩條不同的路，而 ADR-0048 要的是同一條。所以修的是 CSS。
describe('返回那一條在 <button> 上也要長得一樣（issue 03）', () => {
  const CSS = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8');
  const at = CSS.indexOf('.backlink {');
  const body = CSS.slice(at, CSS.indexOf('}', at));

  test('找得到 .backlink', () => {
    assert.ok(at > 0);
  });

  for (const prop of ['background', 'border', 'padding', 'font:']) {
    test(`有 ${prop} —— 少了它 <button> 會長出瀏覽器預設的樣子`, () => {
      assert.ok(body.includes(prop), `.backlink 少了 ${prop}`);
    });
  }

  test('不可以自己長一個往前的箭頭 —— 方向要是對的', () => {
    assert.ok(!CSS.includes('.backlink::after'));
  });
});
