// 三返、四返……n返。
//
// 這一整支的判準只有一條，而且它比任何個別斷言都重要：
//
//   **二返的資料不可以被算成 n返，n返 的資料也不可以被算成二返。**
//
// 兩者在資料上刻意不相交（n返 的 `entitlementId` 是 null，二返沒有
// `followupNth`），所以最下面那一組「井水不犯河水」是這支測試的核心 ——
// 上面那些是為了讓它壞掉的時候看得出壞在哪。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  nthLabel, nthOf, isNthSlot, MIN_NTH, MAX_NTH, SECOND,
  examEntitlementIds, examVisits, courseIdForNth,
  followupsOfExam, nthsBookedFor, nextNthFor, examChoicesForNth,
  secondFollowupIds, nthSlotFields,
} from '../public/js/domain/nthFollowup.js';
import { counts } from '../public/js/domain/entitlements.js';
import {
  pairsOf, owed, claimedExams, bookingForExam, syncFollowupTasks,
} from '../public/js/domain/followups.js';
import { validateVisit } from '../public/js/domain/visits.js';

// ---------- 場景 ----------
//
// 一位買了 2 次健檢、配好二返額度、做完兩次健檢的客戶。

const COURSES = {
  'course-checkup': { id: 'course-checkup', name: '健檢', category: 'B', followupCourseId: 'course-followup', needsTreatmentForm: false },
  'course-followup': { id: 'course-followup', name: '二返', category: 'A', needsTreatmentForm: false, durationMin: 30 },
  'course-rehab': { id: 'course-rehab', name: '復能', category: 'C', requiresEquipment: true, assigns: 'therapist' },
};

const ENTS = [
  { id: 'ent-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup', totalQty: 2 },
  {
    id: 'ent-2nd', label: '二返（8萬健檢）', type: 'single', courseId: 'course-followup',
    totalQty: 2, followupForEntitlementId: 'ent-exam',
  },
];

const examVisit = (id, date) => ({
  id, customerId: 'c1', customerName: '王小明', date, status: 'done',
  slots: [{ entitlementId: 'ent-exam', courseId: 'course-checkup', courseName: '健檢', startsAt: '09:00', endsAt: '11:00' }],
});

/** 一場二返：走額度那一條路。 */
const secondVisit = (id, date, examId, over = {}) => ({
  id, customerId: 'c1', customerName: '王小明', date, status: 'confirmed',
  slots: [{
    entitlementId: 'ent-2nd', courseId: 'course-followup', courseName: '二返',
    startsAt: '14:00', endsAt: '14:30', doctorId: 'dr-xia', followupForVisitId: examId,
  }],
  ...over,
});

/** 一場 n返：沒有額度。 */
const nthVisit = (id, date, examId, nth, over = {}) => ({
  id, customerId: 'c1', customerName: '王小明', date, status: 'confirmed',
  slots: [{
    ...nthSlotFields({ nth, examVisitId: examId, courseId: 'course-followup' }),
    startsAt: '15:00', endsAt: '15:30', doctorId: 'dr-li',
  }],
  ...over,
});

const EXAM_A = examVisit('v-exam-a', '2026-07-13');
const EXAM_B = examVisit('v-exam-b', '2026-08-20');

// ---------- 名字與返數 ----------

describe('返數與名字', () => {
  test('3 → 三返，10 → 十返', () => {
    assert.equal(nthLabel(3), '三返');
    assert.equal(nthLabel(4), '四返');
    assert.equal(nthLabel(10), '十返');
  });

  test('二返也答得出來 —— 試算表那一行要把兩者印在一起', () => {
    assert.equal(nthLabel(SECOND), '二返');
  });

  test('範圍外回 null，不要猜一個。畫面上寫「undefined返」比什麼都不寫更糟', () => {
    for (const bad of [1, 0, 11, 33, -3, 3.5, null, undefined, '三', NaN]) {
      assert.equal(nthLabel(bad), null, String(bad));
    }
  });

  test('nthOf() 只認 3–10；**二返回 null**（它走額度那條路）', () => {
    assert.equal(nthOf({ followupNth: 3 }), 3);
    assert.equal(nthOf({ followupNth: 10 }), 10);
    assert.equal(nthOf({ followupNth: 2 }), null, '2 是二返，兩條路不可以都走得到同一個數字');
    assert.equal(nthOf({ followupNth: 11 }), null);
    assert.equal(nthOf({ entitlementId: 'ent-2nd' }), null);
  });

  test('isNthSlot() 看的是「填過沒」不是「合不合法」', () => {
    // 填了 33 的時候它仍然是一段 n返 —— 不然 validateVisit() 會改成
    // 抱怨「要選一個額度」，而她看著那句話完全不知道真正錯的是返數。
    assert.equal(isNthSlot({ followupNth: 33 }), true);
    assert.equal(isNthSlot({ followupNth: 3 }), true);
    assert.equal(isNthSlot({ followupNth: null }), false);
    assert.equal(isNthSlot({ followupNth: '' }), false);
    assert.equal(isNthSlot({ entitlementId: 'ent-2nd' }), false);
  });
});

// ---------- 哪幾筆來訪接得了 n返 ----------

describe('可以接 n返 的健檢', () => {
  test('健檢額度靠課程主檔的 followupCourseId 認，不比名字', () => {
    const ids = examEntitlementIds(ENTS, COURSES);
    assert.deepEqual([...ids], ['ent-exam']);
  });

  test('**只有已完成的健檢算**：沒做完的沒有報告可以再聽一次', () => {
    const booked = { ...examVisit('v-exam-c', '2026-09-30'), status: 'confirmed' };
    const rows = examVisits(ENTS, COURSES, [EXAM_A, EXAM_B, booked]);
    assert.deepEqual(rows.map((v) => v.id), ['v-exam-a', 'v-exam-b']);
  });

  test('日期舊的在前 —— 回訪是照順序約掉的', () => {
    const rows = examVisits(ENTS, COURSES, [EXAM_B, EXAM_A]);
    assert.deepEqual(rows.map((v) => v.date), ['2026-07-13', '2026-08-20']);
  });

  test('一位沒有健檢額度的客戶，一個候選都沒有', () => {
    const rows = examVisits(
      [{ id: 'ent-rehab', courseId: 'course-rehab', totalQty: 12 }], COURSES, [EXAM_A],
    );
    assert.deepEqual(rows, []);
  });

  test('n返 借二返那個課程 —— 不用另外建一個', () => {
    assert.equal(courseIdForNth(EXAM_A, ENTS, COURSES), 'course-followup');
    assert.equal(courseIdForNth({ slots: [{ entitlementId: 'ent-rehab' }] }, ENTS, COURSES), null);
  });
});

// ---------- 某一次健檢底下有哪幾返 ----------

describe('某一次健檢底下的回訪', () => {
  const second = secondFollowupIds(ENTS);
  const world = [
    EXAM_A, EXAM_B,
    secondVisit('v-2nd-a', '2026-08-05', 'v-exam-a'),
    nthVisit('v-3rd-a', '2026-09-20', 'v-exam-a', 3),
    nthVisit('v-4th-a', '2026-10-08', 'v-exam-a', 4),
    secondVisit('v-2nd-b', '2026-09-10', 'v-exam-b'),
  ];

  test('二返與 n返 收在同一條線上，照返數由小到大', () => {
    const rows = followupsOfExam('v-exam-a', world, second);
    assert.deepEqual(rows.map((r) => r.nth), [2, 3, 4]);
    assert.deepEqual(rows.map((r) => r.visit.date), ['2026-08-05', '2026-09-20', '2026-10-08']);
  });

  test('別的健檢底下的那幾場不會跑進來', () => {
    assert.deepEqual(nthsBookedFor('v-exam-b', world, second), [2]);
  });

  test('取消掉的那一場不算 —— 那一場沒發生', () => {
    const cancelled = world.map(
      (v) => (v.id === 'v-3rd-a' ? { ...v, status: 'cancelled' } : v),
    );
    assert.deepEqual(nthsBookedFor('v-exam-a', cancelled, second), [2, 4]);
  });

  test('刪掉的那一場也不算', () => {
    const deleted = world.map((v) => (v.id === 'v-4th-a' ? { ...v, deletedAt: 'x' } : v));
    assert.deepEqual(nthsBookedFor('v-exam-a', deleted, second), [2, 3]);
  });

  test('下一場預設是最大的 + 1；**一場都沒有時是三返**（二返算 2）', () => {
    assert.equal(nextNthFor('v-exam-a', world, second), 5);
    assert.equal(nextNthFor('v-exam-b', world, second), 3);
    assert.equal(nextNthFor('v-exam-b', [EXAM_B], second), 3, '連二返都還沒約也一樣');
  });

  test('已經到十返就停在十返 —— 不要給一個一按存檔就被擋下來的預設值', () => {
    const many = [EXAM_A, nthVisit('v-10th', '2026-12-01', 'v-exam-a', 10)];
    assert.equal(nextNthFor('v-exam-a', many, second), MAX_NTH);
  });

  test('候選**一個都不會被鎖住** —— 這是跟二返最大的差別', () => {
    const choices = examChoicesForNth({ entitlements: ENTS, coursesById: COURSES, visits: world });
    assert.deepEqual(choices.map((c) => c.visitId), ['v-exam-a', 'v-exam-b']);
    assert.equal(choices.some((c) => c.taken), false, 'n返 沒有上限，每一次健檢都可以再約');
    assert.equal(choices[0].note, '二返・三返・四返', '已經有幾返要標出來，她要對照的正是這個');
    assert.equal(choices[1].note, '二返');
  });

  test('正在編輯的那一筆，它自己那幾段不算「已經約過了」', () => {
    const choices = examChoicesForNth({
      entitlements: ENTS, coursesById: COURSES, visits: world, excludeVisitId: 'v-3rd-a',
    });
    assert.deepEqual(choices[0].nths, [2, 4]);
  });

  test('這一次健檢還沒有任何回訪時，那一格是空的 —— **不要寫「還沒約」**', () => {
    const choices = examChoicesForNth({
      entitlements: ENTS, coursesById: COURSES, visits: [EXAM_A],
    });
    assert.equal(choices[0].note, '', '「還沒約」是二返那一排的字，兩邊講不同的事會混淆');
  });
});

// ---------- 存檔前的檢查 ----------

describe('存檔前的檢查（validateVisit）', () => {
  const ctx = {
    customer: { id: 'c1', name: '王小明', flags: [] },
    courses: Object.values(COURSES),
    entitlements: ENTS,
    equipment: [],
    staff: [{ id: 'dr-li', name: '李醫師', role: '醫師' }],
    rooms: [],
    customerVisits: [EXAM_A, EXAM_B],
  };

  test('一段沒有額度的 n返 存得下去', () => {
    const { errors } = validateVisit(nthVisit('v-new', '2026-09-20', 'v-exam-a', 3), ctx);
    assert.deepEqual(errors, [], '這一整輪就是為了讓這一行是空的');
  });

  test('沒有額度、也不是 n返 的那一段照樣要被擋下來', () => {
    const bad = {
      id: 'v-bad', customerId: 'c1', date: '2026-09-20', status: 'confirmed',
      slots: [{ courseId: 'course-rehab', courseName: '復能', startsAt: '10:00', endsAt: '11:00' }],
    };
    assert.ok(validateVisit(bad, ctx).errors.some((e) => e.includes('要選一個額度')));
  });

  test('**n返 一定要指定是哪一次健檢的**（二返只是 warning，理由不一樣）', () => {
    const v = nthVisit('v-new', '2026-09-20', null, 3);
    v.slots[0].followupForVisitId = null;
    assert.ok(validateVisit(v, ctx).errors.some((e) => e.includes('一定要指定是哪一次健檢')));
  });

  test('指到的那一筆不是已完成的健檢 → 擋下來', () => {
    const notDone = { ...EXAM_A, status: 'confirmed' };
    const out = validateVisit(nthVisit('v-new', '2026-09-20', 'v-exam-a', 3), {
      ...ctx, customerVisits: [notDone],
    });
    assert.ok(out.errors.some((e) => e.includes('不是一次已完成的健檢')));
  });

  test('指到一筆不是健檢的來訪 → 擋下來', () => {
    const rehab = {
      id: 'v-rehab', customerId: 'c1', date: '2026-07-01', status: 'done',
      slots: [{ entitlementId: 'ent-rehab', courseId: 'course-rehab' }],
    };
    const out = validateVisit(nthVisit('v-new', '2026-09-20', 'v-rehab', 3), {
      ...ctx, customerVisits: [rehab],
    });
    assert.ok(out.errors.some((e) => e.includes('不是一次已完成的健檢')));
  });

  test('返數超出範圍 → 講的是返數，不是「要選一個額度」', () => {
    const v = nthVisit('v-new', '2026-09-20', 'v-exam-a', 3);
    v.slots[0].followupNth = 33;
    const { errors } = validateVisit(v, ctx);
    assert.ok(errors.some((e) => e.includes('返數要是')), errors.join(' / '));
    assert.equal(errors.some((e) => e.includes('要選一個額度')), false);
  });

  test('同時帶額度又帶返數 → 擋下來（兩種身分只能挑一種）', () => {
    const v = nthVisit('v-new', '2026-09-20', 'v-exam-a', 3);
    v.slots[0].entitlementId = 'ent-2nd';
    assert.ok(validateVisit(v, ctx).errors.some((e) => e.includes('不可以同時指定額度')));
  });

  test('同一次健檢已經有一場同樣的返數 → **只提醒不擋**', () => {
    const existing = nthVisit('v-3rd-a', '2026-09-20', 'v-exam-a', 3);
    const out = validateVisit(nthVisit('v-3rd-again', '2026-10-01', 'v-exam-a', 3), {
      ...ctx, customerVisits: [...ctx.customerVisits, existing],
    });
    assert.deepEqual(out.errors, [], 'ADR-0002：app 記錄決定，不做決定');
    assert.ok(out.warnings.some((w) => w.includes('三返已經約在')), out.warnings.join(' / '));
  });
});

// ---------- 井水不犯河水 ----------
//
// 這一組是整支測試的核心。她講得很明白：「二返的東西都不要動到」。

describe('n返 與二返互相看不見', () => {
  const second = secondFollowupIds(ENTS);
  const world = [
    EXAM_A, EXAM_B,
    secondVisit('v-2nd-a', '2026-08-05', 'v-exam-a'),
    nthVisit('v-3rd-a', '2026-09-20', 'v-exam-a', 3),
    nthVisit('v-4th-a', '2026-10-08', 'v-exam-a', 4),
  ];

  test('**n返 一次次數都不扣** —— 二返那一筆額度只被二返用掉', () => {
    const c = counts(ENTS[1], world, 'ent-2nd');
    assert.equal(c.done + c.booked, 1, '三場回訪裡只有一場是二返');
    assert.equal(c.remaining, 1);
  });

  test('健檢那一筆額度也一次都沒有被 n返 動到', () => {
    const c = counts(ENTS[0], world, 'ent-exam');
    assert.deepEqual(
      { done: c.done, booked: c.booked, remaining: c.remaining },
      { done: 2, booked: 0, remaining: 0 },
    );
  });

  test('`claimedExams()` 認不得 n返 —— 那三場不會被算成「二返已經約掉了」', () => {
    const claimed = claimedExams('ent-2nd', world);
    assert.deepEqual([...claimed.keys()], ['v-exam-a']);
    assert.equal(claimed.get('v-exam-a').id, 'v-2nd-a');
  });

  test('`bookingForExam()` 回的是二返那一場，不是最近的那一場 n返', () => {
    const hit = bookingForExam('v-exam-a', 'ent-2nd', world);
    assert.equal(hit.visit.id, 'v-2nd-a');
  });

  test('**「還欠幾次二返」不會因為約了三返而變少**', () => {
    const pair = pairsOf(ENTS, COURSES)[0];
    // 做完 2 次健檢、二返約掉 1 次 → 還欠 1 次。三返四返不影響這個數字。
    assert.equal(owed(pair, world), 1);
    assert.equal(owed(pair, [EXAM_A, EXAM_B, world[2]]), 1, '把兩場 n返 拿掉，答案一樣');
  });

  test('**「約二返」那張待辦不會因為約了三返而被收掉**', () => {
    const out = syncFollowupTasks({
      customer: { id: 'c1', name: '王小明' },
      entitlements: ENTS,
      visits: world,
      tasks: [{
        id: 't1', visitId: 'v-exam-b', kind: '追蹤健檢報告', done: true,
        doneAt: '2026-09-01T10:00:00.000Z', autoGenerated: true,
      }],
      coursesById: COURSES,
    });
    // v-exam-b 的報告勾掉了 → 該長出一張「約二返」，而 v-exam-a 的
    // 那幾場 n返 一個字都不影響這件事。
    assert.deepEqual(out.create.map((t) => [t.kind, t.visitId]), [['約二返', 'v-exam-b']]);
    assert.deepEqual(out.remove, []);
  });

  test('反過來也成立：`followupsOfExam()` 認得出哪一場是二返', () => {
    const rows = followupsOfExam('v-exam-a', world, second);
    assert.equal(rows[0].nth, SECOND);
    assert.equal(rows[0].visit.id, 'v-2nd-a');
    assert.equal(rows[0].slot.entitlementId, 'ent-2nd', '二返仍然扣它自己那筆額度');
  });

  test('沒有告訴它哪幾筆是二返額度時，二返就不會被算進來', () => {
    // 呼叫端忘了傳的症狀是「試算表少印一行二返」，不是「多印一行三返」——
    // 少一行看得出來，多一行看不出來。
    const rows = followupsOfExam('v-exam-a', world, []);
    assert.deepEqual(rows.map((r) => r.nth), [3, 4]);
  });
});

// ---------- 存進去的形狀 ----------

test('nthSlotFields()：**entitlementId 一定是 null**', () => {
  const fields = nthSlotFields({ nth: 3, examVisitId: 'v-exam-a', courseId: 'course-followup' });
  assert.deepEqual(fields, {
    entitlementId: null,
    courseId: 'course-followup',
    courseName: '三返',
    followupNth: 3,
    followupForVisitId: 'v-exam-a',
  });
  assert.ok(MIN_NTH === 3 && MAX_NTH === 10);
});
