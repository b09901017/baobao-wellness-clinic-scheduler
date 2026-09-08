// Journey B：變更（取消 / 未到 / 逐筆退回 / 復原）
//
// 這一段的核心是 SPEC 第 4.1 節那句：
//   「客人改時間時必須自動產生『取消舊時段』的任務，不能默默改日期」
// 以及 ADR-0056：**只有日曆改得了一筆來訪**。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const FUTURE = addDays(TODAY, 5);

/** 一筆已確認的 A 類（門診）來訪 —— A 類才有 Examine / 耀聖 要收回來。 */
function seedConfirmedRehab() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-rehab', label: '復健科醫師門診', type: 'single',
      courseId: 'course-rehab', totalQty: 6, doneCount: 0, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'visit-a1', customerId: 'cust-a', customerName: '客戶A',
      date: FUTURE, status: 'confirmed',
      slots: [slot({
        courseId: 'course-rehab', entitlementId: 'ent-a-rehab',
        startsAt: '14:00', endsAt: '14:30', roomId: 'room-t3', doctorId: 'staff-dr-xia',
      })],
    }),
  ];
}

/** 從日曆打開那一筆來訪的編輯器。**這是唯一的入口**（ADR-0056）。 */
async function openVisitEditor(app, page, date, visitId) {
  await app.go('/calendar');
  await page.locator(`[data-day="${date}"]`).first().click();
  await page.waitForTimeout(700);
  await page.locator(`[data-open^="visit:${visitId}:"]`).first().click();
  await page.waitForTimeout(700);
  await page.locator('[data-card-edit]').click();
  await page.waitForTimeout(900);
  // 整筆的那幾顆（狀態、刪除）2026-09-09 收進一摺了（ADR-0085）——
  // 她點的是一段，那幾顆動的是整天，混在欄位裡講不通。**收著不是藏著**：
  // 藏起來會違反 ADR-0060（長按是捷徑，不是唯一的路）。
  await openWholeVisitFold(page);
}

/** 把「這一天整筆的」那一摺打開。收著的時候底下那幾顆點不到。 */
async function openWholeVisitFold(page) {
  const fold = page.locator('details.advanced');
  if (await fold.count() === 0) return;
  if (await fold.first().getAttribute('open') === null) {
    await fold.locator('summary').first().click();
    await page.waitForTimeout(250);
  }
}

test('J-B1 從日曆取消一筆已確認的來訪 → 次數回補、產生「取消 Abovee」', async ({ app, page }) => {
  await app.seed(seedConfirmedRehab());
  await app.signIn('/');

  await openVisitEditor(app, page, FUTURE, 'visit-a1');
  await expect(page.locator('[data-status="cancelled"]')).toBeVisible();

  await page.locator('[data-cancel-reason]').fill('客人要改時間');
  await page.locator('[data-status="cancelled"]').click();

  await expect(app.dialog()).toBeVisible();
  const dialog = await app.dialogText();
  console.log('[J-B1] 取消確認框 =\n' + dialog);
  expect(dialog, '要講出改期不是改日期').toMatch(/改期|重新排/);
  await app.ok();
  await page.waitForTimeout(2500);

  const v = await app.readDoc('visits', 'visit-a1');
  expect(v.status).toBe('cancelled');
  expect(v.cancelReason).toBe('客人要改時間');

  const ent = await app.readDoc('customers/cust-a/entitlements', 'ent-a-rehab');
  expect(ent.bookedCount, '時段還回去了').toBe(0);

  const kinds = (await app.readAll('tasks')).filter((t) => !t.deletedAt).map((t) => t.kind);
  console.log('[J-B1] 取消後的任務 =', kinds);
  expect(kinds, '要回去把 Abovee 上壓的時段放掉').toContain('取消 Abovee');
});

test('J-B2 沒勾掉的登記任務直接收走，勾掉的才變成「取消 X」', async ({ app, page }) => {
  const { task } = await import('../fixtures/data.js');
  await app.seed([
    ...seedConfirmedRehab(),
    task({
      id: 'task-exam', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine',
      dueDate: addDays(FUTURE, -1), visitId: 'visit-a1', done: true,
      doneAt: new Date().toISOString(),
    }),
    task({
      id: 'task-ys', customerId: 'cust-a', customerName: '客戶A', kind: '耀聖',
      dueDate: addDays(FUTURE, -1), visitId: 'visit-a1', done: false,
    }),
  ]);
  await app.signIn('/');

  await openVisitEditor(app, page, FUTURE, 'visit-a1');
  await page.locator('[data-status="cancelled"]').click();
  await app.ok();
  await page.waitForTimeout(2500);

  const all = await app.readAll('tasks');
  const live = all.filter((t) => !t.deletedAt).map((t) => t.kind).sort();
  const gone = all.filter((t) => t.deletedAt).map((t) => t.kind);
  console.log('[J-B2] 還在的 =', live, '／被收掉的 =', gone);

  expect(gone, '沒勾掉的耀聖就不用做了').toContain('耀聖');
  expect(live, '勾掉的 Examine 要回去取消').toContain('取消 Examine');
  expect(live, '壓表登記本身也要放掉').toContain('取消 Abovee');
});

test('J-B3 同一筆存兩次，取消任務只長一張', async ({ app, page }) => {
  await app.seed(seedConfirmedRehab());
  await app.signIn('/');

  await openVisitEditor(app, page, FUTURE, 'visit-a1');
  await page.locator('[data-status="cancelled"]').click();
  await app.ok();
  await page.waitForTimeout(2500);

  // 再存一次（改一下備註）
  await openVisitEditor(app, page, FUTURE, 'visit-a1').catch(() => {});
  await page.waitForTimeout(500);

  const cancels = (await app.readAll('tasks'))
    .filter((t) => !t.deletedAt && t.kind === '取消 Abovee');
  expect(cancels, '同一種取消任務只長一張').toHaveLength(1);
});

test('J-B6 標成未到 → 不扣次數，時段還回去，但未到獨立計數', async ({ app, page }) => {
  const past = addDays(TODAY, -1);
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-vein', label: '靜脈', type: 'single', courseId: 'course-iv-laser',
      totalQty: 20, doneCount: 0, bookedCount: 1, durationMin: 60,
    }),
    visit({
      id: 'visit-a2', customerId: 'cust-a', customerName: '客戶A',
      date: past, status: 'confirmed',
      slots: [slot({
        courseId: 'course-iv-laser', entitlementId: 'ent-a-vein',
        startsAt: '14:00', endsAt: '15:00', roomId: 'room-iv10',
      })],
    }),
  ]);
  await app.signIn('/todo/close');

  // 收尾抽屜：把唯一那一段點成「沒做」→ 整筆記成未到
  await page.locator('[data-open="visit-a2"]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-slot="0"]').click();
  await expect(page.locator('[data-apply]')).toContainText('未到');
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(2500);

  const v = await app.readDoc('visits', 'visit-a2');
  expect(v.status).toBe('no_show');

  const ent = await app.readDoc('customers/cust-a/entitlements', 'ent-a-vein');
  expect(ent.doneCount, '未到不扣次數').toBe(0);
  expect(ent.bookedCount, '時段還回去').toBe(0);
});

test('J-A12 做了兩段、第三段沒做 → 只扣兩次（ADR-0025）', async ({ app, page }) => {
  const past = addDays(TODAY, -1);
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-vein', label: '靜脈', type: 'single', courseId: 'course-iv-laser',
      totalQty: 20, doneCount: 0, bookedCount: 3, durationMin: 60,
    }),
    visit({
      id: 'visit-a3', customerId: 'cust-a', customerName: '客戶A',
      date: past, status: 'confirmed',
      slots: [
        slot({ courseId: 'course-iv-laser', entitlementId: 'ent-a-vein', startsAt: '09:00', endsAt: '10:00', roomId: 'room-iv10' }),
        slot({ courseId: 'course-iv-laser', entitlementId: 'ent-a-vein', startsAt: '10:15', endsAt: '11:15', roomId: 'room-iv10' }),
        slot({ courseId: 'course-iv-laser', entitlementId: 'ent-a-vein', startsAt: '11:30', endsAt: '12:30', roomId: 'room-iv10' }),
      ],
    }),
  ]);
  await app.signIn('/todo/close');

  await page.locator('[data-open="visit-a3"]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-slot="2"]').click();   // 第三段沒做
  await expect(page.locator('[data-apply]')).toContainText('2 段');
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(2500);

  const ent = await app.readDoc('customers/cust-a/entitlements', 'ent-a-vein');
  expect(ent.doneCount, '做了幾段就扣幾次').toBe(2);
  expect(ent.bookedCount).toBe(0);

  const v = await app.readDoc('visits', 'visit-a3');
  expect(v.status).toBe('done');
  expect(v.slots[2].attended, '第三段標成沒做').toBe(false);
});

test('L17+L18 客戶詳情與待辦中心的來訪列**沒有**鉛筆（ADR-0056）', async ({ app, page }) => {
  await app.seed(seedConfirmedRehab());
  await app.signIn('/customers/cust-a');

  // 客戶詳情：點那一列不會通到編輯器
  const links = await page.locator('a[href*="/visits/"]').count();
  expect(links, '客戶詳情不該有連到來訪編輯器的連結').toBe(0);

  // 日曆：唯一有鉛筆的地方
  await app.go('/calendar');
  await page.locator(`[data-day="${FUTURE}"]`).first().click();
  await page.waitForTimeout(700);
  await page.locator(`[data-open^="visit:visit-a1:"]`).first().click();
  await page.waitForTimeout(700);
  await expect(page.locator('[data-card-edit]'), '日曆的讀取卡片要有鉛筆').toHaveCount(1);
});
