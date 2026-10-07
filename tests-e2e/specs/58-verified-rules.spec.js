// 2026-10-07 逐條驗證過的那份問題清單，第一支 PR：會動到提醒與數字的那幾條
// （`.scratch/verified-bugs-2026-10-07/issues/01`–`07`）。
//
// 每一條都是「資料是對的、畫面講的不是同一件事」或「按下去存到的跟畫面上看到的不一樣」——
// 單元測試釘得住規則，釘不住「那一句真的出現在她眼前的那一道確認框上」，所以這裡從瀏覽器再問一次。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY,
} from '../fixtures/data.js';

const DAY = TODAY;

// ---------- 05 進度追蹤與客戶詳情「這個月」：取消的段不畫、不算（ADR-0134） ----------

/** 一位客戶、今天兩段：早上那一段取消了，下午那一段還在。 */
function seedOneCancelled() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
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
  ];
}

test('P1 進度追蹤：取消的那一段不畫，「N 段」跟底下的列數一樣', async ({ app, page }) => {
  await app.seed(seedOneCancelled());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  await expect(page.locator('button.progslot[data-visit="v-a"]'), '只剩沒取消的那一段').toHaveCount(1);
  await expect(page.locator('.card', { hasText: '客戶A' }).first()).toContainText('1 天・1 段');

  // 點下去開的是下午那一段（它在來訪裡是第 2 段）—— 不是畫出來的第 1 列就當成第 1 段
  await page.locator('button.progslot[data-visit="v-a"]').click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard'), '開的是沒取消的那一段').toContainText('14:00');
});

test('P2 客戶詳情「這個月」：同一份數字', async ({ app, page }) => {
  await app.seed(seedOneCancelled());
  await app.signIn('/calendar');
  await app.go('/customers/cust-a');

  await expect(page.locator('button.progslot[data-visit="v-a"]')).toHaveCount(1);
  await expect(page.locator('.section__n', { hasText: '段' })).toContainText('1 天・1 段');
});

// ---------- 06 簽療程單存完那一句只數真的扣次數的段 ----------

test('P3 簽療程單：一段扣額度、一段不算次數都做了 → 「扣掉 1 次」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'v-close', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
          }),
          status: 'confirmed',
        },
        // 功醫門診不算次數（ADR-0121）：沒有額度
        { ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '10:00', endsAt: '10:30' }), status: 'confirmed' },
      ],
    }),
  ]);
  await app.signIn('/todo/close');

  await page.locator('[data-open="v-close"]').click();
  await app.tickAll();
  await expect(page.locator('.drawer'), '抽屜上那一句').toContainText('做了的 2 段裡 1 段扣掉次數');
  await page.locator('[data-apply]').click();
  await app.saved();
  await expect(page.locator('#toast'), '存完那一句跟抽屜同一個數').toContainText('扣掉 1 次');

  const ent = await app.readDoc('customers/cust-a/entitlements', 'ent-pool');
  expect(ent.doneCount).toBe(1);
});
