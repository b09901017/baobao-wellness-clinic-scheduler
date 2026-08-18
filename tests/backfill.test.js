// 時段反查。SPEC 第 8.4 節。
//
// 臨時空出一格時「誰可以補」。這一支盯的是三件事：
// 1. 排除的理由要能講出來 —— 她要看得出系統為什麼沒列某個人，不然不敢用
// 2. 只有「那天他自己說不行」與醫療禁忌會排除，其餘一律列出來（ADR-0002）
// 3. 排序用的是壓表那一套公式，不是另一套

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { candidatesFor, partsOfDay } from '../public/js/domain/scheduling.js';

const TODAY = '2026-09-15';
const DATE = '2026-09-18'; // 禮拜五

const COURSE = { id: 'course-recovery', name: '復能', requiresEquipment: true };

const EQUIPMENT = [
  { id: 'eq-indiba', name: 'INDIBA', contraindications: [] },
  { id: 'eq-sis', name: '超磁場', contraindications: ['體內金屬'] },
];

const customer = (over = {}) => ({ id: 'c1', name: '客戶一', active: true, priority: 0, flags: [], ...over });

const ent = (over = {}) => ({
  id: 'e1', type: 'pool', label: '復能', totalQty: 12, doneCount: 0, bookedCount: 0,
  optionEquipmentIds: ['eq-indiba', 'eq-sis'], ...over,
});

const collection = (rules = [], over = {}) => ({
  id: 'a1', collectedAt: '2026-09-01', validFrom: '2026-09-01', validTo: '2026-09-30',
  rawText: '九月的時間', rules, ...over,
});

function run(over = {}) {
  const c = over.customer ?? customer();
  return candidatesFor({
    course: COURSE,
    date: DATE,
    startsAt: '14:00',
    endsAt: '15:00',
    customers: [c],
    entitlementsBy: { [c.id]: over.entitlements ?? [ent()] },
    visitsBy: { [c.id]: over.visits ?? [] },
    availabilityBy: { [c.id]: over.availability ?? [collection()] },
    equipment: EQUIPMENT,
    today: TODAY,
    ...over.args,
  });
}

describe('上午還是下午', () => {
  test('跨中午的時段兩邊都算', () => {
    assert.deepEqual(partsOfDay('09:00', '10:00'), ['am']);
    assert.deepEqual(partsOfDay('14:00', '15:00'), ['pm']);
    assert.deepEqual(partsOfDay('11:30', '12:30'), ['am', 'pm']);
    assert.deepEqual(partsOfDay('12:00', '13:00'), ['pm']);
  });

  test('沒給結束時間就只看開始時間', () => {
    assert.deepEqual(partsOfDay('09:00'), ['am']);
    assert.deepEqual(partsOfDay('13:00'), ['pm']);
  });
});

describe('誰可以補', () => {
  test('有剩餘次數、那天沒被擋掉就是候選人', () => {
    const { candidates, excluded } = run();
    assert.equal(candidates.length, 1);
    assert.equal(excluded.length, 0);
    assert.equal(candidates[0].customerName, '客戶一');
  });

  test('沒買這個課程的人不算被排除，安靜跳過', () => {
    const { candidates, excluded } = run({
      entitlements: [ent({ type: 'single', courseId: 'course-iv', optionEquipmentIds: null })],
    });
    assert.equal(candidates.length, 0);
    assert.equal(excluded.length, 0);
  });

  test('沒有剩餘次數會被排除，而且說得出理由', () => {
    const { candidates, excluded } = run({ entitlements: [ent({ doneCount: 12 })] });
    assert.equal(candidates.length, 0);
    assert.match(excluded[0].why, /沒有剩餘次數/);
  });

  test('已停用與已刪除的客戶不出現', () => {
    assert.equal(run({ customer: customer({ active: false }) }).candidates.length, 0);
    assert.equal(run({ customer: customer({ deletedAt: 'x' }) }).candidates.length, 0);
  });
});

describe('那天他行不行', () => {
  test('整天被擋掉就排除，理由帶著原本的規則', () => {
    const { candidates, excluded } = run({
      availability: [collection([{ kind: 'exclude_date', date: DATE }])],
    });
    assert.equal(candidates.length, 0);
    assert.match(excluded[0].why, /不行/);
  });

  test('只擋半天：擋到的那半天才排除，另外半天照樣是候選人', () => {
    const rules = [{ kind: 'exclude_weekday', weekday: 5, partOfDay: 'pm' }];
    const afternoon = run({ availability: [collection(rules)] });
    assert.equal(afternoon.candidates.length, 0);
    assert.match(afternoon.excluded[0].why, /下午不行/);

    const morning = candidatesFor({
      course: COURSE, date: DATE, startsAt: '09:00', endsAt: '10:00',
      customers: [customer()],
      entitlementsBy: { c1: [ent()] },
      availabilityBy: { c1: [collection(rules)] },
      equipment: EQUIPMENT, today: TODAY,
    });
    assert.equal(morning.candidates.length, 1);
  });

  test('還沒問這輪的時間仍然列出來，但講明不知道他行不行（ADR-0002）', () => {
    const { candidates } = run({ availability: [] });
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0].fitNotes.some((n) => /還沒問這輪的時間/.test(n)));
  });

  test('過期的收集等於沒問過，不能拿來擋人', () => {
    const stale = collection([{ kind: 'exclude_date', date: DATE }], {
      validFrom: '2026-08-01', validTo: '2026-08-31',
    });
    const { candidates } = run({ availability: [stale] });
    assert.equal(candidates.length, 1);
  });

  test('他說這天方便就標出來', () => {
    const { candidates } = run({
      availability: [collection([{ kind: 'prefer', weekday: 5 }])],
    });
    assert.ok(candidates[0].fitNotes.some((n) => /他說這天方便/.test(n)));
  });
});

describe('那天已經有來訪', () => {
  const visit = (over = {}) => ({
    id: 'v1', customerId: 'c1', date: DATE, status: 'confirmed',
    slots: [{ startsAt: '10:00', endsAt: '11:00' }], ...over,
  });

  test('時間撞在一起就排除 —— 同一個人不可能同時在兩個地方', () => {
    const { candidates, excluded } = run({
      visits: [visit({ slots: [{ startsAt: '14:30', endsAt: '15:30' }] })],
    });
    assert.equal(candidates.length, 0);
    assert.match(excluded[0].why, /已經有來訪/);
  });

  test('同一天但不同時間是加分：那天他本來就要來', () => {
    const { candidates } = run({ visits: [visit()] });
    assert.equal(candidates.length, 1);
    assert.ok(candidates[0].fitNotes.some((n) => /本來就要來/.test(n)));
  });

  test('取消掉的來訪不算撞', () => {
    const { candidates } = run({
      visits: [visit({ status: 'cancelled', slots: [{ startsAt: '14:30', endsAt: '15:30' }] })],
    });
    assert.equal(candidates.length, 1);
  });
});

describe('醫療禁忌是唯一的硬性阻擋', () => {
  test('擇一池的器材被禁忌全部鎖住就排除', () => {
    const { candidates, excluded } = run({
      customer: customer({ flags: ['體內金屬'] }),
      entitlements: [ent({ optionEquipmentIds: ['eq-sis'] })],
    });
    assert.equal(candidates.length, 0);
    assert.match(excluded[0].why, /醫療禁忌/);
  });

  test('還有一種器材能用就照樣是候選人', () => {
    const { candidates } = run({ customer: customer({ flags: ['體內金屬'] }) });
    assert.equal(candidates.length, 1);
  });
});

describe('排序跟壓表同一套', () => {
  test('每一位都帶著人話理由，不是只有分數', () => {
    const { candidates } = run();
    assert.ok(candidates[0].reasons.length > 0);
    assert.ok(candidates[0].reasons.every((r) => typeof r.label === 'string' && r.label));
    assert.equal(typeof candidates[0].score, 'number');
  });

  test('可用天數少的排前面', () => {
    const busy = customer({ id: 'c2', name: '很忙的' });
    const free = customer({ id: 'c3', name: '很閒的' });

    const { candidates } = candidatesFor({
      course: COURSE, date: DATE, startsAt: '14:00', endsAt: '15:00',
      customers: [free, busy],
      entitlementsBy: { c2: [ent()], c3: [ent()] },
      availabilityBy: {
        // 很忙的人整個九月只有這天可以
        c2: [collection([{ kind: 'exclude_range', from: '2026-09-01', to: '2026-09-17' },
          { kind: 'exclude_range', from: '2026-09-19', to: '2026-09-30' }])],
        c3: [collection()],
      },
      equipment: EQUIPMENT, today: TODAY,
    });

    assert.deepEqual(candidates.map((c) => c.customerName), ['很忙的', '很閒的']);
  });
});

describe('壞資料', () => {
  test('日期或課程不對就回空的，不要湊一份名單出來', () => {
    const empty = { candidates: [], excluded: [] };
    assert.deepEqual(candidatesFor({ course: COURSE, date: 'x', startsAt: '14:00' }), empty);
    assert.deepEqual(candidatesFor({ date: DATE, startsAt: '14:00' }), empty);
  });
});
