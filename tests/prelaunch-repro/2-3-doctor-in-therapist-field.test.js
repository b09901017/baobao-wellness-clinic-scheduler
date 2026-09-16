// §2.3 匯入的二返，醫師被寫進治療師那一格。
//
// `domain/mergeImport.js` 的 `resolveAssignments()` 拿 `therapistName` 照名字
// 對 staff，**不看角色**，也沒有 `doctorId` 那一格。skill 那側把行事曆上的
// 「*許」放在 `therapistName`。
//
// fixture 用的是 seed 主檔裡的醫師名字（`夏`／`許`／`李`），不是真名。

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { planForCustomer } from '../../public/js/domain/mergeImport.js';
import { SEED } from '../../public/js/domain/seed.js';
import { assignsFor } from '../../public/js/domain/visits.js';
import { picksDoctor } from '../../public/js/domain/masterData.js';

const TODAY = '2026-09-16';
const CTX = {
  courses: SEED.courses, equipment: SEED.equipment, ivProducts: SEED.ivProducts,
  rooms: SEED.rooms, staff: SEED.staff, existingCustomers: [], today: TODAY,
};
const staffById = Object.fromEntries(SEED.staff.map((s) => [s.id, s]));
const DOCTOR = SEED.staff.find((s) => s.role === '醫師').name;

const ENTRY = () => ({
  sheetName: '客戶A',
  name: '客戶A',
  entitlements: [{
    key: 'ck', type: 'single', label: '健檢', totalQty: 1,
    courseName: '健檢', optionEquipmentNames: [], productName: null,
  }],
  visits: [{
    date: '2026-07-17',
    status: 'done',
    slots: [{
      entitlementKey: 'ck-followup', courseName: '二返',
      startsAt: '14:00', endsAt: '14:30',
      roomName: null, therapistName: DOCTOR, equipmentName: null, ivProductName: null,
      confidence: 'high', evidence: '（編的）',
    }],
  }],
});

describe('§2.3 匯入的二返身上那位醫師', () => {
  const plan = planForCustomer(ENTRY(), CTX, { format: 'baobao-merge/v3' });
  const slot = plan.visits[0]?.slots?.[0];

  test('這一段真的匯得進去', () => {
    assert.ok(slot, `problems: ${JSON.stringify(plan.problems)}`);
    assert.equal(slot.courseName, '二返');
  });

  test('二返是「選得到醫師、不指派治療師」的課程（前提）', () => {
    const course = SEED.courses.find((c) => c.name === '二返');
    assert.equal(picksDoctor(course), true);
    assert.equal(assignsFor(null, course, null), 'none', '二返不指派治療師也不指派診間');
  });

  // ↓ 紅。醫師被放進 therapistId。
  test('治療師那一格不可以指到一位醫師', () => {
    const who = slot.therapistId ? staffById[slot.therapistId] : null;
    assert.notEqual(who?.role, '醫師', `therapistId 指到「${who?.role}」`);
  });

  // ↓ 紅。連 doctorId 這一格都沒有 —— 試算表讀的是它。
  test('醫師要寫在 doctorId 上（試算表那一格讀它）', () => {
    assert.ok(slot.doctorId, '`sheetReport.js` 讀 `hit?.doctorId`，沒有就印成「7/17 二返」');
    assert.equal(staffById[slot.doctorId]?.role, '醫師');
  });
});
