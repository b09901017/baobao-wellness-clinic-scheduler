// 待辦中心的流程分段。SPEC 第 8.1 節、ADR-0043。
//
// 這一支盯的是「順序」這件事本身：她要的是「下一步是什麼」，而畫面能回答那句
// 的前提是段落的順序與段裡的順序都不是碰巧。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGES, stageOf, orderOf, groupByStage, nextStage, RETIRED_KINDS, isRetired,
  groupByDoneDay,
  todosForVisit,
} from '../public/js/domain/todoFlow.js';
import {
  FOLLOWUP_TASK_KIND, REPORT_TASK_KIND, SEND_REPORT_TASK_KIND,
} from '../public/js/domain/followups.js';
import { TASK_KINDS, cancelKindFor, RECORD_TASK_KIND } from '../public/js/domain/taskRules.js';

describe('流程的段', () => {
  test('七段，編號就是流程的第幾步', () => {
    assert.deepEqual(STAGES.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7]);
    assert.deepEqual(
      STAGES.map((s) => s.id),
      ['ask', 'book', 'confirm', 'before', 'onday', 'after', 'undo'],
    );
  });

  test('一個新色相都不開 —— 借的是來訪狀態色（ADR-0039）', () => {
    const tones = new Set(STAGES.map((s) => s.tone));
    assert.deepEqual(
      [...tones].sort(),
      ['confirmed', 'done', 'no-show', 'none', 'onday', 'pending'],
    );
  });

  test('每一種現行的待辦都歸得了段', () => {
    const rows = ['ask', 'forms', 'book', 'confirm', 'close', ...TASK_KINDS,
      RECORD_TASK_KIND, REPORT_TASK_KIND, SEND_REPORT_TASK_KIND, FOLLOWUP_TASK_KIND];
    for (const id of rows) {
      assert.ok(STAGES.some((s) => s.id === stageOf(id)), `${id} 歸不了段`);
    }
  });

  test('取消類一律歸「要收回來的」，不管是取消哪一個系統', () => {
    for (const kind of ['Abovee', 'Examine', '耀聖']) {
      assert.equal(stageOf(cancelKindFor(kind)), 'undo');
    }
  });

  test('認不得的當成來訪之前要做的事，不要丟到最後一段', () => {
    // 只有兩種來源：已經拿掉的那幾種，與她手動加的。兩種都是來訪之前的事，
    // 而它們可能是今天就該做的 —— 排到「要收回來的」等於藏起來。
    for (const kind of [...RETIRED_KINDS, '她自己加的一件事', undefined]) {
      assert.equal(stageOf(kind), 'before', String(kind));
    }
  });
});

describe('段裡的順序', () => {
  test('追蹤報告排在約二返前面 —— 死線排不出這個順序', () => {
    assert.ok(orderOf(REPORT_TASK_KIND) < orderOf(FOLLOWUP_TASK_KIND));
  });

  // ADR-0065：寄報告與約二返的死線一模一樣，所以先後只能由 FLOW 那一份決定。
  // 她自己標的順序是「(1) 寄報告 (2) 三系統」，而約二返比三系統更前面。
  test('寄報告排在追蹤報告之後、約二返之前', () => {
    assert.ok(orderOf(REPORT_TASK_KIND) < orderOf(SEND_REPORT_TASK_KIND));
    assert.ok(orderOf(SEND_REPORT_TASK_KIND) < orderOf(FOLLOWUP_TASK_KIND));
    assert.equal(stageOf(SEND_REPORT_TASK_KIND), 'after');
  });

  // ADR-0066：寫紀錄是客人走了之後立刻做的，追蹤報告是三週後的事。
  // 照死線排的話這兩張的先後是對的，但「照死線排」本身是錯的（ADR-0043）。
  test('寫紀錄排在「來訪之後」那一段的最前面', () => {
    assert.equal(stageOf(RECORD_TASK_KIND), 'after');
    assert.ok(orderOf(RECORD_TASK_KIND) < orderOf(REPORT_TASK_KIND));
  });

  test('認不得的排段裡最後 —— 不擋在該做的事前面', () => {
    assert.ok(orderOf('打電話') > orderOf('Examine'));
    assert.ok(orderOf('打電話') > orderOf('耀聖'));
  });

  test('groupByStage 照 STAGES 的順序回，空的段也留著', () => {
    const groups = groupByStage([{ id: 'Examine' }]);
    assert.deepEqual(groups.map((g) => g.stage.id), STAGES.map((s) => s.id));
    assert.deepEqual(groups.find((g) => g.stage.id === 'before').rows, [{ id: 'Examine' }]);
    assert.deepEqual(groups.find((g) => g.stage.id === 'ask').rows, []);
  });

  test('段裡照流程排，不照丟進來的順序', () => {
    const rows = [
      { id: FOLLOWUP_TASK_KIND }, { id: SEND_REPORT_TASK_KIND }, { id: REPORT_TASK_KIND },
    ];
    const after = groupByStage(rows).find((g) => g.stage.id === 'after');
    assert.deepEqual(
      after.rows.map((r) => r.id),
      [REPORT_TASK_KIND, SEND_REPORT_TASK_KIND, FOLLOWUP_TASK_KIND],
    );
  });
});

describe('下一步', () => {
  test('是流程上最前面那個還有東西的段，不是數字最大的', () => {
    assert.equal(nextStage({ ask: 0, book: 2, after: 99 }).id, 'book');
  });

  test('什麼都沒有就是 null', () => {
    assert.equal(nextStage({}), null);
    assert.equal(nextStage({ ask: 0 }), null);
  });
});

describe('拿掉的種類', () => {
  test('打電話與 Abovee，兩種都不再產生（ADR-0041）', () => {
    assert.deepEqual(RETIRED_KINDS, ['打電話', 'Abovee']);
    assert.ok(isRetired('打電話'));
    assert.ok(!isRetired('Examine'));
  });

  test('拿掉的種類一個都不在現行的 TASK_KINDS 裡', () => {
    for (const kind of RETIRED_KINDS) {
      assert.ok(!TASK_KINDS.includes(kind), `${kind} 還在 TASK_KINDS 裡`);
    }
  });
});

// 「已完成」那一格是條列式往下，中間插日期分隔 ——
// 她的原話是「會有今天(完成的) 幾月幾號等等」（`.scratch/asks-2026-08-25/issues/08`）。
describe('已完成照完成那一天分段', () => {
  const t = (id, doneAt) => ({ id, kind: 'Examine', done: true, doneAt });

  test('新的一天在前，同一天的照原本的順序', () => {
    const groups = groupByDoneDay([
      t('a', '2026-08-24T02:00:00.000Z'),
      t('b', '2026-08-25T02:00:00.000Z'),
      t('c', '2026-08-25T06:00:00.000Z'),
    ]);
    assert.deepEqual(groups.map((g) => g.day), ['2026-08-25', '2026-08-24']);
    assert.deepEqual(groups[0].tasks.map((x) => x.id), ['b', 'c']);
  });

  test('讀不出完成時間的收在最後，不丟掉也不猜一天', () => {
    const groups = groupByDoneDay([t('a', null), t('b', '2026-08-25T02:00:00.000Z')]);
    assert.deepEqual(groups.map((g) => g.day), ['2026-08-25', null]);
    assert.deepEqual(groups[1].tasks.map((x) => x.id), ['a']);
  });

  test('什麼都沒有時回空陣列', () => {
    assert.deepEqual(groupByDoneDay(), []);
  });
});

// ---------------------------------------------------------------------------
// 一筆來訪身上的整份待辦（讀取卡片底下那一塊）
// ---------------------------------------------------------------------------

describe('這一場走到哪了（todosForVisit）', () => {
  const TODAY = '2026-09-04';
  const COURSES = {
    'c-drip': { id: 'c-drip', name: '營養點滴', category: 'C' },
    'c-2nd': { id: 'c-2nd', name: '二返', category: 'A', needsTreatmentForm: false },
  };
  const base = (over = {}) => ({
    id: 'v1', customerId: 'cust1', date: TODAY, status: 'confirmed',
    slots: [{ courseId: 'c-drip', entitlementId: 'e1' }],
    ...over,
  });
  const ask = (visit, tasks = []) =>
    todosForVisit(visit, { tasks, coursesById: COURSES, today: TODAY });
  const kinds = (rows) => rows.map((r) => r.kind);

  test('推導的兩列也要在 —— 她每天做最多次的就是那兩件', () => {
    const rows = ask(base({ status: 'pending_confirm' }));
    assert.ok(kinds(rows).includes('跟客人確認時間'));
    assert.ok(kinds(rows).some((k) => k.startsWith('簽療程單')));
    assert.ok(rows.every((r) => r.derived), '這兩列不在 tasks 集合裡');
  });

  test('**做完的不消失，只是勾起來**（2026-09-04 她指名的）', () => {
    // 一列消失了她分不出「做完了」跟「這一場沒有這一件」
    const rows = ask(base({ status: 'confirmed' }));
    const confirm = rows.find((r) => r.kind === '跟客人確認時間');
    assert.ok(confirm, '已確認之後那一列還要在');
    assert.equal(confirm.done, true, '而且是勾起來的');
  });

  test('日子還沒到，「簽療程單」也列出來 —— 她要看到這一場的全部', () => {
    const rows = ask(base({ date: '2026-09-30', status: 'confirmed' }));
    const close = rows.find((r) => r.kind.startsWith('簽療程單'));
    assert.ok(close);
    assert.equal(close.done, false);
  });

  test('結案之後兩列都勾起來', () => {
    const rows = ask(base({ status: 'done' }));
    for (const kind of ['跟客人確認時間', '簽療程單']) {
      const row = rows.find((r) => r.kind.startsWith(kind));
      assert.ok(row, kind);
      assert.equal(row.done, true, kind);
    }
  });

  test('整天都是二返的那一筆講明「不用簽，但要結案」', () => {
    const rows = ask(base({ slots: [{ courseId: 'c-2nd', entitlementId: 'e2' }] }));
    const line = kinds(rows).find((k) => k.startsWith('簽療程單'));
    assert.ok(line.includes('不用簽'));
    assert.ok(line.includes('結案'), '不用簽跟不用收尾是兩件事');
  });

  test('已結案的那一筆，「簽療程單」要看得到而且是做完的', () => {
    const rows = ask(base({ status: 'done' }));
    const row = rows.find((r) => r.kind === '簽療程單');
    assert.ok(row, '不然一筆已完成的來訪看起來像什麼都沒做過');
    assert.equal(row.done, true);
  });

  test('取消掉的那一筆只剩「取消 X」那幾張', () => {
    const rows = ask(base({ status: 'cancelled' }), [
      { id: 't1', visitId: 'v1', kind: '取消 Abovee', done: false, dueDate: TODAY },
    ]);
    assert.deepEqual(kinds(rows), ['取消 Abovee']);
  });

  test('別筆來訪的任務不會混進來', () => {
    const rows = ask(base(), [
      { id: 't1', visitId: 'v1', kind: 'Examine', done: true },
      { id: 't2', visitId: 'v-other', kind: '耀聖', done: false },
    ]);
    assert.ok(kinds(rows).includes('Examine'));
    assert.ok(!kinds(rows).includes('耀聖'));
  });

  test('軟刪除的任務不列', () => {
    const rows = ask(base(), [
      { id: 't1', visitId: 'v1', kind: 'Examine', done: false, deletedAt: '2026-09-01' },
    ]);
    assert.ok(!kinds(rows).includes('Examine'));
  });

  test('順序是她做事的順序，不是死線的順序', () => {
    // 追蹤報告的死線是 21 天、約二返是拿到報告之後 7 天 ——
    // 照死線排會把鏈條的第二站排到第一站前面
    const rows = ask(base({ status: 'done' }), [
      { id: 't2', visitId: 'v1', kind: '約二返', done: false, dueDate: '2026-09-10' },
      { id: 't1', visitId: 'v1', kind: '追蹤健檢報告', done: true, dueDate: '2026-09-25' },
      { id: 't0', visitId: 'v1', kind: 'Examine', done: true, dueDate: '2026-09-03' },
    ]);
    const order = kinds(rows);
    assert.ok(order.indexOf('Examine') < order.indexOf('簽療程單'));
    assert.ok(order.indexOf('簽療程單') < order.indexOf('追蹤健檢報告'));
    assert.ok(order.indexOf('追蹤健檢報告') < order.indexOf('約二返'));
  });

  test('刪掉的來訪與空的都收得下', () => {
    assert.deepEqual(todosForVisit(null, { today: TODAY }), []);
    assert.deepEqual(todosForVisit(base({ deletedAt: '2026-09-01' }), { today: TODAY }), []);
  });
});

describe('還沒發生的那幾張也要列出來（她 2026-09-08：「我發現沒有寫記錄?」）', () => {
  const COURSES = {
    'c-followup': { id: 'c-followup', name: '二返', category: 'A', needsTreatmentForm: false, needsRecord: true },
    'c-recovery': { id: 'c-recovery', name: '復能', category: 'C' },
  };
  const kinds = (visit, tasks = []) =>
    todosForVisit(visit, { tasks, coursesById: COURSES }).map((r) => r.kind);
  const rowOf = (visit, kind, tasks = []) =>
    todosForVisit(visit, { tasks, coursesById: COURSES }).find((r) => r.kind === kind);

  const v = (status, slots) => ({
    id: 'v1', customerId: 'c1', date: '2026-09-20', status, slots,
  });

  test('課程勾了「做完要寫紀錄」→ 那一場還沒做完也列得出來，標成還沒發生', () => {
    // `recordTasksForVisit()` 要那一場做完才長（ADR-0066），所以在那之前
    // 它**真的不存在**。但她要看的是「這一場的全部」（2026-09-04 的原話），
    // 所以列出來、標成還沒發生。
    const row = rowOf(v('confirmed', [{ courseId: 'c-followup' }]), '寫紀錄');
    assert.ok(row, '要列得出來');
    assert.equal(row.done, false);
    assert.equal(row.pending, true, '標成「還沒發生」');
  });

  test('沒有課程要寫紀錄就不要列 —— 那是一件不會發生的事', () => {
    assert.ok(!kinds(v('confirmed', [{ courseId: 'c-recovery' }])).includes('寫紀錄'));
  });

  test('真的長出來之後走那一張任務，不要變成兩列', () => {
    const done = v('done', [{ courseId: 'c-followup' }]);
    const task = {
      id: 't1', visitId: 'v1', kind: '寫紀錄', done: false, dueDate: '2026-09-20',
    };
    const rows = todosForVisit(done, { tasks: [task], coursesById: COURSES });
    assert.equal(rows.filter((r) => r.kind === '寫紀錄').length, 1);
    assert.equal(rows.find((r) => r.kind === '寫紀錄').pending, undefined,
      '真的那一張不是「還沒發生」');
  });

  test('掛號那一族在客人確認之前也列得出來', () => {
    // `acceptsNewTasks()` 要 confirmed 才長（ADR-0027），所以待確認的那一筆
    // 上面一張都沒有 —— 但她要看得到「等一下會有這兩張」。
    const waiting = v('pending_confirm', [{ courseId: 'c-followup' }]);
    assert.ok(kinds(waiting).includes('Examine'));
    assert.ok(kinds(waiting).includes('耀聖'));
    assert.equal(rowOf(waiting, 'Examine').pending, true);
  });

  test('確認之後真的長出來了就不要再多一列', () => {
    const ok = v('confirmed', [{ courseId: 'c-followup' }]);
    const task = { id: 't1', visitId: 'v1', kind: 'Examine', done: true, dueDate: '2026-09-19' };
    const rows = todosForVisit(ok, { tasks: [task], coursesById: COURSES });
    assert.equal(rows.filter((r) => r.kind === 'Examine').length, 1);
    assert.equal(rows.find((r) => r.kind === 'Examine').done, true);
  });

  test('取消掉的那一筆一列都不推導（只剩取消 X 那幾張）', () => {
    const gone = v('cancelled', [{ courseId: 'c-followup' }]);
    assert.deepEqual(kinds(gone), []);
  });

  test('取消掉的那一段不長出它的待辦', () => {
    const one = v('confirmed', [
      { courseId: 'c-followup', status: 'cancelled' },
      { courseId: 'c-recovery', status: 'confirmed' },
    ]);
    assert.ok(!kinds(one).includes('寫紀錄'));
    assert.ok(!kinds(one).includes('Examine'));
  });
});

describe('只看她點的那一段（focusSlot）', () => {
  const COURSES = {
    'c-followup': { id: 'c-followup', name: '二返', category: 'A', needsTreatmentForm: false, needsRecord: true },
    'c-checkup': { id: 'c-checkup', name: '健檢', category: 'B' },
  };
  const v = {
    id: 'v1', customerId: 'c1', date: '2026-09-20', status: 'confirmed',
    slots: [{ courseId: 'c-followup' }, { courseId: 'c-checkup' }],
  };
  const kinds = (focusSlot) =>
    todosForVisit(v, { tasks: [], coursesById: COURSES, focusSlot }).map((r) => r.kind);

  test('點二返那一段 → 看得到它的掛號與寫紀錄', () => {
    const out = kinds(0);
    assert.ok(out.includes('Examine'));
    assert.ok(out.includes('寫紀錄'));
  });

  test('點健檢那一段 → 看不到二返那一段的掛號與寫紀錄', () => {
    // 健檢是 B 類，確認後沒有後續登記
    const out = kinds(1);
    assert.ok(!out.includes('Examine'));
    assert.ok(!out.includes('寫紀錄'));
  });

  test('沒帶 focusSlot 就是整筆（另外三頁一個字都不變）', () => {
    const out = kinds(null);
    assert.ok(out.includes('Examine'));
    assert.ok(out.includes('寫紀錄'));
  });

  test('簽療程單那一列跟著那一段走', () => {
    // 二返不用簽（`needsTreatmentForm: false`），健檢要簽
    assert.ok(kinds(0).some((k) => k.startsWith('簽療程單（這一天不用簽')));
    assert.ok(kinds(1).includes('簽療程單'));
  });

  // ---- 真的已經長出來的那幾張也要跟著那一段走 ----
  //
  // 上面那幾條全部傳 `tasks: []`，所以它們只走得到「還沒發生」那條路。
  // 而客人一確認，掛號那兩張就**真的**進了 `tasks` 集合 —— 那條路以前
  // 完全沒有被收窄過：點復能那一段照樣看得到健檢那一張。
  //
  // 任務身上**沒有段落**（`tasksForVisit()` 是逐段算完去重的），所以歸屬
  // 只能推：**這一段自己就長得出這一種嗎？** 長得出來就是它的。

  const withTasks = (focusSlot, tasks) =>
    todosForVisit(v, { tasks, coursesById: COURSES, focusSlot }).map((r) => r.kind);

  const examine = { id: 't1', visitId: 'v1', kind: 'Examine', done: true, dueDate: '2026-09-19' };
  const record = { id: 't2', visitId: 'v1', kind: '寫紀錄', done: false, dueDate: '2026-09-20' };

  test('已經長出來的掛號跟著二返那一段，不出現在健檢那一段', () => {
    assert.ok(withTasks(0, [examine]).includes('Examine'), '二返是 A 類，Examine 是它的');
    assert.ok(!withTasks(1, [examine]).includes('Examine'), '健檢那一段長不出 Examine');
  });

  test('已經長出來的「寫紀錄」也跟著那一段走', () => {
    assert.ok(withTasks(0, [record]).includes('寫紀錄'));
    assert.ok(!withTasks(1, [record]).includes('寫紀錄'), '健檢沒勾 needsRecord');
  });

  test('沒帶 focusSlot 時真任務一張都不少（另外三頁一個字都不變）', () => {
    const out = withTasks(null, [examine, record]);
    assert.ok(out.includes('Examine'));
    assert.ok(out.includes('寫紀錄'));
  });

  test('認不得歸屬的一律留著 —— 靜默收掉比多列一張糟', () => {
    // 她自己加的、或已經拿掉的那幾種（`RETIRED_KINDS`）身上沒有課程可以推。
    const manual = { id: 't3', visitId: 'v1', kind: '跟廠商拿東西', done: false };
    assert.ok(withTasks(0, [manual]).includes('跟廠商拿東西'));
    assert.ok(withTasks(1, [manual]).includes('跟廠商拿東西'));
  });

  test('健檢那條鏈跟著健檢那一段', () => {
    // 鏈上那三張（追蹤報告、寄報告、約二返）是健檢額度長出來的，
    // 判準走課程主檔上的 `followupCourseId`（`followupCourseIdOf()`）。
    const paired = {
      ...COURSES,
      'c-checkup': { ...COURSES['c-checkup'], followupCourseId: 'c-followup' },
    };
    const chain = { id: 't4', visitId: 'v1', kind: '追蹤健檢報告', done: false };
    const at = (i) => todosForVisit(v, { tasks: [chain], coursesById: paired, focusSlot: i })
      .map((r) => r.kind);
    assert.ok(at(1).includes('追蹤健檢報告'), '健檢那一段長得出這條鏈');
    assert.ok(!at(0).includes('追蹤健檢報告'), '二返那一段跟這條鏈沒關係');
  });

  test('取消 X 那幾張跟著它要收的那個系統', () => {
    // 二返是 A 類：壓在 Abovee，確認後才去 Examine 與耀聖登記。
    // 健檢是 B 類：**壓表就壓在 Examine**。所以「取消 Examine」兩段都認得，
    // 真正分得開的是 Abovee —— 健檢那一段從來沒在上面壓過。
    const abovee = { id: 't5', visitId: 'v1', kind: '取消 Abovee', done: false };
    assert.ok(withTasks(0, [abovee]).includes('取消 Abovee'));
    assert.ok(!withTasks(1, [abovee]).includes('取消 Abovee'));

    const examine = { id: 't6', visitId: 'v1', kind: '取消 Examine', done: false };
    assert.ok(withTasks(0, [examine]).includes('取消 Examine'), 'A 類確認後會去 Examine 登記');
    assert.ok(withTasks(1, [examine]).includes('取消 Examine'), 'B 類壓表就壓在 Examine');
  });
});
