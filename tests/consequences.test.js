// 「按下去之後會發生什麼」那幾句話。
//
// 兩件事在這裡守著：
//
// 1. **同一天再記一段，新的那一段不可以繼承舊來訪的進度。**
//    她回報的：先壓 9 點、去待辦勾掉「跟客人確認時間」、再壓同一天 10 點，
//    結果什麼待辦都沒長出來 —— 因為那一筆已經是 confirmed 了，而
//    「跟客人確認時間」那一列是從 pending_confirm 推導的（ADR-0001）。
//    見 `.scratch/followup-and-products/issues/05`。
//
// 2. **抬頭不可以寫死 Abovee。** 健檢壓的是 Examine。這一句以前在兩個入口
//    各寫死一次，所以在健檢上錯了兩次。

import { test, describe } from 'node:test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

import { fromRoot } from './helpers/paths.js';
import assert from 'node:assert/strict';

import { acceptsMoreSlots, withExtraSlot, INITIAL_STATUS } from '../public/js/domain/visits.js';
import {
  bookingSystemLabel, bookingConsequences, confirmConsequences,
  closeConsequences, untickConsequences, cancelConsequences, reviewWarnings,
} from '../public/js/domain/consequences.js';

const COURSES = {
  'c-checkup': { id: 'c-checkup', name: '健檢', category: 'B' },
  'c-followup': { id: 'c-followup', name: '二返', category: 'A', needsTreatmentForm: false },
  'c-recovery': { id: 'c-recovery', name: '復能', category: 'C' },
};

const slot = (courseId, startsAt = '09:00') => ({ courseId, entitlementId: 'e1', startsAt });
const visit = (status, slots) => ({
  id: 'v1', customerId: 'cust1', date: '2026-08-27', status, slots, note: null, confirmedAt: null,
});

describe('這一筆來訪還收不收得下新的時段', () => {
  test('待確認與已確認都收得下', () => {
    assert.equal(acceptsMoreSlots('pending_confirm'), true);
    assert.equal(acceptsMoreSlots('confirmed'), true);
  });

  test('已完成與未到收不下 —— 那一天已經結案了', () => {
    // 收下去的話那一段會當場被 slotOutcome() 算成做完／沒來，額度立刻扣一次，
    // 而且不會長出任何一張「簽療程單」。
    assert.equal(acceptsMoreSlots('done'), false);
    assert.equal(acceptsMoreSlots('no_show'), false);
  });

  test('取消的也收不下', () => {
    assert.equal(acceptsMoreSlots('cancelled'), false);
  });
});

describe('把一段併進同一天已經有的來訪', () => {
  test('併進待確認的那一筆：狀態不動', () => {
    const before = visit('pending_confirm', [slot('c-checkup')]);
    const { visit: after, reopened } = withExtraSlot(before, slot('c-checkup', '10:00'));

    assert.equal(reopened, false);
    assert.equal(after.status, 'pending_confirm');
    assert.equal(after.slots.length, 2);
  });

  test('併進已確認的那一筆：整筆退回等客戶回覆', () => {
    const before = { ...visit('confirmed', [slot('c-checkup')]), confirmedAt: '2026-08-26T10:00:00Z' };
    const { visit: after, reopened } = withExtraSlot(before, slot('c-checkup', '10:00'));

    assert.equal(reopened, true, '她還沒跟客人講過新加的這一段');
    assert.equal(after.status, INITIAL_STATUS);
    assert.equal(after.slots.length, 2);
  });

  test('退回時 confirmedAt 一起清掉', () => {
    // 留著的話詳情頁會寫「客戶已確認」的時間戳，而那一筆現在是待確認的。
    const before = { ...visit('confirmed', [slot('c-checkup')]), confirmedAt: '2026-08-26T10:00:00Z' };
    const { visit: after } = withExtraSlot(before, slot('c-checkup', '10:00'));
    assert.equal(after.confirmedAt, null);
  });

  // 那一句話 2026-09-09 搬到時段上了（ADR-0084），所以這一支不再收 `note`。
  // 整筆那一格只留給還沒被搬過的舊資料 —— **原封不動帶著走**，
  // 清掉的話她那一句在被 `withSlotNotes()` 搬到第一段之前就先不見了。
  test('整筆那一句原封不動 —— 它只留給還沒搬過的舊資料', () => {
    const before = { ...visit('pending_confirm', [slot('c-checkup')]), note: '她說下午比較好' };
    assert.equal(withExtraSlot(before, slot('c-checkup')).visit.note, '她說下午比較好');
  });

  test('新加的那一段帶著自己的那一句', () => {
    const before = visit('pending_confirm', [slot('c-checkup')]);
    const { visit: after } = withExtraSlot(before, { ...slot('c-recovery'), note: '這一段的' });
    assert.equal(after.slots[1].note, '這一段的');
    assert.equal(after.slots[0].note, undefined, '別段一個字都不動');
  });

  test('原本的時段一個都不會少', () => {
    const before = visit('pending_confirm', [slot('c-checkup', '09:00'), slot('c-recovery', '11:00')]);
    const { visit: after } = withExtraSlot(before, slot('c-followup', '14:00'));
    assert.deepEqual(after.slots.map((s) => s.startsAt), ['09:00', '11:00', '14:00']);
  });
});

describe('壓在哪個系統', () => {
  test('健檢是 Examine，不是 Abovee', () => {
    assert.equal(bookingSystemLabel(visit('pending_confirm', [slot('c-checkup')]), COURSES), 'Examine');
  });

  test('復能與二返是 Abovee', () => {
    assert.equal(bookingSystemLabel(visit('pending_confirm', [slot('c-recovery')]), COURSES), 'Abovee');
    assert.equal(bookingSystemLabel(visit('pending_confirm', [slot('c-followup')]), COURSES), 'Abovee');
  });

  test('同一天兩種都有就兩個都講 —— 她真的要去兩個地方壓', () => {
    const v = visit('pending_confirm', [slot('c-recovery'), slot('c-checkup')]);
    assert.equal(bookingSystemLabel(v, COURSES), 'Abovee 與 Examine');
  });

  test('認不得的課程當成 Abovee，不要留白', () => {
    assert.equal(bookingSystemLabel(visit('pending_confirm', [slot('c-gone')]), COURSES), 'Abovee');
  });
});

describe('壓表那一道確認要講的話', () => {
  const ask = (o) => bookingConsequences({ coursesById: COURSES, ...o });

  test('健檢的抬頭寫 Examine', () => {
    const said = ask({ visit: visit('pending_confirm', [slot('c-checkup')]) });
    assert.equal(said.title, '已經在 Examine 壓好表了嗎？');
  });

  test('新的一筆：講記到哪、標成什麼、產生哪張待辦', () => {
    const said = ask({ visit: visit('pending_confirm', [slot('c-checkup')]) });
    assert.deepEqual(said.lines, [
      '會記到日曆上，標成「待確認」',
      '待辦會多一張「跟客人確認時間」',
    ]);
  });

  test('併進已確認的那一筆：一定要講出「會退回」', () => {
    const said = ask({
      visit: visit('pending_confirm', [slot('c-checkup'), slot('c-checkup', '10:00')]),
      merge: { reopened: true },
    });
    assert.ok(
      said.lines.some((l) => l.includes('會退回')),
      '不講的話她會以為新加的那一段也是談定的',
    );
    assert.ok(said.lines.some((l) => l.includes('那天變成 2 段')));
    assert.ok(said.lines.some((l) => l.includes('跟客人確認時間')));
  });

  test('併進待確認的那一筆：不要說會退回 —— 它本來就在等', () => {
    const said = ask({
      visit: visit('pending_confirm', [slot('c-checkup'), slot('c-checkup', '10:00')]),
      merge: { reopened: false },
    });
    assert.ok(!said.lines.some((l) => l.includes('會退回')));
  });

  test('A 類才預告登記待辦，健檢不預告', () => {
    const a = ask({ visit: visit('pending_confirm', [slot('c-followup')]) });
    assert.ok(a.lines.some((l) => l.includes('Examine') && l.includes('耀聖')));

    const b = ask({ visit: visit('pending_confirm', [slot('c-checkup')]) });
    assert.ok(!b.lines.some((l) => l.includes('等客人說可以之後')));
  });

  // 22：「等客人說可以之後，待辦會再多一張 X」只講這次新加的那幾段（逐段掛號，ADR-0107）
  const registered = ['Examine', '耀聖'].map((kind) => ({
    id: `t-${kind}`, visitId: 'v1', kind, done: false, autoGenerated: true, slotIndexes: [0],
  }));
  // 門診那一段早就談定、掛好號了；第二段是這次新加的
  const dayWithDoor = (added) => visit('pending_confirm', [
    { ...slot('c-followup'), status: 'confirmed' }, { ...slot(added, '11:00'), status: 'pending_confirm' },
  ]);
  const later = (said) => said.lines.filter((l) => l.startsWith('等客人說可以之後'));
  const grown = (v, added, tasks) => {
    const all = [...tasks, ...syncTasks(v, tasks, { coursesById: COURSES, today: '2026-08-20' }).create];
    let settled = v;
    for (const i of added) settled = applyStatusFor(settled, 'confirmed', { slotIndex: i });
    return syncTasks(settled, all, { coursesById: COURSES, today: '2026-08-20' }).create.map((t) => t.kind).sort();
  };

  test('已掛好 Examine 的門診那一天，加一段復能 → 那一句不出現', () => {
    const v = dayWithDoor('c-recovery');
    const said = ask({ visit: v, merge: { reopened: true }, added: [1], tasks: registered });
    assert.deepEqual(later(said), []);
    assert.deepEqual(grown(v, [1], registered), [], '真的也一張都不長');
  });

  test('同一天再加一段門診 → 會再多一張「Examine」、一張「耀聖」', () => {
    const v = dayWithDoor('c-followup');
    const said = ask({ visit: v, merge: { reopened: true }, added: [1], tasks: registered });
    assert.deepEqual(later(said), ['等客人說可以之後，待辦會再多一張「Examine」、一張「耀聖」']);
    assert.deepEqual(grown(v, [1], registered), ['Examine', '耀聖'], '跟真的長的一樣');
  });

  test('全新的一天、一段門診 → 同上', () => {
    const v = visit('pending_confirm', [slot('c-followup')]);
    const said = ask({ visit: v });
    assert.deepEqual(later(said), ['等客人說可以之後，待辦會再多一張「Examine」、一張「耀聖」']);
    assert.deepEqual(grown(v, [0], []), ['Examine', '耀聖']);
  });

  test('同步沒設定就不要承諾試算表會動', () => {
    const off = ask({ visit: visit('pending_confirm', [slot('c-checkup')]) });
    assert.ok(!off.lines.some((l) => l.includes('試算表')));

    const on = ask({ visit: visit('pending_confirm', [slot('c-checkup')]), sheetSyncOn: true });
    assert.ok(on.lines.some((l) => l.includes('試算表')));
  });
});

describe('勾掉「跟客人確認時間」之後', () => {
  test('講的是顏色變了，不是「加進日曆」', () => {
    // 那一筆壓表的時候就已經在日曆上了。
    const lines = confirmConsequences([visit('pending_confirm', [slot('c-checkup')])], COURSES);
    assert.ok(lines[0].includes('日曆上'));
    assert.ok(lines[0].includes('待確認') && lines[0].includes('已確認'));
    assert.ok(!lines.some((l) => l.includes('加進日曆')));
  });

  test('要簽療程單的才講簽療程單', () => {
    const checkup = confirmConsequences([visit('pending_confirm', [slot('c-checkup')])], COURSES);
    assert.ok(checkup.some((l) => l.includes('簽療程單')));

    // 二返是唯一不用簽的（回院聽報告，沒有療程可以扣）
    const followup = confirmConsequences([visit('pending_confirm', [slot('c-followup')])], COURSES);
    assert.ok(!followup.some((l) => l.includes('簽療程單')));
  });

  test('A 類會講出那兩張登記待辦', () => {
    const lines = confirmConsequences([visit('pending_confirm', [slot('c-followup')])], COURSES);
    assert.ok(lines.some((l) => l.includes('Examine') && l.includes('耀聖')));
  });
});

describe('結案那一下會發生什麼', () => {
  const ENTS = [
    { id: 'e-checkup', courseId: 'c-checkup', totalQty: 3 },
    { id: 'e-followup', courseId: 'c-followup', totalQty: 3, followupForEntitlementId: 'e-checkup' },
    { id: 'e-recovery', courseId: 'c-recovery', totalQty: 12 },
  ];
  const COURSES2 = { ...COURSES, 'c-checkup': { ...COURSES['c-checkup'], followupCourseId: 'c-followup' } };

  const slotFor = (entitlementId, courseId) => ({ entitlementId, courseId, startsAt: '09:00' });
  const ask = (o) => closeConsequences({ entitlements: ENTS, coursesById: COURSES2, ...o });

  test('有做：改成已完成、扣次數', () => {
    const lines = ask({ visit: visit('confirmed', [slotFor('e-recovery', 'c-recovery')]), doneCount: 1 });
    assert.ok(lines[0].includes('已完成'));
    assert.ok(lines[0].includes('扣掉次數'));
  });

  test('一段都沒做：改成未到、不扣次數', () => {
    const lines = ask({ visit: visit('confirmed', [slotFor('e-recovery', 'c-recovery')]), doneCount: 0 });
    assert.ok(lines[0].includes('未到'));
    assert.ok(lines[0].includes('不扣'));
  });

  test('健檢結案才講「追蹤健檢報告」', () => {
    const lines = ask({ visit: visit('confirmed', [slotFor('e-checkup', 'c-checkup')]), doneCount: 1 });
    assert.ok(lines.some((l) => l.includes('追蹤健檢報告')));
  });

  test('沒有健檢就不要講 —— 那是一件不會發生的事', () => {
    const lines = ask({ visit: visit('confirmed', [slotFor('e-recovery', 'c-recovery')]), doneCount: 1 });
    assert.ok(!lines.some((l) => l.includes('追蹤健檢報告')));
  });

  test('健檢整筆沒做也不講 —— 沒做完就沒有報告要追', () => {
    const lines = ask({ visit: visit('confirmed', [slotFor('e-checkup', 'c-checkup')]), doneCount: 0 });
    assert.ok(!lines.some((l) => l.includes('追蹤健檢報告')));
  });

  test('健檢沒配到二返額度就不講 —— 那時候鏈條長不出來', () => {
    const lines = closeConsequences({
      visit: visit('confirmed', [slotFor('e-checkup', 'c-checkup')]),
      doneCount: 1,
      entitlements: [ENTS[0]],
      coursesById: COURSES2,
    });
    assert.ok(!lines.some((l) => l.includes('追蹤健檢報告')));
  });

  test('同步沒設定就不要承諾試算表會動', () => {
    const off = ask({ visit: visit('confirmed', [slotFor('e-recovery', 'c-recovery')]), doneCount: 1 });
    assert.ok(!off.some((l) => l.includes('試算表')));
    const on = ask({ visit: visit('confirmed', [slotFor('e-recovery', 'c-recovery')]), doneCount: 1, sheetSyncOn: true });
    assert.ok(on.some((l) => l.includes('試算表')));
  });
});

// ---------------------------------------------------------------------------
// 拿回一張待辦
// ---------------------------------------------------------------------------

describe('拿回一張待辦會發生什麼', () => {
  const CHAIN_COURSES = {
    'c-checkup': { id: 'c-checkup', name: '健檢', category: 'B', followupCourseId: 'c-2nd' },
    'c-2nd': { id: 'c-2nd', name: '二返', category: 'A', needsTreatmentForm: false },
  };
  const CHAIN_ENTS = [
    { id: 'e-exam', type: 'single', courseId: 'c-checkup', totalQty: 3, doneCount: 1 },
    {
      id: 'e-2nd', type: 'single', courseId: 'c-2nd', totalQty: 3, doneCount: 0,
      // 配對是靠這一欄指回去的，不是靠課程比對（`pairsOf()`）
      followupForEntitlementId: 'e-exam',
    },
  ];
  const EXAM = {
    id: 'v-exam', customerId: 'cust1', date: '2026-08-20', status: 'done',
    slots: [{ courseId: 'c-checkup', entitlementId: 'e-exam', attended: true }],
  };
  /** 已經約好的那一場二返，指回那一次健檢。 */
  const BOOKED = {
    id: 'v-2nd', customerId: 'cust1', date: '2026-09-20', status: 'confirmed',
    slots: [{
      courseId: 'c-2nd', entitlementId: 'e-2nd', startsAt: '10:00',
      followupForVisitId: 'v-exam',
    }],
  };

  const reportTask = { id: 't-report', kind: '追蹤健檢報告', visitId: 'v-exam', customerId: 'cust1' };

  /** `previewTaskChange()` 回來的那一份的形狀。 */
  const preview = ({ remove = [], visits = [EXAM] }) => ({
    create: [], remove, visits, entitlements: CHAIN_ENTS, coursesById: CHAIN_COURSES,
  });

  test('會收掉兩張時，兩張各講一行，而且染紅', () => {
    const said = untickConsequences({
      task: reportTask,
      preview: preview({
        remove: [
          { id: 't-send', kind: '寄報告給醫師', visitId: 'v-exam' },
          { id: 't-book', kind: '約二返', visitId: 'v-exam' },
        ],
      }),
    });

    assert.ok(said);
    assert.equal(said.danger, true);
    assert.ok(said.title.includes('追蹤健檢報告'));
    assert.ok(said.lines.some((l) => l.includes('寄報告給醫師') && l.includes('收走')));
    assert.ok(said.lines.some((l) => l.includes('約二返') && l.includes('收走')));
    // 那一次健檢是哪一天
    assert.ok(said.lines.some((l) => l.includes('8/20')));
    // 還原得回來這件事一定要講
    assert.ok(said.lines.some((l) => l.includes('已刪除項目')));
  });

  test('什麼都不會被收走就回 null —— 不用問', () => {
    assert.equal(untickConsequences({ task: reportTask, preview: preview({}) }), null);
    // Examine 那一種根本走不到 preview（`previewTaskChange()` 回 null）
    assert.equal(untickConsequences({ task: reportTask, preview: null }), null);
  });

  test('被收走的清單裡只有它自己時不算 —— 那不是「別的張」', () => {
    const said = untickConsequences({
      task: reportTask,
      preview: preview({ remove: [{ id: 't-report', kind: '追蹤健檢報告', visitId: 'v-exam' }] }),
    });
    assert.equal(said, null);
  });

  test('二返已經約好時，講得出日期，而且明說那一筆來訪不會被動到', () => {
    const said = untickConsequences({
      task: reportTask,
      preview: preview({
        remove: [{ id: 't-send', kind: '寄報告給醫師', visitId: 'v-exam' }],
        visits: [EXAM, BOOKED],
      }),
    });

    const line = said.lines.find((l) => l.includes('9/20'));
    assert.ok(line, '要講出那一場二返約在哪一天');
    assert.ok(line.includes('不會被動到'), '要明說那一筆來訪不會被動到');

    // **一個字都不可以說「會取消二返」** —— 那是假的（ADR-0002），
    // 而嚇錯一次之後，真的該停的那一次她也不會停。
    for (const l of said.lines) {
      assert.ok(!/取消/.test(l), `這一句在嚇她：${l}`);
    }
  });

  test('沒約二返時就不要編一句「還沒約」 —— 那是在斷言不知道的事', () => {
    const said = untickConsequences({
      task: reportTask,
      preview: preview({ remove: [{ id: 't-send', kind: '寄報告給醫師', visitId: 'v-exam' }] }),
    });
    assert.ok(!said.lines.some((l) => l.includes('還沒約')));
  });
});

// ---------------------------------------------------------------------------
// 取消／刪掉一筆來訪
// ---------------------------------------------------------------------------

describe('取消一筆來訪會發生什麼', () => {
  const COURSES3 = {
    'c-checkup': { id: 'c-checkup', name: '健檢', category: 'B' },
    'c-recovery': { id: 'c-recovery', name: '復能', category: 'C' },
    'c-clinic': { id: 'c-clinic', name: '復健科門診', category: 'A' },
  };
  const exam = {
    id: 'v1', customerId: 'cust1', date: '2026-08-27', status: 'done',
    slots: [{ courseId: 'c-checkup', entitlementId: 'e1' }],
  };

  test('講得出是哪一個系統，不是三個並列', () => {
    const lines = cancelConsequences({ visit: exam, coursesById: COURSES3 });
    assert.ok(lines.some((l) => l.includes('取消 Examine')));
    assert.ok(!lines.some((l) => l.includes('Abovee')), '健檢不是在 Abovee 壓的');
  });

  test('一天同時有健檢與復能就兩個都講 —— 她真的要去兩個地方收', () => {
    const both = { ...exam, slots: [{ courseId: 'c-checkup' }, { courseId: 'c-recovery' }] };
    const lines = cancelConsequences({ visit: both, coursesById: COURSES3 });
    assert.ok(lines.some((l) => l.includes('取消 Examine')));
    assert.ok(lines.some((l) => l.includes('取消 Abovee')));
  });

  test('還沒做完的掛號與紀錄會被收掉，做完的不講', () => {
    const lines = cancelConsequences({
      visit: { ...exam, slots: [{ courseId: 'c-clinic' }] },
      coursesById: COURSES3,
      tasks: [
        { id: 't1', kind: 'Examine', done: false },
        { id: 't2', kind: '耀聖', done: true },
        { id: 't3', kind: '寫紀錄', done: false },
      ],
    });
    const dropLine = lines.find((l) => l.includes('會被收掉'));
    assert.ok(dropLine.includes('Examine'));
    assert.ok(dropLine.includes('寫紀錄'));
    // 做完的那一張真的做過了，不會被收掉
    assert.ok(!dropLine.includes('耀聖'));
  });

  test('健檢那條鏈另外講一句，並且說出為什麼', () => {
    const lines = cancelConsequences({
      visit: exam,
      coursesById: COURSES3,
      tasks: [{ id: 't1', kind: '追蹤健檢報告', done: false }],
    });
    const line = lines.find((l) => l.includes('追蹤健檢報告'));
    assert.ok(line);
    assert.ok(line.includes('那一場沒發生'));
  });

  test('取消類的那幾張不算「會被收掉」—— 它是這一下長出來的，方向剛好相反', () => {
    const lines = cancelConsequences({
      visit: exam,
      coursesById: COURSES3,
      tasks: [{ id: 't1', kind: '取消 Examine', done: false }],
    });
    const dropLine = lines.find((l) => l.includes('會被收掉'));
    assert.equal(dropLine, undefined, '沒有東西要收，就不要講那一句');
  });

  test('已經有那一張就不要再承諾一次 —— 同一種只長一張', () => {
    // 已經取消過、現在要刪掉：`syncTasksForVisit()` 的 `already` 擋著，
    // 不會多長任何東西。畫面上說「會多一張」是在講一件不會發生的事。
    const lines = cancelConsequences({
      visit: exam,
      coursesById: COURSES3,
      tasks: [{ id: 't1', kind: '取消 Examine', done: false }],
      removing: true,
    });
    assert.ok(!lines.some((l) => l.includes('會多一張')));
  });

  test('軟刪除的任務不算 —— 它已經不在了', () => {
    const lines = cancelConsequences({
      visit: exam,
      coursesById: COURSES3,
      tasks: [{ id: 't1', kind: 'Examine', done: false, deletedAt: '2026-09-01' }],
    });
    assert.ok(!lines.some((l) => l.includes('會被收掉')));
  });

  test('什麼任務都沒有的時候不要講那兩句', () => {
    const lines = cancelConsequences({ visit: exam, coursesById: COURSES3 });
    assert.ok(!lines.some((l) => l.includes('會被收掉')));
  });

  test('刪除那一條要說「標記刪除」與「還原得回來」', () => {
    const lines = cancelConsequences({ visit: exam, coursesById: COURSES3, removing: true });
    assert.ok(lines.some((l) => l.includes('標記刪除')));
    assert.ok(lines.some((l) => l.includes('已刪除項目')));
    assert.ok(!lines.some((l) => l.includes('暗掉的那一列')));
  });

  test('同步沒設定就不要承諾試算表會動', () => {
    const off = cancelConsequences({ visit: exam, coursesById: COURSES3 });
    assert.ok(!off.some((l) => l.includes('試算表')));
    const on = cancelConsequences({ visit: exam, coursesById: COURSES3, sheetSyncOn: true });
    assert.ok(on.some((l) => l.includes('試算表')));
  });
});

describe('取消一段 vs 取消一整天，講的話不一樣（ADR-0081）', () => {
  const v = {
    id: 'v1', status: 'confirmed', date: '2026-09-20',
    slots: [
      { courseId: 'c-checkup', entitlementId: 'e1' },
      { courseId: 'c-followup', entitlementId: 'e2' },
      { courseId: 'c-checkup', entitlementId: 'e3' },
    ],
  };

  test('只取消一段時，一個字都不要講到「整天」', () => {
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: 1 }).join('\n');
    assert.ok(!lines.includes('3 個時段'), '不可以說整筆的段數');
    assert.match(lines, /這一段/);
  });

  test('要講出那一天剩下幾段不受影響', () => {
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: 1 }).join('\n');
    assert.match(lines, /剩下的 2 段/);
  });

  test('只取消一段時，掛號那一張只講那一段用得到的系統', () => {
    // 那一天同時有健檢（B 類 → Examine）與二返（A 類 → Abovee）。
    // 取消二返那一段跟 Examine 一點關係都沒有 —— 講了她會白跑一趟。
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: 1 }).join('\n');
    assert.match(lines, /取消 Abovee/);
    assert.ok(!lines.includes('Examine'), '健檢那兩段還在，不要叫她去收 Examine');
  });

  test('最後一段也取消掉時，話要換成整天那一種', () => {
    const two = { ...v, slots: [v.slots[0], { ...v.slots[1], status: 'cancelled' }] };
    const lines = cancelConsequences({ visit: two, coursesById: COURSES, slotIndex: 0 }).join('\n');
    assert.match(lines, /那一天就整個取消了/);
  });

  test('沒帶 slotIndex 時一個字都沒有變', () => {
    const before = cancelConsequences({ visit: v, coursesById: COURSES });
    assert.match(before.join('\n'), /3 個時段會退回去/);
    assert.ok(!before.join('\n').includes('這一段'));
  });

  // ---- 一次取消同一天的好幾段（批次取消，ADR-0082）----
  //
  // 批次取消一次收掉十幾段，其中好幾段可能落在同一天。以前這裡只收得下
  // **一個** index，呼叫端只好挑第一個傳進來 —— 於是「剩下的 N 段」算的是
  // 「除了第一段以外還活著幾段」，把同一批要取消的其他段也算成了剩下的。
  //
  // 她看到「剩下的 2 段不受影響」，存完卻只剩 1 段。那一句話正是這一道確認框
  // 存在的理由（跨多個 commit 給不出復原），講錯就等於沒有煞車。

  test('同一天挑兩段：剩下的段數不算那兩段', () => {
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: [0, 1] }).join('\n');
    assert.match(lines, /剩下的 1 段/);
    assert.ok(!lines.includes('剩下的 2 段'), '同一批要取消的那幾段不可以算成「剩下的」');
  });

  test('挑好幾段時講的是「這 2 段」，不是「這一段」', () => {
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: [0, 1] }).join('\n');
    assert.match(lines, /這 2 段會退回去/);
    assert.ok(!lines.includes('這一段會退回去'));
  });

  test('挑好幾段時，掛號那幾張講的是那幾段的系統聯集', () => {
    // 0 是健檢（B 類 → Examine）、1 是二返（A 類 → Abovee）
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: [0, 1] }).join('\n');
    assert.match(lines, /取消 Examine/);
    assert.match(lines, /取消 Abovee/);
  });

  test('整天的段都挑滿了就退回整天那一種話', () => {
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: [0, 1, 2] }).join('\n');
    assert.match(lines, /那一天就整個取消了/);
    assert.ok(!lines.includes('不受影響'));
  });

  test('挑到一個不存在的段落就當它不存在，不要憑空多算一段', () => {
    const lines = cancelConsequences({ visit: v, coursesById: COURSES, slotIndex: [1, 9] }).join('\n');
    assert.match(lines, /這一段會退回去/);
    assert.match(lines, /剩下的 2 段/);
  });
});

const NL = String.fromCharCode(10);

describe('客人退掉的那一段不再承諾任何掛號（ADR-0081）', () => {
  test('退掉的是 A 類那一段 → 不要說「待辦會多一張 Examine」', () => {
    const v = {
      id: 'v1', customerId: 'c1', date: '2026-09-20', status: 'confirmed',
      slots: [
        { courseId: 'c-followup', status: 'cancelled' },
        { courseId: 'c-recovery', status: 'confirmed' },
      ],
    };
    const lines = confirmConsequences([v], COURSES).join(NL);
    assert.ok(!lines.includes('Examine'));
    assert.ok(!lines.includes('耀聖'));
  });

  test('還活著的那一段是 A 類就照樣講', () => {
    const v = {
      id: 'v1', customerId: 'c1', date: '2026-09-20', status: 'pending_confirm',
      slots: [
        { courseId: 'c-recovery', status: 'cancelled' },
        { courseId: 'c-followup', status: 'pending_confirm' },
      ],
    };
    const lines = confirmConsequences([v], COURSES).join(NL);
    assert.ok(lines.includes('Examine') && lines.includes('耀聖'), lines);
  });
});

describe('確認抽屜只講這一次真的會發生的（ADR-0097）', () => {
  // 她在日曆上先確認掉 A 類那一段（那一刻 Examine／耀聖就長出來了），再到待辦中心
  // 確認下午那一段 —— 卡片上說「待辦會多一張 Examine」是假話（ADR-0070）。
  const day = (a, b, courses = ['c-followup', 'c-recovery']) => ({
    id: 'v1', customerId: 'cust1', date: '2026-08-27', status: 'pending_confirm', confirmedAt: null,
    slots: [
      { ...slot(courses[0]), status: a },
      { ...slot(courses[1], '14:00'), status: b },
    ],
  });

  test('A 類那一段早就談定了 → 確認下午的 C 類，不說會多 Examine／耀聖', () => {
    const lines = confirmConsequences([day('confirmed', 'pending_confirm')], COURSES).join(NL);
    assert.ok(!lines.includes('Examine'), lines);
    assert.ok(!lines.includes('耀聖'), lines);
  });

  test('A 類那一段是這一次確認的 → 照樣講', () => {
    const lines = confirmConsequences([day('pending_confirm', 'confirmed')], COURSES).join(NL);
    assert.ok(lines.includes('Examine') && lines.includes('耀聖'), lines);
  });

  test('A 類那一段在抽屜裡被退掉 → 不講', () => {
    const lines = confirmConsequences(
      [day('pending_confirm', 'pending_confirm')], COURSES, false, new Set(['v1:0']),
    ).join(NL);
    assert.ok(!lines.includes('Examine'), lines);
  });

  // 以前是「一種一天只長一張」；她 2026-09-23：Examine 上是一段掛一筆
  // （prelaunch-audit-2026-09-23/issues/02），所以另一段談定了照樣多一張
  test('兩段都是 A 類、一段早就談定（也掛過了）→ 確認另一段照樣說會多一張', () => {
    const v = day('confirmed', 'pending_confirm', ['c-followup', 'c-followup']);
    const had = [{ id: 't1', visitId: 'v1', kind: 'Examine', slotIndexes: [0], done: true, autoGenerated: true }];
    assert.ok(confirmConsequences([v], COURSES, false, new Set(), { v1: had }).join(NL).includes('Examine'));
  });

  test('舊資料：那一天的 Examine 沒有 slotIndexes（蓋住整天）→ 不說會多一張', () => {
    const v = day('confirmed', 'pending_confirm', ['c-followup', 'c-followup']);
    const legacy = [{ id: 't1', visitId: 'v1', kind: 'Examine', done: true, autoGenerated: true }];
    assert.ok(!confirmConsequences([v], COURSES, false, new Set(), { v1: legacy }).join(NL).includes('Examine'));
  });
});

// ---------------------------------------------------------------------------

/**
 * **「按下去會發生什麼」那幾句只寫在 `domain/consequences.js`**（ADR-0070）。
 *
 * 批次取消那一頁自己寫了一次「十秒後自動同步到試算表」，而那個十秒是
 * `data/sheetSync.js` 的 `QUIET_MS` —— 改了那個常數，四個入口跟著改，
 * 自己寫的那一句不會。這條掃原始碼，因為那種分岔在畫面上看不出來：
 * 兩邊都印得出一句話，只是其中一句已經不是真的了。
 */
describe('畫面不自己寫後果那幾句', () => {
  const MINE = [
    '十秒後自動同步到試算表',
    '改期不是改日期，是取消後重新排一次',
    '次數也會還回來',
  ];

  test('那幾句一個字都沒有出現在 ui/ 底下', () => {
    const files = execFileSync('git', ['ls-files', 'public/js/ui'], { encoding: 'utf8' })
      .split(NL).filter((f) => f.endsWith('.js'));

    const offenders = [];
    for (const rel of files) {
      const src = readFileSync(fromRoot() + rel, 'utf8');
      src.split(NL).forEach((line, i) => {
        // 註解裡提到它是在解釋，不是在畫它
        const code = line.trim();
        if (code.startsWith('//') || code.startsWith('*')) return;
        for (const said of MINE) {
          if (code.includes(said)) offenders.push(`${rel}:${i + 1}　${code}`);
        }
      });
    }

    assert.deepEqual(offenders, [],
      `這幾句要走 domain/consequences.js，不要自己寫一次：${NL}${offenders.join(NL)}`);
  });
});

// 存檔前那一道「這幾段先看一下」（ADR-0070 的同一條線：只講真的會發生的事）。
describe('先看一下那一道（reviewWarnings）', () => {
  test('一句都沒有就不用問 —— 呼叫端拿 null 當閘門', () => {
    assert.equal(reviewWarnings([]), null);
    assert.equal(reviewWarnings(), null);
    assert.equal(reviewWarnings(['', '   ']), null, '空字串不算一件事');
  });

  test('句子照抄，不重寫一遍', () => {
    const said = reviewWarnings(['「復能-三選一(60)」排完這次會超過總次數', '第 2 個時段還沒選治療師']);
    assert.deepEqual(said.lines, ['「復能-三選一(60)」排完這次會超過總次數', '第 2 個時段還沒選治療師']);
  });

  test('抬頭講出幾件', () => {
    assert.equal(reviewWarnings(['一件事']).title, '這一件先看一下');
    assert.equal(reviewWarnings(['a', 'b', 'c']).title, '這 3 件先看一下');
  });

  test('兩顆按鈕都講出按下去會怎樣，不是「確定／取消」', () => {
    const said = reviewWarnings(['x']);
    assert.equal(said.confirmLabel, '知道了，繼續');
    assert.equal(said.cancelLabel, '回去改');
  });
});

// ---------------------------------------------------------------------------
// 確認框講的「會多一張取消 X」跟真的會長出來的共用同一段身體
// （ADR-0070、`.scratch/asks-2026-09-13/issues/02`）。

describe('取消幾段時，「會多一張」跟 syncTasksForVisit() 長出來的一模一樣', () => {
  const C = {
    'c-recovery': { id: 'c-recovery', name: '復能', category: 'C' },
    'c-followup': { id: 'c-followup', name: '二返', category: 'A' },
  };
  const base = {
    id: 'v1', customerId: 'c1', date: '2026-09-20', status: 'confirmed',
    slots: [
      { courseId: 'c-followup', status: 'confirmed' },
      { courseId: 'c-recovery', status: 'confirmed' },
      { courseId: 'c-recovery', status: 'confirmed' },
    ],
  };

  test('Examine 與耀聖勾過、只取消二返那一段 → 講得出那兩張', () => {
    const tasks = [
      { id: 'e', visitId: 'v1', kind: 'Examine', done: true, autoGenerated: true },
      { id: 'y', visitId: 'v1', kind: '耀聖', done: true, autoGenerated: true },
    ];
    const lines = cancelConsequences({ visit: base, coursesById: C, tasks, slotIndex: 0 }).join(NL);
    assert.match(lines, /取消 Abovee/);
    assert.match(lines, /取消 Examine/);
    assert.match(lines, /取消 耀聖/);
  });

  test('上次取消那一段的「取消 Abovee」勾掉了，這次取消另一段 → 照樣說會多一張', () => {
    const visit = { ...base, slots: base.slots.map((s, i) => (i === 1 ? { ...s, status: 'cancelled' } : s)) };
    const tasks = [{ id: 't', visitId: 'v1', kind: '取消 Abovee', done: true, autoGenerated: true, slotIndexes: [1] }];
    const lines = cancelConsequences({ visit, coursesById: C, tasks, slotIndex: 2 }).join(NL);
    assert.match(lines, /會多一張「取消 Abovee」/);
  });

  test('只取消復能那一段、Examine 勾過 → 不講 Examine', () => {
    const tasks = [{ id: 'e', visitId: 'v1', kind: 'Examine', done: true, autoGenerated: true }];
    const lines = cancelConsequences({ visit: base, coursesById: C, tasks, slotIndex: 2 }).join(NL);
    assert.ok(!lines.includes('Examine'));
  });
});

// 批次取消把某一天剩下的段全部挑走時，存下去走的是整天取消那條路（`applyStatus()`
// 推得出整筆 cancelled）。確認框也要照那一條算 —— 不然歷史資料裡勾掉的「Abovee」
// 那種登記，框上不講、存完卻多一張（2026-09-13 審查抓到的）。
import { syncTasksForVisit as syncTasks } from '../public/js/domain/taskRules.js';
import { applyStatus as applyStatusFor } from '../public/js/domain/visits.js';

describe('挑走那一天剩下的每一段 = 整天取消，框上講的跟長出來的一樣', () => {
  const C = { 'c-checkup': { id: 'c-checkup', name: '健檢', category: 'B' } };
  const visit = {
    id: 'v1', customerId: 'c1', date: '2026-09-20', status: 'confirmed',
    slots: [{ courseId: 'c-checkup', status: 'cancelled' }, { courseId: 'c-checkup', status: 'confirmed' }],
  };
  const tasks = [
    { id: 'old', visitId: 'v1', kind: 'Abovee', done: true, autoGenerated: true },
    { id: 'ce', visitId: 'v1', kind: '取消 Examine', done: true, autoGenerated: true, slotIndexes: [0] },
  ];

  test('框上講的「會多一張」與 syncTasksForVisit() 真的長出來的是同幾種', () => {
    const lines = cancelConsequences({ visit, coursesById: C, tasks, slotIndex: 1 }).join(NL);
    const after = applyStatusFor(visit, 'cancelled', { slotIndex: 1 });
    const grown = syncTasks(after, tasks, { coursesById: C, today: '2026-09-13' }).create.map((t) => t.kind);
    for (const kind of grown) assert.match(lines, new RegExp(`會多一張「${kind}」`), `${kind} 會長出來，框上卻沒講`);
    assert.equal((lines.match(/會多一張/g) ?? []).length, grown.length, lines);
  });
});


// ---------- 改期＝取消＋重新排（prelaunch-audit-2026-09-23/issues/13） ----------
//
// 她 2026-09-23：「我希望會提醒回 Abovee／Examine／耀聖改時間以及回去取消已經掛好的號等等」
// 選的是 A：舊那一段標成取消、新的時間接在尾巴一段待確認（SPEC 第 7 節規則 10）。

import { rebookSlot, visitStatusFrom, slotStatus } from '../public/js/domain/visits.js';
import { rebookConsequences } from '../public/js/domain/consequences.js';

describe('改這一段改了時間或課程 → 取消＋重新排', () => {
  const C = { 'c-rehab': { id: 'c-rehab', name: '門診', category: 'A' }, 'c-recovery': { id: 'c-recovery', name: '復能', category: 'C' } };
  const settled = (over = {}) => ({
    id: 'v1', customerId: 'c1', customerName: '客戶A', date: '2026-09-20', status: 'confirmed', confirmedAt: 'x',
    slots: [{ courseId: 'c-rehab', entitlementId: 'e1', startsAt: '14:00', endsAt: '14:30', status: 'confirmed', ...over }],
  });
  const ticked = (kind) => ({ id: `t-${kind}`, visitId: 'v1', kind, done: true, doneAt: '2026-09-19', autoGenerated: true, slotIndexes: [0] });

  test('改時間：舊那一段取消、新的接在尾巴待確認，整天退回待確認', () => {
    const before = settled();
    const after = rebookSlot(before, 0, { ...before.slots[0], startsAt: '16:00', endsAt: '16:30' });
    assert.deepEqual(after.slots.map((s) => [s.startsAt, s.status]), [['14:00', 'cancelled'], ['16:00', 'pending_confirm']]);
    assert.equal(after.status, 'pending_confirm');
    assert.equal(after.confirmedAt, null);
  });

  test('換課程也算；待確認那一段改時間也算（Abovee 上壓的還是舊時間）', () => {
    const before = settled();
    assert.ok(rebookSlot(before, 0, { ...before.slots[0], courseId: 'c-recovery' }));
    const pending = settled({ status: 'pending_confirm' });
    assert.ok(rebookSlot(pending, 0, { ...pending.slots[0], startsAt: '16:00' }));
  });

  test('回來的那一筆，整筆的狀態＝ visitStatusFrom()（四種都釘住；不要改走 applyStatus()）', () => {
    const rehab = (startsAt, status) => ({ courseId: 'c-rehab', entitlementId: 'e1', startsAt, endsAt: startsAt.replace(':00', ':30'), status });
    const day = (status, slots) => ({ ...settled(), status, slots });
    for (const [name, before, index] of [
      ['一天一段已確認', day('confirmed', [rehab('14:00', 'confirmed')]), 0],
      ['一天一段待確認', day('pending_confirm', [rehab('14:00', 'pending_confirm')]), 0],
      ['兩段改第二段', day('confirmed', [rehab('10:00', 'confirmed'), rehab('14:00', 'confirmed')]), 1],
      ['已確認＋已取消', day('confirmed', [rehab('10:00', 'confirmed'), rehab('14:00', 'cancelled')]), 0],
    ]) {
      const after = rebookSlot(before, index, { ...before.slots[index], startsAt: '16:00', endsAt: '16:30' });
      assert.equal(after.status, visitStatusFrom(after), name);
      // 看**算出來的**狀態，不看那一格字：整筆被推成已取消時，那一格寫著待確認也是死的
      assert.equal(slotStatus(after, after.slots.at(-1)), 'pending_confirm', `${name}：新那一段是活的`);
      assert.equal(after.status, 'pending_confirm', `${name}：整天退回待確認`);
    }
  });

  test('只改治療師、醫師、診間、記一句 → 不用（原地改）', () => {
    const before = settled();
    const same = { ...before.slots[0], therapistId: 's2', doctorId: 'd2', roomId: 'r2', note: '改約下午' };
    assert.equal(rebookSlot(before, 0, same), null);
  });

  test('已完成／未到／已取消的那一段 → 不用（那是更正，不是改期）', () => {
    for (const status of ['done', 'no_show', 'cancelled']) {
      const before = settled({ status });
      assert.equal(rebookSlot(before, 0, { ...before.slots[0], startsAt: '16:00' }), null, status);
    }
  });

  test('確認框講得出要回 Abovee、Examine、耀聖做什麼（掛過的才講），也說新的那一段要再問客人', () => {
    const before = settled();
    const after = rebookSlot(before, 0, { ...before.slots[0], startsAt: '16:00', endsAt: '16:30' });
    const { lines } = rebookConsequences({ before, after, index: 0, tasks: [ticked('Examine'), ticked('耀聖')], coursesById: C });
    const said = lines.join(NL);
    for (const k of ['取消 Abovee', '取消 Examine', '取消 耀聖']) assert.ok(said.includes(k), `${k}\n${said}`);
    assert.match(said, /再問客人/);
    // 沒掛過號就沒有東西要收
    const none = rebookConsequences({ before, after, index: 0, tasks: [], coursesById: C }).lines.join(NL);
    assert.ok(!none.includes('取消 Examine'), none);
    assert.ok(none.includes('取消 Abovee'), '壓表那一格一定要回去放');
  });

  test('確認框講的跟真的會長的一樣（同一支 cancelTasksFor()）', () => {
    const before = settled();
    const after = rebookSlot(before, 0, { ...before.slots[0], startsAt: '16:00', endsAt: '16:30' });
    const tasks = [ticked('Examine'), ticked('耀聖')];
    const { create } = syncTasks(after, tasks, { coursesById: C, today: '2026-09-18' });
    const said = rebookConsequences({ before, after, index: 0, tasks, coursesById: C }).lines.join(NL);
    for (const t of create) assert.ok(said.includes(t.kind), t.kind);
    assert.ok(!create.some((t) => ['Examine', '耀聖'].includes(t.kind)), '新的那一段還沒談定，不長掛號');
  });

  // 15：「等客人說可以之後，待辦會再多一張 X」跟真的走一次「改期 → 存 → 新那一段確認 → 存」一樣
  const saidLater = (lines) => {
    const line = lines.find((l) => l.startsWith('等客人說可以之後')) ?? '';
    return [...line.matchAll(/「([^」]+)」/g)].map((m) => m[1]).sort();
  };
  const grownLater = (before, after, tasks) => {
    const saved = [...tasks, ...syncTasks(after, tasks, { coursesById: C, today: '2026-09-18' }).create];
    const confirmed = applyStatusFor(after, 'confirmed', { slotIndex: after.slots.length - 1 });
    return syncTasks(confirmed, saved, { coursesById: C, today: '2026-09-18' }).create
      .map((t) => t.kind).filter((k) => !k.startsWith('取消')).sort();
  };

  for (const [name, tasks] of [
    ['掛號待辦帶 slotIndexes', [ticked('Examine'), ticked('耀聖')]],
    ['舊的掛號待辦（沒有 slotIndexes，當成蓋住整天）', [ticked('Examine'), ticked('耀聖')].map(({ slotIndexes, ...t }) => t)],
    ['還沒有任何待辦', []],
  ]) {
    test(`「會再多一張」＝ 新那一段談定之後真的長的：${name}`, () => {
      const before = settled();
      const after = rebookSlot(before, 0, { ...before.slots[0], startsAt: '16:00', endsAt: '16:30' });
      const { lines } = rebookConsequences({ before, after, index: 0, tasks, coursesById: C });
      assert.deepEqual(saidLater(lines), grownLater(before, after, tasks));
    });
  }

  test('換成不長掛號的課程（C 類）→ 那一句不出現', () => {
    const before = settled();
    const after = rebookSlot(before, 0, { ...before.slots[0], courseId: 'c-recovery' });
    const { lines } = rebookConsequences({ before, after, index: 0, tasks: [], coursesById: C });
    assert.deepEqual(saidLater(lines), []);
  });
});
