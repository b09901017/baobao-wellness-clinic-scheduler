// 試算表 FINISHED 那一欄的完成日期是台灣的日期，不是 UTC 切字（prelaunch-fixes-2026-10-08，她 10/9 回的 C）。
//
// `doneAt` 是 ISO 時間（UTC）。以前兩條路都 `doneAt.slice(0, 10)` —— 台灣 00:00–08:00 勾掉的寫成前一天
//（`docs/agents/lessons.md` 第七節）。現在 app 這一側先換成當地日期（`dates.js` 的 `dayOf()`）再送；
// `.gs` 那一處的 `slice(0, 10)` 對日期字串照樣成立，所以 `.gs` 不用重貼、`SYNC_FORMAT` 不動。

process.env.TZ = 'Asia/Taipei';

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { syncBundle, customerReport } from '../public/js/domain/sheetReport.js';

// 台灣 10/9 01:30 勾掉的（UTC 還是 10/8）
const task = {
  id: 't1', customerId: 'c1', kind: '打電話', dueDate: '2026-10-10',
  done: true, doneAt: '2026-10-08T17:30:00.000Z',
};
const customer = { id: 'c1', name: '客戶A' };

test('自動推送：FINISHED 的完成日期是台灣那一天', () => {
  const bundle = syncBundle({ customers: [customer], tasksBy: { c1: [task] }, today: '2026-10-09' });
  assert.equal(bundle.sheets[0].tasks.finished[0].doneAt, '2026-10-09');
});

test('手動貼上：FINISHED 那一行也是', () => {
  const { rows } = customerReport({ customer, tasks: [task], today: '2026-10-09' });
  const at = rows.findIndex((r) => r[0] === 'FINISHED（做完的）');
  assert.equal(rows[at + 1][2], '2026-10-09');
});

test('兩張同一天的照完成時間新到舊排（排序拿的是原本的時間，不是換過的日期）', () => {
  const early = { ...task, id: 't-early', kind: '早', doneAt: '2026-10-09T01:00:00.000Z' };
  const late = { ...task, id: 't-late', kind: '晚', doneAt: '2026-10-09T09:00:00.000Z' };
  const bundle = syncBundle({ customers: [customer], tasksBy: { c1: [early, late] }, today: '2026-10-09' });
  assert.deepEqual(bundle.sheets[0].tasks.finished.map((t) => t.kind), ['晚', '早']);
});
