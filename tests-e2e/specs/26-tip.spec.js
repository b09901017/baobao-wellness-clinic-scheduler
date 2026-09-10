// 說明泡泡（`ui/components/tip.js`，issue 08／09）。
//
// 她 2026-09-10：「點了之後才會小小的在旁邊浮出說明…有點像是對話泡泡的那種泡泡
// 有一個小尖角的…就在原本?泡泡的那邊 浮出來」。
//
// 這一支盯的是單元測試量不到的那幾件 —— 全部要有版面才看得出來：
//
//   1. 收起來的時候那段字**真的不在畫面上**（不是縮小、不是透明）
//   2. 點了之後浮在那一顆旁邊，小尖角指著它
//   3. 點外面、Escape 都關得掉，Escape 關完焦點回到那一顆

import { test, expect } from '../fixtures/app.js';
import { masterDocs } from '../fixtures/data.js';

const bubble = (page) => page.locator('.tip__bubble');

test('T1 名稱設定：那三行說明收起來了，點 ? 才浮出來，點外面就收', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/naming');
  await app.settled();

  const title = page.locator('.page__title');
  await expect(title).toContainText('名稱怎麼寫');
  // 收起來的時候那一句不在畫面上 —— 常駐文字沒有從別的地方長回來
  await expect(page.locator('#view')).not.toContainText('同一個東西在三個地方寫法不一樣');
  await expect(bubble(page)).toHaveCount(0);

  const dot = title.locator('.tip');
  await dot.click();
  await expect(bubble(page)).toBeVisible();
  await expect(bubble(page)).toContainText('同一個東西在三個地方寫法不一樣');
  await expect(dot).toHaveAttribute('aria-expanded', 'true');
  await expect(bubble(page).locator('.tip__tail')).toHaveCount(1);

  // 泡泡貼在那一顆底下，小尖角對得到那一顆。
  // 縮放的原點就在小尖角上，所以動畫播到一半量也不會偏 —— 那正是原點綁在那裡的理由。
  const geo = await page.evaluate(() => {
    const b = document.querySelector('.tip__bubble').getBoundingClientRect();
    const d = document.querySelector('.page__title .tip').getBoundingClientRect();
    const tail = document.querySelector('.tip__tail').getBoundingClientRect();
    return { gapBelow: b.top - d.bottom, tailOff: Math.abs(tail.left - (d.left + d.width / 2)) };
  });
  expect(geo.gapBelow, '泡泡要貼在那一顆底下').toBeGreaterThanOrEqual(0);
  expect(geo.gapBelow, '泡泡離那一顆太遠了').toBeLessThan(24);
  expect(geo.tailOff, '小尖角要指著她按的那一顆').toBeLessThan(4);

  // 點外面：左邊留白那一條，一定不是任何可以按的東西
  await page.mouse.click(4, 320);
  await expect(bubble(page)).toHaveCount(0);
  await expect(dot).toHaveAttribute('aria-expanded', 'false');
});

test('T2 Escape 關得掉，而且焦點回到那一顆', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/naming');
  await app.settled();

  const dot = page.locator('.page__title .tip');
  await dot.click();
  await expect(bubble(page)).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(bubble(page)).toHaveCount(0);
  await expect(dot, '鍵盤使用者關掉之後要回到原本的位置').toBeFocused();
});

test('T3 資料健檢：那一句只印一次；點標題裡的 ? 不會順便展開；一次只有一張', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/health');
  await app.settled();

  const cards = page.locator('details[data-check]');
  await expect(cards.first()).toBeVisible();
  // 同一句說明以前印了兩次：上面的磚塊一次、展開的那一塊一次
  await expect(page.locator('.check__note'), '磚塊那一排只剩數字與名稱').toHaveCount(0);

  const first = cards.nth(0);
  const second = cards.nth(1);
  // 先捲好再開：捲動會把泡泡收掉（位置是打開那一刻量的）
  await first.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const wasOpen = await first.evaluate((d) => d.open);

  await first.locator('summary .tip').click();
  await expect(bubble(page)).toHaveCount(1);
  expect(await first.evaluate((d) => d.open), '點 ? 不可以順便把那一塊展開或收起來').toBe(wasOpen);

  // 第二顆可能正好被第一張泡泡蓋住，而真的去點的話 Playwright 會先捲動、
  // 捲動又會把第一張收掉 —— 那樣就算「一次只有一張」壞了這一條也照樣綠。
  // 所以直接對它發 click：這一條問的是「開第二張會不會先收掉第一張」。
  await second.locator('summary .tip').dispatchEvent('click');
  await expect(bubble(page), '一次只有一張').toHaveCount(1);
  await expect(first.locator('summary .tip')).toHaveAttribute('aria-expanded', 'false');
  await expect(second.locator('summary .tip')).toHaveAttribute('aria-expanded', 'true');
});
