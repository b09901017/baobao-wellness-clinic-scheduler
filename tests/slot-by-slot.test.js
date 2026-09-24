// 2026-09-24 那一輪：時段才是原子單位的第二輪（`.scratch/asks-2026-09-24/`）。
//
// ADR-0081 把狀態搬到時段上，ADR-0097 讓「確認」跟上了；這一支盯著剩下那幾族
// 也問**那一段**，而不是問整筆推出來的那一個。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  applyStatus, applyConfirmation, closeVisit, withSlotStatuses, slotStatus,
  visitActions, visitStatusFrom, visitsToClose, nextStatuses, cancellableSlots, lockedAt,
  slotsToClose,
} from '../public/js/domain/visits.js';
import { closeConsequences } from '../public/js/domain/consequences.js';
import { syncTasksForVisit, RECORD_TASK_KIND } from '../public/js/domain/taskRules.js';
import { todosForVisit } from '../public/js/domain/todoFlow.js';

const statuses = (v) => v.slots.map((s) => slotStatus(v, s));

describe('01 改狀態之前先把每一段的狀態補齊', () => {
  // 2026-09-08 之前建的、之後沒再存過的：時段身上沒有 status
  const oldShape = (status, n = 3) => ({
    id: 'v', date: '2026-09-20', status,
    slots: Array.from({ length: n }, () => ({ courseId: 'c' })),
  });

  test('整天未到的舊資料，改第 0 段不會把另外兩段一起補成已確認', () => {
    // 存檔那一刻 `save()` 會再補一次 —— 補的要是它們原本的樣子
    const next = withSlotStatuses(applyStatus(oldShape('no_show'), 'confirmed', { slotIndex: 0 }));
    assert.deepEqual(statuses(next), ['confirmed', 'no_show', 'no_show']);
  });

  test('確認抽屜只問了第 0 段：第 1 段補的是它原本的狀態', () => {
    const next = withSlotStatuses(applyConfirmation(oldShape('pending_confirm', 2), new Set(), 'T', new Set([0])));
    assert.deepEqual(statuses(next), ['confirmed', 'pending_confirm']);
  });

  test('結案的舊資料：取消掉的那一段（整筆取消前留下的）不會被補成做了', () => {
    const v = { ...oldShape('confirmed', 2), slots: [{ courseId: 'c' }, { courseId: 'c', status: 'cancelled' }] };
    const next = withSlotStatuses(closeVisit(v, [true, true], 'T'));
    assert.deepEqual(statuses(next), ['done', 'cancelled']);
  });

  test('新形狀的資料（每一段都有 status）結果一個字都沒變', () => {
    const v = {
      id: 'v', date: '2026-09-20', status: 'no_show',
      slots: [{ courseId: 'c', status: 'no_show' }, { courseId: 'c', status: 'no_show' }],
    };
    const next = applyStatus(v, 'confirmed', { slotIndex: 0, at: 'T' });
    assert.deepEqual(statuses(next), ['confirmed', 'no_show']);
    assert.equal(next.status, 'confirmed');
  });
});

describe('02 未到只能退回簽療程單；長按每一顆都問那一段', () => {
  // 她 2026-09-24：「未到可以改成退回簽療程單之類的，或可以改成其實有到這樣」
  const day = (...each) => {
    const v = { id: 'v', date: '2026-09-20', slots: each.map((status) => ({ courseId: 'c', status })) };
    return { ...v, status: visitStatusFrom(v) };
  };
  const ids = (v, slotIndex) => visitActions(v, { today: '2026-09-24', slotIndex }).map((a) => a.id);

  test('長按未到的那一段：只有「退回簽療程單」', () => {
    assert.deepEqual(ids(day('no_show', 'no_show'), 0), ['reopen']);
    // 客人做了一段就走：整筆已完成，沒做的那一段照樣退得回去 —— 已完成那一段一個字都不動
    assert.deepEqual(ids(day('done', 'no_show'), 1), ['reopen']);
    assert.deepEqual(ids(day('no_show', 'confirmed'), 0), ['reopen']);
  });

  test('退回之後只有那一段變成已確認，那一天回到簽療程單的清單上', () => {
    const next = applyStatus(day('done', 'no_show'), 'confirmed', { slotIndex: 1, at: 'T' });
    assert.deepEqual(next.slots.map((s) => s.status), ['done', 'confirmed']);
    assert.equal(next.slots[1].attended, null, '「沒做」那一格一起清掉 —— 它現在還沒結案');
    assert.equal(next.status, 'confirmed');
    assert.equal(visitsToClose([next], '2026-09-24').length, 1);
  });

  test('未到不再准「取消」—— 人沒來是已經發生的事', () => {
    assert.deepEqual(nextStatuses('no_show'), ['confirmed']);
  });

  test('長按已取消的那一段：沒有「去簽療程單」、沒有「改這一段」', () => {
    assert.deepEqual(ids(day('cancelled', 'confirmed'), 0), []);
  });

  test('長按已完成的那一段：一顆都沒有', () => {
    assert.deepEqual(ids(day('done', 'confirmed'), 0), []);
  });

  test('「去簽療程單」只給還開著、日子到了的那一段', () => {
    const v = day('confirmed', 'no_show');
    assert.ok(ids(v, 0).includes('close'));
    assert.ok(!ids(v, 1).includes('close'));
  });

  test('批次取消：一天裡已經未到／已完成的那一段不給取消', () => {
    const v = day('confirmed', 'no_show', 'done', 'pending_confirm');
    assert.deepEqual(cancellableSlots(v).map((x) => x.index), [0, 3]);
  });
});

describe('03 「已完成不能直接改」看那一段', () => {
  const v = {
    id: 'v', date: '2026-09-20', status: 'confirmed',
    slots: [{ courseId: 'c', status: 'done' }, { courseId: 'c', status: 'confirmed' }],
  };

  test('一段已完成、一段已確認：已完成那一段鎖著，另一段改得動', () => {
    assert.equal(lockedAt(v, 0), true);
    assert.equal(lockedAt(v, 1), false);
  });

  test('全部做完：每一段都鎖著；沒指名哪一段照整筆', () => {
    const all = { ...v, status: 'done', slots: [{ status: 'done' }, { status: 'done' }] };
    assert.equal(lockedAt(all, 1), true);
    assert.equal(lockedAt(all, null), true);
    assert.equal(lockedAt(v, null), false);
  });

  test('編輯器的鎖走這一支，不自己問整筆', () => {
    const src = readFileSync(new URL('../public/js/ui/views/visitEditor.js', import.meta.url), 'utf8');
    assert.ok(!/isLocked\(draft\.status\)/.test(src), '還在問整筆的狀態');
    assert.match(src, /lockedAt\(draft, headSlot\)/);
  });
});

describe('04 簽療程單一段一段來', () => {
  // 她 2026-09-24：「預設先不結做了打勾未到打叉」
  const day = (...each) => {
    const v = {
      id: 'v', date: '2026-09-20',
      slots: each.map((status) => ({ courseId: 'c', entitlementId: 'e', status })),
    };
    return { ...v, status: visitStatusFrom(v) };
  };

  test('只列還開著的段：取消的、已經結案的不列', () => {
    const v = day('cancelled', 'no_show', 'confirmed', 'done', 'pending_confirm');
    assert.deepEqual(slotsToClose(v).map((x) => x.index), [2, 4]);
  });

  test('只按了第一段 ✓：第一段已完成，另外兩段一個字都不動、那一天還在清單上', () => {
    const next = closeVisit(day('confirmed', 'confirmed', 'confirmed'), [true, null, null], 'T');
    assert.deepEqual(next.slots.map((s) => s.status), ['done', 'confirmed', 'confirmed']);
    assert.equal(next.slots[1].attended, undefined, '沒按的那一段連 attended 都不寫');
    assert.equal(next.status, 'confirmed');
    assert.equal(visitsToClose([next], '2026-09-24').length, 1);
  });

  test('已經未到的那一段不會被重新蓋成做了（R2）', () => {
    const next = closeVisit(day('no_show', 'confirmed'), [true, true], 'T');
    assert.deepEqual(next.slots.map((s) => s.status), ['no_show', 'done']);
    assert.equal(next.status, 'done');
  });

  test('少傳的那幾段不動 —— 畫面上沒問到的，不替她決定', () => {
    const next = closeVisit(day('confirmed', 'confirmed'), [true], 'T');
    assert.deepEqual(next.slots.map((s) => s.status), ['done', 'confirmed']);
  });

  test('一段都沒按：原封不動', () => {
    const v = day('confirmed', 'confirmed');
    assert.deepEqual(closeVisit(v, [null, null], 'T'), v);
  });

  test('全部結掉：有一段做了就是已完成，一段都沒做就是未到', () => {
    assert.equal(closeVisit(day('confirmed', 'confirmed'), [true, false], 'T').status, 'done');
    assert.equal(closeVisit(day('confirmed', 'confirmed'), [false, false], 'T').status, 'no_show');
  });

  test('整天那條路（applyStatus 整筆標已完成）照舊', () => {
    const next = applyStatus(day('confirmed', 'pending_confirm'), 'done', { at: 'T' });
    assert.deepEqual(next.slots.map((s) => s.status), ['done', 'done']);
    assert.equal(next.status, 'done');
  });

  describe('底下那幾句照段講（R7）', () => {
    const COURSES = {
      c: { id: 'c', name: '復能', category: 'C' },
      rec: { id: 'rec', name: '營養諮詢', category: null, needsRecord: true },
    };
    const v = {
      id: 'v', date: '2026-09-20', status: 'confirmed',
      slots: [
        { courseId: 'rec', entitlementId: 'e1', status: 'confirmed' },
        { courseId: 'c', entitlementId: 'e2', status: 'confirmed' },
        { courseId: 'c', entitlementId: 'e2', status: 'confirmed' },
      ],
    };
    const say = (picks) => closeConsequences({ visit: v, picks, coursesById: COURSES });

    test('做了幾段、沒來幾段、留著幾段', () => {
      const lines = say([null, true, false]);
      assert.ok(lines.some((l) => l.includes('1 段') && l.includes('扣')), lines.join('／'));
      assert.ok(lines.some((l) => l.includes('沒來') && l.includes('不扣')), lines.join('／'));
      assert.ok(lines.some((l) => l.includes('先不結')), lines.join('／'));
    });

    test('寫紀錄只在要寫紀錄的那一段打勾時才講', () => {
      assert.ok(!say([null, true, true]).some((l) => l.includes('寫紀錄')));
      assert.ok(!say([false, true, true]).some((l) => l.includes('寫紀錄')));
      assert.ok(say([true, null, null]).some((l) => l.includes('寫紀錄')));
    });

    test('整天都結掉了才講「這一天改成…」', () => {
      assert.ok(!say([true, null, null]).some((l) => l.includes('這一天')));
      assert.ok(say([true, true, false]).some((l) => l.includes('這一天') && l.includes('已完成')));
    });
  });
});

describe('05 寫紀錄一段一段長', () => {
  // 她 2026-09-24：「例如我當天寫了A的營養諮詢（要記錄）和sis(不用) 但是我在寫記錄那邊卻看到
  // 9/24 營養諮詢.sis 寫記錄？」
  const COURSES = {
    rec: { id: 'rec', name: '營養諮詢', category: null, needsRecord: true },
    sis: { id: 'sis', name: 'SIS', category: 'C' },
  };
  const day = (...each) => {
    const v = {
      id: 'v', customerId: 'c1', customerName: '客戶A', date: '2026-09-24',
      slots: each.map(([courseId, status]) => ({ courseId, status, entitlementId: 'e' })),
    };
    return { ...v, status: visitStatusFrom(v) };
  };
  const records = (v, existing = []) => syncTasksForVisit(v, existing, { coursesById: COURSES, today: '2026-09-24' })
    .create.filter((t) => t.kind === RECORD_TASK_KIND);

  test('營養諮詢沒來、SIS 做了：不長寫紀錄', () => {
    assert.deepEqual(records(day(['rec', 'no_show'], ['sis', 'done'])), []);
  });

  test('營養諮詢先結（做了）、SIS 還開著：寫紀錄現在就長，只蓋營養諮詢那一段', () => {
    const out = records(day(['rec', 'done'], ['sis', 'confirmed']));
    assert.equal(out.length, 1);
    assert.deepEqual(out[0].slotIndexes, [0]);
  });

  test('同一天兩段要寫紀錄、分兩次結：各長一張，各蓋自己那一段', () => {
    const first = records(day(['rec', 'done'], ['rec', 'confirmed']));
    assert.deepEqual(first.map((t) => t.slotIndexes), [[0]]);
    const had = first.map((t, i) => ({ ...t, id: `r${i}` }));
    const second = records(day(['rec', 'done'], ['rec', 'done']), had);
    assert.deepEqual(second.map((t) => t.slotIndexes), [[1]]);
  });

  test('舊的寫紀錄（沒有 slotIndexes）當成蓋住整天：再存一次一張都不多長', () => {
    const old = [{ id: 'old', kind: RECORD_TASK_KIND, autoGenerated: true, done: false, visitId: 'v' }];
    assert.deepEqual(records(day(['rec', 'done'], ['rec', 'done']), old), []);
  });

  test('讀取卡片上「等一下會有」那一列：還沒結的營養諮詢那一段照樣看得到', () => {
    const rows = todosForVisit(day(['rec', 'confirmed'], ['sis', 'confirmed']), { coursesById: COURSES, focusSlot: 0 });
    assert.ok(rows.some((r) => r.kind === RECORD_TASK_KIND && r.pending));
    const sis = todosForVisit(day(['rec', 'confirmed'], ['sis', 'confirmed']), { coursesById: COURSES, focusSlot: 1 });
    assert.ok(!sis.some((r) => r.kind === RECORD_TASK_KIND));
  });
});
