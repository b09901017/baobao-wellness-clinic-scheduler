// 點一段，只看那一段。
//
// 她 2026-09-08：
//
// > 我如果同一天建立客戶A INDIBA以及ILIB…我在日曆點開詳情的時候，
// > 為甚麼我點的是復能(INDIBA)，但是卻會一次呈現三個
//
// 排班的原子單位是**來訪**（SPEC 第 4.4 節），所以同一位客戶同一天壓三次
// 在資料庫上是一筆來訪三個時段。這一支盯的是三件事：
//
//   1. 日檢視上那一天是**三列**（一段一列）
//   2. 點第二列，卡片上**只有第二段**，而且講得出「還有另外 2 段」
//   3. 那一行**整個拿掉** —— 她 2026-09-08 說「純粹且僅呈現該時段課程的資訊」，
//      而她指名要修的是「顯示『這一天還有另外 n 段 - 看全部』的多餘行為」。
//      第一版只拿掉了按鈕、留著那一行字；那一行也是（ADR-0080 第三點）
//
// 加上月檢視那一格是**三條色條**（2026-09-08 她主動要的），
// 以及長按那一列時，選單抬頭要講清楚底下那幾顆動的是**整筆**。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const DAY = TODAY;

/** 一位客戶、同一天三段：INDIBA、SIS，以及一段單買的 ILIB。 */
function seedThreeSlots() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '王小明' }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser', 'eq-ilib'],
      totalQty: 20, bookedCount: 2, durationMin: 30,
    }),
    entitlement('cust-x', {
      id: 'ent-ilib', label: 'ILIB（60）', type: 'single', courseId: 'course-iv-laser',
      totalQty: 10, bookedCount: 1, durationMin: 60,
    }),
    visit({
      id: 'v-three', customerId: 'cust-x', customerName: '王小明',
      date: DAY, status: 'confirmed',
      slots: [
        slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba',
          therapistId: 'staff-tw',
        }),
        slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '10:00', endsAt: '10:30', equipmentId: 'eq-sis',
          therapistId: 'staff-zn',
        }),
        slot({
          courseId: 'course-iv-laser', entitlementId: 'ent-ilib',
          startsAt: '11:00', endsAt: '12:00', roomId: 'room-t2',
        }),
      ],
    }),
  ];
}

/**
 * 那一天的抽屜。**`[data-day]` 只存在於月檢視的格子上** —— 切到日檢視之後
 * 那個屬性整個不見（日檢視畫的是時間軸，不是格子），所以這裡不切檢視。
 *
 * 抽屜裡那一份清單跟日檢視是同一支 `dayHtml()`，所以要盯的東西一模一樣。
 */
async function openDayDrawer(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await page.waitForTimeout(700);
}

test('同一天三段：一段一列，點哪一列就只看哪一段', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  const rows = page.locator('[data-open^="visit:v-three:"]');
  await expect(rows, '一筆來訪三個時段要畫成三列').toHaveCount(3);

  // 點第二列（SIS 那一段）
  await rows.nth(1).click();
  await page.waitForTimeout(700);

  const card = page.locator('.popcard');
  await expect(card).toBeVisible();
  await expect(card.locator('.readslot'), '只該畫她點的那一段').toHaveCount(1);
  await expect(card.locator('.readslot')).toContainText('10:00');
  await expect(card, '點的是 SIS 那一段，不該看到 09:00 那一段').not.toContainText('09:00');
  await expect(card, '也不該看到 11:00 那一段').not.toContainText('11:00');

  // 「這一天還有另外 2 段」那一行也拿掉了 —— 她的原話講的是整個行為多餘，
  // 不只是那顆按鈕（2026-09-08）
  await expect(card.locator('.readmore'), '那一行拿掉了').toHaveCount(0);
  await expect(card.locator('[data-showall]'), '「看全部」拿掉了').toHaveCount(0);
  await expect(card, '一個字都不要提到另外那幾段').not.toContainText('還有另外');
  await expect(card.locator('.readslot'), '那一張卡從頭到尾只有一段').toHaveCount(1);
});

// 她 2026-09-08：「會顯示『這一天的代辦』但其實不是這一天，現在已經是一項
// 一項分開來看了，所以應該要叫做這一項的代辦之類的」
test('點一段時，那一塊的抬頭是「這一項的待辦」', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await page.locator('[data-open^="visit:v-three:"]').nth(1).click();
  await page.waitForTimeout(900);

  await expect(page.locator('.taskmirror__head')).toContainText('這一項的待辦');
});

test('月檢視一段一條，而且印得出那一段是哪一台', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await app.go('/calendar');

  // 月檢視是預設的那一種
  const bars = page.locator('.monthbar');
  await expect(bars.filter({ hasText: '王小明' }), '三段畫三條').toHaveCount(3);
  await expect(bars.filter({ hasText: 'IN' }).first()).toBeVisible();
  await expect(bars.filter({ hasText: 'SIS' }).first()).toBeVisible();
  await expect(bars.filter({ hasText: 'IL' }).first()).toBeVisible();
});

/**
 * 長按第 n 列。
 *
 * **用真的滑鼠事件**：`wireLongPress()` 只認 `isPrimary` 的主鍵，
 * `dispatchEvent('pointerdown')` 造出來的那一顆過不了那道門。
 * 按住要超過 `HOLD_MS`（450），中間不可以動超過 SLOP（8px）。
 */
async function longPressRow(page, index) {
  const row = page.locator('[data-open^="visit:v-three:"]').nth(index);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();
}

// ADR-0060：長按一列＝直接做。ADR-0081 之後那一列真的只動那一段，
// 所以抬頭講的是**她長按的是哪一段**，不再是「底下這幾顆動的是整筆」
//（那一句是在替 ADR-0080 第四點那個 bug 道歉）。
test('長按一列，選單講得出她按的是哪一段', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await longPressRow(page, 0);

  await expect(page.locator('.actions__sub')).toContainText('第 1 段（共 3 段）');

  const menu = page.locator('.drawer--actions');
  await expect(menu, '要有只取消那一段的那一顆').toContainText('取消這一段');
  await expect(menu, '整天那一顆也要留著，而且說得出幾段').toContainText('取消一整天（3 段）');
});

// 她 2026-09-08：「僅能取消被選中的該筆時段來訪，嚴禁一次連帶將該客戶
// 當天的所有時段預約全部取消！」（ADR-0081）
test('取消這一段，那一天剩下的兩段一個字都不動', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  // 第二列是 SIS 那一段
  await longPressRow(page, 1);
  await page.locator('.actionrow', { hasText: '取消這一段' }).click();

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '一個字都不要提整天的段數').not.toMatch(/3 個時段/);
  expect(said, '要講出剩下幾段不受影響').toMatch(/剩下的 2 段/);
  await app.ok();

  // 存完之後 `refreshAfterAction()` 會**自己把同一天的抽屜開回來**
  //（她在日曆上的心裡狀態是「就是那一天」，ADR-0020），所以這裡不要再點一次
  // —— 那一下會被還在的灰底擋掉。
  await page.waitForTimeout(1500);

  // 三列都還在（取消掉的那一段畫出來但暗掉，ADR-0061），
  // 而只有一列是取消掉的那一種。
  const rows = page.locator('[data-open^="visit:v-three:"]');
  await expect(rows, '取消一段不可以讓那一列消失').toHaveCount(3);
  // 一列的 class 是 `statusClass()` 給的（`.timerow.status-cancelled`）
  await expect(
    page.locator('.timerow.status-cancelled'),
    '只有她點的那一段暗掉，另外兩段照舊',
  ).toHaveCount(1);
});
