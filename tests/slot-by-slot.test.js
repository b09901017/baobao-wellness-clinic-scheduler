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
  slotsToClose, describeConfirmed, validateVisit, canCancelSlot, dayStatusBadges,
  markFor, describeStatus, shortStatus, focusFor, slotsToShow,
} from '../public/js/domain/visits.js';
import {
  closeConsequences, confirmConsequences, bookingConsequences, rebookConsequences,
} from '../public/js/domain/consequences.js';
import { syncTasksForVisit, RECORD_TASK_KIND } from '../public/js/domain/taskRules.js';
import { todosForVisit, taskSlots, taskLine } from '../public/js/domain/todoFlow.js';
import {
  syncFollowupTasks, examChoicesFor, bookingForExam, REPORT_TASK_KIND,
} from '../public/js/domain/followups.js';
import { examChoicesForNth } from '../public/js/domain/nthFollowup.js';
import { shortDate } from '../public/js/domain/dates.js';

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

describe('06 健檢那條鏈看健檢那一段', () => {
  // 她 2026-09-24：「我還發現健檢被取消後 二返還可以連結到那次被取消的健檢?」
  const COURSES = {
    'course-checkup': { id: 'course-checkup', name: '健檢', category: 'B', followupCourseId: 'course-followup' },
    'course-followup': { id: 'course-followup', name: '二返', category: 'A' },
    'course-sis': { id: 'course-sis', name: 'SIS', category: 'C' },
  };
  const ENTS = [
    { id: 'ent-exam', type: 'single', courseId: 'course-checkup', totalQty: 2 },
    { id: 'ent-fu', type: 'single', courseId: 'course-followup', totalQty: 2, followupForEntitlementId: 'ent-exam' },
    { id: 'ent-sis', type: 'single', courseId: 'course-sis', totalQty: 5 },
  ];
  const pair = { source: ENTS[0], followup: ENTS[1] };
  const examDay = (examStatus, otherStatus = 'done', id = 'x') => {
    const v = {
      id, customerId: 'c1', customerName: '客戶A', date: '2026-09-01',
      slots: [
        { entitlementId: 'ent-exam', courseId: 'course-checkup', status: examStatus },
        { entitlementId: 'ent-sis', courseId: 'course-sis', status: otherStatus },
      ],
    };
    return { ...v, status: visitStatusFrom(v) };
  };
  const fuDay = (fuStatus, otherStatus = 'confirmed') => {
    const v = {
      id: 'f', customerId: 'c1', customerName: '客戶A', date: '2026-09-25',
      slots: [
        { entitlementId: 'ent-fu', courseId: 'course-followup', status: fuStatus, followupForVisitId: 'x' },
        { entitlementId: 'ent-sis', courseId: 'course-sis', status: otherStatus },
      ],
    };
    return { ...v, status: visitStatusFrom(v) };
  };
  const chain = (visits, tasks = []) => syncFollowupTasks({
    customer: { id: 'c1', name: '客戶A' }, entitlements: ENTS, visits, tasks, coursesById: COURSES,
  });

  test('健檢那一段取消了、同一天別段做了：不是候選、不長追蹤健檢報告', () => {
    const v = examDay('cancelled');
    assert.equal(v.status, 'done', '整筆是已完成（SIS 做了）');
    assert.deepEqual(examChoicesFor(pair, [v]), []);
    assert.deepEqual(chain([v]).create, []);
    assert.deepEqual(examChoicesForNth({ entitlements: ENTS, coursesById: COURSES, visits: [v] }), []);
  });

  test('健檢那一段未到、別段做了：同上', () => {
    assert.deepEqual(examChoicesFor(pair, [examDay('no_show')]), []);
    assert.deepEqual(chain([examDay('no_show')]).create, []);
  });

  test('健檢那一段先結了、同一天別段還開著：追蹤健檢報告現在就長', () => {
    const v = examDay('done', 'confirmed');
    assert.equal(v.status, 'confirmed');
    assert.deepEqual(chain([v]).create.map((t) => t.kind), [REPORT_TASK_KIND]);
  });

  test('二返那一段取消了（同一天別段還在）：不再佔著那一次健檢', () => {
    const visits = [examDay('done'), fuDay('cancelled')];
    assert.equal(examChoicesFor(pair, visits)[0].taken, false);
    assert.equal(bookingForExam('x', 'ent-fu', visits), null);
  });

  test('二返未到：不再佔著 —— 人沒來，要重約一場接回同一次健檢', () => {
    const visits = [examDay('done'), fuDay('no_show')];
    assert.equal(examChoicesFor(pair, visits)[0].taken, false);
    assert.equal(bookingForExam('x', 'ent-fu', visits), null);
  });

  test('二返待確認／已確認／已完成：照樣佔著', () => {
    for (const s of ['pending_confirm', 'confirmed', 'done']) {
      const visits = [examDay('done'), fuDay(s)];
      assert.equal(examChoicesFor(pair, visits)[0].taken, true, s);
    }
  });

  test('健檢那一段被退回簽療程單（還開著）：已經長出來的那幾張待辦跟著收掉', () => {
    const report = {
      id: 'r1', visitId: 'x', customerId: 'c1', kind: REPORT_TASK_KIND, dueDate: '2026-09-22',
      done: false, autoGenerated: true,
    };
    const out = chain([examDay('confirmed', 'done')], [report]);
    assert.deepEqual(out.remove.map((r) => r.id), ['r1']);
  });
});

describe('07 確認抽屜：✓ 可以、✗ 不行、預設還沒回', () => {
  // 她 2026-09-24：「就是如果只是想先同意其中一項呢 其他先不確定，就像日曆那邊可以只先同意一項。」
  const COURSES = {
    a: { id: 'a', name: '門診', category: 'A' },
    c: { id: 'c', name: 'SIS', category: 'C' },
  };
  const v = {
    id: 'v', customerId: 'c1', customerName: '客戶A', date: '2026-09-30', status: 'pending_confirm',
    followupNote: '禮拜一再問問',
    slots: [
      { courseId: 'a', status: 'pending_confirm', startsAt: '10:00' },
      { courseId: 'c', status: 'pending_confirm', startsAt: '11:00' },
      { courseId: 'c', status: 'pending_confirm', startsAt: '12:00' },
    ],
  };

  test('只按了第 0 段 ✓：那一段已確認，另外兩段還在等、「問過了」那一句還在', () => {
    const next = applyConfirmation(v, new Set(), 'T', new Set([0]));
    assert.deepEqual(next.slots.map((s) => s.status), ['confirmed', 'pending_confirm', 'pending_confirm']);
    assert.equal(next.status, 'pending_confirm');
    assert.equal(next.followupNote, '禮拜一再問問');
  });

  test('全部都有決定：「問過了」那一句才收掉', () => {
    const next = applyConfirmation(v, new Set([2]), 'T', new Set([0, 1, 2]));
    assert.equal(next.status, 'confirmed');
    assert.equal(next.followupNote, null);
  });

  test('卡片只講有按的那幾段', () => {
    const said = describeConfirmed([v], new Set(['v:1']), new Set(['v:0', 'v:1']));
    assert.equal(said.rows.length, 1);
    assert.equal(said.rejected, 1);
    assert.equal(said.waiting, 1);
  });

  test('「接著會發生什麼」只講有按 ✓ 的那一段長出來的', () => {
    // 只確認 SIS 那一段：門診那一段還在等，不可以說會多一張 Examine
    const only = confirmConsequences([v], COURSES, false, new Set(), {}, new Set(['v:1']));
    assert.ok(!only.some((l) => l.includes('Examine')), only.join('／'));
    const exam = confirmConsequences([v], COURSES, false, new Set(), {}, new Set(['v:0']));
    assert.ok(exam.some((l) => l.includes('Examine')), exam.join('／'));
  });
});

describe('審查修正（第一批）', () => {
  const COURSES = [
    { id: 'course-checkup', name: '健檢', category: 'B', followupCourseId: 'course-followup' },
    { id: 'course-followup', name: '二返', category: 'A', needsTreatmentForm: false, needsRecord: true },
    { id: 'course-sis', name: 'SIS', category: 'C' },
    { id: 'rec', name: '營養諮詢', category: null, needsRecord: true },
  ];
  const ENTS = [
    { id: 'ent-exam', type: 'single', courseId: 'course-checkup', totalQty: 2 },
    { id: 'ent-sis', type: 'single', courseId: 'course-sis', totalQty: 5 },
  ];
  const examDay = (examStatus, otherStatus) => {
    const v = {
      id: 'x', customerId: 'c1', date: '2026-09-01',
      slots: [
        { entitlementId: 'ent-exam', courseId: 'course-checkup', status: examStatus },
        { entitlementId: 'ent-sis', courseId: 'course-sis', status: otherStatus },
      ],
    };
    return { ...v, status: visitStatusFrom(v) };
  };
  const nthVisit = {
    id: 'n', customerId: 'c1', date: '2026-09-30', status: 'pending_confirm',
    slots: [{
      entitlementId: null, courseId: 'course-followup', courseName: '三返', followupNth: 3,
      followupForVisitId: 'x', status: 'pending_confirm', startsAt: '10:00', endsAt: '10:30',
    }],
  };
  const nthErrors = (exam) => validateVisit(nthVisit, {
    customer: { id: 'c1' }, courses: COURSES, entitlements: ENTS, customerVisits: [exam, nthVisit],
  }).errors.filter((e) => e.includes('健檢'));

  test('n返 的存檔驗證也問健檢那一段：健檢做了、別段還開著 → 存得下去', () => {
    assert.deepEqual(nthErrors(examDay('done', 'confirmed')), []);
  });

  test('n返 的存檔驗證：健檢那一段取消了、別段做了 → 擋下來', () => {
    assert.equal(nthErrors(examDay('cancelled', 'done')).length, 1);
  });

  test('未到的那一段取消不掉 —— 編輯器的 × 與 applyStatus() 自己都擋', () => {
    const v = { id: 'v', date: '2026-09-20', status: 'confirmed',
      slots: [{ status: 'no_show' }, { status: 'confirmed' }] };
    assert.equal(canCancelSlot(v, 0), false);
    assert.equal(canCancelSlot(v, 1), true);
    assert.equal(applyStatus(v, 'cancelled', { slotIndex: 0 }), v);
  });

  test('讀取卡片：未到的營養諮詢那一段不再寫「寫紀錄・等一下會有」', () => {
    const v = { id: 'w', customerId: 'c1', date: '2026-09-24', status: 'done',
      slots: [{ courseId: 'rec', status: 'no_show' }, { courseId: 'course-sis', status: 'done' }] };
    const byId = Object.fromEntries(COURSES.map((c) => [c.id, c]));
    const rows = todosForVisit(v, { coursesById: byId, focusSlot: 0 });
    assert.ok(!rows.some((r) => r.kind === RECORD_TASK_KIND), rows.map((r) => r.kind).join('／'));
  });

  test('只結一半、整筆還是已確認：不蓋 statusAt（同 settle()）', () => {
    const v = { id: 'v', date: '2026-09-20', status: 'confirmed', statusAt: 'OLD',
      slots: [{ status: 'confirmed' }, { status: 'confirmed' }] };
    assert.equal(closeVisit(v, [true, null], 'NEW').statusAt, 'OLD');
    assert.equal(closeVisit(v, [true, false], 'NEW').statusAt, 'NEW');
  });

  test('整天退回（沒指名哪一段）也清掉「沒做」那一格', () => {
    const v = { id: 'v', date: '2026-09-20', status: 'no_show',
      slots: [{ status: 'no_show', attended: false }] };
    assert.equal(applyStatus(v, 'confirmed', {}).slots[0].attended, null);
  });

  test('「退回簽療程單」那一顆自己帶著要換成哪一個狀態 —— 畫面不自己對應', () => {
    const v = { id: 'v', date: '2026-09-20', status: 'no_show', slots: [{ status: 'no_show' }] };
    const [item] = visitActions(v, { today: '2026-09-24', slotIndex: 0 });
    assert.equal(item.id, 'reopen');
    assert.equal(item.to, 'confirmed');
  });
});

describe('14 日子過了才變成已確認的段，不長掛號待辦', () => {
  // 她 2026-09-24：「…那一刻它會變成已確認，然後長出一張已經逾期的 Examine／耀聖 ， 要擋掉」
  const TODAY = '2026-09-24';
  const C = { opd: { id: 'opd', name: '門診', category: 'A' } }; // A 類：確認後 Examine、耀聖
  const day = (date, status) => ({
    id: 'v', customerId: 'c1', customerName: '客戶A', date, status,
    slots: [{ courseId: 'opd', startsAt: '10:00', status }],
  });
  const grown = (v, tasks = []) =>
    syncTasksForVisit(v, tasks, { coursesById: C, today: TODAY }).create.map((t) => t.kind).sort();
  const rebooked = (before) => ({
    ...before,
    slots: [{ ...before.slots[0], status: 'cancelled' }, { courseId: 'opd', startsAt: '15:00', status: 'pending_confirm' }],
  });

  test('過去某一天：待確認 → 簽療程單 ✗ → 退回簽療程單，不長 Examine／耀聖', () => {
    const noShow = closeVisit(day('2026-09-20', 'pending_confirm'), [false], 'T');
    const back = applyStatus(noShow, 'confirmed', { slotIndex: 0, at: 'T' });
    assert.equal(slotStatus(back, back.slots[0]), 'confirmed');
    assert.deepEqual(grown(back), []);
  });

  test('確認過再記未到、再退回：一樣沒有多一張（確認那一刻長過的那一張蓋著）', () => {
    const had = ['Examine', '耀聖'].map((kind, i) => ({
      id: `t${i}`, visitId: 'v', kind, done: true, autoGenerated: true, slotIndexes: [0],
    }));
    const back = applyStatus(day('2026-09-20', 'no_show'), 'confirmed', { slotIndex: 0, at: 'T' });
    assert.deepEqual(grown(back, had), []);
  });

  test('過去還在待確認的段，長按「客戶說可以」→ 沒有多一張', () => {
    const yes = applyStatus(day('2026-09-20', 'pending_confirm'), 'confirmed', { slotIndex: 0, at: 'T' });
    assert.deepEqual(grown(yes), []);
  });

  test('今天那一段早上才確認 → 照樣長', () => {
    assert.deepEqual(grown(day(TODAY, 'confirmed')), ['Examine', '耀聖']);
  });

  test('未來的段確認 → 照樣長；改期的確認框照樣講「會多一張 Examine」', () => {
    assert.deepEqual(grown(day('2026-09-30', 'confirmed')), ['Examine', '耀聖']);
    const before = day('2026-09-30', 'confirmed');
    const said = rebookConsequences({ before, after: rebooked(before), index: 0, coursesById: C, today: TODAY });
    assert.match(said.lines.join('\n'), /Examine/);
  });

  test('改期到過去某一天：確認框不講「等客人說可以之後會多一張 Examine」', () => {
    const before = day('2026-09-20', 'pending_confirm');
    const said = rebookConsequences({ before, after: rebooked(before), index: 0, coursesById: C, today: TODAY });
    assert.doesNotMatch(said.lines.join('\n'), /Examine/);
  });

  test('補登昨天一段：不講「跟客人確認時間」與 Examine，講它會出現在「簽療程單」', () => {
    const said = bookingConsequences({ visit: day('2026-09-23', 'pending_confirm'), coursesById: C, today: TODAY })
      .lines.join('\n');
    assert.doesNotMatch(said, /跟客人確認時間/);
    assert.doesNotMatch(said, /Examine/);
    assert.match(said, /簽療程單/);
  });

  test('補登併進過去那一天（本來已確認）：也不講「會重新出現一張跟客人確認時間」', () => {
    const said = bookingConsequences({
      visit: day('2026-09-23', 'pending_confirm'), coursesById: C, today: TODAY, merge: { reopened: true },
    }).lines.join('\n');
    assert.doesNotMatch(said, /跟客人確認時間/);
    assert.match(said, /簽療程單/);
  });

  test('補登今天一段：照舊講「會多一張跟客人確認時間」與 Examine', () => {
    const said = bookingConsequences({ visit: day(TODAY, 'pending_confirm'), coursesById: C, today: TODAY })
      .lines.join('\n');
    assert.match(said, /待辦會多一張「跟客人確認時間」/);
    assert.match(said, /Examine/);
  });

  test('讀取卡片：過去那一段不寫 Examine「到時候才會長出來」—— 未來的照寫', () => {
    const pendingKinds = (v) => todosForVisit(v, { coursesById: C, today: TODAY, focusSlot: 0 })
      .filter((r) => r.pending).map((r) => r.kind).sort();
    assert.deepEqual(pendingKinds(day('2026-09-20', 'pending_confirm')), []);
    assert.deepEqual(pendingKinds(day('2026-09-30', 'pending_confirm')), ['Examine', '耀聖']);
  });
});

describe('13 客戶詳情「來訪紀錄」那一列逐段', () => {
  const day = (...each) => {
    const v = { id: 'v', date: '2026-09-20', slots: each.map((status) => ({ courseId: 'c', status })) };
    return { ...v, status: visitStatusFrom(v) };
  };
  const texts = (v) => dayStatusBadges(v).map((b) => b.text);

  test('一段已確認、一段未到：看得出兩種（△ ✗），不是整筆推出來的「已確認」', () => {
    assert.deepEqual(texts(day('confirmed', 'no_show')), [markFor('confirmed'), markFor('no_show')]);
    assert.deepEqual(dayStatusBadges(day('confirmed', 'no_show')).map((b) => b.status), ['confirmed', 'no_show']);
  });

  test('單段那一天照舊印字', () => {
    assert.deepEqual(texts(day('confirmed')), [describeStatus('confirmed')]);
  });

  test('每一段都一樣：印一個字就好（整天都已完成是真的）', () => {
    assert.deepEqual(texts(day('done', 'done')), [describeStatus('done')]);
  });

  test('取消的那一段沒有符號 —— 印短字，不要整段不印', () => {
    assert.deepEqual(texts(day('confirmed', 'cancelled')), [markFor('confirmed'), shortStatus('cancelled')]);
  });

  test('客戶詳情那一列走它', () => {
    const src = readFileSync(new URL('../public/js/ui/views/customerDetail.js', import.meta.url), 'utf8');
    assert.match(src, /dayStatusBadges\(/);
  });
});

describe('08 這一張待辦講的是哪幾段', () => {
  // 她 2026-09-24：「為甚麼不是只呈現真的被取消的那幾段?而是其他段也會顯示出來 ?
  // …寫紀錄這個待辦的詳情在這兩個地方好像也是有問題 ? 所以幫我全域排查 詳情只呈現和這項有關的而不是整天的」
  const C = {
    opd: { id: 'opd', name: '門診', category: 'A' },
    sis: { id: 'sis', name: 'SIS', category: 'C' },
    rec: { id: 'rec', name: '營養諮詢', category: null, needsRecord: true },
    chk: { id: 'chk', name: '健檢', category: 'B', followupCourseId: 'opd' },
  };
  const master = { courses: Object.values(C) };
  const day = (...courseIds) => ({
    id: 'v', customerId: 'c1', date: '2026-09-24', status: 'done',
    slots: courseIds.map((courseId, i) => ({ courseId, startsAt: `${10 + i}:00`, status: 'done' })),
  });
  const task = (kind, over = {}) => ({ id: 't', visitId: 'v', kind, autoGenerated: true, ...over });

  test('「取消 Abovee」只蓋第 1 段：taskSlots 回 [1]、詳情直接打開第 1 段、1 項', () => {
    const v = day('opd', 'sis', 'sis');
    const at = taskSlots(task('取消 Abovee', { slotIndexes: [1] }), v, C);
    assert.deepEqual(at, [1]);
    assert.equal(focusFor(v, null, at), 1);
  });

  test('營養諮詢＋SIS 那一天的寫紀錄（新的，帶 slotIndexes）：只講營養諮詢', () => {
    const t = task(RECORD_TASK_KIND, { slotIndexes: [0] });
    assert.deepEqual(taskSlots(t, day('rec', 'sis'), C), [0]);
    assert.equal(taskLine(t, day('rec', 'sis'), master).what, '10:00 營養諮詢');
  });

  test('舊的寫紀錄（沒有 slotIndexes）照樣只講要寫紀錄的那一段', () => {
    assert.deepEqual(taskSlots(task(RECORD_TASK_KIND), day('sis', 'rec'), C), [1]);
  });

  test('追蹤健檢報告（沒有 slotIndexes）：只講健檢那一段', () => {
    assert.deepEqual(taskSlots(task(REPORT_TASK_KIND), day('sis', 'chk'), C), [1]);
  });

  test('舊的 Examine：只講長得出 Examine 的那幾段', () => {
    assert.deepEqual(taskSlots(task('Examine'), day('opd', 'sis', 'opd'), C), [0, 2]);
  });

  test('推不出來的（她手動加的）：照舊整天，不會變成空的', () => {
    assert.deepEqual(taskSlots(task('打給客人', { autoGenerated: false }), day('opd', 'sis'), C), [0, 1]);
    assert.deepEqual(taskSlots(task('取消 Abovee', { slotIndexes: [9] }), day('opd', 'sis'), C), [0, 1]);
  });

  test('兩段以上：目錄只列那幾段；一段都指不到就退回整天', () => {
    const v = day('opd', 'sis', 'opd');
    assert.equal(focusFor(v, null, [0, 2]), null);
    assert.deepEqual(slotsToShow(v, null, [0, 2]).slots.map((x) => x.index), [0, 2]);
    assert.deepEqual(slotsToShow(v, null, []).slots.map((x) => x.index), [0, 1, 2]);
  });

  test('「詳情」與卡片上的歸屬是同一件事：taskSlots 指到的段，卡片上就列那一張', () => {
    const v = day('opd', 'sis', 'rec');
    const tasks = [task('Examine'), task(RECORD_TASK_KIND, { id: 'r' }), task('取消 Abovee', { id: 'x', slotIndexes: [1] })];
    for (const t of tasks) {
      for (const i of [0, 1, 2]) {
        const listed = todosForVisit(v, { tasks: [t], coursesById: C, focusSlot: i }).some((r) => r.key === t.id);
        assert.equal(listed, taskSlots(t, v, C).includes(i), `${t.kind} 第 ${i} 段`);
      }
    }
  });

  test('三個入口的「詳情」與「N 項」都問它', () => {
    const src = (f) => readFileSync(new URL(`../public/js/ui/views/${f}`, import.meta.url), 'utf8');
    for (const f of ['home.js', 'customerDetail.js']) assert.match(src(f), /taskSlots\(/, f);
    assert.ok(!src('home.js').includes('${(visit.slots ?? []).length} 項'), '「N 項」還在數整天');
  });
});

describe('09 待辦列三行：名字／標籤／一段一行小字', () => {
  // 她 2026-09-24：「一行名字 一行標籤 一行小字說是甚麼幾點的什麼…如果有兩項…也換行呈現出來…
  // 並且可以只寫日期和項目就好，不用寫時間」；Q5：「只在這種時候補上時間」（同一天兩段同名時）
  const C = {
    opd: { id: 'opd', name: '門診', category: 'A' },
    sis: { id: 'sis', name: 'SIS', category: 'C' },
  };
  const master = { courses: Object.values(C) };
  const day = (...slots) => ({
    id: 'v', customerId: 'c1', date: '2026-09-24', status: 'confirmed',
    slots: slots.map(([courseId, startsAt]) => ({ courseId, startsAt, status: 'confirmed' })),
  });
  const D = shortDate('2026-09-24');

  test('一張取消兩段的：兩行小字，只寫日期和項目', () => {
    const v = day(['opd', '10:00'], ['sis', '11:00']);
    const line = taskLine({ kind: '取消 Abovee', slotIndexes: [0, 1] }, v, master);
    assert.deepEqual(line.lines, [`${D} 門診`, `${D} SIS`]);
  });

  test('10:00 門診、15:00 門診各一張 Examine：同一天同名才補時間，兩張分得出來', () => {
    const v = day(['opd', '10:00'], ['sis', '12:00'], ['opd', '15:00']);
    assert.deepEqual(taskLine({ kind: 'Examine', slotIndexes: [0] }, v, master).lines, [`${D} 10:00 門診`]);
    assert.deepEqual(taskLine({ kind: 'Examine', slotIndexes: [2] }, v, master).lines, [`${D} 15:00 門診`]);
    assert.deepEqual(taskLine({ kind: '取消 Abovee', slotIndexes: [1] }, v, master).lines, [`${D} SIS`]);
  });

  test('沒有來訪（獨立待辦）：一行小字都沒有', () => {
    assert.deepEqual(taskLine({ kind: '打給客人', dueDate: '2026-09-23' }, null).lines, []);
  });

  test('試算表那一格（what）還是一行', () => {
    const v = day(['opd', '10:00'], ['sis', '11:00']);
    assert.ok(!taskLine({ kind: '取消 Abovee', slotIndexes: [0, 1] }, v, master).what.includes('\n'));
  });

  test('系統自己寫的那一句收進 ?，她自己寫的照舊看得到（兩個畫面）', () => {
    for (const [f, t] of [['ui/views/home.js', 't'], ['ui/components/tasklist.js', 'task']]) {
      const src = readFileSync(new URL(`../public/js/${f}`, import.meta.url), 'utf8');
      assert.ok(src.includes(`${t}.note && !${t}.autoGenerated`), `${f}：她手寫的那一句要照舊印`);
      assert.ok(src.includes(`${t}.autoGenerated ? tip(${t}.note`), `${f}：系統那一句收進 tip()`);
      assert.ok(src.includes('line.lines') || src.includes('.lines'), `${f}：小字走 taskLine() 的 lines`);
    }
  });
});
