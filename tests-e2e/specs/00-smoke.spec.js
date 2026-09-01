// 冒煙測試：地基通不通。
// 這一支紅了，底下全部都不用看 —— 不是 app 壞了，是測試環境沒接好。

import { test, expect } from '../fixtures/app.js';
import { scenarioFresh, masterDocs, TODAY } from '../fixtures/data.js';

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

// ---------- 看今天做了什麼 ----------
//
// 歸類與句子在 `tests/day-review.test.js` 與 `tests/audit.test.js` 裡測完了
//（那兩支加起來七十幾條）。這一支要的是另一件事：**那一塊在真的 Firestore
// 上畫得出來**，而且沒有 console error —— fixture 會替我們盯著後面那一半。
//
// 稽核是直接塞的（app 自己寫的那幾則會拿到模擬器的真實時間，而測試的「今天」
// 是固定的 2026-08-29，`listOnDay()` 撈不到）。

/** 一則稽核。`at` 用 Date，seedDocs 會存成 Timestamp。 */
const auditRow = (id, at, over = {}) => ({
  path: 'audit',
  id,
  data: {
    at: new Date(`${TODAY}T${at}:00+08:00`),
    actor: 'seed',
    note: null,
    ...over,
  },
});

test('S4 「看今天做了什麼」照人分組畫得出來，兩種看法切得動', async ({ app, page }) => {
  await app.seed([
    ...scenarioFresh(),
    auditRow('a1', '09:11', {
      action: 'visits.create',
      targetPath: 'visits/v-review',
      before: null,
      after: {
        customerId: 'cust-a',
        customerName: '客戶A',
        date: '2026-09-14',
        status: 'pending_confirm',
        slots: [{ courseName: '復能' }],
      },
    }),
    auditRow('a2', '09:20', {
      action: 'notes.update',
      targetPath: 'notes/n-review',
      before: { customerId: 'cust-a', customerName: '客戶A', text: '帶健保卡', done: false },
      after: { done: true, doneAt: `${TODAY}T01:20:00.000Z` },
    }),
  ]);
  await app.signIn();

  const panel = page.locator('[data-review]');
  await panel.locator('summary').click();
  await expect(panel.locator('.reviewwho__name')).toHaveText('客戶A');

  // 預設是照人
  await expect(panel.locator('[data-review-by="person"]')).toHaveAttribute('aria-pressed', 'true');

  const rows = panel.locator('.reviewrow');
  await expect(rows).toHaveCount(2);
  // **照她做的順序由早到晚**：先壓表、再勾掉那一件
  await expect(rows.nth(0)).toContainText('壓表');
  await expect(rows.nth(1)).toContainText('勾掉待辦');

  // 她點名的那個 bug：「什麼叫勾掉某某的某某??」
  // 抬頭已經寫著名字了，那幾列不可以再印一次。
  for (const text of await rows.allTextContents()) {
    expect(text, `這一列不該再印一次名字：${text}`).not.toContain('客戶A');
  }

  // 換看法**不重新讀資料**，所以切過去要立刻畫得出來
  await panel.locator('[data-review-by="stage"]').click();
  await expect(panel.locator('[data-review-by="stage"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(panel).toContainText('壓表');
  // 照流程那一格沒有抬頭可以靠，所以名字要印在列上
  await expect(panel.locator('.reviewrow').first()).toContainText('客戶A');
  await expect(panel.locator('.reviewwho__name')).toHaveCount(0);

  await panel.locator('[data-review-by="person"]').click();
  await expect(panel.locator('.reviewwho__name')).toHaveText('客戶A');
});
