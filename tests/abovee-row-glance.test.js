// 拍 Abovee 每一列收著時那一行：課程＋治療師／醫師／診間（abovee-confirm-glance 02）。
//
// 她 11/3：「我拍完照辨識完後，能不能也看到診間和醫師 不要我每個都要點開 像日曆那邊一樣」；
// 「我辨識三返，有辨識到醫生嗎？」—— 讀照片時認到了，只是還沒按任何一顆之前哪裡都沒畫。
//
// 盯四件事：
//   1. 印的是按「記錄」之後的那一段：已經記了的列，「要改的」那一格勾了印 Abovee 的、沒勾印 app 的
//   2. 已經記了的列課程印日曆上的名字（不是照片原字 `ILIB 60`）
//   3. 只印那門課用得到的那幾格（治療師或診間、醫師），沒有的印「還沒有」
//   4. 照片上三返、還沒按任何一顆：照樣印得出醫師
// 例子一律假名（人員是種子上的、或「某」開頭）。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { photoDayPlan, readAbovee, rowGlance } from '../public/js/domain/aboveeImport.js';
import { slotName } from '../public/js/domain/naming.js';
import { SEED } from '../public/js/domain/seed.js';

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間', '服務資源'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
const ILIB = { id: 'w-ilib', type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 10 };
const STAFF = [...SEED.staff, { id: 's-fang', name: '某小芳', shortName: '小芳', role: '物理治療師' }];
const sis = (over = {}) => ({
  entitlementId: 'w-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '11:00',
  therapistId: 'staff-tw', roomId: null, bed: null, status: 'confirmed', ...over,
});
const ilib = (over = {}) => ({
  entitlementId: 'w-ilib', courseId: 'course-iv-laser', startsAt: '14:00', endsAt: '15:00',
  therapistId: null, roomId: 'room-iv2', bed: null, status: 'pending_confirm', ...over,
});
const visitOf = (slots) => ({ id: 'v1', customerId: 'c-wang', date: '2026-09-10', status: 'confirmed', slots, updatedAt: 't1' });
const ctx = (slots = [], ents = [POOL, ILIB]) => ({
  customers: [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }],
  entitlementsBy: { 'c-wang': ents },
  visitsBy: { 'c-wang': slots.length ? [visitOf(slots)] : [] },
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: STAFF, ivProducts: SEED.ivProducts },
  today: '2026-09-01',
});
const r = (time, course, room, resource, who = '王小明') => ['確認前往', '2026-09-10', time, who, '00001234', course, room, resource];
const read = (rows, c) => readAbovee([{ columns: COLS, rows }], c).items;
const cellsOf = (g) => Object.fromEntries(g.cells.map((x) => [x.field, x.name]));

describe('已經記了：印存完之後那一段', () => {
  test('治療師 app 是騰崴、照片是小芳：「要改的」那一格勾著印小芳、拿掉印騰崴', () => {
    const c = ctx([sis()]);
    const [item] = read([r('10:00 - 11:00', 'SIS 60', '', '陳小芳')], c);
    assert.equal(item.kind, 'recorded');
    assert.equal(item.adopt, true);
    assert.deepEqual(cellsOf(rowGlance(item, photoDayPlan([item], c), c)), { therapistId: '小芳' });
    const off = { ...item, adopt: false };
    assert.deepEqual(cellsOf(rowGlance(off, photoDayPlan([off], c), c)), { therapistId: '騰崴' });
  });

  test('課程印日曆上的名字，不是照片原字', () => {
    const c = ctx([ilib()]);
    const [item] = read([r('14:00 - 15:00', 'ILIB 60', '點滴室2', '')], c);
    assert.equal(item.kind, 'recorded');
    const g = rowGlance(item, photoDayPlan([item], c), c);
    assert.equal(g.what, slotName(c.visitsBy['c-wang'][0].slots[0], c.master, 'short'));
    assert.notEqual(g.what, 'ILIB 60');
  });

  test('沒有計畫（已經記好、或這一列沒要改）→ app 上那一段', () => {
    const c = ctx([sis()]);
    const [item] = read([r('10:00 - 11:00', 'SIS 60', '', '騰崴')], c);
    assert.deepEqual(cellsOf(rowGlance(item, null, c)), { therapistId: '騰崴' });
  });

  test('existing 沒有位置（合併扣課的後一半）→ 前一半那一段；找不到就照片上的', () => {
    const c = ctx([sis({ endsAt: '11:00' })]);
    const half = { key: 'h', kind: 'recorded', customerId: 'c-wang', row: { course: 'SIS 30' }, course: { courseId: 'course-recovery' },
      startsAt: '10:30', halfOf: '10:00', existing: { visitId: 'v1', date: '2026-09-10' }, therapistId: null };
    assert.deepEqual(cellsOf(rowGlance(half, null, c)), { therapistId: '騰崴' });
    const lost = { ...half, halfOf: '09:00' };
    assert.deepEqual(cellsOf(rowGlance(lost, null, c)), { therapistId: null }, '找不到 → 照片上的（照片上沒認到人）');
  });

  test('沒有時間的舊段：那一天同一門課、沒有時間的剛好一段', () => {
    const c = ctx([sis({ startsAt: null, endsAt: null, therapistId: 'staff-zn' })]);
    const old = { key: 't', kind: 'recorded', customerId: 'c-wang', row: { course: 'SIS 60' }, course: { courseId: 'course-recovery' },
      startsAt: '10:00', timeless: true, existing: { visitId: 'v1', date: '2026-09-10' } };
    assert.deepEqual(cellsOf(rowGlance(old, null, c)), { therapistId: '芝寧' });
  });
});

describe('對不上：印 app 上存完之後那一段（她 11/3 選的，審查 R2）', () => {
  test('日子過了兩邊都待確認、治療師不一樣：勾著印照片上的人、拿掉印 app 上的人；課程名一樣', () => {
    const c = { ...ctx([sis({ status: 'pending_confirm' })]), today: '2026-09-20' };
    const [item] = read([['待確認', '2026-09-10', '10:00 - 11:00', '王小明', '00001234', 'SIS 60', '', '陳小芳']], c);
    assert.equal(item.kind, 'mismatch');
    assert.equal(item.adopt, true);
    const on = rowGlance(item, photoDayPlan([item], c), c);
    const offItem = { ...item, adopt: false };
    const off = rowGlance(offItem, photoDayPlan([offItem], c), c);
    assert.deepEqual(cellsOf(on), { therapistId: '小芳' });
    assert.deepEqual(cellsOf(off), { therapistId: '騰崴' });
    assert.equal(on.what, off.what);
    assert.equal(off.what, slotName(c.visitsBy['c-wang'][0].slots[0], c.master, 'short'));
  });
});

describe('新的與照片上的', () => {
  test('照片上三返、服務資源寫醫師、一顆都還沒按 → 印得出那位醫師', () => {
    const c = ctx([], [POOL]);
    const [item] = read([r('09:00 - 09:30', '三返', '', '夏醫師')], c);
    assert.equal(item.kind, 'new');
    assert.equal(item.doctorId, 'staff-dr-xia');
    const g = rowGlance(item, photoDayPlan([item], c), c);
    assert.equal(g.what, '三返');
    assert.equal(cellsOf(g).doctorId, '夏');
  });

  test('組得出時段：讀那一段上的人與診間（存進去的那一份）', () => {
    const c = ctx();
    const [item] = read([r('14:00 - 15:00', 'ILIB 60', '點滴室10', '')], c);
    assert.equal(item.kind, 'new');
    const g = rowGlance(item, photoDayPlan([item], c), c);
    assert.deepEqual(cellsOf(g), { roomId: '.10' }, '診間印簡寫，ILIB 不印治療師');
  });

  test('治療師的課不印診間；沒認到的那一格是 null（畫面印「治療師？」）', () => {
    const c = ctx();
    const [item] = read([r('10:00 - 11:00', 'SIS 60', '治8', '某個認不得的人')], c);
    const g = rowGlance(item, photoDayPlan([item], c), c);
    assert.deepEqual(g.cells.map((x) => [x.field, x.label, x.name]), [['therapistId', '治療師', null]]);
  });

  test('認不得人：照照片上的課程與人；認不出課程就只有原字', () => {
    const c = ctx();
    const [item] = read([r('10:00 - 11:00', 'SIS 60', '', '騰崴', '查無此人')], c);
    assert.equal(item.kind, 'unknown');
    assert.deepEqual(cellsOf(rowGlance(item, null, c)), { therapistId: '騰崴' });
    const odd = { ...item, course: null, row: { ...item.row, course: '看不懂的課' } };
    assert.deepEqual(rowGlance(odd, null, c), { what: '看不懂的課', cells: [] });
  });
});
