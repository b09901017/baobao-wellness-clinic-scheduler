// 2026-09-24 那一輪：時段才是原子單位的第二輪（`.scratch/asks-2026-09-24/`）。
//
// ADR-0081 把狀態搬到時段上，ADR-0097 讓「確認」跟上了；這一支盯著剩下那幾族
// 也問**那一段**，而不是問整筆推出來的那一個。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyStatus, applyConfirmation, closeVisit, withSlotStatuses, slotStatus,
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
