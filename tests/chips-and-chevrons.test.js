// 兩個「同一件事被畫了兩次」的守衛。
//
// ## 一、一列只能有一顆箭頭
//
// `.row-link::after` 本來就會長一顆 `›`（app.css）。呼叫端再手動塞一顆
// `icon('right')` 就會變成兩顆，而**畫面上看起來只像是排版有點怪**。
//
// 這個坑踩過兩次了。app.css 那一段註解記著她 2026-08 的原話：
// 「9 10 11 月就好…為什麼會有兩個 > 的箭頭？」；2026-09-10 她在批次取消
// 那一頁又看到一次：「批次取消搜尋完人名後，人名旁邊有兩個重複的 >」。
//
// ## 二、合作機構那幾顆要自己帶包裝
//
// `alertChips()` 回的是 `<span class="blockchips">…</span>`（橫排包裝），
// 而 `partnerChips()` 以前回的是裸的 `<span class="flag">`。呼叫端把兩者接起來時，
// partner 那幾顆就落在包裝**外面** —— 掉進 column flex 的容器裡就被
// `align-items: stretch` 拉滿整行。她 2026-09-10：「那個綠色框框是一直延伸的誒？」
//
// 實測（390px）壓表卡片牆那一顆是 273px，另外三個呼叫端都是 60px。
// 裸著回傳就是那個 bug 的形狀，所以釘住「它一定自己帶包裝」。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

import { partnerChips, alertChips } from '../public/js/ui/components/flags.js';

const VIEWS = new URL('../public/js/ui/views/', import.meta.url);
// **註解要先去掉。** 這幾支問的是「CSS 裡有沒有這一條宣告」，而這份 CSS 的
// 註解本身就在討論那些宣告（`margin-top: auto` 那一句就長在註解裡）——
// 不去掉的話，把宣告刪光只留註解也會全綠。
const CSS = readFileSync(new URL('../public/css/app.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

describe('一列只有一顆箭頭', () => {
  test('`.row-link` 那幾列沒有人自己再畫一顆 icon(\'right\')', () => {
    const bad = [];
    for (const name of readdirSync(VIEWS)) {
      if (!name.endsWith('.js')) continue;
      const src = readFileSync(new URL(name, VIEWS), 'utf8');
      // 一列的範圍：從 class="row-link" 那個標籤開始，到它自己的 </button> 或 </a>
      for (const m of src.matchAll(/class="row-link[^"]*"[\s\S]*?<\/(?:button|a)>/g)) {
        if (/icon\('right'/.test(m[0])) {
          bad.push(`${name}: ${m[0].split('\n')[0].trim()}`);
        }
      }
    }
    assert.deepEqual(bad, [],
      `這幾列會長出兩顆箭頭（CSS 的 ::after 一顆、手寫的 icon 一顆）：
  ${
        bad.join('\n  ')}`);
  });

  test('`.row-link::after` 還在 —— 拿掉的話就變成一顆都沒有', () => {
    assert.match(CSS, /\.row-link::after\s*\{[^}]*content:\s*'›'/);
  });
});

describe('合作機構那幾顆自己帶包裝', () => {
  const master = ['自然美'];

  test('沒有掛任何機構就回空字串', () => {
    assert.equal(partnerChips([]), '');
    assert.equal(partnerChips(), '');
  });

  test('有掛的時候回的是一個包裝，不是裸的丸子', () => {
    const html = partnerChips(master);
    assert.ok(html.includes('自然美'), '那個名字要畫得出來');
    assert.ok(!/^\s*<span class="flag/.test(html),
      '裸的 `<span class="flag">` 一接進 column flex 的容器就會被拉滿整行 —— '
      + '它要自己帶一層橫排的包裝，跟 `alertChips()` 一樣');
  });

  test('跟警示那一排接起來之後，兩邊都在自己的包裝裡', () => {
    const both = alertChips({ flags: ['體內金屬'], alerts: ['體內金屬'], rows: [] })
      + partnerChips(master);
    // 每一顆 `.flag` 前面都要有一層包裝把它關住 —— 用最外層標籤數來認：
    // 兩個包裝、四個 span（兩個包裝 + 兩顆丸子）
    const wrappers = [...both.matchAll(/<span class="[^"]*chips[^"]*"/g)];
    assert.equal(wrappers.length, 2,
      '警示一個包裝、合作機構一個包裝 —— 少一個就是有一邊裸著');
  });
});

describe('合作機構那顆丸子沒有前綴符號', () => {
  test('`.flag--partner::before` 不再塞一個「＋」', () => {
    const block = CSS.match(/\.flag--partner::before\s*\{[^}]*\}/);
    assert.equal(block, null,
      '她 2026-09-10：「不需要 "+" 自然美」。那個符號讀起來像一顆可以按的新增鈕');
  });
});

describe('丸子不會被容器拉開', () => {
  test('`.flag` 自己聲明 align-self —— 掉進 column flex 也不會被 stretch', () => {
    const block = CSS.match(/^\.flag \{[^}]*\}/m);
    assert.ok(block, '`.flag` 那一條規則不見了？');
    assert.match(block[0], /align-self:\s*flex-start/,
      '這是保險：以後任何一個呼叫端把它丟進 column flex 都不會再被拉滿整行，'
      + '而**這種 bug 從畫面上分不出是誰的錯**');
  });
});

// ---------------------------------------------------------------------------

// 批次取消底下那一條不可以懸空。
//
// `.bulkbar` 是 `position: sticky; bottom: 0`，而 **sticky 只會在捲動時把元素
// 釘住，不會把它往下推**。只勾一天時整頁撐不滿一個視窗，它就停在內容正下方 ——
// 實測 390×844 下它停在 y=395，底下還有 450px 空白，卻帶著上緣邊線與往上打的
// 陰影。那一整套講的是「我貼在畫面底部」，貼不到底就變成一條浮在空氣上的橫條。
// 她 2026-09-10：「這個區域很突兀，有種懸空的感覺?版面很怪?」
//
// 修正是兩格：`.bulkpage` 是至少一個視窗高的直排，`.bulkbar` 的 margin-top 是
// `auto`。**後者一定要寫在 margin 簡寫裡** —— 另外補一行 `margin-top: auto`
// 會被同一條規則後面的簡寫重設掉（改的時候真的踩過一次）。

describe('批次取消底下那一條貼得到底', () => {
  test('`.bulkpage` 是至少一個視窗高的直排', () => {
    const block = CSS.match(/^\.bulkpage \{[^}]*\}/m);
    assert.ok(block, '`.bulkpage` 那一條規則不見了？整頁的包裝是那一條給的');
    assert.match(block[0], /flex-direction:\s*column/);
    assert.match(block[0], /min-height:\s*100dvh/);
  });

  test('`.bulkbar` 的 margin-top 是 auto，而且寫在簡寫裡', () => {
    const block = CSS.match(/^\.bulkbar \{[^}]*\}/m);
    assert.ok(block, '`.bulkbar` 那一條規則不見了？');
    // 最後一個決定 margin-top 的宣告要給 auto
    const decls = [...block[0].matchAll(/margin(-top)?\s*:\s*([^;]+);/g)];
    assert.ok(decls.length, '一個 margin 宣告都沒有？');
    const last = decls.at(-1)[2].trim().split(/\s+/)[0];
    assert.equal(last, 'auto',
      'margin 簡寫會把 margin-top 一起重設 —— 所以 auto 必須在最後一個'
      + '決定 margin-top 的宣告裡，不能另外補一行');
  });

  test('返回鍵不會因為直排而橫跨一整行', () => {
    assert.match(CSS, /\.bulkpage > \.backlink \{[^}]*align-self:\s*flex-start/,
      '`.backlink` 是 inline-flex，變成 flex item 之後會被 stretch 拉滿 ——'
      + '那顆按鈕的感應範圍就橫跨一整行了');
  });
});
