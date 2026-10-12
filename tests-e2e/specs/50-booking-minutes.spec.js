// 約的時候選時長（2026-10-05，issue 06，ADR-0122）。
//
// 她的原話：
//
// > 時長：SIS／IN／高能量／ILIB／二返／n返 是 30、60；EECP 是 20、60
// > 1. 是，約的時候選，預設 30。拍照時照 Abovee 那一格（二返60 就記 60）
//
// 算法（哪一層贏、存什麼）在 domain，`tests/booking-minutes.test.js` 盯著。這一支從瀏覽器問：
// 壓表與來訪編輯器真的有那一排、選了 60 日曆上是一小時而且寫 `二返(60)`、
// 之後只改別的東西它不會掉回 30、改期也帶著走。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, addDays, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;
const EXAM_DAY = addDays(TODAY, -10);

/** 做完一次健檢、二返還沒約；身上另有一筆復能(30)（買的時候分的那一種，拿來對照）。 */
const base = (extra = []) => [
  ...masterDocs(),
  customer({ id: 'cust-m', name: '王小明' }),
  entitlement('cust-m', {
    id: 'ent-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
    totalQty: 1, doneCount: 1, tier: '8萬', durationMin: 120,
  }),
  entitlement('cust-m', {
    id: 'ent-2nd', label: '二返（8萬健檢）', type: 'single', courseId: 'course-followup',
    totalQty: 1, followupForEntitlementId: 'ent-exam', durationMin: 30,
  }),
  entitlement('cust-m', {
    id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
    optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 10, durationMin: 30,
  }),
  visit({
    id: 'v-exam', customerId: 'cust-m', customerName: '王小明', date: EXAM_DAY, status: 'done',
    slots: [slot({
      courseId: 'course-checkup', entitlementId: 'ent-exam', startsAt: '09:00', endsAt: '11:00', attended: true,
    })],
  }),
  ...extra,
];

/** 一段已經存好的二返(60)。 */
const booked60 = (over = {}) => visit({
  id: 'v-2nd', customerId: 'cust-m', customerName: '王小明', date: PICK_DAY, status: 'pending_confirm',
  ...over,
  slots: [{
    ...slot({
      courseId: 'course-followup', entitlementId: 'ent-2nd', startsAt: '14:00', endsAt: '15:00',
      // 醫師先選好：改期之後舊那一段（取消的）身上沒有醫師的話，第一道確認會先問那一句
      followupForVisitId: 'v-exam', doctorId: 'staff-dr-xia',
    }),
    minutes: 60, status: over.status ?? 'pending_confirm',
  }],
});

async function openDeckDay(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-m"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
}

const mine = async (app) => (await app.readAll('visits'))
  .filter((v) => v.customerId === 'cust-m' && v.id !== 'v-exam');

test('M1 設定 → 課程：二返有「約的時候選時長」；跟「可選時長」兩格都填存不下去', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-followup"]').click();
  // 時長那幾格 2026-10-06 收進「其他設定」（issue 06）
  await page.locator('[data-more] > summary').click();
  await expect(page.locator('input[name="bookingMinutes"]')).toHaveValue('30、60');
  await expect(page.locator('input[name="durationChoices"]')).toHaveValue('');

  await page.fill('input[name="durationChoices"]', '30、60');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('只能填一格');

  await page.fill('input[name="durationChoices"]', '');
  await page.fill('input[name="bookingMinutes"]', '30、45、60');
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-followup')).bookingMinutes).toEqual([30, 45, 60]);
});

test('M2 壓表選二返：多一排 30／60、預設 30；選 60 存下去，日曆那一格是一小時、寫「二返(60)」', async ({ app, page }) => {
  await app.seed(base());
  await app.signIn('/');
  await openDeckDay(app, page);

  // 復能(30) 是買的時候分的：沒有這一排
  await page.locator('[data-ent="ent-pool"]').click();
  await app.layer('[data-equipment]');
  await expect(page.locator('[data-minutes]')).toHaveCount(0);

  await page.locator('[data-ent="ent-2nd"]').click();
  await app.layer('[data-minutes]');
  await expect(page.locator('[data-minutes]')).toHaveCount(2);
  await expect(page.locator('[data-minutes="30"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-slotmins]')).toContainText('30 分鐘');

  await page.locator('[data-minutes="60"]').click();
  await expect(page.locator('[data-minutes="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-minutes="30"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-slotmins]'), '那一句跟著換，不重畫').toContainText('60 分鐘');

  await page.locator('[data-time="14:00"]').click();
  await page.locator('[data-add]').click();
  // 第一道：還沒選醫師；第二道：壓好了嗎
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await expect(app.dialog()).toBeVisible();
  await expect(app.dialog()).toContainText('14:00–15:00');
  await expect(app.dialog()).toContainText('二返(60)');
  await app.ok();
  await app.saved();

  const [v] = await mine(app);
  expect(v.slots[0].minutes).toBe(60);
  expect([v.slots[0].startsAt, v.slots[0].endsAt]).toEqual(['14:00', '15:00']);

  await app.go('/calendar');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  await expect(page.locator(`[data-open^="visit:${v.id}:"]`).first()).toContainText('二返(60)');
});

test('M3 來訪編輯器：打開那一段只改醫師、存檔，還是 60（沒被清回 30）', async ({ app, page }) => {
  await app.seed(base([booked60()]));
  await app.signIn('/visits/v-2nd');
  await app.layer('[data-chip="s0-min"]');

  await expect(page.locator('[data-chip="s0-min"][aria-pressed="true"]')).toHaveText('60 分');
  await expect(page.locator('.slothead__end')).toHaveText('15:00');

  await page.locator('[data-chip="s0-doc"]', { hasText: '許' }).click();
  await page.click('button[type="submit"]');
  await app.saved();

  const v = await app.readDoc('visits', 'v-2nd');
  expect(v.slots[0].doctorId).toBe('staff-dr-xu');
  expect(v.slots[0].minutes, '只改醫師不可以把 60 清回 30').toBe(60);
  expect(v.slots[0].endsAt).toBe('15:00');
});

test('M4 日曆「改這一段」：改成 30 結束時間跟著變；改開始時間（改期）新的那一段帶著它的時長', async ({ app, page }) => {
  await app.seed(base([booked60()]));
  await app.signIn('/calendar');

  // **改期只在「改這一段」那條路成立**（ADR-0108：整天那個網址沒有任何畫面上的連結）——
  // 日曆 → 那一天 → 點那一列 → 讀取卡片上的鉛筆（同 spec 25 的 `openEditorForSlot()`）
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  await page.locator('[data-open^="visit:v-2nd:"]').first().click();
  await app.layer('.popcard');
  await page.locator('[data-card-edit]').click();
  await app.layer('[data-chip="s0-min"]');

  // 只改時長不是改期：畫面上結束時間與名字跟著變
  await page.locator('[data-chip="s0-min"]', { hasText: '30 分' }).click();
  await expect(page.locator('.slothead__end')).toHaveText('14:30');
  await expect(page.locator('.slothead__what')).toContainText('二返(30)');
  await page.locator('[data-chip="s0-min"]', { hasText: '60 分' }).click();
  await expect(page.locator('.slothead__end')).toHaveText('15:00');

  // 改開始時間 → 取消＋重新排，新的那一段還是 60
  await page.locator('input[name="s0-start"]').fill('16:00');
  await page.locator('input[name="s0-start"]').dispatchEvent('change');
  await expect(page.locator('.slothead__end')).toHaveText('17:00');
  await page.click('button[type="submit"]');
  await expect(app.dialog()).toContainText('壓好了嗎');
  await expect(app.dialog()).toContainText('16:00–17:00');
  await app.ok();
  await app.saved();

  const v = await app.readDoc('visits', 'v-2nd');
  expect(v.slots).toHaveLength(2);
  expect(v.slots[0].status).toBe('cancelled');
  expect(v.slots[1].status).toBe('pending_confirm');
  expect(v.slots[1].minutes, '改期帶著它的時長').toBe(60);
  expect([v.slots[1].startsAt, v.slots[1].endsAt]).toEqual(['16:00', '17:00']);
});

test('M5 一段 n返 也能選 60，日曆上寫「三返(60)」', async ({ app, page }) => {
  // 二返已經做完 → 「＋ n返」那一顆才有意義（沒有也按得下去，這裡照最常見的樣子種）
  await app.seed(base([booked60({ id: 'v-2nd-done', date: addDays(TODAY, -3), status: 'done' })]));
  await app.signIn('/');
  await openDeckDay(app, page);

  await page.locator('[data-ent="__nth__"]').click();
  await app.layer('[data-minutes]');
  await expect(page.locator('[data-minutes="30"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-minutes="60"]').click();
  await page.locator('[data-time="10:00"]').click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await expect(app.dialog()).toContainText('三返(60)');
  await app.ok();
  await app.saved();

  const made = (await mine(app)).find((v) => v.date === PICK_DAY);
  expect(made.slots[0].followupNth).toBe(3);
  expect(made.slots[0].minutes).toBe(60);
  expect(made.slots[0].endsAt).toBe('11:00');
});

test('M6 舊資料：沒有 minutes 的二返照舊 30 分，打開存一次結束時間不變', async ({ app, page }) => {
  const old = booked60();
  delete old.data.slots[0].minutes;
  old.data.slots[0].endsAt = '14:30';
  await app.seed(base([old]));
  await app.signIn('/visits/v-2nd');
  await app.layer('[data-chip="s0-min"]');

  await expect(page.locator('[data-chip="s0-min"][aria-pressed="true"]')).toHaveText('30 分');
  await expect(page.locator('.slothead__end')).toHaveText('14:30');
  await page.locator('[data-chip="s0-doc"]', { hasText: '許' }).click();
  await page.click('button[type="submit"]');
  await app.saved();

  const v = await app.readDoc('visits', 'v-2nd');
  expect(v.slots[0].endsAt).toBe('14:30');
  expect(v.slots[0].minutes).toBe(30);
});
