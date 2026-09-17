// 會改變寫入結果的警告，不可以收進說明泡泡（issue 08 的五條紅線）。
//
// 她要把常駐的說明收進 `?`，但有幾句**藏起來之後，她按下去的結果會跟她以為的
// 不一樣** —— 那幾句必須留在畫面上。repo 自己在那幾處寫死了理由：
//
//   壓表 dayWarnings   「在挑時間的那一刻不講，等於沒講」
//   禁忌紅框           「沒選、或那一台沒事就整塊不畫」（已經是條件顯示，再藏一層等於沒有）
//   本輪可用性 leftover 「改不了但仍然生效 —— 所以要看得見」
//   併進同一天         會改寫那一天的狀態
//   匯入／批次建立     會改變寫進去的東西
//
// 這一支不執行程式，只掃原始碼。說明泡泡是這一輪才有的東西，而下一輪「順手」
// 把一句話收進去是最自然的事 —— 這一支就是在那一刻紅。
//
// **整支刻意一個正規表示式都沒有。** 第一版用 `new RegExp` 組 `tip(` 的樣式，
// 反斜線在寫檔的路上被吃掉一個，組出來的樣式括號不成對 —— 四支測試全紅，
// 看起來像紅線被收進去了，其實是測試自己壞了。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

/** 每一個 `tip(` 呼叫從左括號到對應的右括號那一整段。 */
function tipCalls(src) {
  const out = [];
  let at = src.indexOf('tip(');
  while (at >= 0) {
    let depth = 0;
    let end = src.length - 1;
    for (let i = at + 3; i < src.length; i += 1) {
      if (src[i] === '(') depth += 1;
      else if (src[i] === ')') {
        depth -= 1;
        if (depth === 0) { end = i; break; }
      }
    }
    out.push(src.slice(at, end + 1));
    at = src.indexOf('tip(', at + 4);
  }
  return out;
}

describe('這幾支檔案根本不用說明泡泡', () => {
  // 整支檔案都是「會改變寫入結果」的那一種 —— 連 import 都不該有
  for (const rel of [
    // `ui/components/flags.js` 與 `ui/views/customers.js` 2026-09-17 拿掉了（ADR-0102）：
    // 那兩支裡真正的紅線只有禁忌紅框（noticeBlock，在壓表與來訪編輯器）與數量 0 那一句，
    // 前者不在新增客戶那一頁、後者她指名收成 ⚠。整支禁掉會把純說明一起卡住。
    'ui/views/mergeImport.js',       // 哪幾位已經帶上警示、其餘要自己設…
    'ui/views/customersBulk.js',     // 已經建立 N 位、失敗的那一位…
  ]) {
    test(rel, () => {
      assert.ok(!read(rel).includes('components/tip.js'),
        `${rel} 裡的警告會改變寫進去的東西，不可以收進點了才看得到的泡泡`);
    });
  }
});

describe('用了說明泡泡的頁面，紅線那幾句沒有被收進去', () => {
  // 那兩頁合法地用了 `tip()`（排序說明、「點最上面那一排」），但同一頁上的
  // 警告要留在畫面上。
  const CASES = [
    ['ui/views/schedule.js', ['這天不行', '你這天休假', '併進同一天']],
    ['ui/views/availability.js', ['仍然生效']],
  ];

  for (const [rel, phrases] of CASES) {
    for (const phrase of phrases) {
      test(`${rel}：「${phrase}」`, () => {
        const src = read(rel);
        assert.ok(src.includes(phrase), `${rel} 裡找不到「${phrase}」—— 這一條要跟著改`);
        const calls = tipCalls(src);
        assert.ok(calls.length > 0, `${rel} 應該有用到 tip() —— 沒有的話這一條測不到東西`);
        const leaked = calls.filter((c) => c.includes(phrase));
        assert.deepEqual(leaked, [],
          `「${phrase}」被收進說明泡泡了 —— 它會改變她按下去的結果，要留在畫面上`);
      });
    }
  }
});
