// 試算表自動推送讀主檔要連已刪除的一起讀（prelaunch-fixes-2026-10-08，她 10/9 回的 C）。
//
// 手動貼上（`ui/views/report.js`）一直帶 `includeDeleted`，自動推送（`data/sheetSync.js`）走 `config.loadAll()` 沒帶 ——
// 刪掉治療師、器材、健檢課程之後，只有自動那一份的名字與二返註記消失（`.local/references/audit-2026-10-08/sheet/report.md` 第 3 條 (a)）。
// 資料層在 node 裡 import 不進來（一路 import 到 `https://`），所以讀主檔那一側掃原始碼；純函式那一側拿已刪除的主檔跑一次。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { syncBundle } from '../public/js/domain/sheetReport.js';

const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

test('自動推送讀主檔帶 includeDeleted（跟手動貼上一樣）', () => {
  assert.match(read('data/sheetSync.js'), /config\.loadAll\(\{ includeDeleted: true \}\)/);
});

test('`config.loadAll()` 把 includeDeleted 傳給每一種主檔', () => {
  const src = read('data/config.js');
  const at = src.indexOf('export async function loadAll');
  const body = src.slice(at, src.indexOf('\n}\n', at));
  assert.match(body, /\{ includeDeleted = false \} = \{\}/);
  assert.match(body, /listAll\(type, \{ includeDeleted \}\)/);
});

test('主檔裡已刪除的醫師照樣印進二返的括號（純函式那一側不濾 deletedAt）', () => {
  const bundle = syncBundle({
    customers: [{ id: 'c1', name: '客戶A' }],
    entitlementsBy: {
      c1: [
        { id: 'e-chk', label: '健檢', courseId: 'course-checkup', totalQty: 1 },
        { id: 'e-fu', label: '二返', courseId: 'course-followup', followupForEntitlementId: 'e-chk', totalQty: 1 },
      ],
    },
    visitsBy: {
      c1: [
        { id: 'v1', date: '2026-08-01', status: 'done', slots: [{ entitlementId: 'e-chk' }] },
        { id: 'v2', date: '2026-08-08', status: 'confirmed', slots: [{ entitlementId: 'e-fu', doctorId: 'st-gone' }] },
      ],
    },
    today: '2026-08-10',
    master: {
      courses: [
        { id: 'course-checkup', name: '健檢', followupCourseId: 'course-followup', deletedAt: '2026-08-09T00:00:00.000Z' },
        { id: 'course-followup', name: '二返' },
      ],
      staff: [{ id: 'st-gone', name: '王某', role: '醫師', deletedAt: '2026-08-09T00:00:00.000Z' }],
    },
  });
  assert.deepEqual(bundle.sheets[0].followupNotes, [{ dateIndex: 0, text: '8/8 二返(王某)' }]);
});
