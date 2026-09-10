// 畫面上只有兩個單位：這一段、這一天。「筆」不上畫面（ADR-0087）。
//
// 她 2026-09-10：
//
// > 我長按然後選取消一整天（N段）出來的提示應該是取消...整天的來訪？ 而不是這一筆。
// > 一天一筆 所以取消整筆就是取消整天，寫"整筆"會讓使用者看不懂，改成寫整天，
// > 也全域檢查，有沒有地方也是寫"筆"的，確認到底是這一天，還是這一項
//
// 修之前同一個動作有三種講法：按鈕寫「取消一整天（3 段）」、確認框標題寫「取消
// 王小明這一筆來訪？」、確認鈕寫「取消這筆來訪」，內文一次都沒提到「這一天」。
//
// 判準只有一句：**這一行講的範圍，跟它按下去真的會動到的資料，是同一個嗎？**
//
// 「來訪」這個詞沒有被禁用（CONTEXT.md）—— 拿掉的是「筆」這個結構單位。
// 資料健檢與稽核紀錄是例外：那兩頁本來就在講資料。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { visitActions } from '../public/js/domain/visits.js';
import { reviewWarnings, cancelConsequences } from '../public/js/domain/consequences.js';

const TODAY = '2026-09-10';
const slot = (o = {}) => ({ startsAt: '09:00', endsAt: '10:00', status: 'confirmed', ...o });
const visit = (slots, o = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '王小明', date: '2026-09-15',
  status: 'confirmed', slots, ...o,
});
const TWO = () => visit([slot(), slot({ startsAt: '10:00', endsAt: '11:00' })]);
const labels = (v, slotIndex) => visitActions(v, { today: TODAY, slotIndex }).map((a) => a.label);

describe('長按選單講的範圍跟它真的會動到的一樣', () => {
  test('帶了 slotIndex 的「改」只改那一段，所以寫「改這一段」', () => {
    assert.ok(labels(TWO(), 0).includes('改這一段'), labels(TWO(), 0).join('、'));
  });

  test('沒帶 slotIndex 的「改」開的是整天，所以寫「改這一天」', () => {
    assert.ok(labels(TWO(), null).includes('改這一天'), labels(TWO(), null).join('、'));
  });

  test('那一天只有一段時，取消那一顆寫「取消這一天」', () => {
    const one = visit([slot()]);
    assert.ok(labels(one, 0).includes('取消這一天'), labels(one, 0).join('、'));
  });

  test('哪一顆都不寫「筆」', () => {
    for (const [v, i] of [[TWO(), 0], [TWO(), null], [visit([slot()]), 0]]) {
      for (const label of labels(v, i)) assert.doesNotMatch(label, /筆/, label);
    }
  });
});

describe('取消一整天的確認框，第一句就講範圍', () => {
  test('第一句寫「這一整天」', () => {
    const lines = cancelConsequences({ visit: TWO(), coursesById: {}, tasks: [] });
    assert.match(lines[0], /這一整天/, lines[0]);
  });

  test('一個「筆」都沒有', () => {
    const lines = cancelConsequences({ visit: TWO(), coursesById: {}, tasks: [] });
    for (const line of lines) assert.doesNotMatch(line, /筆/, line);
  });
});

describe('「這一段先看一下」不是在講時段', () => {
  test('一件提醒的標題寫「這一件」—— 在來訪表單上「這一段」一定會被讀成時段', () => {
    assert.equal(reviewWarnings(['一件事']).title, '這一件先看一下');
  });
});

// ---------------------------------------------------------------------------
// 內嵌在樣板字串裡的那幾句：掃原始碼。**先去掉註解** —— 那幾支的註解正在
// 討論這些舊句子（「以前這裡只有一顆『取消這一筆』」），不去掉就會誤判。
// ---------------------------------------------------------------------------

const FILES = [
  'js/domain/visits.js', 'js/domain/consequences.js',
  'js/ui/views/calendar.js', 'js/ui/views/visitEditor.js', 'js/ui/views/schedule.js',
  'js/ui/views/home.js', 'js/ui/views/health.js',
  'js/ui/components/card.js', 'js/ui/components/form.js',
];

/** 去掉區塊註解與行尾註解（`https://` 那種前面不是空白的不算）。 */
const code = (rel) => readFileSync(new URL(`../public/${rel}`, import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|\s)\/\/.*$/gm, '$1');

/**
 * 修之前畫面上真的會出現的句子。每一句都是「筆」被當成單位講給她聽。
 *
 * **「改這一筆」只認讀取卡片那一顆（`aria-label=`）**：行事備註的長按選單
 * （`calendar.js` 的 `eventQuickActions()`）正當地寫「改這一筆」—— 那一筆是一則
 * 行事備註，不是來訪，ADR-0087 明寫不在範圍內。來訪選單的那一顆由上面
 * `visitActions()` 那幾支直接盯著，不靠掃字串。
 */
const GONE = [
  'aria-label="改這一筆"', '取消這一筆', '這一筆來訪？', '取消這筆來訪', '這筆沒有任何時段', '排一筆',
  '新的一筆', '重新排一筆', '這筆已經完成', '刪除這筆', '這一段先看一下', '那一筆本來',
  '日曆上這一筆', '那一筆來訪不會', '整筆取消了', '找不到這一筆來訪', '這一筆到現在',
  '另一筆來訪', '看這一筆', '併進同一天那一筆', '這天那一筆', '這一筆是「',
];

describe('畫面上的字串裡沒有「筆」這個單位', () => {
  for (const rel of FILES) {
    test(rel, () => {
      const src = code(rel);
      const left = GONE.filter((s) => src.includes(s));
      assert.deepEqual(left, [], `${rel} 還留著：${left.join('、')}`);
    });
  }
});
