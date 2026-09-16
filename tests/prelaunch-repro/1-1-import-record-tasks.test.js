// §1.1 匯入會替「已經發生的來訪」長出「寫紀錄」，而畫面上那句話講的是相反的。
//
// 三個地方都寫著「已經發生的那些一筆都不長」：
//   SPEC.md 第 6.10 節、`data/legacyImport.js` 的檔頭、`ui/views/mergeImport.js` 的兩段文案。
// 那一條是 ADR-0066（2026-09-04 加「寫紀錄」）之前寫的。
//
// fixture 全部是編出來的匿名資料。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planForCustomer, countNewTasks } from '../../public/js/domain/mergeImport.js';
import { SEED } from '../../public/js/domain/seed.js';
import { syncTasksForVisit, RECORD_TASK_KIND } from '../../public/js/domain/taskRules.js';

const TODAY = '2026-09-16';

const CTX = {
  courses: SEED.courses,
  equipment: SEED.equipment,
  ivProducts: SEED.ivProducts,
  rooms: SEED.rooms,
  staff: SEED.staff,
  existingCustomers: [],
  today: TODAY,
};

/** 一位客戶，六月做過一次二返（`needsRecord: true`），沒有任何未來的來訪。 */
const PAST_ONLY = () => ({
  sheetName: '客戶A',
  name: '客戶A',
  source: null,
  notes: null,
  entitlements: [
    {
      key: 'ck', type: 'single', label: '健檢', totalQty: 1,
      courseName: '健檢', optionEquipmentNames: [], productName: null,
    },
  ],
  // 健檢一展開就配一筆二返（`followupPlanEntries()`），所以這一段對得到額度。
  visits: [{
    date: '2026-06-18',
    status: 'done',
    slots: [{
      entitlementKey: 'ck-followup', courseName: '二返', startsAt: '14:00', endsAt: '14:30',
      roomName: null, therapistName: null, equipmentName: null, ivProductName: null,
      confidence: 'high', evidence: '（編的）',
    }],
  }],
});

describe('§1.1 匯入：已經發生的來訪會不會長出待辦', () => {
  const plan = planForCustomer(PAST_ONLY(), CTX, { format: 'baobao-merge/v3' });

  test('這份 fixture 真的匯得進去（不是因為解析失敗才數到 0）', () => {
    assert.equal(plan.skip, null);
    assert.equal(plan.visits.length, 1, `problems: ${JSON.stringify(plan.problems)}`);
    assert.equal(plan.visits[0].status, 'done', '六月那一筆是「已經發生的」');
    assert.equal(plan.counts.future, 0, '這一份沒有任何未來的來訪');
  });

  // ↓ 紅。實際會長出一張「寫紀錄・6/18」，死線是 6/18 —— 匯進去的那一刻就逾期。
  test('SPEC 6.10：已經發生的那些一筆待辦都不長', () => {
    assert.equal(
      countNewTasks([plan], { courses: SEED.courses, today: TODAY }),
      0,
      '確認框會拿這個數字去寫「還沒發生的那幾筆會產生 N 筆登記待辦；已經發生的一筆都不會長」',
    );
  });

  // ↓ 紅。把上一條在講的東西指出來：長出來的是什麼、掛在哪一天。
  test('長出來的那幾張不可以是掛在過去的「寫紀錄」', () => {
    const coursesById = Object.fromEntries(SEED.courses.map((c) => [c.id, c]));
    const created = plan.visits.flatMap(
      (v) => syncTasksForVisit(v, [], { coursesById, today: TODAY }).create,
    );
    const overdueRecords = created.filter(
      (t) => t.kind === RECORD_TASK_KIND && t.dueDate < TODAY,
    );
    assert.deepEqual(
      overdueRecords.map((t) => `${t.kind}・${t.dueDate}`),
      [],
      '一出生就逾期的紅字',
    );
  });
});
