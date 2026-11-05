// 2026-11-05 第一輪小修 03（11/4 全庫健檢 #3）：「重算次數」算完之後那一筆額度被別處改過，按修正就不寫。
//
// 以前寫的是算的那一刻的數字、沒有 `ifUpdatedAt`：掃描完不按、別台替那位客戶排了一段（額度已經被那一台寫對）、
// 回來按修正 → 舊的數字蓋回去。客戶詳情那一顆同一個形狀：確認框開著的時候別台存了一段，按「修正」一樣蓋回去。
//
// 「別台」用 fixture 直接改那一筆額度（換掉 updatedAt，跟別台存了一段來訪一樣）。

import { test, expect } from '../fixtures/app.js';
import { seedDocs } from '../fixtures/emulator.js';
import { scenarioBrokenCounts } from '../fixtures/data.js';

/** 別台寫的那一份：次數已經是它算對的（這裡隨便給一組跟掃描時不一樣的） */
function elsewhere(docs) {
  const ent = docs.find((d) => d.id === 'ent-e-vein');
  return { ...ent, data: { ...ent.data, doneCount: 1, bookedCount: 1 } };
}

test('R1 資料健檢：掃描之後別處改過那一筆額度 → 按修正不蓋回去、講一句、重新掃描', async ({ app, page }) => {
  const docs = scenarioBrokenCounts();
  await app.seed(docs);
  await app.signIn('/settings/health');
  const card = page.locator('#view .hcard[data-check="counts"]');
  await expect(card).toHaveCount(1);

  await seedDocs([elsewhere(docs)]);
  // 收起來的列裡的修正按鈕照樣在 —— 先點開那一列
  const fix = card.locator('[data-fix]').first();
  if (!await fix.isVisible()) await card.locator('details.hrow summary').first().click();
  await fix.click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();

  await expect(page.locator('#toast')).toContainText('別的地方被改過');
  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect([ent.doneCount, ent.bookedCount], '別台寫的那一份留著').toEqual([1, 1]);
});

test('R2 客戶詳情的「修正」：確認框開著的時候別處改過那一筆 → 不蓋回去', async ({ app, page }) => {
  const docs = scenarioBrokenCounts();
  await app.seed(docs);
  await app.signIn('/customers/cust-e');

  await page.locator('[data-fix]').first().click();
  await expect(app.dialog()).toBeVisible();
  await seedDocs([elsewhere(docs)]);
  await app.ok();

  await expect(page.locator('#toast')).toContainText('別的地方被改過');
  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect([ent.doneCount, ent.bookedCount], '別台寫的那一份留著').toEqual([1, 1]);
});

test('R3 沒人改過：客戶詳情照常修好', async ({ app, page }) => {
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/customers/cust-e');

  await page.locator('[data-fix]').first().click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect([ent.doneCount, ent.bookedCount]).toEqual([1, 0]);
});
