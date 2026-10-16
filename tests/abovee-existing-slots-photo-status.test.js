// 拍 Abovee：app 裡已經有的那一段，照照片上的預約狀態改（abovee-status-follows-photo-2026-10-15/04）。
//
// 她 10/15：「如果是本來app上還沒取消的客拍照拍到已取消了，那也幫我把這堂課的狀態改成已取消，你懂嗎，就是連狀態也要考慮進去」
// 第 3 題：「預設打勾＋確認框講清楚 … 打勾就只是改狀態那些等等，不要多記或少記次數! 次數不能弄錯這很重要 ! !」
//
// **每一條次數判準都拿 `counts()` 算改之前與改之後**（`countDeltas()`），不看畫面上的字。
// 推翻 ADR-0116 的「只講不改」（狀態那一部分）。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  applyPhotoStatus, changeLines, countDeltas, mismatchSay, needsAttention, photoRowSays, planAbovee, readAbovee,
  photoDayPlan, recordedSay, resolveItem,
} from '../public/js/domain/aboveeImport.js';
import { slotCancelReasonOf, visitStatusFrom } from '../public/js/domain/visits.js';
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
const sis = (over = {}) => ({ entitlementId: 'a-pool', courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis',
  startsAt: '09:00', endsAt: '10:00', status: 'confirmed', attended: null, ...over });
const dayA = (date, slots, over = {}) => ({ id: `v-a-${date}`, customerId: 'c-a', customerName: '客戶A', date,
  status: visitStatusFrom({ status: 'pending_confirm', slots }), slots, ...over });
const rowA = (status, date, time = '09:00 - 10:00', course = 'SIS 60') => [status, date, time, '客戶A', '00001111', course];
const rowW = (status, date, time, course) => [status, date, time, '王小明', '00001234', course];
const photo = (rows, columns = COLS) => ({ readable: true, columns, rows });
const read = (rows, c, columns) => readAbovee([photo(rows, columns)], c).items;

/** 照照片改完之後（帶閘門，跟寫入同一支），這一位的全部來訪 */
function applied(items, visits, customerId = 'c-a') {
  const guard = { entitlements: ENTS[customerId], visits };
  return visits.map((v) => applyPhotoStatus(v, items, { guard, at: '2026-09-09T10:00:00Z' }).visit);
}

describe('app 已確認、照片已取消', () => {
  const visit = dayA('2026-09-12', [sis()]);
  const c = ctx({ 'c-a': [visit] });
  const cols = [...COLS, '取消原因'];
  const [item] = read([[...rowA('已取消', '2026-09-12'), '客人有事']], c, cols);

  test('那一列是「已經記了」＋要改成已取消、預設打勾、記著她看到的那一段', () => {
    assert.equal(item.kind, 'recorded');
    assert.deepEqual(item.statusChange, { from: 'confirmed', to: 'cancelled' });
    assert.equal(item.adoptStatus, true);
    assert.equal(item.checked, false, '不是新的一段 —— 不會被 planAbovee() 記成一段新的');
    assert.deepEqual(item.existing, { visitId: visit.id, date: '2026-09-12', slotIndex: 0, startsAt: '09:00', courseId: 'course-recovery', status: 'confirmed' });
    assert.equal(needsAttention(item), false, '要改的不是要你看');
    assert.match(recordedSay(item), /改成「已取消」/);
    assert.deepEqual(planAbovee([item], c).groups, []);
  });

  test('套上去：那一段已取消、取消理由是照片上那一格、那一天只有它所以整筆也是；放掉的是第 0 段', () => {
    const { visit: after, missed, freed } = applyPhotoStatus(visit, [item], { at: '2026-09-09T10:00:00Z' });
    assert.deepEqual(missed, []);
    assert.deepEqual(freed, [0]);
    assert.equal(after.slots[0].status, 'cancelled');
    assert.equal(slotCancelReasonOf(after, after.slots[0]), '客人有事');
    assert.equal(after.status, 'cancelled');
    assert.equal(after.cancelReason, '客人有事');
  });

  test('counts()：還 1 次', () => {
    const after = applied([item], [visit]);
    assert.deepEqual(countDeltas([POOL], [visit], after), [{ entitlementId: 'a-pool', remaining: 1, done: 0, booked: -1, noShow: 0 }]);
    // 確認框與「要改的」那一塊讀的那一份計畫（`photoDayPlan()`）講的是同一個數
    assert.deepEqual(photoDayPlan([item], c).deltas['c-a'], countDeltas([POOL], [visit], after));
  });
});

describe('一天兩段、照片只取消其中一段', () => {
  const visit = dayA('2026-09-12', [sis(), sis({ startsAt: '14:00', endsAt: '15:00', equipmentId: 'eq-indiba' })], { status: 'confirmed' });
  const c = ctx({ 'c-a': [visit] });

  test('那一段已取消、理由在那一段上；另一段不動；整筆照推導、整筆的理由不寫', () => {
    const items = read([[...rowA('已取消', '2026-09-12'), '改期'], [...rowA('確認前往', '2026-09-12', '14:00 - 15:00', 'INDIBA 60'), '']], c, [...COLS, '取消原因']);
    assert.deepEqual(items.map((i) => [i.kind, i.statusChange?.to ?? null]), [['recorded', 'cancelled'], ['recorded', null]]);
    const [after] = applied(items, [visit]);
    assert.deepEqual(after.slots.map((s) => s.status), ['cancelled', 'confirmed']);
    assert.equal(after.slots[0].cancelReason, '改期');
    assert.equal(after.status, 'confirmed');
    assert.equal(after.status, visitStatusFrom(after));
    assert.equal(after.cancelReason ?? null, null);
    assert.equal(countDeltas([POOL], [visit], [after])[0].remaining, 1);
  });
});

describe('同一頁拍了兩張、同一列一張寫課程完成一張寫確認前往', () => {
  const visit = dayA('2026-09-08', [sis()]);
  const c = ctx({ 'c-a': [visit] });
  const done = photo([rowA('課程完成', '2026-09-08')]);
  const going = photo([rowA('確認前往', '2026-09-08')]);

  for (const [label, photos] of [['先傳完成那一張', [done, going]], ['先傳確認前往那一張', [going, done]]]) {
    test(`${label}：不改、講一句（兩種順序一樣）`, () => {
      const items = readAbovee(photos, c).items;
      assert.equal(items.length, 1);
      const [item] = items;
      assert.deepEqual([item.kind, item.reason, item.statusChange ?? null], ['mismatch', 'photosDiffer', null]);
      assert.match(mismatchSay(item), /兩張照片上這一段的預約狀態不一樣/);
      assert.deepEqual(applied(items, [visit]), [visit]);
    });

    test(`${label}、app 裡沒有：新的一列記成待確認、不預設勾、講一句`, () => {
      const items = readAbovee(photos, ctx()).items;
      const [item] = items;
      assert.equal(item.kind, 'new');
      assert.equal(item.checked, false);
      assert.match(photoRowSays(item)[0], /兩張照片上這一段的預約狀態不一樣/);
      assert.equal(needsAttention(item), true);
      const [g] = planAbovee([{ ...item, checked: true }], ctx()).groups;
      assert.equal(g.visit.slots[0].status, 'pending_confirm');
    });
  }
});

describe('照片寫課程完成', () => {
  test('app 待確認（過去）：改成已完成、次數不變', () => {
    const visit = dayA('2026-09-08', [sis({ status: 'pending_confirm' })]);
    const items = read([rowA('課程完成', '2026-09-08')], ctx({ 'c-a': [visit] }));
    assert.deepEqual(items[0].statusChange, { from: 'pending_confirm', to: 'done' });
    const [after] = applied(items, [visit]);
    assert.deepEqual(after.slots.map((s) => [s.status, s.attended]), [['done', true]]);
    assert.equal(after.status, 'done');
    assert.deepEqual(countDeltas([POOL], [visit], [after]), [{ entitlementId: 'a-pool', remaining: 0, done: 1, booked: -1, noShow: 0 }]);
  });

  test('app 未到：改成已完成（退回簽療程單再結）、扣 1 次', () => {
    const visit = dayA('2026-09-08', [sis({ status: 'no_show', attended: false })]);
    const c = ctx({ 'c-a': [visit] });
    const items = read([rowA('課程完成', '2026-09-08')], c);
    assert.deepEqual(items[0].statusChange, { from: 'no_show', to: 'done' });
    const [after] = applied(items, [visit]);
    assert.deepEqual(after.slots.map((s) => [s.status, s.attended]), [['done', true]]);
    assert.equal(after.status, 'done');
    assert.deepEqual(countDeltas([POOL], [visit], [after]), [{ entitlementId: 'a-pool', remaining: -1, done: 1, booked: 0, noShow: -1 }]);
  });

  test('未來、app 已確認：不改、「還沒到就寫完成了」', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const [item] = read([rowA('課程完成', '2026-09-12')], ctx({ 'c-a': [visit] }));
    assert.deepEqual([item.kind, item.reason], ['mismatch', 'futureDone']);
    assert.match(mismatchSay(item), /還沒到就寫完成了/);
  });

  test('app 已完成：不動，已經記了', () => {
    const visit = dayA('2026-09-08', [sis({ status: 'done', attended: true })]);
    const [item] = read([rowA('課程完成', '2026-09-08')], ctx({ 'c-a': [visit] }));
    assert.deepEqual([item.kind, item.statusChange ?? null], ['recorded', null]);
  });
});

describe('二返照片寫課程完成', () => {
  const exam = (status, over = {}) => ({ id: 'v-exam', customerId: 'c-wang', date: '2026-09-01', status,
    slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status, attended: status === 'done' ? true : null }], ...over });
  const second = (status, over = {}) => ({ id: 'v-fu', customerId: 'c-wang', date: '2026-09-05', status,
    slots: [{ entitlementId: 'w-fu', courseId: 'course-followup', followupForVisitId: 'v-exam', startsAt: '14:00', endsAt: '14:30', status,
      attended: status === 'no_show' ? false : null }], ...over });
  const FU_ROW = rowW('課程完成', '2026-09-05', '14:00 - 14:30', '二返');

  test('接的健檢做完了、app 待確認：改成已完成，存的時候長一張「寫紀錄」', () => {
    const visits = [exam('done'), second('pending_confirm')];
    const items = read([FU_ROW], ctx({ 'c-wang': visits }));
    assert.deepEqual(items[0].statusChange, { from: 'pending_confirm', to: 'done' });
    const after = applied(items, visits, 'c-wang');
    assert.equal(after[1].slots[0].status, 'done');
    const { create } = syncTasksForVisit(after[1], [], { coursesById, today: TODAY });
    assert.ok(create.some((t) => t.kind === RECORD_TASK_KIND));
  });

  test('app 未到、接的健檢還沒做完：讀照片那一下就不改（只提醒，那一句是 closeBlockSay() 的）', () => {
    const visits = [exam('confirmed'), second('no_show')];
    const [item] = read([FU_ROW], ctx({ 'c-wang': visits }));
    assert.deepEqual([item.kind, item.reason, item.statusChange ?? null], ['mismatch', 'closeBlocked', null]);
    assert.ok(mismatchSay(item).startsWith(closeBlockSay(item.closeBlock)));
    assert.equal(needsAttention(item), true);
  });

  test('寫的時候才擋到（她在別的地方動了健檢）：一格都不動、進 missed —— 不停在半路的已確認', () => {
    const visits = [exam('confirmed'), second('no_show')];
    const forced = { key: 'x', customerId: 'c-wang', statusChange: { from: 'no_show', to: 'done' }, adoptStatus: true,
      existing: { visitId: 'v-fu', date: '2026-09-05', slotIndex: 0, startsAt: '14:00', courseId: 'course-followup', status: 'no_show' } };
    const { visit, missed } = applyPhotoStatus(visits[1], [forced], { guard: { entitlements: ENTS['c-wang'], visits } });
    assert.equal(visit, visits[1], '一格都不動');
    assert.deepEqual(missed.map((m) => [m.missedWhy, m.closeBlock?.examVisitId]), [['closeBlocked', 'v-exam']]);
    assert.deepEqual(countDeltas(ENTS['c-wang'], visits, [visits[0], visit]), []);
  });

  test('同一天健檢（已確認）與二返（已確認，接這一次）照片都寫完成：兩段都改成已完成', () => {
    const day = { id: 'v-day', customerId: 'c-wang', date: '2026-09-08', status: 'confirmed', slots: [
      { entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'confirmed', attended: null },
      { entitlementId: 'w-fu', courseId: 'course-followup', followupForVisitId: 'v-day', startsAt: '14:00', endsAt: '14:30', status: 'confirmed', attended: null },
    ] };
    const items = read([rowW('課程完成', '2026-09-08', '09:00 - 11:00', '健檢'), rowW('課程完成', '2026-09-08', '14:00 - 14:30', '二返')],
      ctx({ 'c-wang': [day] }));
    assert.deepEqual(items.map((i) => i.statusChange?.to ?? i.reason), ['done', 'done']);
    const [after] = applied(items, [day], 'c-wang');
    assert.deepEqual(after.slots.map((s) => s.status), ['done', 'done']);
    assert.equal(after.status, 'done');
  });

  test('跨天：健檢（9/1）與二返（9/5）照片都寫完成 —— 讀照片那一下看「記完之後」不擋；寫的時候閘門要拿改完健檢的那一份', () => {
    const visits = [exam('confirmed'), second('confirmed')];
    const items = read([rowW('課程完成', '2026-09-01', '09:00 - 11:00', '健檢'), FU_ROW], ctx({ 'c-wang': visits }));
    assert.deepEqual(items.map((i) => i.statusChange?.to ?? i.reason), ['done', 'done']);
    const guard = (list) => ({ entitlements: ENTS['c-wang'], visits: list });
    // 拿改之前的那一份當閘門：二返被擋（06 要先套健檢那一天，再拿套好的那一份）
    assert.equal(applyPhotoStatus(visits[1], items, { guard: guard(visits) }).missed[0]?.missedWhy, 'closeBlocked');
    const examAfter = applyPhotoStatus(visits[0], items, { guard: guard(visits) }).visit;
    const fuAfter = applyPhotoStatus(visits[1], items, { guard: guard([examAfter, visits[1]]) });
    assert.deepEqual(fuAfter.missed, []);
    assert.equal(fuAfter.visit.slots[0].status, 'done');
  });
});

describe('照片寫客戶失約', () => {
  test('app 已確認（過去）：改成未到、還 1 次', () => {
    const visit = dayA('2026-09-08', [sis()]);
    const items = read([rowA('客戶失約', '2026-09-08')], ctx({ 'c-a': [visit] }));
    assert.deepEqual(items[0].statusChange, { from: 'confirmed', to: 'no_show' });
    const [after] = applied(items, [visit]);
    assert.deepEqual(after.slots.map((s) => [s.status, s.attended]), [['no_show', false]]);
    assert.equal(after.status, 'no_show');
    assert.deepEqual(countDeltas([POOL], [visit], [after]), [{ entitlementId: 'a-pool', remaining: 1, done: 0, booked: -1, noShow: 1 }]);
  });

  test('未來：不改、「還沒到就寫失約了」', () => {
    const [item] = read([rowA('客戶失約', '2026-09-12')], ctx({ 'c-a': [dayA('2026-09-12', [sis()])] }));
    assert.deepEqual([item.kind, item.reason], ['mismatch', 'futureNoShow']);
  });
});

describe('只提醒、不改的那幾格', () => {
  const cases = [
    ['app 已完成、照片已取消', 'done', '已取消', 'appDoneStays', /已完成的改不回來/],
    ['app 已完成、照片失約', 'done', '客戶失約', 'appDoneStays', /已完成的改不回來/],
    ['app 已完成、照片確認前往', 'done', '確認前往', 'aboveeNotDone', /Abovee 上還沒改成課程完成/],
    ['app 未到、照片已取消', 'no_show', '已取消', 'noShowStays', /未到取消不掉/],
    ['app 未到、照片確認前往', 'no_show', '確認前往', 'aboveeNotNoShow', /Abovee 上還沒改成客戶失約/],
  ];
  for (const [label, app, text, reason, say] of cases) {
    test(label, () => {
      const visit = dayA('2026-09-08', [sis({ status: app, attended: app === 'done' ? true : app === 'no_show' ? false : null })]);
      const [item] = read([rowA(text, '2026-09-08')], ctx({ 'c-a': [visit] }));
      assert.deepEqual([item.kind, item.reason, item.statusChange ?? null], ['mismatch', reason, null]);
      assert.match(mismatchSay(item), say);
      assert.equal(needsAttention(item), true);
      assert.deepEqual(applied([item], [visit]), [visit]);
    });
  }

  test('app 已確認、照片待確認：今天與未來不動不提醒（不退回待確認）；過去的提醒「兩邊都還沒結案」', () => {
    for (const [date, kind] of [[TODAY, 'recorded'], ['2026-09-12', 'recorded'], ['2026-09-08', 'mismatch']]) {
      const visit = dayA(date, [sis()]);
      const [item] = read([rowA('待確認', date)], ctx({ 'c-a': [visit] }));
      assert.equal(item.kind, kind, date);
      assert.equal(item.statusChange ?? null, null, date);
      if (kind === 'mismatch') assert.match(mismatchSay(item), /兩邊都還沒結案/);
    }
  });

  test('那一張沒拍到「預約狀態」那一欄：一律不比（過去的、未來的都是已經記了）', () => {
    for (const [date, app] of [['2026-09-08', 'confirmed'], ['2026-09-08', 'done'], ['2026-09-12', 'confirmed']]) {
      const visit = dayA(date, [sis({ status: app })]);
      const [item] = read([rowA('課程完成', date).slice(1)], ctx({ 'c-a': [visit] }), COLS.slice(1));
      assert.deepEqual([item.kind, item.statusChange ?? null, item.reason ?? null], ['recorded', null, null], `${date} ${app}`);
    }
  });

  test('讀不出來：不比', () => {
    const visit = dayA('2026-09-08', [sis()]);
    const [item] = read([rowA('確認前往X', '2026-09-08')], ctx({ 'c-a': [visit] }));
    assert.deepEqual([item.kind, item.statusChange ?? null], ['recorded', null]);
  });
});

describe('合併扣課（照片兩列、app 一段）', () => {
  const merged = (a, b) => photo([[...rowA(a, '2026-09-08', '10:30 - 11:00', 'IN 30'), '是'], [...rowA(b, '2026-09-08', '11:00 - 11:30', 'SIS 30'), '是']],
    [...COLS, '合併扣課']);
  const visit = dayA('2026-09-08', [sis({ equipmentId: 'eq-indiba', startsAt: '10:30', endsAt: '11:30' })]);
  const c = ctx({ 'c-a': [visit] });

  test('兩列都寫已取消：那一段改成已取消、後一半照舊被認領（不變成新的一段）', () => {
    const items = readAbovee([merged('已取消', '已取消')], c).items;
    assert.deepEqual(items.map((i) => [i.kind, i.statusChange?.to ?? null, Boolean(i.halfOf)]),
      [['recorded', 'cancelled', false], ['recorded', null, true]]);
    assert.deepEqual(planAbovee(items.map((i) => ({ ...i, checked: true })), c).groups, [], '一段新的都不記');
    const [after] = applied(items, [visit]);
    assert.equal(after.slots[0].status, 'cancelled');
    assert.equal(countDeltas([POOL], [visit], [after])[0].remaining, 1, '還一次，不是兩次');
  });

  test('兩列都寫課程完成：改成已完成、後一半被認領、次數不變', () => {
    const items = readAbovee([merged('課程完成', '課程完成')], c).items;
    assert.deepEqual(items.map((i) => [i.kind, i.statusChange?.to ?? null]), [['recorded', 'done'], ['recorded', null]]);
    const [after] = applied(items, [visit]);
    assert.equal(countDeltas([POOL], [visit], [after])[0].remaining, 0);
  });

  test('兩列一個取消一個完成：只提醒、後一半照舊被認領', () => {
    const items = readAbovee([merged('已取消', '課程完成')], c).items;
    assert.deepEqual(items.map((i) => [i.kind, i.reason ?? null, Boolean(i.halfOf)]),
      [['mismatch', 'halvesDiffer', false], ['recorded', null, true]]);
    assert.match(mismatchSay(items[0]), /合併扣課兩列的預約狀態不一樣（「已取消」＋「課程完成」）/);
    assert.deepEqual(applied(items, [visit]), [visit]);
  });
});

describe('照片上同一格「已取消＋重約（確認前往）」', () => {
  test('app 上那一格活著：不取消（豁免照舊），已取消那一列照新的、不勾', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const c = ctx({ 'c-a': [visit] });
    const items = read([rowA('已取消', '2026-09-12'), rowA('確認前往', '2026-09-12')], c);
    assert.deepEqual(items.map((i) => [i.kind, i.cancelled, i.checked, i.statusChange ?? null]),
      [['new', true, false, null], ['recorded', false, false, null]]);
    assert.deepEqual(applied(items, [visit]), [visit]);
  });
});

describe('沒有開始時間的舊段', () => {
  const imported = (status) => ({ id: 'v-old', customerId: 'c-a', date: '2026-08-20', status, importedFrom: { source: 'merge-file' },
    slots: [{ entitlementId: 'a-pool', courseId: 'course-recovery', equipmentId: null, startsAt: null, endsAt: null, status }] });

  test('照片寫已取消（app 已確認）：只提醒、不改', () => {
    const visit = imported('confirmed');
    const [item] = read([rowA('已取消', '2026-08-20')], ctx({ 'c-a': [visit] }));
    assert.deepEqual([item.kind, item.reason, item.timeless, item.statusChange ?? null], ['mismatch', 'timeless', true, null]);
    assert.match(mismatchSay(item), /沒有時間/);
    assert.deepEqual(applied([item], [visit]), [visit]);
  });

  test('照片寫課程完成（app 已確認）：只提醒、不改', () => {
    const visit = imported('confirmed');
    const [item] = read([rowA('課程完成', '2026-08-20')], ctx({ 'c-a': [visit] }));
    assert.deepEqual([item.kind, item.reason, item.statusChange ?? null], ['mismatch', 'timeless', null]);
  });

  test('已取消的那一列不搶已經做完的舊段（同一天另一列課程完成先認）', () => {
    const visit = imported('done');
    const items = read([rowA('已取消', '2026-08-20'), rowA('課程完成', '2026-08-20', '14:00 - 15:00')], ctx({ 'c-a': [visit] }));
    assert.deepEqual(items.map((i) => [i.kind, i.cancelled, i.reason ?? null]), [['new', true, null], ['recorded', false, null]]);
  });
});

describe('寫之前比對她看到的值', () => {
  test('她在確認層看到「已確認」，存之前那一段在日曆上被取消了：不改、進 missed', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const [item] = read([rowA('已取消', '2026-09-12')], ctx({ 'c-a': [visit] }));
    const moved = { ...visit, status: 'cancelled', slots: [{ ...visit.slots[0], status: 'cancelled' }] };
    const { visit: after, missed } = applyPhotoStatus(moved, [item]);
    assert.equal(after, moved);
    assert.deepEqual(missed.map((m) => m.missedWhy), ['stale']);
  });

  test('她拿掉了那一列的勾：不改', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const [item] = read([rowA('已取消', '2026-09-12')], ctx({ 'c-a': [visit] }));
    assert.equal(applyPhotoStatus(visit, [{ ...item, adoptStatus: false }]).visit, visit);
  });
});

describe('既有的那一段、照片上的預約狀態讀不出來（10/16 審查）', () => {
  test('不比、不改，那一列講讀不出來（spec 01：讀不出來的那一列要講）', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const [item] = read([rowA('確認前往X', '2026-09-12')], ctx({ 'c-a': [visit] }));
    assert.deepEqual([item.kind, item.statusChange ?? null, item.statusUnread], ['recorded', null, true]);
    assert.match(recordedSay(item), /讀不出預約狀態（照片上是「確認前往X」） —— 狀態沒有拿來比/);
  });
});

describe('換一位、讀不到全部來訪、拍兩次', () => {
  test('她把一列換一位：那一列不再帶著上一位的「要改什麼」', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const c = ctx({ 'c-a': [visit] });
    const [item] = read([rowA('已取消', '2026-09-12')], c);
    assert.ok(item.statusChange);
    const other = resolveItem(item, 'c-wang', c);
    assert.equal(other.statusChange, null);
    assert.equal(other.adoptStatus, false);
  });

  test('照片上的人認不出來、她自己選了那一位：照樣列出要改什麼，但不預設打勾（10/16 審查：新的列本來就是這樣）', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const c = ctx({ 'c-a': [visit] });
    const [unknown] = read([['已取消', '2026-09-12', '09:00 - 10:00', '陳大文', '', 'SIS 60']], c);
    assert.equal(unknown.kind, 'unknown');
    const picked = resolveItem(unknown, 'c-a', c);
    assert.deepEqual([picked.kind, picked.statusChange?.to, picked.adoptStatus], ['recorded', 'cancelled', false]);
    const { lines } = changeLines([picked], photoDayPlan([picked], c), c);
    assert.match(lines[0].text, /（不改 —— 人是你選的/);
    // 她勾了才改：還 1 次
    const on = { ...picked, adoptStatus: true };
    assert.deepEqual(photoDayPlan([on], c).rows.map((r) => [r.kind, r.charge]), [['status', -1]]);
  });

  test('讀不到這位的全部來訪：照樣列出要改什麼，但不預設打勾', () => {
    const visit = dayA('2026-09-12', [sis()]);
    const [item] = read([rowA('已取消', '2026-09-12')], ctx({ 'c-a': [visit] }, { partial: ['c-a'] }));
    assert.deepEqual([item.statusChange?.to, item.adoptStatus, item.partialHistory], ['cancelled', false, true]);
  });

  test('同一張照片拍兩次：第二次全部是「已經記了」，一段都不再改', () => {
    const visits = [dayA('2026-09-08', [sis()]), dayA('2026-09-12', [sis()]), dayA('2026-09-07', [sis({ status: 'pending_confirm' })])];
    const rows = [rowA('客戶失約', '2026-09-08'), rowA('已取消', '2026-09-12'), rowA('課程完成', '2026-09-07')];
    const first = read(rows, ctx({ 'c-a': visits }));
    assert.deepEqual(first.map((i) => i.statusChange?.to), ['no_show', 'cancelled', 'done']);
    const after = applied(first, visits);
    const again = read(rows, ctx({ 'c-a': after }));
    assert.deepEqual(again.map((i) => [i.kind, i.statusChange ?? null]), [['recorded', null], ['recorded', null], ['recorded', null]]);
    assert.deepEqual(applied(again, after), after);
  });
});
