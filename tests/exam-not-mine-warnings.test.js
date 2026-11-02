// 健檢不是我排的：紅字提醒與確認框那幾句（2026-11-02，ADR-0169，`.scratch/exam-not-mine/issues/04`）。
//
// 她：
//
// > 可以多一點步驟，多一點提醒或是多一點確認等等，讓一般的時候不會不小心多送
//
// 最可能按錯的兩種：這位客人身上其實有二返額度、或其實有一次接得上的健檢。那兩種按了那一顆，
// 那一場就不扣、不接 —— 所以要講，而且不點開也要看得到（`mustSee()`）。她真的要用的那種客人（沒有二返額度、
// 沒有健檢）一句都不跳。例子一律客戶A。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { EXAM_NOT_MINE_LABEL } from '../public/js/domain/masterData.js';
import { validateVisit, warningDetails, mustSee } from '../public/js/domain/visits.js';
import {
  bookingConsequences, aboveeConsequences, chargeSwitchConsequences,
} from '../public/js/domain/consequences.js';
import { FOLLOWUP_TASK_KIND } from '../public/js/domain/followups.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));

const EXAM_ENT = { id: 'ent-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', tier: '8萬', totalQty: 1 };
const SECOND_ENT = {
  id: 'ent-2nd', type: 'single', label: '二返（8萬健檢）', courseId: 'course-followup',
  followupForEntitlementId: 'ent-exam', totalQty: 1,
};
const ENTS = [EXAM_ENT, SECOND_ENT];

const examVisit = (status = 'done', over = {}) => ({
  id: 'v-exam', customerId: 'c1', customerName: '客戶A', date: '2026-08-03', status,
  slots: [{ entitlementId: 'ent-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status }],
  ...over,
});

/** 一段帶標記的段（照 `slotFromPicks()` 會組出來的形狀）。 */
const notMine = (over = {}) => ({
  entitlementId: null, courseId: 'course-followup', courseName: '二返', equipmentId: null, ivProductId: null,
  startsAt: '10:00', endsAt: '10:30', minutes: 30, roomId: null, bed: null, therapistId: null, doctorId: null,
  followupForVisitId: null, attended: null, giftKind: null, note: null, status: 'pending_confirm',
  examNotMine: true, ...over,
});
const third = (over = {}) => notMine({ courseName: '三返', followupNth: 3, ...over });

const visitOf = (slots, over = {}) => ({
  customerId: 'c1', customerName: '客戶A', date: '2026-11-10', status: 'pending_confirm', slots, ...over,
});

const vctx = (over = {}) => ({
  customer: { id: 'c1', name: '客戶A' }, courses: COURSES, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, entitlements: [], customerVisits: [], ...over,
});

const notMineWarnings = (visit, over = {}) => warningDetails(visit, vctx(over)).filter((w) => w.source === 'examNotMine');

// ---------- 紅字 ----------

describe('紅字：她真的要用的那種客人一句都不跳', () => {
  test('沒有任何額度、沒有任何來訪 → 帶標記的二返與三返一句 examNotMine 都沒有', () => {
    assert.deepEqual(notMineWarnings(visitOf([notMine(), third({ startsAt: '11:00', endsAt: '11:30' })])), []);
  });

  test('健檢那一筆額度在、但從來沒約過健檢（沒有接得上的）、二返用完了 → 一句都不跳', () => {
    const used = {
      id: 'v-old2', customerId: 'c1', date: '2026-09-01', status: 'done',
      slots: [{ entitlementId: 'ent-2nd', courseId: 'course-followup', startsAt: '10:00', endsAt: '10:30', status: 'done' }],
    };
    assert.deepEqual(notMineWarnings(visitOf([notMine()]), { entitlements: ENTS, customerVisits: [used] }), []);
  });

  test('接得上的健檢只有取消與未到的 → 不跳（那幾次按不下去）', () => {
    const cancelled = examVisit('cancelled');
    const noShow = examVisit('no_show', { id: 'v-exam2', date: '2026-09-03' });
    const w = notMineWarnings(visitOf([third()]), { entitlements: [EXAM_ENT], customerVisits: [cancelled, noShow] });
    assert.deepEqual(w, []);
  });
});

describe('紅字：身上還有二返額度', () => {
  test('帶標記的二返、二返額度還剩 1 → 講是哪一筆、剩幾次，進 mustSee、指著那一段', () => {
    const w = notMineWarnings(visitOf([notMine()]), { entitlements: [SECOND_ENT] });
    assert.equal(w.length, 1);
    assert.match(w[0].text, /^第 1 個時段：/);
    assert.match(w[0].text, /「二返（8萬健檢）」剩 1 次/);
    assert.ok(w[0].text.includes(EXAM_NOT_MINE_LABEL));
    assert.equal(mustSee(w[0]), true);
    assert.deepEqual(w[0].slots, [0]);
  });

  test('句子照 slotLabel 叫那一段', () => {
    const w = notMineWarnings(visitOf([notMine()]), { entitlements: [SECOND_ENT], slotLabel: () => '這一段' });
    assert.match(w[0].text, /^這一段：/);
  });

  test('二返額度用完了、刪掉了 → 不跳', () => {
    const used = {
      id: 'v-old2', customerId: 'c1', date: '2026-09-01', status: 'done',
      slots: [{ entitlementId: 'ent-2nd', courseId: 'course-followup', startsAt: '10:00', endsAt: '10:30', status: 'done' }],
    };
    assert.deepEqual(notMineWarnings(visitOf([notMine()]), { entitlements: [SECOND_ENT], customerVisits: [used] }), []);
    assert.deepEqual(notMineWarnings(visitOf([notMine()]), { entitlements: [{ ...SECOND_ENT, deletedAt: '2026-10-01' }] }), []);
  });

  test('同一筆裡另一段正在扣那一筆二返 → 算進去（剩 0，不跳）', () => {
    const paid = notMine({ examNotMine: undefined, entitlementId: 'ent-2nd', startsAt: '14:00', endsAt: '14:30' });
    delete paid.examNotMine;
    assert.deepEqual(notMineWarnings(visitOf([notMine(), paid]), { entitlements: [SECOND_ENT] }), []);
  });

  test('帶標記的三返不講二返額度那一句（三返本來就不扣）', () => {
    assert.deepEqual(notMineWarnings(visitOf([third()]), { entitlements: [SECOND_ENT] }), []);
  });

  test('取消掉的那一段不講', () => {
    assert.deepEqual(notMineWarnings(visitOf([notMine({ status: 'cancelled' })], { status: 'cancelled' }), { entitlements: [SECOND_ENT] }), []);
  });
});

describe('紅字：有接得上的健檢', () => {
  test('做完的那一次 → 二返與三返都講哪一天，進 mustSee（問的是 examChoicesForNth，身上沒有二返額度照樣講）', () => {
    const visit = visitOf([third()]);
    const w = notMineWarnings(visit, { entitlements: [EXAM_ENT], customerVisits: [examVisit()] });
    assert.equal(w.length, 1);
    assert.match(w[0].text, /8\/3/);
    assert.ok(w[0].text.includes(EXAM_NOT_MINE_LABEL));
    assert.equal(mustSee(w[0]), true);

    const two = notMineWarnings(visitOf([notMine()]), { entitlements: [EXAM_ENT], customerVisits: [examVisit()] });
    assert.equal(two.length, 1);
  });

  test('排著還沒做的那一次也算接得上', () => {
    const w = notMineWarnings(visitOf([third()]), { entitlements: [EXAM_ENT], customerVisits: [examVisit('confirmed', { date: '2026-11-05' })] });
    assert.equal(w.length, 1);
    assert.match(w[0].text, /11\/5/);
  });

  test('同一筆正要存的健檢也算進去（還沒存、沒有 id）', () => {
    const exam = { entitlementId: 'ent-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '10:00', status: 'pending_confirm' };
    const w = notMineWarnings(visitOf([exam, third()]), { entitlements: [EXAM_ENT] });
    assert.equal(w.length, 1);
    assert.match(w[0].text, /11\/10/);
    assert.deepEqual(w[0].slots, [1]);
  });

  test('二返額度還有剩、也有接得上的健檢 → 兩句都講', () => {
    const w = notMineWarnings(visitOf([notMine()]), { entitlements: ENTS, customerVisits: [examVisit()] });
    assert.equal(w.length, 2);
  });

  test('validateVisit().warnings 裡有同一句，而且不是 error（照樣存得下去）', () => {
    const r = validateVisit(visitOf([third()]), vctx({ entitlements: [EXAM_ENT], customerVisits: [examVisit()] }));
    assert.deepEqual(r.errors, []);
    assert.ok(r.warnings.some((t) => t.includes(EXAM_NOT_MINE_LABEL)));
  });
});

describe('紅字：沒有標記的段一句都不多', () => {
  test('一般的二返（扣額度、接健檢）與一般的三返 → 沒有 examNotMine 那一種', () => {
    const second = {
      entitlementId: 'ent-2nd', courseId: 'course-followup', startsAt: '10:00', endsAt: '10:30',
      followupForVisitId: 'v-exam', status: 'pending_confirm',
    };
    const nth = {
      entitlementId: null, courseId: 'course-followup', courseName: '三返', followupNth: 3, followupForVisitId: 'v-exam',
      startsAt: '11:00', endsAt: '11:30', status: 'pending_confirm',
    };
    assert.deepEqual(notMineWarnings(visitOf([second, nth]), { entitlements: ENTS, customerVisits: [examVisit()] }), []);
  });
});

// ---------- 確認框：壓表、日曆新增 ----------

describe('確認框：bookingConsequences()', () => {
  test('新加一段帶標記的二返 → 講一句不扣、不接；不講「加約的」', () => {
    const { lines } = bookingConsequences({ visit: visitOf([notMine()]), coursesById });
    const said = lines.filter((l) => l.includes('健檢不是你排的'));
    assert.equal(said.length, 1);
    assert.match(said[0], /^二返/);
    assert.match(said[0], /不扣任何次數/);
    assert.ok(!lines.some((l) => /加約的/.test(l)));
  });

  test('帶標記的三返只講這一句，不再接「三返是加約的」', () => {
    const { lines } = bookingConsequences({ visit: visitOf([third()]), coursesById });
    assert.ok(lines.some((l) => /^三返的健檢不是你排的/.test(l)), lines.join('｜'));
    assert.ok(!lines.some((l) => /三返是加約的/.test(l)), lines.join('｜'));
  });

  test('只講這一次新加的段：併進來的那一天原本就有的帶標記段不講', () => {
    const visit = visitOf([third(), { entitlementId: 'ent-x', courseId: 'course-checkup', startsAt: '14:00', endsAt: '15:00', status: 'pending_confirm' }], { id: 'v1' });
    const { lines } = bookingConsequences({ visit, coursesById, merge: { reopened: false }, added: [1] });
    assert.ok(!lines.some((l) => l.includes('健檢不是你排的')), lines.join('｜'));
  });

  test('一般的三返照舊講「三返是加約的」', () => {
    const nth = {
      entitlementId: null, courseId: 'course-followup', courseName: '三返', followupNth: 3, followupForVisitId: 'v-exam',
      startsAt: '11:00', endsAt: '11:30', status: 'pending_confirm',
    };
    const { lines } = bookingConsequences({ visit: visitOf([nth]), coursesById });
    assert.ok(lines.some((l) => /三返是加約的/.test(l)));
    assert.ok(!lines.some((l) => l.includes('健檢不是你排的')));
  });
});

// ---------- 確認框：拍 Abovee ----------

describe('確認框：aboveeConsequences()', () => {
  const group = (slots) => ({
    customerId: 'c1', customerName: '客戶A', date: '2026-11-10', visit: visitOf(slots),
    items: slots.map((_, i) => ({ key: `k${i}` })), at: Object.fromEntries(slots.map((_, i) => [`k${i}`, i])),
  });

  test('新的一段帶標記的三返 → 講不扣、不接，不講「三返是加約的」', () => {
    const { lines } = aboveeConsequences({ groups: [group([third()])], coursesById });
    assert.ok(lines.some((l) => /^三返的健檢不是你排的/.test(l)), lines.join('｜'));
    assert.ok(!lines.some((l) => /三返是加約的/.test(l)), lines.join('｜'));
  });

  test('帶標記的二返與三返同一張 → 各講一次', () => {
    const { lines } = aboveeConsequences({ groups: [group([notMine(), third({ startsAt: '11:00', endsAt: '11:30' })])], coursesById });
    assert.equal(lines.filter((l) => l.includes('健檢不是你排的')).length, 2);
  });
});

// ---------- 既有的一段改成帶標記／拿掉標記（過目 M7）----------

describe('chargeSwitchConsequences()：改成帶標記、拿掉標記', () => {
  const linked = {
    entitlementId: 'ent-2nd', courseId: 'course-followup', courseName: '二返', startsAt: '10:00', endsAt: '10:30',
    followupForVisitId: 'v-exam', giftKind: null, status: 'pending_confirm',
  };
  const before = visitOf([linked], { id: 'v-2' });
  const after = visitOf([notMine({ status: 'pending_confirm' })], { id: 'v-2' });
  const tasks = [];
  const chain = { entitlements: ENTS, tasks };

  test('扣著二返、接著健檢 → 改成帶標記：跳這一道，講還回 1 次、不再接那一次健檢', () => {
    const said = chargeSwitchConsequences({
      before, after, coursesById, entitlements: ENTS, customerVisits: [examVisit(), before],
    });
    assert.ok(said, '這一道要跳');
    assert.ok(said.title.includes(EXAM_NOT_MINE_LABEL));
    assert.ok(said.lines.some((l) => /還 1 次/.test(l)), said.lines.join('｜'));
    assert.ok(said.lines.some((l) => /不再接 8\/3\(一\) 那一次健檢/.test(l)), said.lines.join('｜'));
    assert.ok(!said.lines.some((l) => /待辦都不動/.test(l)), '「約二返」可能重新長出來，不可以說待辦都不動');
  });

  test('帶 chain 時：那一次健檢的「約二返」重新長出來要講（拿 syncFollowupTasks() 試算）', () => {
    const said = chargeSwitchConsequences({
      before, after, coursesById, entitlements: ENTS, customerVisits: [examVisit(), before],
      customer: { id: 'c1', name: '客戶A' }, chain: { entitlements: ENTS, tasks: [
        { id: 't-rep', kind: '追蹤健檢報告', visitId: 'v-exam', customerId: 'c1', autoGenerated: true, done: true, dueDate: '2026-08-20' },
      ] },
    });
    assert.ok(said.lines.some((l) => l.includes(`「${FOLLOWUP_TASK_KIND}」`)), said.lines.join('｜'));
  });

  test('拿掉標記、改回扣二返 → 跳這一道，講扣 1 次', () => {
    const said = chargeSwitchConsequences({
      before: after, after: before, coursesById, entitlements: ENTS, customerVisits: [examVisit(), after], chain,
      customer: { id: 'c1', name: '客戶A' },
    });
    assert.ok(said);
    assert.ok(said.title.includes(EXAM_NOT_MINE_LABEL));
    assert.ok(said.lines.some((l) => /扣 1 次/.test(l)), said.lines.join('｜'));
  });

  test('帶標記的三返改成一般的三返（接健檢）→ 跳；次數不變', () => {
    const marked = visitOf([third()], { id: 'v-3' });
    const plain = visitOf([{ ...third(), followupForVisitId: 'v-exam' }], { id: 'v-3' });
    delete plain.slots[0].examNotMine;
    const said = chargeSwitchConsequences({ before: marked, after: plain, coursesById, entitlements: ENTS, customerVisits: [examVisit(), marked] });
    assert.ok(said);
    assert.ok(said.lines.some((l) => /接 8\/3\(一\) 那一次健檢/.test(l)), said.lines.join('｜'));
    assert.ok(!said.lines.some((l) => /（扣|（還/.test(l)), said.lines.join('｜'));
  });

  test('標記沒變（只改時長、醫師）→ 照舊不跳', () => {
    const same = visitOf([notMine({ doctorId: 'x' })], { id: 'v-2' });
    assert.equal(chargeSwitchConsequences({ before: after, after: same, coursesById, entitlements: ENTS, customerVisits: [after] }), null);
  });
});
