// 試算表的次數要拿這位客戶**全部**過去的來訪算（course-form-and-sheet-2026-10-06 的 issue 13）。
//
// 她的原話（第四點）：
//
// > 也要幫我檢查有沒有其他試算表的問題，試算表的正確與否對我來說很重要
//
// 查到的那一件：推試算表時只讀「今天前後 400 天」的來訪，而每一筆額度的已完成／已排未上／剩餘是拿
// **那一窗**裡的來訪現算的 —— 一次來訪落在 400 天以前，試算表上「已完成」就少一次、「剩餘」多一次，而 app 裡的數字是對的。
// 問她要不要改成往回不設限（代價是表會慢慢變寬），她回：
//
// > 好幫我改
//
// 那一窗寫在資料層（讀 Firestore 的那兩支），純函式那一側（`syncBundle()`）給它什麼它就算什麼 ——
// 所以這裡掃原始碼：兩條路（自動推送、手動貼上）讀來訪走同一支，而那一支往回沒有下限。
// 瀏覽器那一側在 `tests-e2e/specs/09-sheet-and-import.spec.js` 的 J-C15（500 天前做過一次）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { syncBundle } from '../public/js/domain/sheetReport.js';
import { counts } from '../public/js/domain/entitlements.js';
import { SEED } from '../public/js/domain/seed.js';

const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

describe('試算表讀來訪：往回不設限', () => {
  test('自動推送與手動貼上讀來訪走同一支（`visitsData.listForSheet()`），自己不留一個往回幾天的數字', () => {
    for (const rel of ['data/sheetSync.js', 'ui/views/report.js']) {
      const src = read(rel);
      assert.match(src, /visitsData\.listForSheet\(/, `${rel} 要走 listForSheet()`);
      assert.doesNotMatch(src, /LOOKBACK_DAYS/, `${rel} 不可以自己留一個往回幾天的數字`);
      assert.doesNotMatch(src, /visitsData\.listBetween\(/, `${rel} 不可以自己框一段期間`);
    }
  });

  test('那一支往回沒有下限（只有往後的上限）', () => {
    const src = read('data/visits.js');
    const at = src.indexOf('export function listForSheet');
    assert.ok(at > 0, '`data/visits.js` 要有 listForSheet()');
    const body = src.slice(at, src.indexOf('\n}\n', at));
    assert.match(body, /where\('date', '<=', /);
    assert.doesNotMatch(body, /'>='/, '往回不可以有下限');
  });
});

describe('不變量：每一筆額度那一列的數字＝拿這位客戶全部來訪算的 counts()', () => {
  test('一次來訪在 500 天前：那一列的已完成／剩餘跟 counts() 一樣，那一天也有一欄', () => {
    const e = {
      id: 'e1', customerId: 'c1', type: 'single', courseId: 'course-iv-laser', label: 'ILIB(60)',
      totalQty: 10, durationMin: 60, doneCount: 2, bookedCount: 0,
    };
    const done = (id, date) => ({
      id, customerId: 'c1', date, status: 'done',
      slots: [{ entitlementId: 'e1', courseId: 'course-iv-laser', status: 'done', attended: true, startsAt: '10:00', endsAt: '11:00' }],
    });
    const visits = [done('v-old', '2025-05-20'), done('v-new', '2026-09-30')];
    const bundle = syncBundle({
      customers: [{ id: 'c1', name: '客戶A', active: true }],
      entitlementsBy: { c1: [e] }, visitsBy: { c1: visits }, tasksBy: {},
      today: '2026-10-07', master: SEED, generatedAt: '',
    });
    const [sheet] = bundle.sheets;
    const want = counts(e, visits, e.id);
    assert.deepEqual([sheet.rows[0].done, sheet.rows[0].remaining], [want.done, want.remaining]);
    assert.equal(sheet.rows[0].done, 2);
    assert.equal(sheet.dates.length, 2, '500 天前那一天也有一欄');
  });
});
