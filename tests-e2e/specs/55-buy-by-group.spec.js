// 加購那一排：先分類再項目（2026-10-06，issue 07）。
//
// 她的原話：
//
// > 可以參考課程種類與項目.md去分層，不論是新增一個/一群客戶的加購，客戶詳情的加購…都可以參考去分層丸子選
// > …只是新加入的那些我也不常用的課程可以去分層，就不會有好多課程然後都滑不到想要的
//
// 規則在 `tests/buy.test.js`（三個入口共用 `components/buy.js` 的 `fields()` 與 `wire()`）。
// 這一支盯的是只有瀏覽器看得到的：第二排真的接在那一份共用的接線上（客戶詳情與新增客戶的面板兩個入口各走一次）、
// 開著分類沒選就按儲存是一句話不是沒反應、存下去的課程是畫面上亮著的那一門。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, addDays, TODAY } from '../fixtures/data.js';

const top = (page) => page.locator('[data-chip="buy"]');
const item = (page) => page.locator('[data-chip="buyItem"]');
const labels = (loc) => loc.evaluateAll((els) => els.map((el) => el.firstChild.textContent.trim()));

test('B1 客戶詳情 → 加購：按「醫師門診」露出第二排；沒選就存是一句話；選二返存下去就是二返', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-b', name: '客戶A' })]);
  await app.signIn('/customers/cust-b');

  await page.locator('[data-add-ent]').click();
  await app.layer('[data-chip="buy"]');
  expect(await labels(top(page))).toEqual(
    ['復能', 'ILIB', '醫師門診', 'EECP', '運動區', '營養點滴', '健檢', '物理治療師諮詢', '營養品']);
  await expect(item(page)).toHaveCount(0);

  await top(page).filter({ hasText: '醫師門診' }).click();
  // 一類裡的順序照主檔清單（app 照文件 id 排），這一支只管有哪幾門
  expect((await labels(item(page))).sort()).toEqual(
    ['復健科醫師門診', '心臟科評估', '二返', '羊膜', '回測報告', 'HA-PRP', 'PRP'].sort());
  await expect(page.locator('[data-chip="buyItem"][aria-pressed="true"]')).toHaveCount(0);

  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('還要選「醫師門診」裡的哪一門');

  await item(page).filter({ hasText: '二返' }).click();
  await expect(page.locator('[data-chip="buy"][aria-pressed="true"]')).toContainText('醫師門診');
  await expect(page.locator('[data-chip="buyItem"][aria-pressed="true"]')).toHaveText('二返');
  await page.click('button[type="submit"]');
  await app.saved();

  const ents = await app.readAll('customers/cust-b/entitlements');
  expect(ents.map((e) => [e.courseId, e.label])).toEqual([['course-followup', '二返']]);
  expect(Object.keys(ents[0]).some((k) => k === 'buyGroup'), '開合狀態不會存進去').toBe(false);
});

test('B2 只有一門的分類一下就到：健檢直接出「幾萬的」、復能直接出「哪一種」；換分類時第二排收掉', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-b', name: '客戶A' })]);
  await app.signIn('/customers/cust-b');

  await page.locator('[data-add-ent]').click();
  await app.layer('[data-chip="buy"]');

  await top(page).filter({ hasText: '運動區' }).click();
  await expect(item(page)).toHaveCount(5);
  await top(page).filter({ hasText: '健檢' }).click();
  await expect(item(page), '換到只有一門的分類，第二排收掉').toHaveCount(0);
  await expect(page.locator('[data-chip="tier"]').first()).toBeVisible();

  await top(page).filter({ hasText: '復能' }).click();
  await expect(page.locator('[data-chip="poolKind"]').first()).toBeVisible();
  await expect(item(page)).toHaveCount(0);
});

test('B3 新增客戶 →「＋ 加一項」：同一張表，EECP → EECP體驗 加進名單', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/customers/new');

  await page.locator('[data-cf-addextra]').click();
  await app.layer('[data-chip="buy"]');
  await top(page).filter({ hasText: 'EECP' }).click();
  expect((await labels(item(page))).sort()).toEqual(['EECP', 'EECP體驗']);
  await item(page).filter({ hasText: 'EECP體驗' }).click();
  await expect(page.locator('[data-chip="buy"][aria-pressed="true"]')).toContainText('EECP');
  await page.locator('[data-addbuy]').click();

  await expect(page.locator('[data-cf-form] .roster__name')).toHaveText(['EECP體驗']);
});

// 換一門課，上一門的時長不可以跟著過來（issue 15）。規則在 `tests/buy.test.js`；這一條盯的是真的接到了那一張表上
test('B4 先點 ILIB（自動按好 60 分鐘）再點健檢：存下去的健檢額度不帶 60 分，排出來是兩小時', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-b', name: '客戶A' })]);
  await app.signIn('/customers/cust-b');

  await page.locator('[data-add-ent]').click();
  await app.layer('[data-chip="buy"]');
  await top(page).filter({ hasText: 'ILIB' }).click();
  await expect(page.locator('[data-chip="durationMin"][aria-pressed="true"]')).toContainText('60');

  await top(page).filter({ hasText: '健檢' }).click();
  await expect(page.locator('[data-chip="durationMin"]')).toHaveCount(0);
  await page.locator('[data-chip="tier"]').filter({ hasText: '8萬' }).click();
  await page.click('button[type="submit"]');
  await app.saved();

  const ents = await app.readAll('customers/cust-b/entitlements');
  const checkup = ents.find((e) => e.courseId === 'course-checkup');
  expect(checkup.durationMin, '以前是 60：排那一段時先問額度，健檢就排成一小時').toBeNull();

  // 她看得到的那一側：日曆新增 → 選那一筆健檢 → 09:00 起、結束是 11:00（課程的 120 分）
  await app.go(`/visits/new/cust-b/${addDays(TODAY, 1)}`);
  await app.layer('[data-chip="s0-ent"]');
  await page.locator(`[data-chip="s0-ent"][data-chip-value="${checkup.id}"]`).click();
  await expect(page.locator('.slothead__end').first(), '09:00 ＋ 120 分').toHaveText('11:00');
});
