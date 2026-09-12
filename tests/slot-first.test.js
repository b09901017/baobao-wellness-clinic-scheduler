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

describe('一整天那一張只是目錄', () => {
  // 她 2026-09-12：「如果是一整天的詳情，那也請不要呈現"這一天的待辦"和SOP，
  // 直接呈現那幾個分段讓我點就好，點進去再呈現那項的詳情」。
  test('沒指定哪一段時，待辦那一塊整塊不畫', () => {
    const src = code('ui/components/taskMirror.js');
    assert.match(src, /if \(!focused\) return '';/,
      '整天那一張還在畫待辦 —— 那一張只是目錄');
  });

  test('抬頭只剩一種說法', () => {
    const src = read('ui/components/taskMirror.js');
    assert.ok(!src.includes("'這一天的待辦'"),
      '「這一天的待辦」不會再出現了 —— 那一塊只長在單段那一張上');
    assert.match(code('ui/components/taskMirror.js'), /這一項的待辦/);
  });

  test('SOP 也一樣：整天那一張一份都不浮', () => {
    const src = code('ui/views/calendar.js');
    assert.match(src, /Number\.isInteger\(focus\)\s*\?\s*hintHtml/,
      'SOP 那一塊沒有跟著段落走 —— 目錄那一張會浮出整天的');
  });

  test('一天只有一段時，那一段就是那一天（不會變成一張空目錄）', () => {
    assert.match(code('domain/visits.js'), /export function focusFor\(/,
      '少了這一支，單段那一天會畫成一張只有一列、什麼都沒有的目錄');
  });

  test('四個入口都走 focusFor()', () => {
    for (const rel of [
      'ui/views/calendar.js', 'ui/views/progress.js',
      'ui/views/home.js', 'ui/views/customerDetail.js',
    ]) {
      assert.match(code(rel), /focusFor\(/, `${rel} 沒有走 focusFor()`);
    }
  });
});

describe('「這一天共用」整個拿掉', () => {
  // 她 2026-09-12：「這一項的代辦中的內容不需要再有小Tooltip說明這一張是這天
  // 共用的，完全沒必要，全部刪除」。
  //
  // **那句話沒有寫錯**：任務只掛 `visitId`，所以在早上那一段勾掉 Examine，
  // 下午那一段也會跟著掉。這是知情的取捨 —— 事實還在，畫面上不再講。
  test('全站搜不到 SHARED_TODO', () => {
    for (const rel of ['domain/todoFlow.js', 'ui/components/taskMirror.js']) {
      assert.ok(!read(rel).includes('SHARED_TODO'), `${rel} 還留著那個標籤`);
    }
  });

  test('那一塊不再算 shared', () => {
    assert.ok(!code('domain/todoFlow.js').includes('shared,'),
      'todosForVisit() 還在每一列身上掛 shared');
  });
});
