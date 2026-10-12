// 提醒與錯誤裡那一段叫什麼（verified-bugs-2026-10-07/issues/07）。
//
// `validateVisit()` 驗的是真的會寫下去的那一筆（併進同一天之後的，ADR-0083），編號是那一段在裡面的位置。
// 但畫面上列的不一定是整筆：日曆新增時那一天原本的段刻意不列、壓表只有她正在加的那一段、
// 「改這一段」只有她點的那一段 —— 畫面上只有一段卻寫「第 2 個時段」。
// 所以呼叫端可以自己說每一段叫什麼（`ctx.slotLabel`）；不說就照舊。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { validateVisit, slotSay } from '../public/js/domain/visits.js';

const COURSES = [
  { id: 'c-rec', name: '復能', assigns: 'therapist', requiresEquipment: true },
  { id: 'c-fm', name: '功醫門診', assigns: 'none', uncounted: true, doctorPick: 'none' },
];
const EQUIPMENT = [{ id: 'eq-sis', name: 'SIS', courseId: 'c-rec', contraindications: ['體內金屬'] }];
const STAFF = [{ id: 'st-1', name: '治療師甲', role: '物理治療師' }];
const ENTS = [{ id: 'e-pool', type: 'pool', label: '復能-SIS(60)', optionEquipmentIds: ['eq-sis'], totalQty: 1 }];

const rec = (o = {}) => ({
  entitlementId: 'e-pool', courseId: 'c-rec', courseName: '復能', equipmentId: 'eq-sis',
  startsAt: '09:00', endsAt: '10:00', therapistId: null, status: 'pending_confirm', ...o,
});

const visit = (slots) => ({
  id: null, customerId: 'c1', customerName: '客戶A', date: '2026-10-07', status: 'pending_confirm', slots,
});

const ctx = (o = {}) => ({
  customer: { id: 'c1', flags: ['體內金屬'] }, entitlements: ENTS, courses: COURSES, equipment: EQUIPMENT,
  rooms: [], staff: STAFF, ivProducts: [], customerVisits: [], sameDayVisits: [], ...o,
});

describe('不給 slotLabel：一個字都不變', () => {
  test('錯誤與提醒照舊「第 N 個時段」', () => {
    const { errors, warnings } = validateVisit(visit([rec(), rec({ equipmentId: null })]), ctx());
    assert.ok(errors.some((e) => e.startsWith('第 2 個時段：')), errors.join('｜'));
    assert.ok(warnings.some((w) => w.startsWith('第 1 個時段：')), warnings.join('｜'));
    assert.ok(warnings.includes('第 1 與第 2 個時段時間重疊'), warnings.join('｜'));
  });
});

describe('給了 slotLabel：每一句都用它', () => {
  // 畫面上只有她正在加的那一段（第 2 段）；第 1 段是那一天原本就有的
  const slotLabel = (i) => (i === 1 ? '這一段' : '09:00 的 SIS(60)');
  const two = visit([rec(), rec({ equipmentId: null, therapistId: 'st-1' })]);
  const other = {
    id: 'v-other', customerId: 'c2', customerName: '客戶B', date: '2026-10-07', status: 'confirmed',
    slots: [{ startsAt: '09:00', endsAt: '10:00', therapistId: 'st-1', status: 'confirmed' }],
  };
  const { errors, warnings } = validateVisit(two, ctx({ slotLabel, sameDayVisits: [other] }));
  const all = [...errors, ...warnings];

  test('沒有任何一句還在講「第 N 個時段」', () => {
    assert.deepEqual(all.filter((x) => /第 \d+ (與第 \d+ )?個時段/.test(x)), [], all.join('｜'));
  });

  test('錯誤（每次都要記錄器材）', () => {
    assert.ok(errors.some((e) => e.startsWith('這一段：') && e.includes('器材')), errors.join('｜'));
  });

  test('器材要提醒的那一句（看不到的那一段用時間與名字叫）', () => {
    assert.ok(warnings.some((w) => w.startsWith('09:00 的 SIS(60)：')), warnings.join('｜'));
  });

  test('還沒選治療師', () => {
    assert.ok(warnings.includes('09:00 的 SIS(60)：復能 還沒選治療師'), warnings.join('｜'));
  });

  test('撞到別人', () => {
    assert.ok(warnings.some((w) => w.startsWith('這一段：治療師甲')), warnings.join('｜'));
  });

  test('時間重疊：兩段各用自己的叫法', () => {
    assert.ok(warnings.includes('09:00 的 SIS(60) 跟 這一段 時間重疊'), warnings.join('｜'));
  });
});

describe('slotSay()：一段不在畫面上時怎麼叫它', () => {
  const master = { courses: COURSES, equipment: EQUIPMENT, ivProducts: [] };

  test('時間＋那天做了什麼', () => {
    assert.equal(slotSay(rec(), master), '09:00 的 SIS');
  });

  test('沒有時間（匯入的舊資料）只講名字', () => {
    assert.equal(slotSay(rec({ startsAt: null, endsAt: null }), master), 'SIS');
  });

  test('什麼都認不出來也不吐空字串', () => {
    assert.equal(slotSay({}, {}), '那一段');
  });
});
