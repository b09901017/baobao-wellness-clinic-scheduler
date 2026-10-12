// 存檔前的提醒只講還算數的段（2026-10-05 她答應修的）。
//
// 她看到的：改期之後舊那一段已經取消了（ADR-0108），第一道確認還是跳「第 1 個時段：二返 還沒選醫師」。
// 同一個形狀的還有：舊那一段跟新的那一段「時間重疊」、取消掉的那一段撞到別人、器材提醒、
// 次數會超過、n返 重複、頻率限制把取消掉的那一天當「上次」。
//
// **這一支有沒有任何一條路，讓一段取消掉的時段在存檔前被提醒？** —— 沒有。例子一律假名。

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateVisit } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const ctx = (over = {}) => ({
  customer: { flags: ['體內金屬'] },
  courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts,
  entitlements: [
    { id: 'e-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 1 },
    { id: 'e-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 10 },
  ],
  customerVisits: [], sameDayVisits: [],
  ...over,
});

// 第 1 段：10:00 二返，改期之後取消了（沒選醫師）；第 2 段：10:30 新的那一段（選好了）
const rebooked = {
  id: 'v1', customerId: 'c1', date: '2026-10-10', status: 'pending_confirm',
  slots: [
    { entitlementId: 'e-fu', courseId: 'course-followup', startsAt: '10:00', endsAt: '11:00', doctorId: null, status: 'cancelled' },
    { entitlementId: 'e-fu', courseId: 'course-followup', startsAt: '10:30', endsAt: '11:30', doctorId: 'staff-dr-xia', status: 'pending_confirm' },
  ],
};

test('改期之後取消掉的那一段：不講還沒選醫師、不講跟新的那一段重疊', () => {
  const { warnings } = validateVisit(rebooked, ctx());
  assert.deepEqual(warnings.filter((w) => w.startsWith('第 1 個時段') || w.includes('重疊')), [], warnings.join('\n'));
});

test('取消掉的 SIS：不講體內金屬；取消掉的那一段不算進「會超過總次數」', () => {
  const visit = {
    id: 'v2', customerId: 'c1', date: '2026-10-10', status: 'pending_confirm',
    slots: [{ entitlementId: 'e-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', therapistId: 'staff-zn',
      startsAt: '09:00', endsAt: '10:00', status: 'cancelled' }],
  };
  const { warnings } = validateVisit(visit, ctx({ entitlements: [{ ...ctx().entitlements[1], totalQty: 0 }] }));
  assert.deepEqual(warnings, []);
});

test('取消掉的那一段撞到別人：不講', () => {
  const other = { id: 'v9', customerId: 'c2', customerName: '客戶A', date: '2026-10-10', status: 'confirmed',
    slots: [{ courseId: 'course-recovery', startsAt: '10:00', endsAt: '11:00', therapistId: 'staff-tw', status: 'confirmed' }] };
  const visit = {
    id: 'v3', customerId: 'c1', date: '2026-10-10', status: 'pending_confirm',
    slots: [{ entitlementId: 'e-pool', courseId: 'course-recovery', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      startsAt: '10:00', endsAt: '11:00', status: 'cancelled' }],
  };
  assert.deepEqual(validateVisit(visit, ctx({ sameDayVisits: [other] })).warnings, []);
});

test('還活著的段照講，而且編號照原本的位置（第 2 段就是第 2 段）', () => {
  const visit = { ...rebooked, slots: [rebooked.slots[0], { ...rebooked.slots[1], doctorId: null }] };
  const { warnings } = validateVisit(visit, ctx());
  assert.ok(warnings.includes('第 2 個時段：二返 還沒選醫師'), warnings.join('\n'));
});

test('兩段都活著還是講重疊，編號是原本的位置（中間夾著一段取消的）', () => {
  const slot = (startsAt, endsAt, status = 'pending_confirm') => ({
    entitlementId: 'e-fu', courseId: 'course-followup', startsAt, endsAt, doctorId: 'staff-dr-xia', status,
  });
  const visit = { ...rebooked, slots: [slot('09:00', '10:00'), slot('09:00', '10:00', 'cancelled'), slot('09:30', '10:30')] };
  const { warnings } = validateVisit(visit, ctx());
  assert.deepEqual(warnings.filter((w) => w.includes('重疊')), ['第 1 與第 3 個時段時間重疊']);
});

test('頻率限制的「上次」是真的做了的那一次：那一天取消掉的那一段不算', () => {
  const before = { id: 'v0', customerId: 'c1', date: '2026-09-01', status: 'done',
    slots: [
      { courseId: 'course-inbody', startsAt: '09:00', endsAt: '09:20', status: 'cancelled' },
      { courseId: 'course-recovery', startsAt: '10:00', endsAt: '11:00', status: 'done' },
    ] };
  const visit = { id: 'v4', customerId: 'c1', date: '2026-10-10', status: 'pending_confirm',
    slots: [{ courseId: 'course-inbody', startsAt: '09:00', endsAt: '09:20', status: 'pending_confirm' }] };
  const { warnings } = validateVisit(visit, ctx({ customerVisits: [before] }));
  assert.equal(warnings.some((w) => w.includes('每季一次')), false, warnings.join('\n'));
});
