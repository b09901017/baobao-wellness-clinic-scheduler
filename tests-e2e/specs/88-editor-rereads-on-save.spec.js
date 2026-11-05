// 2026-11-05 第一輪小修 01（11/4 全庫健檢 #1）：來訪編輯器按「儲存」那一刻要重讀這位客戶的全部來訪。
//
// 以前打開時讀到的是伺服器那一份、而且沒離線，就沿用打開那一刻的那一份（`refreshCustomerVisits()` 提前 return）。
// 存檔拿它重算額度的次數快取、判斷同一天有沒有一筆 —— `ifUpdatedAt` 只擋同一筆來訪，擋不到別筆：
// - E1：打開之後別台替同一筆額度在別天排了一段 → 這裡存，`bookedCount` 少算那一段
// - E2：別台在同一天排了一筆 → 這裡存，同一天長出第二筆來訪（ADR-0083）
//
// 「別台」用 fixture 直接寫進模擬器（跟另一台裝置存了一樣：這一頁手上那一份不知道）。

import { test, expect } from '../fixtures/app.js';
import { seedDocs } from '../fixtures/emulator.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = addDays(TODAY, 2);
const OTHER_DAY = addDays(TODAY, 4);

const alive = (rows) => rows.filter((r) => !r.deletedAt);

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

/** 別台存的那一筆：同一筆額度、待確認 */
const elsewhere = (id, date) => visit({
  id, customerId: 'cust-a', customerName: '客戶A', date,
  slots: [{
    ...slot({
      courseId: 'course-recovery', entitlementId: 'ent-pool', equipmentId: 'eq-sis',
      startsAt: '15:00', endsAt: '16:00', therapistId: 'staff-tw',
    }),
    status: 'pending_confirm',
  }],
});

/** 打開日曆的新增、選額度、器材、治療師 —— 停在按「儲存」之前 */
async function openAndPick(app, page) {
  await app.go(`/visits/new/cust-a/${DAY}`);
  await app.layer('[data-chip="s0-ent"]');
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="ent-pool"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-chip="s0-equip"]').first().click();
  await page.locator('[data-chip="s0-staff"]').first().click();
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

test('E1 打開之後別台在別天扣了同一筆額度：存下去 bookedCount 把那一段也算進去', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await openAndPick(app, page);

  await seedDocs([elsewhere('v-other', OTHER_DAY)]);
  await save(app, page);

  const pool = await app.readDoc('customers/cust-a/entitlements', 'ent-pool');
  expect(pool.bookedCount, '這裡的一段＋別台的一段').toBe(2);
});

test('E2 打開之後別台在同一天排了一筆：存下去併進那一筆，不長第二筆', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await openAndPick(app, page);

  await seedDocs([elsewhere('v-same', DAY)]);
  await save(app, page);

  const days = alive(await app.readAll('visits')).filter((v) => v.customerId === 'cust-a' && v.date === DAY);
  expect(days.map((v) => v.id), '同一天只有一筆（ADR-0083）').toEqual(['v-same']);
  expect(days[0].slots, '併進去：別台那一段＋這裡的一段').toHaveLength(2);
  const pool = await app.readDoc('customers/cust-a/entitlements', 'ent-pool');
  expect(pool.bookedCount).toBe(2);
});
