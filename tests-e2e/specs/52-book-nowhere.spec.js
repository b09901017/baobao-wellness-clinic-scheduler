// 一門課可以哪個系統都不用壓（2026-10-06，issue 02，ADR-0126）。
//
// 她的原話：
//
// > HRV也是不算次數的，通常會是我想邀客戶來體驗送的，就會讓他當天做完HRV後然後接著功醫門診聽報告
// > 問題 6：目前先皆不用壓，不用指派診間或人員…
//
// 規則（壓在哪、長不長取消、確認框的抬頭）在 domain，`tests/book-nowhere.test.js` 盯著。
// 這一支從瀏覽器走她會走的那幾條路：設定頁三個都不勾存得下去、排一段時不問「壓好了嗎」、
// 客人說可以之後不長掛號、取消之後不長「取消 Abovee」。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, addDays, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;

/**
 * 一門不用壓、不算次數、不用指派的課。**自己建一門，不借種子的** —— 種子之後補了同名的課
 * 這一支也不會跟著變（改了種子要查「E2E 自己建的同名資料」）。
 */
const TRIAL = {
  path: 'config/app/courses', id: 'course-trial',
  data: {
    name: '體驗檢測', group: '醫師門診', category: null, systems: [], durationMin: 30,
    assigns: 'none', allowedRoomTypes: [], allowedRoomIds: [],
    requiresEquipment: false, doctorPick: 'none', frequencyRule: null,
    uncounted: true, needsTreatmentForm: false, active: true,
  },
};
const TRIAL_PICK = '__course__:course-trial';

const liveTasks = async (app, visitId) => (await app.readAll('tasks'))
  .filter((t) => t.visitId === visitId && !t.deletedAt).map((t) => t.kind).sort();

/** 日曆 → 那一天 → 長按那一段，等選單升起來（`wireLongPress()` 只認主鍵的真滑鼠事件，同 spec 05）。 */
async function longPress(app, page, date, visitId) {
  await app.go('/calendar');
  await page.locator(`[data-day="${date}"]`).first().click();
  await app.layer(`[data-open^="visit:${visitId}:"]`);
  const row = page.locator(`[data-open^="visit:${visitId}:"]`).first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

test('N1 設定 → 課程：三個都不勾存得下去，清單那一行寫「不用壓」；只勾耀聖照舊存不下去', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  const box = (name) => page.locator(`input[name="systems"][value="${name}"]`);
  await expect(page.locator('[data-course="course-fm"]')).toContainText('Abovee 壓，確認後 Examine、耀聖');

  await page.locator('[data-edit="course-fm"]').click();
  for (const name of ['Abovee', 'Examine', '耀聖']) await box(name).uncheck();
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-fm')).systems).toEqual([]);
  await expect(page.locator('[data-course="course-fm"]')).toContainText('不用壓');
  await expect(page.locator('[data-course="course-fm"]')).not.toContainText('Abovee 壓');

  // 再打開：三個勾都還是空的 —— 沒有被當成「沒勾過」照類別畫回去
  await page.locator('[data-edit="course-fm"]').click();
  for (const name of ['Abovee', 'Examine', '耀聖']) await expect(box(name)).not.toBeChecked();

  // 只勾耀聖：沒有地方壓表卻有確認後的登記，存不下去
  await box('耀聖').check();
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('至少要勾一個');
  expect((await app.readDoc('config/app/courses', 'course-fm')).systems).toEqual([]);
});

test('N2 日曆排一段不用壓的課：不問壓好了嗎；客人說可以之後不長掛號；取消之後不長「取消 Abovee」', async ({ app, page }) => {
  // 種子那門不算次數的功醫門診先停用，這位沒有額度的客戶第一段預設才會是這一門
  const docs = masterDocs().map((d) => (d.id === 'course-fm' ? { ...d, data: { ...d.data, active: false } } : d));
  await app.seed([...docs, TRIAL, customer({ id: 'cust-n', name: '林小華' })]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-n"]').click();
  await app.layer('[data-chip="s0-ent"]');
  await expect(page.locator(`[data-chip="s0-ent"][data-chip-value="${TRIAL_PICK}"]`)).toHaveAttribute('aria-pressed', 'true');

  await page.click('button[type="submit"]');
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '抬頭').toContain('記錄這一段？');
  expect(said, '沒有東西要她先去壓').not.toMatch(/Abovee|Examine|耀聖|壓好/);
  expect(said, '其餘的後果照講').toContain('待辦會多一張「跟客人確認時間」');
  expect(said).toContain('體驗檢測不算次數');
  await expect(page.locator('.dialog-backdrop [data-ok]')).toHaveText('記錄');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-n');
  expect(v.status).toBe('pending_confirm');
  expect(v.slots[0].courseId).toBe('course-trial');

  // 客人說可以：一張掛號都不長
  await longPress(app, page, PICK_DAY, v.id);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();
  expect((await app.readDoc('visits', v.id)).status).toBe('confirmed');
  expect(await liveTasks(app, v.id)).toEqual([]);

  // 取消這一段：確認框不叫她回任何系統，存完也沒有那一張
  await longPress(app, page, PICK_DAY, v.id);
  await page.locator('.actionrow', { hasText: '取消這一段' }).click();
  await expect(app.dialog()).toBeVisible();
  const cancelSaid = await app.dialogText();
  expect(cancelSaid).not.toMatch(/取消 Abovee|取消 Examine|取消 耀聖|待辦會多一張/);
  expect(cancelSaid, '不算次數的段沒有次數可以還').toContain('本來就不扣次數');
  await app.ok();
  await app.saved();
  expect((await app.readDoc('visits', v.id)).status).toBe('cancelled');
  expect(await liveTasks(app, v.id)).toEqual([]);
});

test('N3 壓表：那一天已經有一段壓在 Abovee 的，再加一段不用壓的 —— 抬頭不問 Abovee', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(), TRIAL,
    customer({ id: 'cust-p', name: '王小明' }),
    entitlement('cust-p', {
      id: 'ent-pool', label: '復能-三選一(60)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 12, doneCount: 2, bookedCount: 1, durationMin: 60,
    }),
    visit({
      id: 'v-day', customerId: 'cust-p', customerName: '王小明', date: PICK_DAY, status: 'confirmed',
      slots: [{
        ...slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '16:00', endsAt: '17:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        }),
        status: 'confirmed',
      }],
    }),
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-p"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');

  await page.locator(`[data-ent="${TRIAL_PICK}"]`).click();
  await app.layer('[data-time]');
  await page.locator('[data-time]').first().click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '只問這一次新加的那一段').toContain('記錄這一段？');
  expect(said, '那一天早就壓好的復能不再問一次').not.toMatch(/Abovee|壓好/);
  expect(said).toContain('那天變成 2 段');
  await expect(page.locator('.dialog-backdrop [data-ok]')).toHaveText('記錄');
  await app.ok();
  await app.saved();

  const v = await app.readDoc('visits', 'v-day');
  expect(v.slots.map((s) => s.courseId)).toEqual(['course-recovery', 'course-trial']);
  expect(v.slots[0].status, '原本談定的那一段不動').toBe('confirmed');
  expect(v.slots[1].status).toBe('pending_confirm');
});
