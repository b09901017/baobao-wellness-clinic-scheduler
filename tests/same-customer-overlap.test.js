// 同一位客戶的兩段撞時間：提醒，不擋（ADR-0133，verified-bugs-2026-10-07/issues/04）。
//
// 她 2026-10-07：
//
// > 同一位客戶同一天時間撞在一起是有可能發生的，只是很少見，所以不用擋，但要提醒
// > ( 也許會在同個診間一隻手打針一隻手做eecp之類的 但我通常不會這樣排 )
//
// 那一天已完成之後再加一段會另開一筆來訪（ADR-0083）。同一筆裡的重疊 `overlapWarnings()` 會講，
// 別筆的只在同診間／同治療師時講 —— 同一個人、不同筆、不同診間時兩支都不講。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateVisit } from '../public/js/domain/visits.js';

const COURSES = [
  // 不佔診間也不派治療師的課（功醫門診那一種）：兩段撞在一起時沒有任何一句會講
  { id: 'c-fm', name: '功醫門診', durationMin: 30, assigns: 'none', uncounted: true, doctorPick: 'none' },
  { id: 'c-iv', name: '營養點滴', durationMin: 60, assigns: 'room', allowedRoomTypes: [], allowedRoomIds: [] },
  { id: 'c-rec', name: '復能', durationMin: 60, assigns: 'therapist' },
];
const ROOMS = [{ id: 'r-8a', name: '點滴8A', type: '點滴室' }];
const STAFF = [{ id: 'st-1', name: '治療師甲', role: '物理治療師' }];

const fm = (o = {}) => ({
  entitlementId: null, courseId: 'c-fm', courseName: '功醫門診', startsAt: '14:30', endsAt: '15:00', ...o,
});

const mine = (slots = [fm()]) => ({
  id: null, customerId: 'c1', customerName: '客戶A', date: '2026-10-07', status: 'pending_confirm', slots,
});

/** 那一天已經做完的那一筆 —— 所以新的一段會另開一筆。 */
const done = (slots = [fm({ status: 'done' })], o = {}) => ({
  id: 'v-done', customerId: 'c1', customerName: '客戶A', date: '2026-10-07', status: 'done', slots, ...o,
});

const ask = (visit, sameDayVisits) => validateVisit(visit, {
  customer: { id: 'c1', flags: [] }, entitlements: [], courses: COURSES, equipment: [],
  rooms: ROOMS, staff: STAFF, ivProducts: [], customerVisits: sameDayVisits, sameDayVisits,
});

const SAY = /這位客戶 14:30–15:00 已經有另一段/;

describe('同一位客戶、別筆來訪、時間重疊', () => {
  test('不同診間不同治療師：多一句，而且不擋', () => {
    const { errors, warnings } = ask(mine(), [done()]);
    assert.deepEqual(errors, []);
    const said = warnings.filter((w) => SAY.test(w));
    assert.equal(said.length, 1, warnings.join('｜'));
    assert.match(said[0], /功醫門診/, '講得出那一段是什麼');
    assert.match(said[0], /已完成/, '講得出那一段的狀態');
  });

  test('同一間診間：既有那一句已經講了，不出第二句', () => {
    const iv = (o = {}) => ({
      entitlementId: null, courseId: 'c-iv', courseName: '營養點滴', roomId: 'r-8a',
      startsAt: '14:30', endsAt: '15:00', ...o,
    });
    const { warnings } = ask(mine([iv()]), [done([iv({ status: 'done' })])]);
    assert.ok(warnings.some((w) => w.includes('點滴8A') && w.includes('那天的另一次來訪')), warnings.join('｜'));
    assert.ok(!warnings.some((w) => SAY.test(w)), warnings.join('｜'));
  });

  test('同一位治療師：同樣不出第二句', () => {
    const rec = (o = {}) => ({
      entitlementId: null, courseId: 'c-rec', courseName: '復能', therapistId: 'st-1',
      startsAt: '14:30', endsAt: '15:00', ...o,
    });
    const { warnings } = ask(mine([rec()]), [done([rec({ status: 'done' })])]);
    assert.ok(warnings.some((w) => w.includes('治療師甲')), warnings.join('｜'));
    assert.ok(!warnings.some((w) => SAY.test(w)), warnings.join('｜'));
  });

  test('那一段取消了：不講（假警報的代價是她學會忽略真的）', () => {
    const other = done([fm({ status: 'cancelled' }), fm({ startsAt: '09:00', endsAt: '09:30', status: 'done' })]);
    assert.ok(!ask(mine(), [other]).warnings.some((w) => SAY.test(w)));
  });

  test('那一筆整天取消了：不講', () => {
    const other = done([fm({ status: 'cancelled' })], { status: 'cancelled' });
    assert.ok(!ask(mine(), [other]).warnings.some((w) => SAY.test(w)));
  });

  test('時間沒有重疊：不講', () => {
    const other = done([fm({ startsAt: '15:00', endsAt: '15:30', status: 'done' })]);
    assert.ok(!ask(mine(), [other]).warnings.some((w) => /已經有另一段/.test(w)));
  });

  test('別的客戶、不同診間不同治療師：照舊一句都不講 —— 那是常態', () => {
    const other = done(undefined, { customerId: 'c2', customerName: '客戶B' });
    assert.ok(!ask(mine(), [other]).warnings.some((w) => /已經有另一段/.test(w)));
  });

  test('同一筆來訪裡的兩段重疊照舊只有一句（那是 overlapWarnings 的事）', () => {
    const { warnings } = ask(mine([fm(), fm()]), []);
    assert.equal(warnings.filter((w) => w.includes('重疊')).length, 1, warnings.join('｜'));
    assert.ok(!warnings.some((w) => /已經有另一段/.test(w)));
  });

  test('存著的同一筆不跟自己比', () => {
    const stored = { ...mine(), id: 'v-1' };
    assert.ok(!ask(stored, [stored]).warnings.some((w) => /已經有另一段/.test(w)));
  });
});
