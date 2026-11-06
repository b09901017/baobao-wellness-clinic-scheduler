// 鍵盤開著的時候（notes-widget 01，ADR-0181）。
//
// 真的鍵盤只有手機上有。`interactive-widget=resizes-content` 讓鍵盤跳出來時版面跟著縮 ——
// 這裡用 `setViewportSize()` 把版面縮成 HTC 量到的那樣（鍵盤佔掉一半）來量：
// 抽屜與輸入框落在剩下的畫面裡、打字時底部導覽列收起來、鍵盤收了回來。
// 「全螢幕的那一顆真的會縮」是實機才驗得到的（手動驗收清單：她在 HTC 主畫面那一顆點）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs } from '../fixtures/data.js';

const W = 414;
const FULL = 896;
const WITH_KEYBOARD = 452;

test('K1 記一筆：鍵盤開著（版面縮一半）→ 抽屜與輸入框都在畫面裡、導覽列收起來；鍵盤收了導覽列回來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/todo/notes');
  await page.locator('[data-quick]').click();
  const drawer = page.locator('.drawer');
  const input = drawer.locator('[data-quicktext]');
  await expect(input).toBeFocused();

  await page.setViewportSize({ width: W, height: WITH_KEYBOARD });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', '');
  await expect(page.locator('.app__nav')).toBeHidden();
  await drawer.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const box = await input.boundingBox();
  expect(box.y, '輸入框在剩下的畫面裡').toBeGreaterThanOrEqual(0);
  expect(box.y + box.height).toBeLessThanOrEqual(WITH_KEYBOARD);
  const save = await drawer.locator('[data-save]').boundingBox();
  expect(save.y + save.height, '「記下來」也看得到').toBeLessThanOrEqual(WITH_KEYBOARD);

  await input.blur();
  await page.setViewportSize({ width: W, height: FULL });
  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard', '');
  await expect(page.locator('.app__nav')).toBeVisible();
});

test('K2 沒有在打字（焦點不在輸入框）時版面變矮：導覽列照舊', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/');
  await page.setViewportSize({ width: W, height: WITH_KEYBOARD });
  await expect(page.locator('.app__nav')).toBeVisible();
  await expect(page.locator('html')).not.toHaveAttribute('data-keyboard', '');
});

test('K3 整頁的表單（新增客戶）：打字時導覽列收起來、那一格在畫面裡', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/customers/new');
  const name = page.locator('#view input[name="name"]');
  await name.focus();
  await page.setViewportSize({ width: W, height: WITH_KEYBOARD });
  await expect(page.locator('.app__nav')).toBeHidden();
  await name.scrollIntoViewIfNeeded();
  const box = await name.boundingBox();
  expect(box.y + box.height).toBeLessThanOrEqual(WITH_KEYBOARD);
});
