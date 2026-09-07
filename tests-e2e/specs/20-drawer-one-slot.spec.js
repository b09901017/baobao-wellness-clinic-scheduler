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
//   3. 按了「看全部」才三段都出來
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

  // 「這天他還來做什麼」是她會問的問題，所以要留一條看得到的路
  const more = card.locator('[data-showall]');
  await expect(more).toContainText('還有另外 2 段');
  await more.click();
  await expect(card.locator('.readslot'), '按了「看全部」才三段都出來').toHaveCount(3);
  await expect(card.locator('[data-showall]'), '全部都畫出來之後那一行要消失').toHaveCount(0);
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

// ADR-0060：長按一列＝直接做。但那幾顆動的是**整筆**來訪，而她長按的是一列。
// 這一句話比事後復原便宜得多（她 2026-09-08 說的「誤觸改動」）。
test('長按一列，選單要講清楚底下那幾顆動的是整筆', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  const row = page.locator('[data-open^="visit:v-three:"]').first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  // **用真的滑鼠事件**：`wireLongPress()` 只認 `isPrimary` 的主鍵，
  // `dispatchEvent('pointerdown')` 造出來的那一顆過不了那道門。
  // 按住要超過 `HOLD_MS`（450），中間不可以動超過 SLOP（8px）。
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.waitForTimeout(900);
  await page.mouse.up();

  await expect(page.locator('.actions__sub')).toContainText('這一天共 3 段');
});
