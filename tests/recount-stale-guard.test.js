// 「重算次數」寫的是掃描（或按下去）那一刻算的數字（2026-11-05 第一輪小修 03，11/4 全庫健檢 #3）。
//
// 掃描完不按、別台替那位客戶排了一段（額度已經被那一台寫對）、回來按修正 → 舊的數字蓋回去。
// 額度每存一次來訪都會換 `updatedAt`，所以帶著算的那一刻的 `updatedAt`、`repo.commit()` 對不上就丟 `StaleWriteError`（整批不寫）。
// 客戶詳情那一顆「修正」是同一個形狀：按下去重讀全部來訪之後還有一道確認框，框開著的時候別台存了一段一樣蓋回去。
//
// 判準：算完之後別台改過那一筆額度 → 按修正會不會把舊的數字蓋回去？（不可以）沒人改過 → 照常修好。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runHealthCheck } from '../public/js/domain/health.js';
import { SEED } from '../public/js/domain/seed.js';
import { fromRoot } from './helpers/paths.js';

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');

function bodyOf(src, name) {
  const at = src.search(new RegExp(`(?:export )?(?:async )?function ${name}\\(`));
  assert.ok(at >= 0, `找不到 ${name}`);
  return src.slice(at, src.indexOf('\n}\n', at));
}

test('資料健檢：重算次數那一筆修正帶著掃描那一刻額度的 updatedAt', () => {
  const stamp = { seconds: 7, isEqual: () => true };
  const result = runHealthCheck({
    customers: [{ id: 'c1', name: '客戶A', active: true }],
    entitlements: [{
      id: 'e1', customerId: 'c1', label: '復能-三選一(60)', type: 'pool', courseId: 'course-recovery',
      optionEquipmentIds: ['eq-sis'], totalQty: 10, doneCount: 3, bookedCount: 0, updatedAt: stamp,
    }],
    visits: [], tasks: [], availability: [], notes: [],
    master: SEED,
  }, '2026-11-05');
  const fix = result.checks.flatMap((c) => c.findings).map((f) => f.fix).find((f) => f?.kind === 'recount');
  assert.ok(fix, '計數 3、重算 0：要有一筆重算次數');
  assert.equal(fix.updatedAt, stamp);
});

test('資料健檢：沒有 updatedAt 的舊額度是 null（repo.commit() 不擋，跟以前一樣）', () => {
  const src = read('public/js/domain/health.js');
  assert.match(src, /kind: 'recount',[\s\S]{0,400}?updatedAt: e\.updatedAt \?\? null/);
});

test('opFor()：重算次數那一條 op 帶 ifUpdatedAt', () => {
  const src = read('public/js/data/health.js');
  const start = src.indexOf("if (fix?.kind === 'recount')");
  assert.ok(start >= 0);
  assert.match(src.slice(start, src.indexOf('\n  }\n', start)), /ifUpdatedAt: fix\.updatedAt \?\? null/);
});

test('客戶詳情的「修正」：按下去那一刻連額度一起重讀，寫的時候帶那一份的 updatedAt', () => {
  const body = bodyOf(read('public/js/ui/views/customerDetail.js'), 'fixCounts');
  assert.match(body, /listEntitlements\(/, '額度也要重讀：打開這一頁那一刻的 updatedAt 一存來訪就換了，拿它比會假擋');
  assert.ok(body.indexOf('listEntitlements(') < body.indexOf('confirmAction('), '重讀在確認框之前');
  assert.match(body, /updateEntitlement\([\s\S]*?\{ ifUpdatedAt: [^}]*\}/);
  const update = bodyOf(read('public/js/data/customers.js'), 'updateEntitlement');
  assert.match(update, /ifUpdatedAt/);
});
