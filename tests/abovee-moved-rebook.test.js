// 拍 Abovee：Abovee 上改了時間 → 照片為準，直接幫她改期（abovee-status-follows-photo-2026-10-15/05）。
//
// 她 10/15：「我覺得可以這輪做 ? 然後就不用產生取消和重排的待辦 ? 對吧我都在abovee改好了，不用再叫我去取消和重排啊?合理吧 ?」
//
// **只在拿得準的時候**：剛好一對（一個舊時間、一個新時間）、舊時間落在這張照片的範圍裡（跟「app 有、這次照片上沒有」同一支範圍）、
// 舊的那一段還開著、照片上新的那一列不是已取消。其餘照舊（不預設勾、講一句、去日曆）。
// **改期那一列不再是新的一段** —— 不然舊的沒取消、新的多一段，多扣一次。次數一律拿 `counts()` 算（`countDeltas()`）。
// 推翻 ADR-0123 第 10 段、ADR-0108「新的一段是待確認」（只限拍 Abovee 這條路）。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  absentFromPhoto, applyPhotoMove, countDeltas, needsAttention, newRowSay, planAbovee, readAbovee, recordedSay,
} from '../public/js/domain/aboveeImport.js';
import { rebookSlot, visitStatusFrom } from '../public/js/domain/visits.js';
import { syncTasksForVisit } from '../public/js/domain/taskRules.js';
import { SEED } from '../public/js/domain/seed.js';

const DAY = '2026-09-10';
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
const REHAB = { id: 'w-rehab', type: 'single', label: '復健科醫師門診', courseId: 'course-rehab', totalQty: 3 };
const EXAM = { id: 'w-exam', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 2 };
const FU = { id: 'w-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 2, followupForEntitlementId: 'w-exam' };
const ENTS = [POOL, REHAB, EXAM, FU];
const PEOPLE = [
  { id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] },
  { id: 'c-a', name: '客戶A', marks: [{ text: '病歷號 2222', color: 'grey' }] },
];
const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

const plus1h = (t) => `${String(Number(t.slice(0, 2)) + 1).padStart(2, '0')}:${t.slice(3)}`;
const sis = (startsAt, over = {}) => ({
  entitlementId: 'w-pool', courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis',
  startsAt, endsAt: plus1h(startsAt), status: 'confirmed', attended: null, ...over,
});
const visitOf = (slots, over = {}) => ({
  id: 'v1', customerId: 'c-wang', customerName: '王小明', date: DAY,
  status: visitStatusFrom({ status: 'pending_confirm', slots }), slots, ...over,
});
const ctx = (visits, { today = '2026-09-01', others = {} } = {}) => ({
  customers: PEOPLE,
  entitlementsBy: { 'c-wang': ENTS, 'c-a': [POOL] },
  visitsBy: { 'c-wang': visits, ...others },
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today,
});
const r = (time, status = '確認前往', course = 'SIS 60') => [status, DAY, time, '王小明', '00001234', course];
/** 讀得出「第 1／1 頁」：照片範圍放寬到整個月（一個人、每一列都在這裡，ADR-0129） */
const WHOLE = { pageText: '1筆第1/1頁' };
const read = (rows, c, extra = WHOLE) => readAbovee([{ columns: COLS, rows, ...extra }], c).items;
const apply = (items, visit, c) => applyPhotoMove(visit, items, {
  at: '2026-09-12T10:00:00Z', guard: { entitlements: ENTS, visits: c.visitsBy['c-wang'] },
});

describe('拿得準的那一對：照片為準改期', () => {
  const visit = visitOf([sis('10:00')]);
  const c = ctx([visit]);
  const [item] = read([r('11:00 - 12:15')], c);

  test('那一列不是新的一段：已經記了＋要改期、預設打勾、記著她看到的那一段', () => {
    assert.equal(item.kind, 'recorded');
    assert.equal(item.checked, false);
    assert.equal(item.adoptMove, true);
    assert.equal(item.movedFrom.startsAt, '10:00', '「app 有、這次照片上沒有」靠它不再列 10:00');
    assert.deepEqual(item.existing, { visitId: 'v1', date: DAY, slotIndex: 0, startsAt: '10:00', courseId: 'course-recovery', status: 'confirmed' });
    assert.deepEqual([item.move.slot.startsAt, item.move.slot.endsAt], ['11:00', '12:00']);
    assert.equal(item.move.status, 'pending_confirm');
    assert.equal(needsAttention(item), false);
    assert.equal(newRowSay(item), '');
    assert.match(recordedSay(item), /10:00.*11:00/);
  });

  test('勾著也不會被 planAbovee() 當成新的一段多記一次', () => {
    assert.deepEqual(planAbovee([{ ...item, checked: true }], c).groups, []);
  });

  test('套上去：10:00 取消（放掉的是第 0 段）、11:00 接在尾巴待確認、時長照舊；次數前後一樣', () => {
    const { visit: after, freed, missed } = apply([item], visit, c);
    assert.deepEqual(missed, []);
    assert.deepEqual(freed, [0]);
    assert.deepEqual(after.slots.map((s) => [s.startsAt, s.endsAt, s.status]), [['10:00', '11:00', 'cancelled'], ['11:00', '12:00', 'pending_confirm']]);
    assert.equal(after.slots[1].entitlementId, 'w-pool');
    assert.equal(after.slots[1].equipmentId, 'eq-sis');
    assert.equal(after.status, visitStatusFrom(after));
    assert.deepEqual(countDeltas(ENTS, [visit], [after]), []);
  });

  test('「app 有、這次照片上沒有」不再列 10:00；改完再拍同一張：11:00 已經記了，什麼都不改', () => {
    const transcripts = [{ columns: COLS, rows: [r('11:00 - 12:15')], ...WHOLE }];
    assert.deepEqual(absentFromPhoto(transcripts, [item], c).slots, []);
    const { visit: after } = apply([item], visit, c);
    const c2 = ctx([after]);
    const [again] = readAbovee(transcripts, c2).items;
    assert.deepEqual([again.kind, again.move ?? null, again.statusChange ?? null], ['recorded', null, null]);
    assert.deepEqual(absentFromPhoto(transcripts, [again], c2).slots, []);
    assert.equal(apply([again], after, c2).visit, after);
  });

  test('拿得準但她拿掉勾：一格都不動', () => {
    assert.equal(apply([{ ...item, adoptMove: false }], visit, c).visit, visit);
  });

  test('寫之前那一段已經不是她看到的（別的裝置剛改過）：不改、回在 missed', () => {
    const moved = visitOf([sis('10:00', { status: 'cancelled' })]);
    const out = apply([item], moved, c);
    assert.equal(out.visit, moved);
    assert.deepEqual(out.missed.map((m) => m.missedWhy), ['stale']);
  });
});

describe('新的那一段的狀態照照片', () => {
  test('照片寫課程完成（過去）：11:00 已完成、次數不變（從「排著」變「做完」）', () => {
    const visit = visitOf([sis('10:00')]);
    const c = ctx([visit], { today: '2026-09-12' });
    const [item] = read([r('11:00 - 12:15', '課程完成')], c);
    assert.deepEqual([item.kind, item.adoptMove, item.move.status], ['recorded', true, 'done']);
    const { visit: after } = apply([item], visit, c);
    assert.deepEqual(after.slots.map((s) => s.status), ['cancelled', 'done']);
    assert.equal(after.slots[1].attended, true);
    assert.equal(after.status, 'done');
    const [d] = countDeltas(ENTS, [visit], [after]);
    assert.deepEqual([d.remaining, d.done, d.booked], [0, 1, -1]);
  });

  test('照片寫客戶失約（過去）：11:00 未到、還 1 次', () => {
    const visit = visitOf([sis('10:00')]);
    const c = ctx([visit], { today: '2026-09-12' });
    const [item] = read([r('11:00 - 12:15', '客戶失約')], c);
    const { visit: after } = apply([item], visit, c);
    assert.deepEqual(after.slots.map((s) => s.status), ['cancelled', 'no_show']);
    assert.equal(after.slots[1].attended, false);
    assert.equal(countDeltas(ENTS, [visit], [after])[0].remaining, 1);
  });

  test('過去的日子照片還寫確認前往：照樣改期（待確認），但不預設勾', () => {
    const visit = visitOf([sis('10:00')]);
    const c = ctx([visit], { today: '2026-09-12' });
    const [item] = read([r('11:00 - 12:15')], c);
    assert.deepEqual([item.kind, item.adoptMove, item.move.status], ['recorded', false, 'pending_confirm']);
  });

  test('二返照片寫課程完成、接的那一次健檢還沒做完：不預設勾；勾了改期但記成待確認（ADR-0145 的閘門）', () => {
    const exam = { id: 'v-exam', customerId: 'c-wang', customerName: '王小明', date: '2026-09-01', status: 'confirmed',
      slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '12:00', status: 'confirmed' }] };
    const fu = { entitlementId: 'w-fu', courseId: 'course-followup', courseName: '二返', startsAt: '10:00', endsAt: '10:30',
      status: 'confirmed', followupForVisitId: 'v-exam' };
    const visit = visitOf([fu]);
    const c = ctx([exam, visit], { today: '2026-09-12' });
    const [item] = read([r('11:00 - 11:30', '課程完成', '二返')], c);
    assert.deepEqual([item.kind, item.adoptMove, item.closeBlock?.examVisitId], ['recorded', false, 'v-exam']);
    const { visit: after, blocked } = apply([{ ...item, adoptMove: true }], visit, c);
    assert.deepEqual(after.slots.map((s) => [s.startsAt, s.status]), [['10:00', 'cancelled'], ['11:00', 'pending_confirm']]);
    assert.equal(after.slots[1].followupForVisitId, 'v-exam', '接哪一次健檢照舊那一段');
    assert.equal(blocked[item.key]?.examVisitId, 'v-exam');
    assert.deepEqual(countDeltas(ENTS, [exam, visit], [exam, after]), []);
  });
});

describe('拿不準的照舊（新的、不預設勾、去日曆）', () => {
  test('照片從 11:00 才開始拍（10:00 不在這張照片的範圍裡）', () => {
    const c = ctx([visitOf([sis('10:00')])]);
    const [item] = read([r('11:00 - 12:15')], c, {});
    assert.deepEqual([item.kind, item.checked, item.movedFrom?.startsAt, item.move ?? null], ['new', false, '10:00', null]);
    assert.match(newRowSay(item), /去日曆改期/);
  });

  test('那一天同一門課 app 有兩段對不到、照片上一列新的', () => {
    const c = ctx([visitOf([sis('10:00'), sis('14:00')])]);
    const [item] = read([r('11:00 - 12:15')], c);
    assert.deepEqual([item.kind, item.checked, item.move ?? null], ['new', false, null]);
  });

  test('app 一段對不到、照片上兩列新的', () => {
    const c = ctx([visitOf([sis('10:00')])]);
    const items = read([r('11:00 - 12:15'), r('15:00 - 16:15')], { ...c }, { pageText: '2筆第1/1頁' });
    assert.deepEqual(items.map((i) => [i.kind, i.checked, i.move ?? null]), [['new', false, null], ['new', false, null]]);
  });

  test('舊的那一段已經做完了：不搬', () => {
    const c = ctx([visitOf([sis('10:00', { status: 'done', attended: true })])], { today: '2026-09-12' });
    const [item] = read([r('11:00 - 12:15', '課程完成')], c);
    assert.equal(item.kind, 'new');
    assert.equal(item.move ?? null, null);
  });

  test('照片上新的那一列已取消：不叫改期', () => {
    const c = ctx([visitOf([sis('10:00')])]);
    const [item] = read([r('11:00 - 12:15', '已取消')], c);
    assert.equal(item.move ?? null, null);
  });
});

describe('新的時間撞到別人：不預設改、講出來', () => {
  test('同一位治療師 11:00 已經有別的客人', () => {
    const therapistId = SEED.staff[0].id;
    const visit = visitOf([sis('10:00', { therapistId })]);
    const other = { id: 'v-a', customerId: 'c-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [sis('11:00', { therapistId })] };
    const c = ctx([visit], { others: { 'c-a': [other] } });
    const [item] = read([r('11:00 - 12:15')], c);
    assert.deepEqual([item.kind, item.adoptMove], ['recorded', false]);
    assert.ok(item.moveWarnings?.length, '講得出撞到什麼');
    assert.match(recordedSay(item), /確定再勾/);
  });
});

describe('舊時間那一段的待辦', () => {
  test('在 Examine 掛過：「取消 Abovee」一出生就勾好、「取消 Examine」沒勾', () => {
    const rehab = { entitlementId: 'w-rehab', courseId: 'course-rehab', courseName: '復健科醫師門診', startsAt: '10:00', endsAt: '10:30', status: 'confirmed' };
    const visit = visitOf([rehab]);
    const c = ctx([visit]);
    const [item] = read([r('11:00 - 11:30', '確認前往', '復健科醫師門診')], c);
    assert.equal(item.adoptMove, true);
    const { visit: after, freed } = apply([item], visit, c);
    const tasks = [{ id: 't-ex', visitId: 'v1', kind: 'Examine', done: true, autoGenerated: true, slotIndexes: [0] }];
    const { create } = syncTasksForVisit(after, tasks, { coursesById, today: '2026-09-01', freed });
    const byKind = Object.fromEntries(create.map((t) => [t.kind, Boolean(t.done)]));
    assert.equal(byKind['取消 Abovee'], true);
    assert.equal(byKind['取消 Examine'], false);
  });
});

describe('日曆上的改期一個字都不變', () => {
  test('不帶狀態：新的那一段待確認、沒有 attended', () => {
    const visit = visitOf([sis('10:00')]);
    const after = rebookSlot(visit, 0, { ...sis('11:00') });
    assert.deepEqual(after.slots.map((s) => s.status), ['cancelled', 'pending_confirm']);
    assert.equal(after.slots[1].attended, null);
  });
});
