// 舊資料匯入只跑得了一趟（prelaunch-fixes-2026-10-08/issues/01、02）。
//
// 合併檔只匯這一次。重複的客戶刪得掉，他身上的來訪不會跟著刪，app 也沒有刪來訪的路（ADR-0089）——
// 所以「按兩次」「失敗後重按」在這一頁的代價跟別頁不一樣。
// fixture 全部是編出來的（客戶A、客戶B）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { canRun } from '../public/js/domain/mergeImport.js';

describe('「開始匯入」現在按不按得下去', () => {
  test('有人要建、沒有在跑 → 按得下去', () => {
    assert.equal(canRun({ running: false, customers: 2 }), true);
  });

  test('正在跑（確認框開著也算）→ 按不下去', () => {
    assert.equal(canRun({ running: true, customers: 2 }), false);
  });

  test('跑完、每一位都匯好了（重算之後一位都不用建）→ 按不下去', () => {
    assert.equal(canRun({ running: false, customers: 0 }), false);
  });

  test('有人失敗（重算之後剩那幾位）→ 還重試得了', () => {
    assert.equal(canRun({ running: false, customers: 1 }), true);
  });
});
