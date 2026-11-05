// 一次性客人 —— 段五審查的修正（2026-11-05，`.scratch/one-time-guests/REVIEW.md`、issues/09）。
//
// 整輪的判準（ADR-0172）：這一行會不會讓一位一般客戶或一段沒有標記的段被放寬、被藏起來，
// 或讓一次性的段被算進任何一筆真的額度、出現在試算表上？
// 每一條釘一個審查抓到的形狀；編號照 REVIEW.md。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { fromRoot } from './helpers/paths.js';

import { sameNameCustomers, blockersOf, addOnTarget, guestSameNameSay } from '../public/js/domain/orderForm.js';
import { offersNewGuest, GUEST_SAME_NAME } from '../public/js/domain/customers.js';
import { validateVisit } from '../public/js/domain/visits.js';
import { followupGoesToCalendar } from '../public/js/domain/nthFollowup.js';
import { toMyCustomerConsequences, bookingConsequences, aboveeConsequences } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));
const src = (p) => readFileSync(fromRoot(p), 'utf8');

const GUEST = { id: 'g1', name: '客戶A', oneTime: true, flags: [] };
const MINE = { id: 'c1', name: '客戶A', flags: [] };

// ---------- R1：拍訂購單 ----------

describe('R1 拍訂購單：同名的一次性客人不是「加購到那一位」', () => {
  const card = (over = {}) => ({ draft: { name: '客戶A', planId: null, quantity: '' }, unresolved: [], nameOk: false, who: null, ...over });

  test('sameNameCustomers() 不收一次性客人', () => {
    assert.deepEqual(sameNameCustomers('客戶A', [GUEST]), []);
    assert.deepEqual(sameNameCustomers('客戶A', [GUEST, MINE]).map((c) => c.id), ['c1']);
  });

  test('只有一位同名的一次性客人 → 照「沒有同名」：要點「名字對」、加購對象是 null（新增一位）', () => {
    assert.deepEqual(blockersOf(card(), [GUEST]), ['名字要對過照片：點「名字對」']);
    assert.deepEqual(blockersOf(card({ nameOk: true }), [GUEST]), []);
    // 就算卡上殘留那一位的 id，也加購不到他身上
    assert.equal(addOnTarget(card({ who: 'g1' }), [GUEST]), null);
  });

  test('一般客戶照舊：同名的那一位還是加購對象（一個字都沒變）', () => {
    assert.match(blockersOf(card(), [MINE])[0], /已經有 1 位/);
    assert.equal(addOnTarget(card({ who: 'c1' }), [MINE])?.id, 'c1');
  });

  test('卡上名字旁邊講 GUEST_SAME_NAME（拍訂購單那一層自己畫，跟新增客戶同一句）', () => {
    assert.equal(guestSameNameSay('客戶A', [GUEST]), GUEST_SAME_NAME);
    assert.equal(guestSameNameSay('客戶A', [MINE]), null);
    assert.equal(guestSameNameSay('客戶A', [{ ...GUEST, deletedAt: '2026-11-01T00:00:00Z' }]), null);
    assert.match(src('public/js/ui/components/orderConfirm.js'), /guestSameNameSay\(name, known\)/);
  });
});

// ---------- R2：存檔驗證 ----------

describe('R2 一次性客人身上任何一段沒標一次性就擋（有額度也一樣）', () => {
  const ENT = { id: 'ent-r', customerId: 'g1', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 1 };
  const slot = (over = {}) => ({
    entitlementId: 'ent-r', courseId: 'course-checkup', courseName: '健檢', equipmentId: null, ivProductId: null,
    startsAt: '09:00', endsAt: '11:00', minutes: null, roomId: null, bed: null, therapistId: null, doctorId: null,
    followupForVisitId: null, attended: null, giftKind: null, note: null, status: 'pending_confirm', ...over,
  });
  const ctx = (customer) => ({
    customer, courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts, rooms: SEED.rooms, staff: SEED.staff,
    entitlements: [{ ...ENT, customerId: customer.id }], customerVisits: [],
  });
  const visit = (customer, s) => ({ id: 'v1', customerId: customer.id, customerName: '客戶A', date: '2026-11-20', status: 'pending_confirm', slots: [s] });

  test('一次性客人＋扣真的額度、沒標一次性 → 擋', () => {
    const { errors } = validateVisit(visit(GUEST, slot()), ctx(GUEST));
    assert.ok(errors.some((e) => e.includes('一次性客人的段要標成一次性')), errors.join('\n'));
  });

  test('一般客戶（含轉過來的 oneTime: false）同一段 → 不擋那一句', () => {
    for (const c of [MINE, { ...MINE, oneTime: false }]) {
      const { errors } = validateVisit(visit(c, slot()), ctx(c));
      assert.ok(!errors.some((e) => e.includes('一次性客人的段要標成一次性')), errors.join('\n'));
    }
  });

  test('來訪編輯器對一次性客人永遠不拿額度當預設（blankVisit()／withNewSlot()）', () => {
    const s = src('public/js/ui/views/visitEditor.js');
    const body = (name) => s.slice(s.indexOf(`function ${name}(`), s.indexOf('\n}\n', s.indexOf(`function ${name}(`)));
    for (const fn of ['blankVisit', 'withNewSlot']) {
      assert.match(body(fn), /guest \? undefined : entitlements\[0\]/, `${fn}：一次性客人不拿 entitlements[0]`);
    }
  });
});

// ---------- R3：「約二返」去哪裡排 ----------

describe('R3 約二返：接的那一次是一次性的健檢 → 去日曆排', () => {
  const ot = (over = {}) => ({
    entitlementId: null, courseId: 'course-checkup', courseName: '健檢', startsAt: '09:00', endsAt: '11:00',
    status: 'done', attended: true, giftKind: null, oneTime: true, ...over,
  });
  const exam = (slots) => ({ id: 'e1', customerId: 'g1', date: '2026-10-03', status: 'done', slots });
  const REAL = [
    { id: 'ent-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', totalQty: 3 },
    { id: 'ent-2nd', type: 'single', label: '二返', courseId: 'course-followup', followupForEntitlementId: 'ent-exam', totalQty: 3 },
  ];

  test('還是一次性客人 → 日曆', () => {
    assert.equal(followupGoesToCalendar(GUEST, exam([ot()]), [], coursesById), true);
  });

  test('轉成我的客戶、接的是他當一次性客人時的健檢 → 日曆（壓表那一批沒有他）', () => {
    assert.equal(followupGoesToCalendar({ ...MINE, oneTime: false }, exam([ot()]), REAL, coursesById), true);
  });

  test('一般客戶、一般的健檢 → 壓表（一個字都沒變）', () => {
    const { oneTime, ...plain } = ot({ entitlementId: 'ent-exam' });
    assert.equal(followupGoesToCalendar(MINE, exam([plain]), REAL, coursesById), false);
    assert.equal(followupGoesToCalendar(MINE, null, REAL, coursesById), false);
  });

  test('home.js 的按鈕與換字共用那一支', () => {
    const s = src('public/js/ui/views/home.js');
    assert.ok((s.match(/followupGoesToCalendar\(/g) ?? []).length >= 2, 'bookFollowup() 與 labelGuestBookings() 都問它');
  });
});

// ---------- R4、R7：沒有復原 ----------

describe('R4、R7 建名字卡、轉成我的客戶：沒有復原', () => {
  const near = (file, marker) => {
    const s = src(file);
    const at = s.indexOf(marker);
    assert.ok(at > 0, `${file} 找不到 ${marker}`);
    return s.slice(at, at + 1500);
  };
  test('日曆新增 newGuest()', () => {
    assert.match(near('public/js/ui/views/calendar.js', 'function newGuest('), /undoable: false/);
  });
  test('客戶詳情 convertToMine()', () => {
    assert.match(near('public/js/ui/views/customerDetail.js', 'function convertToMine('), /undoable: false/);
  });
});

// ---------- R5：擋下來那一句講怎麼辦 ----------

describe('R5 以前的一次性段按真的額度／送的：擋法不變、句子講怎麼辦', () => {
  const ENT = { id: 'ent-r', customerId: 'c1', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 1 };
  const base = {
    courseId: 'course-checkup', courseName: '健檢', equipmentId: null, ivProductId: null, startsAt: '09:00', endsAt: '11:00',
    minutes: null, roomId: null, bed: null, therapistId: null, doctorId: null, followupForVisitId: null, attended: null,
    note: null, status: 'pending_confirm', oneTime: true,
  };
  const converted = { ...MINE, oneTime: false };
  const run = (slot) => validateVisit(
    { id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-11-20', status: 'pending_confirm', slots: [slot] },
    { customer: converted, courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts, rooms: SEED.rooms,
      staff: SEED.staff, entitlements: [ENT], customerVisits: [] },
  ).errors;

  test('扣額度 → 「當一次性客人時記的……取消這一段、另約一段」', () => {
    const errors = run({ ...base, entitlementId: 'ent-r', giftKind: null });
    assert.ok(errors.some((e) => /當一次性客人時記的.*取消這一段、另約一段/.test(e)), errors.join('\n'));
  });
  test('送的／體驗 → 同一種講法', () => {
    const errors = run({ ...base, entitlementId: null, giftKind: 'trial' });
    assert.ok(errors.some((e) => /當一次性客人時記的.*不是送的也不是體驗.*取消這一段、另約一段/.test(e)), errors.join('\n'));
  });
});

// ---------- R6：轉成我的客戶那一道不講過頭 ----------

describe('R6 轉成我的客戶：沒有額度不講會進壓表、問時間', () => {
  test('第一句只講清單與試算表；壓表、問這輪的時間是加購之後', () => {
    const lines = toMyCustomerConsequences({ visits: [], coursesById });
    assert.ok(!lines.some((l) => /也會進壓表/.test(l)), lines.join('\n'));
    assert.ok(lines.some((l) => l.includes('客戶清單與試算表')), lines.join('\n'));
    assert.ok(lines.some((l) => /加購之後才會進壓表、問這輪的時間/.test(l)), lines.join('\n'));
  });
});

// ---------- R8：「要幫誰排？」 ----------

describe('R8 打的字是某位客戶名字的一部分時照樣給「＋ 新增一次性客人」', () => {
  const rows = [{ id: 'c1', name: '王小明' }];
  test('列出來的沒有一位一模一樣 → 給', () => {
    assert.equal(offersNewGuest('王小', rows), true);
    assert.equal(offersNewGuest('王小', []), true);
  });
  test('有一位一模一樣（空白、全形半形不算）→ 不給；沒打字 → 不給', () => {
    assert.equal(offersNewGuest('王小明', rows), false);
    assert.equal(offersNewGuest(' 王 小明 ', rows), false);
    assert.equal(offersNewGuest('  ', rows), false);
  });
  test('日曆的選人那一張問它', () => {
    assert.match(src('public/js/ui/views/calendar.js'), /offersNewGuest\(/);
  });
});

// ---------- R9：「妳」 ----------

describe('R9 文案用「你」', () => {
  test('public/js 一個「妳」都沒有', () => {
    const walk = (dir) => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : [];
    });
    const hits = walk(fromRoot('public/js')).filter((p) => readFileSync(p, 'utf8').includes('妳'));
    assert.deepEqual(hits, []);
    assert.ok(!GUEST_SAME_NAME.includes('妳'));
  });
});

// ---------- R10：一次性的 n返 不講次數 ----------

describe('R10 一次性客人存 n返：確認框不講「客戶身上的數字」', () => {
  const nth = {
    entitlementId: null, courseId: 'course-followup', courseName: '三返', followupNth: 3, followupForVisitId: 'e1',
    startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm', giftKind: null, oneTime: true,
  };
  const visit = { id: 'v2', customerId: 'g1', customerName: '客戶A', date: '2026-11-20', status: 'pending_confirm', slots: [nth] };

  test('壓表／日曆新增（bookingConsequences）', () => {
    const { lines } = bookingConsequences({ visit, coursesById });
    assert.ok(!lines.some((l) => /加約的/.test(l)), lines.join('\n'));
  });

  test('一般客人的三返照講（一個字都沒變）', () => {
    const { oneTime, ...plain } = nth;
    const { lines } = bookingConsequences({ visit: { ...visit, slots: [plain] }, coursesById });
    assert.ok(lines.some((l) => /三返是加約的/.test(l)), lines.join('\n'));
  });

  test('拍 Abovee（aboveeConsequences）', () => {
    const said = aboveeConsequences({
      plan: {
        writes: [{ id: 'v2', customerId: 'g1', customerName: '客戶A', date: '2026-11-20', visit, keys: ['k1'], freed: [] }],
        rows: [], before: { g1: [] }, after: { g1: [visit] }, changed: [],
      },
      coursesById, chainBy: { g1: { entitlements: [], tasks: [] } }, visitsBy: { g1: [] },
    });
    assert.ok(!said.lines.some((l) => /加約的/.test(l)), said.lines.join('\n'));
  });
});
