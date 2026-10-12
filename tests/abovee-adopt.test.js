// 已經記了的那一段：治療師或診間跟 Abovee 不一樣時，按一下改成 Abovee 的（abovee-and-master-2026-10-05/11，ADR-0123）。
//
// 她 10/5：「那一列寫出『app 是 A、Abovee 是 B』，旁邊一顆『改成 Abovee 的』，你按了才改。只改治療師和診間」
//
// **這一支有沒有任何一條路，讓她沒按就被改、或改到那兩格以外的東西？** —— 沒有：`adoptAbovee()` 只收她按著的那幾列，
// 只寫 `therapistId`／`roomId`（換診間時清 `bed`）。**別的裝置剛改過的那一段蓋不蓋得掉？** —— 不蓋，回在 `missed`。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { adoptAbovee, diffSay, needsAttention, readAbovee, resolveItem } from '../public/js/domain/aboveeImport.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '診間', '服務資源'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
const ILIB = { id: 'w-ilib', type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 10 };
const STAFF = [...SEED.staff, { id: 's-fang', name: '小芳', role: '物理治療師' }];
const sis = (over = {}) => ({
  entitlementId: 'w-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '11:00',
  therapistId: 'staff-tw', roomId: null, bed: null, note: '記一句', status: 'confirmed', ...over,
});
const ilib = (over = {}) => ({
  entitlementId: 'w-ilib', courseId: 'course-iv-laser', startsAt: '14:00', endsAt: '15:00',
  therapistId: null, roomId: 'room-iv2', bed: 'A', status: 'pending_confirm', ...over,
});
const visitOf = (slots, status = 'confirmed') => ({ id: 'v1', customerId: 'c-wang', date: '2026-09-10', status, slots, updatedAt: 't1' });
const ctx = (slots, status) => ({
  customers: [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }, { id: 'c-a', name: '客戶A', marks: [] }],
  entitlementsBy: { 'c-wang': [POOL, ILIB], 'c-a': [POOL] },
  visitsBy: { 'c-wang': [visitOf(slots, status)] },
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: STAFF, ivProducts: SEED.ivProducts },
  today: '2026-09-01',
});
const r = (time, course, room, resource) => ['確認前往', '2026-09-10', time, '王小明', '00001234', course, room, resource];
const read = (rows, c) => readAbovee([{ columns: COLS, rows }], c).items;

describe('寫出不一樣', () => {
  test('app 上 10:00 SIS 治療師騰崴、照片上寫小芳 → 已經記了、那一行、要你看、還沒按', () => {
    const c = ctx([sis()]);
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], c);
    assert.equal(item.kind, 'recorded');
    assert.deepEqual(item.diffs, [{ field: 'therapistId', app: 'staff-tw', abovee: 's-fang' }]);
    assert.equal(diffSay(item.diffs[0], c.master), '治療師：app 是 騰崴、Abovee 是 小芳');
    assert.deepEqual([item.adopt, item.locked, needsAttention(item)], [false, false, true]);
  });

  test('ILIB 那一段比診間、不比治療師；app 上還沒選的講「還沒選」', () => {
    const c = ctx([ilib({ roomId: null })]);
    const [item] = read([r('14:00 - 15:15', 'ILIB 60', '點滴室10', 'I1點10')], c);
    assert.deepEqual(item.diffs, [{ field: 'roomId', app: null, abovee: 'room-iv10' }]);
    assert.equal(diffSay(item.diffs[0], c.master), '診間：app 上還沒選、Abovee 是 點滴10');
  });

  test('照片上那一格認不出來 → 不比（那不是不一樣，是看不出來）', () => {
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '某個認不得的人')], ctx([sis()]));
    assert.equal(item.kind, 'recorded');
    assert.equal(item.diffs, null);
    assert.equal(needsAttention(item), false);
  });

  test('一樣的不講', () => {
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], ctx([sis({ therapistId: 's-fang' })]));
    assert.equal(item.diffs, null);
  });

  test('已完成的段：寫出不一樣，但鎖著', () => {
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], ctx([sis({ status: 'done' })], 'done'));
    assert.equal(item.diffs.length, 1);
    assert.equal(item.locked, true);
  });

  test('換一個人重算：上一位的不一樣、按著的都不留', () => {
    const c = ctx([sis()]);
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], c);
    const other = resolveItem({ ...item, adopt: true }, 'c-a', c);
    assert.deepEqual([other.diffs, other.adopt], [null, false]);
  });
});

describe('按了才改，只改那兩格', () => {
  test('只有那一段的治療師變成小芳，狀態／時間／記一句一個都沒動、同一天別段沒動', () => {
    const c = ctx([sis(), ilib()]);
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], c);
    const before = c.visitsBy['c-wang'][0];
    const { visit, missed } = adoptAbovee(before, [{ ...item, adopt: true }]);
    assert.deepEqual(missed, []);
    assert.deepEqual(visit.slots[0], { ...before.slots[0], therapistId: 's-fang' });
    assert.deepEqual(visit.slots[1], before.slots[1]);
    assert.deepEqual([visit.status, visit.updatedAt], ['confirmed', 't1']);
  });

  test('改診間時順手清掉床位', () => {
    const c = ctx([ilib()]);
    const [item] = read([r('14:00 - 15:15', 'ILIB 60', '點滴室10', 'I1點10')], c);
    const { visit } = adoptAbovee(c.visitsBy['c-wang'][0], [item]);
    assert.deepEqual([visit.slots[0].roomId, visit.slots[0].bed], ['room-iv10', null]);
  });

  test('她在另一台裝置先改了那一段（或那一段已完成、取消了）→ 不蓋掉，回在 missed', () => {
    const c = ctx([sis()]);
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], c);
    const v = c.visitsBy['c-wang'][0];
    for (const changed of [
      { therapistId: 'staff-zn' }, { status: 'done' }, { status: 'cancelled' }, { startsAt: '10:30' },
    ]) {
      const fresh = { ...v, slots: [{ ...v.slots[0], ...changed }] };
      const { visit, missed } = adoptAbovee(fresh, [item]);
      assert.equal(missed.length, 1, JSON.stringify(changed));
      assert.deepEqual(visit.slots, fresh.slots);
    }
  });

  test('存檔前那一道講「只動這兩格」；只有改的時候標題不說「記錄」', () => {
    const c = ctx([sis()]);
    const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], c);
    const said = aboveeConsequences({ groups: [], adopts: [item], today: '2026-09-01' });
    assert.equal(said.title, '改這 1 段？');
    assert.deepEqual(said.lines, ['改 1 段的治療師成 Abovee 上的 —— 只動這兩格，時間、狀態、待辦都不變']);
  });
});

test('app 上還沒選的只是可以補：寫出來、按得下去，但不排進要你看（匯進來的來訪都沒有治療師）', () => {
  const [item] = read([r('10:00 - 11:15', 'SIS 60', '', '陳小芳')], ctx([sis({ therapistId: null })]));
  assert.deepEqual(item.diffs, [{ field: 'therapistId', app: null, abovee: 's-fang' }]);
  assert.equal(needsAttention(item), false);
});
