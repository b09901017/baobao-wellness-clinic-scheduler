// 冒煙測試：地基通不通。
// 這一支紅了，底下全部都不用看 —— 不是 app 壞了，是測試環境沒接好。

import { test, expect } from '../fixtures/app.js';
import { scenarioFresh, masterDocs } from '../fixtures/data.js';

test('S1 登入之後五個分頁都打得開，而且沒有 console error', async ({ app, page }) => {
  await app.seed(scenarioFresh());
  await app.signIn();

  const tabs = [
    ['/', '待辦'],
    ['/customers', '客戶'],
    ['/schedule', '壓表'],
    ['/calendar', '日曆'],
    ['/settings', '設定'],
  ];

  for (const [hash, label] of tabs) {
    await app.go(hash);
    await expect(page.locator('.app__nav a[aria-current="page"]')).toContainText(label);
    const body = await app.text();
    expect(body, `${hash} 不該出現錯誤字樣`).not.toMatch(/這一頁出錯了|讀取失敗/);
    expect(body.trim().length, `${hash} 不該是空白的`).toBeGreaterThan(10);
  }
});

test('S2 種子客戶進得去詳情頁，額度看得到', async ({ app, page }) => {
  await app.seed(scenarioFresh());
  await app.signIn('/customers');

  await expect(page.locator('#view')).toContainText('客戶A');

  await app.go('/customers/cust-a');
  const body = await app.text();
  expect(body).toContain('客戶A');
  expect(body).toContain('復能');
  expect(body).toContain('靜脈');
});

test('S3 白名單以外的人只看得到「還沒有權限」', async ({ page, app }) => {
  // 先把白名單那一筆拿掉，再登入。主檔留著 —— 要驗證的是「有資料但看不到」。
  const { clearFirestore, seedDocs } = await import('../fixtures/emulator.js');
  await clearFirestore();
  await seedDocs(masterDocs());

  await page.goto('http://127.0.0.1:5000/');
  await page.waitForSelector('[data-signin]');
  const [popup] = await Promise.all([page.waitForEvent('popup'), page.click('[data-signin]')]);
  await popup.waitForLoadState('domcontentloaded');
  await popup.click('li.js-reuse-account');

  await expect(page.locator('.gate')).toContainText('這個帳號還沒有權限');
  await expect(page.locator('[data-uid]')).toHaveText(app.uid);
  // 白名單外的人不該看到任何資料
  await expect(page.locator('.app__nav')).toHaveCount(0);
});
