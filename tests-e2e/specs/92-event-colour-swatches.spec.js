// 2026-11-05 第一輪小修 07（ADR-0171）：新增行事備註那張表的顏色。
//
// 她：「為什麼第一個都很奇怪，會是一個空心圈圈？… 讓第一顆就是紫色的實心」「斜線的，所有顏色選擇就都呈現斜線的樣子」。
// 第一顆＝那一類本來的顏色、實心、選它存 null；六色裡跟它重複的那一色不列（行事備註紫、休假藍）—— 除非這一筆存的就是那一色；
// 休假時每一顆的圓點都畫斜線。量的是瀏覽器算出來的樣子（`::before` 的底色、框、底圖）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, event, TODAY } from '../fixtures/data.js';

// 那張表上只有一組顏色；不用新的 class 找，舊的畫法才跑得進底下的斷言
const SWATCHES = '[role="group"][aria-label="顏色"] .swatch';

/** 每一顆色票的圓點（`::before`）長什麼樣。 */
async function swatches(page) {
  return page.locator(SWATCHES).evaluateAll((els) => els.map((el) => {
    const dot = getComputedStyle(el, '::before');
    return {
      colour: el.dataset.colour,
      pressed: el.getAttribute('aria-pressed'),
      fill: dot.backgroundColor,
      ring: dot.borderTopStyle === 'none' ? 0 : parseFloat(dot.borderTopWidth),
      stripes: dot.backgroundImage.includes('repeating-linear-gradient'),
      buttonImage: getComputedStyle(el).backgroundImage,
      kindFg: getComputedStyle(el).getPropertyValue('--kind-fg').trim(),
    };
  }));
}

const isSolid = (c) => c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent';

test('C1 行事備註：第一顆是實心的預設色、沒有第二顆紫；選第一顆存下去是 null', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn(`/events/new/${TODAY}`);
  await app.layer(SWATCHES);

  const s = await swatches(page);
  expect(s[0].colour, '第一顆是那一類本來的顏色（存 null）').toBe('');
  expect(isSolid(s[0].fill), '第一顆是實心的').toBe(true);
  expect(s[0].ring, '不是空心圈').toBe(0);
  expect(s[0].pressed, '新的一筆預設選第一顆').toBe('true');
  expect(s.map((x) => x.colour), '紫跟第一顆重複，不列').toEqual(['', 'grey', 'green', 'tea', 'red', 'blue']);
  expect(s.some((x) => x.stripes), '行事備註不畫斜線').toBe(false);
  for (const x of s) expect(isSolid(x.fill), `${x.colour || '第一顆'} 是實心的`).toBe(true);

  await page.locator('[data-title]').fill('公出');
  await page.locator('[data-colour="red"]').click();
  await page.locator('[data-colour=""]').click();
  await expect(page.locator('[data-colour=""]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-save]').click();
  await app.saved();

  const saved = (await app.readAll('events')).find((e) => e.title === '公出');
  expect(saved?.color, '第一顆存 null，跟以前「跟著類別」一樣').toBe(null);
});

test('C2 休假：第一顆是實心的霧藍、沒有藍；每一顆都畫斜線，第一顆的按鈕底不再畫', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn(`/events/new/${TODAY}`);
  await page.locator('[data-category="leave"]').click();
  await expect(page.locator('[data-category="leave"]')).toHaveAttribute('aria-pressed', 'true');
  await app.layer(SWATCHES);

  const s = await swatches(page);
  expect(s.map((x) => x.colour), '藍跟第一顆重複，不列').toEqual(['', 'grey', 'green', 'tea', 'red', 'violet']);
  expect(isSolid(s[0].fill)).toBe(true);
  expect(s[0].ring).toBe(0);
  for (const x of s) expect(x.stripes, `${x.colour || '第一顆'} 畫了斜線`).toBe(true);
  expect(s[0].buttonImage, '斜線畫在圓點上，不是整顆按鈕底').toBe('none');
});

test('C3 以前挑了紫的行事備註：那一顆照樣列、是選著的；存檔之後還是紫', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    event({ id: 'e-violet', title: '高齡演講', category: 'personal', startDate: TODAY, color: 'violet' }),
  ]);
  await app.signIn('/events/e-violet');
  await app.layer(SWATCHES);

  const s = await swatches(page);
  expect(s.map((x) => x.colour)).toEqual(['', 'grey', 'green', 'tea', 'red', 'blue', 'violet']);
  expect(s.find((x) => x.colour === 'violet')?.pressed).toBe('true');
  expect(s[0].pressed).toBe('false');

  await page.locator('[data-save]').click();
  await app.saved();
  expect((await app.readDoc('events', 'e-violet')).color).toBe('violet');
});
