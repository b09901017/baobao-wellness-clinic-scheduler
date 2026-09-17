// 設定 → AI 用量（issue 05，ADR-0100）。
//
// 她 2026-09-17：「可以在設定那邊看到目前用了多少ai錢」。
// 這一支盯三件：數字跟 `aiUsage` 的合計一樣、暫停之後叫辨識講的是「暫停」、
// 上限改成 0 之後下一次被擋而且那一頁講得出是被哪一道擋下。

import { test, expect } from '../fixtures/app.js';
import { extractInApp, queueAi } from '../fixtures/ai/index.js';
import { dayKey, monthKey } from '../../functions/lib/guard.js';

const thisMonth = () => monthKey(new Date());

/** 從設定頁點那一格進來（同一個網址再 goto 一次 hash 沒變，頁面不會重畫）。 */
async function openUsage(app, page) {
  await page.goto('/#/settings');
  await app.settled();
  await page.locator('a.settile[href="#/settings/ai"]').click();
  await app.settled();
  await expect(page.locator('[data-aiuse]')).toBeVisible();
}

// **Function 記帳用的是真的時鐘**，而這一頁讀的是瀏覽器的「這個月」。
// fixture 預設把瀏覽器固定在 data.js 的 TODAY —— 兩個不同月份的話這一頁讀到的是空的那個月。
test.use({ today: dayKey(new Date()) });

test('U1 叫兩次假的辨識 → 這一頁是 2 次，估計花費跟 aiUsage 的合計一樣，「估計」看得到', async ({ app, page }) => {
  await queueAi([]);
  await app.signIn('/');
  expect((await extractInApp(page, 'orderForm')).ok).toBe(true);
  expect((await extractInApp(page, 'orderForm')).ok).toBe(true);

  await page.goto('/#/settings');
  await app.settled();
  await expect(page.locator('a.settile[href="#/settings/ai"]')).toContainText('這個月估計 US$');

  await page.locator('a.settile[href="#/settings/ai"]').click();
  await app.settled();
  const usage = await app.readDoc('aiUsage', thisMonth());
  await expect(page.locator('[data-month-usd]')).toHaveText(`US$${usage.estUsd.toFixed(2)}`);
  await expect(page.locator('[data-today]')).toContainText('2 次');
  await expect(page.locator('[data-kind="orderForm"]')).toContainText('2 次');
  await expect(page.locator('[data-recent] li')).toHaveCount(2);
  await expect(page.locator('[data-aiuse] .card__title')).toContainText('估計');
});

test('U2 暫停 → 叫辨識講的是 paused 不是失敗；那一頁最近那一列寫著被暫停擋下；稽核那一句是「暫停 AI」', async ({ app, page }) => {
  await queueAi([]);
  await app.signIn('/settings/ai');
  await page.locator('[data-pause]').click();
  await app.saved();
  await expect(page.locator('[data-pause]')).toHaveText('打開 AI');
  await expect(page.locator('[data-paused-note]')).toBeVisible();

  expect(await extractInApp(page)).toEqual({ ok: false, reason: 'paused' });

  await openUsage(app, page);
  await expect(page.locator('[data-recent] li').first()).toContainText('被擋：AI 暫停中');

  const audits = await app.readAll('audit');
  expect(audits.some((a) => a.targetPath === 'config/ai' && a.after?.paused === true)).toBe(true);
});

test('U3 上限改成 0 → 下一次被擋，最近那一列寫著超過這個月的上限；改成 31 存不下去並講出天花板', async ({ app, page }) => {
  await queueAi([]);
  await app.signIn('/settings/ai');

  const cap = page.locator('input[name="monthlyCapUsd"]');
  await cap.fill('31');
  await page.locator('[data-cap-form] button[type="submit"]').click();
  await expect(page.locator('[data-errors]')).toContainText('US$30');

  await cap.fill('0');
  await page.locator('[data-cap-form] button[type="submit"]').click();
  await app.saved();
  expect((await app.readDoc('config', 'ai')).monthlyCapUsd).toBe(0);

  expect(await extractInApp(page)).toEqual({ ok: false, reason: 'monthCap' });
  await openUsage(app, page);
  await expect(page.locator('[data-recent] li').first()).toContainText('被擋：超過這個月的上限');
});
