// 上線前補的那一輪，段三（.scratch/before-golive-2026-10-19/ 的 09、10、11）。
//
// 09：拍 Abovee 點開沒勾的那一列，看得到「勾起來的話」（她：「沒勾的列，點開看不到提醒。(好，修)」）。
// 10：試算表只重畫有變的那幾頁（ADR-0161）：設定頁「整份重畫」送 force、回報分得出重畫幾頁／沒變幾頁、
//     讀到的不是全部（離線）就這一趟不推（中途發現 2）。`.gs` 那一側在 node 裡測（`tests/sheet-fingerprint.test.js`）。
// 11：待辦首頁「明天」也算明天要簽的療程單（ADR-0162，推翻 ADR-0152 那一格）。她：「但我想要今天和明天是一樣的誒，
//     就是納入簽療程單」—— 點下去開讀取卡片，**不開簽單抽屜**（「免得還沒做就被簽成做完」）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, note, TODAY, addDays,
} from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

// ---------------------------------------------------------------------------
// 09
// ---------------------------------------------------------------------------

const MONTH = '2026-09';
const POOL3 = { type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60 };

/** 壓表頁 → 那一批 → 右下角相機 → 相簿選一張 → 送出 → 確認層（同 `62`）。 */
async function photographAbovee(app, page, fixture) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await queueAi([fixture]);
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto(`${fixture}-0.jpg`, { width: 1600, height: 900 })]);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const ablRow = (page, key) => page.locator(`[data-abl-row="${key}"]`);

test('W1 只買 1 次、照片上三天、拿掉第三列的勾 → 點開它看得到「勾起來的話」；收著不畫、確認框不算它', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-b', { id: 'b-pool', ...POOL3, totalQty: 1 }),
    { path: 'batches', id: 'b-sep', data: {
      targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
      queue: [{ customerId: 'cust-b', customerName: '', state: 'pending', skippedReason: null }],
    } },
  ]);
  await app.signIn('/');
  await photographAbovee(app, page, 'aboveeList-days');

  await ablRow(page, 'a2').locator('[data-abl-check]').click();
  await expect(ablRow(page, 'a2').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');
  // 收著：沒勾的那一列一行提醒都不畫；勾著的兩列照舊講已排 2 次
  await expect(ablRow(page, 'a2').locator('.abl-row__hint--warn')).toHaveCount(0);
  await expect(ablRow(page, 'a0').locator('.abl-row__hint--warn')).toContainText('已排 2 次');

  // 點開：勾起來的話 → 三次
  await ablRow(page, 'a2').locator('[data-abl-open]').click();
  const whatIf = ablRow(page, 'a2').locator('[data-abl-whatif]');
  await expect(whatIf).toContainText('勾起來的話');
  await expect(whatIf).toContainText('排完這次會超過總次數（共 1 次，已排 3 次）');

  // 開著的時候別列拿掉勾 → 照當下勾著的重算
  await ablRow(page, 'a1').locator('[data-abl-check]').click();
  await expect(whatIf).toContainText('已排 2 次');

  // 確認框只算勾著的那一列（剛好 1 次、不超用）—— 沒勾的「勾起來的話」不進「其中 N 段有提醒」
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).not.toContainText('有提醒');
  await app.cancelDialog();

  // 勾起來 → 那一塊不見，換成平常那幾行（同一句）
  await ablRow(page, 'a2').locator('[data-abl-check]').click();
  await expect(ablRow(page, 'a2').locator('[data-abl-whatif]')).toHaveCount(0);
  await expect(ablRow(page, 'a2').locator('.abl-row__warnings')).toContainText('已排 2 次');
});

// ---------------------------------------------------------------------------
// 10
// ---------------------------------------------------------------------------

const SHEET_URL = 'https://script.example.test/exec';
const sheetSeed = () => [
  ...masterDocs({ sheetSync: { url: SHEET_URL, token: 'test-token' } }),
  customer({ id: 'cust-a', name: '客戶A', chartNo: '1234' }),
  customer({ id: 'cust-b', name: '客戶B' }),
];

test('S1 立刻推一次／整份重畫：送的包每一頁有指紋與病歷號；整份重畫才帶 force；回報講得出重畫幾頁、幾頁沒變', async ({ app, page }) => {
  const posts = [];
  await page.route(`${SHEET_URL}**`, async (route) => {
    const body = JSON.parse(route.request().postData());
    posts.push(body);
    const n = body.bundle.sheets.length;
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify(body.force ? { ok: true, sheets: n, kept: 0, skipped: [] } : { ok: true, sheets: 0, kept: n, skipped: [] }),
    });
  });
  await app.seed(sheetSeed());
  await app.signIn('/settings/report');

  await page.locator('[data-sync-now]').click();
  await expect(page.locator('#toast')).toContainText('2 張分頁都沒變（只改了產生時間）');
  const plain = posts.at(-1);
  expect(plain.force).toBeUndefined();
  expect(plain.bundle.format).toBe(8);
  const a = plain.bundle.sheets.find((s) => s.name === '客戶A');
  expect(a.chartNo).toBe('1234');
  expect(a.fingerprint).toMatch(/^[0-9a-z]{12,}$/);

  await page.locator('[data-sync-redraw]').click();
  await expect(page.locator('#toast')).toContainText('重畫了 2 張分頁');
  expect(posts.at(-1).force).toBe(true);
});

test('S2 離線時按立刻推一次：這一趟不推（一個請求都沒有）、講「這一趟先不推」，卡片不說被拒絕', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '這一支刻意斷線' });
  const posts = [];
  await page.route(`${SHEET_URL}**`, async (route) => {
    posts.push(route.request().postData());
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, sheets: 2, kept: 0, skipped: [] }) });
  });
  await app.seed(sheetSeed());
  await app.signIn('/settings/report');
  await app.settled();

  await page.context().setOffline(true);
  await page.locator('[data-sync-now]').click();
  await expect(page.locator('#toast')).toContainText('這一趟先不推');
  await expect(page.locator('#view')).toContainText('上次沒推');
  await expect(page.locator('#view')).not.toContainText('被拒絕');
  expect(posts).toHaveLength(0);
  await page.context().setOffline(false);
});

// ---------------------------------------------------------------------------
// 11
// ---------------------------------------------------------------------------

const TOMORROW = addDays(TODAY, 1);

const ivEnt = (cust, id) => entitlement(cust, {
  id, label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 20, bookedCount: 2, durationMin: 60,
});
const ivSlot = (ent, startsAt, endsAt, status = 'confirmed') => ({
  ...slot({ courseId: 'course-iv-laser', entitlementId: ent, startsAt, endsAt }), status,
});

/** 判準那一組：明天兩位，一位一段、一位兩段；另一位明天整天取消；今天一位。 */
const tomorrowScenario = () => [
  ...masterDocs(),
  customer({ id: 'cust-a', name: '客戶A' }),
  customer({ id: 'cust-b', name: '客戶B' }),
  customer({ id: 'cust-c', name: '客戶C' }),
  ivEnt('cust-a', 'ent-a'), ivEnt('cust-b', 'ent-b'), ivEnt('cust-c', 'ent-c'),
  visit({
    id: 'v-tom-a', customerId: 'cust-a', customerName: '客戶A', date: TOMORROW, status: 'confirmed',
    slots: [ivSlot('ent-a', '10:00', '11:00')],
  }),
  visit({
    id: 'v-tom-b', customerId: 'cust-b', customerName: '客戶B', date: TOMORROW, status: 'pending_confirm',
    slots: [ivSlot('ent-b', '09:00', '10:00', 'pending_confirm'), ivSlot('ent-b', '13:00', '14:00')],
  }),
  visit({
    id: 'v-tom-c', customerId: 'cust-c', customerName: '客戶C', date: TOMORROW, status: 'cancelled',
    slots: [ivSlot('ent-c', '10:00', '11:00', 'cancelled')],
  }),
  visit({
    id: 'v-today', customerId: 'cust-c', customerName: '客戶C', date: TODAY, status: 'confirmed',
    slots: [ivSlot('ent-c', '15:00', '16:00')],
  }),
  note({ id: 'n-tom', text: '明天要記得的事', date: TOMORROW }),
];

const tileN = (page, id) => page.locator(`[data-tile="${id}"] .tile__n`);

test('T1 明天那顆數字算進明天還開著的那幾天（一位一天一件）；點進去件數一樣；今天照舊', async ({ app, page }) => {
  await app.seed(tomorrowScenario());
  await app.signIn('/');
  // 隨手記 1 ＋ 明天來 2（取消的那一位不算）
  await expect(tileN(page, 'tomorrow')).toHaveText('3');
  await expect(tileN(page, 'today')).toHaveText('1');

  await page.locator('[data-tile="tomorrow"]').click();
  await app.settled();
  await expect(page.locator('[data-task-tab="open"]')).toHaveText('未完成 3');
  const coming = page.locator('[data-coming]');
  await expect(coming.locator('[data-visit]')).toHaveCount(2);
  await expect(coming.locator('[data-visit="v-tom-b"]')).toContainText('09:00、13:00');
  await expect(coming).not.toContainText('客戶C');
  // 明天的不可以是「去簽」那一種
  await expect(page.locator('[data-close-go]')).toHaveCount(0);
});

test('T2 點明天來的那一列 → 開讀取卡片、不換到簽療程單那一頁；簽療程單那一列不收明天的', async ({ app, page }) => {
  await app.seed(tomorrowScenario());
  await app.signIn('/todo/tomorrow');
  await page.locator('[data-coming] [data-visit="v-tom-a"]').click();
  // 讀取卡片（`openCard()` 的 `.popcard`），只給看：沒有簽單抽屜那幾顆 ✓／✗
  const card = page.getByRole('dialog', { name: /客戶A/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('10:00–11:00');
  await expect(card.locator('input, [data-pick]')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/todo\/tomorrow$/);

  // 簽療程單那一頁：只有今天的那一位
  await app.go('/todo/close');
  await app.settled();
  await expect(page.locator('#view')).toContainText('客戶C');
  await expect(page.locator('#view')).not.toContainText('客戶A');
  await expect(page.locator('#view')).not.toContainText('客戶B');
});
