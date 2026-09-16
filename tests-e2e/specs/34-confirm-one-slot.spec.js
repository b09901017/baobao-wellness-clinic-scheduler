// 「確認」也是逐段的（ADR-0097，2026-09-16）。
//
// 她的原話：
//
// > 如果在新增同一個人兩段來訪，然後我只長按其中一段，說客戶已確認，會變成
// > 整天的都變成已確認，能不能我那個時段說確認就那個時段確認就好，然後如果
// > 我想要一次確認整天，我可以去代辦那邊做，然後我這邊確認了某個時段
// > 客戶已確認後 待辦那邊的這個時段就可以收掉
//
// > 我發現這一項代辦，的跟客人確認時間沒有寫的符合事實，也就是如果這天A
// > 已經有兩個已確認的時段如果我新增一個來訪 那原本已確認的那兩個的那一項的
// > 待辦中的跟客人確認時間 就會被取消打勾？
//
// 單元那一側（`tests/visits.test.js`、`tests/todo-flow.test.js`、`tests/tasks.test.js`）
// 問的是「domain 算得對嗎」。這一支從瀏覽器問「接線那一端真的把 slotIndex
// 傳下去了嗎」—— 2026-09-16 之前壞的正是接線：`applyStatus()` 早就收 slotIndex，
// 只有取消那一條路傳了。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const DAY = TODAY;

/**
 * 一位客戶、同一天兩段：上午一段 A 類（復健科醫師門診），下午一段 C 類（復能）。
 *
 * **兩個類別不一樣是刻意的**：A 類確認之後會長 Examine 與耀聖，C 類不會
 * （`RULES`）。同類的話「只有那一段的掛號長出來」就測不到。
 */
function seedTwoSlots({ first = 'pending_confirm', second = 'pending_confirm' } = {}) {
  const v = {
    id: 'v-two', customerId: 'cust-x', customerName: '王小明',
    date: DAY,
    slots: [
      { ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt: '09:00', endsAt: '09:30' }), status: first },
      {
        ...slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        }),
        status: second,
      },
    ],
  };
  // 整筆那一格是**推導出來又存起來的**（ADR-0081）：由「還沒定案」往「定案」比。
  const status = [first, second].includes('pending_confirm') ? 'pending_confirm' : 'confirmed';
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '王小明' }),
    entitlement('cust-x', {
      id: 'ent-rehab', label: '復健科醫師門診', type: 'single',
      courseId: 'course-rehab', totalQty: 6, bookedCount: 1, durationMin: 30,
    }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 20, bookedCount: 1, durationMin: 30,
    }),
    visit({ ...v, status, confirmedAt: status === 'confirmed' ? new Date().toISOString() : null }),
  ];
}

/** 那一天的抽屜。`[data-day]` 只在月檢視的格子上，所以不切檢視（同 spec 20）。 */
async function openDayDrawer(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
}

/**
 * 長按第 n 列。用真的滑鼠事件 —— `wireLongPress()` 只認 `isPrimary` 的主鍵
 *（同 spec 20 的 `longPressRow()`）。
 */
async function longPressRow(page, index) {
  const row = page.locator('[data-open^="visit:v-two:"]').nth(index);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

// ---------- 01：長按那一段說確認，只確認那一段 ----------

test('C1 長按上午那一段說「客戶說可以」，下午那一段還是待確認', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  // 一列的 class 是 `statusClass()` 給的，而它讀的是 `slotStatus()`（ADR-0081）。
  // **這一條就是她報的那個 bug**：2026-09-16 之前兩列都會變成 `status-confirmed`。
  const rows = page.locator('[data-open^="visit:v-two:"]');
  await expect(rows).toHaveCount(2);
  await expect(
    page.locator('.timerow.status-confirmed'),
    '只有她長按的那一段談定了',
  ).toHaveCount(1);
  // **class 是 `statusClass()` 給的**，而 `pending_confirm` 那一個叫
  // `status-pending`（`STATUS_VIEW`）—— 不是狀態字串本身。
  await expect(
    page.locator('.timerow.status-pending'),
    '下午那一段一個字都沒動',
  ).toHaveCount(1);
});

test('C2 已經談定的那一段，長按選單上沒有「客戶說可以」', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  // 整筆是「待確認」（下午那一段還沒問），但上午那一段自己已經談定了。
  await longPressRow(page, 0);
  await expect(
    page.locator('.drawer--actions'),
    '那一段已經談定了 —— 拿整筆的狀態問會在這裡長出一顆',
  ).not.toContainText('客戶說可以');

  // 「先不要，回去」不是一列，是選單自己那一顆（`actions.js` 的 `[data-actions-close]`）
  await page.locator('[data-actions-close]').click();
  await expect(page.locator('.drawer--actions')).toHaveCount(0);

  await longPressRow(page, 1);
  await expect(
    page.locator('.drawer--actions'),
    '下午那一段還沒問過客人',
  ).toContainText('客戶說可以');
});

// ---------- 02：讀取卡片上那兩列照那一段算 ----------

test('C3 讀取卡片：談定那一段的「跟客人確認時間」打勾，沒問的那一段沒有', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  const rows = page.locator('[data-open^="visit:v-two:"]');

  await rows.nth(0).click();
  await app.layer('.popcard');
  const done = page.locator('.taskmirror__row', { hasText: '跟客人確認時間' });
  await expect(done, '那一段早就談定了').toHaveClass(/is-done/);

  // 那張卡用它自己那顆 ×（`card.js` 的 `[data-card-close]`）。關掉之後底下
  // 那張抽屜還在 —— `openDayDrawer()` 會重新 `go('/calendar')`，那一下會被
  // 還沒關掉的卡片擋住。
  await page.locator('[data-card-close]').click();
  await expect(page.locator('.popcard')).toHaveCount(0);

  await page.locator('[data-open^="visit:v-two:"]').nth(1).click();
  await app.layer('.popcard');
  await expect(
    page.locator('.taskmirror__row', { hasText: '跟客人確認時間' }),
    '這一段還沒問過 —— 整筆退回待確認不可以害另一段跟著退回',
  ).not.toHaveClass(/is-done/);
});

// ---------- 03：待辦中心的確認抽屜只列還沒談定的那幾段 ----------

test('C4 待辦中心：談定的那一段收掉了，抽屜裡只剩沒問過的那一段', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/');
  await app.go('/todo/confirm');
  await app.settled();

  // 她的原話：「我這邊確認了某個時段客戶已確認後 待辦那邊的這個時段就可以收掉」
  await expect(page.locator('.card', { hasText: '王小明' })).toContainText('壓了 1 段');

  await page.locator('[data-open="cust-x"]').click();
  await expect(page.locator('.drawer-backdrop .drawer')).toBeVisible();

  const slots = page.locator('.drawer .slotrow');
  await expect(slots, '談定的那一段不再列出來').toHaveCount(1);
  await expect(slots.first()).toContainText('14:00');
  await expect(page.locator('.drawer'), '上午那一段已經談定了').not.toContainText('09:00');
});

// ---------- 04：那一段確認了，那一段的掛號才長出來 ----------

test('C5 確認 C 類那一段不長掛號，確認 A 類那一段才長', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  // 先確認下午那一段（C 類，`onConfirm` 是空的）
  await longPressRow(page, 1);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  await app.go('/');
  await app.settled();
  await expect(page.locator('body'), 'C 類確認之後沒有後續登記').not.toContainText('Examine');

  // 再確認上午那一段（A 類）
  await openDayDrawer(app, page);
  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  await app.go('/');
  await app.settled();
  // 2026-09-16 之前閘門看整筆：下午那一段還沒確認時整筆停在待確認，
  // 上午那一段的掛號一張都不長 —— 而她已經可以去 Abovee 壓那一格了。
  await expect(page.locator('body'), 'A 類那一段確認了就該長').toContainText('Examine');
  await expect(page.locator('body')).toContainText('耀聖');
});
