// 約的時候選時長（2026-10-05，issue 06，ADR-0122）。
//
// 她的原話：
//
// > 時長：SIS／IN／高能量／ILIB／二返／n返 是 30、60；EECP 是 20、60
// > 1. 是，約的時候選，預設 30。拍照時照 Abovee 那一格（二返60 就記 60）
//
// app 原本只有一種「30／60」：**買的時候分**（`durationChoices`）—— `復能-三選一(30)` 與
// `(60)` 是兩筆不同的額度。二返的額度是跟著健檢自動長出來的，買的時候沒得選，所以固定 30 分；
// Abovee 上二返60 有 9 筆，記進 app 日曆那一格少一半。
//
// 這一支盯：`slotMinutes()` 多的那一層排在最前面而且只在該算數時算數、它跟著那一段走
// （改期、只改醫師都不掉）、月曆那一格接上分鐘、而**舊資料一個都沒變**。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { bookingMinutesOf, durationChoicesOf, validate } from '../public/js/domain/masterData.js';
import { slotMinutes, slotMinutesField, rebookSlot, INITIAL_STATUS } from '../public/js/domain/visits.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { slotName } from '../public/js/domain/naming.js';
import { autoLabel } from '../public/js/domain/entitlements.js';
import { SEED } from '../public/js/domain/seed.js';
import { fieldLabel } from '../public/js/domain/audit.js';

const FOLLOWUP = {
  id: 'fu', name: '二返', durationMin: 30, assigns: 'none', bookingMinutes: [30, 60],
  doctorPick: 'any', needsTreatmentForm: false,
};
const CHECKUP = { id: 'chk', name: '健檢', durationMin: 120, assigns: 'none', followupCourseId: 'fu' };
const RECOVERY = {
  id: 'rec', name: '復能', durationMin: 60, assigns: 'therapist', durationChoices: [30, 60],
};
const DRIP = { id: 'drip', name: '營養點滴', durationMin: 120, assigns: 'room', requiresIvProduct: true };
const PLAIN = { id: 'plain', name: '身體組成分析', durationMin: 20, assigns: 'none' };
const COURSES = [FOLLOWUP, CHECKUP, RECOVERY, DRIP, PLAIN];
const MASTER = { courses: COURSES, equipment: [], ivProducts: [{ id: 'iv-heart', name: '護心抗老', durationMin: 180 }] };

const E_CHK = { id: 'e-chk', type: 'single', courseId: 'chk', label: '健檢', totalQty: 1, doneCount: 1 };
const E_FU = { id: 'e-fu', type: 'single', courseId: 'fu', label: '二返', totalQty: 1, durationMin: 30, followupForEntitlementId: 'e-chk' };
const E_REC30 = { id: 'e-rec', type: 'single', courseId: 'rec', label: '復能(30)', totalQty: 5, durationMin: 30 };
const EXAM = {
  id: 'v-chk', customerId: 'c1', date: '2026-09-01', status: 'done',
  slots: [{ entitlementId: 'e-chk', courseId: 'chk', status: 'done', attended: true }],
};
const ctx = { courses: COURSES, equipment: [], ivProducts: MASTER.ivProducts, entitlements: [E_CHK, E_FU, E_REC30], visits: [EXAM] };

describe('課程上那一格（bookingMinutes）', () => {
  test('只收大於 0 的整數；沒有就是不給選', () => {
    assert.deepEqual(bookingMinutesOf(FOLLOWUP), [30, 60]);
    assert.deepEqual(bookingMinutesOf(PLAIN), []);
    assert.deepEqual(bookingMinutesOf({ bookingMinutes: [30, 'x', 0, 60.5, 90] }), [30, 90]);
    assert.deepEqual(bookingMinutesOf(null), []);
  });

  test('它跟「買的時候分」是兩格，互不影響', () => {
    assert.deepEqual(durationChoicesOf(FOLLOWUP), [], '二返的額度不會因此變成 二返(30)、加購也不會多一排丸子');
    assert.deepEqual(bookingMinutesOf(RECOVERY), []);
    assert.equal(autoLabel({ type: 'single', courseId: 'fu', durationMin: 30 }, MASTER), '二返');
  });

  const ok = { name: '新課', durationMin: 30, category: 'C', assigns: 'none' };

  test('驗證：整數、不重複、最多六個、要包含預設的那個時長', () => {
    assert.deepEqual(validate('courses', { ...ok, bookingMinutes: [30, 60] }), []);
    assert.deepEqual(validate('courses', { ...ok, bookingMinutes: [] }), []);
    assert.deepEqual(validate('courses', { ...ok }), []);
    assert.ok(validate('courses', { ...ok, bookingMinutes: [30, 30] }).length);
    assert.ok(validate('courses', { ...ok, bookingMinutes: [30, -5] }).length);
    assert.ok(validate('courses', { ...ok, bookingMinutes: '30、60' }).length);
    assert.ok(validate('courses', { ...ok, bookingMinutes: [20, 60] }).some((e) => e.includes('要包含')),
      '預設那一顆不在名單上的話那一排會一顆都沒按著');
  });

  test('同一門課兩格不能都填，講為什麼', () => {
    const errors = validate('courses', { ...ok, durationChoices: [30, 60], bookingMinutes: [30, 60] });
    assert.ok(errors.some((e) => e.includes('只能填一格')), errors.join());
  });

  test('種子：二返是 30、60；沒有一門課兩格都填', () => {
    const fu = SEED.courses.find((c) => c.id === 'course-followup');
    assert.deepEqual(fu.bookingMinutes, [30, 60]);
    assert.equal(fu.durationMin, 30, '預設 30');
    for (const c of SEED.courses) {
      assert.ok(!(durationChoicesOf(c).length && bookingMinutesOf(c).length), c.name);
      assert.deepEqual(validate('courses', c, { existing: SEED.courses }), [], c.name);
    }
  });
});

describe('這一段要排多久（slotMinutes 多一層）', () => {
  test('順序：這一段選的 → 品項 → 額度 → 課程 → 60', () => {
    assert.equal(slotMinutes({ entitlement: E_FU, course: FOLLOWUP, minutes: 60 }), 60, '她選的排最前面');
    assert.equal(slotMinutes({ entitlement: E_FU, course: FOLLOWUP }), 30, '沒選就照額度');
    assert.equal(slotMinutes({ course: FOLLOWUP }), 30, '沒有額度照課程');
    assert.equal(slotMinutes({}), 60);
  });

  test('只在那門課有 bookingMinutes、而且值在裡面時才算數', () => {
    assert.equal(slotMinutes({ entitlement: E_FU, course: FOLLOWUP, minutes: 45 }), 30, '不在名單上的不算');
    assert.equal(slotMinutes({ entitlement: E_REC30, course: RECOVERY, minutes: 60 }), 30,
      '復能是買的時候分的：帶著一個 minutes 也不可以蓋過額度');
    assert.equal(slotMinutes({ course: PLAIN, minutes: 60 }), 20);
    assert.equal(slotMinutes({ entitlement: E_FU, course: FOLLOWUP, minutes: '60' }), 60, '表單讀回來是字串');
    assert.equal(slotMinutes({ entitlement: E_FU, course: FOLLOWUP, minutes: null }), 30);
  });

  test('營養點滴沒有 bookingMinutes：品項那一層照舊（ADR-0098）', () => {
    const heart = MASTER.ivProducts[0];
    assert.equal(slotMinutes({ course: DRIP, ivProduct: heart, minutes: 30 }), 180);
  });

  test('舊資料：沒有 minutes 的二返照舊 30 分', () => {
    const old = { entitlementId: 'e-fu', courseId: 'fu', startsAt: '14:00', endsAt: '14:30' };
    assert.equal(slotMinutes({ entitlement: E_FU, course: FOLLOWUP, minutes: old.minutes }), 30);
  });

  test('要存進時段的那一格：這門課可以選、而且算出來的數字在名單上才存', () => {
    assert.equal(slotMinutesField({ entitlement: E_FU, course: FOLLOWUP, minutes: 60 }), 60);
    assert.equal(slotMinutesField({ entitlement: E_FU, course: FOLLOWUP }), 30, '沒動那一排就是預設那一顆');
    assert.equal(slotMinutesField({ entitlement: E_REC30, course: RECOVERY, minutes: 60 }), null);
    assert.equal(slotMinutesField({ course: PLAIN }), null);
    // 額度上的時長不在名單上（怪資料）：不存，照額度走
    assert.equal(slotMinutesField({ entitlement: { durationMin: 45 }, course: FOLLOWUP }), null);
  });
});

describe('組時段（slotFromPicks）', () => {
  test('二返選 60：結束時間是一小時、那一段記著 60', () => {
    const { slot, errors } = slotFromPicks(
      { entitlementId: 'e-fu', startsAt: '14:00', followupForVisitId: 'v-chk', minutes: 60 }, ctx,
    );
    assert.deepEqual(errors, []);
    assert.equal(slot.endsAt, '15:00');
    assert.equal(slot.minutes, 60);
  });

  test('沒選：預設 30，那一段記著 30', () => {
    const { slot } = slotFromPicks({ entitlementId: 'e-fu', startsAt: '14:00', followupForVisitId: 'v-chk' }, ctx);
    assert.equal(slot.endsAt, '14:30');
    assert.equal(slot.minutes, 30);
  });

  test('一段 n返 也能選 60（它借二返那門課）', () => {
    const { slot, errors } = slotFromPicks(
      { isNth: true, nth: 3, startsAt: '10:00', followupForVisitId: 'v-chk', minutes: 60 }, ctx,
    );
    assert.deepEqual(errors, []);
    assert.equal(slot.followupNth, 3);
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.endsAt, '11:00');
    assert.equal(slot.minutes, 60);
  });

  test('復能(30) 那一段沒有這一格，結束時間照額度', () => {
    const { slot } = slotFromPicks({ entitlementId: 'e-rec', startsAt: '09:00', therapistId: 't1', minutes: 60 }, ctx);
    assert.equal(slot.endsAt, '09:30');
    assert.equal(slot.minutes ?? null, null);
  });
});

describe('它跟著那一段走', () => {
  test('改期：新的那一段還是 60（`rebookSlot()` 整段抄過去）', () => {
    const before = {
      id: 'v1', customerId: 'c1', date: '2026-10-20', status: 'confirmed',
      slots: [{ entitlementId: 'e-fu', courseId: 'fu', startsAt: '14:00', endsAt: '15:00', minutes: 60, status: 'confirmed' }],
    };
    const after = rebookSlot(before, 0, { ...before.slots[0], startsAt: '16:00', endsAt: '17:00' });
    assert.equal(after.slots[0].status, 'cancelled');
    assert.equal(after.slots[1].minutes, 60);
    assert.equal(after.slots[1].status, INITIAL_STATUS);
  });

  test('只改時長不算改期（外面那幾個系統上的開始時間與課程都沒變）', () => {
    const before = {
      id: 'v1', customerId: 'c1', date: '2026-10-20', status: 'confirmed',
      slots: [{ entitlementId: 'e-fu', courseId: 'fu', startsAt: '14:00', endsAt: '14:30', minutes: 30, status: 'confirmed' }],
    };
    assert.equal(rebookSlot(before, 0, { ...before.slots[0], endsAt: '15:00', minutes: 60 }), null);
  });
});

describe('月曆那一格接上分鐘', () => {
  const slot = (over) => ({ courseId: 'fu', courseName: '二返', startsAt: '14:00', endsAt: '15:00', ...over });

  test('有 bookingMinutes 的課也算「兩種以上規格」：二返(60)', () => {
    assert.equal(slotName(slot({ minutes: 60 }), MASTER, 'short'), '二返(60)');
    assert.equal(slotName(slot({ endsAt: '14:30', minutes: 30 }), MASTER, 'short'), '二返(30)');
  });

  test('n返 在讀快照那一條路上也接：三返(60)', () => {
    assert.equal(slotName(slot({ courseName: '三返', followupNth: 3, minutes: 60 }), MASTER, 'short'), '三返(60)');
  });

  test('貼給客人的那一句不接分鐘', () => {
    assert.equal(slotName(slot({ minutes: 60 }), MASTER, 'line'), '二返');
    assert.equal(slotName(slot({ courseName: '三返', followupNth: 3, minutes: 60 }), MASTER, 'line'), '三返');
  });

  test('沒有起訖時間的舊來訪不補一個猜的', () => {
    assert.equal(slotName({ courseId: 'fu', courseName: '二返' }, MASTER, 'short'), '二返');
  });

  test('兩格都沒有的課照舊不接；買的時候分的照舊接', () => {
    assert.equal(slotName({ courseId: 'plain', startsAt: '09:00', endsAt: '09:20' }, MASTER, 'short'), '身體組成分析');
    assert.equal(slotName({ courseId: 'rec', startsAt: '09:00', endsAt: '09:30' }, MASTER, 'short'), '復能(30)');
  });
});

describe('入口都把她選的那一格交下去', () => {
  const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

  test('壓表有那一排，而且交給 slotFromPicks()', () => {
    const src = read('ui/views/schedule.js');
    assert.match(src, /data-minutes/);
    assert.match(src, /minutes: view\.minutes/);
  });

  test('來訪編輯器有那一排，沒動到時保留原本的；n返 那條路也讀', () => {
    const src = read('ui/views/visitEditor.js');
    assert.match(src, /-min`/);
    assert.ok((src.match(/slotMinutesField\(/g) ?? []).length >= 2, '一般的段與 n返 兩條路都要存那一格');
  });

  test('`durationChoicesOf()` 沒有被改去認 bookingMinutes', () => {
    const src = read('domain/masterData.js');
    const body = src.slice(src.indexOf('export const durationChoicesOf'));
    assert.ok(!body.slice(0, body.indexOf(';')).includes('bookingMinutes'));
  });

  test('稽核不印英文欄位名', () => {
    assert.equal(fieldLabel('bookingMinutes'), '約的時候選時長');
  });
});
