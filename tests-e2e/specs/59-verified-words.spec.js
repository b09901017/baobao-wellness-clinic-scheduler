// 2026-10-07 逐條驗證過的那份問題清單，第二支 PR：資料是對的、畫面講錯話的那幾條，
// 加上內部用語與版面（`.scratch/verified-bugs-2026-10-07/issues/08`–`17`）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY,
} from '../fixtures/data.js';

const DAY = TODAY;

// ---------- 08 讀取卡片：取消／未到的段不寫「扣 X」 ----------

test('W1 讀取卡片：取消的那一段寫「沒扣」，還排著的那一段照舊寫「扣」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'v-a', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
          }),
          status: 'cancelled',
        },
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-sis', therapistId: 'staff-tw',
          }),
          status: 'confirmed',
        },
      ],
    }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open="visit:v-a:0"]');

  await page.locator('[data-open="visit:v-a:0"]').first().click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot__from'), '取消的那一段沒有扣').toHaveText('沒扣 復能-三選一(30)');

  // 重新進來一次再點另一段（Escape 會連底下那一天的面板一起收掉）
  await app.reload();
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open="visit:v-a:1"]');
  await page.locator('[data-open="visit:v-a:1"]').first().click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot__from')).toHaveText('扣 復能-三選一(30)');
});
