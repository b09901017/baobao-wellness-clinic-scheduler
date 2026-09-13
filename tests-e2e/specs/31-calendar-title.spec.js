// 日曆的標題、點標題跳日期、iPad 橫式的週檢視（`.scratch/asks-2026-09-13/issues/09`–`11`）。
//
// 她 2026-09-13：
//
// > a 我希望呈現2026年.....那邊可以寫的是幾月，因為光是2026年就會占掉手機版的版面導致後面都會變...
// > b 我希望點calbar__title那邊點了之後可以選日期，但是在月曆那邊可以選的是月，週那邊可以選週，日那邊可以選日
// > c 在週顯示那邊，我發現一個就是如果是橫的顯示(ipad) 他會變成好擠，所有字都會變成直得顯示?
//
// fixture 的「今天」是 2026-08-29（週六）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

async function openCalendar(app, page, docs = [...masterDocs()]) {
  await app.seed(docs);
  await app.signIn('/calendar');
  await app.go('/calendar');
}

async function switchView(app, page, view) {
  await page.locator(`[data-view="${view}"]`).click();
  await app.settled();
}

const title = (page) => page.locator('.calbar__title');

// ---------- 09 標題 ----------

test('375 寬：三種標題都不被截，而且講得出是哪一月、第幾週', async ({ app, page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openCalendar(app, page);

  await expect(title(page)).toHaveText('8月');
  await switchView(app, page, 'week');
  // 8/24–8/30：週四 8/27 → 8 月第 4 週
  await expect(title(page)).toHaveText('8月 W4');
  await switchView(app, page, 'day');
  await expect(title(page)).toHaveText('8/29(六)');

  for (const view of ['month', 'week', 'day']) {
    await switchView(app, page, view);
    const fits = await title(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits, `${view} 的標題被截掉了`).toBe(true);
  }
});

test('週檢視每一天的抬頭寫 8/24，不是只寫 24', async ({ app, page }) => {
  await openCalendar(app, page);
  await switchView(app, page, 'week');
  await expect(page.locator('.swipe__pane[data-offset="0"] .weekday__n').first()).toHaveText('8/24');
});

test('往後滑到明年一月，標題帶年份', async ({ app, page }) => {
  await openCalendar(app, page);
  for (let i = 0; i < 5; i += 1) {
    await page.locator('.calbar [data-move="1"]').click();
    await app.settled();
  }
  await expect(title(page)).toHaveText('2027年1月');
});
