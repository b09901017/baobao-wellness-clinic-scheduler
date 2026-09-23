// 拿了舊的那一份去寫、去畫（`.scratch/prelaunch-audit-2026-09-23/issues/03`、`04`、`10`）。
//
// 三支同一個形狀：畫面手上抓著打開那一刻讀的資料，而資料在那之後變了 ——
// 被另一台裝置、被同一個迴圈的上一筆、或被「復原」。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';
import { seedDocs } from '../fixtures/emulator.js';

const rehab = (startsAt, status = 'pending_confirm') => ({
  ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt, endsAt: startsAt.replace(':00', ':30') }),
  status,
});

function seedOneSlot() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-s', name: '王小明' }),
    entitlement('cust-s', {
      id: 'ent-rehab', label: '復健科醫師門診', type: 'single',
      courseId: 'course-rehab', totalQty: 10, bookedCount: 1, durationMin: 30,
    }),
    visit({ id: 'v-s', customerId: 'cust-s', customerName: '王小明', date: TODAY, slots: [rehab('09:00')] }),
  ];
}

async function openDayDrawer(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
}

/** 長按第 n 列（同 spec 34：`wireLongPress()` 只認主鍵的真滑鼠事件）。 */
async function longPressRow(page, index) {
  const row = page.locator('[data-open^="visit:v-s:"]').nth(index);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

// ---------- 04：另一台剛加了一段，這一台拿舊的那一份去寫 ----------

test('S1 日曆開著時另一台加了一段 → 長按說可以套在新的那一份上，那一段還在', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  // 另一台（手機）在壓表替同一天加了一段 11:00。seedDocs 會換掉 updatedAt，跟真的寫入一樣。
  await seedDocs([visit({
    id: 'v-s', customerId: 'cust-s', customerName: '王小明', date: TODAY,
    slots: [rehab('09:00'), rehab('11:00')],
  })]);

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  // 19：拿剛讀回來的那一份去套（04 當時只做到擋下來）
  const saved = await app.readDoc('visits', 'v-s');
  expect(saved.slots.map((s) => s.startsAt), '手機加的那一段還在').toEqual(['09:00', '11:00']);
  expect(saved.slots.map((s) => s.status), '只動她長按的那一段').toEqual(['confirmed', 'pending_confirm']);
});

test('S1b 另一台把那一段取消了 → 長按說可以不寫，講一句，抽屜換成新的樣子', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await seedDocs([visit({
    id: 'v-s', customerId: 'cust-s', customerName: '王小明', date: TODAY, status: 'cancelled',
    slots: [rehab('09:00', 'cancelled')],
  })]);

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();

  await expect(page.locator('#toast')).toContainText('剛剛在別的地方改過');
  expect((await app.readDoc('visits', 'v-s')).slots[0].status, '沒有寫').toBe('cancelled');
  await expect(page.locator('.timerow.status-pending'), '抽屜畫的是新的那一份').toHaveCount(0);
  await expect(page.locator('[data-open^="visit:v-s:"]'), '停在同一天').toHaveCount(1);
});

test('S2 沒有別人改過 → 照常存得進去', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  expect((await app.readDoc('visits', 'v-s')).slots[0].status).toBe('confirmed');
});

// ---------- 03：確認抽屜一次存好幾天，次數拿舊清單算 ----------

test('S3 同一筆額度兩天待確認，退掉比較早那一天 → 已排只剩 1', async ({ app, page }) => {
  const inbody = (id, date) => visit({
    id, customerId: 'cust-s', customerName: '王小明', date,
    slots: [{
      ...slot({ courseId: 'course-inbody', entitlementId: 'ent-inbody', startsAt: '10:00', endsAt: '10:20' }),
      status: 'pending_confirm',
    }],
  });
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-s', name: '王小明' }),
    entitlement('cust-s', {
      id: 'ent-inbody', label: '身體組成分析', type: 'single',
      courseId: 'course-inbody', totalQty: 10, bookedCount: 2, durationMin: 20,
    }),
    inbody('v-early', addDays(TODAY, 3)),
    inbody('v-late', addDays(TODAY, 10)),
  ]);
  await app.signIn('/');
  await app.go('/todo/confirm');

  await page.locator('[data-open="cust-s"]').click();
  await page.locator('[data-slot="v-early:0"]').click();
  await page.locator('[data-apply]').click();
  await app.saved();

  const ent = await app.readDoc('customers/cust-s/entitlements', 'ent-inbody');
  expect(ent.bookedCount, '存第二天時拿的是第一天還沒退掉的那一份').toBe(1);
});

test('S3b 確認抽屜開著時另一台在同一天加了一段 → 新加的那一段照舊待確認', async ({ app, page }) => {
  const day = addDays(TODAY, 3);
  const inbody = (startsAt) => ({
    ...slot({ courseId: 'course-inbody', entitlementId: 'ent-inbody', startsAt, endsAt: startsAt.replace(':00', ':20') }),
    status: 'pending_confirm',
  });
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-s', name: '王小明' }),
    entitlement('cust-s', {
      id: 'ent-inbody', label: '身體組成分析', type: 'single',
      courseId: 'course-inbody', totalQty: 10, bookedCount: 1, durationMin: 20,
    }),
    visit({ id: 'v-c', customerId: 'cust-s', customerName: '王小明', date: day, slots: [inbody('10:00')] }),
  ]);
  await app.signIn('/');
  await app.go('/todo/confirm');
  await page.locator('[data-open="cust-s"]').click();
  await app.layer('[data-apply]');

  await seedDocs([visit({
    id: 'v-c', customerId: 'cust-s', customerName: '王小明', date: day,
    slots: [inbody('10:00'), inbody('14:00')],
  })]);

  await page.locator('[data-apply]').click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-c');
  expect(saved.slots.map((s) => s.status), '她沒問過的那一段不會被標成談定').toEqual(['confirmed', 'pending_confirm']);
});

test('S3c 壓表開著時另一台在同一天加了一段 → 這台再壓一段，三段都在', async ({ app, page }) => {
  const day = '2026-09-14';
  const inbody = (startsAt) => ({
    ...slot({ courseId: 'course-inbody', entitlementId: 'ent-inbody', startsAt, endsAt: startsAt.replace(':00', ':20') }),
    status: 'pending_confirm',
  });
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-s', name: '王小明' }),
    entitlement('cust-s', {
      id: 'ent-inbody', label: '身體組成分析', type: 'single',
      courseId: 'course-inbody', totalQty: 10, bookedCount: 1, durationMin: 20,
    }),
    visit({ id: 'v-p', customerId: 'cust-s', customerName: '王小明', date: day, slots: [inbody('09:00')] }),
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator('[data-month="2026-09"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-s"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${day}"]`).first().click();
  await app.layer('[data-ent="ent-inbody"]');
  await page.locator('[data-ent="ent-inbody"]').click();
  await page.locator('[data-time="15:00"]').click();

  await seedDocs([visit({
    id: 'v-p', customerId: 'cust-s', customerName: '王小明', date: day,
    slots: [inbody('09:00'), inbody('11:00')],
  })]);

  await page.locator('[data-add]').click();
  // 存檔前的確認（先看一下那幾段 → 壓好表了嗎），有幾道按幾道
  while (!(await app.dialogText()).includes('已確認，記錄')) await app.ok();
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-p');
  expect(saved.slots.map((s) => s.startsAt), '另一台加的那一段沒被蓋掉').toEqual(['09:00', '11:00', '15:00']);
});

// ---------- 10：按了「復原」，開著的那一天抽屜還是舊資料 ----------

test('S4 長按說可以 → 復原 → 同一天的抽屜還開著，而且那一段又是待確認', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();
  await page.locator('#toast [data-undo]').click();
  await expect(page.locator('#toast')).toContainText('已復原');
  expect((await app.readDoc('visits', 'v-s')).slots[0].status).toBe('pending_confirm');

  await expect(page.locator('[data-open^="visit:v-s:"]'), '停在同一天').toHaveCount(1);
  await expect(page.locator('.timerow.status-pending'), '抽屜上那一段畫的是復原之後的').toHaveCount(1);
  await longPressRow(page, 0);
  await expect(page.locator('.drawer--actions')).toContainText('客戶說可以');
});

test('S4b 說可以 → 點同一天另一段 → 鉛筆 → 復原 → 編輯器按取消 → 抽屜畫的是復原之後的（issues/20）', async ({ app, page }) => {
  const [master, cust, ent] = [masterDocs(), ...seedOneSlot().slice(-3, -1)];
  await app.seed([
    ...master, cust, ent,
    visit({ id: 'v-s', customerId: 'cust-s', customerName: '王小明', date: TODAY, slots: [rehab('09:00'), rehab('11:00')] }),
  ]);
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  // 編輯器接走了那一天的抽屜，這時候按復原
  await page.locator('[data-open^="visit:v-s:"]').nth(1).click();
  await page.locator('[data-card-edit]').click();
  await app.layer('[data-cancel-edit]');
  await page.locator('#toast [data-undo]').click();
  await expect(page.locator('#toast')).toContainText('已復原');
  // 復原之後那一趟重讀要先落地（`render()` 換掉抽屜手上那一份）—— 不等的話它晚到，
  // 剛好替重開的抽屜補上新資料，蓋住這個 bug
  await app.settled();
  await page.locator('[data-cancel-edit]').click();

  await expect(page.locator('.timerow.status-pending'), '兩段都是待確認').toHaveCount(2);
  await longPressRow(page, 0);
  await expect(page.locator('.drawer--actions')).toContainText('客戶說可以');
});
