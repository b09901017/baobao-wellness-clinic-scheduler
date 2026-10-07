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

// ---------- 10 取消那幾道確認框 ----------

/** 日曆 → 那一天 → 長按那一段，等選單升起來（`wireLongPress()` 只認主鍵的真滑鼠事件，同 spec 52）。 */
async function longPress(app, page, date, open) {
  await page.locator(`[data-day="${date}"]`).first().click();
  await app.layer(`[data-open="${open}"]`);
  const row = page.locator(`[data-open="${open}"]`).first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

test('W2 那一天已完成之後再加的那一段，長按取消：不說「那一天就整個取消了」；不要的那一顆寫「先不要，回去」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    visit({
      id: 'v-done', customerId: 'cust-b', customerName: '客戶B', date: DAY, status: 'done',
      slots: [{ ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '09:00', endsAt: '09:30' }), status: 'done' }],
    }),
    // 那一天已完成，所以這一段在另一筆來訪裡（ADR-0083）
    visit({
      id: 'v-second', customerId: 'cust-b', customerName: '客戶B', date: DAY, status: 'pending_confirm',
      slots: [{ ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '14:30', endsAt: '15:00' }), status: 'pending_confirm' }],
    }),
  ]);
  await app.signIn('/calendar');
  await longPress(app, page, DAY, 'visit:v-second:0');
  await page.locator('.actionrow', { hasText: '取消這一段' }).click();

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '已完成的那一段還在').not.toContain('整個取消了');
  expect(said).toContain('那一天剩下的 1 段不受影響');
  await expect(app.dialog().locator('[data-cancel]'), '兩顆不可以都叫「取消」').toHaveText('先不要，回去');
  await expect(app.dialog().locator('[data-ok]')).toHaveText('取消這一段');
});
