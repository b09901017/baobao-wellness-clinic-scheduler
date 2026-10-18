// 待辦首頁（.scratch/staging-polish-2026-10-18/ 的 07、08）。
//
// 07：每一列「一直顯示／有才顯示／不顯示」，在 設定 → 待辦首頁 選（ADR-0151）。
// 08：今天／明天算進簽療程單與有日期的隨手記，逾期算進前幾天沒簽完的（ADR-0152）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, task, TODAY, addDays,
} from '../fixtures/data.js';

/** 首頁上某一列（照標題找）。 */
const homeRow = (page, label) => page.locator('.grouprow').filter({
  has: page.locator('.grouprow__label', { hasText: new RegExp(`^${label}$`) }),
});

/** 一位有額度、這個月還沒問也還沒壓的客戶：「問這輪的時間」「壓表登記」有東西可以列。 */
const someoneToAskAndBook = () => [
  customer({ id: 'cust-a', name: '客戶A' }),
  entitlement('cust-a', {
    id: 'ent-a', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 20, durationMin: 60,
  }),
];

// ---------------------------------------------------------------------------
// 07
// ---------------------------------------------------------------------------

test('R1 沒存過設定：首頁沒有「問這輪的時間」「壓表登記」；設成有才顯示就回來', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...someoneToAskAndBook()]);
  await app.signIn('/');
  await app.settled();
  // 「客戶填好的時間」那一列照舊會去讀（預設有才顯示）—— 等它讀完，確定不是還沒補上
  await expect(page.locator('[data-inbox]')).toBeAttached();
  await expect(homeRow(page, '問這輪的時間')).toHaveCount(0);
  await expect(homeRow(page, '壓表登記')).toHaveCount(0);
  await expect(page.locator('.flowgroup:visible .flowgroup__label', { hasText: '問到時間' })).toHaveCount(0);

  await app.seed([...masterDocs({ todoRows: { ask: 'auto', book: 'auto' } }), ...someoneToAskAndBook()]);
  // 同一個網址 `go('/')` 不會重畫
  await app.reload();
  await expect(homeRow(page, '問這輪的時間')).toBeVisible();
  await expect(homeRow(page, '壓表登記')).toBeVisible();
});

test('R2 寫紀錄設成一直顯示、一張都沒有還沒做的：看得到「寫紀錄 0」，點進去已完成能勾回來', async ({ app, page }) => {
  await app.seed([
    ...masterDocs({ todoRows: { 寫紀錄: 'always' } }),
    customer({ id: 'cust-a', name: '客戶A' }),
    task({
      id: 't-rec', customerId: 'cust-a', customerName: '客戶A', kind: '寫紀錄',
      dueDate: addDays(TODAY, -1), done: true, doneAt: `${TODAY}T09:00:00.000Z`,
    }),
  ]);
  await app.signIn('/');
  const row = homeRow(page, '寫紀錄');
  await expect(row).toBeVisible();
  await expect(row).toHaveClass(/grouprow--empty/);
  await expect(row.locator('.grouprow__n')).toHaveText('0');
  // 0 件的那一段不算「下一步」
  await expect(page.locator('.flowgroup--next')).toHaveCount(0);

  await row.click();
  await page.locator('[data-task-tab="done"]').click();
  await page.locator('[data-untick="t-rec"]').click();
  await app.saved();

  await app.go('/');
  await expect(homeRow(page, '寫紀錄').locator('.grouprow__n')).toHaveText('1');
  await expect(homeRow(page, '寫紀錄')).not.toHaveClass(/grouprow--empty/);
});

test('R3 Examine 設成不顯示、有一張逾期的：那一列不畫，「逾期」照算、點進去看得到', async ({ app, page }) => {
  await app.seed([
    ...masterDocs({ todoRows: { Examine: 'hidden' } }),
    customer({ id: 'cust-a', name: '客戶A' }),
    task({ id: 't-ex', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine', dueDate: addDays(TODAY, -2) }),
  ]);
  await app.signIn('/');
  await app.settled();
  await expect(homeRow(page, 'Examine')).toHaveCount(0);
  await expect(page.locator('[data-tile="overdue"] .tile__n')).toHaveText('1');

  await page.locator('[data-tile="overdue"]').click();
  await expect(page.locator('#view')).toContainText('客戶A');
  await expect(page.locator('#view')).toContainText('Examine');
});

test('R4 設定頁：改了存起來、重新整理還在，首頁跟著變，稽核寫中文', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-a', name: '客戶A' })]);
  await app.signIn('/');
  await expect(homeRow(page, '寫紀錄')).toHaveCount(0);

  await page.locator('[data-todo-rows]').click();
  const rec = page.locator('[data-row="寫紀錄"]');
  await expect(rec.locator('[data-show="auto"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-row="ask"] [data-show="hidden"]'), '預設藏起來').toHaveAttribute('aria-pressed', 'true');
  await rec.locator('[data-show="always"]').click();
  await app.saved();

  await app.reload();
  await expect(page.locator('[data-row="寫紀錄"] [data-show="always"]')).toHaveAttribute('aria-pressed', 'true');

  await app.go('/');
  await expect(homeRow(page, '寫紀錄').locator('.grouprow__n')).toHaveText('0');

  await app.go('/settings/audit');
  await expect(page.locator('#view')).toContainText('待辦首頁顯示哪幾列');
});
