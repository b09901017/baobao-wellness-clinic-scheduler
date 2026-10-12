// 試算表 TODO／FINISHED 那一行要跟待辦中心講同一句（prelaunch-fixes-2026-10-08/17）。
//
// 整天取消的來訪不進次數矩陣（`isActive()`），但「取消 Abovee」要找的正是那一筆 ——
// 以前 `taskBlocks()` 拿的是濾過的那一份，找不到就退回死線（＝取消的那一天，常常是今天）、
// 課程空白。待辦中心讀得到取消的來訪，所以兩邊講的不是同一天。
// 順手：主檔少了 `ivProducts`，營養點滴的待辦試算表寫「營養點滴」、待辦中心寫品項。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { syncBundle, customerReport } from '../public/js/domain/sheetReport.js';
import { cancelTasksFor } from '../public/js/domain/taskRules.js';
import { taskLine } from '../public/js/domain/todoFlow.js';
import { applyStatus } from '../public/js/domain/visits.js';

const TODAY = '2026-10-08';
const C = 'c1';
const courses = [
  { id: 'sisc', name: 'SIS', systems: ['Abovee'] },
  { id: 'ivc', name: '營養點滴', category: 'B', systems: ['Abovee'] },
];
const ivProducts = [{ id: 'iv-snow', name: '雪顏亮彩', shortName: '雪' }];
const master = { courses, equipment: [], ivProducts };
const coursesById = Object.fromEntries(courses.map((c) => [c.id, c]));
const customer = { id: C, name: '客戶A' };
const ent = { id: 'e1', type: 'single', label: 'SIS(60)', courseId: 'sisc', totalQty: 10 };

const sis = (startsAt) => ({
  entitlementId: 'e1', courseId: 'sisc', courseName: 'SIS', startsAt,
  endsAt: startsAt.replace(':00', ':59'), status: 'confirmed',
});
const confirmedDay = (slots) => ({
  id: 'v1', customerId: C, customerName: '客戶A', date: '2026-10-15', status: 'confirmed', slots,
});

/** 整天取消（批次取消那一條路）→ 長出來的取消類待辦 */
function cancelWholeDay() {
  let v = confirmedDay([sis('10:00')]);
  v = applyStatus(v, 'cancelled', { slotIndex: 0 });
  const tasks = cancelTasksFor(v, [], coursesById, TODAY).map((t, i) => ({ id: `t${i}`, ...t }));
  return { visit: v, tasks };
}

const bundleOf = (visits, tasks, ents = [ent]) => syncBundle({
  customers: [customer],
  entitlementsBy: { [C]: ents },
  visitsBy: { [C]: visits },
  tasksBy: { [C]: tasks },
  today: TODAY,
  master,
});

const reportOf = (visits, tasks) => customerReport({
  customer, entitlements: [ent], visits, tasks, courses, equipment: [], ivProducts, today: TODAY,
});

/** 待辦中心那一行（home.js 的 `fillVisitInfo()` → `taskLine(task, visit, master)`），換成試算表的寫法 */
const appLine = (task, visit) => {
  const { date, what } = taskLine(task, visit, master);
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d} ${what}`;
};

describe('整天取消的「取消 Abovee」', () => {
  test('TODO 那一行寫取消的那一天與課程，跟待辦中心同一句', () => {
    const { visit, tasks } = cancelWholeDay();
    assert.equal(visit.status, 'cancelled', '前提：整天取消');
    assert.ok(tasks.length >= 1, '前提：長出一張取消類待辦');
    const [row] = bundleOf([visit], tasks).sheets[0].tasks.todo;
    assert.equal(row.label, appLine(tasks[0], visit));
    assert.match(row.label, /^10\/15 .*SIS/);
  });

  test('勾掉之後 FINISHED 那一行也是', () => {
    const { visit, tasks } = cancelWholeDay();
    const done = tasks.map((t) => ({ ...t, done: true, doneAt: '2026-10-08T03:00:00.000Z' }));
    const [row] = bundleOf([visit], done).sheets[0].tasks.finished;
    assert.equal(row.label, appLine(done[0], visit));
  });

  test('手動貼上那條路也一樣', () => {
    const { visit, tasks } = cancelWholeDay();
    const { rows } = reportOf([visit], tasks);
    const at = rows.findIndex((r) => r[0] === 'TODO（還沒做的）');
    assert.equal(rows[at + 1][0], appLine(tasks[0], visit));
  });

  test('只取消一段的照舊', () => {
    let v = confirmedDay([sis('10:00'), sis('14:00')]);
    v = applyStatus(v, 'cancelled', { slotIndex: 1 });
    const tasks = cancelTasksFor(v, [], coursesById, TODAY).map((t, i) => ({ id: `t${i}`, ...t }));
    assert.ok(tasks.length >= 1, '前提：長出一張取消類待辦');
    const [row] = bundleOf([v], tasks).sheets[0].tasks.todo;
    assert.equal(row.label, appLine(tasks[0], v));
    assert.match(row.label, /^10\/15 14:00 SIS/);
  });
});

describe('取消的來訪只給待辦找，不進次數', () => {
  test('矩陣、合計、日期欄、來訪紀錄跟沒有那一筆時一模一樣', () => {
    const { visit, tasks } = cancelWholeDay();
    const done = {
      id: 'v0', customerId: C, date: '2026-10-01', status: 'done',
      slots: [{ ...sis('10:00'), status: 'done' }],
    };
    const withCancelled = bundleOf([done, visit], tasks).sheets[0];
    const without = bundleOf([done], tasks).sheets[0];
    for (const key of ['dates', 'rows', 'totals', 'followupNotes', 'equipmentNotes', 'log']) {
      assert.deepEqual(withCancelled[key], without[key], `${key} 被取消的那一天影響了`);
    }
  });
});

describe('營養點滴的待辦寫品項', () => {
  const ivEnt = { id: 'e2', type: 'single', label: '營養點滴', courseId: 'ivc', ivProductId: 'iv-snow', totalQty: 5 };
  const ivVisit = {
    id: 'v2', customerId: C, date: '2026-10-20', status: 'confirmed',
    slots: [{ entitlementId: 'e2', courseId: 'ivc', courseName: '營養點滴', ivProductId: 'iv-snow',
      startsAt: '10:00', endsAt: '11:00', status: 'confirmed' }],
  };
  const task = { id: 't9', visitId: 'v2', kind: 'Abovee', dueDate: '2026-10-19', done: false, slotIndexes: [0] };

  test('自動推送', () => {
    const [row] = bundleOf([ivVisit], [task], [ivEnt]).sheets[0].tasks.todo;
    assert.equal(row.label, appLine(task, ivVisit));
    assert.doesNotMatch(row.label, /營養點滴/);
  });

  test('手動貼上', () => {
    const { rows } = customerReport({
      customer, entitlements: [ivEnt], visits: [ivVisit], tasks: [task], courses, equipment: [], ivProducts, today: TODAY,
    });
    const at = rows.findIndex((r) => r[0] === 'TODO（還沒做的）');
    assert.equal(rows[at + 1][0], appLine(task, ivVisit));
  });
});
