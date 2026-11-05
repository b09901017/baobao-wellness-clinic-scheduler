// 一次性客人：拍 Abovee（2026-11-05，ADR-0172，`.scratch/one-time-guests/issues/07`）。
//
// 第 4 題：照片上「app 裡沒有」的那一列多一顆「記成一次性客人」（她按了才建，不靠預約來源猜），之後勾得起來、照照片填。
// 第 5 題：「換一位」的搜尋結果標「一次性」（畫面，E2E `96`）。
// 這一支釘 domain：一次性客人那一列組出來的段、二返先接他的一次性健檢、轉成客戶之後的那一顆、換一位不殘留、建好之後同名的別列跟著認得。
//
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';
import {
  readAbovee, resolveItem, optionValueOf, pickOption, picksOf, planAbovee, newRowSay, photoDayPlan, refreshNoExam,
  recordGuestOnPhoto, guestExamChoices,
} from '../public/js/domain/aboveeImport.js';
import { NTH_PICK, NOT_MINE_PICK, ONE_TIME_SECOND_PICK, guestPick } from '../public/js/domain/slotOptions.js';
import { isOneTimeSlot, EXAM_NOT_MINE_LABEL } from '../public/js/domain/masterData.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { oneTimeCustomer } from '../public/js/domain/customers.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const MASTER = { courses: COURSES, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));

const guestSlot = (over = {}) => ({
  entitlementId: null, giftKind: null, oneTime: true, courseId: 'course-checkup', courseName: '健檢',
  startsAt: '09:00', endsAt: '11:00', status: 'done', ...over,
});

const CUSTOMERS = [
  { id: 'g-a', name: '客戶A', marks: [], oneTime: true }, // 一次性客人：做完一次一次性健檢
  { id: 'g-b', name: '客戶B', marks: [], oneTime: true }, // 一次性客人：健檢不在 app 裡
  { id: 'n-c', name: '客戶C', marks: [] }, // 一般客戶：有一對真的健檢＋二返
  { id: 'v-d', name: '客戶D', marks: [], oneTime: false }, // 轉成我的客戶了：一次性那一次還欠一場二返
];
const C_ENTS = [
  { id: 'c-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1 },
  { id: 'c-fu', type: 'single', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'c-exam', totalQty: 1 },
];
const A_EXAM = { id: 'v-a-exam', customerId: 'g-a', customerName: '客戶A', date: '2026-08-20', status: 'done', slots: [guestSlot()] };
const D_EXAM = { id: 'v-d-exam', customerId: 'v-d', customerName: '客戶D', date: '2026-08-21', status: 'done', slots: [guestSlot()] };
const C_EXAM = {
  id: 'v-c-exam', customerId: 'n-c', customerName: '客戶C', date: '2026-08-22', status: 'done',
  slots: [{ entitlementId: 'c-exam', courseId: 'course-checkup', courseName: '健檢', startsAt: '09:00', endsAt: '11:00', status: 'done' }],
};

const ctx = (over = {}) => ({
  customers: CUSTOMERS,
  entitlementsBy: { 'g-a': [], 'g-b': [], 'n-c': C_ENTS, 'v-d': [] },
  visitsBy: { 'g-a': [A_EXAM], 'g-b': [], 'n-c': [C_EXAM], 'v-d': [D_EXAM] },
  master: MASTER,
  today: '2026-09-01',
  ...over,
});

const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '預約來源'];
/** 照片上一列（確認前往、還沒到 —— 照片那一條是「勾」）。 */
const row = (name, course, { date = '2026-09-10', time = '10:00 - 10:30', source = '正式課', chartNo = '' } = {}) =>
  ['確認前往', date, time, name, chartNo, course, source];
const readRows = (rows, c = ctx()) => readAbovee([{ columns: COLS, rows }], c).items;
const read = (name, course, c = ctx(), o = {}) => readRows([row(name, course, o)], c)[0];
/** 存的那一下組出來的那幾段（`planAbovee()`，跟確認層畫列同一支 `picksOf()`）。 */
const plannedSlots = (items, c = ctx()) => planAbovee(items.map((i) => ({ ...i, checked: true })), c)
  .groups.flatMap((g) => g.visit.slots.slice(-g.items.length));

describe('一次性客人那一列：課程照照片、組一次性的段', () => {
  test('健檢 → 新的、照照片勾、那一排按著「健檢」那一顆；組出來的段一次性、不扣', () => {
    const item = read('客戶A', '健檢');
    assert.equal(item.kind, 'new');
    assert.equal(item.checked, true);
    assert.equal(optionValueOf(item), guestPick('course-checkup'));
    assert.equal(picksOf(item).oneTime, true);
    const [slot] = plannedSlots([item]);
    assert.equal(isOneTimeSlot(slot), true);
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.giftKind, null);
    assert.equal(slot.courseId, 'course-checkup');
  });

  test('照片寫體驗：一次性客人不走體驗那條路（他本來就不扣）', () => {
    const item = read('客戶A', '健檢', ctx(), { source: '體驗' });
    assert.equal(item.giftCourseId, null);
    assert.equal(optionValueOf(item), guestPick('course-checkup'));
    const [slot] = plannedSlots([item]);
    assert.equal(slot.giftKind, null);
    assert.equal(isOneTimeSlot(slot), true);
  });

  test('課程那一格認不出來 → 一顆都不按（不猜）', () => {
    const item = read('客戶A', '看不懂的字');
    assert.equal(optionValueOf(item), null);
  });

  test('確認框：一次性的段不進任何一個「扣 N 次」', () => {
    const item = read('客戶A', '健檢');
    const plan = photoDayPlan([item], ctx());
    const { lines } = aboveeConsequences({
      plan, coursesById, entitlementsBy: ctx().entitlementsBy, visitsBy: ctx().visitsBy, today: ctx().today,
    });
    assert.ok(!lines.some((l) => /扣/.test(l)), lines.join('\n'));
  });

  test('合併扣課：一次性的段不扣，跟送的／體驗一樣不合成一段、不標「找不到另一半」', () => {
    const cols = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程', '合併扣課'];
    const rows = [
      ['確認前往', '2026-09-10', '10:00 - 10:30', '客戶A', '', 'IN 30', '是'],
      ['確認前往', '2026-09-10', '10:30 - 11:00', '客戶A', '', 'SIS 30', '是'],
      ['確認前往', '2026-09-11', '10:00 - 10:30', '客戶A', '', 'IN 30', '是'],
    ];
    const items = readAbovee([{ columns: cols, rows }], ctx()).items;
    assert.equal(items.length, 3, '沒有合成一段');
    assert.ok(items.every((i) => !i.merged && !i.mergeOrphan));
  });

  test('「健檢不是我排的」：交出去的也標一次性', () => {
    const item = { ...pickOption(read('客戶B', '二返'), NOT_MINE_PICK, ctx()), checked: true };
    assert.equal(picksOf(item).oneTime, true);
    const [slot] = plannedSlots([item]);
    assert.equal(isOneTimeSlot(slot), true);
    assert.equal(slot.examNotMine, true);
  });
});

describe('一次性客人的二返：先接他的一次性健檢', () => {
  test('他有一次性健檢 → 先接好、照照片勾', () => {
    const item = read('客戶A', '二返');
    assert.equal(optionValueOf(item), guestPick('course-followup'));
    assert.equal(item.followupForVisitId, 'v-a-exam');
    assert.equal(item.checked, true);
    assert.equal(item.notMineHint, null);
    const [slot] = plannedSlots([item]);
    assert.equal(isOneTimeSlot(slot), true);
    assert.equal(slot.followupForVisitId, 'v-a-exam');
  });

  test('接不上（健檢不在 app 裡）→ 不勾、講一句指她去「健檢不是我排的」，不替她按', () => {
    const item = read('客戶B', '二返');
    assert.equal(item.checked, false);
    assert.equal(item.notMine, false);
    assert.equal(item.followupForVisitId, null);
    assert.deepEqual(item.notMineHint, { nth: 2, offered: true, guest: true });
    const say = newRowSay(item);
    assert.match(say, /一次性/);
    assert.ok(say.includes(EXAM_NOT_MINE_LABEL), say);
  });

  test('同一張照片上的一次性健檢也算（還沒存的那一次）', () => {
    const items = readRows([row('客戶B', '健檢', { date: '2026-09-03' }), row('客戶B', '二返', { date: '2026-09-10' })]);
    const second = items[1];
    assert.equal(second.followupForVisitId, 'abovee:g-b|2026-09-03');
    assert.equal(second.notMineHint, null);
    assert.equal(second.checked, true);
  });

  test('拿掉照片上那一次健檢的勾 → 二返那一列那一句跟著出來（只動旗標）', () => {
    const items = readRows([row('客戶B', '健檢', { date: '2026-09-03' }), row('客戶B', '二返', { date: '2026-09-10' })]);
    const off = [{ ...items[0], checked: false }, { ...items[1], followupForVisitId: null }];
    const after = refreshNoExam(off, ctx());
    assert.deepEqual(after[1].notMineHint, { nth: 2, offered: true, guest: true });
    assert.equal(after[1].checked, items[1].checked, '勾不勾是她的');
  });

  test('guestExamChoices：只列一次性的健檢，一般客戶回空的', () => {
    assert.deepEqual(guestExamChoices('g-a', 'course-followup', ctx()).map((x) => x.visitId), ['v-a-exam']);
    assert.deepEqual(guestExamChoices('n-c', 'course-followup', ctx()), []);
  });

  test('三返：有一次性健檢 → 按好 n返、組出來的段一次性；沒有 → 不按、講一句', () => {
    const a = read('客戶A', '三返');
    assert.equal(optionValueOf(a), NTH_PICK);
    const [slot] = plannedSlots([{ ...a, followupForVisitId: 'v-a-exam' }]);
    assert.equal(isOneTimeSlot(slot), true);
    const b = read('客戶B', '三返');
    assert.equal(optionValueOf(b), null);
    assert.deepEqual(b.notMineHint, { nth: 3, offered: true, guest: true });
    assert.equal(b.checked, false);
  });
});

describe('轉成我的客戶之後：「二返（一次性那一次）」', () => {
  test('身上沒有真的二返額度 → 預選那一顆、接回一次性那一次、段標一次性', () => {
    const item = read('客戶D', '二返');
    assert.equal(optionValueOf(item), ONE_TIME_SECOND_PICK);
    assert.equal(item.followupForVisitId, 'v-d-exam');
    assert.equal(item.notMineHint, null);
    const [slot] = plannedSlots([item]);
    assert.equal(isOneTimeSlot(slot), true);
    assert.equal(slot.entitlementId, null);
  });

  test('也買了真的二返額度 → 拿不準扣哪一個：不替她選、不勾、講一句', () => {
    const ents = [
      { id: 'd-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1 },
      { id: 'd-fu', type: 'single', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'd-exam', totalQty: 1 },
    ];
    const c = ctx({ entitlementsBy: { ...ctx().entitlementsBy, 'v-d': ents } });
    const item = read('客戶D', '二返', c);
    assert.equal(optionValueOf(item), null);
    assert.equal(item.checked, false);
    assert.match(newRowSay(item), /一次性那一次/);
  });

  test('她自己按那一顆 → 一樣接回一次性那一次', () => {
    const item = pickOption(read('客戶D', '健檢'), ONE_TIME_SECOND_PICK, ctx());
    assert.equal(optionValueOf(item), ONE_TIME_SECOND_PICK);
    assert.equal(item.followupForVisitId, 'v-d-exam');
  });
});

describe('一般客戶一個字都不變', () => {
  test('二返：預選真的二返額度、接真的健檢、不標一次性', () => {
    const item = read('客戶C', '二返');
    assert.equal(optionValueOf(item), 'c-fu');
    assert.equal(item.followupForVisitId, 'v-c-exam');
    assert.equal(picksOf(item).oneTime, false);
    const [slot] = plannedSlots([item]);
    assert.equal('oneTime' in slot, false, '一般的段沒有這一格');
  });

  test('寫體驗的課照舊是體驗', () => {
    const item = read('客戶C', '心臟科評估', ctx(), { source: '體驗' });
    assert.equal(item.guestCourseId, null);
    assert.ok(item.giftCourseId, '照舊走送的／體驗那一條');
  });
});

describe('換一位：一般 ⇄ 一次性不殘留', () => {
  test('一次性 → 一般：一次性那一顆、接的那一次清掉，換成他的額度', () => {
    const guest = read('客戶A', '二返');
    const normal = resolveItem(guest, 'n-c', ctx());
    assert.equal(normal.guestCourseId, null);
    assert.equal(normal.guest, false);
    assert.equal(optionValueOf(normal), 'c-fu');
    assert.equal(normal.followupForVisitId, 'v-c-exam');
    assert.equal(picksOf(normal).oneTime, false);
  });

  test('一般 → 一次性：額度清掉，換成一次性那一顆、接他的一次性健檢', () => {
    const normal = read('客戶C', '二返');
    const guest = resolveItem(normal, 'g-a', ctx());
    assert.equal(guest.entitlementId, null);
    assert.equal(optionValueOf(guest), guestPick('course-followup'));
    assert.equal(guest.followupForVisitId, 'v-a-exam');
  });

  test('一次性 → 轉成我的客戶那一位（有欠的那一場）→ 那一顆換成「二返（一次性那一次）」', () => {
    const guest = read('客戶A', '二返');
    const converted = resolveItem(guest, 'v-d', ctx());
    assert.equal(optionValueOf(converted), ONE_TIME_SECOND_PICK);
    assert.equal(converted.followupForVisitId, 'v-d-exam');
  });
});

describe('「記成一次性客人」：她按了才建，建好之後那一列重認一次', () => {
  const NEW = { id: 'g-new', ...oneTimeCustomer({ name: '客戶E', chartNo: '00000777' }), active: true };

  test('沒按 → 認不得、勾不起來（不替她建）', () => {
    const item = read('客戶E', '健檢');
    assert.equal(item.kind, 'unknown');
    assert.equal(item.checked, false);
    assert.equal(item.who.how, 'none');
  });

  test('建好 → 那一列變成新的、照照片勾；同一張照片上同一個名字的別列跟著認得；別人的不動', () => {
    const items = readRows([
      row('客戶E', '健檢', { date: '2026-09-03', chartNo: '00000777' }),
      row('客戶E', '二返', { date: '2026-09-10' }),
      row('客戶F', '健檢', { date: '2026-09-04' }),
    ]);
    assert.deepEqual(items.map((i) => i.kind), ['unknown', 'unknown', 'unknown']);
    const c = ctx({ customers: [...CUSTOMERS, NEW], entitlementsBy: { ...ctx().entitlementsBy, 'g-new': [] }, visitsBy: { ...ctx().visitsBy, 'g-new': [] } });
    const after = recordGuestOnPhoto(items, NEW, c);
    assert.equal(after[0].kind, 'new');
    assert.equal(after[0].customerId, 'g-new');
    assert.equal(after[0].checked, true, '照照片勾（認人認出的是他，不是她手選的）');
    assert.equal(after[1].customerId, 'g-new');
    assert.equal(after[1].followupForVisitId, 'abovee:g-new|2026-09-03', '二返接同一張照片上他的健檢');
    assert.equal(after[2].kind, 'unknown', '別人的那一列照舊');
    const slots = plannedSlots(after.slice(0, 2), c);
    assert.ok(slots.every(isOneTimeSlot));
  });

  test('下一張照片上有同一位 → 直接認得', () => {
    const c = ctx({ customers: [...CUSTOMERS, NEW], entitlementsBy: { ...ctx().entitlementsBy, 'g-new': [] }, visitsBy: { ...ctx().visitsBy, 'g-new': [] } });
    const item = read('客戶E', '健檢', c, { chartNo: '00000777' });
    assert.equal(item.kind, 'new');
    assert.equal(item.customerId, 'g-new');
  });
});

describe('原始碼：確認層接對了沒', () => {
  const src = readFileSync(fromRoot('public/js/ui/components/aboveeConfirm.js'), 'utf8').replace(/\r\n/g, '\n');

  test('「記成一次性客人」走名字卡的快速表單與建客戶同一條寫入（帶 key）', () => {
    assert.match(src, /mountGuestForm\(/);
    assert.match(src, /quick: true/);
    assert.match(src, /createWithPlan\(oneTimeCustomer\(card\), \{ plan: null, quantity: 0, extras: \[\] \}\)/);
    assert.match(src, /key: 'customer:create-guest', undoable: false/, '不給復原：那幾列已經指著他了');
    assert.match(src, /recordGuestOnPhoto\(/);
  });

  test('一次性客人那一排是 guestOptions()、畫法 coursesHtml()', () => {
    assert.match(src, /guestOptions\(/);
    assert.match(src, /giftFold\.coursesHtml\(/);
  });

  test('換一位與「是誰」標「一次性」（.guestmark）', () => {
    assert.match(src, /guestmark/);
  });

  test('認不得那一句講兩條路', () => {
    assert.match(src, /none: '[^']*記成一次性客人[^']*'/);
  });
});
