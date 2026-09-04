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
