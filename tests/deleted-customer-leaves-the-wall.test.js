// 刪掉的客戶不留在壓表牆上（prelaunch-fixes-2026-10-08/issues/07；9/18 就找到過）。
//
// 已經開始的那一批把名單凍結起來（存的是 id）。開批之後才刪掉的那一位（例如誤建的重複客戶）
// 在名單裡退回成「只有名字的一列」：牆上那張卡不會消失，點進去「做什麼」那一排照樣有
// 功醫門診、HRV（不算次數的課每位客人都有，ADR-0121），存檔時也不問這位客戶還在不在 ——
// 結果是替一位不存在的客戶建了來訪：日曆上看得到，點名字是「找不到這位客戶」。
//
// 規則在 `domain/scheduling.js` 的 `batchRows()`／`presentQueue()`：
// **濾的是畫出來的那一份；存回資料庫的名單一個字都不少** —— 她把那一位還原之後，他要回到原本的位置。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCustomerQueue, batchRows, presentQueue, progressOf, nextPending, markInQueue,
} from '../public/js/domain/scheduling.js';

const MONTH = '2026-11';
const TODAY = '2026-10-08';

const cust = (id, name, over = {}) => ({ id, name, active: true, ...over });
const ent = (id) => ({ id, type: 'single', courseId: 'course-recovery', label: id, totalQty: 10, doneCount: 0, bookedCount: 0 });

const A = cust('cA', '客戶A');
const B = cust('cB', '客戶B');
const C = cust('cC', '客戶C');
const entitlementsBy = { cA: [ent('eA')], cB: [ent('eB')], cC: [ent('eC')] };

/** 現在的客戶清單算出來的列（`schedule.js` 的 `rowsOf()` 傳進去的那一份）。 */
const allFor = (customers) => buildCustomerQueue({
  customers, entitlementsBy, visitsBy: {}, availabilityBy: {}, targetMonth: MONTH, today: TODAY, includeUsedUp: true,
});

/** 開批那一刻 A、B、C 都在，順序凍結成 A → B → C。 */
const BATCH = {
  targetMonth: MONTH,
  queue: [A, B, C].map((c) => ({ customerId: c.id, customerName: c.name, state: 'pending', skippedReason: null })),
};

const ids = (rows) => rows.map((r) => r.customerId);

describe('刪掉的客戶不畫在牆上', () => {
  test('開批之後刪掉客戶B：牆上沒有那一列，其餘順序照舊', () => {
    const customers = [A, C];
    const { rows } = batchRows(BATCH, { all: allFor(customers), customers });
    assert.deepEqual(ids(rows), ['cA', 'cC']);
  });

  test('分母跟著少一：已壓 N / M 的 M 是牆上的人數', () => {
    const customers = [A, C];
    const { present, rows } = batchRows(BATCH, { all: allFor(customers), customers });
    assert.equal(progressOf({ queue: present }).total, 2);
    assert.equal(progressOf({ queue: present }).total, rows.length);
  });

  test('已經標成刪除的那一份（deletedAt）也算找不到', () => {
    const customers = [A, { ...B, deletedAt: '2026-10-08T10:00:00Z' }, C];
    const { rows } = batchRows(BATCH, { all: allFor(customers), customers });
    assert.deepEqual(ids(rows), ['cA', 'cC']);
  });
});

describe('存回資料庫的名單不改', () => {
  test('要寫回去的 queue 還留著客戶B，位置沒動', () => {
    const customers = [A, C];
    const { queue } = batchRows(BATCH, { all: allFor(customers), customers });
    assert.deepEqual(ids(queue), ['cA', 'cB', 'cC']);
  });

  test('客戶B 刪掉的期間有新客人加進來：寫回去的名單上客戶B 還在原位，新的接在最後', () => {
    const D = cust('cD', '客戶D');
    const customers = [A, C, D];
    const all = buildCustomerQueue({
      customers, entitlementsBy: { ...entitlementsBy, cD: [ent('eD')] }, visitsBy: {}, availabilityBy: {},
      targetMonth: MONTH, today: TODAY, includeUsedUp: true,
    });
    const { queue, added, rows } = batchRows(BATCH, { all, customers });
    assert.deepEqual(added, ['cD'], '有人被加進來，所以這一份會被寫回去');
    assert.deepEqual(ids(queue), ['cA', 'cB', 'cC', 'cD'], '寫回去的那一份不可以少了客戶B');
    assert.deepEqual(ids(rows), ['cA', 'cC', 'cD']);
  });

  test('還原客戶B 之後他回到原本的位置', () => {
    // 刪掉的那段期間存回去過一次（上一條），再讀出來、他已經還原
    const stored = { ...BATCH, queue: batchRows(BATCH, { all: allFor([A, C]), customers: [A, C] }).queue };
    const customers = [A, B, C];
    const { rows } = batchRows(stored, { all: allFor(customers), customers });
    assert.deepEqual(ids(rows), ['cA', 'cB', 'cC']);
    assert.ok(rows[1].pools.length > 0, '還原之後是完整的一列，不是只有名字');
  });
});

describe('停用不算找不到', () => {
  test('開批之後停用客戶B：那一列照舊在（停用是她選的）', () => {
    const customers = [A, { ...B, active: false }, C];
    const { rows, present } = batchRows(BATCH, { all: allFor(customers), customers });
    assert.deepEqual(ids(rows), ['cA', 'cB', 'cC']);
    assert.equal(rows[1].customerName, '客戶B');
    assert.equal(present.length, 3);
  });
});

describe('「下一位」不會跳到刪掉的那一位', () => {
  test('客戶A 壓完：下一位是客戶C，不是已經刪掉的客戶B', () => {
    const customers = [A, C];
    const queue = markInQueue(BATCH, 'cA', 'done');
    assert.equal(nextPending({ queue }, 'cA').customerId, 'cB', '沒濾過的名單會挑到客戶B（這就是那個 bug）');
    assert.equal(nextPending({ queue: presentQueue(queue, customers) }, 'cA').customerId, 'cC');
  });

  test('只剩刪掉的那一位還沒壓：沒有下一位', () => {
    const customers = [A];
    const queue = markInQueue({ queue: BATCH.queue.slice(0, 2) }, 'cA', 'done');
    assert.equal(nextPending({ queue: presentQueue(queue, customers) }, 'cA'), null);
  });
});
