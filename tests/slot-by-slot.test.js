// 2026-09-24 那一輪：時段才是原子單位的第二輪（`.scratch/asks-2026-09-24/`）。
//
// ADR-0081 把狀態搬到時段上，ADR-0097 讓「確認」跟上了；這一支盯著剩下那幾族
// 也問**那一段**，而不是問整筆推出來的那一個。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStatus, applyConfirmation, closeVisit, withSlotStatuses, slotStatus,
  visitActions, visitStatusFrom, visitsToClose, nextStatuses, cancellableSlots,
} from '../public/js/domain/visits.js';

const statuses = (v) => v.slots.map((s) => slotStatus(v, s));

describe('01 改狀態之前先把每一段的狀態補齊', () => {
  // 2026-09-08 之前建的、之後沒再存過的：時段身上沒有 status
  const oldShape = (status, n = 3) => ({
    id: 'v', date: '2026-09-20', status,
    slots: Array.from({ length: n }, () => ({ courseId: 'c' })),
  });

  test('整天未到的舊資料，改第 0 段不會把另外兩段一起補成已確認', () => {
    // 存檔那一刻 `save()` 會再補一次 —— 補的要是它們原本的樣子
    const next = withSlotStatuses(applyStatus(oldShape('no_show'), 'confirmed', { slotIndex: 0 }));
    assert.deepEqual(statuses(next), ['confirmed', 'no_show', 'no_show']);
  });

  test('確認抽屜只問了第 0 段：第 1 段補的是它原本的狀態', () => {
    const next = withSlotStatuses(applyConfirmation(oldShape('pending_confirm', 2), new Set(), 'T', new Set([0])));
    assert.deepEqual(statuses(next), ['confirmed', 'pending_confirm']);
  });

  test('結案的舊資料：取消掉的那一段（整筆取消前留下的）不會被補成做了', () => {
    const v = { ...oldShape('confirmed', 2), slots: [{ courseId: 'c' }, { courseId: 'c', status: 'cancelled' }] };
    const next = withSlotStatuses(closeVisit(v, [true, true], 'T'));
    assert.deepEqual(statuses(next), ['done', 'cancelled']);
  });

  test('新形狀的資料（每一段都有 status）結果一個字都沒變', () => {
    const v = {
      id: 'v', date: '2026-09-20', status: 'no_show',
      slots: [{ courseId: 'c', status: 'no_show' }, { courseId: 'c', status: 'no_show' }],
    };
    const next = applyStatus(v, 'confirmed', { slotIndex: 0, at: 'T' });
    assert.deepEqual(statuses(next), ['confirmed', 'no_show']);
    assert.equal(next.status, 'confirmed');
  });
});

describe('02 未到只能退回簽療程單；長按每一顆都問那一段', () => {
  // 她 2026-09-24：「未到可以改成退回簽療程單之類的，或可以改成其實有到這樣」
  const day = (...each) => {
    const v = { id: 'v', date: '2026-09-20', slots: each.map((status) => ({ courseId: 'c', status })) };
    return { ...v, status: visitStatusFrom(v) };
  };
  const ids = (v, slotIndex) => visitActions(v, { today: '2026-09-24', slotIndex }).map((a) => a.id);

  test('長按未到的那一段：只有「退回簽療程單」', () => {
    assert.deepEqual(ids(day('no_show', 'no_show'), 0), ['reopen']);
    // 客人做了一段就走：整筆已完成，沒做的那一段照樣退得回去 —— 已完成那一段一個字都不動
    assert.deepEqual(ids(day('done', 'no_show'), 1), ['reopen']);
    assert.deepEqual(ids(day('no_show', 'confirmed'), 0), ['reopen']);
  });

  test('退回之後只有那一段變成已確認，那一天回到簽療程單的清單上', () => {
    const next = applyStatus(day('done', 'no_show'), 'confirmed', { slotIndex: 1, at: 'T' });
    assert.deepEqual(next.slots.map((s) => s.status), ['done', 'confirmed']);
    assert.equal(next.slots[1].attended, null, '「沒做」那一格一起清掉 —— 它現在還沒結案');
    assert.equal(next.status, 'confirmed');
    assert.equal(visitsToClose([next], '2026-09-24').length, 1);
  });

  test('未到不再准「取消」—— 人沒來是已經發生的事', () => {
    assert.deepEqual(nextStatuses('no_show'), ['confirmed']);
  });

  test('長按已取消的那一段：沒有「去簽療程單」、沒有「改這一段」', () => {
    assert.deepEqual(ids(day('cancelled', 'confirmed'), 0), []);
  });

  test('長按已完成的那一段：一顆都沒有', () => {
    assert.deepEqual(ids(day('done', 'confirmed'), 0), []);
  });

  test('「去簽療程單」只給還開著、日子到了的那一段', () => {
    const v = day('confirmed', 'no_show');
    assert.ok(ids(v, 0).includes('close'));
    assert.ok(!ids(v, 1).includes('close'));
  });

  test('批次取消：一天裡已經未到／已完成的那一段不給取消', () => {
    const v = day('confirmed', 'no_show', 'done', 'pending_confirm');
    assert.deepEqual(cancellableSlots(v).map((x) => x.index), [0, 3]);
  });
});
