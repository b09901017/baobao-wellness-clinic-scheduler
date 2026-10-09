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
} from '../public/js/domain/aboveeImport.js';
import { validateVisit } from '../public/js/domain/visits.js';
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
    const choices = examChoices('c-wang', ENTS['c-wang'][1], c, items, fu.followupForVisitId);
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
