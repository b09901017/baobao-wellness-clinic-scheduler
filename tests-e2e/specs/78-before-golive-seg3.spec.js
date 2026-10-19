// 上線前補的那一輪，段三（.scratch/before-golive-2026-10-19/ 的 09、10、11）。
//
// 11：待辦首頁「明天」也算明天要簽的療程單（ADR-0162，推翻 ADR-0152 那一格）。她：「但我想要今天和明天是一樣的誒，
//     就是納入簽療程單」—— 點下去開讀取卡片，**不開簽單抽屜**（「免得還沒做就被簽成做完」）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, note, TODAY, addDays,
} from '../fixtures/data.js';

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
