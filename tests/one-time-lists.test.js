// 一次性客人不在任何名單上、不進試算表；資料健檢不叫她去問他時間（2026-11-05，ADR-0172 決定一、二，`.scratch/one-time-guests/issues/04`）。
//
// 她：「不是屬於我的客戶那就只要出現在行事曆上跟代辦上就好了」「客戶以及試算表中不用有他們」。
//
// 每一處都**明寫** `isOneTime()`，不靠「他剛好沒有額度」—— 所以這裡每一條都**替他手動加一筆額度**再問一次：
// 靠沒有額度排除的話，那一筆一加他就漏出來。另一半釘一般客戶一個字都沒變（同一份情境、沒有那一格）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';

import {
  buildCustomerQueue, customersToAsk, customersToAskForMonth, customersToBook, candidatesFor, batchRows, newBatch,
} from '../public/js/domain/scheduling.js';
import { syncBundle, customerReport, sheetVisits } from '../public/js/domain/sheetReport.js';
import { runHealthCheck } from '../public/js/domain/health.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));
const TODAY = '2026-11-05';

const regular = { id: 'c1', name: '王小明', active: true, flags: [] };
const guest = { id: 'g1', name: '客戶A', active: true, flags: [], oneTime: true };
const converted = { ...guest, oneTime: false };

/** 一筆復能額度（替一次性客人「手動加的那一筆」也是它）。 */
const sis = (id, parentId) => ({
  id, parentId, customerId: parentId, type: 'single', label: '復能-SIS(60)', courseId: 'course-recovery', equipmentId: 'eq-sis',
  totalQty: 10, doneCount: 0, bookedCount: 0,
});
const ENTS = { c1: [sis('e-c1', 'c1')], g1: [sis('e-g1', 'g1')] };

// ---------- 名單 ----------

describe('名單：一次性客人一位都不在（就算替他加了一筆額度）', () => {
  test('壓表名單（buildCustomerQueue）', () => {
    const rows = buildCustomerQueue({
      customers: [regular, guest], entitlementsBy: ENTS, visitsBy: {}, availabilityBy: {}, targetMonth: '2026-11', today: TODAY,
    });
    assert.deepEqual(rows.map((r) => r.customerId), ['c1']);
    // includeUsedUp（開著的那一批用）也一樣
    const all = buildCustomerQueue({
      customers: [regular, guest], entitlementsBy: ENTS, targetMonth: '2026-11', today: TODAY, includeUsedUp: true,
    });
    assert.deepEqual(all.map((r) => r.customerId), ['c1']);
  });

  test('開著的那一批：新符合資格的接進來，一次性客人不接（就算那一份算出了他）', () => {
    const batch = newBatch({ targetMonth: '2026-11', rows: [] });
    // 假設上游哪天漏算：這裡照樣擋
    const all = [{ customerId: 'c1', customerName: '王小明', totalRemaining: 3 }, { customerId: 'g1', customerName: '客戶A', totalRemaining: 3 }];
    const { added, present } = batchRows(batch, { all, customers: [regular, guest] });
    assert.deepEqual(added, ['c1']);
    assert.deepEqual(present.map((q) => q.customerId), ['c1']);
  });

  test('問這輪的時間（customersToAsk、customersToAskForMonth）', () => {
    assert.deepEqual(customersToAsk({ customers: [regular, guest], entitlementsBy: ENTS, availabilityBy: {}, today: TODAY })
      .map((r) => r.customerId), ['c1']);
    assert.deepEqual(customersToAskForMonth({ customers: [regular, guest], entitlementsBy: ENTS, availabilityBy: {}, month: '2026-12' })
      .map((r) => r.customerId), ['c1']);
  });

  test('壓表登記（customersToBook）', () => {
    const rows = customersToBook({
      customers: [regular, guest], entitlementsBy: ENTS, visitsBy: {}, coursesById, equipment: SEED.equipment, targetMonth: '2026-11',
    });
    assert.deepEqual(rows.map((r) => r.customerId), ['c1']);
  });

  test('時段反查（candidatesFor）：不在名單上、也不在「為什麼不在」裡', () => {
    const { candidates, excluded } = candidatesFor({
      course: coursesById['course-recovery'], date: '2026-11-20', startsAt: '14:00', endsAt: '15:00',
      customers: [regular, guest], entitlementsBy: ENTS, visitsBy: {}, availabilityBy: {}, equipment: SEED.equipment, today: TODAY,
    });
    const ids = [...candidates, ...excluded].map((r) => r.customerId);
    assert.ok(!ids.includes('g1'), ids.join('、'));
    assert.ok(ids.includes('c1'));
  });

  test('轉成我的客戶（oneTime: false）之後照一般客戶：每一張名單都有他', () => {
    const customers = [regular, converted];
    assert.deepEqual(buildCustomerQueue({ customers, entitlementsBy: ENTS, targetMonth: '2026-11', today: TODAY }).map((r) => r.customerId).sort(), ['c1', 'g1']);
    assert.deepEqual(customersToAsk({ customers, entitlementsBy: ENTS, availabilityBy: {}, today: TODAY }).map((r) => r.customerId).sort(), ['c1', 'g1']);
  });

  const src = (p) => readFileSync(fromRoot(p), 'utf8');

  test('看這個月的進度（progress.js 讀 customers 那一行）明寫 isOneTime()', () => {
    assert.match(src('public/js/ui/views/progress.js'), /customers: customers\.filter\(\(c\) => c\.active !== false && !isOneTime\(c\)\)/);
  });

  test('長備註「寫給誰？」明寫 isOneTime()', () => {
    assert.match(src('public/js/ui/views/longNotes.js'), /ctx\.customers\.filter\(\(c\) => !c\.deletedAt && !isOneTime\(c\) && nameHas\(c\.name, q\)\)/);
  });

  test('手動貼上（report.js）那一排「要哪一份」不列一次性客人', () => {
    assert.match(src('public/js/ui/views/report.js'), /customers: customers\.filter\(\(c\) => !isOneTime\(c\)\)/);
  });
});

// ---------- 試算表 ----------

const ot = (over = {}) => ({
  entitlementId: null, courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '11:00',
  therapistId: null, roomId: null, doctorId: null, followupForVisitId: null, giftKind: null, note: null, status: 'done', attended: true,
  oneTime: true, ...over,
});
const paid = (over = {}) => {
  const { oneTime, ...rest } = ot({ entitlementId: 'e-g1', startsAt: '14:00', endsAt: '15:00', ...over });
  return rest;
};
const day = (id, date, slots, status = 'done') => ({ id, customerId: 'g1', customerName: '客戶A', date, status, slots });

const bundle = (customers, visits, tasks = []) => syncBundle({
  customers, entitlementsBy: ENTS, visitsBy: { g1: visits, c1: [] }, tasksBy: { g1: tasks }, today: TODAY,
  master: SEED,
});

describe('試算表：一次性客人不進、一次性的段不進任何一列', () => {
  test('還沒轉的一次性客人：沒有那一頁（就算替他加了一筆額度）', () => {
    const b = bundle([regular, guest], [day('v1', '2026-10-03', [ot()])]);
    assert.deepEqual(b.sheets.map((s) => s.name), ['王小明']);
  });

  test('轉成我的客戶之後：當一次性客人時的那一天沒有那一欄、沒有任何符號；之後扣額度的那一天照畫', () => {
    const visits = [day('v1', '2026-10-03', [ot()]), day('v2', '2026-11-03', [paid()])];
    const [sheet] = bundle([converted], visits).sheets;
    assert.deepEqual(sheet.dates, ['2026-11-03']);
    assert.ok(!JSON.stringify(sheet.rows).includes('復能（'), JSON.stringify(sheet.rows));
    assert.deepEqual(sheet.rows.map((r) => [r.label, r.done, r.marks.join('|')]), [['復能-SIS(60)', 1, '✓']]);
    assert.deepEqual(sheet.log.map((d) => d.date), ['2026-11-03']);
  });

  test('同一天混著一次性與一般的段：只畫一般的那一段（來訪紀錄也只有它）', () => {
    const [sheet] = bundle([converted], [day('v1', '2026-11-03', [ot(), paid()])]).sheets;
    assert.deepEqual(sheet.dates, ['2026-11-03']);
    assert.equal(sheet.rows.length, 1);
    assert.equal(sheet.log[0].items.length, 1);
    assert.match(sheet.log[0].items[0].time, /14:00/);
  });

  test('一次性那一段做完、一般那一段取消 → 那一天整天不畫（照留下來的段重推狀態）', () => {
    const v = day('v1', '2026-11-03', [ot(), paid({ status: 'cancelled', attended: null })]);
    const [sheet] = bundle([converted], [v]).sheets;
    assert.deepEqual(sheet.dates, []);
    assert.equal(sheetVisits([v])[0].status, 'cancelled');
  });

  test('每一個日期欄至少有一格有符號（tests/sheet-rows-without-entitlement 的不變量照樣成立）', () => {
    const visits = [
      day('v1', '2026-10-03', [ot()]),
      day('v2', '2026-10-10', [ot({ courseId: 'course-checkup', courseName: '健檢', equipmentId: null })]),
      day('v3', '2026-11-03', [ot(), paid()]),
    ];
    const [sheet] = bundle([converted], visits).sheets;
    sheet.dates.forEach((_, i) => assert.ok(sheet.rows.some((r) => r.marks[i]), `第 ${i} 欄`));
  });

  test('只掛在一次性的段上的待辦不印（TODO／FINISHED）；一般的照印', () => {
    const visits = [day('v1', '2026-10-03', [ot()]), day('v2', '2026-11-03', [paid()])];
    const tasks = [
      { id: 't1', kind: 'Abovee', visitId: 'v1', customerId: 'g1', slotIndexes: [0], done: true, doneAt: '2026-10-01T02:00:00Z', dueDate: '2026-10-02' },
      { id: 't2', kind: '追蹤健檢報告', visitId: 'v1', customerId: 'g1', done: false, dueDate: '2026-10-24' },
      { id: 't3', kind: 'Abovee', visitId: 'v2', customerId: 'g1', slotIndexes: [0], done: true, doneAt: '2026-11-01T02:00:00Z', dueDate: '2026-11-02' },
    ];
    const [sheet] = bundle([converted], visits, tasks).sheets;
    assert.equal(sheet.tasks.todo.length, 0);
    assert.equal(sheet.tasks.finished.length, 1);
    assert.match(sheet.tasks.finished[0].label, /11\/3/);
  });

  test('接在一次性健檢上的二返註記不印（那一天沒畫出來）', () => {
    const exam = day('v1', '2026-10-03', [ot({ courseId: 'course-checkup', courseName: '健檢', equipmentId: null })]);
    const second = day('v2', '2026-11-03', [ot({ courseId: 'course-followup', courseName: '二返', equipmentId: null, followupForVisitId: 'v1', status: 'confirmed', attended: null })], 'confirmed');
    const [sheet] = bundle([converted], [exam, second, day('v3', '2026-11-04', [paid()])]).sheets;
    assert.deepEqual(sheet.followupNotes, []);
    assert.deepEqual(sheet.dates, ['2026-11-04']);
  });

  test('一般客戶：沒有一次性的段時那一份來訪原封不動（同一個物件）', () => {
    const v = { id: 'r1', customerId: 'c1', date: '2026-11-03', status: 'done', slots: [paid({ entitlementId: 'e-c1' })] };
    assert.equal(sheetVisits([v])[0], v);
  });

  test('一次性客人跟一般客戶同名：一般客戶那一頁不加尾巴', () => {
    const twin = { ...guest, name: '王小明' };
    const b = bundle([regular, twin], []);
    assert.deepEqual(b.sheets.map((s) => s.name), ['王小明']);
  });

  test('手動貼上（customerReport）同一條：一次性的段不進', () => {
    const visits = [day('v1', '2026-10-03', [ot()]), day('v2', '2026-11-03', [paid()])];
    const report = customerReport({ customer: converted, entitlements: ENTS.g1, visits, courses: COURSES, equipment: SEED.equipment, today: TODAY });
    const head = report.rows.find((r) => r[0] === '療程項目');
    assert.equal(head.slice(5).length, 1);
    assert.match(head[5], /^11\/3/);
    assert.ok(!report.rows.some((r) => String(r[0]).startsWith('復能（')), JSON.stringify(report.rows));
  });
});

// ---------- 資料健檢 ----------

describe('資料健檢', () => {
  const findingsOf = (result, id) => result.checks.find((c) => c.id === id).findings;
  const snap = (over) => ({
    customers: [guest], entitlements: [], visits: [], tasks: [], availability: [], master: SEED, ...over,
  });

  test('不叫她去問一次性客人這輪的時間（就算替他加了一筆額度）；一般客戶照講', () => {
    const r = runHealthCheck(snap({ customers: [guest, regular], entitlements: [...ENTS.g1, ...ENTS.c1] }), TODAY);
    assert.deepEqual(findingsOf(r, 'staleAvailability').map((f) => f.whoId), ['c1']);
  });

  test('一次性的二返接一次性的健檢（還排著）→ 不是「接不上」、也不是「一次被兩場接走」', () => {
    const exam = day('v1', '2026-11-10', [ot({ courseId: 'course-checkup', courseName: '健檢', equipmentId: null, status: 'confirmed', attended: null })], 'confirmed');
    const second = day('v2', '2026-11-30', [ot({ courseId: 'course-followup', courseName: '二返', equipmentId: null, followupForVisitId: 'v1', status: 'pending_confirm', attended: null })], 'pending_confirm');
    const r = runHealthCheck(snap({ visits: [exam, second] }), TODAY);
    assert.deepEqual(findingsOf(r, 'followupLinks'), []);
    assert.deepEqual(findingsOf(r, 'followupDouble'), []);
  });

  test('一次性的健檢取消了、二返還接著 → 照列（跟一般客戶一樣）', () => {
    const exam = day('v1', '2026-10-10', [ot({ courseId: 'course-checkup', courseName: '健檢', equipmentId: null, status: 'cancelled', attended: null })], 'cancelled');
    const second = day('v2', '2026-11-30', [ot({ courseId: 'course-followup', courseName: '二返', equipmentId: null, followupForVisitId: 'v1', status: 'pending_confirm', attended: null })], 'pending_confirm');
    const r = runHealthCheck(snap({ visits: [exam, second] }), TODAY);
    assert.equal(findingsOf(r, 'followupLinks').length, 1);
  });

  test('一次性客人是一份客戶文件：他的來訪不是孤兒', () => {
    const r = runHealthCheck(snap({ visits: [day('v1', '2026-10-03', [ot()])] }), TODAY);
    assert.deepEqual(findingsOf(r, 'orphans'), []);
  });
});
