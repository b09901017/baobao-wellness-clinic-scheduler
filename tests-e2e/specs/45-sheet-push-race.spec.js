// 試算表推送在路上時又存了一筆，那一筆要補推（`.scratch/prelaunch-audit-2026-09-23/issues/05`）。
//
// 以前 `push()` 看到有一份在路上就直接拿那一份的結果，而那一份是第二筆寫入之前打包的；
// 它成功之後還把「還有沒推的」標記清掉 —— 第二筆要等她下一次再存任何東西才上得去。
//
// Apps Script 由 `page.route()` 頂替：第一包扣著不回，等第二筆存完才放行。
// 「計時器到了」由測試自己叫 `push()`（跟 app 同一個模組實體）—— 等真的 10 秒計時器
// 會讓這一支慢又不穩，而那個計時器做的事就是叫 `push()`。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const URL = 'https://script.example.test/exec';

const inbody = (id, customerId, customerName, startsAt) => visit({
  id, customerId, customerName, date: TODAY,
  slots: [{
    ...slot({ courseId: 'course-inbody', entitlementId: `ent-${customerId}`, startsAt, endsAt: startsAt.replace(':00', ':20') }),
    status: 'pending_confirm',
  }],
});

const person = (id, name) => [
  customer({ id, name }),
  entitlement(id, {
    id: `ent-${id}`, label: '身體組成分析', type: 'single',
    courseId: 'course-inbody', totalQty: 4, bookedCount: 1, durationMin: 20,
  }),
];

async function longPressConfirm(app, page, visitId) {
  const row = page.locator(`[data-open^="visit:${visitId}:"]`).first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();
}

const pushNow = (page) => page.evaluate(() => {
  // 不等它回來 —— 第一包是扣著的
  import('/js/data/sheetSync.js').then((m) => { window.__push = m.push(); });
});

test('P1 第一包在路上時又確認了一位 → 第一包回來之後馬上補推一次', async ({ app, page }) => {
  const bodies = [];
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route(`${URL}**`, async (route) => {
    bodies.push(route.request().postData() ?? '');
    // 第一包是打開 app 那一次（issue 01：掛上去之後 10 秒）—— 扣著的是測試自己叫的那一包
    if (bodies.length === 2) await held;
    await route.fulfill({
      status: 200,
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, sheets: 2, skipped: [] }),
    });
  });

  await app.seed([
    ...masterDocs({ sheetSync: { url: URL, token: 'e2e-token' } }),
    ...person('cust-a', '客戶A'),
    ...person('cust-b', '王小明'),
    inbody('v-a', 'cust-a', '客戶A', '09:00'),
    inbody('v-b', 'cust-b', '王小明', '10:00'),
  ]);
  await app.signIn('/calendar');
  await expect.poll(() => bodies.length, { timeout: 20_000, message: '打開 app 那一次先推完' }).toBe(1);
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');

  await longPressConfirm(app, page, 'v-a');
  await pushNow(page);
  await expect.poll(() => bodies.length, { message: '第一包送出去了' }).toBe(2);

  // 第一包還扣著，又確認了一位；它的計時器到了（這裡直接叫 push()）
  await longPressConfirm(app, page, 'v-b');
  await pushNow(page);

  release();
  // 真的計時器要 10 秒後才到 —— 5 秒內就有第二包，是 push() 自己補的
  await expect.poll(() => bodies.length, { timeout: 5_000, message: '第一包回來之後要補推' }).toBe(3);
  await expect.poll(
    () => page.evaluate(() => localStorage.getItem('sheetSync.dirty')),
    { message: '兩包都成功了才清掉待推標記' },
  ).toBeNull();
});

// ---------------------------------------------------------------------------
// 推失敗自己再推；回到 app、網路回來、打開 app 都補推（.scratch/sheet-push-gaps/issues/01）
//
// 1／5／15 分的重試由單元測試釘（`tests/sheet-push-retry.test.js`）—— 這裡等不了一分鐘。
// 這兩支量的是：打開 app 不寫任何東西也推一次；失敗之後回到 app／網路回來，10 秒內再推（不是等 1 分鐘的重試）。
// ---------------------------------------------------------------------------

/** 第一包回 500（試算表那一側出錯），之後都成功。 */
async function failFirst(page) {
  const bodies = [];
  await page.route(`${URL}**`, async (route) => {
    bodies.push(route.request().postData() ?? '');
    const ok = bodies.length > 1;
    await route.fulfill({
      status: ok ? 200 : 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      contentType: ok ? 'application/json' : 'text/plain',
      body: ok ? JSON.stringify({ ok: true, sheets: 1, kept: 0, skipped: [] }) : 'boom',
    });
  });
  return bodies;
}

const seedOne = (app) => app.seed([
  ...masterDocs({ sheetSync: { url: URL, token: 'e2e-token' } }),
  ...person('cust-a', '客戶A'),
  inbody('v-a', 'cust-a', '客戶A', '09:00'),
]);

const dirty = (page) => page.evaluate(() => localStorage.getItem('sheetSync.dirty'));

test('P2 打開 app 什麼都沒存也推一次；那一次失敗了，回到 app 就在 10 秒內再推', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '第一包刻意回 500' });
  const bodies = await failFirst(page);
  await seedOne(app);
  await app.signIn('/calendar');

  await expect.poll(() => bodies.length, { timeout: 20_000, message: '打開 app 10 秒後推一次（沒有任何寫入）' }).toBe(1);
  await expect.poll(() => dirty(page), { message: '失敗了：留著待推標記' }).toBe('1');

  // 回到 app（手機鎖屏又打開）。不是等 1 分鐘後的重試
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect.poll(() => bodies.length, { timeout: 20_000, message: '回到 app 之後 10 秒內再推' }).toBe(2);
  await expect.poll(() => dirty(page), { message: '這一次成功了，待推標記清掉' }).toBeNull();
});

test('P3 推失敗之後網路回來 → 10 秒內再推', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '第一包刻意回 500' });
  const bodies = await failFirst(page);
  await seedOne(app);
  await app.signIn('/calendar');

  await expect.poll(() => bodies.length, { timeout: 20_000 }).toBe(1);
  await expect.poll(() => dirty(page)).toBe('1');

  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => bodies.length, { timeout: 20_000, message: '網路回來之後 10 秒內再推' }).toBe(2);
  await expect.poll(() => dirty(page)).toBeNull();
});
