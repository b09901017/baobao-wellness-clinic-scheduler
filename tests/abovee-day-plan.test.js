// 拍 Abovee：一位一天一份計畫 —— 驗證、確認框、寫入只算一次（abovee-status-follows-photo-2026-10-15/06）。
//
// 她 10/15：「次數不能弄錯這很重要 ! !」「確實有可能我會忘記或是其他情境導致一些問題，希望你都考慮進去」
//
// 以前「拍完、記錄之後那一天長什麼樣」有三個地方各算一次：`plan()`（驗證與提醒，只認識新的段）、`aboveeConsequences()`
// （確認框，寫死「每一段都記成待確認」）、`record()`（真的寫，一天連存好幾筆時共用同一份舊的 `fresh`）。
// 現在三邊都只讀 `photoDayPlan()`；存的時候走 `writePhotoPlan()`（每存一筆就換進手上那一份）。
//
// **判準：確認框的次數加總 ＝ 存完之後每一筆額度前後的差**（`counts()` 與額度上的 `doneCount`／`bookedCount` 都驗）。
// 存檔的假身體照 `data/visits.js` 的 `save()` 算快取（`recount(touchedEntitlementIds(previous, next), after)`）。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  countDeltas, missedSay, photoDayPlan, planToWrite, pressedDays, readAbovee, resolveSaved, wantsWrite, writePhotoPlan, planAbovee,
} from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { counts } from '../public/js/domain/entitlements.js';
import { recount, slotStatus, touchedEntitlementIds, visitStatusFrom, withSlotStatuses } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';
import { chainLeftovers, syncFollowupTasks } from '../public/js/domain/followups.js';
import { readFileSync } from 'node:fs';

const TODAY = '2026-09-12';
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
const REHAB = { id: 'w-rehab', type: 'single', label: '復健科醫師門診', courseId: 'course-rehab', totalQty: 3 };
const EXAM = { id: 'w-exam', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 2 };
const FU = { id: 'w-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 2, followupForEntitlementId: 'w-exam' };
const PEOPLE = [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }];
const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

const slot = (courseId, entitlementId, startsAt, endsAt, status = 'confirmed', over = {}) => ({
  entitlementId, courseId, startsAt, endsAt, status, attended: null, ...over,
});
const sis = (t, e, status, over) => slot('course-recovery', 'w-pool', t, e, status, { equipmentId: 'eq-sis', ...over });
const indiba = (t, e, status, over) => slot('course-recovery', 'w-pool', t, e, status, { equipmentId: 'eq-indiba', ...over });
const visit = (id, date, slots) => ({ id, customerId: 'c-wang', customerName: '王小明', date,
  status: visitStatusFrom({ status: 'pending_confirm', slots }), slots });
const ctx = (visits, ents = [POOL, REHAB, EXAM, FU], today = TODAY) => ({
  customers: PEOPLE, entitlementsBy: { 'c-wang': ents }, visitsBy: { 'c-wang': visits },
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today,
});
const row = (status, date, time, course) => [status, date, time, '王小明', '00001234', course];
const read = (rows, c) => readAbovee([{ columns: COLS, rows, pageText: `${rows.length}筆第1/1頁` }], c).items;

/** 存檔的假身體：照 `data/visits.js` 的 `save()` 算額度快取，記下每一次交下去的 `freed` */
function fakeDb(stored) {
  const db = { visits: [...stored], cache: {}, calls: 0, failAt: null, freed: [], nextId: 1 };
  const save = async (v, hand, { freed = [] } = {}) => {
    db.calls += 1;
    if (db.failAt === db.calls) throw new Error('網路斷了');
    const id = v.id ?? `new-${db.nextId++}`;
    const next = withSlotStatuses({ ...v, id });
    const previous = (hand ?? []).find((x) => x.id === id) ?? null;
    const after = [...(hand ?? []).filter((x) => x.id !== id), next];
    Object.assign(db.cache, recount(touchedEntitlementIds(previous, next), after));
    db.visits = [...db.visits.filter((x) => x.id !== id), next];
    db.freed.push(...freed.map((i) => `${id}:${i}`));
    return id;
  };
  return { db, save };
}

/** 確認框上的次數加總：「（扣 N 次）」算正的、「（還 N 次）」算負的 */
const said = (lines) => lines.reduce((sum, l) => {
  for (const m of l.matchAll(/（(扣|還) (\d+) 次）/g)) sum += (m[1] === '扣' ? 1 : -1) * Number(m[2]);
  return sum;
}, 0);
const used = (ents, visits) => ents.reduce((sum, e) => sum + counts(e, visits, e.id).done + counts(e, visits, e.id).booked, 0);

describe('一位一天：照片取消一段、改期一段、多一段新的課程完成（過去）', () => {
  const v1 = visit('v1', '2026-09-08', [sis('10:00', '11:00'), indiba('16:00', '17:00')]);
  const c = ctx([v1]);
  const items = read([
    row('已取消', '2026-09-08', '10:00 - 11:00', 'SIS 60'),
    row('課程完成', '2026-09-08', '14:00 - 15:00', 'SIS 60'),
    row('課程完成', '2026-09-08', '17:00 - 18:00', 'INDIBA 60'),
  ], c);

  test('三列各是什麼：要改的（取消）、新的（勾著）、改期（勾著）', () => {
    assert.deepEqual(items.map((i) => [i.kind, wantsWrite(i)]), [['recorded', true], ['new', true], ['recorded', true]]);
    assert.equal(items[0].statusChange?.to, 'cancelled');
    assert.equal(items[2].move?.status, 'done');
  });

  test('計畫：拍照之前那一天還開著 → 新的那一段併進同一次（一天一次來訪，她 10/16）；舊時間那兩段放掉', () => {
    const p = photoDayPlan(items, c);
    assert.deepEqual(p.missed, []);
    assert.equal(p.writes.length, 1);
    const [day] = p.writes;
    assert.equal(day.id, 'v1');
    assert.deepEqual(day.visit.slots.map((s) => [s.startsAt, s.status]),
      [['10:00', 'cancelled'], ['16:00', 'cancelled'], ['17:00', 'done'], ['14:00', 'done']]);
    assert.equal(day.visit.status, 'done');
    assert.deepEqual(day.freed, [0, 1]);
    assert.equal(day.adds.afterClosed, false);
  });

  test('確認框的次數加總 ＝ 存完之後的差（counts() 與額度快取都驗）', async () => {
    const p = photoDayPlan(items, c);
    const { lines } = aboveeConsequences({ plan: p, coursesById, today: TODAY });
    const { db, save } = fakeDb([v1]);
    await writePhotoPlan(p, { hand: [v1], save });
    const ents = [POOL, REHAB, EXAM, FU];
    assert.equal(said(lines), used(ents, db.visits) - used(ents, [v1]), lines.join('\n'));
    assert.deepEqual(countDeltas(ents, [v1], db.visits), p.deltas['c-wang']);
    // 快取：第二筆看得到第一筆（以前兩次都拿同一份舊的 fresh）
    const real = counts(POOL, db.visits, POOL.id);
    assert.deepEqual(db.cache[POOL.id], { doneCount: real.done, bookedCount: real.booked });
    assert.deepEqual(db.freed, ['v1:0', 'v1:1']);
  });

  test('確認框照實講：不講「每一段都記成待確認」、講改成已取消（還 1 次）、改期、新的那一段已完成（扣 1 次）、不另開一次', () => {
    const p = photoDayPlan(items, c);
    const { title, lines } = aboveeConsequences({ plan: p, coursesById, today: TODAY });
    assert.equal(title, '記錄這 1 段、改 2 段？');
    assert.ok(!lines.some((l) => l.includes('每一段都記成「待確認」')), lines.join('\n'));
    assert.ok(lines.includes('照 Abovee 改成「已取消」1 段（還 1 次）'), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('照 Abovee 改期 1 段')), lines.join('\n'));
    assert.ok(lines.some((l) => l.startsWith('新的 1 段照 Abovee 記：「已完成」1 段（扣 1 次）')), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('另開一次新的來訪')), '同一天併進同一次');
    assert.ok(!lines.some((l) => l.includes('跟客人確認時間') || l.includes('簽療程單')), '沒有一段是待確認');
    assert.ok(lines.some((l) => l.includes('「取消 Abovee」直接勾好')), lines.join('\n'));
  });

  test('存到第二筆失敗、再按一次：第一筆不重複、第二筆補上（兩天各一筆）', async () => {
    const one = visit('v1', '2026-09-08', [sis('10:00', '11:00')]);
    const two = read([row('已取消', '2026-09-08', '10:00 - 11:00', 'SIS 60'), row('課程完成', '2026-09-09', '14:00 - 15:00', 'SIS 60')], ctx([one]));
    const { db, save } = fakeDb([one]);
    db.failAt = 2;
    const savedKeys = new Set();
    const p = photoDayPlan(two, ctx([one]));
    assert.equal(p.writes.length, 2);
    await assert.rejects(writePhotoPlan(p, { hand: [one], save, onWrite: (w) => w.keys.forEach((k) => savedKeys.add(k)) }));
    assert.deepEqual([...savedKeys], [two[0].key]);
    // 再按一次：重讀之後只拿還沒存的那幾列重算
    const again = photoDayPlan(two.filter((i) => !savedKeys.has(i.key)), ctx(db.visits));
    assert.deepEqual(again.missed, []);
    assert.equal(again.writes.length, 1);
    await writePhotoPlan(again, { hand: db.visits, save });
    const all = db.visits.flatMap((v) => v.slots.map((s) => `${v.date} ${s.startsAt} ${s.status}`)).sort();
    assert.deepEqual(all, ['2026-09-08 10:00 cancelled', '2026-09-09 14:00 done']);
    const real = counts(POOL, db.visits, POOL.id);
    assert.deepEqual(db.cache[POOL.id], { doneCount: real.done, bookedCount: real.booked });
  });
});

describe('同一天：照片把那一天結掉、又有一段新的 → 併進同一次（她 10/16：「好，可以改」）', () => {
  // 以前新的那一段拿「改完之後」的那一天去併，那一天改完就結案了 → 另開一次來訪：客戶詳情、進度追蹤那一天兩列、
  // 待辦中心的確認／簽療程單分兩列、資料健檢「同一天有兩筆來訪」列出來。拍照之前那一天還開著，就照一天一次（ADR-0083）
  test('今天 10:00 照片寫課程完成、15:00 新約了復健科 → 一次來訪；次數：復能不變、門診扣 1', async () => {
    const v1 = visit('v1', TODAY, [sis('10:00', '11:00')]);
    const c = ctx([v1]);
    const items = read([row('課程完成', TODAY, '10:00 - 11:00', 'SIS 60'), row('確認前往', TODAY, '15:00 - 16:00', '復健科醫師門診')], c);
    const p = photoDayPlan(items, c);
    assert.equal(p.writes.length, 1);
    assert.deepEqual(p.writes[0].visit.slots.map((s) => [s.startsAt, s.status]), [['10:00', 'done'], ['15:00', 'pending_confirm']]);
    assert.equal(p.writes[0].visit.status, 'pending_confirm');
    const { lines } = aboveeConsequences({ plan: p, coursesById, today: TODAY });
    assert.ok(!lines.some((l) => l.includes('另開一次新的來訪')), lines.join(' / '));
    assert.ok(lines.some((l) => l.includes('那一天原本談定的段不動')), '原本談定的那一天加一段待確認：講一句');
    const { db, save } = fakeDb([v1]);
    await writePhotoPlan(p, { hand: [v1], save });
    const ents = [POOL, REHAB, EXAM, FU];
    assert.equal(said(lines), used(ents, db.visits) - used(ents, [v1]));
    assert.deepEqual(countDeltas(ents, [v1], db.visits), p.deltas['c-wang']);
    assert.equal(db.visits.filter((v) => v.date === TODAY).length, 1);
  });

  test('唯一那一段照片已取消、同一天新的時間確認前往 → 一次來訪、整天不是取消、取消的那幾格不留在整天身上', () => {
    const v1 = visit('v1', '2026-09-20', [sis('10:00', '11:00')]);
    const c = ctx([v1]);
    const items = read([row('已取消', '2026-09-20', '10:00 - 11:00', 'SIS 60'), row('確認前往', '2026-09-20', '14:00 - 15:00', 'INDIBA 60')], c);
    const p = photoDayPlan(items, c);
    assert.equal(p.writes.length, 1);
    const [w] = p.writes;
    assert.deepEqual(w.visit.slots.map((s) => [s.startsAt, s.status]), [['10:00', 'cancelled'], ['14:00', 'pending_confirm']]);
    assert.equal(w.visit.status, 'pending_confirm');
    assert.deepEqual([w.visit.cancelledAt ?? null, w.visit.cancelReason ?? null], [null, null]);
    assert.deepEqual(w.freed, [0]);
  });

  test('拍照之前那一天就已經結案了：照舊另開一次（ADR-0083）', () => {
    const v1 = visit('v1', '2026-09-08', [sis('10:00', '11:00', 'done', { attended: true })]);
    const c = ctx([v1]);
    const items = read([row('課程完成', '2026-09-08', '10:00 - 11:00', 'SIS 60'), row('課程完成', '2026-09-08', '14:00 - 15:00', '復健科醫師門診')], c);
    const p = photoDayPlan(items, c);
    assert.equal(p.writes.length, 1);
    assert.equal(p.writes[0].visit.id, undefined);
    assert.equal(p.writes[0].adds.afterClosed, true);
  });
});

describe('驗證拿改完之後的那一天', () => {
  test('10:00 那一場二返照片已取消、11:00 新的二返接同一次健檢：不報「已經接了」、不報超用', () => {
    const fu1 = { ...FU, totalQty: 1 };
    const ex = visit('v-ex1', '2026-09-01', [slot('course-checkup', 'w-exam', '09:00', '12:00', 'done', { attended: true })]);
    const day = visit('v-day', '2026-09-20', [slot('course-followup', 'w-fu', '10:00', '10:30', 'confirmed', { followupForVisitId: 'v-ex1' })]);
    const c = ctx([ex, day], [POOL, EXAM, fu1]);
    const items = read([row('已取消', '2026-09-20', '10:00 - 10:30', '二返'), row('確認前往', '2026-09-20', '11:00 - 11:30', '二返')], c);
    // 「接哪一次健檢」也看改完之後的：10:00 那一場取消了，那一次健檢空出來 —— 剛好一次，先選好
    assert.equal(items[1].followupForVisitId, 'v-ex1');
    const picked = items;
    const p = photoDayPlan(picked, c);
    const key = picked[1].key;
    assert.equal(p.problems[key], undefined, JSON.stringify(p.problems));
    assert.ok(!(p.mustSeeBy[key] ?? []).some((t) => t.includes('超過')), JSON.stringify(p.mustSeeBy[key]));
    assert.equal(p.writes.flatMap((w) => w.keys).length, 2);
  });
});

describe('二返接同一張照片上的健檢、兩段都寫完成（過去）', () => {
  test('健檢那一天先存、二返接上真的 id、兩段都是已完成', async () => {
    const c = ctx([]);
    const items = read([row('課程完成', '2026-09-01', '09:00 - 12:00', '健檢'), row('課程完成', '2026-09-05', '10:00 - 10:30', '二返')], c);
    assert.deepEqual(items.map((i) => [i.kind, i.checked]), [['new', true], ['new', true]]);
    const p = photoDayPlan(items, c);
    assert.deepEqual(p.writes.map((w) => w.date), ['2026-09-01', '2026-09-05']);
    const { db, save } = fakeDb([]);
    const savedIds = new Map();
    await writePhotoPlan(p, { hand: [], save, savedIds });
    const exam = db.visits.find((v) => v.date === '2026-09-01');
    const fu = db.visits.find((v) => v.date === '2026-09-05');
    assert.equal(fu.slots[0].followupForVisitId, exam.id);
    assert.deepEqual([slotStatus(exam, exam.slots[0]), slotStatus(fu, fu.slots[0])], ['done', 'done']);
    assert.equal(resolveSaved(items[1], savedIds).followupForVisitId, exam.id, '跨好幾次按「記錄」也接得上');
  });

  test('存的那一下（重讀之後再算一次，`planToWrite()`）：兩天都還沒存時二返照樣接得上（E2E 65 的 L6 抓到的）', async () => {
    const c = ctx([]);
    const items = read([row('確認前往', '2026-09-15', '09:00 - 12:00', '健檢'), row('確認前往', '2026-09-24', '10:00 - 10:30', '二返')], c);
    assert.equal(items[1].followupForVisitId, 'abovee:c-wang|2026-09-15');
    const { db, save } = fakeDb([]);
    const savedIds = new Map();
    await writePhotoPlan(planToWrite(items, c, savedIds), { hand: [], save, savedIds });
    const exam = db.visits.find((v) => v.date === '2026-09-15');
    assert.equal(db.visits.find((v) => v.date === '2026-09-24').slots[0].followupForVisitId, exam.id);
  });

  test('存的那一下：接的那一次健檢上一次按「記錄」就存好了 → 換成真的 id；這一次沒有要記、也沒存過 → 那一列存不下去（不會接到一個不存在的）', () => {
    const c = ctx([]);
    const items = read([row('確認前往', '2026-09-15', '09:00 - 12:00', '健檢'), row('確認前往', '2026-09-24', '10:00 - 10:30', '二返')], c);
    const saved = visit('v-real', '2026-09-15', [slot('course-checkup', 'w-exam', '09:00', '12:00', 'pending_confirm')]);
    const before = planToWrite([items[1]], ctx([saved]), new Map([['abovee:c-wang|2026-09-15', 'v-real']]));
    assert.equal(before.writes[0].visit.slots[0].followupForVisitId, 'v-real');
    const lost = planToWrite([items[1]], c, new Map());
    assert.deepEqual(lost.writes, []);
    assert.match(lost.problems[items[1].key][0], /健檢來訪不存在/);
  });

  test('倒過來排在照片上（二返先、健檢後）：照樣健檢那一天先存', () => {
    const c = ctx([]);
    const items = read([row('課程完成', '2026-09-05', '10:00 - 10:30', '二返'), row('課程完成', '2026-09-01', '09:00 - 12:00', '健檢')], c);
    assert.deepEqual(photoDayPlan(items, c).writes.map((w) => w.date), ['2026-09-01', '2026-09-05']);
  });
});

describe('標壓完', () => {
  test('整組都是照片上已取消的那一天：不標', () => {
    const c = ctx([]);
    const items = read([row('已取消', '2026-09-15', '10:00 - 11:00', 'SIS 60')], c).map((i) => ({ ...i, checked: true }));
    const p = photoDayPlan(items, c);
    assert.equal(p.writes.length, 1);
    assert.deepEqual(pressedDays(p), []);
  });

  test('有一段活著的那一天：標', () => {
    const c = ctx([]);
    const items = read([row('確認前往', '2026-09-15', '10:00 - 11:00', 'SIS 60')], c);
    assert.deepEqual(pressedDays(photoDayPlan(items, c)), [{ customerId: 'c-wang', date: '2026-09-15' }]);
  });
});

describe('確認框的句子照實講', () => {
  test('沒有任何改狀態、改期的照片（只有未來的確認前往）：跟以前一模一樣', () => {
    const c = ctx([]);
    const items = read([row('確認前往', '2026-09-15', '10:00 - 11:00', 'SIS 60'), row('確認前往', '2026-09-16', '10:00 - 10:30', '復健科醫師門診')], c);
    const p = photoDayPlan(items, c);
    const old = aboveeConsequences({ groups: planAbovee(items, c).groups, coursesById, today: TODAY });
    assert.deepEqual(aboveeConsequences({ plan: p, coursesById, today: TODAY }), old);
    assert.ok(old.lines.some((l) => l.startsWith('每一段都記成「待確認」')));
  });

  test('新的二返已完成（過去）：不講「每一段都記成待確認」、不講「之後會多一張 Examine」；會多一張「寫紀錄」', () => {
    const ex = visit('v-ex1', '2026-09-01', [slot('course-checkup', 'w-exam', '09:00', '12:00', 'done', { attended: true })]);
    const c = ctx([ex]);
    const items = read([row('課程完成', '2026-09-05', '10:00 - 10:30', '二返')], c);
    assert.equal(items[0].followupForVisitId, 'v-ex1');
    const { lines } = aboveeConsequences({ plan: photoDayPlan(items, c), coursesById, today: TODAY });
    assert.ok(!lines.some((l) => l.includes('每一段都記成「待確認」')), lines.join('\n'));
    assert.ok(!lines.some((l) => l.startsWith('等客人說可以之後')), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('「寫紀錄」')), lines.join('\n'));
  });

  test('新的健檢記成未到：不講「要接到這一次」；新的健檢待確認：照講', () => {
    const old = visit('v-old', '2026-08-20', [slot('course-checkup', 'w-exam', '09:00', '12:00', 'cancelled')]);
    const fu = visit('v-fu', '2026-09-25', [slot('course-followup', 'w-fu', '10:00', '10:30', 'confirmed', { followupForVisitId: 'v-old' })]);
    const c = ctx([old, fu]);
    const missedExam = read([row('客戶失約', '2026-09-10', '09:00 - 12:00', '健檢')], c);
    const a = aboveeConsequences({ plan: photoDayPlan(missedExam, c), coursesById, today: TODAY, entitlementsBy: c.entitlementsBy });
    assert.ok(!a.lines.some((l) => l.includes('要接到這一次')), a.lines.join('\n'));
    const booked = read([row('確認前往', '2026-09-28', '09:00 - 12:00', '健檢')], c);
    const b = aboveeConsequences({ plan: photoDayPlan(booked, c), coursesById, today: TODAY, entitlementsBy: c.entitlementsBy });
    assert.ok(b.lines.some((l) => l.includes('要接到這一次')), b.lines.join('\n'));
  });

  test('照片改成已取消：「取消 Abovee」已經勾好那一句、還沒勾的 Examine 會被收掉', () => {
    const v1 = visit('v1', '2026-09-15', [slot('course-rehab', 'w-rehab', '10:00', '10:30')]);
    const c = ctx([v1]);
    const items = read([row('已取消', '2026-09-15', '10:00 - 10:30', '復健科醫師門診')], c);
    const tasks = [{ id: 't1', visitId: 'v1', kind: 'Examine', done: false, autoGenerated: true, slotIndexes: [0] }];
    const { title, lines } = aboveeConsequences({ plan: photoDayPlan(items, c), coursesById, today: TODAY, tasksByVisit: { v1: tasks } });
    assert.equal(title, '改這 1 段？');
    assert.ok(lines.includes('照 Abovee 改成「已取消」1 段（還 1 次）'), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('「取消 Abovee」直接勾好')), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('還沒勾的「Examine」會被收掉')), lines.join('\n'));
    assert.ok(!lines.some((l) => l.includes('待辦會多一張「取消 Abovee」')), '已經勾好的不講成要去做');
  });

  test('健檢照片改成已完成：「追蹤健檢報告」會長；健檢照片改成未到：接在後面的二返「不會跟著改成未到」', () => {
    const ex = visit('v-ex', '2026-09-01', [slot('course-checkup', 'w-exam', '09:00', '12:00')]);
    const fu = visit('v-fu', '2026-09-25', [slot('course-followup', 'w-fu', '10:00', '10:30', 'confirmed', { followupForVisitId: 'v-ex' })]);
    const c = ctx([ex, fu]);
    const chainBy = { 'c-wang': { entitlements: [EXAM, FU], tasks: [] } };
    const done = read([row('課程完成', '2026-09-01', '09:00 - 12:00', '健檢')], c);
    const a = aboveeConsequences({ plan: photoDayPlan(done, c), coursesById, today: TODAY, chainBy });
    assert.ok(a.lines.some((l) => l.includes('「追蹤健檢報告」')), a.lines.join('\n'));
    const missed = read([row('客戶失約', '2026-09-01', '09:00 - 12:00', '健檢')], c);
    const b = aboveeConsequences({ plan: photoDayPlan(missed, c), coursesById, today: TODAY, chainBy });
    assert.ok(b.lines.some((l) => l.includes('不會跟著改成未到')), b.lines.join('\n'));
    assert.ok(b.lines.includes('照 Abovee 改成「未到」1 段（還 1 次）'), b.lines.join('\n'));
  });
});

describe('改不成的那一句照理由講', () => {
  test('別的地方改過、二返簽不成、狀態機不准', () => {
    const stale = { key: 'a', missedWhy: 'stale' };
    const blocked = { key: 'b', missedWhy: 'closeBlocked', closeBlock: { examDate: '2026-09-01', status: 'confirmed' } };
    const refused = { key: 'c', missedWhy: 'refused' };
    const text = missedSay([stale, blocked, refused]);
    assert.match(text, /1 段剛在別的地方改過/);
    assert.match(text, /接的那一次健檢（9\/1/);
    assert.match(text, /1 段這裡改不了/);
    assert.equal(missedSay([]), '');
  });
});

describe('存的那一下重讀：同一段剛在別的地方記了（10/16 審查）', () => {
  // 打開確認層時 9/8 10:00 的 SIS 還沒在 app 裡（新的、勾著）；按「記錄」之前別的裝置（或上一次沒收到回應的那一趟）已經記進去了。
  // 以前存的那一下只靠 `savedKeys` 擋重複，重讀之後不再問「app 上有沒有這一段」→ 同一天另開一筆、同一段多扣一次。
  const c0 = ctx([]);
  const items = read([
    row('課程完成', '2026-09-08', '10:00 - 11:00', 'SIS 60'),
    row('課程完成', '2026-09-08', '14:00 - 15:00', '復健科醫師門診'),
  ], c0);
  const already = visit('v-x', '2026-09-08', [sis('10:00', '11:00', 'done', { attended: true })]);

  test('打開時兩列都是新的、勾著', () => {
    assert.deepEqual(items.map((i) => [i.kind, i.checked]), [['new', true], ['new', true]]);
  });

  test('重讀之後那一列不再記、講為什麼；另一列照記；SIS 的次數不變', async () => {
    const again = planToWrite(items.filter(wantsWrite), ctx([already]));
    assert.match((again.problems[items[0].key] ?? []).join(''), /已經有這一段/);
    assert.deepEqual(again.writes.flatMap((w) => w.keys), [items[1].key]);
    const { db, save } = fakeDb([already]);
    await writePhotoPlan(again, { hand: [already], save });
    assert.equal(counts(POOL, db.visits, POOL.id).done, 1, '同一段不可以扣兩次');
    assert.equal(counts(REHAB, db.visits, REHAB.id).done, 1);
    assert.equal(said(aboveeConsequences({ plan: again, coursesById, today: TODAY }).lines), 1);
  });

  test('app 上同一個時間是另一門課、或那一段取消了：照記（那不是同一段）', () => {
    const other = visit('v-x', '2026-09-08', [indiba('10:00', '11:00', 'done', { attended: true })]);
    assert.equal(planToWrite(items.filter(wantsWrite), ctx([other])).problems[items[0].key], undefined);
    const gone = visit('v-x', '2026-09-08', [sis('10:00', '11:00', 'cancelled')]);
    assert.equal(planToWrite(items.filter(wantsWrite), ctx([gone])).problems[items[0].key], undefined);
  });

  test('照片上已取消、她自己勾起來的那一列：app 上同一格活著的那一段是重約的那一列的，不擋', () => {
    const cancelled = { ...items[0], cancelled: true, photoStatus: 'cancelled', checked: true };
    assert.equal(planToWrite([cancelled], ctx([already])).problems[cancelled.key], undefined);
  });
});

describe('健檢那條鏈：一筆一筆存時中途長出來、最後用不到的收掉（10/16 審查，她：「改」）', () => {
  // 健檢、二返兩段都在 app 上、照片都寫課程完成。存的時候健檢那一筆先存（二返接著它，ADR-0145）——
  // 那一下二返還沒做完，「追蹤健檢報告」長出來；二返存完它用不到了（二返都做完了，ADR-0139）。
  // 這一位全部存完之後收掉中途長出來、最後的樣子不會長的那幾張（`chainLeftovers()`）；確認框講的是最後的樣子。
  // 後一筆存失敗的話不收（那一張還是對的：二返沒記進去）
  const ex = visit('v-ex', '2026-09-01', [slot('course-checkup', 'w-exam', '09:00', '12:00')]);
  const fu = visit('v-fu', '2026-09-05', [slot('course-followup', 'w-fu', '10:00', '10:30', 'confirmed', { followupForVisitId: 'v-ex' })]);
  const c = ctx([ex, fu]);
  const items = read([row('課程完成', '2026-09-01', '09:00 - 12:00', '健檢'), row('課程完成', '2026-09-05', '10:00 - 10:30', '二返')], c);
  const customer = { id: 'c-wang', name: '王小明' };

  /** 存的那一下：每存一筆跑一次（同 data/visits.js 的 followupOps()，手上那一份換掉自己），長出來的待辦記著 */
  function chainDb(failAt = null) {
    const db = { tasks: [], calls: 0 };
    db.save = async (v, hand) => {
      db.calls += 1;
      if (db.calls === failAt) throw new Error('網路斷了');
      const s = syncFollowupTasks({ customer, entitlements: [EXAM, FU], visits: [...hand.filter((x) => x.id !== v.id), v], tasks: db.tasks, coursesById });
      db.tasks = [...db.tasks.filter((t) => !s.remove.some((r) => r.id === t.id)),
        ...s.create.map((t, i) => ({ ...t, id: `t-${db.tasks.length + i}` }))];
      return v.id;
    };
    return db;
  }
  const open = (tasks) => tasks.filter((t) => t.kind === '追蹤健檢報告' && !t.done && !t.deletedAt);

  test('全部存完：中途長出來的「追蹤健檢報告」收掉；確認框一句都不講', async () => {
    const p = photoDayPlan(items, c);
    assert.deepEqual(p.writes.map((w) => w.id), ['v-ex', 'v-fu'], '健檢那一筆先存');
    const { lines } = aboveeConsequences({ plan: p, coursesById, today: TODAY, chainBy: { 'c-wang': { entitlements: [EXAM, FU], tasks: [] } } });
    assert.ok(!lines.some((l) => l.includes('「追蹤健檢報告」')), lines.join(' / '));
    const db = chainDb();
    const hand = await writePhotoPlan(p, { hand: [ex, fu], save: db.save });
    assert.equal(open(db.tasks).length, 1, '中途照樣會長一張');
    const extra = chainLeftovers({ customer, entitlements: [EXAM, FU], visits: hand, tasks: db.tasks, known: new Set(), coursesById });
    assert.deepEqual(extra.map((t) => t.kind), ['追蹤健檢報告']);
    assert.equal(open(db.tasks.filter((t) => !extra.includes(t))).length, 0, '收完跟確認框講的一樣');
  });

  test('只有健檢改成已完成：那一張是要的，不收', async () => {
    const only = items.filter((i) => i.date === '2026-09-01');
    const p = photoDayPlan(only, c);
    const db = chainDb();
    const hand = await writePhotoPlan(p, { hand: [ex, fu], save: db.save });
    assert.equal(open(db.tasks).length, 1);
    assert.deepEqual(chainLeftovers({ customer, entitlements: [EXAM, FU], visits: hand, tasks: db.tasks, known: new Set(), coursesById }), []);
  });

  test('本來就在的待辦不算（known）：只收這一次才長出來的', () => {
    const before = [{ id: 'old', kind: '追蹤健檢報告', visitId: 'v-ex', autoGenerated: true, done: false, customerId: 'c-wang' }];
    const done = [{ ...ex, status: 'done', slots: [{ ...ex.slots[0], status: 'done', attended: true }] },
      { ...fu, status: 'done', slots: [{ ...fu.slots[0], status: 'done', attended: true }] }];
    assert.deepEqual(chainLeftovers({ customer, entitlements: [EXAM, FU], visits: done, tasks: before, known: new Set(['old']), coursesById }), []);
  });

  test('畫面那一支：每一位存完才收（writePhotoPlan 之後叫 dropChainLeftovers）', () => {
    const src = readFileSync(new URL('../public/js/ui/components/aboveeConfirm.js', import.meta.url), 'utf8');
    const write = src.indexOf('await writePhotoPlan(again');
    assert.ok(write > 0 && src.indexOf('dropChainLeftovers(', write) > write);
  });
});
