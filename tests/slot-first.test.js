// 「這一天」降成一個抬頭，動得了的只剩「這一段」（2026-09-12 那一輪）。
//
// 她的原話：
//
// > a 盡量能讓使用者一開始分段點就分段點…希望不要點進去就是一整天的，
// >   而是可以直接從畫面分時段點
// > b 如果是一整天的詳情，那也請不要呈現"這一天的待辦"和SOP，直接呈現那幾個
// >   分段讓我點就好
// > e 並且也不需要出現改這一整天的按鈕，如果要改我也會一項一項改
//
// **這一支全部是原始碼掃描**，因為那幾支 view 進不了 node（它們 import
// `data/` 底下的 firebase）。掃描擋得住「有人把那一行改回去」，擋不住
// 「那一行還在、行為照樣是錯的」—— 後者在 `tests-e2e/specs/29-slot-first.spec.js`。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

/** 去掉註解 —— 掃的是程式，不是我們自己寫的說明。 */
function code(rel) {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split(String.fromCharCode(10))
    .filter((l) => !l.trim().startsWith('//'))
    .join(String.fromCharCode(10));
}

describe('進度追蹤與客戶詳情：畫面上就分得出段來點', () => {
  // 那兩頁共用 `progressDayHtml()`（`customer-detail-rework/issues/02` 刻意的）。
  const src = code('ui/views/progress.js');

  test('每一段自己是一顆按鈕，帶得出是哪一段', () => {
    assert.match(src, /data-slot="\$\{slot\.index\}"/,
      '那一列少了 data-slot —— 點下去會退回整天');
    assert.match(src, /data-visit="\$\{esc\(visitId\)\}"/);
  });

  test('`slot.index` 是它在 visit.slots 裡的位置，不是畫出來的第幾列', () => {
    // `dayFor()` 依開始時間排序過，所以兩個數字**不一樣** ——
    // 拿畫出來的第幾列當 focusSlot 會開到別段。
    assert.match(code('domain/progress.js'), /\.map\(\(slot, index\) => \(\{\s*index,/);
  });

  test('外層那一天不再是按鈕 —— button 裡面不能再放 button', () => {
    const block = src.slice(src.indexOf('export function progressDayHtml'));
    const head = block.slice(0, block.indexOf('</'));
    assert.ok(!/<button class="progday"/.test(head),
      '整天還是一顆按鈕 —— 裡面那幾顆段落按鈕會是無效的 HTML');
  });

  test('兩頁的接線都把那一段帶進去', () => {
    for (const rel of ['ui/views/progress.js', 'ui/views/customerDetail.js']) {
      assert.match(code(rel), /dataset\.slot/,
        `${rel} 沒有讀 data-slot —— 那一頁點下去仍然是整天`);
    }
  });
});
