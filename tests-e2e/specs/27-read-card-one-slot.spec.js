// 另外三頁也改成「點哪一段就看哪一段」（`.scratch/quieter-screens/issues/10`）。
//
// 她 2026-09-10：
//
// > d 如果真的像是，看這個月進度或是像是待辦任務例如examine那邊點人名進去，
// > 會呈現一整天的時段，那能不能除了先呈現那一天的時段以及那一天的待辦，
// > 也要可以個別時段都可以點，知道那個時段的詳情，但是我還是希望大部分
// > 都先改成呈現這一段的詳情而不是這一整天的
//
// 日曆從 2026-09-08 起就是這個行為（ADR-0080）—— 那一列帶著段落序號。
// 另外三頁一直走 `slotsToShow()` 的退路「沒指定就是全部」，而那幾段畫成
// `<div>`：**不是按鈕、沒有 data-open、沒有任何 listener**。
//
// 這一支盯的是那三頁真的點得下去（單元那一側全部是原始碼掃描 ——
// `ui/views/calendar.js` 進不了 node），以及它連帶收掉的兩個落差：
//
//   * 卡片副標印的是**那一段**的狀態（ADR-0085）。整筆那一個是推導出來的，
//     她加一段沒問過客人的進去就會退回「待確認」
//   * 來訪編輯器帶了 slotIndex 時，「這一天整筆的」那一摺**整塊不存在**
//     （以前只是收起來，而 ADR-0085 寫的是沒有）。第二條路是日曆讀取卡片
//     底下那一顆「改這一天」（ADR-0060）——— **那一顆 2026-09-12 拿掉了**（ADR-0089）

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const DAY = TODAY;

/**
 * 一位客戶、同一天兩段，而且**兩段的狀態不一樣**。
 *
 * 早上那一段已經談定、下午那一段還沒問過客人 —— 這正是 ADR-0085 講的那個
 * 落差會現形的形狀：整筆推導出來的是「待確認」，而她點的是早上那一段。
 */
function seedTwoSlots() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '王小明' }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser', 'eq-ilib'],
      totalQty: 20, bookedCount: 2, durationMin: 30,
    }),
    visit({
      id: 'v-two', customerId: 'cust-x', customerName: '王小明',
      date: DAY, status: 'pending_confirm',
      slots: [
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba',
            therapistId: 'staff-tw',
          }),
          status: 'confirmed',
        },
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-sis',
            therapistId: 'staff-zn',
          }),
          status: 'pending_confirm',
        },
      ],
    }),
  ];
}

// **2026-09-12 起這一頁不必先看整天**（ADR-0089）：每一段自己是一顆按鈕，
// 點下去就直接是那一段（她：「盡量能讓使用者一開始分段點就分段點」）。
// 「先看到那一天有哪幾段」那一層還在，只是那一張變成純目錄，而且要從
// 待辦中心那條「點人名」的路才走得到 —— 那一層在 `29-slot-first` 的 S2。
test('看這個月進度：點哪一段就直接看哪一段', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  // 點下午那一段
  await page.locator('[data-visit="v-two"][data-slot="1"]').click();
  await app.layer('.popcard');

  const one = page.locator('.popcard');
  await expect(one.locator('.readslot'), '只該畫她點的那一段').toHaveCount(1);
  await expect(one.locator('.readslot')).toContainText('14:00');
  await expect(one, '不該看到早上那一段').not.toContainText('09:00');
  // 只有一段的時候那一列點不下去 —— 再點一次只會重開一張一模一樣的
  await expect(one.locator('.readslot[data-open]'), '她已經指名了，不必再點').toHaveCount(0);
});

// ADR-0085：整筆那一個是**推導出來的**（`visitStatusFrom()`）。這一筆是
// 「一段已確認 ＋ 一段待確認」，所以整筆推出來是待確認 —— 而她點的是
// 早上那段已經談定的。
test('副標印的是那一段的狀態，不是整筆推導出來的', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  // 早上那一段已經談定、下午那一段還沒問過 —— 整筆推出來是「待確認」
  await page.locator('[data-visit="v-two"][data-slot="0"]').click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard__sub'), '她點的是早上那段已經談定的')
    .toContainText('客戶已確認');

  await page.locator('[data-card-close]').click();
  await expect(page.locator('.popcard')).toHaveCount(0);
  await page.locator('[data-visit="v-two"][data-slot="1"]').click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard__sub'), '下午那一段還沒問過客人')
    .toContainText('已壓表，等客戶回覆');
});

// ADR-0056：改得動一筆來訪的只有日曆。三頁一起長出可以點的一列，
// **不可以順手長出一支鉛筆**。
test('進度追蹤點到最後一段也沒有鉛筆', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  await page.locator('[data-visit="v-two"][data-slot="1"]').click();
  await app.layer('.popcard');

  await expect(page.locator('.popcard [data-card-edit]'), '這一頁是唯讀的').toHaveCount(0);
  await expect(page.locator('.popcard [data-edit-day]'), '「改這一天」也只在日曆上').toHaveCount(0);
});

/** 日曆的抽屜，點第 n 列。那一列本來就帶著段落序號（ADR-0080）。 */
async function openVisitCardOnCalendar(app, page, index) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  await page.locator('[data-open^="visit:v-two:"]').nth(index).click();
  await app.layer('.popcard');
}

// ADR-0085 白紙黑字：帶了 slotIndex 就**沒有**整筆的狀態卡與危險區。
// 以前程式只是把它們收進一摺（`<details>` 不加 open）—— 摺起來不算拿掉。
test('從日曆點一段按鉛筆：畫面上找不到整天的狀態卡與刪除', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await openVisitCardOnCalendar(app, page, 0);

  await page.locator('.popcard [data-card-edit]').click();
  await app.layer('[data-form]');

  await expect(page.locator('[data-delete]'), '刪除動的是那一天全部').toHaveCount(0);
  await expect(page.locator('[data-status]'), '狀態按鈕動的也是那一天全部').toHaveCount(0);
  await expect(page.locator('.advanced__head'), '摺起來不算拿掉').toHaveCount(0);

  // 抬頭那顆 badge 印的是**那一段**的（她點的是早上那段已經談定的）
  await expect(page.locator('.row__title .badge').first()).toContainText('客戶已確認');
});

// **2026-09-12：整天那一張沒有入口了**（ADR-0089）。她：「並且也不需要出現
// 改這一整天的按鈕，如果要改我也會一項一項改」，而追問「改整天的日期」與
// 「刪除這一天」要不要留路時回答「整個拿掉，兩件事都不要了」。
test('讀取卡片底下沒有「改這一天」，鉛筆開的那一張也沒有整天那幾顆', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await openVisitCardOnCalendar(app, page, 0);

  await expect(page.locator('.popcard [data-edit-day]'), '那一顆拿掉了').toHaveCount(0);

  await page.locator('.popcard [data-card-edit]').click();
  await app.layer('[data-form]');

  await expect(page.locator('[data-delete]'), '刪除這一天沒有路了').toHaveCount(0);
  await expect(page.locator('[data-status]'), '整天的狀態卡也不在了').toHaveCount(0);
  await expect(page.locator('[data-form] .slothead'), '鉛筆開的只有那一段').toHaveCount(1);
});
