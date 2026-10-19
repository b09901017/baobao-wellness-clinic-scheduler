// 資料健檢那幾顆整包寫 `slots` 的修正（before-golive-2026-10-19 issue 12；中途發現第 7 條）。
//
// 判準：這一行會不會讓一筆來訪在她按下去之前被別台加的一段，被資料健檢的整包 `slots` 蓋掉？
// 快照是快取來的時候按這幾顆 → 一筆都不寫、講一句（同「重算次數」，ADR-0158）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { runHealthCheck } from '../public/js/domain/health.js';
import { SEED } from '../public/js/domain/seed.js';
import { fromRoot } from './helpers/paths.js';

const read = (rel) => readFileSync(fromRoot(rel), 'utf8').replace(/\r\n/g, '\n');
const SLOT_REWRITES = ['clearBeds', 'moveBedToRoom', 'trialSlotsToCourse', 'retireTrialCourse'];

test('床位那兩種修正帶著那一筆來訪的 updatedAt', () => {
  const stamp = { seconds: 1, isEqual: () => true };
  const slot = (over) => ({
    entitlementId: 'e1', courseId: 'course-iv-drip', startsAt: '10:00', endsAt: '12:00', roomId: 'room-iv8', bed: 'A',
    status: 'done', ...over,
  });
  const visits = [
    { id: 'v1', customerId: 'c1', date: '2026-09-10', status: 'done', updatedAt: stamp, slots: [slot()] },
    { id: 'v2', customerId: 'c1', date: '2026-09-11', status: 'done', updatedAt: stamp, slots: [slot({ roomId: 'room-t3' })] },
  ];
  const found = runHealthCheck({
    customers: [{ id: 'c1', name: '客戶A', active: true }], entitlements: [], visits, tasks: [], availability: [],
    master: SEED,
  }, '2026-10-19').checks.find((c) => c.id === 'slotBeds').findings;
  // 種子上沒有「點滴8」那一間了（ADR-0155），兩筆都是清床位；搬診間那一種同一行（`moveBedToRoom` 也寫進去了，見原始碼）
  assert.equal(found.length, 2);
  assert.match(read('public/js/domain/health.js'), /kind: 'moveBedToRoom', visitId: visit\.id, updatedAt: visit\.updatedAt/);
  for (const f of found) assert.equal(f.fix.updatedAt, stamp, f.fix.kind);
});

test('EECP 那兩種：每一筆來訪各帶自己的 updatedAt', () => {
  const src = read('public/js/domain/health.js');
  assert.match(src, /const rewrite = \(v\) => \(\{ visitId: v\.id, updatedAt: v\.updatedAt \?\? null,/);
});

test('opFor() 那幾條整包寫 slots 的 op 帶 ifUpdatedAt（repo.commit() 會比）', () => {
  const src = read('public/js/data/health.js');
  const ops = src.match(/changes: \{ slots: [^}]*\}[^}]*\}/g) ?? [];
  assert.ok(ops.length >= 3, `找到 ${ops.length} 條`);
  for (const op of ops) assert.match(op, /ifUpdatedAt/, op);
});

test('applyFixes()：快照不是全部時，整包寫 slots 的那幾種也擋（在 repo.commit( 之前）', () => {
  const src = read('public/js/data/health.js');
  const start = src.indexOf('export async function applyFixes(');
  const body = src.slice(start, src.indexOf('\n}\n', start));
  for (const kind of SLOT_REWRITES) assert.ok(src.includes(`'${kind}'`), kind);
  assert.match(body, /SLOT_REWRITES/);
  assert.ok(body.search(/SLOT_REWRITES/) < body.indexOf('repo.commit('));
});
