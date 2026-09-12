// 「記一句」那一塊本身。四個入口共用同一支（`ui/components/slotNote.js`），
// 所以它壞掉的時候是四個地方一起壞 —— 而這一支從瀏覽器那一端問。
//
// ## 為什麼要有這一支
//
// 2026-09-12 她回報：在「跟客人確認時間」點記一句，跳出來的是
// 「（沒有名字）的 0 段」那張確認面板，而且**她打的字一個都沒存進去**。
//
// 原因跟記一句本身無關：那一塊的外框把展開狀態記成 `data-open="false"`，
// 而那一頁的 `data-open` 指的是「這一列是哪位客戶」（`wireConfirm()` 用
// `querySelectorAll('[data-open]')` 接線）。她點進輸入框那一下冒泡上去，
// 那一頁就以為她按了某位客戶的確認鈕。
//
// **單元測試那一側是原始碼掃描**（`tests/slot-note.test.js`：元件不可以寫裸的
// `data-open`）。掃描擋得住「有人又把那個名字寫回去」，擋不住「名字改了、
// 但接線那一端另外長出同樣的形狀」。所以這一支真的去點。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

/** 一位客戶、一筆還沒問過本人的來訪 —— 剛好夠「跟客人確認時間」長出一列。 */
function seedPending() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-rehab', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['equip-indiba', 'equip-magnet', 'equip-laser'],
    }),
    visit({
      id: 'visit-a-pending', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, 5), status: 'pending_confirm',
      slots: [slot({
        courseId: 'course-rehab', entitlementId: 'ent-a-rehab',
        startsAt: '10:30', endsAt: '11:30', equipmentId: 'equip-indiba',
        therapistId: 'staff-t1',
      })],
    }),
  ];
}

test('N1 確認那一頁記一句：不會跳出確認面板，而且字真的存進去', async ({ app, page }) => {
  await app.seed(seedPending());
  await app.signIn('/todo/confirm');
  await expect(page.locator('#view')).toContainText('客戶A');

  // 點夾板展開
  await page.locator('[data-slotnote-toggle="fnote-cust-a"]').click();
  const box = page.locator('[data-followup="cust-a"]');
  await expect(box).toBeVisible();

  // **這一下以前會跳出那張確認面板**（「的 0 段」）。
  const field = box.locator('input[name="text"]');
  await field.click();
  await expect(
    page.locator('.drawer-backdrop'),
    '點進輸入框不可以打開確認面板 —— 那一頁的 [data-open] 是「哪位客戶」',
  ).toHaveCount(0);

  await field.fill('禮拜一再問問');
  await box.locator('button[type="submit"]').click();
  await app.saved();

  const saved = await app.readDoc('visits', 'visit-a-pending');
  expect(saved.followupNote, '那一句要真的寫進去').toBe('禮拜一再問問');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});
