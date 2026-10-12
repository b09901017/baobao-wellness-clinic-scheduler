// 「剩幾次」那幾行：有在用的排前面（prelaunch-fixes-2026-10-08/issues/08，ADR-0137）。
//
// 她 2026-10-08：
//
// > ・「剩幾次」那幾行，要不要改成「有在用的排前面」？ → 改：有做過或排過的排前面，同一組裡再照剩得少的排
//
// 以前只照「剩得少的排前面」，而「剩得少」分不出「快用完」與「買得少、一次都還沒用」：
// 方案裡一次都沒用過的單項（4 次的諮詢、分析）也只剩 4，永遠排在正在做的復能（剩 11）前面。
// 客戶清單一張卡只列 4 行 —— 正在用的那一筆被擠進「點進去看」。
//
// 兩支排序（卡片牆／客戶清單的 `customerPools()`、客戶詳情的 `sortPools()`）中間各插一層，
// **而且是同一個比較**（`entitlements.js` 的 `poolOrder()`）。fixture 是假客戶王小明。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { sortPools, poolOrder, inUse } from '../public/js/domain/entitlements.js';
import { customerPools, buildCustomerQueue } from '../public/js/domain/scheduling.js';

/** 一筆額度（快取的計數欄位）。 */
const ent = (id, label, total, done = 0, booked = 0, over = {}) =>
  ({ id, label, type: 'single', courseId: `course-${id}`, totalQty: total, doneCount: done, bookedCount: booked, ...over });

const labels = (entitlements, visits) => customerPools({ entitlements, visits }).pools.map((p) => p.label);

describe('卡片牆與客戶清單：customerPools()', () => {
  test('一次都沒做也沒排的 4 次諮詢，不會排在正在做的復能（剩 11）前面', () => {
    const rows = [ent('n', '營養師諮詢', 4), ent('r', '復能-三選一(60)', 20, 5, 4)];
    assert.deepEqual(labels(rows), ['復能-三選一(60)', '營養師諮詢']);
  });

  test('有在用的那一組裡，剩得少的排前面（「先看到快用完的」這個理由不變）', () => {
    const rows = [ent('i', 'ILIB(60)', 20, 2, 0), ent('r', '復能-三選一(60)', 20, 15, 3)];
    assert.deepEqual(labels(rows), ['復能-三選一(60)', 'ILIB(60)']);
  });

  test('沒在用的那一組裡也一樣：剩得少的前面，再照名字', () => {
    const rows = [ent('b', '體適能檢查分析', 4), ent('a', '身體組成分析', 4), ent('c', '物理治療師諮詢', 2)];
    assert.deepEqual(labels(rows), ['物理治療師諮詢', '身體組成分析', '體適能檢查分析']);
  });

  test('只排了、還沒做的也算在用（她的原話：有做過或排過）', () => {
    const rows = [ent('n', '營養師諮詢', 4), ent('i', 'ILIB(60)', 20, 0, 1)];
    assert.deepEqual(labels(rows), ['ILIB(60)', '營養師諮詢']);
  });

  test('二返還是最後，就算它是唯一有在用的', () => {
    const rows = [
      ent('fu', '二返（8萬健檢）', 2, 1, 0, { followupForEntitlementId: 'chk' }),
      ent('n', '營養師諮詢', 4),
      ent('chk', '8萬健檢', 2, 2, 0),
    ];
    assert.equal(labels(rows).at(-1), '二返（8萬健檢）');
  });

  test('現算的那一條路（cached: false）：取消掉、未到的那幾段不算在用', () => {
    const rows = [ent('n', '營養師諮詢', 4), ent('r', '復能-三選一(60)', 20)];
    const slot = (entitlementId, status) => ({ entitlementId, status, attended: status === 'done' });
    const visits = [
      // 諮詢約過兩次：一次取消、一次沒到 —— 兩段都不佔次數
      { status: 'cancelled', date: '2026-09-01', slots: [slot('n', 'cancelled')] },
      { status: 'no_show', date: '2026-09-02', slots: [slot('n', 'no_show')] },
      // 復能排著一次
      { status: 'confirmed', date: '2026-10-20', slots: [slot('r', 'confirmed')] },
    ];
    const live = customerPools({ entitlements: rows, visits, cached: false }).pools;
    assert.deepEqual(live.map((p) => p.label), ['復能-三選一(60)', '營養師諮詢']);
    assert.equal(inUse(live.find((p) => p.label === '營養師諮詢')), false);
  });
});

describe('客戶詳情那一排：sortPools()', () => {
  const doneVisits = (entId, n) =>
    Array.from({ length: n }, () => ({ status: 'done', slots: [{ entitlementId: entId }] }));
  const order = (rows, visits) => sortPools(rows, visits).map((x) => x.label);

  test('一次都沒用的 4 次諮詢，不會排在正在做的復能（剩 11）前面', () => {
    const rows = [ent('n', '營養師諮詢', 4), ent('r', '復能-三選一(60)', 20)];
    assert.deepEqual(order(rows, doneVisits('r', 9)), ['復能-三選一(60)', '營養師諮詢']);
  });

  test('第一層不變：還有剩的排前面 —— 用完的那一筆就算在用也沉到後面', () => {
    const rows = [ent('i', 'ILIB(60)', 2), ent('n', '營養師諮詢', 4)];
    assert.deepEqual(order(rows, doneVisits('i', 2)), ['營養師諮詢', 'ILIB(60)']);
  });

  test('有在用的那一組裡剩得少的前面', () => {
    const rows = [ent('i', 'ILIB(60)', 20), ent('r', '復能-三選一(60)', 20)];
    assert.deepEqual(order(rows, [...doneVisits('i', 2), ...doneVisits('r', 18)]), ['復能-三選一(60)', 'ILIB(60)']);
  });

  test('健檢與它的二返還是相鄰（最後套上去的那一層，ADR-0022）', () => {
    const rows = [
      ent('chk', '8萬健檢', 2),
      ent('r', '復能-三選一(60)', 20),
      ent('fu', '二返（8萬健檢）', 2, 0, 0, { followupForEntitlementId: 'chk' }),
    ];
    // 復能在用（排第一），健檢與二返都還沒動 —— 二返照樣緊跟在健檢後面
    assert.deepEqual(order(rows, doneVisits('r', 3)), ['復能-三選一(60)', '8萬健檢', '二返（8萬健檢）']);
  });
});

describe('兩支排序講同一句話', () => {
  test('同一個比較：`poolOrder()` 一支，兩邊都用', () => {
    const using = { done: 5, booked: 4, remaining: 11, label: '復能' };
    const idle = { done: 0, booked: 0, remaining: 4, label: '諮詢' };
    assert.ok(poolOrder(using, idle) < 0, '有在用的在前');
    assert.ok(poolOrder(idle, using) > 0);
    assert.ok(poolOrder({ ...using, remaining: 2 }, using) < 0, '同一組裡剩得少的在前');
    assert.equal(inUse({ done: 0, booked: 1 }), true, '只排了也算');
    assert.equal(inUse({ done: 0, booked: 0 }), false);
  });

  test('同一位客人（都還有剩、沒有二返）：卡片牆與客戶詳情的先後一模一樣', () => {
    const rows = [
      ent('n', '營養師諮詢', 4), ent('b', '身體組成分析', 4),
      ent('r', '復能-三選一(60)', 20), ent('i', 'ILIB(60)', 20),
    ];
    const visits = [
      ...Array.from({ length: 9 }, () => ({ status: 'done', slots: [{ entitlementId: 'r' }] })),
      { status: 'confirmed', date: '2026-10-20', slots: [{ entitlementId: 'i', status: 'confirmed' }] },
    ];
    const wall = customerPools({ entitlements: rows, visits, cached: false }).pools.map((p) => p.entitlementId);
    const detail = sortPools(rows, visits).map((e) => e.id);
    assert.deepEqual(wall, detail);
    assert.deepEqual(wall, ['r', 'i', 'b', 'n']);
  });
});

describe('客戶之間「先壓誰」不跟著變', () => {
  // 這一支只改「一位客戶裡面幾筆額度的先後」。`buildCustomerQueue()` 挑一筆「代表性的額度」去算急迫度，
  // 以前是照顯示順序挑第一筆 —— 順序一變，那一筆就換了，排名可能跟著動。
  const queue = (entitlementsBy) => buildCustomerQueue({
    customers: [{ id: 'c1', name: '王小明', active: true }, { id: 'c2', name: '王小華', active: true }],
    entitlementsBy, visitsBy: {}, availabilityBy: {}, targetMonth: '2026-11', today: '2026-10-08',
  });

  test('代表的那一筆額度不看「有沒有在用」：兩位只差在用過沒，挑到的是同一種', () => {
    const idle = [ent('n', '營養師諮詢', 4), ent('r', '復能', 20, 0, 0)];
    const using = [ent('n', '營養師諮詢', 4), ent('r', '復能', 20, 5, 4)];
    const rows = queue({ c1: idle, c2: using });
    const lead = Object.fromEntries(rows.map((r) => [r.customerId, r.entitlementLabel]));
    // 舊的挑法：二返最後 → 剩得少的 → 名字。兩位都是剩 4 的諮詢
    assert.equal(lead.c1, '營養師諮詢');
    assert.equal(lead.c2, '營養師諮詢', '顯示順序把復能提到前面了，代表的那一筆不可以跟著換');
  });

  test('到期日不一樣時：用過的那一筆被提到前面，急迫度照舊看最快到期的那一筆', () => {
    const soon = { expiresAt: '2026-11-15' };
    const late = { expiresAt: '2027-06-30' };
    const rows = queue({
      c1: [ent('n', '營養師諮詢', 4, 0, 0, soon), ent('r', '復能', 20, 5, 4, late)],
      c2: [ent('n', '營養師諮詢', 4, 0, 0, late), ent('r', '復能', 20, 5, 4, late)],
    });
    const byId = Object.fromEntries(rows.map((r) => [r.customerId, r]));
    assert.equal(byId.c1.entitlementLabel, '營養師諮詢', '最快到期的那一筆');
    assert.ok(byId.c1.score > byId.c2.score, '快到期的那一位照舊排前面');
    assert.deepEqual(byId.c1.pools.map((p) => p.label), ['復能', '營養師諮詢'], '泡泡的順序是新的');
  });
});
