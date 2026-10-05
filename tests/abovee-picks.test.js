// 拍 Abovee 的確認層：每一列都能換人、選要做什麼（abovee-and-master-2026-10-05/08，ADR-0123）。
//
// **這一支有沒有任何一條路，讓她在這一層按的那一顆跟壓表按同一顆存出不一樣的一段？** —— 沒有：
// 兩邊都是 `slotOptionsFor()` 那一排、都走 `slotFromPicks()`；翻譯時先按好的那一顆與她自己按的
// 走同一支 `pickOption()`。例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { optionValueOf, pickOption, picksOf, planAbovee, readAbovee } from '../public/js/domain/aboveeImport.js';
import { NTH_PICK, slotOptionsFor, uncountedPick } from '../public/js/domain/slotOptions.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { readFileSync } from 'node:fs';
import { searchCustomers, nameHas } from '../public/js/domain/customers.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const FM = { id: 'course-fm', name: '功醫門診', durationMin: 30, assigns: 'none', doctorPick: 'any', uncounted: true, aboveeNames: ['功醫門診'] };
const COURSES = [...SEED.courses, FM];
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const CUSTOMERS = [
  { id: 'c-wang', name: '王小明', marks: chart('1234') },
  { id: 'c-a', name: '客戶A', marks: [] },
  { id: 'c-wang2', name: '王 小美', marks: [] },
  { id: 'c-gone', name: '王小強', marks: [], deletedAt: '2026-09-01' },
  { id: 'c-off', name: '王小傑', marks: [], active: false },
];
const ENTS = {
  'c-wang': [
    { id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 },
    { id: 'w-exam', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 1, doneCount: 1 },
    { id: 'w-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 1, followupForEntitlementId: 'w-exam' },
    { id: 'w-gut', type: 'single', label: '營養點滴・腸道修復', courseId: 'course-iv-drip', ivProductId: 'iv-gut', totalQty: 5 },
  ],
  'c-a': [],
};
const EXAM = { id: 'v-exam', customerId: 'c-wang', date: '2026-08-20', status: 'done',
  slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'done' }] };
const ctx = (over = {}) => ({
  customers: CUSTOMERS,
  entitlementsBy: ENTS,
  visitsBy: { 'c-wang': [EXAM] },
  master: { courses: COURSES, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today: '2026-09-01',
  ...over,
});
const LEFT = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const read = (course, name = '王小明', chartNo = '00001234') =>
  readAbovee([{ columns: LEFT, rows: [['確認前往', '2026-09-10', '09:00 - 10:15', name, chartNo, course]] }], ctx()).items[0];

describe('「要做什麼」那一排跟壓表同一份', () => {
  test('額度（用完的也列、二返排最後）、＋n返、不算次數的課', () => {
    const options = slotOptionsFor({
      entitlements: ENTS['c-wang'], visits: [EXAM], courses: COURSES, equipment: SEED.equipment,
    }, { includeUsedUp: true });
    const ids = options.map((o) => o.entitlementId);
    assert.ok(ids.includes('w-exam'), '用完的健檢也列（Abovee 上已經約了）');
    assert.ok(ids.indexOf('w-fu') > ids.indexOf('w-pool') && ids.indexOf('w-fu') > ids.indexOf('w-exam'), '二返排在額度最後');
    assert.ok(ids.includes(NTH_PICK));
    assert.ok(ids.includes(uncountedPick('course-fm')));
  });

  test('翻譯時先按好的那一顆，就是那一排上的值（optionValueOf）', () => {
    assert.equal(optionValueOf(read('SIS 60')), 'w-pool');
    assert.equal(optionValueOf(read('三返30')), NTH_PICK);
    assert.equal(optionValueOf(read('功醫門診', '客戶A', '')), uncountedPick('course-fm'));
    assert.equal(optionValueOf(read('XYZ 60')), null);
  });
});

describe('按一顆 → 這一列變成什麼（pickOption）', () => {
  test('認不出課程的一列：選了復能池 → 照片上沒有那一台，器材留給她選；記得進去', () => {
    const item = read('XYZ 60');
    assert.equal(item.entitlementId, null);
    const next = pickOption(item, 'w-pool', ctx());
    assert.deepEqual([next.entitlementId, next.equipmentId, next.isNth, next.uncountedCourseId], ['w-pool', null, false, null]);
    const picked = { ...pickOption(item, 'w-pool', ctx()), equipmentId: 'eq-sis' };
    const { groups, problems } = planAbovee([picked], ctx());
    assert.deepEqual(problems, {});
    assert.equal(groups[0].visit.slots[0].equipmentId, 'eq-sis');
  });

  test('照片上是 SIS 60、她換成復能池 → 那一台照片上的先選好', () => {
    assert.equal(pickOption(read('SIS 60'), 'w-pool', ctx()).equipmentId, 'eq-sis');
  });

  test('＋n返：預選三返、照片上寫四返就是四返；接哪一次健檢不替她選', () => {
    const fromSis = pickOption(read('SIS 60'), NTH_PICK, ctx());
    assert.deepEqual([fromSis.isNth, fromSis.nth, fromSis.entitlementId, fromSis.followupForVisitId], [true, 3, null, null]);
    assert.equal(pickOption(read('四返'), NTH_PICK, ctx()).nth, 4);
  });

  test('不算次數的那一顆 → 沒有額度、課程是那一門', () => {
    const next = pickOption(read('SIS 60'), uncountedPick('course-fm'), ctx());
    assert.deepEqual([next.entitlementId, next.uncountedCourseId, next.isNth], [null, 'course-fm', false]);
    const slot = slotFromPicks(picksOf(next), {
      courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts, entitlements: ENTS['c-wang'], visits: [EXAM],
    }).slot;
    assert.deepEqual([slot.courseId, slot.entitlementId], ['course-fm', null]);
  });

  test('從 n返 換回一筆額度：返數清乾淨（不然那一段會同時帶著額度與返數）', () => {
    const nth = pickOption(read('三返30'), NTH_PICK, ctx());
    const back = pickOption(nth, 'w-fu', ctx());
    assert.deepEqual([back.isNth, back.nth, back.entitlementId], [false, null, 'w-fu']);
    assert.equal(picksOf(back).isNth, false);
    assert.equal(picksOf(back).nth, null);
  });

  test('品項：照片上寫的那一款優先，換到買了別款的那一筆也不被蓋掉', () => {
    const item = read('護肝排毒');
    assert.equal(item.ivProductId, 'iv-liver');
    assert.equal(pickOption(item, 'w-gut', ctx()).ivProductId, 'iv-liver');
  });

  test('二返：只有一次做完的健檢 → 那一次先選好', () => {
    assert.equal(pickOption(read('SIS 60'), 'w-fu', ctx()).followupForVisitId, 'v-exam');
  });

  test('照片上的時長、診間、治療師不跟著這一排動', () => {
    const item = { ...read('二返60'), therapistId: 'staff-zn', roomId: 'room-t5' };
    const next = pickOption(item, uncountedPick('course-fm'), ctx());
    assert.deepEqual([next.minutes, next.therapistId, next.roomId], [60, 'staff-zn', 'room-t5']);
  });
});

describe('課程推得出來、卡在後面那一道時，slotFromPicks 照樣交回課程', () => {
  test('n返 還沒選接哪一次健檢：course 是二返那一門、assigns 照課程（畫醫師那一排要它）', () => {
    const { slot, errors, course, assigns } = slotFromPicks({ isNth: true, nth: 3, startsAt: '09:00' }, {
      courses: COURSES, equipment: SEED.equipment, entitlements: ENTS['c-wang'], visits: [EXAM],
    });
    assert.equal(slot, null);
    assert.match(errors[0], /哪一次健檢/);
    assert.equal(course?.id, 'course-followup');
    assert.equal(assigns, 'none');
  });

  test('連課程都推不出來：照舊 null', () => {
    const r = slotFromPicks({ startsAt: '09:00' }, { courses: COURSES, equipment: SEED.equipment });
    assert.deepEqual([r.slot, r.course, r.assigns, r.errors], [null, null, null, ['先選要做什麼']]);
  });
});

describe('換一位：打幾個字找客戶（searchCustomers）', () => {
  test('名字含那幾個字、空白與全形半形不算、停用與刪掉的不列', () => {
    assert.deepEqual(searchCustomers(CUSTOMERS, '王小').map((c) => c.id), ['c-wang', 'c-wang2']);
    assert.deepEqual(searchCustomers(CUSTOMERS, '小美').map((c) => c.id), ['c-wang2']);
  });

  test('一個字都沒打 → 空的（不是全部）；上限', () => {
    assert.deepEqual(searchCustomers(CUSTOMERS, '  '), []);
    assert.equal(searchCustomers(CUSTOMERS, '王', { limit: 1 }).length, 1);
  });
});

// 她 2026-10-05：「好 ! 可以修改」（issue 17）—— 日曆新增的「要幫誰排？」與批次取消以前各自
// `String(c.name).includes(q)`：名字中間有空白、打全形英數字就找不到，而拍 Abovee 的「換一位」找得到。
describe('找人只有一種比法（nameHas）', () => {
  test('空白、全形半形、大小寫都不算；一個字都沒打就是每一位', () => {
    assert.equal(nameHas('王 小明', '王小明'), true);
    assert.equal(nameHas('王小明', '王 小'), true);
    assert.equal(nameHas('客戶A', '客戶Ａ'), true);
    assert.equal(nameHas('客戶A', 'a'), true);
    assert.equal(nameHas('王小明', '李'), false);
    assert.equal(nameHas('王小明', ''), true);
    assert.equal(nameHas('王小明', '   '), true);
    assert.equal(nameHas(null, '王'), false);
  });

  test('searchCustomers() 用的就是它', () => {
    assert.deepEqual(searchCustomers(CUSTOMERS, '王　小 明').map((c) => c.id), ['c-wang']);
  });

  test('日曆新增與批次取消都呼叫它，不自己比', () => {
    for (const file of ['calendar.js', 'bulkCancel.js']) {
      const src = readFileSync(new URL(`../public/js/ui/views/${file}`, import.meta.url), 'utf8');
      assert.match(src, /nameHas\(c\.name, q\)/, `${file} 要走 nameHas()`);
      assert.doesNotMatch(src, /String\(c\.name[^)]*\)\.includes\(q\)/, `${file} 還有一份自己寫的比法`);
    }
  });
});

describe('存檔前那一道：n返 與不算次數的課講一句（同壓表）', () => {
  test('三返講「加約的」、功醫門診講「不算次數」；扣著額度的段不講', () => {
    const items = [
      { ...pickOption(read('三返30'), NTH_PICK, ctx()), followupForVisitId: 'v-exam', checked: true },
      { ...read('功醫門診', '客戶A', ''), checked: true },
      { ...read('SIS 60'), date: '2026-09-11', checked: true },
    ];
    const { groups, problems } = planAbovee(items, ctx());
    assert.deepEqual(problems, {});
    const { lines } = aboveeConsequences({
      groups, coursesById: Object.fromEntries(COURSES.map((c) => [c.id, c])), today: '2026-09-01',
    });
    assert.ok(lines.includes('三返是加約的 —— 這一場不扣任何次數，客戶身上的數字一個都不會變'), lines.join('\n'));
    assert.ok(lines.includes('功醫門診不算次數 —— 客戶身上的數字一個都不會變'), lines.join('\n'));
    assert.equal(lines.filter((l) => l.includes('不算次數')).length, 1);
  });

  test('併進那一天原本就有的三返不算這一次的事', () => {
    const old = { id: 'v-old', customerId: 'c-wang', date: '2026-09-10', status: 'pending_confirm',
      slots: [{ entitlementId: null, courseId: 'course-followup', followupNth: 3, followupForVisitId: 'v-exam', startsAt: '08:00', endsAt: '08:30', status: 'pending_confirm' }] };
    const c = ctx({ visitsBy: { 'c-wang': [EXAM, old] } });
    const item = { ...readAbovee([{ columns: LEFT, rows: [['確認前往', '2026-09-10', '09:00', '王小明', '1234', 'SIS 60']] }], c).items[0], checked: true };
    const { groups } = planAbovee([item], c);
    const { lines } = aboveeConsequences({ groups, coursesById: Object.fromEntries(COURSES.map((x) => [x.id, x])), today: '2026-09-01' });
    assert.equal(lines.some((l) => l.includes('三返')), false, lines.join('\n'));
  });
});
