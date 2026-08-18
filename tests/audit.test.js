// 稽核紀錄的翻譯。SPEC 第 6.2 節。
//
// 這一支盯的是「差異表不能騙人」：沒動到的欄位不可以被報成改動，
// 動到的欄位一定要出現。出事時她是靠這張表判斷資料怎麼變成現在這樣的。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  describeAction, describeTarget, fieldLabel, changedFields, formatValue,
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
