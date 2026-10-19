// 批次建立客戶：每一位一格病歷號（before-golive-2026-10-19 issue 18，ADR-0160）。
//
// 判準：這一行會不會讓她在批次那一頁填的病歷號沒寫進那一位身上？同號只提醒、不擋。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { newRow, customerFor, rosterWarnings, chartNoClashes } from '../public/js/domain/bulkCustomers.js';

test('新的一列：病歷號是空的；customerFor() 寫進 chartNo（空的寫 null）', () => {
  const row = newRow('王小明', 'r1');
  assert.equal(row.chartNo, '');
  assert.equal(customerFor(row, {}).chartNo, null);
  assert.equal(customerFor({ ...row, chartNo: ' 1234 ' }, {}).chartNo, '1234');
});

test('同號：跟既有客戶、或名單裡另一位 → 那一列一句；空的不比', () => {
  const rows = [
    { ...newRow('王小明', 'r1'), chartNo: '1234' },
    { ...newRow('李小華', 'r2'), chartNo: '00001234' },
    { ...newRow('陳大文', 'r3'), chartNo: '4321' },
    { ...newRow('客戶A', 'r4'), chartNo: '' },
  ];
  const existing = [{ id: 'c1', name: '客戶B', chartNo: '4321' }];
  const clash = chartNoClashes(rows, existing);
  assert.match(clash.get('r1'), /李小華/);
  assert.match(clash.get('r2'), /王小明/);
  assert.match(clash.get('r3'), /客戶B/);
  assert.equal(clash.has('r4'), false);
});

test('摘要的提醒也講（ctx.existing 給了才比）', () => {
  const rows = [{ ...newRow('王小明', 'r1'), chartNo: '4321' }];
  const said = rosterWarnings(rows, { source: 'x' }, { existing: [{ id: 'c1', name: '客戶B', chartNo: '4321' }] });
  assert.ok(said.some((w) => w.includes('客戶B')), said.join('\n'));
});
