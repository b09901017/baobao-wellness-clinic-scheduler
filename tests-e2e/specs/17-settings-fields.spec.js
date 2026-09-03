// 設定頁上那幾格數字**存不存得下去**。
//
// 2026-09-04 她回報：「我在設定那邊的二返填時長 30 分鐘，他不讓我儲存，
// 說只能 26 或 31？？」
//
// HTML 的 `step` 從 `min` 起算，所以 `min="1" step="5"` 的合法值是
// 1、6、11、16、21、26、31…… 30 不在裡面。**瀏覽器擋在 submit 之前**，
// 所以這種 bug 有一個很壞的性質：
//
//   - domain 的驗證跑都沒跑到（它只要求「大於 0 的整數」）
//   - 單元測試永遠是綠的
//   - 只有真的把數字打進一個真的 `<input>` 再按存檔，才會撞到它
//
// 所以它只能是端對端。`tests/number-fields.test.js` 從原始碼那一側掃同一件事，
// 兩支一起才蓋得住（一支看得到瀏覽器、一支看得到全部的呼叫端）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs } from '../fixtures/data.js';

/** 那一格現在的 validity。`false` = 瀏覽器會擋下這一次 submit。 */
const validOf = (page, selector) =>
  page.locator(selector).evaluate((el) => el.checkValidity());

test('S1 課程時長填 30 存得起來，重新讀出來還是 30', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-followup"]').click();
  await expect(page.locator('input[name="durationMin"]')).toBeVisible();

  await page.fill('input[name="durationMin"]', '30');
  expect(
    await validOf(page, 'input[name="durationMin"]'),
    '30 分鐘是合法的 —— domain 只要求大於 0 的整數',
  ).toBe(true);

  await page.click('button[type="submit"]');
  await app.settled();
  await page.waitForTimeout(600);

  const course = await app.readDoc('config/app/courses', 'course-followup');
  expect(course.durationMin, '真的存進去了').toBe(30);

  // 再打開一次，畫面上就是 30
  await page.locator('[data-edit="course-followup"]').click();
  await expect(page.locator('input[name="durationMin"]')).toHaveValue('30');
});

test('S2 其他不是 5 的倍數的時長也存得起來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-followup"]').click();
  for (const n of ['7', '23', '90']) {
    // eslint-disable-next-line no-await-in-loop
    await page.fill('input[name="durationMin"]', n);
    // eslint-disable-next-line no-await-in-loop
    expect(await validOf(page, 'input[name="durationMin"]'), `${n} 分鐘要收得下`).toBe(true);
  }

  // 0 與負數還是要擋 —— 欄位不可以比 domain 鬆
  await page.fill('input[name="durationMin"]', '0');
  expect(await validOf(page, 'input[name="durationMin"]'), '0 分鐘的課程不存在').toBe(false);
});

test('S3 排序權重填 1.25 存得起來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/preferences');

  await page.fill('input[name="w1"]', '1.25');
  expect(await validOf(page, 'input[name="w1"]'), '權重沒有理由只能一位小數').toBe(true);

  await page.click('button[type="submit"]');
  await app.settled();
  await page.waitForTimeout(600);

  const settings = await app.readDoc('config', 'app');
  expect(settings.sortWeights.w1).toBe(1.25);
});

test('S4 時段間隔填 7 分鐘存得起來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/preferences');

  await page.fill('input[name="slotGapMin"]', '7');
  expect(await validOf(page, 'input[name="slotGapMin"]')).toBe(true);

  await page.click('button[type="submit"]');
  await app.settled();
  await page.waitForTimeout(600);

  const settings = await app.readDoc('config', 'app');
  expect(settings.slotGapMin).toBe(7);
});

test('S5 每一格數字欄位的 min 都是 step 的倍數', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/preferences');

  // 這一頁上全部的數字格一次掃完 —— 掃的是瀏覽器真的看到的屬性，
  // 不是原始碼（`tests/number-fields.test.js` 掃的是那一半）。
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll('#view input[type="number"]')]
      .map((el) => ({ name: el.name, min: el.min, step: el.step }))
      .filter((x) => {
        if (x.step === 'any' || x.step === '') return false;
        const min = Number(x.min || 0);
        const step = Number(x.step);
        return Number.isInteger(step) && Number.isInteger(min) && min % step !== 0;
      }));

  expect(bad, `這幾格會讓她打出正確的數字卻存不下去：${JSON.stringify(bad)}`).toEqual([]);
});
