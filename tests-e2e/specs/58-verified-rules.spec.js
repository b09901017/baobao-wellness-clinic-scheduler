// 2026-10-07 逐條驗證過的那份問題清單，第一支 PR：會動到提醒與數字的那幾條
// （`.scratch/verified-bugs-2026-10-07/issues/01`–`07`）。
//
// 每一條都是「資料是對的、畫面講的不是同一件事」或「按下去存到的跟畫面上看到的不一樣」——
// 單元測試釘得住規則，釘不住「那一句真的出現在她眼前的那一道確認框上」，所以這裡從瀏覽器再問一次。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = TODAY;
const MONTH = TODAY.slice(0, 7);
/** 壓表那一頁挑得到的一天（同一個月裡的明天；月底就用今天）。 */
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;

// ---------- 05 進度追蹤與客戶詳情「這個月」：取消的段不畫、不算（ADR-0134） ----------

/** 一位客戶、今天兩段：早上那一段取消了，下午那一段還在。 */
function seedOneCancelled() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'v-a', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
          }),
          status: 'cancelled',
        },
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-sis', therapistId: 'staff-tw',
          }),
          status: 'confirmed',
        },
      ],
    }),
  ];
}

test('P1 進度追蹤：取消的那一段不畫，「N 段」跟底下的列數一樣', async ({ app, page }) => {
  await app.seed(seedOneCancelled());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  await expect(page.locator('button.progslot[data-visit="v-a"]'), '只剩沒取消的那一段').toHaveCount(1);
  await expect(page.locator('.card', { hasText: '客戶A' }).first()).toContainText('1 天・1 段');

  // 點下去開的是下午那一段（它在來訪裡是第 2 段）—— 不是畫出來的第 1 列就當成第 1 段
  await page.locator('button.progslot[data-visit="v-a"]').click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard'), '開的是沒取消的那一段').toContainText('14:00');
});

test('P2 客戶詳情「這個月」：同一份數字', async ({ app, page }) => {
  await app.seed(seedOneCancelled());
  await app.signIn('/calendar');
  await app.go('/customers/cust-a');

  await expect(page.locator('button.progslot[data-visit="v-a"]')).toHaveCount(1);
  await expect(page.locator('.section__n', { hasText: '段' })).toContainText('1 天・1 段');
});

// ---------- 06 簽療程單存完那一句只數真的扣次數的段 ----------

test('P3 簽療程單：一段扣額度、一段不算次數都做了 → 「扣掉 1 次」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'v-close', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
          }),
          status: 'confirmed',
        },
        // 功醫門診不算次數（ADR-0121）：沒有額度
        { ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '10:00', endsAt: '10:30' }), status: 'confirmed' },
      ],
    }),
  ]);
  await app.signIn('/todo/close');

  await page.locator('[data-open="v-close"]').click();
  await app.tickAll();
  await expect(page.locator('.drawer'), '抽屜上那一句').toContainText('做了的 2 段裡 1 段扣掉次數');
  await page.locator('[data-apply]').click();
  await app.saved();
  await expect(page.locator('#toast'), '存完那一句跟抽屜同一個數').toContainText('扣掉 1 次');

  const ent = await app.readDoc('customers/cust-a/entitlements', 'ent-pool');
  expect(ent.doneCount).toBe(1);
});

// ---------- 04 同一位客戶的兩段撞時間：提醒，不擋（ADR-0133） ----------

test('P4 那一天已完成之後再加一段、時間一樣：第一道確認講得出來，照樣存得下去', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    visit({
      id: 'v-done', customerId: 'cust-b', customerName: '客戶B', date: DAY, status: 'done',
      slots: [{
        ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '09:00', endsAt: '09:30' }),
        status: 'done',
      }],
    }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-b"]').click();
  await app.layer('[data-chip="s0-ent"]');

  // 沒有額度 → 第一段預設就是功醫門診、09:00 開始：跟已完成那一段一模一樣的時間
  await expect(page.locator('.slothead__what')).toContainText('功醫門診');
  await page.locator('[data-chip="s0-doc"]', { hasText: '夏' }).click();
  await page.click('button[type="submit"]');

  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText(), '同一個人同一個時間排了兩段')
    .toContain('這位客戶 09:00–09:30 已經有另一段（功醫門診・已完成）');
  await app.ok();
  // 第二道：在哪裡壓好了嗎
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const mine = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-b');
  expect(mine, '只提醒不擋：另開的那一筆存進去了').toHaveLength(2);
});

// ---------- 01 二返沒接到一次做完的健檢：那一句講得出為什麼 ----------

test('P5 同一天排健檢＋二返：提醒講出那一次健檢還沒做完、之後照樣會扣；照樣存得下去', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-c', name: '客戶C' }),
    entitlement('cust-c', {
      id: 'ent-c-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 2, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-c', {
      id: 'ent-c-fu', label: '二返（8萬健檢）', type: 'single', courseId: 'course-followup',
      totalQty: 2, followupForEntitlementId: 'ent-c-exam', durationMin: 30,
    }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-c"]').click();
  await app.layer('[data-chip="s0-ent"]');

  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-c-exam"]').click();
  await page.locator('[data-add-slot]').click();
  await app.layer('[data-chip="s1-ent"]');
  await page.locator('[data-chip="s1-ent"][data-chip-value="ent-c-fu"]').click();
  await page.click('button[type="submit"]');

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '不是「還沒指定」—— 她沒有東西可以指').toContain('二返 還沒接到一次做完的健檢');
  expect(said, '講得出是哪一次').toContain('那一次健檢還沒做完');
  expect(said, '講得出後果').toContain('照樣會扣一次二返');
  await app.ok();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-c');
  expect(v.slots, '只提醒不擋').toHaveLength(2);
  expect(v.slots[1].followupForVisitId ?? null).toBeNull();
});

// ---------- 02 日曆編輯器換額度時，上一次點的器材跟著重設 ----------

test('P6 三選一 → INDIBA 再換成單買一台的 SIS：抬頭與器材那一排都是 SIS，存得下去', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-d', name: '客戶D' }),
    entitlement('cust-d', {
      id: 'ent-d-three', label: '復能-三選一(60)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 10, durationMin: 60,
    }),
    entitlement('cust-d', {
      id: 'ent-d-sis', label: '復能-SIS(60)', type: 'pool',
      optionEquipmentIds: ['eq-sis'], totalQty: 10, durationMin: 60,
    }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-d"]').click();
  await app.layer('[data-chip="s0-ent"]');

  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-d-three"]').click();
  await page.locator('[data-chip="s0-equip"][data-chip-value="eq-indiba"]').click();
  await expect(page.locator('.slothead__what')).toContainText('IN');

  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-d-sis"]').click();
  const sis = page.locator('[data-chip="s0-equip"][data-chip-value="eq-sis"]');
  await expect(sis, '只有一台，已經替她選好').toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slothead__what'), '抬頭不再是上一台').toContainText('SIS');
  await expect(page.locator('.slothead__what')).not.toContainText('IN(');

  await page.locator('[data-chip="s0-staff"]').first().click();
  await page.click('button[type="submit"]');
  await expect(app.dialog()).toBeVisible();
  await expect(page.locator('[data-errors]'), '以前在這裡被擋：器材不在擇一池裡').toBeHidden();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-d');
  expect(v.slots[0].entitlementId).toBe('ent-d-sis');
  expect(v.slots[0].equipmentId).toBe('eq-sis');
});

// ---------- 03 營養品「＋新增…」：先驗證再建主檔、名字重算 ----------

const NEW_CHIP = '[data-chip="productIds"][data-chip-value="__newproduct__"]';
const productNames = async (app) => (await app.readAll('config/app/products')).map((p) => p.name);

test('P7 客戶詳情 → 加購 → 營養品：只打新的一款存得下去；勾一款＋新的一款名字兩款都有；沒過的那一次主檔不多一筆', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-e', name: '客戶E' })]);
  await app.signIn('/customers/cust-e');
  const before = (await productNames(app)).length;

  // (c) 驗證沒過的那一次：新打的那一款不可以先進主檔。
  // 「幾個月」那一格瀏覽器自己擋 0（`min="1"`），所以關掉瀏覽器那一道才問得到 domain 的驗證
  await page.locator('[data-add-ent]').click();
  await app.layer('[data-chip="buy"]');
  await page.locator('[data-chip="buy"]', { hasText: '營養品' }).click();
  await page.locator(NEW_CHIP).click();
  await page.locator('[name="newProductName"]').fill('不該出現的那一款');
  await page.locator('[name="totalQty"]').fill('0');
  await page.locator('[data-form]').evaluate((form) => { form.noValidate = true; });
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('總次數必須是大於 0 的整數');
  await expect(page.locator('[data-errors]'), '她明明打了一款，只是還沒建').not.toContainText('要選至少一種營養品');
  expect(await productNames(app), '沒過就一次寫入都沒有').not.toContain('不該出現的那一款');
  expect((await productNames(app)).length).toBe(before);

  // (a) 只打新的一款
  await page.locator('[name="newProductName"]').fill('測試魚油');
  await page.locator('[name="totalQty"]').fill('1');
  await page.click('button[type="submit"]');
  await app.saved();
  let ents = await app.readAll('customers/cust-e/entitlements');
  expect(ents.map((e) => e.label), '以前在這裡被擋：額度名稱不可空白').toEqual(['營養品（測試魚油）']);
  expect(await productNames(app)).toContain('測試魚油');

  // (b) 勾一款既有的＋再新增一款：名字跟 items 講的是同一組
  await page.locator('[data-add-ent]').click();
  await app.layer('[data-chip="buy"]');
  await page.locator('[data-chip="buy"]', { hasText: '營養品' }).click();
  await page.locator('[data-chip="productIds"]', { hasText: 'GABA' }).click();
  await page.locator(NEW_CHIP).click();
  await page.locator('[name="newProductName"]').fill('測試葉黃素');
  await page.click('button[type="submit"]');
  await app.saved();
  ents = await app.readAll('customers/cust-e/entitlements');
  const both = ents.find((e) => (e.items ?? []).length === 2);
  expect(both.items.map((x) => x.name)).toEqual(['GABA', '測試葉黃素']);
  expect(both.label, '以前只有「營養品（GABA）」').toBe('營養品（GABA＋測試葉黃素）');
});

// ---------- 07 提醒裡的「第 N 個時段」指到她看得到的那一段 ----------

/** 那一天已經有一段談定的復能（16:00）。新增的那一段會併進同一筆、排在第 2 段。 */
function seedOneBooked(date) {
  return [
    ...masterDocs(),
    customer({ id: 'cust-f', name: '客戶F' }),
    entitlement('cust-f', {
      id: 'ent-f-pool', label: '復能-三選一(60)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 12, bookedCount: 1, durationMin: 60,
    }),
    visit({
      id: 'v-f', customerId: 'cust-f', customerName: '客戶F', date, status: 'confirmed',
      slots: [{
        ...slot({
          courseId: 'course-recovery', entitlementId: 'ent-f-pool',
          startsAt: '16:00', endsAt: '17:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        }),
        status: 'confirmed',
      }],
    }),
  ];
}

test('P8 日曆新增、那一天已經有一段：畫面上只有她正在加的那一段，提醒叫它「這一段」', async ({ app, page }) => {
  await app.seed(seedOneBooked(DAY));
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-f"]').click();
  await app.layer('[data-chip="s1-ent"]');

  await expect(page.locator('[data-chip="s0-ent"]'), '原本那一段刻意不列（ADR-0083）').toHaveCount(0);
  await page.locator('[data-chip="s1-equip"][data-chip-value="eq-sis"]').click();
  await page.click('button[type="submit"]');

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '沒選治療師那一句').toContain('這一段：復能 還沒選治療師');
  expect(said, '以前寫「第 2 個時段」，而畫面上只有一段').not.toMatch(/第 \d+ 個時段/);
});

test('P9 壓表、併進那一天既有的一段：同一句也叫「這一段」', async ({ app, page }) => {
  await app.seed(seedOneBooked(PICK_DAY));
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-f"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');

  await page.locator('[data-ent="ent-f-pool"]').click();
  await app.layer('[data-equipment]');
  await page.locator('[data-equipment="eq-sis"]').click();
  await page.locator('[data-time]').first().click();
  await page.locator('[data-add]').click();

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('這一段：復能 還沒選治療師');
  expect(said).not.toMatch(/第 \d+ 個時段/);
});
