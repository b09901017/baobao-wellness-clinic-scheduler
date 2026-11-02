// 健檢不是我排的（2026-11-02，ADR-0169，`.scratch/exam-not-mine/issues/02`）：時段的形狀、組時段、存檔驗證。
//
// 別人轉來的客人，健檢不在 app 裡，她要排二返或三返～十返。時段上多一格 `examNotMine: true`：
// 不扣任何一筆額度、不接任何一次健檢，其餘照二返那門課。她：
//
// > 但要小心，不能影響或是有任何可能導致一般的情況算錯
//
// 所以這一支一半在釘新的那一條路，另一半在釘**沒有標記的段一個字都沒放寬**。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { fromRoot } from './helpers/paths.js';

import { isExamNotMine, examNotMineCourse, giftKindOf, EXAM_NOT_MINE_LABEL } from '../public/js/domain/masterData.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import {
  validateVisit, withSlotStatuses, withGiftKinds, withSlotNotes,
} from '../public/js/domain/visits.js';
import { counts } from '../public/js/domain/entitlements.js';
import { followupsOfExam, examChoicesForNth } from '../public/js/domain/nthFollowup.js';
import { syncFollowupTasks, examChoicesFor } from '../public/js/domain/followups.js';
import { slotName } from '../public/js/domain/naming.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));

const ENTS = [
  { id: 'ent-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', tier: '8萬', totalQty: 1 },
  { id: 'ent-2nd', type: 'single', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'ent-exam', totalQty: 1 },
];

const EXAM_VISIT = {
  id: 'v-exam', customerId: 'c1', customerName: '客戶A', date: '2026-08-03', status: 'done',
  slots: [{ entitlementId: 'ent-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'done' }],
};

const ctx = (over = {}) => ({
  courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  entitlements: [], visits: [], ...over,
});

const picks = (over = {}) => ({
  entitlementId: null, isNth: false, equipmentId: null, ivProductId: null, startsAt: '10:00',
  roomId: null, bed: null, therapistId: null, doctorId: null, nth: null, followupForVisitId: null, note: null,
  ...over,
});

/** 一段帶標記的段（照 `slotFromPicks()` 會組出來的形狀）。 */
const notMine = (over = {}) => ({
  entitlementId: null, courseId: 'course-followup', courseName: '二返', equipmentId: null, ivProductId: null,
  startsAt: '10:00', endsAt: '10:30', minutes: 30, roomId: null, bed: null, therapistId: null, doctorId: null,
  followupForVisitId: null, attended: null, giftKind: null, note: null, status: 'pending_confirm',
  examNotMine: true, ...over,
});

const visitOf = (slots, over = {}) => ({
  customerId: 'c1', customerName: '客戶A', date: '2026-11-10', status: 'pending_confirm', slots, ...over,
});

const vctx = (over = {}) => ({
  customer: { id: 'c1', name: '客戶A' }, courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, entitlements: [], customerVisits: [], ...over,
});

const errorsOf = (slot, over = {}) => validateVisit(visitOf([slot]), vctx(over)).errors;

// ---------- 讀標記 ----------

describe('讀標記只有一支，只認 true', () => {
  test('true 才算；字串、1、沒有那一格都不算', () => {
    assert.equal(isExamNotMine({ examNotMine: true }), true);
    assert.equal(isExamNotMine({ examNotMine: 'true' }), false);
    assert.equal(isExamNotMine({ examNotMine: 1 }), false);
    assert.equal(isExamNotMine({}), false);
    assert.equal(isExamNotMine(null), false);
  });

  test('不從形狀推：二返那門課＋沒有額度＋沒有連結的舊資料不算', () => {
    const { examNotMine, ...shape } = notMine();
    assert.equal(examNotMine, true);
    assert.equal(isExamNotMine(shape), false);
  });

  test('那一顆的字是她挑的', () => {
    assert.equal(EXAM_NOT_MINE_LABEL, '健檢不是我排的');
  });

  test('全站只准問 isExamNotMine()：沒有人自己讀 `.examNotMine`（寫只有組時段那一支）', () => {
    const root = fromRoot('public/js');
    const files = [];
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) walk(p);
        else if (p.endsWith('.js')) files.push(p);
      }
    };
    walk(root);
    // 註解不算（JSDoc 寫 `picks.examNotMine` 是在講參數）。畫面上自己的草稿也照樣問它：它只看 `=== true`，什麼物件都問得
    const code = (p) => readFileSync(p, 'utf8').split(/\r?\n/)
      .filter((l) => !/^\s*(\/\/|\/?\*)/.test(l)).join('\n');
    const offenders = files
      .filter((p) => !p.endsWith(join('domain', 'masterData.js')))
      .filter((p) => /\.examNotMine\b|\[['"]examNotMine['"]\]/.test(code(p)))
      .map((p) => relative(root, p));
    assert.deepEqual(offenders, []);
  });
});

describe('二返那門課（沒有健檢也找得到）', () => {
  test('種子上剛好一門 → 就是它', () => {
    assert.equal(examNotMineCourse(COURSES)?.id, 'course-followup');
  });

  test('一門都沒有、或兩門以上 → null（那一顆不畫）', () => {
    assert.equal(examNotMineCourse(COURSES.map((c) => ({ ...c, followupCourseId: null }))), null);
    const second = { id: 'course-followup-2', name: '二返（心臟）', category: 'A' };
    const heart = { id: 'course-checkup-2', name: '心臟健檢', followupCourseId: 'course-followup-2' };
    assert.equal(examNotMineCourse([...COURSES, second, heart]), null);
  });

  test('刪掉或停用的不算（同拍 Abovee 認三返那一支）', () => {
    const deleted = COURSES.map((c) => (c.id === 'course-followup' ? { ...c, deletedAt: '2026-11-01' } : c));
    assert.equal(examNotMineCourse(deleted), null);
    const pointerGone = COURSES.map((c) => (c.id === 'course-checkup' ? { ...c, active: false } : c));
    assert.equal(examNotMineCourse(pointerGone), null);
  });
});

// ---------- 組時段 ----------

describe('slotFromPicks：按了「健檢不是我排的」', () => {
  test('還沒選第幾返 → 先選第幾返，課程與指派照樣交回去（拍 Abovee 靠它畫醫師那一排）', () => {
    const r = slotFromPicks(picks({ examNotMine: true }), ctx());
    assert.deepEqual(r.errors, ['先選第幾返']);
    assert.equal(r.slot, null);
    assert.equal(r.course?.id, 'course-followup');
    assert.equal(r.assigns, 'none');
  });

  test('二返：二返那門課、不扣、不接、不是送的，不寫返數', () => {
    const { slot, errors } = slotFromPicks(picks({ examNotMine: true, nth: 2, doctorId: 'staff-d1' }), ctx());
    assert.deepEqual(errors, []);
    assert.equal(slot.examNotMine, true);
    assert.equal(slot.courseId, 'course-followup');
    assert.equal(slot.courseName, '二返');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.followupForVisitId, null);
    assert.equal(slot.giftKind, null);
    assert.equal('followupNth' in slot, false);
    assert.equal(slot.doctorId, 'staff-d1');
    assert.equal(slot.endsAt, '10:30');
    assert.equal(slot.status, 'pending_confirm');
  });

  test('三返：返數與快照「三返」一定寫（不然日曆印成二返）', () => {
    const { slot, errors } = slotFromPicks(picks({ examNotMine: true, nth: 3 }), ctx());
    assert.deepEqual(errors, []);
    assert.equal(slot.examNotMine, true);
    assert.equal(slot.followupNth, 3);
    assert.equal(slot.courseName, '三返');
    assert.equal(slot.courseId, 'course-followup');
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.followupForVisitId, null);
    assert.equal(slot.giftKind, null);
    assert.match(slotName(slot, { courses: COURSES }), /^三返/);
  });

  test('十返也行；1、11 不行', () => {
    assert.equal(slotFromPicks(picks({ examNotMine: true, nth: 10 }), ctx()).slot.followupNth, 10);
    assert.deepEqual(slotFromPicks(picks({ examNotMine: true, nth: 11 }), ctx()).errors, ['先選第幾返']);
    assert.deepEqual(slotFromPicks(picks({ examNotMine: true, nth: 1 }), ctx()).errors, ['先選第幾返']);
  });

  test('約的時候選 60 → 60（照二返那門課的 bookingMinutes）', () => {
    const { slot } = slotFromPicks(picks({ examNotMine: true, nth: 3, minutes: 60 }), ctx());
    assert.equal(slot.minutes, 60);
    assert.equal(slot.endsAt, '11:00');
  });

  test('標記贏：同時給了額度、n返、送的、健檢 → 那幾樣全部清空（畫面上那一顆是她最後按的）', () => {
    const { slot, errors } = slotFromPicks(picks({
      examNotMine: true, nth: 2, entitlementId: 'ent-2nd', isNth: true, giftCourseId: 'course-fm', giftKind: 'gift',
      followupForVisitId: 'v-exam',
    }), ctx({ entitlements: ENTS, visits: [EXAM_VISIT] }));
    assert.deepEqual(errors, []);
    assert.equal(slot.entitlementId, null);
    assert.equal(slot.followupForVisitId, null);
    assert.equal(slot.giftKind, null);
    assert.equal(slot.courseId, 'course-followup');
    assert.equal('followupNth' in slot, false);
  });

  test('客戶身上有健檢、有二返額度也照樣組得出來（紅字是 04 的事，不在這裡擋）', () => {
    const { slot, errors } = slotFromPicks(picks({ examNotMine: true, nth: 2 }), ctx({ entitlements: ENTS, visits: [EXAM_VISIT] }));
    assert.deepEqual(errors, []);
    assert.equal(slot.entitlementId, null);
  });

  test('主檔上二返那門課不是剛好一門 → 先選要做什麼', () => {
    const noFollowup = COURSES.map((c) => ({ ...c, followupCourseId: null }));
    assert.deepEqual(slotFromPicks(picks({ examNotMine: true, nth: 3 }), ctx({ courses: noFollowup })).errors, ['先選要做什麼']);
  });

  // 段四審查 二、3：既有那一段改時間，二返那門課後來停用了、或主檔上變成兩門 —— 編輯器把這一段原本的課程傳進來
  describe('退路課程（notMineCourseId）', () => {
    const disabled = COURSES.map((c) => (c.id === 'course-followup' ? { ...c, active: false } : c));
    const twoFollowups = [
      ...COURSES,
      { ...coursesById['course-followup'], id: 'course-followup-b', name: '二返B' },
      { ...COURSES.find((c) => c.followupCourseId === 'course-followup'), id: 'course-exam-b', followupCourseId: 'course-followup-b' },
    ];
    for (const [what, courses] of [['二返那門課停用了', disabled], ['主檔上兩門二返', twoFollowups]]) {
      test(`${what} → 照這一段原本的課程組、新的時間存得進去`, () => {
        const { slot, errors } = slotFromPicks(
          picks({ examNotMine: true, nth: 3, startsAt: '14:00', notMineCourseId: 'course-followup' }), ctx({ courses }),
        );
        assert.deepEqual(errors, []);
        assert.equal(slot.courseId, 'course-followup');
        assert.equal(slot.startsAt, '14:00');
        assert.equal(slot.examNotMine, true);
      });
    }
    test('退路不是任何一門的二返 → 不用它', () => {
      assert.deepEqual(slotFromPicks(picks({ examNotMine: true, nth: 3, notMineCourseId: 'course-checkup' }), ctx({ courses: disabled })).errors,
        ['先選要做什麼']);
    });
    test('二返那門課找得到 → 照舊用它，退路不算數', () => {
      const { slot } = slotFromPicks(picks({ examNotMine: true, nth: 2, notMineCourseId: 'course-followup-b' }), ctx({ courses: twoFollowups.slice(0, -1) }));
      assert.equal(slot.courseId, 'course-followup');
    });
    test('沒按那一顆時這一格一個字都不改', () => {
      const plain = slotFromPicks(picks({ giftCourseId: 'course-followup' }), ctx());
      const withIt = slotFromPicks(picks({ giftCourseId: 'course-followup', notMineCourseId: 'course-followup' }), ctx());
      assert.deepEqual(withIt, plain);
    });
  });
});

describe('slotFromPicks：沒按那一顆，一個字都不變', () => {
  const cases = [
    ['一般的二返（扣額度、接健檢）', { entitlementId: 'ent-2nd', followupForVisitId: 'v-exam', doctorId: 'staff-d1' }],
    ['一般的三返（接健檢）', { isNth: true, nth: 3, followupForVisitId: 'v-exam' }],
    ['送的功醫門診', { giftCourseId: 'course-fm', giftKind: 'gift' }],
    ['ILIB', { entitlementId: null }],
  ];
  for (const [name, over] of cases) {
    test(`${name}：examNotMine: false 跟沒給一模一樣，而且沒有那一格`, () => {
      const c = ctx({ entitlements: ENTS, visits: [EXAM_VISIT] });
      const plain = slotFromPicks(picks(over), c);
      const off = slotFromPicks(picks({ ...over, examNotMine: false }), c);
      assert.deepEqual(off, plain);
      if (plain.slot) assert.equal('examNotMine' in plain.slot, false);
    });
  }

  test('一般的 n返 沒選健檢 → 照舊擋', () => {
    assert.match(slotFromPicks(picks({ isNth: true, nth: 3 }), ctx({ entitlements: ENTS, visits: [EXAM_VISIT] })).errors[0],
      /^先選這是哪一次健檢的/);
  });

  test('一般的 n返、客戶沒有健檢 → 照舊組不出來', () => {
    assert.deepEqual(slotFromPicks(picks({ isNth: true, nth: 3, followupForVisitId: 'v-exam' }), ctx()).errors, ['先選要做什麼']);
  });
});

// ---------- 存檔驗證 ----------

describe('validateVisit：只放過那一種形狀', () => {
  test('帶標記的二返、三返～十返 → 存得下去', () => {
    assert.deepEqual(errorsOf(notMine()), []);
    assert.deepEqual(errorsOf(notMine({ followupNth: 3, courseName: '三返' })), []);
    assert.deepEqual(errorsOf(notMine({ followupNth: 10, courseName: '十返' })), []);
  });

  test('slotFromPicks 組出來的那一段直接存得下去', () => {
    for (const nth of [2, 3, 7]) {
      const { slot } = slotFromPicks(picks({ examNotMine: true, nth }), ctx());
      assert.deepEqual(errorsOf(slot), [], `第 ${nth} 返`);
    }
  });

  test('帶標記又扣了額度 → 擋，講額度', () => {
    const errs = errorsOf(notMine({ entitlementId: 'ent-2nd' }), { entitlements: ENTS });
    assert.equal(errs.length, 1, errs.join('\n'));
    assert.match(errs[0], /健檢不是我排的.*額度/);
  });

  test('帶標記又接了健檢 → 擋，講健檢', () => {
    const errs = errorsOf(notMine({ followupForVisitId: 'v-exam' }), { entitlements: ENTS, customerVisits: [EXAM_VISIT] });
    assert.equal(errs.length, 1, errs.join('\n'));
    assert.match(errs[0], /健檢不是我排的.*接.*健檢/);
  });

  test('帶標記又是送的／體驗 → 擋，講送的或體驗', () => {
    for (const giftKind of ['trial', 'gift', 'xyz']) {
      const errs = errorsOf(notMine({ giftKind }));
      assert.equal(errs.length, 1, errs.join('\n'));
      assert.match(errs[0], /健檢不是我排的.*送的.*體驗/);
    }
  });

  test('帶標記、課程不是二返那門 → 擋，講二返', () => {
    const errs = errorsOf(notMine({ courseId: 'course-fm', courseName: '功醫門診' }));
    assert.equal(errs.length, 1, errs.join('\n'));
    assert.match(errs[0], /健檢不是我排的.*二返/);
  });

  test('帶標記、返數寫成 2 或 11 → 擋，講返數', () => {
    for (const followupNth of [2, 11, '三']) {
      const errs = errorsOf(notMine({ followupNth }));
      assert.equal(errs.length, 1, errs.join('\n'));
      assert.match(errs[0], /返數/);
    }
  });

  test('句子用畫面上那一段的叫法（slotLabel）', () => {
    const errs = validateVisit(visitOf([notMine({ entitlementId: 'ent-2nd' })]), vctx({
      entitlements: ENTS, slotLabel: () => '這一段',
    })).errors;
    assert.match(errs[0], /^這一段：/);
  });

  test('她之後替別的課也設二返：二返那門課不只一門，既有帶標記的段照樣存得下去', () => {
    const second = { id: 'course-followup-2', name: '二返（心臟）', category: 'A', durationMin: 30 };
    const heart = { id: 'course-checkup-2', name: '心臟健檢', category: 'B', durationMin: 60, followupCourseId: 'course-followup-2' };
    const courses = [...COURSES, second, heart];
    assert.deepEqual(errorsOf(notMine(), { courses }), []);
    assert.deepEqual(errorsOf(notMine({ courseId: 'course-followup-2', courseName: '二返（心臟）' }), { courses }), []);
  });
});

describe('validateVisit：沒有標記的段一個字都不放寬', () => {
  test('一般的 n返 沒接健檢 → 照舊擋', () => {
    const errs = errorsOf({ ...notMine({ followupNth: 3, courseName: '三返' }), examNotMine: undefined });
    assert.ok(errs.some((e) => /三返 一定要指定是哪一次健檢的/.test(e)), errs.join('\n'));
  });

  test('一般的二返沒選額度 → 照舊擋', () => {
    const { examNotMine, ...plain } = notMine();
    assert.ok(errorsOf(plain).some((e) => /要選一個額度/.test(e)));
  });

  test('標記寫成字串 "true" → 不算，照一般的段擋', () => {
    assert.ok(errorsOf(notMine({ examNotMine: 'true' })).some((e) => /要選一個額度/.test(e)));
    assert.ok(errorsOf(notMine({ examNotMine: 'true', followupNth: 3 })).some((e) => /一定要指定是哪一次健檢的/.test(e)));
  });

  test('一般的二返返數寫 2 → 照舊講「二返走額度那條路」', () => {
    const { examNotMine, ...plain } = notMine({ followupNth: 2 });
    assert.ok(errorsOf(plain).some((e) => /二返走額度那條路/.test(e)));
  });
});

// ---------- 讀的那一側 ----------

describe('giftKindOf：帶標記的段一律不是送的／體驗', () => {
  test('沒有 giftKind 那一格、二返那門課被勾了預設體驗 → 帶標記的照樣是 null（沒標記的才走退路）', () => {
    const weird = { ...coursesById, 'course-followup': { ...coursesById['course-followup'], uncounted: true } };
    const { giftKind, ...noField } = notMine();
    assert.equal(giftKindOf(noField, weird), null);
    const { examNotMine, ...plain } = noField;
    assert.equal(giftKindOf(plain, weird), 'trial');
  });

  test('withGiftKinds 存檔寫實時寫 null，不寫成體驗', () => {
    const weird = { ...coursesById, 'course-followup': { ...coursesById['course-followup'], uncounted: true } };
    const { giftKind, ...noField } = notMine();
    assert.equal(withGiftKinds(visitOf([noField]), weird).slots[0].giftKind, null);
  });
});

describe('次數與健檢那條鏈看不到它', () => {
  const doneNotMine = notMine({ status: 'done', attended: true });
  const nmVisit = { id: 'v-nm', ...visitOf([doneNotMine]), date: '2026-09-01', status: 'done' };
  const nmThird = { id: 'v-nm3', ...visitOf([notMine({ status: 'done', followupNth: 3, courseName: '三返' })]), date: '2026-09-02', status: 'done' };

  test('counts()：二返額度、健檢額度一次都不算它', () => {
    const all = [EXAM_VISIT, nmVisit, nmThird];
    for (const e of ENTS) {
      assert.deepEqual(counts(e, all, e.id), counts(e, [EXAM_VISIT], e.id), e.id);
    }
  });

  test('followupsOfExam()：那一次健檢底下沒有它', () => {
    assert.deepEqual(followupsOfExam('v-exam', [EXAM_VISIT, nmVisit, nmThird], ['ent-2nd']), []);
  });

  test('syncFollowupTasks()（含 placeSeconds）：加了它前後一模一樣 —— 報告照長、約二返照長', () => {
    const base = {
      customer: { id: 'c1', name: '客戶A' }, entitlements: ENTS, tasks: [], coursesById,
    };
    const before = syncFollowupTasks({ ...base, visits: [EXAM_VISIT] });
    const after = syncFollowupTasks({ ...base, visits: [EXAM_VISIT, nmVisit, nmThird] });
    assert.deepEqual(after, before);
    assert.ok(before.create.length > 0, '這一次健檢本來就該長「追蹤健檢報告」');
  });

  test('「這是哪一次健檢的」那兩排：它不佔任何一次', () => {
    const all = [EXAM_VISIT, nmVisit, nmThird];
    assert.deepEqual(
      examChoicesForNth({ entitlements: ENTS, coursesById, visits: all }),
      examChoicesForNth({ entitlements: ENTS, coursesById, visits: [EXAM_VISIT] }),
    );
    const pair = { source: ENTS[0], followup: ENTS[1] };
    assert.deepEqual(examChoicesFor(pair, all), examChoicesFor(pair, [EXAM_VISIT]));
  });
});

describe('存進去、讀回來、再存一次，形狀一樣', () => {
  test('withSlotStatuses、withGiftKinds、withSlotNotes 都跑過 → 標記還在，其餘一格都沒多', () => {
    const slots = [
      notMine(),
      notMine({ followupNth: 4, courseName: '四返', startsAt: '11:00', endsAt: '11:30' }),
    ];
    const visit = { id: 'v-nm', ...visitOf(slots) };
    const once = withSlotNotes(withGiftKinds(withSlotStatuses(visit), coursesById));
    const twice = withSlotNotes(withGiftKinds(withSlotStatuses(once), coursesById));
    assert.deepEqual(twice, once);
    assert.deepEqual(once.slots, slots);
    assert.deepEqual(validateVisit(once, vctx()).errors, []);
  });
});
