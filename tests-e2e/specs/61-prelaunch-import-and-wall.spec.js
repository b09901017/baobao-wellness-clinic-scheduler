// 2026-10-08 上線前修正，第一段（`.scratch/prelaunch-fixes-2026-10-08/issues/01`–`08`）。
//
// 這一段的共同點：**單元測試釘得住規則，釘不住「那顆按鈕這時候按不按得下去」
// 「那一排真的畫在她眼前」**。一段一支 spec，少開幾次模擬器（她的筆電會過熱）。
//
// fixture 全部是編出來的（客戶A、客戶B）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, TODAY, addDays } from '../fixtures/data.js';

// ---------- 01 舊資料匯入只跑得了一趟 ----------

/** 一位假客戶：一筆 ILIB 額度、一次已經發生的來訪。 */
const person = (name) => ({
  sheetName: name,
  name,
  entitlements: [{ key: 'r8', type: 'single', label: 'ILIB(60)', totalQty: 12, courseName: 'ILIB' }],
  visits: [{
    date: addDays(TODAY, -20),
    status: 'done',
    slots: [{ entitlementKey: 'r8', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00' }],
  }],
});

const mergeFile = (over = {}) => ({
  format: 'baobao-merge/v5',
  sheet: { file: '舊表.xlsx' },
  calendar: { file: 'timetree.ics' },
  customers: [person('客戶A'), person('客戶B')],
  eventCandidates: [],
  ...over,
});

const liveCustomers = async (app) => (await app.readAll('customers')).filter((c) => !c.deletedAt);

async function paste(app, page, file) {
  await page.locator('[data-json]').fill(JSON.stringify(file));
  await page.locator('[data-load]').click();
  await app.settled();
}

test('I1 匯入：確認框開著、匯入在跑的時候那顆按鈕按不下去，跑完剛好兩位', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  await paste(app, page, mergeFile());

  await page.locator('[data-run]').click();
  await expect(app.dialog()).toBeVisible();
  // 確認框開著的那一段也算進行中：她可能在第一個確認框還沒按之前又點一次
  await expect(page.locator('[data-run]'), '確認框開著時').toBeDisabled();
  await expect(page.locator('[data-load]'), '換一份檔案的那一顆也鎖著').toBeDisabled();

  await app.ok();
  // 匯入中再按一次（不經過畫面上的鎖，直接叫那顆按鈕）—— 一位都不可以多
  await page.evaluate(() => document.querySelector('[data-run]')?.click());
  await expect(page.locator('#toast')).toContainText('2 位客戶都匯進去了', { timeout: 20_000 });
  await app.settled();

  expect(await liveCustomers(app), '剛好兩位').toHaveLength(2);
  await expect(page.locator('[data-run]'), '整份匯好了：檔案清掉，那顆按鈕不在了').toHaveCount(0);
});

test('I2 匯入：按「先不要」之後按鈕回來，一個字都沒寫', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  await paste(app, page, mergeFile());

  await page.locator('[data-run]').click();
  await expect(app.dialog()).toBeVisible();
  await app.cancelDialog();

  await expect(page.locator('[data-run]')).toBeEnabled();
  expect(await liveCustomers(app)).toHaveLength(0);
});

test('I3 匯入：客戶都寫完、雜事那一步失敗之後再按一次，一位都不會多', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors' });
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  // 一筆 201 個字的待辦：Rules 不收（`validNote()` 上限 200），所以 `importNotes()` 會丟例外 ——
  // 而那時候兩位客戶已經寫進去了
  await paste(app, page, mergeFile({
    eventCandidates: [{
      startDate: addDays(TODAY, 3), endDate: addDays(TODAY, 3), title: '記'.repeat(201), kind: 'note', allDay: true,
    }],
  }));

  await page.locator('[data-run]').click();
  await app.ok();
  await expect(page.locator('#toast')).toContainText('匯入失敗', { timeout: 20_000 });
  await app.settled();
  expect(await liveCustomers(app), '第一次：兩位').toHaveLength(2);

  // 那顆按鈕還按得下去的話就再按一次（重試雜事）；不管按不按得下去，客戶都不可以多
  const again = page.locator('[data-run]');
  if (await again.count() && await again.isEnabled()) {
    await again.click();
    await app.ok();
    await expect(page.locator('#toast')).toContainText('匯入失敗', { timeout: 20_000 });
    await app.settled();
  }
  expect(await liveCustomers(app), '再按一次：還是兩位').toHaveLength(2);
});
