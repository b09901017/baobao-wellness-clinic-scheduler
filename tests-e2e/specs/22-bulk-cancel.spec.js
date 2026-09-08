// 批次取消專區（ADR-0082）。
//
// 她 2026-09-08：「因應出國、突發請假情境」—— 一次十幾段，走日曆要點三十幾下。
//
// 這一支走完整條路：從壓表右上角進來 → 搜尋一位 → 挑那幾段 → 確認 → 存。
// 盯的是四件事：
//
//   1. 搜尋列得出人，點一位就看得到他那個月的預約
//   2. 清單模式逐段勾、「整天選起來」一次勾一天
//   3. 確認框**列出每一段**（跨多個 commit 給不出復原，那一道就是煞車）
//   4. 存完那幾段真的暗掉，**沒被選到的那一段一個字都不動**
//   5. 確認框上的**數字要對**（同一天挑兩段時，「剩下的」不算那兩段）
//   6. 多選模式吃返回鍵（畫面上多出來一層東西，就多一筆退得掉的紀錄）

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
const D1 = `${MONTH}-11`;
const D2 = `${MONTH}-18`;

/** 一位客戶、兩天：11 號兩段、18 號一段。 */
function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-b', name: '王小明' }),
    customer({ id: 'cust-c', name: '林大同' }),
    entitlement('cust-b', {
      id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 20, bookedCount: 3, durationMin: 30,
    }),
    visit({
      id: 'v-a', customerId: 'cust-b', customerName: '王小明',
      date: D1, status: 'confirmed',
      slots: [
        slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        }),
        slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '10:00', endsAt: '10:30', equipmentId: 'eq-sis', therapistId: 'staff-zn',
        }),
      ],
    }),
    visit({
      id: 'v-b', customerId: 'cust-b', customerName: '王小明',
      date: D2, status: 'confirmed',
      slots: [
        slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-laser', therapistId: 'staff-tw',
        }),
      ],
    }),
  ];
}

async function open(app, page) {
  await app.seed(seed());
  await app.signIn('/schedule');
  await app.go('/schedule');
  // 入口跟待辦那一頁的「備忘錄」同一顆、同一個位置（她指名的）
  await page.locator('a[href="#/schedule/cancel"]').click();
  await page.waitForTimeout(700);
}

async function pickCustomer(page) {
  await page.locator('[data-q]').fill('王小明');
  await page.waitForTimeout(400);
  await page.locator('[data-pick]').first().click();
  await page.waitForTimeout(700);
}

test('搜尋一位客戶，看得到他那個月的預約', async ({ app, page }) => {
  await open(app, page);

  // 還沒打字：不列任何人
  await expect(page.locator('[data-pick]')).toHaveCount(0);

  await page.locator('[data-q]').fill('王小');
  await page.waitForTimeout(400);
  await expect(page.locator('[data-pick]')).toHaveCount(1);
  await expect(page.locator('[data-pick]')).toContainText('王小明');

  await page.locator('[data-pick]').first().click();
  await page.waitForTimeout(700);

  // 三段都列得出來（11 號兩段、18 號一段）
  await expect(page.locator('[data-slot]')).toHaveCount(3);
});

test('沒選東西時底下那一條不出現', async ({ app, page }) => {
  await open(app, page);
  await pickCustomer(page);
  await expect(page.locator('.bulkbar')).toHaveCount(0);
});

test('「整天選起來」一次勾一天，數字跟著走', async ({ app, page }) => {
  await open(app, page);
  await pickCustomer(page);

  // 11 號那一天有兩段
  await page.locator(`[data-day-all="${D1}"]`).click();
  await page.waitForTimeout(400);

  await expect(page.locator('.bulkbar__count')).toContainText('選了 2 段');
  await expect(page.locator('.bulkbar__count')).toContainText('1 天');

  // 再按一次就放掉
  await page.locator(`[data-day-all="${D1}"]`).click();
  await page.waitForTimeout(400);
  await expect(page.locator('.bulkbar')).toHaveCount(0);
});

test('挑兩段取消：確認框列出每一段，存完那兩段暗掉、第三段不動', async ({ app, page }) => {
  await open(app, page);
  await pickCustomer(page);

  // 9:00 那一段與 18 號那一段（跨兩筆來訪）
  await page.locator('[data-slot]').nth(0).click();
  await page.locator('[data-slot]').nth(2).click();
  await page.waitForTimeout(400);
  await expect(page.locator('.bulkbar__count')).toContainText('選了 2 段');

  await page.locator('[data-go]').click();
  await expect(app.dialog()).toBeVisible();

  const said = await app.dialogText();
  expect(said, '要列出每一段 —— 跨多個 commit 給不出復原，這一道就是煞車')
    .toContain('09:00');
  expect(said).toContain('14:00');
  expect(said, '後果那幾句走 cancelConsequences()').toMatch(/次數也會還回來/);

  await app.ok();
  await page.waitForTimeout(1800);

  // 剩下一段可以選（10:00 那一段），另外兩段已經取消了
  await expect(page.locator('[data-slot]'), '取消掉的那幾段不再列在可以取消的清單裡')
    .toHaveCount(1);
  await expect(page.locator('[data-slot]')).toContainText('10:00');
});

test('同一天挑兩段：確認框講的剩餘段數要對', async ({ app, page }) => {
  await open(app, page);
  await pickCustomer(page);

  // 11 號那一天有兩段，兩段都挑起來
  await page.locator(`[data-day-all="${D1}"]`).click();
  await page.waitForTimeout(400);
  await expect(page.locator('.bulkbar__count')).toContainText('選了 2 段');

  await page.locator('[data-go]').click();
  await expect(app.dialog()).toBeVisible();

  const said = await app.dialogText();
  // 那一天只有這兩段，兩段都挑了 = 整天沒了。以前這裡會說「剩下的 1 段
  // 不受影響」—— 它把同一批要取消的另一段也算成了剩下的。
  expect(said, '整天挑滿了就要講整天那種話').toContain('那一天就整筆取消了');
  expect(said, '沒有東西「不受影響」').not.toContain('不受影響');
  expect(said, '兩段就說兩段').toContain('這 2 段會退回去');

  await app.cancelDialog();
});

test('多選模式吃返回鍵，而且不會整個跳出這一頁', async ({ app, page }) => {
  await open(app, page);
  await pickCustomer(page);

  await page.locator('[data-mode="month"]').click();
  await page.waitForTimeout(500);

  // 長按進多選
  const cell = page.locator(`[data-day="${D1}"]`);
  const box = await cell.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(500);
  await expect(page.locator('.bulkhint')).toContainText('多選中');

  // 返回鍵 = 退出多選，**不是**離開這一頁
  await page.goBack();
  await page.waitForTimeout(600);

  await expect(page.locator('.bulkhint'), '多選那一層要被返回鍵收掉').toHaveCount(0);
  expect(page.url(), '人還在這一頁').toContain('#/schedule/cancel');
  await expect(page.locator('[data-day]'), '月曆還在').not.toHaveCount(0);
});

test('月曆模式：點一天攤開那一天，長按進多選', async ({ app, page }) => {
  await open(app, page);
  await pickCustomer(page);

  await page.locator('[data-mode="month"]').click();
  await page.waitForTimeout(500);

  // 有預約的那兩天按得下去，其餘按不下去
  await expect(page.locator('[data-day]')).toHaveCount(2);

  // 點一天 → 攤開那一天的兩段
  await page.locator(`[data-day="${D1}"]`).click();
  await page.waitForTimeout(500);
  await expect(page.locator('.bulkday--open [data-slot]')).toHaveCount(2);

  // 長按 → 進多選，而且那一天整天先選起來
  const cell = page.locator(`[data-day="${D2}"]`);
  const box = await cell.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
  await page.waitForTimeout(500);

  await expect(page.locator('.bulkhint'), '模式變了要看得出來').toContainText('多選中');
  await expect(page.locator('.bulkbar__count')).toContainText('選了 1 段');

  // 多選中點另一天 = 整天選起來
  await page.locator(`[data-day="${D1}"]`).click();
  await page.waitForTimeout(400);
  await expect(page.locator('.bulkbar__count')).toContainText('選了 3 段');
});
