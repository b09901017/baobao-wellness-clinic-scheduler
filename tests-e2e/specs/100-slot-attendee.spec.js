// 一段來訪多一格「誰來的」：家人用被扣那一位的額度（family-merge-round 01，ADR-0183）。
//
// 先生用太太（客戶A）的額度：那一段記在客戶A身上、扣她的次數，「誰來的」寫「先生」。
// 盯三件事（單元那一側在 `tests/slot-attendee.test.js`）：
//
//   A1 來訪編輯器那一格預設收著、收著那一行寫「本人」；打字之後寫「先生」；存下去那一段帶著 `attendee`、次數照扣客戶A的
//   A2 日曆那一天的那一列、點開的讀取卡片，名字後面都是「(先生來)」
//   A3 再打開那一段，那一格還是先生；清掉存回去 → 那一格整個拿掉（本人那一段長得跟以前一模一樣）

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, TODAY, addDays } from '../fixtures/data.js';

const DAY = addDays(TODAY, 2);

function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能-三選一(60)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 10, durationMin: 60,
    }),
  ];
}

/** 按儲存、一路按確認到存好 */
async function save(app, page) {
  await page.click('button[type="submit"]');
  await expect(app.dialog()).toBeVisible();
  while (await app.dialog().isVisible()) {
    // eslint-disable-next-line no-await-in-loop
    await app.ok();
  }
  await app.saved();
}

const mine = async (app) => (await app.readAll('visits'))
  .filter((v) => !v.deletedAt && v.customerId === 'cust-a' && v.date === DAY);

test('A1–A3 記一段先生來的：存得下去、日曆與讀取卡片寫 (先生來)、清掉回到本人', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');

  // ---------- A1 ----------
  await app.go(`/visits/new/cust-a/${DAY}`);
  await app.layer('[data-chip="s0-ent"]');
  await page.locator('[data-chip="s0-equip"]').first().click();
  await page.locator('[data-chip="s0-staff"]').first().click();

  const fold = page.locator('[data-slotwho="0"]');
  await expect(fold, '預設收著').not.toHaveAttribute('open', '');
  await expect(fold.locator('[data-slotwho-now]')).toHaveText('本人');
  await fold.locator('summary').click();
  await page.fill('input[name="s0-who"]', '先生');
  await expect(fold.locator('[data-slotwho-now]'), '收著那一行跟著換').toHaveText('先生');
  await save(app, page);

  const [saved] = await mine(app);
  expect(saved.slots).toHaveLength(1);
  expect(saved.slots[0].attendee).toBe('先生');
  expect(saved.slots[0].entitlementId, '扣的是客戶A的那一筆').toBe('ent-pool');
  const pool = await app.readDoc('customers/cust-a/entitlements', 'ent-pool');
  expect(pool.bookedCount, '次數一次不多不少').toBe(1);

  // ---------- A2 ----------
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  const row = page.locator(`[data-open^="visit:${saved.id}:"]`).first();
  await app.layer(`[data-open^="visit:${saved.id}:"]`);
  await expect(row).toContainText('(先生來)');
  await row.click();
  await expect(page.locator('.readslot__what, .readcard').filter({ hasText: '(先生來)' }).first()).toBeVisible();

  // ---------- A3 ----------
  await app.go(`/visits/${saved.id}`);
  await app.layer('[data-slotwho="0"]');
  await expect(page.locator('[data-slotwho="0"] [data-slotwho-now]')).toHaveText('先生');
  await page.locator('[data-slotwho="0"] summary').click();
  await page.fill('input[name="s0-who"]', '');
  await page.click('button[type="submit"]');
  // 只改了這一格：沒有新的時段、時間與課程沒動（不是改期），一道確認框都不跳
  await app.saved();
  await expect(app.dialog()).toHaveCount(0);
  const [cleared] = await mine(app);
  expect('attendee' in cleared.slots[0], '清掉＝本人：那一格整個拿掉').toBe(false);
});
