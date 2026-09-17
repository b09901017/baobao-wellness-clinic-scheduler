// 組一段時段只有一支（issue 10，`domain/slotDraft.js`）。
//
// 「一段時段長什麼樣」以前寫在壓表的畫面裡（`addSlot()`）。拍 Abovee（issue 13）是第三個
// 會建立時段的入口，照抄一份的話 CLAUDE.md 那張表上「兩個入口共用」的每一列都多一個會漏的地方，
// 而症狀是**畫面看起來對、存進去的是錯的**。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { slotFromPicks, visitWithSlot } from '../public/js/domain/slotDraft.js';
import { INITIAL_STATUS } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';
import { fromRoot } from './helpers/paths.js';

const ENTS = [
  { id: 'ent-pool3', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 },
  { id: 'ent-pool4', type: 'pool', label: '復能-四選一(30)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba', 'eq-ilib'], durationMin: 30, totalQty: 10 },
  { id: 'ent-ilib', type: 'single', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 20 },
  { id: 'ent-drip', type: 'single', label: '營養點滴 - 雪顏亮彩', courseId: 'course-iv-drip', totalQty: 5 },
  { id: 'ent-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', tier: '8萬', totalQty: 1 },
  { id: 'ent-2nd', type: 'single', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'ent-exam', totalQty: 1 },
];

const EXAM_VISIT = {
  id: 'v-exam', customerId: 'c1', date: '2026-08-03', status: 'done',
  slots: [{ entitlementId: 'ent-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'done' }],
};

const ctx = (over = {}) => ({
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  entitlements: ENTS, visits: [EXAM_VISIT], ...over,
});

const picks = (over = {}) => ({
  entitlementId: null, isNth: false, equipmentId: null, ivProductId: null, startsAt: '10:00',
  roomId: null, bed: null, therapistId: null, doctorId: null, nth: null, followupForVisitId: null, note: null,
  ...over,
});

describe('前面那幾道先擋（句子照抄壓表的）', () => {
  test('沒選要做什麼 → 先選要做什麼；沒選時間 → 先選幾點開始', () => {
    assert.deepEqual(slotFromPicks(picks(), ctx()).errors, ['先選要做什麼']);
    assert.deepEqual(slotFromPicks(picks({ entitlementId: 'ent-ilib', startsAt: null }), ctx()).errors, ['先選幾點開始']);
  });

  test('n返：先選第幾返，再選哪一次健檢', () => {
    assert.deepEqual(slotFromPicks(picks({ isNth: true }), ctx()).errors, ['先選第幾返']);
    assert.match(slotFromPicks(picks({ isNth: true, nth: 3 }), ctx()).errors[0], /^先選這是哪一次健檢的/);
  });

  test('一個健檢都沒做完 → n返 那一顆本來就不在，當成沒選', () => {
    assert.deepEqual(slotFromPicks(picks({ isNth: true, nth: 3, followupForVisitId: 'v-exam' }), ctx({ visits: [] })).errors,
      ['先選要做什麼']);
  });
});

describe('課程由器材決定、指派由課程決定（ADR-0075、0079）', () => {
  test('擇一池選 SIS → 課程是復能、要治療師、不要診間', () => {
    const { slot, errors, assigns } = slotFromPicks(picks({
      entitlementId: 'ent-pool3', equipmentId: 'eq-sis', therapistId: 'staff-1', roomId: 'room-t2', bed: 'A',
    }), ctx());
    assert.deepEqual(errors, []);
    assert.equal(assigns, 'therapist');
    assert.equal(slot.courseId, 'course-recovery');
    assert.equal(slot.courseName, '復能');
    assert.equal(slot.equipmentId, 'eq-sis');
    assert.equal(slot.therapistId, 'staff-1');
    assert.equal(slot.roomId, null);
    assert.equal(slot.bed, null);
    assert.equal(slot.endsAt, '11:00');
  });

  test('擇一池還沒選器材 → 指派答不出來，兩種都不挑（不給預設值）', () => {
    const { slot, assigns } = slotFromPicks(picks({
      entitlementId: 'ent-pool3', therapistId: 'staff-1', roomId: 'room-t2',
    }), ctx());
    assert.equal(assigns, null);
    assert.equal(slot.therapistId, null);
    assert.equal(slot.roomId, null);
    assert.equal(slot.equipmentId, null);
  });

  test('四選一選到 ILIB 那一台 → 課程換成 ILIB、要診間', () => {
    const { slot, assigns } = slotFromPicks(picks({
      entitlementId: 'ent-pool4', equipmentId: 'eq-ilib', therapistId: 'staff-1', roomId: 'room-iv10',
    }), ctx());
    assert.equal(assigns, 'room');
    assert.equal(slot.courseId, 'course-iv-laser');
    assert.equal(slot.roomId, 'room-iv10');
    assert.equal(slot.therapistId, null);
    assert.equal(slot.endsAt, '10:30', '時長問額度（30）');
  });

  test('ILIB → 要診間；營養點滴選護心抗老 → 180 分（ADR-0098）', () => {
    const ilib = slotFromPicks(picks({ entitlementId: 'ent-ilib', roomId: 'room-t2' }), ctx());
    assert.equal(ilib.assigns, 'room');
    assert.equal(ilib.slot.roomId, 'room-t2');
    assert.equal(ilib.slot.equipmentId, null);

    const drip = slotFromPicks(picks({ entitlementId: 'ent-drip', ivProductId: 'iv-heart', equipmentId: 'iv-heart' }), ctx());
    assert.equal(drip.slot.ivProductId, 'iv-heart');
    assert.equal(drip.slot.equipmentId, null, '品項不是器材');
    assert.equal(drip.slot.endsAt, '13:00');
  });

  test('二返那一筆帶著「接在哪一次健檢」；別的額度帶著也清掉', () => {
    const second = slotFromPicks(picks({ entitlementId: 'ent-2nd', followupForVisitId: 'v-exam', doctorId: 'doc-1' }), ctx());
    assert.equal(second.slot.followupForVisitId, 'v-exam');
    assert.equal(second.slot.doctorId, 'doc-1', 'A 類選得到醫師');
    const ilib = slotFromPicks(picks({ entitlementId: 'ent-ilib', followupForVisitId: 'v-exam', doctorId: 'doc-1' }), ctx());
    assert.equal(ilib.slot.followupForVisitId, null);
    assert.equal(ilib.slot.doctorId, null);
  });
});

describe('n返（ADR-0063）', () => {
  test('n返 → 沒有額度、帶返數與哪一次健檢，課程借二返那一個', () => {
    const { slot, errors } = slotFromPicks(picks({ isNth: true, nth: 3, followupForVisitId: 'v-exam' }), ctx());
    assert.deepEqual(errors, []);
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.followupNth, 3);
    assert.equal(slot.followupForVisitId, 'v-exam');
    assert.equal(slot.courseId, 'course-followup');
    assert.equal(slot.courseName, '三返');
  });

  test('換回普通額度 → 返數那兩格清乾淨', () => {
    const { slot } = slotFromPicks(picks({ entitlementId: 'ent-ilib', nth: 3, followupForVisitId: 'v-exam' }), ctx());
    assert.equal('followupNth' in slot, false);
    assert.equal(slot.followupForVisitId, null);
    assert.equal(slot.entitlementId, 'ent-ilib');
  });
});

describe('新的一段一定是還沒問過客人的', () => {
  const { slot } = slotFromPicks(picks({ entitlementId: 'ent-ilib', roomId: 'room-t2', note: '她說下午比較好' }), ctx());

  test('新段帶 INITIAL_STATUS 與那一句話', () => {
    assert.equal(slot.status, INITIAL_STATUS);
    assert.equal(slot.note, '她說下午比較好');
    assert.equal(slot.attended, null);
  });

  test('那一天沒有來訪 → 組一筆新的', () => {
    const { visit, merged } = visitWithSlot({ customerId: 'c1', customerName: '王小明' }, '2026-09-20', slot, [EXAM_VISIT]);
    assert.equal(merged, null);
    assert.equal(visit.status, INITIAL_STATUS);
    assert.deepEqual(visit.slots, [slot]);
    assert.equal(visit.customerName, '王小明');
  });

  test('併進一筆已確認的來訪：新段還是 INITIAL_STATUS，舊段留著自己的，整筆退回待確認', () => {
    const confirmed = {
      id: 'v-9', customerId: 'c1', date: '2026-09-20', status: 'confirmed',
      slots: [{ entitlementId: 'ent-pool3', courseId: 'course-recovery', startsAt: '09:00', endsAt: '10:00' }],
    };
    const { visit, merged } = visitWithSlot({ customerId: 'c1', customerName: '王小明' }, '2026-09-20', slot, [confirmed]);
    assert.equal(merged.reopened, true);
    assert.equal(visit.id, 'v-9');
    assert.deepEqual(visit.slots.map((s) => s.status), ['confirmed', INITIAL_STATUS]);
    assert.equal(visit.status, INITIAL_STATUS);
  });
});

describe('壓表的 addSlot() 不自己組時段', () => {
  test('裡面不再出現 assignsFor(、nthSlotFields(、effectiveCourse(', () => {
    const src = readFileSync(fromRoot('public/js/ui/views/schedule.js'), 'utf8').replace(/\r\n/g, '\n');
    const start = src.indexOf('async function addSlot()');
    assert.ok(start >= 0, '找不到 addSlot()');
    const body = src.slice(start, src.indexOf('\n}\n', start));
    for (const banned of ['assignsFor(', 'nthSlotFields(', 'effectiveCourse(', 'pickedMinutes(', 'withExtraSlot(']) {
      assert.equal(body.includes(banned), false, `addSlot() 裡還有 ${banned}`);
    }
    assert.ok(body.includes('slotFromPicks('), '組時段要走 slotFromPicks()');
  });
});
