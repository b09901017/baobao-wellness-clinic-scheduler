// Abovee 改了時間、app 還沒改（abovee-and-master-2026-10-05/10，ADR-0123）。
//
// 以前：app 上 10:00 SIS、Abovee 上同一段改到 11:00 → 11:00 那一列是「新的」而且預設打勾 → 那一天兩段都佔次數。
// **這一支有沒有任何一條路，讓搬了時間的那一列被預設打勾？** —— 沒有。**反過來，同一天真的有第二段時記不記得進去？** —— 記得：
// 照舊是新的，她勾了就記。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { needsAttention, newRowSay, planAbovee, readAbovee, resolveItem } from '../public/js/domain/aboveeImport.js';
import { SEED } from '../public/js/domain/seed.js';

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const POOL = { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 };
const sis = (startsAt, status = 'pending_confirm') => ({
  entitlementId: 'w-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt, endsAt: `${String(Number(startsAt.slice(0, 2)) + 1).padStart(2, '0')}:00`, status,
});
const ctx = (slots, visitStatus = 'pending_confirm') => ({
  customers: [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }, { id: 'c-a', name: '客戶A', marks: [] }],
  entitlementsBy: { 'c-wang': [POOL], 'c-a': [POOL] },
  visitsBy: { 'c-wang': [{ id: 'v1', customerId: 'c-wang', date: '2026-09-10', status: visitStatus, slots }] },
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today: '2026-09-01',
});
const r = (time, course = 'SIS 60', status = '確認前往') => [status, '2026-09-10', time, '王小明', '00001234', course];
const read = (rows, c) => readAbovee([{ columns: COLS, rows }], c).items;

describe('搬了時間的那一列', () => {
  test('app 上 10:00 SIS、照片上 11:00 SIS → 新的、沒打勾、要你看、講得出 app 上是幾點；勾了記得進去', () => {
    const c = ctx([sis('10:00')]);
    const [item] = read([r('11:00 - 12:15')], c);
    assert.deepEqual([item.kind, item.checked, needsAttention(item)], ['new', false, true]);
    assert.equal(item.movedFrom.startsAt, '10:00');
    assert.match(newRowSay(item), /^app 上 10:00 有一段SIS\(60\) —— 是改了時間的話去日曆改期；確定是另一段再勾。$/);
    const { groups, problems } = planAbovee([{ ...item, checked: true }], c);
    assert.deepEqual(problems, {});
    assert.deepEqual(groups[0].visit.slots.map((s) => s.startsAt), ['10:00', '11:00']);
  });

  test('同一天上午、下午各一段，照片上也是那兩個時間 → 兩列都是已經記了（不互相搶）', () => {
    const items = read([r('10:00 - 11:15'), r('15:00 - 16:15')], ctx([sis('10:00'), sis('15:00')]));
    assert.deepEqual(items.map((i) => i.kind), ['recorded', 'recorded']);
  });

  test('照片上 10:00、15:00，app 上只有 10:00 → 15:00 照舊是新的、打勾（app 上沒有第二段可以搬）', () => {
    const items = read([r('10:00 - 11:15'), r('15:00 - 16:15')], ctx([sis('10:00')]));
    const later = items.find((i) => i.startsAt === '15:00');
    assert.deepEqual([later.kind, later.checked, later.movedFrom], ['new', true, null]);
  });

  test('app 上那一段是取消的 → 不算（照新的一段走）', () => {
    const [item] = read([r('11:00 - 12:15')], ctx([sis('10:00', 'cancelled')]));
    assert.deepEqual([item.kind, item.checked, item.movedFrom], ['new', true, null]);
  });

  test('課程不一樣不算（app 上 10:00 是 ILIB）；器材不一樣不算（app 上 10:00 是 INDIBA）', () => {
    const ilib = { entitlementId: null, courseId: 'course-iv-laser', startsAt: '10:00', endsAt: '11:00', status: 'pending_confirm' };
    assert.equal(read([r('11:00 - 12:15')], ctx([ilib]))[0].movedFrom, null);
    assert.equal(read([r('11:00 - 12:15')], ctx([{ ...sis('10:00'), equipmentId: 'eq-indiba' }]))[0].movedFrom, null);
  });

  test('Abovee 上那一列已取消 → 不比', () => {
    const [item] = read([r('11:00 - 12:15', 'SIS 60', '已取消')], ctx([sis('10:00')]));
    assert.equal(item.movedFrom, null);
  });

  test('換一個人重算：上一位的「搬了時間」不留著', () => {
    const c = ctx([sis('10:00')]);
    const [item] = read([r('11:00 - 12:15')], c);
    assert.equal(resolveItem(item, 'c-a', c).movedFrom, null);
  });
});
