// §3.1 匯入的營養點滴額度沒有記是哪一款。
//
// 合併檔帶著 `productName`，`planForCustomer()` 把它放在計畫物件上，
// **但 `doc` 裡沒有 `ivProductId`** —— 而寫入端（`data/legacyImport.js`）
// 只寫 `e.doc`，所以那一格整個掉了。
//
// 差別看不出來（label 照樣寫得出品項），壞的是這兩件事：
//   - `ivChoicesFor()`「買的那一款排第一顆、預設選好」不會發生
//   - `assignmentWarnings()` 的「品項跟買的不一樣」與資料健檢的 `ivMismatch` 都看不到

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planForCustomer } from '../../public/js/domain/mergeImport.js';
import { SEED } from '../../public/js/domain/seed.js';
import { ivChoicesFor } from '../../public/js/domain/masterData.js';

const TODAY = '2026-09-16';
const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: TODAY,
};
const PRODUCT = SEED.ivProducts[0];

const ENTRY = () => ({
  sheetName: '客戶A',
  name: '客戶A',
  entitlements: [{
    key: 'iv', type: 'single', label: `營養點滴 - ${PRODUCT.name}`, totalQty: 10,
    courseName: '營養點滴', optionEquipmentNames: [], productName: PRODUCT.name,
  }],
  visits: [],
});

describe('§3.1 匯入的營養點滴額度記不記得是哪一款', () => {
  const plan = planForCustomer(ENTRY(), CTX, { format: 'baobao-merge/v3' });
  const ent = plan.entitlements[0];

  test('這一筆額度真的匯得進去', () => {
    assert.ok(ent, `problems: ${JSON.stringify(plan.problems)}`);
    assert.equal(ent.productName, PRODUCT.name, '計畫物件上留著品項的名字');
  });

  // ↓ 紅。`doc` 裡沒有這一格，而寫入端只寫 `doc`。
  test('寫進去的那一份要帶著 ivProductId', () => {
    assert.equal(ent.doc.ivProductId, PRODUCT.id);
  });

  // ↓ 紅。所以排班時「買的那一款排第一顆、預設選好」不會發生。
  test('排班時買的那一款要排第一顆、預設選好', () => {
    const choices = ivChoicesFor(ent.doc, SEED.ivProducts);
    assert.equal(choices.boughtId, PRODUCT.id);
    assert.deepEqual(choices.primary.map((p) => p.id), [PRODUCT.id],
      '沒有 boughtId 時會退回「全部列出來」');
  });
});
