// 2026-10-09 上線前修正，第四段（`.scratch/prelaunch-fixes-2026-10-08/issues/19`–`21`）：人員的全名與簡寫、
// 合併檔 v6 帶人員名單（ADR-0141）。
//
// 單元測試釘得住「印哪一個」「認得誰」；這裡從瀏覽器問接線：設定頁那一格存不存得下去（`parse()` 是白名單）、
// 窄的地方印簡寫、選單印全名。**人員一律寫「某」**（全名不進 repo）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = addDays(TODAY, 3);

function seedOneVisit() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    visit({
      id: 'v1', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-a',
        startsAt: '10:00', endsAt: '11:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      })],
    }),
  ];
}

test('N1 設定頁填全名與簡寫 → 日曆那一列與讀取卡片印簡寫、來訪編輯器的丸子印全名', async ({ app, page }) => {
  await app.seed(seedOneVisit());
  await app.signIn('/settings/staff');

  await page.locator('[data-edit="staff-tw"]').click();
  await page.fill('input[name="name"]', '某騰崴');
  await page.fill('input[name="shortName"]', '騰崴');
  await page.click('button[type="submit"]');
  await app.saved();

  const tw = await app.readDoc('config/app/staff', 'staff-tw');
  expect(tw.name).toBe('某騰崴');
  expect(tw.shortName, '`parse()` 是白名單：少了那一格就存不進去').toBe('騰崴');
  await expect(page.locator('.card.row').filter({ hasText: '某騰崴' }).first()).toContainText('簡寫 騰崴');

  // 日曆那一天的那一列：簡寫
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  const row = page.locator('[data-open^="visit:v1:"]').first();
  await expect(row).toContainText('騰崴');
  await expect(row).not.toContainText('某騰崴');

  // 讀取卡片：簡寫
  await row.click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot')).toContainText('騰崴');
  await expect(page.locator('.popcard .readslot')).not.toContainText('某騰崴');

  // 來訪編輯器的治療師丸子：全名
  await page.locator('.popcard [data-card-edit]').click();
  await app.layer('[data-form]');
  await expect(page.locator('[data-chip="s0-staff"]', { hasText: '某騰崴' })).toHaveCount(1);
});
