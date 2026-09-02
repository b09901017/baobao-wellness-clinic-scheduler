// 壓表佇列。SPEC 第 9 節、ADR-0001、ADR-0002。
//
// 這一支盯的是兩件容易做錯的事：
// 1. 「待壓表」是推導出來的，不是存的欄位
// 2. 排序的每一項都要說得出人話理由，不可以只有一個分數

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  monthRange, entitlementCovers, pendingFor, buildCustomerQueue, customerPools,
  strongestReason, newBatch, progressOf, markInQueue, nextPending, customersToAsk,
  customersToAskForMonth,
  customersToBook,
  sortQueueRows, QUEUE_SORTS, DEFAULT_WEIGHTS,
} from '../public/js/domain/scheduling.js';

const COURSE = { id: 'course-recovery', name: '復能', requiresEquipment: true };
const IV = { id: 'course-iv', name: '靜脈' };

const ent = (over = {}) => ({
  id: 'e1', type: 'pool', label: '復能', totalQty: 12,
  doneCount: 0, bookedCount: 0, optionEquipmentIds: ['eq-a', 'eq-b'],
  ...over,
});

const visit = (over = {}) => ({
  id: 'v1', status: 'confirmed', date: '2026-09-10',
  slots: [{ courseId: COURSE.id, entitlementId: 'e1' }],
  ...over,
});

describe('月份範圍', () => {
  test('算得出整月，閏年也對', () => {
    assert.deepEqual(monthRange('2026-09'), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  });

  test('亂寫回 null，不要組出壞範圍', () => {
    for (const bad of ['', '2026-13', 'x', null]) assert.equal(monthRange(bad), null);
  });
});

describe('額度對得上哪個課程', () => {
  test('single 看 courseId', () => {
    assert.ok(entitlementCovers(ent({ type: 'single', courseId: IV.id }), IV));
    assert.ok(!entitlementCovers(ent({ type: 'single', courseId: IV.id }), COURSE));
  });

  test('擇一池沒有 courseId，看課程要不要選器材（ADR-0005）', () => {
    assert.ok(entitlementCovers(ent(), COURSE));
    assert.ok(!entitlementCovers(ent(), IV));
  });

  test('已刪除的額度不算', () => {
    assert.ok(!entitlementCovers(ent({ deletedAt: 'x' }), COURSE));
  });
});

describe('待壓表是推導出來的（ADR-0001）', () => {
  const base = { course: COURSE, entitlements: [ent()], targetMonth: '2026-09' };

  test('有剩餘次數而且該月沒有這個課程的來訪 = 待壓表', () => {
    const r = pendingFor({ ...base, visits: [] });
    assert.equal(r.pending, true);
    assert.equal(r.remaining, 12);
  });

  test('該月已經排過就不是待壓表', () => {
    assert.equal(pendingFor({ ...base, visits: [visit()] }).pending, false);
  });

  test('取消的來訪不算排過 —— 時段已經還回去了', () => {
    assert.equal(pendingFor({ ...base, visits: [visit({ status: 'cancelled' })] }).pending, true);
  });

  test('別的月份排過不影響這個月', () => {
    assert.equal(pendingFor({ ...base, visits: [visit({ date: '2026-08-10' })] }).pending, true);
  });

  test('別的課程排過不影響這個課程', () => {
    const other = visit({ slots: [{ courseId: IV.id, entitlementId: 'e2' }] });
    assert.equal(pendingFor({ ...base, visits: [other] }).pending, true);
  });

  test('次數用完就不是待壓表', () => {
    const used = ent({ doneCount: 8, bookedCount: 4 });
    assert.equal(pendingFor({ ...base, entitlements: [used], visits: [] }).pending, false);
  });

  test('沒有這個課程的額度就不在佇列裡', () => {
    const only = ent({ type: 'single', courseId: IV.id });
    assert.equal(pendingFor({ ...base, entitlements: [only], visits: [] }).pending, false);
  });
});

describe('一位客戶身上的所有額度', () => {
  test('清單頁讀計數欄位，詳情頁現算 —— 兩條路要算出同一件事（ADR-0004）', () => {
    const e = ent({ id: 'e1', totalQty: 12, doneCount: 2, bookedCount: 1 });
    const visits = [
      { id: 'a', status: 'done', slots: [{ entitlementId: 'e1' }, { entitlementId: 'e1' }] },
      { id: 'b', status: 'confirmed', slots: [{ entitlementId: 'e1' }] },
    ];

    const cached = customerPools({ entitlements: [e], cached: true });
    const live = customerPools({ entitlements: [e], visits, cached: false });

    assert.equal(cached.pools[0].remaining, 9);
    assert.equal(live.pools[0].remaining, 9);
  });

  test('已刪除的額度不算', () => {
    const out = customerPools({ entitlements: [ent(), ent({ id: 'x', deletedAt: 'x' })] });
    assert.equal(out.pools.length, 1);
  });

  // ADR-0057：這一支是全站的閘門。漏掉的話她的待辦上會冒出
  // 「還有 2 次沒壓表」，而那 2 是兩罐夜態美。
  test('營養品不算 —— 它排不進來訪', () => {
    const out = customerPools({
      entitlements: [ent(), { id: 'p', type: 'product', label: '夜態美', totalQty: 2 }],
    });
    assert.equal(out.pools.length, 1);
    assert.equal(out.totalRemaining, 12, '兩罐夜態美不是兩次');
  });

  test('最快到期的那一份決定急迫度，用完的不算', () => {
    const out = customerPools({
      entitlements: [
        ent({ id: 'a', expiresAt: '2026-12-31' }),
        ent({ id: 'b', expiresAt: '2026-09-30', doneCount: 12 }),
        ent({ id: 'c', expiresAt: '2026-10-31' }),
      ],
    });
    assert.equal(out.soonestExpiry, '2026-10-31', '9/30 那份已經用完了，不急');
  });

  test('都沒有到期日就回 null，不要瞎編一個', () => {
    assert.equal(customerPools({ entitlements: [ent()] }).soonestExpiry, null);
  });
});

describe('佇列排序', () => {
  const today = '2026-08-28';
  const targetMonth = '2026-09';

  const customers = [
    { id: 'c1', name: '客戶甲', priority: 5, active: true },
    { id: 'c2', name: '客戶乙', priority: 0, active: true },
    { id: 'c3', name: '客戶丙', priority: 0, active: true },
  ];
  const entitlementsBy = { c1: [ent()], c2: [ent({ id: 'e2' })], c3: [ent({ id: 'e3' })] };

  const build = (over = {}) =>
    buildCustomerQueue({
      customers, entitlementsBy,
      visitsBy: {}, availabilityBy: {}, targetMonth, today,
      weights: DEFAULT_WEIGHTS, ...over,
    });

  test('這個月排過的人仍然留在牆上（ADR-0014）', () => {
    const rows = build({ visitsBy: { c2: [visit()] } });
    assert.deepEqual(rows.map((r) => r.customerId).sort(), ['c1', 'c2', 'c3']);

    const c2 = rows.find((r) => r.customerId === 'c2');
    assert.equal(c2.scheduledThisMonth, 1, '排過幾次要看得到');
    assert.equal(c2.pending, false, '「還沒壓過」變成一個篩選，不是進不進來的條件');
  });

  test('次數全部用完的就不進來了', () => {
    const rows = build({ entitlementsBy: { ...entitlementsBy, c2: [ent({ id: 'e2', doneCount: 12 })] } });
    assert.ok(!rows.some((r) => r.customerId === 'c2'));
  });

  test('開著的批次要留住次數用完的人 —— 處理到一半把人弄不見更難懂', () => {
    const rows = build({
      entitlementsBy: { ...entitlementsBy, c2: [ent({ id: 'e2', doneCount: 12 })] },
      includeUsedUp: true,
    });
    assert.ok(rows.some((r) => r.customerId === 'c2'));
  });

  test('卡片上一個課程一顆泡泡，快用完的排前面', () => {
    const rows = build({
      entitlementsBy: {
        ...entitlementsBy,
        c1: [ent({ id: 'a', label: '復能', totalQty: 20, doneCount: 6, bookedCount: 2 }),
             ent({ id: 'b', type: 'single', courseId: IV.id, label: '靜脈', totalQty: 12, doneCount: 11 })],
      },
    });
    const c1 = rows.find((r) => r.customerId === 'c1');
    assert.deepEqual(c1.pools.map((p) => p.label), ['靜脈', '復能'], '剩 1 次的要排在剩 12 次的前面');
    assert.equal(c1.pools[0].remaining, 1);
    assert.equal(c1.totalRemaining, 13);
  });

  test('這個月與上個月各來幾次都算得出來', () => {
    const rows = build({
      visitsBy: {
        c1: [visit({ id: 'a', date: '2026-09-03' }), visit({ id: 'b', date: '2026-09-17' }),
             visit({ id: 'c', date: '2026-08-05' })],
      },
    });
    const c1 = rows.find((r) => r.customerId === 'c1');
    assert.equal(c1.scheduledThisMonth, 2);
    assert.equal(c1.visitsPrevMonth, 1);
  });

  test('她自己寫的特殊狀況原樣帶著走', () => {
    const rows = build({
      customers: [{ ...customers[0], notes: '重大疾病治療中' }],
    });
    assert.deepEqual(rows[0].marks, [{ text: '重大疾病治療中', color: 'grey' }]);
  });

  test('停用與已刪除的客戶不進佇列', () => {
    const rows = build({
      customers: [...customers, { id: 'c4', name: '客戶丁', active: false },
        { id: 'c5', name: '客戶戊', deletedAt: 'x' }],
    });
    assert.ok(!rows.some((r) => ['c4', 'c5'].includes(r.customerId)));
  });

  test('可用天數越少排越前面', () => {
    const rows = build({
      customers: [customers[1], customers[2]],
      availabilityBy: {
        c2: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today,
               rules: [{ kind: 'exclude_range', from: '2026-09-01', to: '2026-09-25' }] }],
        c3: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today, rules: [] }],
      },
    });
    assert.equal(rows[0].customerId, 'c2');
    assert.equal(rows[0].availableDays, 5);
    assert.equal(rows[1].availableDays, 30);
  });

  test('每一項的貢獻都要有人話標籤，不可以只有分數', () => {
    const rows = build({
      availabilityBy: {
        c1: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today, rules: [] }],
      },
    });
    const row = rows.find((r) => r.customerId === 'c1');

    const labels = row.reasons.map((x) => x.label);
    assert.ok(labels.some((l) => l.includes('可用 30 天')), labels.join(' / '));
    assert.ok(labels.some((l) => l.includes('喜好 ★5')), labels.join(' / '));
    assert.ok(labels.some((l) => l.includes('還沒上過課')), labels.join(' / '));
    assert.ok(row.reasons.every((x) => typeof x.contribution === 'number'));
  });

  test('「最少」只標在真的最少的那一位身上', () => {
    const rows = build({
      customers: [customers[1], customers[2]],
      availabilityBy: {
        c2: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today,
               rules: [{ kind: 'exclude_weekday', weekday: 1 }] }],
        c3: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today, rules: [] }],
      },
    });
    const labelOf = (id) => rows.find((r) => r.customerId === id).reasons
      .find((x) => x.key === 'available').label;

    assert.match(labelOf('c2'), /最少/);
    assert.doesNotMatch(labelOf('c3'), /最少/);
  });

  test('還沒問過時間的要標出來，而且不假裝他限制很多', () => {
    const row = build().find((r) => r.customerId === 'c1');
    assert.equal(row.needsAvailability, true);
    assert.equal(row.availableDays, null);
    assert.ok(row.reasons.some((x) => x.key === 'ask'));
    assert.ok(!row.reasons.some((x) => x.key === 'available'));
  });

  test('手機只放得下一個標籤，要拿貢獻最大的', () => {
    const rows = build({
      availabilityBy: {
        c1: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today,
               rules: [{ kind: 'exclude_range', from: '2026-09-02', to: '2026-09-30' }] }],
      },
    });
    const row = rows.find((r) => r.customerId === 'c1');
    assert.equal(strongestReason(row).key, 'available');
  });

  test('權重可以調，調了順序就會變', () => {
    const availabilityBy = {
      c1: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today, rules: [] }],
      c2: [{ validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: today,
             rules: [{ kind: 'exclude_range', from: '2026-09-02', to: '2026-09-30' }] }],
    };
    const byTightness = build({ customers: [customers[0], customers[1]], availabilityBy,
      weights: { w1: 1, w2: 0, w3: 0, w4: 0 } });
    const byLiking = build({ customers: [customers[0], customers[1]], availabilityBy,
      weights: { w1: 0, w2: 1, w3: 0, w4: 0 } });

    assert.equal(byTightness[0].customerId, 'c2', '限制最多的優先');
    assert.equal(byLiking[0].customerId, 'c1', '喜好最高的優先');
  });

  test('同分時照姓名排，每次算出來都一樣', () => {
    const a = build().map((r) => r.customerId);
    const b = build().map((r) => r.customerId);
    assert.deepEqual(a, b);
  });
});

// 她八月坐下來壓的是九月的表。哪一份可用性算數，看的是**壓哪個月**，
// 不是今天有沒有一份有效的 —— ADR-0036。
describe('可用性要挑壓的那個月的那一份', () => {
  const today = '2026-08-28';
  const customers = [{ id: 'c1', name: '客戶甲', active: true, priority: 0 }];
  const entitlementsBy = { c1: [ent()] };

  const coll = (over = {}) => ({
    id: 'a1', collectedAt: '2026-08-20', rawText: '九月的時間',
    validFrom: '2026-09-01', validTo: '2026-09-30', rules: [], ...over,
  });

  const build = (over = {}) =>
    buildCustomerQueue({
      customers, entitlementsBy, visitsBy: {}, availabilityBy: {},
      today, weights: DEFAULT_WEIGHTS, ...over,
    });

  test('壓八月時，九月那一份不算數 —— 八月就是還沒問', () => {
    const row = build({ targetMonth: '2026-08', availabilityBy: { c1: [coll()] } })[0];

    assert.equal(row.needsAvailability, true);
    assert.equal(row.availableDays, null, '不是 0 天。0 天的意思是「哪天都不行」');
    assert.ok(row.reasons.some((x) => x.key === 'ask'));
  });

  test('同一位客戶，壓九月時那一份就算數了', () => {
    const row = build({ targetMonth: '2026-09', availabilityBy: { c1: [coll()] } })[0];

    assert.equal(row.needsAvailability, false);
    assert.equal(row.availableDays, 30);
    assert.equal(row.askedFrom, '2026-09-01');
    assert.equal(row.askedTo, '2026-09-30');
  });

  test('八月九月各問過一份時，兩個月各看各的', () => {
    const availabilityBy = {
      c1: [
        coll({ id: 'aug', validFrom: '2026-08-01', validTo: '2026-08-31', collectedAt: '2026-07-20',
               rules: [{ kind: 'exclude_range', from: '2026-08-01', to: '2026-08-25' }] }),
        coll({ id: 'sep' }),
      ],
    };

    assert.equal(build({ targetMonth: '2026-08', availabilityBy })[0].availableDays, 6);
    assert.equal(build({ targetMonth: '2026-09', availabilityBy })[0].availableDays, 30);
  });

  test('拿別的月份硬算的話，她會在第一位看到一個假的「可用 0 天」', () => {
    // 這一條盯的是修掉的那個 bug 本身：九月那一份與八月完全沒有交集，
    // 交集算出來是 0 天，而 0 天在排序裡是「限制最多」，會把人推到第一位。
    const row = build({ targetMonth: '2026-08', availabilityBy: { c1: [coll()] } })[0];
    const tightness = row.reasons.find((x) => x.key === 'available');
    assert.equal(tightness, undefined, '沒問過就不該有「可用 N 天」這個理由');
  });
});

// 預設順序是分數排的，但她心裡常常只有一件事。ADR-0037。
describe('卡片牆換一種排法', () => {
  const rows = [
    { customerId: 'c1', customerName: '客戶甲', needsAvailability: true, priority: 5,
      totalRemaining: 3, daysSinceLast: 10 },
    { customerId: 'c2', customerName: '客戶乙', needsAvailability: false, priority: 1,
      totalRemaining: 20, daysSinceLast: null },
    { customerId: 'c3', customerName: '客戶丙', needsAvailability: false, priority: 3,
      totalRemaining: 8, daysSinceLast: 40 },
  ];
  const ids = (sort) => sortQueueRows(rows, sort).map((r) => r.customerId);

  test('預設就是傳進來的那個順序 —— 批次凍結的那一份', () => {
    assert.deepEqual(ids('default'), ['c1', 'c2', 'c3']);
    assert.deepEqual(ids('沒這種排法'), ['c1', 'c2', 'c3']);
  });

  test('問到時間的先，還沒問的沉到後面', () => {
    assert.deepEqual(ids('asked'), ['c2', 'c3', 'c1']);
  });

  test('喜好、剩最多次、最久沒來各排各的', () => {
    assert.deepEqual(ids('priority'), ['c1', 'c3', 'c2']);
    assert.deepEqual(ids('remaining'), ['c2', 'c3', 'c1']);
    assert.deepEqual(ids('gap'), ['c2', 'c3', 'c1'], '還沒上過課的算最久沒來');
  });

  test('同一個值的那幾位仍然照預設順序 —— 換排法不會把牆洗掉重來', () => {
    const tied = [
      { customerId: 'a', priority: 2 }, { customerId: 'b', priority: 2 },
      { customerId: 'c', priority: 5 },
    ];
    assert.deepEqual(sortQueueRows(tied, 'priority').map((r) => r.customerId), ['c', 'a', 'b']);
  });

  test('不改原本那個陣列', () => {
    const original = [...rows];
    sortQueueRows(rows, 'priority');
    assert.deepEqual(rows, original);
  });

  test('每一種排法都有人話標籤，畫面上才寫得出來', () => {
    assert.ok(QUEUE_SORTS.every((s) => s.id && s.label));
    assert.equal(QUEUE_SORTS[0].id, 'default');
  });
});

// 待辦中心的「壓表登記」。她的第三步，發生在問到時間之後。
describe('這個月還有誰沒壓表', () => {
  const MONTH = '2026-09';

  const COURSES = {
    'course-checkup': { id: 'course-checkup', category: 'B' },   // 健檢 → Examine
    'course-iv-laser': { id: 'course-iv-laser', category: 'C' }, // 靜脈 → Abovee
    'course-inbody': { id: 'course-inbody', category: null },    // Inbody → Abovee
  };

  const person = (id, name) => ({ id, name, active: true });
  const pool = (over = {}) => ({ id: 'e1', type: 'pool', label: '復能', totalQty: 12, doneCount: 0, bookedCount: 0, ...over });
  const single = (over = {}) => ({ id: 'e2', type: 'single', label: '靜脈', courseId: 'course-iv-laser', totalQty: 20, doneCount: 0, bookedCount: 0, ...over });
  const checkup = (over = {}) => ({ id: 'e3', type: 'single', label: '健檢', courseId: 'course-checkup', totalQty: 2, doneCount: 0, bookedCount: 0, ...over });

  const book = (over = {}) => customersToBook({
    customers: [person('c1', '王小明')],
    entitlementsBy: { c1: [pool()] },
    visitsBy: {},
    coursesById: COURSES,
    targetMonth: MONTH,
    ...over,
  });

  test('復能與靜脈都壓在 Abovee，健檢自己一區', () => {
    const rows = book({ entitlementsBy: { c1: [pool(), single(), checkup()] } });
    assert.equal(rows.length, 1);

    const systems = Object.fromEntries(rows[0].systems.map((x) => [x.system, x.pools.map((p) => p.label)]));
    assert.deepEqual(Object.keys(systems).sort(), ['Abovee', 'Examine']);
    assert.deepEqual(systems.Abovee.sort(), ['復能', '靜脈']);
    assert.deepEqual(systems.Examine, ['健檢']);
  });

  test('沒有類別的課程（Inbody、諮詢）也在 Abovee 那一區', () => {
    const rows = book({
      entitlementsBy: { c1: [single({ id: 'e9', label: 'Inbody', courseId: 'course-inbody' })] },
    });
    assert.deepEqual(rows[0].systems.map((x) => x.system), ['Abovee']);
  });

  test('這個月排過健檢，Examine 那一區就沒有他了，Abovee 那一區還在', () => {
    const rows = book({
      entitlementsBy: { c1: [pool(), checkup()] },
      visitsBy: {
        c1: [{ id: 'v1', status: 'confirmed', date: '2026-09-03', slots: [{ courseId: 'course-checkup' }] }],
      },
    });
    assert.deepEqual(rows[0].systems.map((x) => x.system), ['Abovee']);
  });

  test('兩種都排過了就整位不列', () => {
    const rows = book({
      entitlementsBy: { c1: [pool(), checkup()] },
      visitsBy: {
        c1: [{
          id: 'v1', status: 'confirmed', date: '2026-09-03',
          slots: [{ courseId: 'course-checkup' }, { courseId: 'course-iv-laser' }],
        }],
      },
    });
    assert.deepEqual(rows, []);
  });

  test('別的月份排的不算', () => {
    const rows = book({
      visitsBy: {
        c1: [{ id: 'v1', status: 'confirmed', date: '2026-08-30', slots: [{ courseId: 'course-iv-laser' }] }],
      },
    });
    assert.deepEqual(rows[0].systems.map((x) => x.system), ['Abovee']);
  });

  test('取消掉的來訪不算壓過 —— 那個時段已經還回去了', () => {
    const rows = book({
      visitsBy: {
        c1: [{ id: 'v1', status: 'cancelled', date: '2026-09-03', slots: [{ courseId: 'course-iv-laser' }] }],
      },
    });
    assert.deepEqual(rows[0].systems.map((x) => x.system), ['Abovee']);
  });

  // `bookingSystemsForVisit()` 對認不得的課程會猜 Abovee，這一支刻意相反：
  // 兩邊問的問題不一樣，而猜錯的方向在這裡是把一位該壓的客戶整個抹掉。
  test('認不得的課程不算「已經壓過」—— 少一位該壓的人比多一位嚴重', () => {
    const rows = book({
      visitsBy: {
        c1: [{ id: 'v1', status: 'confirmed', date: '2026-09-03', slots: [{ courseId: 'ghost' }] }],
      },
    });
    assert.deepEqual(rows[0].systems.map((x) => x.system), ['Abovee'],
      '她停用一個課程，用過那個課程的客戶不該從清單上消失');
  });

  test('剩餘次數 0 的額度不算，整位次數用完就不列', () => {
    const rows = book({ entitlementsBy: { c1: [pool({ doneCount: 12 })] } });
    assert.deepEqual(rows, []);
  });

  test('停用與軟刪除的客戶不算', () => {
    for (const over of [{ active: false }, { deletedAt: 'x' }]) {
      assert.deepEqual(book({ customers: [{ ...person('c1', '王小明'), ...over }] }), [],
        JSON.stringify(over));
    }
  });

  test('壞掉的月份回空陣列，不炸', () => {
    assert.deepEqual(book({ targetMonth: 'nope' }), []);
  });

  test('照姓名排 —— 這一列不計分也不排序（ADR-0028）', () => {
    const rows = book({
      customers: [person('c2', '陳大文'), person('c1', '王小明')],
      entitlementsBy: { c1: [pool()], c2: [pool({ id: 'e5' })] },
    });
    assert.deepEqual(rows.map((r) => r.customerName), ['陳大文', '王小明'].sort((a, b) => a.localeCompare(b, 'zh-TW')));
  });

  test('醫療禁忌跟著出來 —— 永久限制在任何畫面都不可摺疊（SPEC 4.3）', () => {
    const rows = book({
      customers: [{ ...person('c1', '王小明'), flags: ['體內金屬'] }],
    });
    assert.deepEqual(rows[0].flags, ['體內金屬']);
  });
});

// 待辦中心的「問這輪的時間」。她的第一步，發生在壓表之前。
describe('這一輪還沒問到誰', () => {
  const TODAY = '2026-09-20';

  const person = (id, name) => ({ id, name, active: true });

  // 有效期涵蓋今天 = 已經問到了
  const coll = (over = {}) => ({
    id: 'a1', collectedAt: '2026-09-01', validFrom: '2026-09-01', validTo: '2026-09-30',
    rawText: '一三下午方便', rules: [], ...over,
  });

  const base = {
    customers: [person('c1', '客戶甲')],
    entitlementsBy: { c1: [ent({ totalQty: 12, doneCount: 2, bookedCount: 1 })] },
    availabilityBy: {},
    today: TODAY,
  };

  test('從來沒問過的會列出來，而且看得出是「從來沒問過」', () => {
    const rows = customersToAsk(base);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'never');
    assert.equal(rows[0].lastAskedAt, null);
    assert.equal(rows[0].daysSinceAsked, null);
    assert.equal(rows[0].remaining, 9, '剩餘次數走額度上的計數欄位，不必讀來訪');
  });

  test('問過而且還有效的不列', () => {
    const rows = customersToAsk({ ...base, availabilityBy: { c1: [coll()] } });
    assert.deepEqual(rows, []);
  });

  test('過期的算「該重問了」，不是安靜地繼續用（SPEC 第 4.3 節）', () => {
    const rows = customersToAsk({
      ...base,
      availabilityBy: { c1: [coll({ validTo: '2026-08-31', collectedAt: '2026-08-01' })] },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'expired');
    assert.equal(rows[0].lastAskedAt, '2026-08-01');
    assert.equal(rows[0].daysSinceAsked, 50);
  });

  test('次數用完的不問 —— 和壓表佇列同一道濾網', () => {
    const rows = customersToAsk({
      ...base,
      entitlementsBy: { c1: [ent({ totalQty: 12, doneCount: 12, bookedCount: 0 })] },
    });
    assert.deepEqual(rows, []);
  });

  test('停用與軟刪除的客戶不算', () => {
    for (const over of [{ active: false }, { deletedAt: 'x' }]) {
      const rows = customersToAsk({ ...base, customers: [{ ...person('c1', '客戶甲'), ...over }] });
      assert.deepEqual(rows, [], JSON.stringify(over));
    }
  });

  test('刪掉的收集不算數 —— 刪掉就是沒問過', () => {
    const rows = customersToAsk({
      ...base,
      availabilityBy: { c1: [coll({ deletedAt: 'x' })] },
    });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'never');
  });

  test('從來沒問過的排最前面，其餘最久沒問的先', () => {
    const rows = customersToAsk({
      customers: [person('c1', '客戶甲'), person('c2', '客戶乙'), person('c3', '客戶丙')],
      entitlementsBy: { c1: [ent()], c2: [ent()], c3: [ent()] },
      availabilityBy: {
        c1: [coll({ collectedAt: '2026-08-15', validTo: '2026-08-31' })],
        c2: [coll({ collectedAt: '2026-06-01', validTo: '2026-06-30' })],
        // c3 從來沒問過
      },
      today: TODAY,
    });

    assert.deepEqual(rows.map((r) => r.customerName), ['客戶丙', '客戶乙', '客戶甲']);
  });

  test('同一位問過好幾次，看的是最後那一次', () => {
    const rows = customersToAsk({
      ...base,
      availabilityBy: {
        c1: [
          coll({ id: 'a1', collectedAt: '2026-06-01', validTo: '2026-06-30' }),
          coll({ id: 'a2', collectedAt: '2026-08-01', validTo: '2026-08-31' }),
        ],
      },
    });
    assert.equal(rows[0].lastAskedAt, '2026-08-01');
  });

  test('收集日期壞掉不會被當成「今天剛問過」', () => {
    const rows = customersToAsk({
      ...base,
      availabilityBy: { c1: [coll({ collectedAt: 'x', validTo: '2026-08-31' })] },
    });

    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'expired', '有紀錄，只是不知道哪天問的');
    assert.equal(rows[0].lastAskedAt, null);
    assert.equal(rows[0].daysSinceAsked, null);
  });

  test('有效期還沒開始的那份算已經問到了，不要再問一次', () => {
    const rows = customersToAsk({
      ...base,
      availabilityBy: { c1: [coll({ validFrom: '2026-10-01', validTo: '2026-10-31' })] },
    });
    assert.deepEqual(rows, []);
  });
});

describe('批次', () => {
  const rows = [
    { customerId: 'c1', customerName: '客戶甲' },
    { customerId: 'c2', customerName: '客戶乙' },
    { customerId: 'c3', customerName: '客戶丙' },
  ];
  const batch = newBatch({ targetMonth: '2026-09', rows });

  test('批次沒有 courseId —— 一批是一個月的一串客戶（ADR-0014）', () => {
    assert.equal(batch.courseId, undefined);
    assert.equal(batch.targetMonth, '2026-09');
  });

  test('建立時就把順序凍結起來（ADR-0001 的 Consequences）', () => {
    assert.deepEqual(batch.queue.map((q) => q.customerId), ['c1', 'c2', 'c3']);
    assert.ok(batch.queue.every((q) => q.state === 'pending'));
    assert.equal(batch.cursor, null);
    assert.equal(batch.status, 'active');
  });

  test('進度由每一筆的 state 推導，不從 cursor 推', () => {
    const worked = {
      ...batch,
      cursor: 'c1',
      queue: markInQueue({ queue: markInQueue(batch, 'c1', 'done') }, 'c3', 'skipped', '客人沒回'),
    };
    assert.deepEqual(progressOf(worked), {
      total: 3, done: 1, skipped: 1, handled: 2, pending: 1,
    });
  });

  test('跳過要記得為什麼；改回待處理就把理由清掉', () => {
    const skipped = markInQueue(batch, 'c2', 'skipped', '客人沒回');
    assert.equal(skipped[1].skippedReason, '客人沒回');

    const back = markInQueue({ queue: skipped }, 'c2', 'pending');
    assert.equal(back[1].skippedReason, null);
  });

  test('下一位是還沒處理的，處理完的跳過去', () => {
    const worked = { ...batch, queue: markInQueue(batch, 'c2', 'done') };
    assert.equal(nextPending(worked, 'c1').customerId, 'c3');
  });

  test('後面沒有了就從頭找，全部處理完才回 null', () => {
    const almost = { ...batch, queue: markInQueue({ queue: markAll(batch, 'done') }, 'c1', 'pending') };
    assert.equal(nextPending(almost, 'c3').customerId, 'c1');
    assert.equal(nextPending({ ...batch, queue: markAll(batch, 'done') }), null);
  });
});

function markAll(batch, state) {
  return batch.queue.map((q) => ({ ...q, state }));
}


// ---------- 某一個月的時間問到誰（customersToAskForMonth） ----------
//
// 跟 `customersToAsk()` 是兩支，兩支都要活著：一支問「現在」、一支問「9 月」。
// 這一組測試盯的正是兩者不該一樣的那幾個地方。

describe('某一個月的時間問到誰（customersToAskForMonth）', () => {
  const person = (id, name, over = {}) => ({ id, name, priority: 3, flags: [], ...over });
  const ent = (over = {}) => ({
    id: 'e1', type: 'pool', label: '復能', totalQty: 12, doneCount: 0, bookedCount: 0,
    optionEquipmentIds: ['eq1', 'eq2'], ...over,
  });
  const coll = (over = {}) => ({
    id: 'a-sep', collectedAt: '2026-08-20', validFrom: '2026-09-01', validTo: '2026-09-30',
    rawText: '', rules: [], ...over,
  });

  const base = {
    customers: [person('c1', '客戶甲')],
    entitlementsBy: { c1: [ent()] },
    availabilityBy: {},
    month: '2026-09',
  };

  test('那個月沒有收集 = 還沒問到，而且看得出是「從來沒問過」', () => {
    const rows = customersToAskForMonth(base);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].state, 'never');
    assert.equal(rows[0].collection, null);
  });

  test('那個月有一份 = 已經問到了。**那一位不會消失**，只是狀態變了', () => {
    const rows = customersToAskForMonth({ ...base, availabilityBy: { c1: [coll()] } });
    assert.equal(rows.length, 1, '她的原話：「都不要消失」');
    assert.equal(rows[0].state, 'asked');
    assert.equal(rows[0].collection.id, 'a-sep');
  });

  test('問過八月、沒問過九月 —— 這是第三種狀態，不是「從來沒問過」', () => {
    const rows = customersToAskForMonth({
      ...base,
      availabilityBy: {
        c1: [coll({ id: 'a-aug', validFrom: '2026-08-01', validTo: '2026-08-31', collectedAt: '2026-07-28' })],
      },
    });
    assert.equal(rows[0].state, 'notThisMonth');
    assert.equal(rows[0].collection, null);
    assert.equal(rows[0].lastAskedAt, '2026-07-28', '最後一次問的是哪一天，任何月份都算');
  });

  test('**次數用完的照樣要問得到** —— 這一支跟 customersToAsk() 最大的差別', () => {
    const rows = customersToAskForMonth({
      ...base,
      entitlementsBy: { c1: [ent({ totalQty: 12, doneCount: 12 })] },
    });
    assert.equal(rows.length, 1, '她的原話：「不用看他身上還有沒有次數」');
    assert.equal(rows[0].remaining, 0, '但剩幾次還是要講出來，那是她提醒加購的線索');

    // 同一份資料餵給問「現在」那一支，答案相反 —— 兩支各自都是對的
    assert.deepEqual(
      customersToAsk({ ...base, entitlementsBy: { c1: [ent({ totalQty: 12, doneCount: 12 })] }, today: '2026-08-29' }),
      [],
    );
  });

  test('**用 collectionFor 不是 currentCollection**：回頭看已經過去的月份', () => {
    // 9/5 這一天回頭問「8 月問到了誰」。8 月那一份在今天**已經過期**，
    // 所以 currentCollection() 會說「手上沒有一份算數的」——
    // 但 8 月確實是問過的，那正是這一頁要答的問題。
    const august = {
      ...base,
      availabilityBy: {
        c1: [coll({ id: 'a-aug', validFrom: '2026-08-01', validTo: '2026-08-31', collectedAt: '2026-07-28' })],
      },
      month: '2026-08',
    };
    assert.equal(customersToAskForMonth(august)[0].state, 'asked');

    // 同一份資料餵給問「現在（9/5）」的那一支，答案相反 —— 兩支各自都是對的。
    // 挑錯的後果是「8 月」那一格整片寫著「還沒問」。
    assert.equal(customersToAsk({ ...august, today: '2026-09-05' }).length, 1);
  });

  test('停用與軟刪除的客戶不算', () => {
    for (const over of [{ active: false }, { deletedAt: 'x' }]) {
      assert.deepEqual(
        customersToAskForMonth({ ...base, customers: [{ ...person('c1', '客戶甲'), ...over }] }),
        [], JSON.stringify(over),
      );
    }
  });

  test('刪掉的收集不算數 —— 刪掉就是那個月沒問過', () => {
    const rows = customersToAskForMonth({
      ...base,
      availabilityBy: { c1: [coll({ deletedAt: 'x' })] },
    });
    assert.equal(rows[0].state, 'never');
  });

  test('月份不合法回空陣列，不要退回「這個月」', () => {
    assert.deepEqual(customersToAskForMonth({ ...base, month: '2026-13' }), []);
    assert.deepEqual(customersToAskForMonth({ ...base, month: undefined }), []);
  });

  test('順序：從來沒問過 → 問過別的月份 → 這個月已經有了', () => {
    const rows = customersToAskForMonth({
      ...base,
      customers: [person('c1', '甲'), person('c2', '乙'), person('c3', '丙')],
      entitlementsBy: { c1: [ent()], c2: [ent()], c3: [ent()] },
      availabilityBy: {
        c2: [coll({ id: 'a-aug', validFrom: '2026-08-01', validTo: '2026-08-31' })],
        c3: [coll()],
      },
    });
    assert.deepEqual(rows.map((r) => r.state), ['never', 'notThisMonth', 'asked']);
  });
});
