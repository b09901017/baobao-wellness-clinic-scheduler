// 稽核紀錄的翻譯。SPEC 第 6.2 節。
//
// 這一支盯的是「差異表不能騙人」：沒動到的欄位不可以被報成改動，
// 動到的欄位一定要出現。出事時她是靠這張表判斷資料怎麼變成現在這樣的。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeAction, describeTarget, fieldLabel, changedFields, formatValue,
  describeEvent, subjectOf, groupByDay,
} from '../public/js/domain/audit.js';

describe('動作與目標', () => {
  test('翻成人話', () => {
    assert.equal(describeAction('visits.create'), '新增來訪');
    // repo 寫的是完整路徑，子集合要取最後一段才對得出名字
    assert.equal(describeAction('customers/x/entitlements.update'), '修改額度');
    assert.equal(describeAction('config/app/courses.create'), '新增課程');
    assert.equal(describeAction('tasks.softDelete'), '刪除任務');
  });

  test('不認得的原樣顯示，不要吞掉', () => {
    assert.equal(describeAction('weird.thing'), 'thingweird');
    assert.equal(describeAction(null), '異動資料');
  });

  test('目標看路徑倒數第二段，子集合才對得出來', () => {
    assert.equal(describeTarget('visits/v1'), '來訪');
    assert.equal(describeTarget('customers/c1'), '客戶');
    assert.equal(describeTarget('customers/c1/entitlements/e1'), '額度');
    assert.equal(describeTarget('customers/c1/availability/a1'), '本輪可用性');
    assert.equal(describeTarget('config/app/courses/c1'), '課程');
  });

  test('欄位名用 CONTEXT.md 的詞，沒列到的原樣顯示', () => {
    assert.equal(fieldLabel('doneCount'), '已完成次數');
    assert.equal(fieldLabel('somethingNew'), 'somethingNew');
  });
});

describe('改了什麼', () => {
  test('以 after 的鍵為準 —— 這次沒動到的欄位不可以被報成改動', () => {
    const fields = changedFields({
      before: { name: '客戶一', phone: '0900', notes: '沒變' },
      after: { phone: '0911' },
    });
    assert.deepEqual(fields.map((f) => f.key), ['phone']);
    assert.equal(fields[0].before, '0900');
    assert.equal(fields[0].after, '0911');
    assert.equal(fields[0].label, '電話');
  });

  test('值一樣就不算改動', () => {
    assert.deepEqual(changedFields({ before: { a: 1 }, after: { a: 1 } }), []);
  });

  test('時間戳這類每次都變的欄位不列出來，免得淹掉真正的改動', () => {
    const fields = changedFields({
      before: { status: 'confirmed' },
      after: { status: 'done', updatedAt: 'x', createdAt: 'y', createdBy: 'z' },
    });
    assert.deepEqual(fields.map((f) => f.key), ['status']);
  });

  test('陣列與物件比內容，不比參照', () => {
    assert.deepEqual(changedFields({ before: { flags: ['體內金屬'] }, after: { flags: ['體內金屬'] } }), []);
    assert.equal(changedFields({ before: { flags: [] }, after: { flags: ['體內金屬'] } }).length, 1);
  });

  test('新增沒有 before，整份都算改動', () => {
    const fields = changedFields({ before: null, after: { name: '客戶一', priority: 3 } });
    assert.deepEqual(fields.map((f) => f.key).sort(), ['name', 'priority']);
  });

  test('after 不是物件時回空陣列，不要爆', () => {
    assert.deepEqual(changedFields({ after: null }), []);
    assert.deepEqual(changedFields({}), []);
    assert.deepEqual(changedFields(null), []);
  });
});

describe('值怎麼顯示', () => {
  test('空值、布林、陣列、物件各自有講法', () => {
    assert.equal(formatValue(null), '（空的）');
    assert.equal(formatValue(''), '（空字串）');
    assert.equal(formatValue(true), '是');
    assert.equal(formatValue(false), '否');
    assert.equal(formatValue([1, 2, 3]), '3 筆');
    assert.equal(formatValue([]), '（沒有）');
    assert.equal(formatValue({ a: 1 }), '（一組資料）');
    assert.equal(formatValue({ seconds: 1 }), '（時間）');
    assert.equal(formatValue('done'), 'done');
    assert.equal(formatValue(0), '0');
  });
});

// ---------- 一則稽核 → 一句話 ----------
//
// 她打開這一頁是在問「我剛剛做了什麼」或「這筆怎麼變成這樣的」。
// 原本每一列印的是 `customers/AbC123/entitlements/XyZ789` 加一排
// `（一組資料）`，兩個問題都答不出來。這一段盯的是那句話講得像人話。

describe('一句話講完一則稽核', () => {
  const ev = (action, before, after, targetPath = 'visits/v1') =>
    ({ action, targetPath, before, after });

  test('狀態變了就講變成什麼 —— 次數是跟著它扣的', () => {
    const line = describeEvent(ev('visits.update',
      { customerName: '客戶A', status: 'confirmed' },
      { status: 'done' }));
    assert.equal(line, '客戶A的來訪改成已完成');
  });

  // 狀態的字從 domain/visits.js 的 STATUS_VIEW 來，不在這裡再寫一份
  // （CLAUDE.md：來訪狀態的標籤只改那一支）。
  test('狀態的字跟日曆、客戶詳情用的是同一份', () => {
    const line = describeEvent(ev('visits.update',
      { customerName: '客戶A', status: 'pending_confirm' },
      { status: 'no_show' }));
    assert.match(line, /未到$/);
  });

  test('勾任務就說勾掉了什麼', () => {
    const line = describeEvent(ev('tasks.update',
      { customerName: '客戶A', kind: 'Examine', done: false },
      { done: true, kind: 'Examine' }, 'tasks/t1'));
    assert.equal(line, '勾掉客戶A的Examine');
  });

  test('次數只講數字怎麼變，不講欄位叫什麼', () => {
    const line = describeEvent(ev('customers/c1/entitlements.update',
      { label: '復能', doneCount: 7 },
      { doneCount: 8 }, 'customers/c1/entitlements/e1'));
    assert.match(line, /額度「復能」/);
    assert.match(line, /已完成次數 7 → 8/);
  });

  test('新增與刪除講得出是誰', () => {
    assert.equal(
      describeEvent(ev('customers.create', null, { name: '客戶A' }, 'customers/c1')),
      '新增客戶「客戶A」',
    );
    assert.equal(
      describeEvent(ev('visits.softDelete', { customerName: '客戶A' }, { deletedAt: 'server' })),
      '刪掉客戶A的來訪',
    );
  });

  test('一般的修改講改了哪幾個欄位，改成什麼是展開之後的事', () => {
    const line = describeEvent(ev('customers.update',
      { name: '客戶A', phone: '02', lineId: 'a' },
      { phone: '03', lineId: 'b' }, 'customers/c1'));
    assert.equal(line, '改了客戶A的電話、LINE');
  });

  test('改了一大片就只講幾個欄位 —— 列出十個欄位名等於沒講', () => {
    const before = { name: '客戶A' };
    const after = { a: 1, b: 2, c: 3, d: 4, e: 5 };
    assert.match(describeEvent(ev('customers.update', before, after, 'customers/c1')), /5 個欄位/);
  });

  // 湊不出句子的時候要回 null，畫面才知道要退回欄位表。
  // 硬湊一句話出來，湊錯的那幾則會比欄位表更難查。
  test('翻不出來就回 null，不要硬湊', () => {
    assert.equal(describeEvent(ev('visits.update', { status: 'done' }, { status: 'done' })), null);
    assert.equal(describeEvent({}), null);
  });

  test('讀不到名字就不編一個', () => {
    assert.equal(subjectOf({ before: null, after: { status: 'done' } }), null);
    assert.equal(describeEvent(ev('visits.update', { status: 'confirmed' }, { status: 'done' })),
      '來訪改成已完成');
  });
});

describe('同一天的收在一起', () => {
  test('照原順序分組，不重排', () => {
    const days = groupByDay(
      [{ id: 1, d: '08-23' }, { id: 2, d: '08-23' }, { id: 3, d: '08-22' }, { id: 4, d: '08-23' }],
      (e) => e.d,
    );
    assert.deepEqual(days.map((g) => g.day), ['08-23', '08-22', '08-23']);
    assert.deepEqual(days.map((g) => g.events.length), [2, 1, 1]);
  });

  test('沒有事件就沒有分組', () => {
    assert.deepEqual(groupByDay([], () => ''), []);
    assert.deepEqual(groupByDay(undefined, () => ''), []);
  });
});

// events 這個集合同時放行事備註與休假（ADR-0045），而那兩個在日曆上是不同的兩類。
// 只看路徑的話，一則休假的稽核會寫著「行事備註」。
test('休假的稽核不會寫成行事備註', () => {
  assert.equal(
    describeEvent({ action: 'events.create', targetPath: 'events/e1', before: null, after: { title: '宜蘭休假', category: 'leave' } }),
    '新增休假「宜蘭休假」',
  );
  assert.equal(
    describeEvent({ action: 'events.create', targetPath: 'events/e2', before: null, after: { title: '高齡演講', category: 'personal' } }),
    '新增行事備註「高齡演講」',
  );
});
