// 拍 Abovee：同一張照片上的健檢接得上二返；一次健檢都沒有的二返不預設打勾（.scratch/followup-link-before-exam/issues/11，ADR-0145）。
//
// 她 10/9：
//
// > 如果有abovee壓到二返，他不知道接誰嗎，那不能讓我當下決定接誰嗎，或是如果也沒存的建檢，那就先預設不壓，
// > 也提醒要先去約健檢 ? 但還是可以先存然後去日曆接
//
// 例子一律假名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  readAbovee, examChoices, planAbovee, newRowSay, needsAttention, visitsForCheck, resolveSaved, refreshNoExam,
  pickOption, resolveItem, stuckLinks, plannedId,
} from '../public/js/domain/aboveeImport.js';
import { validateVisit } from '../public/js/domain/visits.js';
import { examChoiceNote } from '../public/js/domain/followups.js';
import { SEED } from '../public/js/domain/seed.js';

const CUSTOMERS = [{ id: 'c-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }];
const ENTS = {
  'c-wang': [
    { id: 'w-exam', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 2 },
    { id: 'w-fu', type: 'single', label: '二返', courseId: 'course-followup', totalQty: 2, followupForEntitlementId: 'w-exam' },
  ],
};
const ctx = (visits = [], over = {}) => ({
  customers: CUSTOMERS,
  entitlementsBy: ENTS,
  visitsBy: { 'c-wang': visits },
  master: { courses: SEED.courses, equipment: SEED.equipment, rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts },
  today: '2026-10-01',
  ...over,
});
const COLS = ['預約狀態', '預約日期', '預約時段', '姓名', '病歷號', '課程'];
const row = (date, time, course) => ['確認前往', date, time, '王小明', '00001234', course];
const read = (rows, c) => readAbovee([{ columns: COLS, rows }], c).items;
const EXAM_ROW = row('2026-10-03', '09:00 - 11:00', '健檢');
const FU_ROW = row('2026-10-24', '14:00 - 14:30', '二返');

describe('同一張照片上健檢和二返都是新的', () => {
  test('那一排列得出照片上那一次健檢，而且只有它時先選好', () => {
    const c = ctx();
    const items = read([EXAM_ROW, FU_ROW], c);
    const [exam, fu] = items;
    assert.equal(exam.entitlementId, 'w-exam', '健檢那一列先按好健檢那一筆');
    assert.equal(fu.entitlementId, 'w-fu');
    const choices = examChoices('c-wang', ENTS['c-wang'][1], c, items, fu);
    assert.deepEqual(choices.map((x) => [x.date, x.pickable]), [['2026-10-03', true]]);
    assert.equal(fu.followupForVisitId, choices[0].visitId, '只有一次接得上 → 先選好（她回的 3）');
    assert.equal(fu.checked, true);
  });

  test('驗證拿連同這一批的來訪：接在還沒存的那一次健檢上存得下去', () => {
    const c = ctx();
    const items = read([EXAM_ROW, FU_ROW], c);
    const { groups } = planAbovee(items, c);
    const fuGroup = groups.find((g) => g.date === '2026-10-24');
    const { errors } = validateVisit(fuGroup.visit, {
      customer: { flags: [] }, entitlements: ENTS['c-wang'], courses: SEED.courses, equipment: SEED.equipment,
      rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts, ...visitsForCheck(groups, fuGroup, c),
    });
    assert.deepEqual(errors.filter((e) => e.includes('健檢')), []);
  });

  test('健檢那一列拿掉勾：接不上了 —— 驗證講得出來，不會寫一個指到不存在的連結', () => {
    const c = ctx();
    const [exam, fu] = read([EXAM_ROW, FU_ROW], c);
    const items = [{ ...exam, checked: false }, fu];
    const { groups } = planAbovee(items, c);
    const [fuGroup] = groups;
    const { errors } = validateVisit(fuGroup.visit, {
      customer: { flags: [] }, entitlements: ENTS['c-wang'], courses: SEED.courses, equipment: SEED.equipment,
      rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts, ...visitsForCheck(groups, fuGroup, c),
    });
    assert.ok(errors.some((e) => e.includes('健檢來訪不存在')), errors.join('｜'));
  });

  test('存的時候：暫時的 id 換成先存好的那一天的真的 id；換不到就不接（不寫壞的連結）', () => {
    const c = ctx();
    const [, fu] = read([EXAM_ROW, FU_ROW], c);
    assert.equal(resolveSaved(fu, new Map([[fu.followupForVisitId, 'v-real']])).followupForVisitId, 'v-real');
    assert.equal(resolveSaved(fu, new Map()).followupForVisitId, null);
    const plain = { ...fu, followupForVisitId: 'v-stored' };
    assert.equal(resolveSaved(plain, new Map()).followupForVisitId, 'v-stored', '真的 id 不動');
  });

  test('系統裡已經有一次排著的、照片上又有一次：兩顆都按得下去、不替她選', () => {
    const booked = { id: 'v-b', customerId: 'c-wang', date: '2026-09-28', status: 'confirmed',
      slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'confirmed' }] };
    const c = ctx([booked]);
    const items = read([EXAM_ROW, FU_ROW], c);
    assert.equal(examChoices('c-wang', ENTS['c-wang'][1], c, items).filter((x) => x.pickable).length, 2);
    assert.equal(items[1].followupForVisitId, null);
  });
});

describe('系統裡沒有、照片上也沒有健檢', () => {
  test('二返那一列不預設打勾、收著看得到「先去約健檢」、排進要你看', () => {
    const [fu] = read([FU_ROW], ctx());
    assert.equal(fu.kind, 'new');
    assert.equal(fu.checked, false);
    assert.match(newRowSay(fu), /先去約健檢/);
    assert.equal(needsAttention(fu), true);
  });

  test('勾起來照樣記得進去（沒有連結）', () => {
    const c = ctx();
    const [fu] = read([FU_ROW], c);
    const { groups, problems } = planAbovee([{ ...fu, checked: true }], c);
    assert.deepEqual(problems, {});
    assert.equal(groups[0].visit.slots[0].followupForVisitId ?? null, null);
  });

  test('只有取消掉的健檢：一樣', () => {
    const gone = { id: 'v-x', customerId: 'c-wang', date: '2026-09-01', status: 'cancelled',
      slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'cancelled' }] };
    const [fu] = read([FU_ROW], ctx([gone]));
    assert.equal(fu.checked, false);
    assert.match(newRowSay(fu), /先去約健檢/);
  });

  test('系統裡有一次健檢（就算被別場佔走了）：不是這一種', () => {
    const done = { id: 'v-d', customerId: 'c-wang', date: '2026-09-01', status: 'done',
      slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'done' }] };
    const [fu] = read([FU_ROW], ctx([done]));
    assert.doesNotMatch(newRowSay(fu), /先去約健檢/);
  });
});

describe('她勾起照片上那一次健檢之後', () => {
  test('「先去約健檢」那一句跟著收掉；勾不勾、接哪一次照舊是她的', () => {
    const c = ctx();
    const [exam, fu] = read([row('2026-09-20', '09:00 - 11:00', '健檢'), FU_ROW], c);
    assert.equal(exam.checked, false, '過去的那一天不預設打勾');
    assert.equal(fu.noExam, true);
    const after = refreshNoExam([{ ...exam, checked: true }, fu], c);
    assert.equal(after[1].noExam, false);
    assert.equal(after[1].checked, fu.checked);
    assert.equal(after[1].followupForVisitId, null, '不替她接');
  });
});

// ---------- 10/9 審查抓到的 ----------

const SAME_DAY_FU = row('2026-10-03', '14:00 - 14:30', '二返');
const checkDay = (items, c, date) => {
  const { groups } = planAbovee(items, c);
  const g = groups.find((x) => x.date === date);
  return validateVisit(g.visit, {
    customer: { flags: [] }, entitlements: ENTS['c-wang'], courses: SEED.courses, equipment: SEED.equipment,
    rooms: SEED.rooms, staff: SEED.staff, ivProducts: SEED.ivProducts, ...visitsForCheck(groups, g, c),
  });
};

describe('同一天的健檢＋二返都是這一次才要記的', () => {
  // 連結記的是來訪 id，而那一天的健檢跟這一列同一次寫進去 —— 來訪編輯器同一條：「這一天的健檢存好之後才接得上」。
  // 以前先選好自己那一天的暫時 id，驗證認不得它，那一天兩列都記不進去
  test('不先接到自己那一天；那一顆列得出來、按不下去、講「存好才接得上」', () => {
    const c = ctx();
    const items = read([EXAM_ROW, SAME_DAY_FU], c);
    const fu = items[1];
    assert.equal(fu.followupForVisitId, null);
    assert.equal(fu.checked, true, '照片上有那一次健檢：不是「先去約健檢」那一種');
    assert.equal(Boolean(fu.noExam), false);
    const [own] = examChoices('c-wang', ENTS['c-wang'][1], c, items, fu);
    assert.deepEqual([own.date, own.pickable, own.unsaved], ['2026-10-03', false, true]);
    assert.equal(examChoiceNote(own), '存好才接得上');
  });

  test('那一天存得下去，提醒講得出為什麼沒接', () => {
    const c = ctx();
    const { errors, warnings } = checkDay(read([EXAM_ROW, SAME_DAY_FU], c), c, '2026-10-03');
    assert.deepEqual(errors, []);
    assert.ok(warnings.some((w) => w.includes('這一天的健檢存好之後才接得上')), warnings.join('｜'));
  });

  test('那一天的健檢已經存著：照舊接得上（接的是存著的那一筆）', () => {
    const stored = { id: 'v-s', customerId: 'c-wang', date: '2026-10-03', status: 'confirmed',
      slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'confirmed' }] };
    const c = ctx([stored]);
    const items = read([EXAM_ROW, SAME_DAY_FU], c);
    assert.equal(items[1].followupForVisitId, 'v-s');
    assert.deepEqual(checkDay(items, c, '2026-10-03').errors, []);
  });

  test('那一天存著別的段、健檢是這一次才要記的：一樣不接（存著的那一份還沒有健檢）', () => {
    const stored = { id: 'v-s', customerId: 'c-wang', date: '2026-10-03', status: 'confirmed',
      slots: [{ entitlementId: null, courseId: 'course-hrv', startsAt: '08:00', endsAt: '08:30', status: 'confirmed' }] };
    const c = ctx([stored]);
    const items = read([EXAM_ROW, SAME_DAY_FU], c);
    assert.equal(items[1].followupForVisitId, null);
    const [own] = examChoices('c-wang', ENTS['c-wang'][1], c, items, items[1]);
    assert.deepEqual([own.visitId, own.pickable, own.unsaved], ['v-s', false, true]);
  });
});

describe('一次健檢、照片上兩列二返', () => {
  test('只有前面那一列先選好；後面那一列看得到它被約走了', () => {
    const c = ctx();
    const items = read([EXAM_ROW, FU_ROW, row('2026-10-31', '14:00 - 14:30', '二返')], c);
    assert.equal(items[1].followupForVisitId, 'abovee:c-wang|2026-10-03');
    assert.equal(items[2].followupForVisitId, null);
    assert.deepEqual(checkDay(items, c, '2026-10-24').errors, []);
    assert.deepEqual(checkDay(items, c, '2026-10-31').errors, []);
    const [exam] = examChoices('c-wang', ENTS['c-wang'][1], c, items, items[2]);
    assert.deepEqual([exam.taken, exam.pickable], [true, false]);
  });
});

describe('先選好哪一次：讀照片那一下與她自己再按一次是同一條', () => {
  const booked = { id: 'v-b', customerId: 'c-wang', date: '2026-09-28', status: 'confirmed',
    slots: [{ entitlementId: 'w-exam', courseId: 'course-checkup', startsAt: '09:00', endsAt: '11:00', status: 'confirmed' }] };

  test('系統裡一次＋照片上一次：兩條都不替她選', () => {
    const c = ctx([booked]);
    const items = read([EXAM_ROW, FU_ROW], c);
    assert.equal(items[1].followupForVisitId, null);
    assert.equal(pickOption(items[1], 'w-fu', c, items).followupForVisitId, null);
  });

  test('只有照片上那一次：兩條都選它', () => {
    const c = ctx();
    const items = read([EXAM_ROW, FU_ROW], c);
    assert.equal(pickOption(items[1], 'w-fu', c, items).followupForVisitId, items[1].followupForVisitId);
    assert.ok(items[1].followupForVisitId);
  });

  test('換一位（`resolveItem()`）也是', () => {
    const c = ctx();
    const items = read([EXAM_ROW, FU_ROW], c);
    assert.equal(resolveItem(items[1], 'c-wang', c, items).followupForVisitId, items[1].followupForVisitId);
  });
});

describe('接的那一次健檢那一天這一次記不進去', () => {
  test('二返那一列也先不記、講得出來 —— 不安靜地存成沒接上', () => {
    const c = ctx();
    const items = read([EXAM_ROW, FU_ROW], c);
    const { groups } = planAbovee(items, c);
    const say = stuckLinks(groups, { [items[0].key]: ['隨便一個問題'] }, c);
    assert.deepEqual(Object.keys(say), [items[1].key]);
    assert.match(say[items[1].key], /10\/3.*記不進去/);
    assert.deepEqual(stuckLinks(groups, {}, c), {});
  });

  test('先存哪一天照同一套 id：併進既有那一天的是那一筆的真的 id', () => {
    const stored = { id: 'v-s', customerId: 'c-wang', date: '2026-10-03', status: 'confirmed',
      slots: [{ entitlementId: null, courseId: 'course-hrv', startsAt: '08:00', endsAt: '08:30', status: 'confirmed' }] };
    const c = ctx([stored]);
    const items = read([EXAM_ROW, FU_ROW], c);
    const { groups } = planAbovee(items, c);
    assert.equal(items[1].followupForVisitId, 'v-s');
    assert.equal(plannedId(groups.find((g) => g.date === '2026-10-03')), 'v-s');
    assert.equal(plannedId(groups.find((g) => g.date === '2026-10-24')), 'abovee:c-wang|2026-10-24');
  });
});
