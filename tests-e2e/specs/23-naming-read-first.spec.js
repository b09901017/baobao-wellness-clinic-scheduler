// 設定 → 名稱怎麼寫。**先給看，點鉛筆才展開**。
//
// 她 2026-09-08：
//
// > 以簡潔、具有呼吸感的排版，呈現所有既有課程的「一般名稱」、「月曆簡寫」、
// > 「LINE 寫法」。此檢視狀態不呈現大量輸入框，不造成視覺負擔。
//
// 在這之前這一頁是十幾列、每列兩個輸入框一次全部攤開。
//
// 這一支只能是端對端 —— 「攤開了幾個輸入框」是瀏覽器算出來的東西，
// 原始碼那一側看得到樣板卻看不到「同一時間畫面上有幾個」。四件事：
//
//   1. 讀的狀態下**一個輸入框都沒有**
//   2. 鉛筆展開那一列，而且**上一列自己收起來**（兩列同開就回到原本那個樣子）
//   3. 打字**不重畫** —— 游標與輸入法的組字狀態要留著
//   4. 按了「存起來」才寫；點鉛筆離開不是一種儲存

import { test, expect } from '../fixtures/app.js';
import { masterDocs } from '../fixtures/data.js';

const ROWS = '[data-namingroot] .namerow';

test('N1 讀的狀態下一個輸入框都沒有', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/naming');
  await app.settled();

  await expect(page.locator(ROWS).first()).toBeVisible();
  await expect(
    page.locator('[data-namingroot] input'),
    '這一頁的整件事就是不要一開頁就滿是輸入框',
  ).toHaveCount(0);

  // 但兩種寫法都印得出來（標籤留著不省：那兩個字就是「誰在看」）
  await expect(page.locator('[data-namingroot]')).toContainText('月曆');
  await expect(page.locator('[data-namingroot]')).toContainText('LINE');
});

test('N2 鉛筆展開一列，開第二列時第一列自己收起來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/naming');
  await app.settled();

  const pencils = page.locator('[data-namingroot] [data-edit]');
  const first = await pencils.nth(0).getAttribute('data-edit');
  const second = await pencils.nth(1).getAttribute('data-edit');

  await pencils.nth(0).click();
  await expect(page.locator(`.namerow.is-editing [data-row="${first}"], [data-row="${first}"].is-editing`))
    .toHaveCount(1);
  await expect(page.locator('[data-namingroot] .namerow.is-editing')).toHaveCount(1);

  await pencils.nth(1).click();
  await expect(page.locator('[data-namingroot] .namerow.is-editing'), '一次只開一列')
    .toHaveCount(1);
  await expect(page.locator(`[data-row="${second}"].is-editing`)).toHaveCount(1);
});

test('N3 打字不重畫 —— 游標留在原地', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/naming');
  await app.settled();

  await page.locator('[data-namingroot] [data-edit]').first().click();
  const box = page.locator('.namerow.is-editing [data-short]');
  await expect(box).toBeVisible();

  await box.fill('');
  await box.type('ABCD', { delay: 40 });

  await expect(box).toHaveValue('ABCD');
  // 重畫過的話焦點會掉，游標也會跑到頭
  const at = await box.evaluate((el) => (
    document.activeElement === el ? el.selectionStart : -1));
  expect(at, '打完字焦點還在那一格、游標在最後面').toBe(4);
});

test('N4 點鉛筆離開不是一種儲存', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/naming');
  await app.settled();

  const pencils = page.locator('[data-namingroot] [data-edit]');
  await pencils.nth(0).click();
  const box = page.locator('.namerow.is-editing [data-short]');
  const before = await box.inputValue();
  await box.fill('不要存我');

  // 改開另一列
  await pencils.nth(1).click();
  await page.waitForTimeout(400);

  // 回到第一列：她打的字沒有留下來
  await pencils.nth(0).click();
  await expect(page.locator('.namerow.is-editing [data-short]')).toHaveValue(before);
});

test('N5 按了「存起來」才真的寫進去', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/naming');
  await app.settled();

  const pencil = page.locator('[data-namingroot] [data-edit]').first();
  const key = await pencil.getAttribute('data-edit');
  const [type, id] = key.split(':');

  await pencil.click();
  await page.locator('.namerow.is-editing [data-short]').fill('ZZ');
  await page.locator('.namerow.is-editing [data-save]').click();
  await app.settled();
  await page.waitForTimeout(700);

  const row = await app.readDoc(`config/app/${type}`, id);
  expect(row.shortName, '存起來了').toBe('ZZ');

  // 存完那一列收起來，而且畫面上就是新的字
  await expect(page.locator('[data-namingroot] .namerow.is-editing')).toHaveCount(0);
  await expect(page.locator(`[data-row="${key}"]`)).toContainText('ZZ');
});
