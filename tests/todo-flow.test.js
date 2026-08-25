// 待辦中心的流程分段。SPEC 第 8.1 節、ADR-0043。
//
// 這一支盯的是「順序」這件事本身：她要的是「下一步是什麼」，而畫面能回答那句
// 的前提是段落的順序與段裡的順序都不是碰巧。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  STAGES, stageOf, orderOf, groupByStage, nextStage, RETIRED_KINDS, isRetired,
  groupByDoneDay,
} from '../public/js/domain/todoFlow.js';
import { FOLLOWUP_TASK_KIND, REPORT_TASK_KIND } from '../public/js/domain/followups.js';
import { TASK_KINDS, cancelKindFor } from '../public/js/domain/taskRules.js';

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
      REPORT_TASK_KIND, FOLLOWUP_TASK_KIND];
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
    const rows = [{ id: FOLLOWUP_TASK_KIND }, { id: REPORT_TASK_KIND }];
    const after = groupByStage(rows).find((g) => g.stage.id === 'after');
    assert.deepEqual(after.rows.map((r) => r.id), [REPORT_TASK_KIND, FOLLOWUP_TASK_KIND]);
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
