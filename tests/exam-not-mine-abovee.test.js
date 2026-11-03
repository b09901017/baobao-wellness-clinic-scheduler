// 健檢不是我排的：拍 Abovee 那一列（exam-not-mine 08，ADR-0169）。
//
// 她 11/2：
//
// > 我現在遇到的問題是，我拍了客戶A的三返，但是app會問這是哪一堂以及沒有n反讓我選也不能選醫生
// > 我想要的是我拍照後能認出三返或是二返或是四返，並且可以如果沒有綁健檢或是這個人身上沒有健檢的話只提醒他沒有，而是不是直接不能選 ?
//
// 這一支釘三件事：
// 1. 讀照片那一下**不替她按、不替她勾**：照片是三返而這位沒有接得上的健檢、照片是二返而這位一筆二返額度都沒有 → 那一列講一句、指她去「其他」
// 2. 她按了那一顆 → 這一列交給 `slotFromPicks()` 的就是 02 那一條路（標記＋返數），組得出一段、存得下去
// 3. **一般的客人一個字都不變**：有健檢的三返、有額度的二返（連用完的那一筆）照舊預選、照舊勾
//
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  readAbovee, resolveItem, optionValueOf, pickOption, pickMinutes, picksOf, planAbovee, newRowSay, needsAttention,
  photoDayPlan, refreshNoExam, refreshCloseBlocks,
} from '../public/js/domain/aboveeImport.js';
import { NTH_PICK, NOT_MINE_PICK, EXTRA_GROUP, slotOptionsFor } from '../public/js/domain/slotOptions.js';
import { slotFromPicks } from '../public/js/domain/slotDraft.js';
import { isExamNotMine, EXAM_NOT_MINE_LABEL, DOCTOR_ROLE } from '../public/js/domain/masterData.js';
import { aboveeConsequences } from '../public/js/domain/consequences.js';
import { SEED } from '../public/js/domain/seed.js';

const COURSES = SEED.courses;
const MASTER = { courses: COURSES, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts };
const DOCTOR = SEED.staff.find((s) => s.role === DOCTOR_ROLE);

const CUSTOMERS = [
  { id: 'c-a', name: '客戶A', marks: [] }, // 別人轉來的：沒有健檢、沒有任何二返額度
  { id: 'c-b', name: '客戶B', marks: [] }, // 一般的：做完健檢、身上有二返額度
  { id: 'c-c', name: '客戶C', marks: [] }, // 有一筆用完的二返額度
  { id: 'c-d', name: '客戶D', marks: [] }, // 二返額度刪掉了
];
const B_ENTS = [
  { id: 'b-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1 },
  { id: 'b-fu', type: 'single', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'b-exam', totalQty: 1 },
];
const B_EXAM = {
  id: 'v-b-exam', customerId: 'c-b', customerName: '客戶B', date: '2026-08-20', status: 'done',
  slots: [{ entitlementId: 'b-exam', courseId: 'course-checkup', courseName: '健檢', startsAt: '09:00', endsAt: '11:00', status: 'done' }],
};
const C_ENTS = [
  { id: 'c-exam', type: 'single', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1 },
  { id: 'c-fu', type: 'single', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'c-exam', totalQty: 1 },
];
const C_VISITS = [{
  id: 'v-c', customerId: 'c-c', customerName: '客戶C', date: '2026-08-10', status: 'done',
  slots: [
    { entitlementId: 'c-exam', courseId: 'course-checkup', courseName: '健檢', startsAt: '09:00', endsAt: '11:00', status: 'done' },
    { entitlementId: 'c-fu', courseId: 'course-followup', courseName: '二返', startsAt: '11:00', endsAt: '11:30', status: 'done', followupForVisitId: null },
  ],
}];
const D_ENTS = [
  { id: 'd-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 1, deletedAt: '2026-08-01' },
];

const ctx = (over = {}) => ({
  customers: CUSTOMERS,
  entitlementsBy: { 'c-a': [], 'c-b': B_ENTS, 'c-c': C_ENTS, 'c-d': D_ENTS },
  visitsBy: { 'c-a': [], 'c-b': [B_EXAM], 'c-c': C_VISITS, 'c-d': [] },
  master: MASTER,
  today: '2026-09-01',
  ...over,
});

const LEFT = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
/** 照片上一列（確認前往、還沒到 —— 照片那一條是「勾」）。 */
const row = (name, course, time = '10:00 - 10:30') => ['確認前往', '2026-09-10', time, name, '', course];
const readRows = (rows, c = ctx()) => readAbovee([{ columns: LEFT, rows }], c).items;
const read = (name, course, c = ctx()) => readRows([row(name, course)], c)[0];

/** 這一列勾起來之後，存的那一下組出來的那一段（`planAbovee()`，跟確認層畫列同一支 `picksOf()`）。 */
const planned = (item, c = ctx()) => planAbovee([{ ...item, checked: true }], c);

describe('讀照片那一下：不替她按、不替她勾，講一句', () => {
  test('照片上是三返、這位沒有接得上的健檢 → 一顆都沒按、不勾、指她去「其他」', () => {
    const item = read('客戶A', '三返');
    assert.equal(item.kind, 'new');
    assert.equal(optionValueOf(item), null, '不替她按任何一顆（以前預選 n返，而那一排上沒有 n返）');
    assert.equal(item.isNth, false);
    assert.equal(item.checked, false);
    assert.deepEqual(item.notMineHint, { nth: 3, offered: true });
    const say = newRowSay(item);
    assert.match(say, /照片上是三返/);
    assert.match(say, /沒有接得上的健檢/);
    assert.ok(say.includes(`「${EXTRA_GROUP}」`) && say.includes(`「${EXAM_NOT_MINE_LABEL}」`), say);
    assert.ok(needsAttention(item), '排進「要你看」（同 noExam）');
  });

  test('照片上是二返、這位一筆二返額度都沒有 → 同上，那一句講額度', () => {
    const item = read('客戶A', '二返');
    assert.equal(optionValueOf(item), null);
    assert.equal(item.checked, false);
    assert.deepEqual(item.notMineHint, { nth: 2, offered: true });
    assert.match(newRowSay(item), /照片上是二返，這位客戶身上沒有二返額度/);
  });

  test('二返額度刪掉了 → 算沒有', () => {
    assert.deepEqual(read('客戶D', '二返').notMineHint, { nth: 2, offered: true });
  });

  test('四返也認得', () => {
    assert.deepEqual(read('客戶A', '四返').notMineHint, { nth: 4, offered: true });
    assert.match(newRowSay(read('客戶A', '四返')), /照片上是四返/);
  });

  test('二返那門課不是剛好一門（那一顆不畫）→ 照樣不替她按、不勾，但那一句不叫她去按一顆不存在的鈕', () => {
    const two = COURSES.map((c) => (c.id === 'course-iv-drip' ? { ...c, followupCourseId: 'course-x' } : c))
      .concat({ ...COURSES.find((c) => c.id === 'course-followup'), id: 'course-x', name: '二返B' });
    const c = ctx({ master: { ...MASTER, courses: two } });
    const item = read('客戶A', '三返', c);
    assert.equal(item.checked, false);
    assert.deepEqual(item.notMineHint, { nth: 3, offered: false });
    assert.ok(!newRowSay(item).includes(EXAM_NOT_MINE_LABEL), newRowSay(item));
    assert.match(newRowSay(item), /先去約健檢/);
  });
});

describe('一般的客人一個字都不變', () => {
  test('有健檢的三返：照舊預選 n返、照舊勾、沒有那一句', () => {
    const item = read('客戶B', '三返');
    assert.equal(optionValueOf(item), NTH_PICK);
    assert.deepEqual([item.isNth, item.nth, item.checked], [true, 3, true]);
    assert.equal(item.notMineHint, null);
    assert.equal(newRowSay(item), '');
  });

  test('有額度的二返：照舊預選那一筆、接那一次健檢、照舊勾', () => {
    const item = read('客戶B', '二返');
    assert.deepEqual([optionValueOf(item), item.followupForVisitId, item.checked], ['b-fu', 'v-b-exam', true]);
    assert.equal(item.notMineHint, null);
  });

  test('二返額度用完了（過目 S9）：照舊預選那一筆（超用的提醒照講），不講那一句', () => {
    const item = read('客戶C', '二返');
    assert.equal(optionValueOf(item), 'c-fu');
    assert.equal(item.notMineHint, null);
  });

  test('讀照片那一下從來不替她按「健檢不是我排的」', () => {
    for (const [who, course] of [['客戶A', '三返'], ['客戶A', '二返'], ['客戶B', '三返'], ['客戶B', '二返'], ['客戶A', 'SIS 60']]) {
      const item = read(who, course);
      assert.notEqual(optionValueOf(item), NOT_MINE_PICK, `${who} ${course}`);
      assert.equal(picksOf(item).examNotMine, false, `${who} ${course}`);
    }
  });
});

describe('她按了「健檢不是我排的」', () => {
  test('三返：返數照照片、不扣、不接健檢、醫師照照片 → 組得出帶標記的三返、存得下去', () => {
    const photo = { ...read('客戶A', '三返'), doctorId: DOCTOR.id };
    const item = pickOption(photo, NOT_MINE_PICK, ctx());
    assert.equal(optionValueOf(item), NOT_MINE_PICK);
    assert.deepEqual([item.notMine, item.nth, item.isNth, item.entitlementId, item.followupForVisitId, item.giftCourseId],
      [true, 3, false, null, null, null]);
    assert.equal(item.notMineHint, null, '按了就不再講那一句');
    assert.equal(item.doctorId, DOCTOR.id, '醫師照照片');
    const picks = picksOf(item);
    assert.deepEqual([picks.examNotMine, picks.nth, picks.entitlementId, picks.isNth], [true, 3, null, false]);
    const { groups, problems } = planned(item);
    assert.deepEqual(problems, {});
    const slot = groups[0].visit.slots[0];
    assert.ok(isExamNotMine(slot));
    assert.deepEqual([slot.courseId, slot.followupNth, slot.entitlementId, slot.followupForVisitId, slot.giftKind],
      ['course-followup', 3, null, null, null]);
    assert.equal(slot.doctorId, DOCTOR.id);
  });

  test('二返：返數是 2、時段上沒有 followupNth 這一格', () => {
    const item = pickOption(read('客戶A', '二返'), NOT_MINE_PICK, ctx());
    assert.equal(item.nth, 2);
    const slot = planned(item).groups[0].visit.slots[0];
    assert.ok(isExamNotMine(slot));
    assert.ok(!('followupNth' in slot));
    assert.equal(slot.courseName, '二返');
  });

  test('照片上不是回訪（SIS 60）→ 返數不預選；勾了講「先選第幾返」、選了就存得下去', () => {
    const item = pickOption(read('客戶A', 'SIS 60'), NOT_MINE_PICK, ctx());
    assert.equal(item.nth, null);
    assert.deepEqual(planned(item).problems[item.key], ['先選第幾返']);
    // 確認層畫列也是同一支：課程照樣交回來（醫師那一排靠它畫）
    const built = slotFromPicks(picksOf(item), { ...MASTER, entitlements: [], visits: [] });
    assert.equal(built.course?.id, 'course-followup');
    assert.deepEqual(planned({ ...item, nth: 5 }).problems, {});
  });

  test('一般的客人也按得下去（她自己按的）：不扣二返額度、不接那一次健檢', () => {
    const item = pickOption(read('客戶B', '二返'), NOT_MINE_PICK, ctx());
    assert.deepEqual([item.notMine, item.entitlementId, item.followupForVisitId], [true, null, null]);
    const slot = planned(item).groups[0].visit.slots[0];
    assert.deepEqual([slot.entitlementId, slot.followupForVisitId], [null, null]);
  });

  test('換回別的一顆 → 標記清掉；再按回 n返 / 額度組出來的是一般的段', () => {
    const notMine = pickOption(read('客戶B', '三返'), NOT_MINE_PICK, ctx());
    const back = pickOption(notMine, NTH_PICK, ctx());
    assert.deepEqual([back.notMine, back.isNth, back.nth], [false, true, 3]);
    assert.equal(optionValueOf(back), NTH_PICK);
    const ent = pickOption(notMine, 'b-fu', ctx());
    assert.deepEqual([ent.notMine, ent.nth, ent.entitlementId], [false, null, 'b-fu']);
    assert.equal(picksOf(ent).examNotMine, false);
    assert.equal(picksOf(ent).nth, null);
  });

  test('「排多久」按 60 → 還是它、只換分鐘（不會被換成體驗）', () => {
    const item = pickMinutes(pickOption(read('客戶A', '三返'), NOT_MINE_PICK, ctx()), 60, ctx());
    assert.deepEqual([optionValueOf(item), item.minutes], [NOT_MINE_PICK, 60]);
    assert.equal(planned(item).groups[0].visit.slots[0].endsAt, '11:00');
  });

  test('換一位：新的那一位身上不留上一位的標記，重算那一句', () => {
    const notMine = pickOption(read('客戶A', '三返'), NOT_MINE_PICK, ctx());
    const swapped = resolveItem(notMine, 'c-b', ctx());
    assert.equal(swapped.notMine, false);
    assert.equal(optionValueOf(swapped), NTH_PICK, '換成有健檢的那一位：照一般的預選');
    assert.equal(swapped.notMineHint, null);
    const back = resolveItem(swapped, 'c-a', ctx());
    assert.deepEqual([back.notMine, optionValueOf(back), back.checked], [false, null, false]);
    assert.deepEqual(back.notMineHint, { nth: 3, offered: true });
  });

  test('確認層那一排上有那一顆、按著的就是它（`slotOptionsFor()` 同一份）', () => {
    const item = pickOption(read('客戶A', '三返'), NOT_MINE_PICK, ctx());
    const options = slotOptionsFor({ entitlements: [], visits: [], courses: COURSES, equipment: SEED.equipment }, { includeUsedUp: true });
    assert.ok(options.some((o) => o.entitlementId === optionValueOf(item) && o.isNotMine));
  });
});

describe('跟整張一起看的那幾步', () => {
  test('不進「接哪一次健檢」那一圈（linkBatchExams／refreshNoExam），也不算二返簽不成', () => {
    const items = readRows([row('客戶A', '三返'), row('客戶A', '二返', '11:00 - 11:30')]);
    const pressed = items.map((i) => ({ ...pickOption(i, NOT_MINE_PICK, ctx(), items), checked: true }));
    const again = refreshCloseBlocks(refreshNoExam(pressed, ctx()), ctx());
    assert.deepEqual(again.map((i) => [i.noExam, i.closeBlock, i.followupForVisitId]), [[false, null, null], [false, null, null]]);
    const plan = photoDayPlan(pressed, ctx());
    assert.deepEqual(plan.problems, {});
    assert.equal(plan.writes.length, 1);
    const slots = plan.writes[0].visit.slots;
    assert.deepEqual(slots.map((s) => [isExamNotMine(s), s.followupNth ?? null, s.entitlementId]), [[true, 3, null], [true, null, null]]);
    // 次數一格都沒動：計畫的 rows 每一列都是 0
    assert.ok(plan.rows.every((r) => r.charge === 0), JSON.stringify(plan.rows));
  });

  test('照片寫課程完成、日子過了：記成已完成（沒有健檢可以擋它）', () => {
    const done = readAbovee([{ columns: LEFT, rows: [['課程完成', '2026-08-25', '10:00 - 10:30', '客戶A', '', '三返']] }], ctx()).items[0];
    assert.equal(done.checked, false, '讀照片那一下照樣不勾');
    const item = { ...pickOption(done, NOT_MINE_PICK, ctx()), checked: true };
    const { groups } = planAbovee([item], ctx());
    assert.equal(groups[0].visit.slots[0].status, 'done');
    assert.deepEqual(groups[0].blocked, {});
  });

  test('確認框講「三返的健檢不是你排的」（04 接好的那一句）', () => {
    const item = { ...pickOption(read('客戶A', '三返'), NOT_MINE_PICK, ctx()), checked: true };
    const plan = photoDayPlan([item], ctx());
    const coursesById = Object.fromEntries(COURSES.map((c) => [c.id, c]));
    const { lines } = aboveeConsequences({
      plan, coursesById, entitlementsBy: ctx().entitlementsBy, visitsBy: ctx().visitsBy, today: ctx().today,
    });
    assert.match(lines.join('\n'), /三返的健檢不是你排的/);
  });
});

describe('下一次再拍到同一段', () => {
  const saved = (slot) => ({
    id: 'v-a', customerId: 'c-a', customerName: '客戶A', date: '2026-09-10', status: 'pending_confirm', slots: [slot],
  });
  const threeBack = {
    entitlementId: null, courseId: 'course-followup', courseName: '三返', followupNth: 3, followupForVisitId: null,
    startsAt: '10:00', endsAt: '10:30', status: 'pending_confirm', giftKind: null, examNotMine: true,
  };
  const twoBack = { ...threeBack, courseName: '二返', followupNth: undefined };
  delete twoBack.followupNth;

  test('三返 → 已經記了，不提議改扣法、不再多記一段', () => {
    const item = read('客戶A', '三返', ctx({ visitsBy: { ...ctx().visitsBy, 'c-a': [saved(threeBack)] } }));
    assert.equal(item.kind, 'recorded');
    assert.deepEqual([item.chargeChange, item.notMine, item.notMineHint, item.checked], [null, false, null, false]);
  });

  test('二返 → 已經記了，不提議改扣法', () => {
    const item = read('客戶A', '二返', ctx({ visitsBy: { ...ctx().visitsBy, 'c-a': [saved(twoBack)] } }));
    assert.equal(item.kind, 'recorded');
    assert.deepEqual([item.chargeChange, item.notMineHint], [null, null]);
  });

  test('匯入的舊段沒有開始時間（claimTimeless → asRecorded）：那一句的旗標一起清掉', () => {
    const timeless = { ...threeBack, startsAt: null, endsAt: null, examNotMine: undefined };
    delete timeless.examNotMine;
    const item = read('客戶A', '三返', ctx({ visitsBy: { ...ctx().visitsBy, 'c-a': [saved(timeless)] } }));
    assert.equal(item.kind, 'recorded');
    assert.equal(item.timeless, true);
    assert.equal(item.notMineHint, null);
    assert.equal(item.notMine, false);
  });
});
