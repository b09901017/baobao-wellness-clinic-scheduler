// 營養品「記交付」連按、或寫完還沒重畫就再記一次，只記一次（2026-11-05 第一輪小修 04，11/4 全庫健檢 #4）。
//
// `withDelivery()` 拿呼叫端手上那一份額度判斷「給過了沒」—— 兩次手上都是舊的，`deliveries` 就多一筆一樣的（會進試算表）。
// `withSaveState()` 的 `key` 只擋寫入還在飛的那幾秒；更常撞到的是「寫完、還沒重讀」與 toast 重試。
// `ifUpdatedAt` 也擋不住：還沒回到伺服器的 serverTimestamp 讀回來是 null，`sameStamp` 放行。
// 所以 `recordDelivery()` 寫之前重讀那一筆額度 —— 四個入口（客戶詳情、首頁、泡泡、日曆）一次補好。E2E `89` 從瀏覽器量。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');

function bodyOf(src, name) {
  const at = src.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(at >= 0, `找不到 ${name}`);
  return src.slice(at, src.indexOf('\n}\n', at));
}

test('recordDelivery()：寫之前重讀那一筆額度，拿重讀的那一份判斷給過了沒', () => {
  const body = bodyOf(read('public/js/data/notes.js'), 'recordDelivery');
  const reread = body.indexOf('repo.getOne(');
  assert.ok(reread > 0, '要重讀');
  assert.ok(reread < body.indexOf('withDelivery('), '重讀在判斷之前');
  assert.doesNotMatch(body, /withDelivery\(entitlement,/, '不可以拿呼叫端那一份判斷');
});

test('客戶詳情的「已經給了」：withSaveState 帶 key（寫入還在飛時再記一次接到同一趟）', () => {
  const body = bodyOf(read('public/js/ui/views/customerDetail.js'), 'runProductAction');
  const at = body.indexOf('notesData.recordDelivery(');
  assert.ok(at > 0);
  assert.match(body.slice(at, at + 600), /key: `delivery:/);
});
