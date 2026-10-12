// 存好幾筆存到一半失敗，按重試只存剩下的（prelaunch-audit-2026-09-23/issues/18）。
//
// toast 的重試跑的是同一個閉包。從第一筆重存的話，第一筆的 `updatedAt` 已經被自己
// 換掉了，`ifUpdatedAt` 對不上 →「剛剛在別的地方被改過」—— 假的，而且再也存不進去。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveEach } from '../public/js/ui/saveEach.js';

test('第二筆第一次丟錯 → 重試 → 第一筆不再被存', async () => {
  const calls = [];
  let failOnce = true;
  const save = async (item) => {
    calls.push(item);
    if (item === 2 && failOnce) {
      failOnce = false;
      throw new Error('網路斷了');
    }
  };
  const saved = new Set();

  await assert.rejects(saveEach([1, 2], save, saved));
  await saveEach([1, 2], save, saved);

  assert.deepEqual(calls, [1, 2, 2]);
  assert.equal(saved.size, 2);
});

test('沒有失敗就每一筆存一次，照順序', async () => {
  const calls = [];
  await saveEach(['a', 'b', 'c'], async (x) => { calls.push(x); }, new Set());
  assert.deepEqual(calls, ['a', 'b', 'c']);
});
