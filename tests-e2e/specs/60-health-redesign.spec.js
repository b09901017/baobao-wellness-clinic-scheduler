// 資料健檢重新設計（`.scratch/verified-bugs-2026-10-07/issues/18`，ADR-0136）。
//
// 這一頁只回答兩件事：有沒有事、有事的話要做什麼。她看過圖點頭的五件事：結論一塊、
// 數字磚拿掉、有事的排最上面分兩組、同一位客戶的好幾筆收成一列、沒問題的收成最底下一行。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement } from '../fixtures/data.js';

/**
 * 一個「全部沒事」的資料庫。`masterDocs()` 把每一筆都寫成啟用的，而種子上點滴8、VIP7 是停用的
 * （`CLAUDE.md` 診間那一列）—— 照寫的話「診間清單」那一項會要她停用那兩間。
 */
const cleanDocs = () => masterDocs().map((d) => (['room-iv8', 'room-vip7'].includes(d.id)
  ? { ...d, data: { ...d.data, active: false } } : d));

test('H1 全部沒事：一個畫面看得完；沒問題的收成一行，點開列得出每一項的名字', async ({ app, page }) => {
  await page.setViewportSize({ width: 393, height: 852 });
  await app.seed(cleanDocs());
  await app.signIn('/settings/health');
  await app.settled();

  await expect(page.locator('.hsum__head')).toContainText('項都沒問題');
  await expect(page.locator('.hcard')).toHaveCount(0);
  await expect(page.locator('.check'), '數字磚那一排拿掉了').toHaveCount(0);

  const fits = await page.evaluate(() => [document.documentElement, document.querySelector('.app__main')]
    .every((el) => !el || el.scrollHeight <= el.clientHeight + 1));
  expect(fits, '手機上一個畫面看得完').toBe(true);

  const ok = page.locator('details.hok');
  await expect(ok.locator('summary')).toContainText('看檢查了哪');
  await ok.locator('summary').click();
  await expect(ok.locator('li[data-check="counts"]')).toBeVisible();
  await expect(ok).toContainText('次數對帳');
  await expect(ok).toContainText('二返額度');
});

test('H2 有一項有事：它在最上面、同一位客戶的兩筆收成一列、一次修正那一顆照舊在、沒問題的收著', async ({ app, page }) => {
  await app.seed([
    ...cleanDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    // 沒有任何來訪，計數欄位卻記著做過 —— 「次數對帳」那一項、同一位兩筆
    entitlement('cust-a', { id: 'ent-a1', label: '身體組成分析', type: 'single', courseId: 'course-inbody', totalQty: 4, doneCount: 2, bookedCount: 0 }),
    entitlement('cust-a', { id: 'ent-a2', label: '體適能檢查分析', type: 'single', courseId: 'course-fitness', totalQty: 4, doneCount: 1, bookedCount: 0 }),
  ]);
  await app.signIn('/settings/health');
  await app.settled();

  // 這位客戶還有次數、沒收過時間，所以「資料過期」那一項也會有（要處理，排在後面那一組）
  await expect(page.locator('.hsum__head')).toHaveText('有 2 項要你看');
  await expect(page.locator('.hsum')).toContainText('其餘');

  const card = page.locator('#view .hcard').first();
  await expect(card, '有事的那一項在最上面').toHaveAttribute('data-check', 'counts');
  await expect(page.locator('.hgroup__title')).toHaveText(['資料對不起來', '要處理']);
  await expect(card.locator('.hcard__why')).toBeVisible();

  // 同一位客戶的兩筆收成一列，點了才展開；按鈕的數目跟以前一樣（兩筆各一顆、上面一次修正）
  const row = card.locator('details.hrow');
  await expect(row.locator('summary')).toContainText('客戶A');
  await expect(row.locator('summary')).toContainText('2 筆');
  await expect(card.locator('[data-fix]')).toHaveCount(2);
  await expect(card.locator('[data-fix]').first()).toBeHidden();
  await expect(card.locator('[data-fix-all]')).toBeVisible();
  await row.locator('summary').click();
  await expect(card.locator('[data-fix]').first()).toBeVisible();

  // 沒問題的收在最底下，沒有展開
  const ok = page.locator('details.hok');
  await expect(ok.locator('summary')).toContainText('沒問題的');
  expect(await ok.evaluate((d) => d.open)).toBe(false);

  // 一次修正之後那一項移到「沒問題」那一份裡
  await card.locator('[data-fix-all]').click();
  await app.ok();
  await app.saved();
  await expect(page.locator('#view [data-check="counts"]')).toContainText('沒問題');
  await expect(page.locator('.hsum__head')).toHaveText('有 1 項要你看');
});
