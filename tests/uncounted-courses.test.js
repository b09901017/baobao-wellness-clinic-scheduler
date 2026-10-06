// 不算次數的課（2026-10-05，issue 05，ADR-0121）。
//
// 她的原話：
//
// > 五、不算次數的課：功醫門診不扣額度，現在排不進去。
// > 功醫門診：跟二返不同；不算次數、不簽療程單、不寫紀錄；三個系統都要壓；要選醫師
// > 3. 這一輪只勾功醫門診。其他的我之後在設定自己勾「不算次數」就好。
//
// n返 是第一種沒有額度的段（ADR-0063），這是第二種。判準照抄那一支：
//
// > **這一行會不會讓一段不算次數的被算進某一筆額度，或反過來？**
//
// 「不算次數」是**可以**不用額度就排，不是**不准**有額度 —— 她之後會自己勾營養諮詢，
// 而既有的營養諮詢每一段都帶著額度、方案範本裡也有它。有額度的照舊扣。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { isUncounted, uncountedCourses, validate } from '../public/js/domain/masterData.js';
import {
  slotOptionsFor, NTH_PICK, uncountedPick, uncountedCourseIdOf,
} from '../public/js/domain/slotOptions.js';
import { slotFromPicks, visitWithSlot } from '../public/js/domain/slotDraft.js';
import {
  validateVisit, INITIAL_STATUS, formSlotIndexes, closeVisit, applyStatus, rebookSlot,
} from '../public/js/domain/visits.js';
import { counts, reconcile, validateEntitlement } from '../public/js/domain/entitlements.js';
import { syncTasksForVisit, RECORD_TASK_KIND } from '../public/js/domain/taskRules.js';
import {
  bookingConsequences, closeConsequences, cancelConsequences,
} from '../public/js/domain/consequences.js';
import { claimedExams } from '../public/js/domain/followups.js';
import { runHealthCheck } from '../public/js/domain/health.js';
import { slotName } from '../public/js/domain/naming.js';
import { customerPools } from '../public/js/domain/scheduling.js';
import { fieldLabel } from '../public/js/domain/audit.js';
import * as buy from '../public/js/ui/components/buy.js';

const TODAY = '2026-10-05';
const DAY = '2026-10-20';

/** 功醫門診：不算次數、不簽療程單、不寫紀錄、三個系統都壓、要選醫師。 */
const FM = {
  id: 'fm', name: '功醫門診', durationMin: 30, assigns: 'none',
  uncounted: true, systems: ['Abovee', 'Examine', '耀聖'], doctorPick: 'any',
  needsTreatmentForm: false, needsRecord: false,
};
const RECOVERY = { id: 'rec', name: '復能', durationMin: 60, assigns: 'therapist', systems: ['Abovee'] };
const CHECKUP = { id: 'chk', name: '健檢', durationMin: 120, assigns: 'none', systems: ['Examine'], followupCourseId: 'fu' };
const FOLLOWUP = { id: 'fu', name: '二返', durationMin: 30, assigns: 'none', doctorPick: 'any', needsTreatmentForm: false };
// 她之後自己勾的那一種：本來就買得到、身上有額度的課
const CONSULT = { id: 'con', name: '營養師諮詢', durationMin: 20, assigns: 'none', uncounted: true };

const COURSES = [FM, RECOVERY, CHECKUP, FOLLOWUP, CONSULT];
const BY_ID = Object.fromEntries(COURSES.map((c) => [c.id, c]));

const ent = (over = {}) => ({
  id: 'e-rec', customerId: 'c1', type: 'single', courseId: 'rec', label: '復能(60)',
  totalQty: 10, doneCount: 0, bookedCount: 0, durationMin: 60, ...over,
});
const customer = { customerId: 'c1', customerName: '客戶A' };
const ctxOf = (entitlements = [], visits = []) => ({
  courses: COURSES, equipment: [], ivProducts: [], entitlements, visits,
});

const fmSlot = (over = {}) => ({
  entitlementId: null, courseId: 'fm', courseName: '功醫門診',
  startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm', ...over,
});
const visit = (slots, over = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶A', date: DAY, status: 'pending_confirm', slots, ...over,
});

describe('哪些課不算次數', () => {
  test('課程上的那一格（uncounted）；沒有那一格就是算', () => {
    assert.equal(isUncounted(FM), true);
    assert.equal(isUncounted(RECOVERY), false);
    assert.equal(isUncounted({ uncounted: 'yes' }), false, '只認 true —— 存成字串的不算');
    assert.equal(isUncounted(null), false);
  });

  test('名單只收還在用的', () => {
    assert.deepEqual(uncountedCourses([
      FM, RECOVERY,
      { id: 'x', name: '停用的', uncounted: true, active: false },
      { id: 'y', name: '刪掉的', uncounted: true, deletedAt: 'z' },
    ]).map((c) => c.id), ['fm']);
  });

  test('驗證：只能是是或否', () => {
    const ok = { name: '新課', durationMin: 30, category: 'C', assigns: 'none' };
    assert.deepEqual(validate('courses', { ...ok, uncounted: true }), []);
    assert.deepEqual(validate('courses', { ...ok, uncounted: false }), []);
    assert.ok(validate('courses', { ...ok, uncounted: 'true' }).length);
  });
});

describe('這一段可以做什麼（slotOptionsFor）', () => {
  test('一位沒有任何額度的客戶：照樣有「功醫門診」那一顆，剩餘那一格是「—」', () => {
    const out = slotOptionsFor(ctxOf([]));
    const fm = out.find((o) => o.course.id === 'fm');
    assert.ok(fm, '不用加購就排得進去');
    assert.equal(fm.isUncounted, true);
    assert.equal(fm.entitlement, null);
    assert.equal(fm.remaining, '—', '0 看起來像「用完了」，而它根本沒有次數');
    assert.equal(fm.entitlementId, uncountedPick('fm'));
    assert.equal(uncountedCourseIdOf(fm.entitlementId), 'fm');
  });

  test('那一顆的值撞不到額度的 id，也不是 n返 那一顆', () => {
    assert.notEqual(uncountedPick('fm'), NTH_PICK);
    assert.equal(uncountedCourseIdOf('e-rec'), null);
    assert.equal(uncountedCourseIdOf(NTH_PICK), null);
    assert.equal(uncountedCourseIdOf(null), null);
  });

  test('額度照原本那一排的順序在前面，不算次數的課接在後面', () => {
    const ents = [ent(), ent({ id: 'e-used', label: '用完的', totalQty: 2, doneCount: 2 })];
    const out = slotOptionsFor(ctxOf(ents));
    assert.deepEqual(out.map((o) => o.label), ['復能(60)', '功醫門診', '營養師諮詢']);
    assert.equal(out[0].remaining, 10);
    assert.equal(out[0].entitlement.id, 'e-rec');
  });

  test('壓表只列還有剩的；拍 Abovee 連用完的也列（Abovee 上已經約了）', () => {
    const ents = [ent({ id: 'e-used', label: '用完的', totalQty: 2, doneCount: 2 })];
    assert.ok(!slotOptionsFor(ctxOf(ents)).some((o) => o.label === '用完的'));
    assert.ok(slotOptionsFor(ctxOf(ents), { includeUsedUp: true }).some((o) => o.label === '用完的'));
  });

  test('這位客戶身上還有那門課的額度：兩顆都在 —— 她選哪一顆就扣不扣', () => {
    const out = slotOptionsFor(ctxOf([ent({ id: 'e-con', courseId: 'con', label: '營養師諮詢', totalQty: 4 })]));
    const mine = out.filter((o) => o.course.id === 'con');
    assert.equal(mine.length, 2);
    assert.deepEqual(mine.map((o) => Boolean(o.entitlement)), [true, false]);
  });

  test('n返 那一顆照舊：有做完的健檢才有', () => {
    const ents = [
      ent({ id: 'e-chk', courseId: 'chk', label: '健檢', totalQty: 1, doneCount: 1 }),
      ent({ id: 'e-fu', courseId: 'fu', label: '二返', totalQty: 1, followupForEntitlementId: 'e-chk' }),
    ];
    const done = {
      id: 'v-chk', customerId: 'c1', date: '2026-09-01', status: 'done',
      slots: [{ entitlementId: 'e-chk', courseId: 'chk', status: 'done', attended: true }],
    };
    const out = slotOptionsFor(ctxOf(ents, [done]));
    const nth = out.find((o) => o.isNth);
    assert.ok(nth);
    assert.equal(nth.entitlementId, NTH_PICK);
    assert.equal(nth.course.id, 'fu');
    assert.ok(!slotOptionsFor(ctxOf(ents, [])).some((o) => o.isNth), '沒有做完的健檢就整顆不畫');
  });
});

describe('組時段（slotFromPicks 的 uncountedCourseId）', () => {
  const pick = (over = {}) => slotFromPicks(
    { uncountedCourseId: 'fm', startsAt: '10:00', doctorId: 'd1', ...over }, ctxOf([ent()]),
  );

  test('課程就是它、沒有額度、返數不碰、新的一段待確認', () => {
    const { slot, errors, course } = pick();
    assert.deepEqual(errors, []);
    assert.equal(course.id, 'fm');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.courseId, 'fm');
    assert.equal(slot.courseName, '功醫門診');
    assert.equal(slot.followupNth ?? null, null, '它不是 n返');
    assert.equal(slot.followupForVisitId, null);
    assert.equal(slot.status, INITIAL_STATUS);
    assert.equal(slot.endsAt, '10:30', '時長照課程（`slotMinutes()`）');
    assert.equal(slot.doctorId, 'd1', '醫師照 `doctorRuleOf()`');
  });

  test('指到一門要算次數的課：組不出來（那一條路只給不算次數的）', () => {
    const { slot, errors } = pick({ uncountedCourseId: 'rec' });
    assert.equal(slot, null);
    assert.ok(errors.length);
  });

  test('同時給了額度：額度贏（兩種身分只挑一種，照她按的那一顆）', () => {
    const { slot } = slotFromPicks(
      { entitlementId: 'e-rec', uncountedCourseId: 'fm', startsAt: '10:00' }, ctxOf([ent()]),
    );
    assert.equal(slot.entitlementId, 'e-rec');
    assert.equal(slot.courseId, 'rec');
  });

  test('併進同一天：照樣走 visitWithSlot()', () => {
    const { slot } = pick();
    const { visit: v, merged } = visitWithSlot(customer, DAY, slot, []);
    assert.equal(merged, null);
    assert.equal(v.slots.length, 1);
    assert.equal(v.status, INITIAL_STATUS);
  });
});

describe('驗證（validateVisit）', () => {
  const check = (slots, entitlements = []) => validateVisit(visit(slots), {
    customer: { flags: [] }, entitlements, courses: COURSES, equipment: [], rooms: [], staff: [],
    ivProducts: [], customerVisits: [], sameDayVisits: [],
  }).errors;

  test('沒有額度的段：課程不算次數就放行', () => {
    assert.deepEqual(check([fmSlot()]), []);
  });

  test('沒有額度的段：課程要算次數照舊擋「要選一個額度」', () => {
    const errors = check([fmSlot({ courseId: 'rec', courseName: '復能', therapistId: 't1' })]);
    assert.ok(errors.some((e) => e.includes('要選一個額度')), errors.join());
  });

  test('不算次數的課帶著額度：照舊存得下去（她之後勾營養諮詢，既有每一段都帶著額度）', () => {
    const e = ent({ id: 'e-con', courseId: 'con', label: '營養師諮詢', totalQty: 4 });
    assert.deepEqual(check([{
      entitlementId: 'e-con', courseId: 'con', courseName: '營養師諮詢',
      startsAt: '10:00', endsAt: '10:20', status: 'pending_confirm',
    }], [e]), []);
  });

  test('方案範本與額度本身不擋不算次數的課（種子的方案裡就有營養師諮詢）', () => {
    assert.deepEqual(validate('plans', {
      name: '測試方案', items: [{ type: 'single', label: '營養師諮詢', qty: 4, courseId: 'con' }],
    }, { courses: COURSES, equipment: [] }), []);
    assert.deepEqual(validateEntitlement(
      { type: 'single', label: '營養師諮詢', totalQty: 4, courseId: 'con' }, { courses: COURSES },
    ), []);
  });
});

describe('次數：一格都不動', () => {
  const e = ent({ bookedCount: 1 });
  const mine = {
    id: 'v0', customerId: 'c1', date: '2026-10-10', status: 'confirmed',
    slots: [{ entitlementId: 'e-rec', courseId: 'rec', status: 'confirmed' }],
  };
  const fmDone = visit([fmSlot({ status: 'done', attended: true })], { status: 'done' });

  test('做完一段功醫門診，每一筆額度現算出來的數字都沒變', () => {
    const before = counts(e, [mine], e.id);
    const after = counts(e, [mine, fmDone], e.id);
    assert.deepEqual(after, before);
    assert.deepEqual(reconcile(e, [mine, fmDone], e.id), reconcile(e, [mine], e.id));
  });

  test('壓表卡片牆只看額度：不會多出「還有 N 次沒壓」', () => {
    const { pools, totalRemaining } = customerPools({ entitlements: [] });
    assert.deepEqual(pools, []);
    assert.equal(totalRemaining, 0);
  });

  test('結案：功醫門診那一段標成已完成，不碰任何額度', () => {
    const v = visit([fmSlot({ status: 'confirmed' })], { status: 'confirmed' });
    const closed = closeVisit(v, [true]);
    assert.equal(closed.status, 'done');
    assert.equal(closed.slots[0].entitlementId, null);
  });
});

describe('待辦：照課程自己的設定', () => {
  test('客人確認之後長 Examine、耀聖；做完不長寫紀錄', () => {
    const confirmed = visit([fmSlot({ status: 'confirmed' })], { status: 'confirmed' });
    const { create } = syncTasksForVisit(confirmed, [], { coursesById: BY_ID, today: TODAY });
    assert.deepEqual(create.map((t) => t.kind).sort(), ['Examine', '耀聖']);

    const done = visit([fmSlot({ status: 'done', attended: true })], { status: 'done' });
    const after = syncTasksForVisit(done, [], { coursesById: BY_ID, today: TODAY });
    assert.ok(!after.create.some((t) => t.kind === RECORD_TASK_KIND));
  });

  test('不用簽療程單：簽單那一排沒有它（needsTreatmentForm: false）', () => {
    const v = visit([fmSlot({ status: 'confirmed' })], { status: 'confirmed' });
    assert.deepEqual(formSlotIndexes(v, BY_ID), []);
  });

  test('取消這一段、改期：只看狀態，不看額度', () => {
    const v = visit([fmSlot({ status: 'confirmed' })], { status: 'confirmed' });
    const cancelled = applyStatus(v, 'cancelled', { slotIndex: 0 });
    assert.equal(cancelled.slots[0].status, 'cancelled');

    const moved = rebookSlot(v, 0, { ...v.slots[0], startsAt: '14:00', endsAt: '14:30' });
    assert.equal(moved.slots.length, 2);
    assert.equal(moved.slots[1].entitlementId, null);
    assert.equal(moved.slots[1].courseId, 'fm');
  });
});

describe('健檢那條鏈：不會被當成二返', () => {
  test('二返那門課自己被勾成不算次數、排了一段沒有額度的：不佔任何一次健檢', () => {
    const ents = [
      ent({ id: 'e-chk', courseId: 'chk', label: '健檢', totalQty: 1, doneCount: 1 }),
      ent({ id: 'e-fu', courseId: 'fu', label: '二返', totalQty: 1, followupForEntitlementId: 'e-chk' }),
    ];
    const exam = {
      id: 'v-chk', customerId: 'c1', date: '2026-09-01', status: 'done',
      slots: [{ entitlementId: 'e-chk', courseId: 'chk', status: 'done', attended: true }],
    };
    const free = visit([{
      entitlementId: null, courseId: 'fu', courseName: '二返',
      startsAt: '10:00', endsAt: '10:30', status: 'confirmed', followupForVisitId: 'v-chk',
    }], { status: 'confirmed' });
    assert.equal(claimedExams('e-fu', [exam, free]).size, 0);
  });
});

describe('名字：讀主檔，不讀快照', () => {
  test('功醫門診在主檔改了名字，日曆上跟著改（n返 才讀快照）', () => {
    const master = { courses: [{ ...FM, name: '功能醫學門診' }], equipment: [], ivProducts: [] };
    assert.equal(slotName(fmSlot(), master, 'short'), '功能醫學門診');
  });
});

describe('確認框只講真的會發生的事（ADR-0070）', () => {
  const said = (lines) => lines.join('／');

  test('新增：多一句「不算次數 —— 客戶身上的數字一個都不會變」', () => {
    const { lines } = bookingConsequences({ visit: visit([fmSlot()]), coursesById: BY_ID, today: TODAY });
    assert.match(said(lines), /功醫門診不算次數 —— 客戶身上的數字一個都不會變/);
  });

  test('新增：不算次數的課但扣著額度的那一段不講那一句（它會扣）', () => {
    const v = visit([{ entitlementId: 'e-con', courseId: 'con', startsAt: '10:00', endsAt: '10:20', status: 'pending_confirm' }]);
    const { lines } = bookingConsequences({ visit: v, coursesById: BY_ID, today: TODAY });
    assert.ok(!said(lines).includes('不算次數'));
  });

  test('結案：全是不扣次數的段就不講「扣掉次數」', () => {
    const v = visit([fmSlot({ status: 'confirmed' })], { status: 'confirmed' });
    const lines = closeConsequences({ visit: v, picks: [true], entitlements: [], coursesById: BY_ID });
    assert.ok(!said(lines).includes('扣掉次數'), said(lines));
    assert.ok(said(lines).includes('不扣次數'), said(lines));
  });

  test('結案：n返 也一樣（她沒發現、順手修的）', () => {
    const nth = { entitlementId: null, courseId: 'fu', courseName: '三返', followupNth: 3, followupForVisitId: 'v-chk', startsAt: '10:00', endsAt: '10:30', status: 'confirmed' };
    const lines = closeConsequences({ visit: visit([nth], { status: 'confirmed' }), picks: [true], entitlements: [], coursesById: BY_ID });
    assert.ok(!said(lines).includes('扣掉次數'), said(lines));
  });

  test('結案：有的扣、有的不扣 —— 只數扣的那幾段', () => {
    const v = visit([
      { entitlementId: 'e-rec', courseId: 'rec', startsAt: '09:00', endsAt: '10:00', status: 'confirmed' },
      fmSlot({ status: 'confirmed' }),
    ], { status: 'confirmed' });
    const lines = closeConsequences({ visit: v, picks: [true, true], entitlements: [ent()], coursesById: BY_ID });
    assert.ok(lines.includes('做了的 2 段裡 1 段扣掉次數'), said(lines));
  });

  test('結案：每一段都扣的時候句子跟以前一個字不差', () => {
    const v = visit([{ entitlementId: 'e-rec', courseId: 'rec', startsAt: '09:00', endsAt: '10:00', status: 'confirmed' }], { status: 'confirmed' });
    const lines = closeConsequences({ visit: v, picks: [true], entitlements: [ent()], coursesById: BY_ID });
    assert.ok(lines.includes('做了的 1 段扣掉次數'), said(lines));
  });

  test('取消一段不扣次數的：不講「次數也會還回來」', () => {
    const v = visit([fmSlot({ status: 'confirmed' })], { status: 'confirmed' });
    const one = cancelConsequences({ visit: v, coursesById: BY_ID, slotIndex: 0 });
    assert.ok(!said(one).includes('次數也會還回來'), said(one));
    assert.ok(one[0].startsWith('這一段會退回去'), said(one));
    const whole = cancelConsequences({ visit: v, coursesById: BY_ID });
    assert.ok(!said(whole).includes('次數也會還回來'), said(whole));
  });

  test('取消：扣著額度的照舊講「次數也會還回來」，一個字不差', () => {
    const v = visit([{ entitlementId: 'e-rec', courseId: 'rec', startsAt: '09:00', endsAt: '10:00', status: 'confirmed' }], { status: 'confirmed' });
    assert.equal(cancelConsequences({ visit: v, coursesById: BY_ID, slotIndex: 0 })[0], '這一段會退回去，次數也會還回來');
    assert.equal(cancelConsequences({ visit: v, coursesById: BY_ID })[0], '這一整天的 1 個時段會退回去，次數也會還回來');
  });
});

describe('資料健檢：不報它', () => {
  test('一段沒有額度的功醫門診：沒有孤兒、沒有次數對不上', () => {
    const result = runHealthCheck({
      customers: [{ id: 'c1', name: '客戶A', active: true }],
      entitlements: [],
      visits: [visit([fmSlot({ status: 'done', attended: true })], { status: 'done', date: '2026-10-01' })],
      tasks: [], availability: [],
      master: { courses: COURSES, rooms: [], staff: [], equipment: [], ivProducts: [] },
    }, TODAY);
    const hits = result.checks
      .filter((c) => c.findings.some((f) => JSON.stringify(f).includes('v1')))
      .map((c) => c.id);
    assert.deepEqual(hits, []);
  });
});

describe('加購那一排不列它', () => {
  test('買不了一個不扣次數的東西；其餘照舊', () => {
    const master = {
      courses: [{ id: 'rec', name: '復能' }, { id: 'fm', name: '功醫門診', uncounted: true }],
      equipment: [], ivProducts: [], products: [],
    };
    const html = buy.fields({ type: 'single', courseId: 'rec', label: '復能', totalQty: 1 }, master);
    assert.ok(html.includes('復能'));
    assert.ok(!html.includes('功醫門診'));
  });
});

describe('三個入口都走同一支', () => {
  const read = (rel) => readFileSync(new URL(`../public/js/${rel}`, import.meta.url), 'utf8');

  test('壓表那一排由 slotOptionsFor() 組，不自己組', () => {
    assert.match(read('ui/views/schedule.js'), /slotOptionsFor\(/);
  });

  test('來訪編輯器組不算次數的那一段走 slotFromPicks()（新規則不在畫面裡重寫一次）', () => {
    const src = read('ui/views/visitEditor.js');
    assert.match(src, /uncountedCourses\(/);
    assert.match(src, /slotFromPicks\(/);
  });

  test('n返 那一顆的值只定義在一個地方', () => {
    for (const rel of ['ui/views/schedule.js', 'ui/views/visitEditor.js']) {
      assert.ok(!/const NTH_PICK\s*=/.test(read(rel)), `${rel} 不可以自己再定義一次`);
    }
  });

  test('稽核不印英文欄位名', () => {
    assert.equal(fieldLabel('uncounted'), '不算次數');
  });
});

describe('試算表：次數那幾格一格都沒動，來訪紀錄那一天有它', () => {
  test('功醫門診那一天進來訪紀錄；額度那一列的四個數字不變、那一天記在它自己那一列', async () => {
    const { syncBundle } = await import('../public/js/domain/sheetReport.js');
    const e = ent({ doneCount: 0, bookedCount: 0 });
    const build = (visits) => syncBundle({
      customers: [{ id: 'c1', name: '客戶A' }],
      entitlementsBy: { c1: [e] },
      visitsBy: { c1: visits },
      today: TODAY,
      master: { courses: COURSES, staff: [{ id: 'd1', name: '夏' }], equipment: [], rooms: [], ivProducts: [] },
    }).sheets[0];

    const fmDone = visit([fmSlot({ status: 'done', attended: true, doctorId: 'd1' })], { status: 'done', date: '2026-10-01' });
    const before = build([]);
    const after = build([fmDone]);

    // 額度那幾列一格都沒動。2026-10-06 起那一段在矩陣最下面有自己一列（`extraRows()`），
    // 所以這裡只比額度列 —— 多出來的那一列另外看。
    const nums = (sheet) => sheet.rows.filter((r) => !r.extra).map((r) => [r.total, r.done, r.booked, r.remaining]);
    assert.deepEqual(nums(after), nums(before));
    assert.deepEqual(after.totals, before.totals, '合計也沒動');
    assert.deepEqual(after.rows[0].marks.filter(Boolean), [], '那一天不算在任何一筆額度上');
    assert.deepEqual(
      after.rows.filter((r) => r.extra).map((r) => [r.label, r.total, r.done, r.remaining, r.marks]),
      [['功醫門診（不算次數）', '—', 1, '—', ['✓']]],
      '那一天在它自己那一列（她：「當天的日期會全是空的 ?」）',
    );

    assert.equal(after.log.length, 1);
    assert.equal(after.log[0].date, '2026-10-01');
    assert.equal(after.log[0].items[0].course, '功醫門診');
    assert.equal(after.log[0].items[0].doctor, '夏');
  });
});
