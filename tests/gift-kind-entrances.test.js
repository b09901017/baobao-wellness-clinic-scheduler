// 三個入口接好「體驗／送的」那一格（2026-10-14，gift-and-trial 02）。
//
// 她的原話：
//
// > 就是如果有標註體驗的就直接送不算次數，就不會被沒有額度檔，畢竟是送的，但是來訪以及試算表還是要標註(送的)、(體驗)
//
// 01 把規則放進 domain；這一支盯的是**畫面看起來對、存進去是錯的**那一種：她在現在的畫面上按過、改過、拍過的每一段，
// 存進去的 `giftKind`、器材、時長都是對的。拍 Abovee 的翻譯在 domain（`aboveeImport.js`），這裡直接叫；
// 壓表與來訪編輯器是畫面（node 裡 import 不了），行為由 E2E `67` 盯，這裡只掃它們把那一格交給了同一支。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  pickOption, picksOf, planAbovee, readAbovee, resolveItem,
} from '../public/js/domain/aboveeImport.js';
import { giftPick } from '../public/js/domain/slotOptions.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { rebookSlot, equipmentChoicesFor } from '../public/js/domain/visits.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-wang', name: '王小明', marks: chart('1234') },
  { id: 'c-a', name: '客戶A', marks: [] },
];
const POOL = {
  id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'],
  durationMin: 60, totalQty: 12,
};
const ENTS = { 'c-wang': [POOL], 'c-a': [] };
const MASTER = { courses: COURSES, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const ctx = (over = {}) => ({
  customers: CUSTOMERS, entitlementsBy: ENTS, visitsBy: {}, master: MASTER, today: '2026-10-01', ...over,
});
const LEFT = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const read = (course, name = '王小明', chartNo = '00001234', c = ctx()) =>
  readAbovee([{ columns: LEFT, rows: [['確認前往', '2026-10-10', '10:00 - 11:15', name, chartNo, course]] }], c).items[0];
const slotCtx = (entitlements = []) => ({
  courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts, entitlements, visits: [],
});

describe('拍 Abovee', () => {
  test('一列功醫門診、沒有額度 → 預選不扣、存下去是體驗', () => {
    const item = { ...read('功醫門診', '客戶A', ''), checked: true };
    assert.equal(item.giftCourseId, 'course-fm');
    const { groups, problems } = planAbovee([{ ...item, doctorId: 'staff-dr-xia' }], ctx());
    assert.deepEqual(problems, {});
    assert.equal(groups[0].visit.slots[0].giftKind, 'trial');
    assert.equal(groups[0].visit.slots[0].entitlementId, null);
  });

  test('一列 IN 30 選成體驗的復能 → 器材留著 INDIBA、30 分、不扣', () => {
    const next = pickOption(read('IN 30'), giftPick('course-recovery'), ctx());
    assert.equal(next.giftCourseId, 'course-recovery');
    assert.equal(next.giftKind, 'trial');
    assert.equal(next.equipmentId, 'eq-indiba', '照片上寫的那一台不可以被丟掉');
    const { slot } = slotFromPicks({ ...picksOf(next), therapistId: 'staff-tw' }, slotCtx(ENTS['c-wang']));
    assert.equal(slot.equipmentId, 'eq-indiba');
    assert.equal(slot.courseId, 'course-recovery');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.giftKind, 'trial');
    assert.equal(slot.endsAt, '10:30');
  });

  test('器材那一排列得出 IN／SIS／高能量、沒有 ILIB', () => {
    const recovery = COURSES.find((c) => c.id === 'course-recovery');
    const ids = equipmentChoicesFor(null, recovery, SEED.equipment).map((e) => e.id).sort();
    assert.deepEqual(ids, ['eq-indiba', 'eq-laser', 'eq-sis']);
  });

  test('照片上那一台不屬於這門課（ILIB）→ 不留，讓她重選', () => {
    const next = pickOption(read('ILIB 60'), giftPick('course-recovery'), ctx());
    assert.equal(next.equipmentId, null);
  });

  test('送的就是送的：換一門送的課照樣是送的；換回額度就清掉', () => {
    const gift = { ...pickOption(read('功醫門診', '客戶A', ''), giftPick('course-fm'), ctx()), giftKind: 'gift' };
    assert.equal(pickOption(gift, giftPick('course-cardio'), ctx()).giftKind, 'gift');
    const back = pickOption({ ...gift, customerId: 'c-wang' }, 'w-pool', ctx());
    assert.equal(back.giftKind, null);
    assert.equal(back.giftCourseId, null);
  });

  test('換一位（resolveItem）：上一位的 giftKind 不留著', () => {
    const gift = { ...pickOption(read('SIS 60'), giftPick('course-recovery'), ctx()), giftKind: 'gift' };
    const again = resolveItem(gift, 'c-wang', ctx());
    assert.equal(again.giftKind, null, '王小明身上有復能池，SIS 60 照舊扣');
    assert.equal(again.entitlementId, 'w-pool');
  });

  test('已經記了的那一列：giftKind 清掉（它不是新的一段）', () => {
    const existing = {
      id: 'v-old', customerId: 'c-wang', date: '2026-10-10', status: 'pending_confirm',
      slots: [{ entitlementId: null, courseId: 'course-fm', startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm', giftKind: 'trial' }],
    };
    const item = read('功醫門診', '王小明', '00001234', ctx({ visitsBy: { 'c-wang': [existing] } }));
    assert.equal(item.kind, 'recorded');
    assert.equal(item.giftKind ?? null, null);
    assert.equal(item.giftCourseId ?? null, null);
  });
});

describe('改期：還是體驗', () => {
  test('改一段體驗的開始時間 → 取消的那一段與新的那一段都是體驗', () => {
    const before = {
      id: 'v1', customerId: 'c-a', date: '2026-10-10', status: 'confirmed',
      slots: [{ entitlementId: null, courseId: 'course-cardio', startsAt: '10:00', endsAt: '10:30', status: 'confirmed', giftKind: 'gift' }],
    };
    const after = rebookSlot(before, 0, { ...before.slots[0], startsAt: '14:00', endsAt: '14:30' });
    assert.deepEqual(after.slots.map((s) => [s.status, s.giftKind]), [['cancelled', 'gift'], ['pending_confirm', 'gift']]);
  });
});

describe('三個入口存同一種選法 → 時段的每一格一模一樣', () => {
  test('功醫門診、體驗、10:00：拍 Abovee 交出去的與壓表／編輯器交出去的是同一支、同一個結果', () => {
    const fromAbovee = { ...read('功醫門診', '客戶A', ''), doctorId: 'staff-dr-xia' };
    const viaPhoto = slotFromPicks(picksOf(fromAbovee), slotCtx()).slot;
    // 壓表 `addSlot()` 與編輯器 `readFreeSlot()` 交給 `slotFromPicks()` 的那幾格
    const viaHand = slotFromPicks({
      giftCourseId: 'course-fm', giftKind: 'trial', startsAt: '10:00', doctorId: 'staff-dr-xia',
      minutes: null, note: null,
    }, slotCtx()).slot;
    assert.deepEqual(viaPhoto, viaHand);
  });

  const src = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

  test('壓表：交給 slotFromPicks() 時帶著 giftKind；換課程時清掉；器材與分鐘那一排問 domain', () => {
    const s = src('ui/views/schedule.js');
    assert.match(s, /giftKind: pickedGiftKind\(picked\)/);
    assert.match(s, /function resetCourseBoundPicks\(\)[\s\S]{0,600}giftKind: null/);
    assert.match(s, /equipmentChoicesFor\(/);
    assert.match(s, /minuteChoicesFor\(/);
    assert.ok(!/bookingMinutesOf\(effectiveCourse/.test(s), '排多久那一排不可以只看 bookingMinutes');
  });

  test('來訪編輯器：readFreeSlot() 帶著原本的 giftKind；一般那一條清掉；器材與分鐘那一排問 domain', () => {
    const s = src('ui/views/visitEditor.js');
    assert.match(s, /function readFreeSlot[\s\S]{0,2500}slotFromPicks\(\{\s*\n\s*giftCourseId: courseId,\s*\n\s*giftKind,/);
    // 兩格都有值的壞資料照額度畫 —— 照送的畫的話只改一個字存回去，那一筆額度就被安靜地拿掉
    assert.match(s, /const giftOf = \(slot, all\) => \(isNthSlot\(slot\) \|\| slot\?\.entitlementId/);
    assert.match(s, /followupNth: null,\s*\n\s*\/\/[^\n]*\n[\s\S]{0,400}giftKind: null/);
    assert.match(s, /equipmentChoicesFor\(/);
    assert.match(s, /minuteChoicesFor\(/);
  });

  test('拍 Abovee 的確認層：器材那一排不再只給擇一池、排多久那一排問 minuteChoicesFor()', () => {
    const s = src('ui/components/aboveeConfirm.js');
    assert.match(s, /equipmentChoicesFor\(/);
    assert.match(s, /minuteChoicesFor\(/);
    assert.ok(!/ent\?\.type === 'pool'\) \{\s*\n\s*rows\.push\(chipRow\('器材'/.test(s));
  });
});
