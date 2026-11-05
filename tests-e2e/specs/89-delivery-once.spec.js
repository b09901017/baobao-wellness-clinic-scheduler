// 2026-11-05 第一輪小修 04（11/4 全庫健檢 #4）：營養品「記交付」連按、或寫完還沒重畫就再記一次，只記一次。
//
// `withDelivery()` 拿呼叫端手上那一份額度判斷「給過了沒」：客戶詳情手上是打開那一刻讀的，
// 第一次寫完、畫面還沒重讀就再記一次同一款 → `deliveries` 多一筆一樣的、會進試算表。
// `ifUpdatedAt` 擋不住（還沒回到伺服器的 serverTimestamp 讀回來是 null），所以 `recordDelivery()` 寫之前重讀那一筆額度。
//
// 「第一次已經寫進去」用 fixture 直接寫進模擬器（跟別台、或上一下寫完了一樣：這一頁手上那一份不知道）。
// 舊的寫法在這個情境下還更糟：`withDelivery()` 拿手上那一份接一筆、整份寫回 `deliveries` ——
// 別處記的那一筆被蓋掉（筆數剛好還是 1），所以這裡比的是內容，不是筆數。

import { test, expect } from '../fixtures/app.js';
import { seedDocs } from '../fixtures/emulator.js';
import { scenarioProducts, TODAY, addDays } from '../fixtures/data.js';

test('D1 客戶詳情打開之後那幾款已經記過了：再按「已經給了」不多記一筆', async ({ app, page }) => {
  const docs = scenarioProducts();
  await app.seed(docs);
  await app.signIn('/customers/cust-c');
  await expect(page.locator('[data-product="ent-c-prod"]')).toBeVisible();

  const prod = docs.find((d) => d.id === 'ent-c-prod');
  const all = prod.data.items.map((it) => it.productId);
  const given = [{ at: addDays(TODAY, -3), productIds: all }];
  await seedDocs([{ ...prod, data: { ...prod.data, deliveries: given } }]);

  await page.locator('[data-product="ent-c-prod"]').click();
  await page.locator('[data-action="gave"]').click();
  await page.locator('[data-pickdate-ok]').click();
  // 這一頁手上那一份還以為一款都沒給：四款預設打勾
  await expect(page.locator('[data-give]')).toHaveCount(all.length);
  await page.locator('[data-give-ok]').click();
  await app.saved();

  const ent = await app.readDoc('customers/cust-c/entitlements', 'ent-c-prod');
  expect(ent.deliveries, '已經記過的那幾款不再記一次，別處記的那一筆也不被蓋掉').toEqual(given);
});
