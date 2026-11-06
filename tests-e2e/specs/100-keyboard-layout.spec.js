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

// 段三審查 R1：導覽列收了，右下角那一顆泡泡（`.fab`）也站到鍵盤上面 —— 首頁那張卡的框右邊是「記」、底下是新加的兩排
test('K4 首頁那張卡的「記一筆…」：打字時右下角那一顆也收起來；框、「記」都在畫面裡', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/');
  await expect(page.locator('.fab')).toBeVisible();
  const input = page.locator('[data-newnote] input[name="text"]');
  await input.focus();
  await page.setViewportSize({ width: W, height: WITH_KEYBOARD });
  await expect(page.locator('html')).toHaveAttribute('data-keyboard', '');
  await expect(page.locator('.fab'), '泡泡跟導覽列一起收').toBeHidden();
  await expect(page.locator('.app__nav')).toBeHidden();
  await input.scrollIntoViewIfNeeded();
  for (const el of [input, page.locator('[data-newnote] button[type="submit"]')]) {
    const box = await el.boundingBox();
    expect(box.y + box.height).toBeLessThanOrEqual(WITH_KEYBOARD);
  }

  await input.blur();
  await page.setViewportSize({ width: W, height: FULL });
  await expect(page.locator('.fab')).toBeVisible();
});

// 段三審查 R8（她 11/6 在 HTC 上：「鍵盤出現有把抽屜往上推，但…把抽屜往上滑，他就會超出介面」）。
// HTC 上量過（2026-11-06，staging 全螢幕那一顆）：**沒有** `interactive-widget=resizes-content` 時版面停在 800、
// 鍵盤蓋上去（visualViewport 452），往上拖整頁跟著平移（visualViewport.offsetTop 0 → 35）—— 那就是「超出介面」；
// 加上之後版面縮成 404、`100dvh` 也是 404，抽屜停在 24～404、整頁不動。整頁平移只有實機重現得出來
// （桌機的 setViewportSize 沒有 visual viewport 跟 layout viewport 分開的那一種），這一支盯的是版面縮了之後
// 往上拖，抽屜的上緣與下緣都還在畫面裡
test('K5 日曆 ＋ → 待辦：鍵盤開著（版面縮一半）往上拖抽屜，抽屜整張都還在畫面裡', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/calendar');
  await page.locator('[data-fab]').click();
  await page.locator('[data-new-note]').click();
  await app.layer('[data-noteform]');
  const input = page.locator('[data-noteform] input[name="text"]');
  await input.focus();
  await page.setViewportSize({ width: W, height: WITH_KEYBOARD });
  const drawer = page.locator('.drawer');
  await drawer.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));

  // 手指拖（CDP 的觸控事件）：滑鼠拖到抽屜外面放開，Chrome 會把 click 派給共同祖先（backdrop）、抽屜就關了 —— 手指不會
  const cdp = await page.context().newCDPSession(page);
  const grip = await page.locator('.drawer__grip').boundingBox();
  const x = grip.x + grip.width / 2;
  const touch = (type, y) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }],
  });
  await touch('touchStart', grip.y + grip.height / 2);
  for (let y = grip.y; y >= 0; y -= 12) await touch('touchMove', y);
  await touch('touchMove', 0);
  const during = await drawer.boundingBox();
  await touch('touchEnd');
  await drawer.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const after = await drawer.boundingBox();
  for (const [when, box] of [['拖的時候', during], ['放開之後', after]]) {
    expect(box.y, `${when}：上緣在畫面裡`).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height, `${when}：下緣在畫面裡`).toBeLessThanOrEqual(WITH_KEYBOARD + 1);
  }
  expect(await page.evaluate(() => [scrollY, document.scrollingElement.scrollTop]), '整頁沒有捲走').toEqual([0, 0]);
  await expect(input).toBeVisible();
});
