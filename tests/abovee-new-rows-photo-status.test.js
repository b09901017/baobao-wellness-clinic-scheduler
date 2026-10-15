// 拍 Abovee：app 裡還沒有的那一列，照照片上的預約狀態記（abovee-status-follows-photo-2026-10-15/03）。
//
// 她 10/15：「只要是abovee上寫課程完成，那就是完成了 … 已取消就是取消，客戶失約就是未到」
// 「如果app沒有但是課程完成已過去的，為什麼預設不勾呢??」「次數不能弄錯這很重要 ! !」
//
// 判準只到 domain：拿 `planAbovee()` 組出來的那一筆、整筆狀態、`counts()` 驗。
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  needsAttention, photoRowSays, planAbovee, readAbovee, refreshCloseBlocks, visitsForCheck, warningsByRow,
} from '../public/js/domain/aboveeImport.js';
import { slotFromPicks, visitWithSlot } from '../public/js/domain/slotDraft.js';
import { INITIAL_STATUS, rebookSlot, validateVisit, visitStatusFrom, withExtraSlot } from '../public/js/domain/visits.js';
import { counts } from '../public/js/domain/entitlements.js';
import { syncTasksForVisit, RECORD_TASK_KIND } from '../public/js/domain/taskRules.js';
import { closeBlockSay } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const TODAY = '2026-09-09';
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-a', name: '客戶A', marks: chart('1111') },
  { id: 'c-wang', name: '王小明', marks: chart('1234') },
];
const POOL = { id: 'a-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 };
const EXAM = { id: 'w-exam', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 2 };
const FU = { id: 'w-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 2, followupForEntitlementId: 'w-exam' };
const ENTS = { 'c-a': [POOL], 'c-wang': [EXAM, FU] };
const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));

const ctx = (visitsBy = {}, over = {}) => ({
  customers: CUSTOMERS,
  entitlementsBy: ENTS,
  visitsBy,
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today: TODAY,
  ...over,
});
const rowA = (status, date, time = '09:00 - 10:00', course = 'SIS 60') => [status, date, time, '客戶A', '00001111', course];
const rowW = (status, date, time, course) => [status, date, time, '王小明', '00001234', course];
const read = (rows, c = ctx()) => readAbovee([{ readable: true, columns: COLS, rows }], c).items;
const ticked = (items) => items.map((i) => (i.kind === 'new' ? { ...i, checked: true } : i));
const planOf = (items, c = ctx()) => planAbovee(items, c);
/** 這一組存進去之後那一筆額度剩幾次（拿 `counts()` 現算，不看畫面上的字） */
const remainingAfter = (ent, visits) => counts(ent, visits, ent.id).remaining;

describe('過去、照片寫課程完成、app 沒有', () => {
  const items = read([rowA('課程完成', '2026-09-08')]);

  test('預設勾；組出來那一段是已完成、整筆是已完成', () => {
    const [item] = items;
    assert.equal(item.kind, 'new');
    assert.equal(item.checked, true);
    const [g] = planOf(items).groups;
    assert.deepEqual(g.visit.slots.map((s) => [s.status, s.attended]), [['done', true]]);
    assert.equal(g.visit.status, 'done');
    assert.equal(g.visit.status, visitStatusFrom(g.visit));
    assert.ok(g.visit.statusAt, '整筆不是待確認時蓋時間');
  });

  test('驗證沒有一條擋「新的一段一開始就是已完成」', () => {
    const [g] = planOf(items).groups;
    const { errors } = validateVisit(g.visit, {
      customer: { flags: [] }, entitlements: ENTS['c-a'], courses: SEED.courses, equipment: SEED.equipment,
      rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts, ...visitsForCheck([g], g, ctx()),
    });
    assert.deepEqual(errors, []);
  });

  test('counts() 扣 1 次（做完的）', () => {
    const [g] = planOf(items).groups;
    assert.equal(remainingAfter(POOL, []), 12);
    assert.equal(remainingAfter(POOL, [g.visit]), 11);
    assert.equal(counts(POOL, [g.visit], POOL.id).done, 1);
  });

  test('同一天兩列都是課程完成 → 一筆兩段，兩段都在', () => {
    const two = read([rowA('課程完成', '2026-09-08', '09:00 - 10:00'), rowA('課程完成', '2026-09-08', '14:00 - 15:00', 'INDIBA 60')]);
    const { groups } = planOf(two);
    assert.equal(groups.length, 1);
    assert.deepEqual(groups[0].visit.slots.map((s) => [s.startsAt, s.status]), [['09:00', 'done'], ['14:00', 'done']]);
    assert.equal(groups[0].visit.status, 'done');
    assert.equal(remainingAfter(POOL, [groups[0].visit]), 10);
  });

  test('同一天一列完成、一列已取消（勾起來）→ 兩段都在；取消那一段不扣、記著是照片上放掉的', () => {
    const two = ticked(read([rowA('課程完成', '2026-09-08', '09:00 - 10:00'), rowA('已取消', '2026-09-08', '14:00 - 15:00')]));
    const [g] = planOf(two).groups;
    assert.deepEqual(g.visit.slots.map((s) => s.status), ['done', 'cancelled']);
    assert.equal(g.visit.status, 'done');
    assert.equal(g.visit.cancelledAt ?? null, null, '一筆已完成的身上不留取消的時間');
    assert.deepEqual(g.freed, [1]);
    assert.equal(remainingAfter(POOL, [g.visit]), 11);
  });
});

describe('二返照片寫課程完成', () => {
  const examDone = { id: 'v-exam', customerId: 'c-wang', date: '2026-09-01', status: 'done',
    slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'done', attended: true }] };

  test('接的那一次健檢做完了：已完成、扣一次，存的時候長一張「寫紀錄」', () => {
    const c = ctx({ 'c-wang': [examDone] });
    const items = read([rowW('課程完成', '2026-09-05', '14:00 - 14:30', '二返')], c);
    assert.equal(items[0].followupForVisitId, 'v-exam');
    assert.equal(items[0].checked, true);
    const [g] = planOf(items, c).groups;
    assert.equal(g.visit.slots[0].status, 'done');
    assert.deepEqual(g.blocked, {});
    assert.equal(remainingAfter(FU, [examDone, g.visit]), 1);
    const { create } = syncTasksForVisit({ ...g.visit, id: 'v-new' }, [], { coursesById, today: TODAY });
    assert.ok(create.some((t) => t.kind === RECORD_TASK_KIND), create.map((t) => t.kind).join('、'));
  });

  test('接的是同一張照片上還沒存、待確認的健檢：記成待確認、不預設勾、那一句是 closeBlockSay() 的', () => {
    const c = ctx();
    const items = read([
      rowW('確認前往', '2026-09-10', '09:00 - 11:00', '健檢'),
      rowW('課程完成', '2026-09-08', '14:00 - 14:30', '二返'),
    ], c);
    const fu = items[1];
    assert.ok(fu.followupForVisitId?.startsWith('abovee:'), '先選好照片上那一次健檢');
    assert.equal(fu.checked, false);
    assert.ok(fu.closeBlock);
    assert.equal(photoRowSays(fu)[0].startsWith(closeBlockSay(fu.closeBlock)), true);
    assert.equal(needsAttention(fu), true);

    // 她勾起來：照樣記得進去，記成待確認（不扣成做完）
    const { groups } = planOf(ticked(items), c);
    const fuGroup = groups.find((g) => g.date === '2026-09-08');
    assert.equal(fuGroup.visit.slots[0].status, INITIAL_STATUS);
    assert.equal(fuGroup.visit.status, INITIAL_STATUS);
    assert.ok(fuGroup.blocked[fu.key]);
    const said = warningsByRow(fuGroup, [], {})[fu.key];
    assert.ok(said.mustSee.some((s) => s.includes('先記成待確認')), said.mustSee.join('｜'));
  });

  test('照片上那一次健檢也寫課程完成（過去）：不擋，兩段都是已完成', () => {
    const c = ctx();
    const items = read([
      rowW('課程完成', '2026-09-01', '09:00 - 11:00', '健檢'),
      rowW('課程完成', '2026-09-08', '14:00 - 14:30', '二返'),
    ], c);
    assert.equal(items[1].closeBlock, null);
    assert.equal(items[1].checked, true);
    const { groups } = planOf(items, c);
    assert.deepEqual(groups.map((g) => g.visit.slots[0].status), ['done', 'done']);
  });

  test('拿掉健檢那一列的勾：記號跟著出來（refreshCloseBlocks()，只動記號）', () => {
    const c = ctx();
    const items = read([
      rowW('課程完成', '2026-09-01', '09:00 - 11:00', '健檢'),
      rowW('課程完成', '2026-09-08', '14:00 - 14:30', '二返'),
    ], c);
    const after = refreshCloseBlocks([{ ...items[0], checked: false }, items[1]], c);
    assert.equal(after[1].checked, true, '勾不勾是她的');
    // 健檢沒勾 → 照片上那一次存不進去：二返那一列接的暫時 id 找不到那一次 → 照「沒連結」不擋（存的時候換不到 id 就不接）
    assert.equal(after[1].closeBlock, null);
  });
});

describe('已確認的那一天、照片多一段課程完成（今天）', () => {
  test('併進那一筆、整筆照推導（不是待確認）、不算退回', () => {
    const there = { id: 'v-9', customerId: 'c-a', date: TODAY, status: 'confirmed', confirmedAt: '2026-09-01T00:00:00Z',
      slots: [{ entitlementId: 'a-pool', courseId: 'course-recovery', equipmentId: 'eq-indiba', startsAt: '14:00', endsAt: '15:00', status: 'confirmed' }] };
    const c = ctx({ 'c-a': [there] });
    const items = read([rowA('課程完成', TODAY)], c);
    assert.equal(items[0].checked, true);
    const [g] = planOf(items, c).groups;
    assert.equal(g.visit.id, 'v-9');
    assert.equal(g.reopened, false);
    assert.deepEqual(g.visit.slots.map((s) => s.status), ['confirmed', 'done']);
    assert.equal(g.visit.status, 'confirmed');
    assert.equal(g.visit.confirmedAt, '2026-09-01T00:00:00Z');
    assert.equal(remainingAfter(POOL, [g.visit]), 10, '已確認那一段佔著一次、做完的扣一次');
  });
});

describe('過去／今天／未來 × 六種字', () => {
  const one = (status, date) => read([rowA(status, date)])[0];
  const composed = (item) => planOf([{ ...item, checked: true }]).groups[0].visit;

  test('過去、確認前往：不勾＋「日子過了還沒結案」（不勾也看得到）；勾了組成待確認', () => {
    const item = one('確認前往', '2026-09-08');
    assert.equal(item.checked, false);
    assert.match(photoRowSays(item)[0], /日子過了還沒結案/);
    assert.equal(needsAttention(item), true);
    assert.deepEqual(composed(item).slots.map((s) => s.status), [INITIAL_STATUS]);
  });

  test('今天：完成勾＋已完成、確認前往勾＋待確認、失約勾＋未到', () => {
    const cases = [['課程完成', 'done'], ['確認前往', INITIAL_STATUS], ['待確認', INITIAL_STATUS], ['聯繫中', INITIAL_STATUS], ['客戶失約', 'no_show']];
    for (const [text, status] of cases) {
      const item = one(text, TODAY);
      assert.equal(item.checked, true, text);
      assert.deepEqual(photoRowSays(item), [], text);
      assert.equal(composed(item).slots[0].status, status, text);
      assert.equal(composed(item).status, status, text);
    }
  });

  test('未來、課程完成：不勾＋「還沒到就寫完成了」；勾了組成待確認', () => {
    const item = one('課程完成', '2026-09-10');
    assert.equal(item.checked, false);
    assert.match(photoRowSays(item)[0], /還沒到就寫完成了/);
    assert.equal(needsAttention(item), true);
    assert.equal(composed(item).slots[0].status, INITIAL_STATUS);
  });

  test('未來、客戶失約：不勾＋講；勾了組成待確認', () => {
    const item = one('客戶失約', '2026-09-10');
    assert.equal(item.checked, false);
    assert.match(photoRowSays(item)[0], /還沒到就寫失約了/);
    assert.equal(composed(item).slots[0].status, INITIAL_STATUS);
  });

  test('未來、確認前往：照舊勾、待確認、不講', () => {
    const item = one('確認前往', '2026-09-10');
    assert.equal(item.checked, true);
    assert.deepEqual(photoRowSays(item), []);
    assert.equal(needsAttention(item), false);
  });

  test('讀不出來：不勾＋講；勾了組成待確認', () => {
    const item = one('確認前往X', '2026-09-08');
    assert.equal(item.checked, false);
    assert.match(photoRowSays(item)[0], /讀不出預約狀態/);
    assert.equal(composed(item).slots[0].status, INITIAL_STATUS);
  });

  test('過去、客戶失約：勾、未到、counts() 不扣', () => {
    const item = one('客戶失約', '2026-09-08');
    assert.equal(item.checked, true);
    const visit = composed(item);
    assert.deepEqual(visit.slots.map((s) => [s.status, s.attended]), [['no_show', false]]);
    assert.equal(visit.status, 'no_show');
    assert.equal(remainingAfter(POOL, [visit]), 12);
  });

  test('已取消：不勾；勾了組成已取消、不扣、記著是照片上放掉的、取消理由抄照片', () => {
    const photo = { readable: true, columns: [...COLS, '取消原因'], rows: [[...rowA('已取消', '2026-09-10'), '客人有事']] };
    const [item] = readAbovee([photo], ctx()).items;
    assert.equal(item.checked, false);
    const { groups } = planOf([{ ...item, checked: true }]);
    const visit = groups[0].visit;
    assert.deepEqual(visit.slots.map((s) => [s.status, s.cancelReason]), [['cancelled', '客人有事']]);
    assert.equal(visit.status, 'cancelled');
    assert.equal(visit.cancelReason, '客人有事');
    assert.equal(visit.released, false);
    assert.ok(visit.cancelledAt);
    assert.deepEqual(groups[0].freed, [0]);
    assert.equal(remainingAfter(POOL, [visit]), 12);
  });
});

describe('那一張沒拍到「預約狀態」那一欄（photoStatus 是 null）', () => {
  const without = (rows) => readAbovee([{ readable: true, columns: COLS.slice(1), rows: rows.map((r) => r.slice(1)) }], ctx()).items;

  test('照舊：還沒到的勾、已經過的不勾、一律待確認、不講', () => {
    const items = without([rowA('課程完成', '2026-09-08'), rowA('課程完成', '2026-09-10', '10:00 - 11:00')]);
    assert.deepEqual(items.map((i) => i.checked), [false, true]);
    assert.deepEqual(items.map((i) => photoRowSays(i)), [[], []]);
    const [g] = planOf(ticked(items)).groups;
    assert.deepEqual(g.visit.slots.map((s) => s.status), [INITIAL_STATUS]);
  });
});

describe('合併扣課兩列一個完成一個確認前往', () => {
  test('記成待確認、不勾、講一句', () => {
    const photo = {
      readable: true,
      columns: [...COLS, '合併扣課'],
      rows: [
        [...rowA('課程完成', '2026-09-08', '10:30 - 11:00', 'IN 30'), '是'],
        [...rowA('確認前往', '2026-09-08', '11:00 - 11:30', 'SIS 30'), '是'],
      ],
    };
    const c = ctx({}, { entitlementsBy: { 'c-a': [{ ...POOL, durationMin: 60 }] } });
    const items = readAbovee([photo], c).items;
    assert.equal(items.length, 1, '一對合成一列');
    const [item] = items;
    assert.equal(item.checked, false);
    assert.match(photoRowSays(item)[0], /合併扣課兩列的預約狀態不一樣/);
    assert.equal(needsAttention(item), true);
    const [g] = planOf([{ ...item, checked: true }], c).groups;
    assert.equal(g.visit.slots[0].status, INITIAL_STATUS);
  });

  test('兩列都寫課程完成（過去）：記成已完成、勾', () => {
    const photo = {
      readable: true,
      columns: [...COLS, '合併扣課'],
      rows: [
        [...rowA('課程完成', '2026-09-08', '10:30 - 11:00', 'IN 30'), '是'],
        [...rowA('課程完成', '2026-09-08', '11:00 - 11:30', 'SIS 30'), '是'],
      ],
    };
    const c = ctx({}, { entitlementsBy: { 'c-a': [{ ...POOL, durationMin: 60 }] } });
    const [item] = readAbovee([photo], c).items;
    assert.equal(item.checked, true);
    const [g] = planOf([item], c).groups;
    assert.equal(g.visit.slots[0].status, 'done');
    assert.equal(remainingAfter(POOL, [g.visit]), 11, '一對扣一次');
  });
});

describe('送的／體驗、n返 照片寫完成：已完成、不扣任何一筆額度', () => {
  test('Abovee 寫體驗的 SIS（過去完成）', () => {
    const photo = { readable: true, columns: [...COLS, '預約來源'], rows: [[...rowA('課程完成', '2026-09-08'), '體驗']] };
    const [item] = readAbovee([photo], ctx()).items;
    assert.equal(item.giftCourseId, 'course-recovery');
    assert.equal(item.checked, true);
    const [g] = planOf([item]).groups;
    assert.deepEqual(g.visit.slots.map((s) => [s.status, s.entitlementId, s.giftKind]), [['done', null, 'trial']]);
    assert.equal(remainingAfter(POOL, [g.visit]), 12);
  });

  test('三返（過去完成），接一次做完的健檢', () => {
    const examDone = { id: 'v-exam', customerId: 'c-wang', date: '2026-09-01', status: 'done',
      slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'done', attended: true }] };
    const c = ctx({ 'c-wang': [examDone] });
    const [item] = read([rowW('課程完成', '2026-09-05', '14:00 - 14:30', '三返')], c);
    assert.equal(item.isNth, true);
    const [g] = planOf([{ ...item, checked: true, followupForVisitId: 'v-exam' }], c).groups;
    assert.deepEqual(g.visit.slots.map((s) => [s.status, s.entitlementId, s.followupNth]), [['done', null, 3]]);
    assert.equal(remainingAfter(FU, [examDone, g.visit]), 2);
    assert.equal(remainingAfter(EXAM, [examDone, g.visit]), 1);
  });
});

describe('讀不到這位的全部來訪', () => {
  test('照舊一列都不預設勾（過去的完成也一樣）', () => {
    const items = read([rowA('課程完成', '2026-09-08'), rowA('確認前往', '2026-09-10', '10:00 - 11:00')], ctx({}, { partial: ['c-a'] }));
    assert.deepEqual(items.map((i) => i.checked), [false, false]);
  });
});

describe('其他入口的新段照舊是待確認（一個字都不變）', () => {
  const ENTS_X = [{ id: 'e-ilib', type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 20 }];
  const sctx = { courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts, entitlements: ENTS_X, visits: [] };
  const base = { entitlementId: 'e-ilib', startsAt: '10:00', roomId: 'room-t2' };

  test('slotFromPicks() 沒給狀態 → INITIAL_STATUS、attended null、沒有取消理由那一格', () => {
    const { slot } = slotFromPicks(base, sctx);
    assert.equal(slot.status, INITIAL_STATUS);
    assert.equal(slot.attended, null);
    assert.equal('cancelReason' in slot, false);
  });

  test('slotFromPicks() 只收那四種，已確認與亂寫的當成沒給', () => {
    for (const status of ['confirmed', 'whatever', null]) {
      assert.equal(slotFromPicks({ ...base, status }, sctx).slot.status, INITIAL_STATUS, String(status));
    }
    assert.deepEqual(['done', 'no_show', 'cancelled'].map((status) => slotFromPicks({ ...base, status }, sctx).slot.attended), [true, false, null]);
  });

  test('visitWithSlot()：新的一筆待確認的，跟以前一模一樣', () => {
    const { slot } = slotFromPicks(base, sctx);
    const { visit } = visitWithSlot({ customerId: 'c1', customerName: '王小明' }, '2026-09-20', slot, []);
    assert.deepEqual(visit, {
      customerId: 'c1', customerName: '王小明', date: '2026-09-20', status: INITIAL_STATUS,
      confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null, note: null, slots: [slot],
    });
  });

  test('withExtraSlot()：已確認的那一天接一段待確認的照舊退回待確認', () => {
    const confirmed = { id: 'v', status: 'confirmed', confirmedAt: 'x', slots: [{ status: 'confirmed' }] };
    const { visit, reopened } = withExtraSlot(confirmed, { status: INITIAL_STATUS });
    assert.equal(reopened, true);
    assert.equal(visit.status, INITIAL_STATUS);
    assert.equal(visit.confirmedAt, null);
  });

  test('rebookSlot()：新的那一段照舊待確認、整筆照推導', () => {
    const before = { id: 'v', status: 'confirmed', slots: [{ courseId: 'c', startsAt: '09:00', status: 'confirmed' }] };
    const after = rebookSlot(before, 0, { courseId: 'c', startsAt: '10:00' });
    assert.deepEqual(after.slots.map((s) => s.status), ['cancelled', INITIAL_STATUS]);
    assert.equal(after.status, visitStatusFrom(after));
  });
});
