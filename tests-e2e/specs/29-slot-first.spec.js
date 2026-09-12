// 「一天只是一個抬頭」（ADR-0089，2026-09-12）。
//
// 她的原話：
//
// > a 盡量能讓使用者一開始分段點就分段點…希望不要點進去就是一整天的
// > b 如果是一整天的詳情，那也請不要呈現"這一天的待辦"和SOP，直接呈現那幾個
// >   分段讓我點就好，點進去再呈現那項的詳情
// > d 我點這一項，應該只需要出現這一項的SOP
// > e 並且也不需要出現改這一整天的按鈕
//
// 單元那一側全部是原始碼掃描（`tests/slot-first.test.js`）——
// 那幾支 view 進不了 node。掃描擋得住「有人把那一行改回去」，擋不住
// 「那一行還在、接線那一端沒把值傳進來」，所以這一支從瀏覽器問同樣的問題。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, playbook, task, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = TODAY;

/**
 * 一位客戶、同一天兩段、兩個不同的課程，各掛一份 SOP，另外掛一份合作機構的。
 *
 * 兩個課程是為了問「SOP 只浮這一段的嗎」——
 * 同一個課程的話兩段浮出來的是同一份，那就測不到東西。
 */
function seedTwoCourses() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '王小明', partners: ['自然美'] }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser', 'eq-ilib'],
      totalQty: 20, bookedCount: 2, durationMin: 30,
    }),
    entitlement('cust-x', {
      id: 'ent-drip', label: '營養點滴（60）', type: 'single',
      courseId: 'course-iv-drip', totalQty: 10, bookedCount: 1, durationMin: 60,
    }),
    playbook({
      id: 'pb-recovery', title: '復能要注意的', courseIds: ['course-recovery'],
      body: '先問有沒有不舒服\n護具要自己帶',
    }),
    playbook({
      id: 'pb-drip', title: '點滴要注意的', courseIds: ['course-iv-drip'],
      body: '飯後打針\n血管難打的先看註記',
    }),
    playbook({
      id: 'pb-partner', title: '自然美對接', courseIds: [],
      body: '報到單要蓋章',
    }),
    task({
      id: 'task-two', customerId: 'cust-x', customerName: '王小明',
      kind: 'Abovee', dueDate: addDays(DAY, -1), visitId: 'v-two',
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
          note: '她說想換一台',
        },
        {
          ...slot({
            courseId: 'course-iv-drip', entitlementId: 'ent-drip',
            startsAt: '14:00', endsAt: '15:00', roomId: 'room-iv10',
          }),
          status: 'pending_confirm',
        },
      ],
    }),
  ];
}

/** 一位客戶、同一天只有一段。那一天「這一天」與「這一段」是同一件事。 */
function seedOneSlot() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-y', name: '客戶A' }),
    entitlement('cust-y', {
      id: 'ent-one', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 1,
      durationMin: 30,
    }),
    playbook({
      id: 'pb-recovery', title: '復能要注意的', courseIds: ['course-recovery'],
      body: '先問有沒有不舒服',
    }),
    visit({
      id: 'v-one', customerId: 'cust-y', customerName: '客戶A',
      date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-one',
        startsAt: '10:00', endsAt: '10:30', equipmentId: 'eq-indiba',
        therapistId: 'staff-tw',
      })],
    }),
    task({
      id: 'task-x', customerId: 'cust-y', customerName: '客戶A',
      kind: 'Abovee', dueDate: addDays(DAY, -1), visitId: 'v-one',
    }),
  ];
}

// ---------- 一整天那一張只是目錄 ----------

test('S1 進度追蹤：每一段自己是一顆按鈕，日期那一列點不下去', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  await expect(
    page.locator('button.progslot[data-visit="v-two"]'),
    '兩段各一顆',
  ).toHaveCount(2);
  await expect(
    page.locator('button.progday'),
    '整天那一顆大按鈕不在了 —— 日期是抬頭不是選項',
  ).toHaveCount(0);

  // 點第二段 → 卡片上只有第二段，副標是第二段的狀態
  await page.locator('[data-visit="v-two"][data-slot="1"]').click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot')).toHaveCount(1);
  await expect(page.locator('.popcard'), '點的是下午那一段').toContainText('14:00');
  await expect(page.locator('.popcard__sub'), '第二段還沒問過客人')
    .toContainText('已壓表，等客戶回覆');
});

test('S2 待辦中心點人名：目錄那一張沒有待辦也沒有 SOP，點一段才有', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/');
  await page.locator('[data-tab="who"]').click();
  await page.locator('[data-who="cust-x"]').click();
  await expect(page.locator('.drawer-backdrop .drawer')).toBeVisible();

  await page.locator('[data-task-visit="v-two"]').first().click();
  await app.layer('.popcard');

  // 目錄：兩段都在，而且一個待辦、一份 SOP 都沒有
  await expect(page.locator('.popcard .readslot')).toHaveCount(2);
  await expect(page.locator('.popcard .taskmirror'), '目錄那一張不畫待辦').toHaveCount(0);
  await expect(page.locator('.popcard .pbhint'), '目錄那一張不畫 SOP').toHaveCount(0);

  // 每一段自己那一列印得出它記的那一句
  await expect(page.locator('.popcard .readslot').first(), '那一句長在自己那一列裡')
    .toContainText('她說想換一台');

  // 點第一段 → 這時候才有待辦
  await page.locator('.popcard .readslot[data-open]').first().click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot')).toHaveCount(1);
  await expect(page.locator('.popcard'), '抬頭只剩這一種說法').toContainText('這一項的待辦');
  await expect(page.locator('.popcard'), '整天那一種說法沒有了').not.toContainText('這一天的待辦');
});

// ---------- SOP 跟著段走 ----------

test('S3 點復能那一段：只浮復能那一份，點滴與自然美那兩份都不浮', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-two:"]');
  await page.locator('[data-open^="visit:v-two:"]').first().click();
  await app.layer('.popcard');

  const card = page.locator('.popcard');
  await expect(card).toContainText('復能要注意的');
  await expect(card, '別段的 SOP 不該浮出來').not.toContainText('點滴要注意的');
  await expect(card, '掛機構的那一份也一起收掉了').not.toContainText('自然美對接');
});

// ---------- 一天只有一段 ----------

test('S4 只有一段的那一天：直接就是那一段的詳情，不是一張一列的目錄', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  await page.locator('[data-visit="v-one"]').first().click();
  await app.layer('.popcard');

  await expect(page.locator('.popcard .readslot')).toHaveCount(1);
  await expect(page.locator('.popcard .taskmirror'), '那一天就是那一段，待辦要看得到')
    .toHaveCount(1);
  await expect(page.locator('.popcard')).toContainText('這一項的待辦');
});

// ---------- 整天那幾顆不在了 ----------

test('S5 只有一段的那一天照樣取消得掉，而且填得了理由', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-one:"]');

  const row = page.locator('[data-open^="visit:v-one:"]').first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();

  const menu = page.locator('.drawer--actions');
  await expect(menu, '單段那一天不可以一顆取消都沒有').toContainText('取消這一段');
  await expect(menu, '整天那一顆拿掉了').not.toContainText('取消一整天');
  await expect(menu, '改整天那一顆也拿掉了').not.toContainText('改這一天');

  await page.locator('.actionrow', { hasText: '取消這一段' }).click();
  await expect(app.dialog()).toBeVisible();
  await page.locator('[data-dialog-field]').fill('客人要改時間');
  await app.ok();
  await app.saved();

  const v = await app.readDoc('visits', 'v-one');
  expect(v.status, '最後一段取消掉，整筆跟著變').toBe('cancelled');
  expect(v.cancelReason, '那一格「為什麼」要跟著搬過來').toBe('客人要改時間');
});

test('S6 鉛筆開的那一張沒有整天的狀態卡與刪除', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-two:"]');
  await page.locator('[data-open^="visit:v-two:"]').first().click();
  await app.layer('.popcard');

  await expect(page.locator('.popcard [data-edit-day]'), '那一顆拿掉了').toHaveCount(0);

  await page.locator('.popcard [data-card-edit]').click();
  await app.layer('[data-form]');
  await expect(page.locator('[data-status]'), '整天的狀態卡不在了').toHaveCount(0);
  await expect(page.locator('[data-delete]'), '刪除這一天沒有路了').toHaveCount(0);
});
