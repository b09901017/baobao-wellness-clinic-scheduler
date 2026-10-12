// 一門課可以哪個系統都不用壓（2026-10-06，issue 02，ADR-0126）。
//
// 她的原話：
//
// > HRV也是不算次數的，通常會是我想邀客戶來體驗送的，就會讓他當天做完HRV後然後接著功醫門診聽報告
// > 問題 6：目前先皆不用壓，不用指派診間或人員…
//
// 以前一門課**一定**壓在某個系統：三個都不勾存不下去，空的 `systems` 被當成「沒勾過」
// 退回類別去推，推不出來就猜 Abovee。Abovee 上沒有 HRV 這門課，硬勾的話取消一段 HRV
// 會長一張假的「取消 Abovee」。
//
// `systems: []`（明確的空陣列）＝不用壓。這一支盯兩個方向：
//
//   1. **不用壓的課一張壓表類的待辦、一句「壓好了嗎」都不可以長**
//   2. **認不得的課（主檔被刪了）照舊猜 Abovee** —— ADR-0041 那一條一個字都不動

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  systemsOf, bookingSystemOf, tasksForCourse, describeSystems,
  bookingSystemsForVisit, cancelTasksFor, syncTasksForVisit, newRegistrations,
} from '../public/js/domain/taskRules.js';
import { validate } from '../public/js/domain/masterData.js';
import { customersToBook } from '../public/js/domain/scheduling.js';
import {
  bookingSystemLabel, bookingConsequences, rebookConsequences, cancelConsequences,
} from '../public/js/domain/consequences.js';
import { todosForVisit } from '../public/js/domain/todoFlow.js';

const TODAY = '2026-10-01';
const NL = '\n';

const COURSES = {
  hrv: { id: 'hrv', name: 'HRV', category: null, systems: [], uncounted: true },
  fm: { id: 'fm', name: '功醫門診', category: 'A', systems: ['Abovee', 'Examine', '耀聖'], uncounted: true },
  rec: { id: 'rec', name: '復能', category: 'C', systems: ['Abovee'] },
  exam: { id: 'exam', name: '健檢', category: 'B', systems: ['Examine'] },
};

const slot = (courseId, startsAt = '10:00', status = 'pending_confirm', over = {}) => ({
  courseId, courseName: COURSES[courseId]?.name ?? null, startsAt, endsAt: '10:30',
  entitlementId: null, status, ...over,
});
const visit = (slots, over = {}) => ({
  id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-10-10',
  status: 'pending_confirm', slots, ...over,
});

describe('`systems: []` 就是不用壓', () => {
  test('三支推導：沒有系統、沒有壓表的地方、確認後什麼都不長', () => {
    assert.deepEqual(systemsOf(COURSES.hrv), []);
    assert.equal(bookingSystemOf(COURSES.hrv), null);
    assert.deepEqual(tasksForCourse(COURSES.hrv), []);
  });

  test('類別是什麼都一樣 —— 明確的空陣列蓋過類別', () => {
    for (const category of ['A', 'B', 'C', null]) {
      assert.deepEqual(systemsOf({ category, systems: [] }), [], `類別 ${category}`);
      assert.equal(bookingSystemOf({ category, systems: [] }), null, `類別 ${category}`);
    }
  });

  test('設定頁那一行灰字寫「不用壓」', () => {
    assert.equal(describeSystems(COURSES.hrv), '不用壓');
  });

  test('沒有那一格（沒勾過）的舊課程一個字都不變：照類別推', () => {
    assert.deepEqual(systemsOf({ category: 'A' }), ['Abovee', 'Examine', '耀聖']);
    assert.deepEqual(systemsOf({ category: 'A', systems: null }), ['Abovee', 'Examine', '耀聖']);
    assert.equal(bookingSystemOf({ category: 'B' }), 'Examine');
    assert.equal(bookingSystemOf({ category: null }), 'Abovee');
    // 全是認不得的字不是「她明確說不用壓」，照舊退回類別
    assert.deepEqual(systemsOf({ category: 'B', systems: ['打電話'] }), ['Examine']);
  });

  test('認不得的課程（主檔被刪了）照舊猜 Abovee —— ADR-0041 不動', () => {
    assert.equal(systemsOf(undefined), null);
    assert.equal(bookingSystemOf(undefined), 'Abovee');
    assert.deepEqual(bookingSystemsForVisit({ slots: [{ courseId: 'gone' }] }, COURSES), ['Abovee']);
  });
});

describe('驗證：要嘛一個都不勾，要嘛 Abovee／Examine 至少一個', () => {
  const ok = { name: '新課', durationMin: 30, category: null, assigns: 'none' };

  test('三個都不勾存得下去', () => {
    assert.deepEqual(validate('courses', { ...ok, systems: [] }), []);
  });

  test('只勾耀聖照舊存不下去 —— 沒有地方壓表卻有確認後的登記講不通', () => {
    const errors = validate('courses', { ...ok, systems: ['耀聖'] });
    assert.equal(errors.length, 1);
    assert.match(errors[0], /耀聖/);
  });
});

describe('這一行會不會讓一段不用壓的課長出「取消 Abovee」', () => {
  const cancelled = (slots) => visit(
    slots.map((s) => ({ ...s, status: 'cancelled' })), { status: 'cancelled' },
  );

  test('一筆來訪動到哪幾個系統：不用壓的那一段不算', () => {
    assert.deepEqual(bookingSystemsForVisit(visit([slot('hrv'), slot('fm', '10:30')]), COURSES), ['Abovee']);
    assert.deepEqual(bookingSystemsForVisit(visit([slot('hrv')]), COURSES), []);
  });

  test('HRV＋功醫門診整天取消：只長功醫門診那一張，而且只蓋功醫門診那一段', () => {
    const tasks = cancelTasksFor(cancelled([slot('hrv'), slot('fm', '10:30')]), [], COURSES, TODAY);
    assert.deepEqual(tasks.map((t) => t.kind), ['取消 Abovee']);
    assert.deepEqual(tasks[0].slotIndexes, [1]);
  });

  test('只有 HRV 的那一天取消：一張都不長', () => {
    assert.deepEqual(cancelTasksFor(cancelled([slot('hrv')]), [], COURSES, TODAY), []);
  });

  test('只取消 HRV 那一段、功醫門診還在：一張都不長', () => {
    const v = visit([slot('hrv', '10:00', 'cancelled'), slot('fm', '10:30', 'confirmed')], { status: 'confirmed' });
    assert.deepEqual(cancelTasksFor(v, [], COURSES, TODAY), []);
  });

  test('認不得的課程整天取消：照舊長「取消 Abovee」', () => {
    const tasks = cancelTasksFor(cancelled([slot('gone')]), [], COURSES, TODAY);
    assert.deepEqual(tasks.map((t) => t.kind), ['取消 Abovee']);
  });

  test('確認框那幾句跟真的會長的一樣：HRV 那一段取消不講任何系統', () => {
    const v = visit([slot('hrv', '10:00', 'confirmed'), slot('fm', '10:30', 'confirmed')], { status: 'confirmed' });
    const said = cancelConsequences({ visit: v, coursesById: COURSES, tasks: [], slotIndex: 0 }).join(NL);
    assert.doesNotMatch(said, /取消 Abovee|取消 Examine|取消 耀聖/);
    const whole = cancelConsequences({ visit: visit([slot('hrv', '10:00', 'confirmed')], { status: 'confirmed' }), coursesById: COURSES, tasks: [] }).join(NL);
    assert.doesNotMatch(whole, /待辦會多一張/);
  });

  test('讀取卡片：沒有 slotIndexes 的舊「取消 Abovee」不歸 HRV 那一段', () => {
    const v = cancelled([slot('hrv'), slot('fm', '10:30')]);
    const legacy = { id: 't9', visitId: 'v1', kind: '取消 Abovee', done: false, autoGenerated: true };
    const at = (i) => todosForVisit(v, { tasks: [legacy], coursesById: COURSES, focusSlot: i })
      .some((row) => row.kind === '取消 Abovee');
    assert.equal(at(1), true, '功醫門診那一段壓在 Abovee');
    assert.equal(at(0), false, 'HRV 沒有壓過');
  });
});

describe('客人確認之後不長任何掛號待辦', () => {
  test('一段已確認的 HRV', () => {
    const v = visit([slot('hrv', '10:00', 'confirmed')], { status: 'confirmed' });
    assert.deepEqual(syncTasksForVisit(v, [], { coursesById: COURSES, today: TODAY }).create, []);
    assert.deepEqual(newRegistrations(v, [], COURSES, TODAY), []);
  });
});

describe('待辦中心「壓表登記」', () => {
  const person = { id: 'c1', name: '王小明', active: true };
  const book = (over) => customersToBook({
    customers: [person], visitsBy: {}, coursesById: COURSES, targetMonth: '2026-10', ...over,
  });

  test('身上只有一筆不用壓的課的額度：不算還有要壓的', () => {
    const rows = book({
      entitlementsBy: { c1: [{ id: 'e1', type: 'single', label: 'HRV', courseId: 'hrv', totalQty: 2 }] },
    });
    assert.deepEqual(rows, []);
  });

  test('這個月只排了 HRV：Abovee 那一區照樣有他（HRV 那一段不算壓過任何系統）', () => {
    const rows = book({
      entitlementsBy: { c1: [{ id: 'e1', type: 'single', label: '復能', courseId: 'rec', totalQty: 2 }] },
      visitsBy: { c1: [{ id: 'v', status: 'confirmed', date: '2026-10-03', slots: [{ courseId: 'hrv' }] }] },
    });
    assert.deepEqual(rows.map((r) => r.systems.map((s) => s.system)), [['Abovee']]);
  });
});

describe('存檔前那一道確認的抬頭', () => {
  const ask = (o) => bookingConsequences({ coursesById: COURSES, today: TODAY, ...o });

  test('只看這一次新加的那幾段，不是那一天的每一段', () => {
    const v = visit([slot('exam', '09:00', 'confirmed'), slot('rec', '11:00')]);
    assert.equal(bookingSystemLabel(v, COURSES), 'Examine 與 Abovee', '沒指定就是每一段（新的一天）');
    assert.equal(bookingSystemLabel(v, COURSES, [1]), 'Abovee');
    assert.equal(ask({ visit: v, added: [1], merge: { reopened: true } }).title, '已經在 Abovee 壓好表了嗎？');
  });

  test('已經有功醫門診的那一天再加一段 HRV：抬頭不問 Abovee', () => {
    const v = visit([slot('fm', '10:30', 'confirmed'), slot('hrv', '10:00')]);
    const said = ask({ visit: v, added: [1], merge: { reopened: true } });
    assert.doesNotMatch(said.title, /Abovee|Examine|耀聖|壓好/);
    assert.equal(said.title, '記錄這一段？');
    assert.equal(said.confirmLabel, '記錄');
  });

  test('只加 HRV：抬頭不是「已經在  壓好表了嗎？」', () => {
    const said = ask({ visit: visit([slot('hrv')]) });
    assert.equal(said.title, '記錄這一段？');
    assert.equal(said.confirmLabel, '記錄');
    assert.ok(said.lines.includes('會記到日曆上，標成「待確認」'), '其餘的後果照講');
    assert.ok(!said.lines.some((l) => /等客人說可以之後/.test(l)), '確認之後不長任何掛號');
  });

  test('一次新加兩段都不用壓：講幾段', () => {
    const said = ask({ visit: visit([slot('hrv'), slot('hrv', '11:00')]) });
    assert.equal(said.title, '記錄這 2 段？');
  });

  test('新加的裡面有一段要壓：照舊問那個系統，不把不用壓的講進去', () => {
    const said = ask({ visit: visit([slot('hrv'), slot('fm', '10:30')]) });
    assert.equal(said.title, '已經在 Abovee 壓好表了嗎？');
    assert.equal(said.confirmLabel, '已確認，記錄');
  });

  test('要壓的課一個字都沒變', () => {
    const said = ask({ visit: visit([slot('exam')]) });
    assert.equal(said.title, '已經在 Examine 壓好表了嗎？');
    assert.equal(said.confirmLabel, '已確認，記錄');
  });

  test('改期一段 HRV：抬頭沒有 null、不問壓好了嗎', () => {
    const before = visit([slot('hrv', '10:00', 'confirmed')], { status: 'confirmed' });
    const after = {
      ...before,
      slots: [{ ...before.slots[0], status: 'cancelled' }, slot('hrv', '14:00')],
    };
    const said = rebookConsequences({ before, after, index: 0, tasks: [], coursesById: COURSES, today: TODAY });
    assert.equal(said.title, '改到新的時間？');
    assert.doesNotMatch(said.lines.join(NL), /待辦會多一張/);
  });

  test('兩個入口的確認鈕都讀 domain 給的字，不自己寫死', () => {
    for (const file of ['schedule.js', 'visitEditor.js']) {
      const src = readFileSync(new URL(`../public/js/ui/views/${file}`, import.meta.url), 'utf8');
      const at = src.indexOf('const said = bookingConsequences(');
      const body = src.slice(at, src.indexOf('if (!ok) return;', at));
      assert.match(body, /confirmLabel: said\.confirmLabel/, file);
    }
  });
});

// 2026-10-07（verified-bugs issues/11）：功醫門診＋HRV 一起存，抬頭對（只問 Abovee），
// 但呼叫端把這次新加的每一段都列在底下 —— 讀起來像在問「HRV 在 Abovee 壓好了嗎」。
describe('「壓好了嗎」那一道：哪幾段要壓、哪幾段不用，由 domain 一起回', () => {
  const day = (...ids) => ({
    id: null, customerId: 'c1', date: '2026-10-07', status: 'pending_confirm',
    slots: ids.map((id, i) => ({ courseId: id, entitlementId: null, startsAt: `0${9 + i}:00`, status: 'pending_confirm' })),
  });
  const ask = (o) => bookingConsequences({ coursesById: COURSES, today: TODAY, ...o });

  test('功醫門診＋HRV：要壓的只有功醫門診，HRV 在「不用壓」那一份', () => {
    const said = ask({ visit: day('fm', 'hrv') });
    assert.match(said.title, /Abovee/);
    assert.deepEqual(said.toBook, [0]);
    assert.deepEqual(said.free, [1]);
  });

  test('兩段都不用壓：要壓的那一份是空的（抬頭本來就會換）', () => {
    const said = ask({ visit: day('hrv', 'hrv') });
    assert.deepEqual(said.toBook, []);
    assert.deepEqual(said.free, [0, 1]);
    assert.doesNotMatch(said.title, /壓好/);
  });

  test('只看這一次新加的那幾段（`added`），索引照那一筆來訪的位置', () => {
    const said = ask({ visit: day('rec', 'fm', 'hrv'), added: [1, 2], merge: { reopened: false } });
    assert.deepEqual(said.toBook, [1]);
    assert.deepEqual(said.free, [2]);
  });

  test('來訪編輯器列的是 toBook，不是這次新加的每一段（掃原始碼）', () => {
    const src = readFileSync(new URL('../public/js/ui/views/visitEditor.js', import.meta.url), 'utf8');
    const at = src.indexOf('const said = bookingConsequences(');
    const block = src.slice(at, at + 1800);
    assert.match(block, /said\.toBook/);
    assert.match(block, /不用壓表/);
  });
});
