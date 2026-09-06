// 「加購一整個方案」那一張面板的規則（`ui/components/planTweak.js`）。
//
// 跟 `components/buy.js` 同一個分法：那一支的**上半段沒有一行碰 DOM**，
// 這裡測的就是那一段。下半段的 `wire()` 是接線，薄到只剩
// 「讀表單 → 叫上半段 → 交給呼叫端重畫」。
//
// 她的原話（2026-09-06）：「我希望方案也可以微調，就是這個客戶的某個方案中的
// 例如復能三選一(60)少幾次然後換成其他的之類的」。

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';

import * as pt from '../public/js/ui/components/planTweak.js';

const PLANS = [
  {
    id: 'p-a',
    name: 'A 方案',
    items: [
      { type: 'single', courseId: 'c-1', label: '健檢', qty: 2, durationMin: 120 },
      { type: 'pool', label: '復能三選一(60)', qty: 20, durationMin: 60, optionEquipmentIds: ['e1', 'e2'] },
      { type: 'single', courseId: 'c-2', label: 'ILIB(60)', qty: 12, durationMin: 60 },
    ],
  },
  { id: 'p-b', name: 'B 方案', items: [{ type: 'single', courseId: 'c-1', label: '健檢', qty: 1 }] },
  { id: 'p-gone', name: '停用的', active: false, items: [] },
];

const draft = (over = {}) => ({ ...pt.blank(PLANS), ...over });

describe('展開', () => {
  test('空白草稿預設選第一張還在用的範本', () => {
    assert.equal(pt.blank(PLANS).planId, 'p-a');
    assert.equal(pt.blank(PLANS).quantity, 1);
    assert.deepEqual(pt.blank(PLANS).extras, []);
  });

  test('停用的範本不會被預設選中，也不出現在那一排', () => {
    assert.equal(pt.blank([PLANS[2], PLANS[1]]).planId, 'p-b');
    assert.ok(!pt.fields(draft(), PLANS).includes('停用的'));
  });

  test('買幾套會乘進每一項', () => {
    const rows = pt.rowsOf(draft({ quantity: 3 }), PLANS);
    assert.deepEqual(rows.map((r) => r.totalQty), [6, 60, 36]);
    assert.deepEqual(rows.map((r) => r.sourcePlanQty), [6, 60, 36]);
  });

  test('沒選範本或買 0 套就沒有東西可以列', () => {
    assert.deepEqual(pt.rowsOf(draft({ planId: null }), PLANS), []);
    assert.deepEqual(pt.rowsOf(draft({ quantity: 0 }), PLANS), []);
  });
});

describe('微調', () => {
  test('改次數只影響那一項', () => {
    const d = draft({ qtyByIndex: { 1: 15 } });
    assert.deepEqual(pt.payload(d, PLANS).map((r) => r.totalQty), [2, 15, 12]);
  });

  test('改成 0 就是不要那一項 —— 不用另外一顆垃圾桶', () => {
    const d = draft({ qtyByIndex: { 0: 0 } });
    assert.deepEqual(pt.payload(d, PLANS).map((r) => r.label), ['復能三選一(60)', 'ILIB(60)']);
  });

  test('方案本來寫幾次跟著存 —— 幾個月後她要看得出那是談出來的還是打錯的', () => {
    const [, rehab] = pt.payload(draft({ qtyByIndex: { 1: 15 } }), PLANS);
    assert.equal(rehab.totalQty, 15);
    assert.equal(rehab.sourcePlanQty, 20);
  });

  test('沒動過的那幾項 sourcePlanQty 等於 totalQty', () => {
    for (const row of pt.payload(draft(), PLANS)) {
      assert.equal(row.sourcePlanQty, row.totalQty);
    }
  });

  test('那一列旁邊只在跟方案不一樣的時候才講一句話', () => {
    const row = { label: '復能三選一(60)', totalQty: 20 };
    assert.equal(pt.noteFor(row, 20), '', '一樣就不要把同一個數字講兩遍');
    assert.equal(pt.noteFor(row, 15), '方案本來 20 次');
    assert.equal(pt.noteFor(row, 0), '不建立');
  });

  test('改過幾樣要數得出來 —— 收起來的東西不能安靜地生效', () => {
    assert.equal(pt.tweakCount(draft(), PLANS), 0);
    assert.equal(pt.tweakCount(draft({ qtyByIndex: { 1: 15 } }), PLANS), 1);
    assert.equal(pt.tweakCount(draft({ qtyByIndex: { 1: 15, 0: 0 } }), PLANS), 2);
    assert.equal(
      pt.tweakCount(draft({ extras: [{ label: 'INDIBA(30)', totalQty: 5 }] }), PLANS), 1,
    );
  });

  test('畫面上要印出改過幾樣，沒改就不印', () => {
    assert.ok(!pt.fields(draft(), PLANS).includes('上面改過'));
    assert.ok(pt.fields(draft({ qtyByIndex: { 1: 15 } }), PLANS).includes('上面改過 1 項'));
  });

  test('面板上要講出範本不會變 —— ADR-0003', () => {
    assert.ok(pt.fields(draft(), PLANS).includes('方案範本一個字都不會變'));
  });
});

describe('加一項', () => {
  test('加購的那幾筆接在方案後面，而且是額度的形狀', () => {
    const extra = {
      type: 'pool', label: 'INDIBA(30)', totalQty: 5, durationMin: 30,
      optionEquipmentIds: ['e-indiba'],
    };
    const rows = pt.payload(draft({ extras: [extra] }), PLANS, { purchasedAt: '2026-03-12' });
    assert.equal(rows.length, 4);
    const last = rows.at(-1);
    assert.equal(last.label, 'INDIBA(30)');
    assert.equal(last.purchasedAt, '2026-03-12');
    assert.equal(last.sourcePlanName, null, '單項加購不是從範本展開的');
    assert.equal(last.doneCount, 0);
  });

  test('購買日蓋到每一筆上，包含方案展開的那幾筆', () => {
    for (const row of pt.payload(draft(), PLANS, { purchasedAt: '2026-03-12' })) {
      assert.equal(row.purchasedAt, '2026-03-12');
    }
  });
});

describe('存得下去嗎', () => {
  test('沒選方案就擋', () => {
    assert.deepEqual(pt.validate(draft({ planId: null }), PLANS), ['先選一個方案']);
  });

  test('買 0 套就擋', () => {
    assert.deepEqual(pt.validate(draft({ quantity: 0 }), PLANS), ['「買幾套」要大於 0']);
  });

  test('每一項都改成 0 就擋 —— 那樣按下去什麼都不會發生', () => {
    const d = draft({ qtyByIndex: { 0: 0, 1: 0, 2: 0 } });
    assert.ok(pt.validate(d, PLANS)[0].includes('沒有東西可以建立'));
  });

  test('只留一項也存得下去', () => {
    assert.deepEqual(pt.validate(draft({ qtyByIndex: { 0: 0, 1: 0 } }), PLANS), []);
  });
});

describe('讀表單', () => {
  // `values()` 讀的是真的 DOM（`f.readForm()`），所以這裡只驗它那個判斷：
  // **哪幾項算她動過的**。全部記下來的話，她換一個方案時舊的數字會蓋到
  // 新方案的同一個位置上，而那兩項不是同一件事。
  test('只記跟方案不一樣的那幾項', () => {
    const rows = pt.rowsOf(draft(), PLANS);
    const typed = [2, 15, 12];
    const picked = {};
    rows.forEach((row, i) => {
      if (typed[i] !== row.totalQty) picked[i] = typed[i];
    });
    assert.deepEqual(picked, { 1: 15 });
  });

  test('換方案之後那幾個數字要作廢 —— 不然舊的第 2 項會蓋到新的第 2 項', () => {
    // A 方案第 2 項是復能 20 次，B 方案只有一項（健檢 1 次）。
    // 帶著 `{1: 15}` 換過去的話，B 方案根本沒有第 2 項。
    const carried = draft({ planId: 'p-b', qtyByIndex: { 1: 15 } });
    assert.deepEqual(pt.payload(carried, PLANS).map((r) => r.totalQty), [1]);
  });
});
