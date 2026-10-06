// 試算表：日期欄的抬頭不是今年的帶年份（course-form-and-sheet-2026-10-06/19）。
//
// 13 之後試算表讀這位客戶全部過去的來訪，表一定會跨過一年 —— 抬頭只寫 `10/7(三)` 的話，
// 去年與今年的同一天只差括號裡的星期。問她「不是今年的那幾欄前面加年份（`25/10/7(二)`）」，她回：
//
// > 2. 試算表日期抬頭加年份：要
//
// **這一行會不會讓兩欄看起來是同一天？** —— 不會：不是今年的帶兩位數年份。今年的一個字都不變。
// 兩條路（自動推送、手動貼上）與來訪紀錄那一行同一支。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { customerReport, dateLabel, deliveryCell, syncBundle } from '../public/js/domain/sheetReport.js';
import { SEED } from '../public/js/domain/seed.js';

const ENT = {
  id: 'e1', customerId: 'c1', type: 'single', courseId: 'course-iv-laser', label: 'ILIB(60)',
  totalQty: 10, durationMin: 60, doneCount: 3, bookedCount: 1,
};
const visit = (id, date, status = 'done') => ({
  id, customerId: 'c1', date, status,
  slots: [{ entitlementId: 'e1', courseId: 'course-iv-laser', status, attended: status === 'done' ? true : null, startsAt: '10:00', endsAt: '11:00' }],
});
const VISITS = [visit('v1', '2025-10-07'), visit('v2', '2026-01-05'), visit('v3', '2026-10-06'), visit('v4', '2027-01-05', 'confirmed')];
const TODAY = '2026-10-06';

describe('一支 dateLabel()', () => {
  test('今年的照舊 M/D(週)；不是今年的前面加兩位數年份', () => {
    assert.equal(dateLabel('2026-10-06', TODAY), '10/6(二)');
    assert.equal(dateLabel('2025-10-07', TODAY), '25/10/7(二)');
    assert.equal(dateLabel('2027-01-05', TODAY), '27/1/5(二)');
  });

  test('沒給今天 → 照舊（不猜哪一年是今年）', () => {
    assert.equal(dateLabel('2025-10-07'), '10/7(二)');
  });
});

// 審查查到的：表上其他的日期（TODO／FINISHED 那兩區、二返註記、營養品給了沒）照舊只寫月日 ——
// FINISHED 會一直累積，明年起去年與今年的「10/7 寫紀錄」分不出來；TODO／FINISHED 不在任何一個日期欄底下
describe('表上其他的日期也一樣：不是今年的帶年份', () => {
  const EXAM = { id: 'e-x', customerId: 'c1', type: 'single', courseId: 'course-checkup', label: '健檢', totalQty: 1 };
  const FU = { id: 'e-f', customerId: 'c1', type: 'single', courseId: 'course-followup', label: '二返', totalQty: 1, followupForEntitlementId: 'e-x' };
  const done = (id, date, entitlementId, courseId, extra = {}) => ({
    id, customerId: 'c1', date, status: 'done',
    slots: [{ entitlementId, courseId, status: 'done', attended: true, startsAt: '10:00', endsAt: '11:00', ...extra }],
  });
  const visits = [done('v-x', '2025-11-01', 'e-x', 'course-checkup'), done('v-f', '2025-11-20', 'e-f', 'course-followup', { followupForVisitId: 'v-x' })];
  const tasks = [{ id: 't1', customerId: 'c1', visitId: 'v-x', kind: '寫紀錄', done: true, doneAt: '2025-11-02', dueDate: '2025-11-02' }];
  const bundle = () => syncBundle({
    customers: [{ id: 'c1', name: '客戶A', active: true }],
    entitlementsBy: { c1: [EXAM, FU] }, visitsBy: { c1: visits }, tasksBy: { c1: tasks },
    today: TODAY, master: SEED, generatedAt: '',
  }).sheets[0];

  test('FINISHED 那一行、健檢底下的二返註記：25/M/D', () => {
    const sheet = bundle();
    assert.match(sheet.tasks.finished[0].label, /^25\/11\/1 /);
    assert.match(JSON.stringify(sheet.followupNotes), /25\/11\/20 二返/);
  });

  test('營養品給了沒：不是今年的帶年份；今年的照舊', () => {
    assert.equal(deliveryCell({ at: '2025-12-01', text: '全部給了' }, TODAY), '25/12/1　全部給了');
    assert.equal(deliveryCell({ at: '2026-09-01', text: '全部給了' }, TODAY), '9/1　全部給了');
  });
});

describe('兩條路與來訪紀錄同一個字', () => {
  test('自動推送：抬頭與來訪紀錄那一行都帶年份', () => {
    const bundle = syncBundle({
      customers: [{ id: 'c1', name: '客戶A', active: true }],
      entitlementsBy: { c1: [ENT] }, visitsBy: { c1: VISITS }, tasksBy: {},
      today: TODAY, master: SEED, generatedAt: '',
    });
    const [sheet] = bundle.sheets;
    assert.deepEqual(sheet.dateLabels, ['25/10/7(二)', '1/5(一)', '10/6(二)', '27/1/5(二)']);
    assert.deepEqual(sheet.log.map((l) => l.label), sheet.dateLabels);
  });

  test('手動貼上：抬頭那一列同一個字', () => {
    const { rows } = customerReport({
      customer: { id: 'c1', name: '客戶A' }, entitlements: [ENT], visits: VISITS, courses: SEED.courses, today: TODAY,
    });
    const head = rows.find((r) => r[0] === '療程項目');
    assert.deepEqual(head.slice(5), ['25/10/7(二)', '1/5(一)', '10/6(二)', '27/1/5(二)']);
  });
});
