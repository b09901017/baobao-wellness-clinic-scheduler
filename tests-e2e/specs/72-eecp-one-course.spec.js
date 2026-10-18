// EECP 只有一門（2026-10-18，staging-polish 09，ADR-0154）。
//
// 她的原話：
//
// > 所以只要留一個EECP就好，預設是60分鐘 ，不選體驗/送的，然後如果選20就預設是體驗這樣可以嗎
//
// 規則（按 20 → 體驗、體驗排幾分、照片上的 EECP20、扣法不一樣算要改的、資料健檢）在 domain，`tests/eecp-one-course.test.js` 盯著。
// 這一支從瀏覽器走 node 裡走不到的那幾條：壓表與來訪編輯器按 20 那一下、編輯器原地改扣法的確認框、設定頁那一格。
// 判準：**這一行會不會讓一段體驗被算進 EECP 的額度，或反過來？** —— 每一條都讀回額度上的已排。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

const DAY = TODAY;
const MONTH = TODAY.slice(0, 7);
/** 壓表那個月裡還沒過的一天（月底那幾天就用今天）。 */
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;

const eecpCustomer = ({ bookedCount = 0 } = {}) => [
  customer({ id: 'cust-e', name: '王小明' }),
  entitlement('cust-e', {
    id: 'ent-eecp', label: 'EECP', courseId: 'course-eecp', totalQty: 10, doneCount: 0, bookedCount, durationMin: 60,
  }),
];

/** 壓表 → 這個月 → 那一位 → 那一天（同 `67`）。 */
async function openScheduleDay(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-e"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
}

test('E1 壓表：EECP 預設 60 → 按 20 換成體驗（開關寫著 EECP、診間留著）→ 按 EECP 那一顆回到 60 扣額度 → 再按 20 存下去：體驗、不扣', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...eecpCustomer()]);
  await app.signIn('/');
  await openScheduleDay(app, page);

  await page.locator('[data-ent="ent-eecp"]').click();
  await expect(page.locator('[data-minutes="60"]'), '預設 60').toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-minutes="20"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-giftkind]'), '扣額度的段沒有「體驗或送的」那一排').toHaveCount(0);
  await page.locator('[data-room^="room-t5"]').click();

  await page.locator('[data-minutes="20"]').click();
  await expect(page.locator('[data-giftfold-more]'), '選擇跳到「送的／體驗…」那一顆').toContainText('EECP');
  await expect(page.locator('[data-giftfold-more]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-ent="ent-eecp"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('[data-giftkind="trial"]'), '預設體驗').toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-minutes="20"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-slotmins]')).toContainText('20 分鐘');
  await expect(page.locator('[data-room^="room-t5"]'), '課程沒變：診間留著').toHaveAttribute('aria-pressed', 'true');

  // 反過來不自動：要扣額度她按那一顆額度 → 時長回到預設
  await page.locator('[data-ent="ent-eecp"]').click();
  await expect(page.locator('[data-minutes="60"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-giftkind]')).toHaveCount(0);

  await page.locator('[data-minutes="20"]').click();
  await page.locator('[data-time="10:00"]').click();
  await page.locator('[data-room^="room-t5"]').click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  // 上面那一行印這一段（EECP(20)(體驗)），「不扣」那一句照那一門課講（同功醫門診(體驗)，`giftNames()`）
  const told = await app.dialogText();
  expect(told).toContain('10:00–10:20 EECP(20)(體驗)');
  expect(told).toContain('EECP(體驗) —— 客戶身上的數字一個都不會變');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-e');
  expect(v.slots[0]).toMatchObject({
    courseId: 'course-eecp', entitlementId: null, giftKind: 'trial', minutes: 20, startsAt: '10:00', endsAt: '10:20', roomId: 'room-t5',
  });
  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-eecp');
  expect(ent.bookedCount, 'EECP 那一筆的已排沒有多 1').toBe(0);
});

test('E2 來訪編輯器（新的一段）：EECP(60) → 按 20 → EECP(20)(體驗) → 按 EECP 那一顆回到 EECP(60) → 再按 20 存下去：體驗、不扣', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...eecpCustomer()]);
  await app.signIn('/');
  await app.go(`/visits/new/cust-e/${PICK_DAY}`);
  await app.layer('[data-chip="s0-ent"]');

  const what = page.locator('.slothead__what');
  await expect(what).toHaveText('EECP(60)');
  await page.locator('[data-chip="s0-min"][data-chip-value="20"]').click();
  await expect(what).toHaveText('EECP(20)(體驗)');
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="__course__:course-eecp"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-chip="s0-gift"][data-chip-value="trial"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-eecp"]').click();
  await expect(what, '按額度那一顆：時長回到預設').toHaveText('EECP(60)');

  await page.locator('[data-chip="s0-min"][data-chip-value="20"]').click();
  await expect(what).toHaveText('EECP(20)(體驗)');
  await page.locator('input[name="s0-start"]').fill('10:00');
  await page.locator('input[name="s0-start"]').dispatchEvent('change');
  await page.locator('[data-chip="s0-room"]', { hasText: '治5' }).click();
  await page.locator('button[type="submit"]').first().click();
  await expect(app.dialog()).toBeVisible();
  // 上面那一行印這一段（EECP(20)(體驗)），「不扣」那一句照那一門課講（同功醫門診(體驗)，`giftNames()`）
  const told = await app.dialogText();
  expect(told).toContain('10:00–10:20 EECP(20)(體驗)');
  expect(told).toContain('EECP(體驗) —— 客戶身上的數字一個都不會變');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-e');
  expect(v.slots[0]).toMatchObject({ courseId: 'course-eecp', entitlementId: null, giftKind: 'trial', minutes: 20, endsAt: '10:20' });
  expect((await app.readDoc('customers/cust-e/entitlements', 'ent-eecp')).bookedCount).toBe(0);
});

/** 點那一列 → 讀取卡片 → 按鉛筆 → 編輯器（同 `67`）。 */
async function openEditor(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  await page.locator('[data-open^="visit:v-e:"]').first().click();
  await app.layer('.popcard');
  await page.locator('[data-card-edit]').click();
  await app.layer('.slotcard');
}

test('E3 來訪編輯器（既有那一段）：已確認的 EECP 60 扣額度改成 20 → 原地改（不取消、不重新排）、確認框講不扣與 Abovee 上改成 EECP20', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...eecpCustomer({ bookedCount: 1 }), visit({
    id: 'v-e', customerId: 'cust-e', customerName: '王小明', date: DAY, status: 'confirmed',
    slots: [{
      ...slot({ courseId: 'course-eecp', entitlementId: 'ent-eecp', startsAt: '10:00', endsAt: '11:00', roomId: 'room-t5' }),
      minutes: 60, status: 'confirmed',
    }],
  })]);
  await app.signIn('/calendar');
  await openEditor(app, page);

  await expect(page.locator('.slothead__what')).toHaveText('EECP(60)');
  await page.locator('[data-chip="s0-min"][data-chip-value="20"]').click();
  await expect(page.locator('.slothead__what')).toHaveText('EECP(20)(體驗)');
  await page.locator('button[type="submit"]').first().click();

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('這一段改成體驗？');
  expect(said).toContain('不扣「EECP」（還 1 次）');
  expect(said).toContain('Abovee 上記得改成 EECP20');
  expect(said, '不是改期').not.toContain('取消原本那一段');
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-e');
  expect(saved.slots, '原地改：沒有多一段取消掉的').toHaveLength(1);
  expect(saved.slots[0]).toMatchObject({
    entitlementId: null, giftKind: 'trial', minutes: 20, startsAt: '10:00', endsAt: '10:20', status: 'confirmed', roomId: 'room-t5',
  });
  expect((await app.readDoc('customers/cust-e/entitlements', 'ent-eecp')).bookedCount, '還 1 次').toBe(0);
  const cancels = (await app.readAll('tasks')).filter((t) => t.visitId === 'v-e' && String(t.kind).startsWith('取消'));
  expect(cancels, '沒有長「取消 Abovee」').toHaveLength(0);
});

test('E4 設定 → 課程 → EECP：「體驗的時候排幾分」填成 60（＝時長）存不下去、收著的那一段自己打開；填 20 存得下去', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');
  await page.locator('[data-edit="course-eecp"]').click();
  await expect(page.locator('[data-more-now]'), '收著的那一行印得出現在的值').toContainText('體驗 20 分');

  await page.locator('[data-more] summary').click();
  await page.locator('input[name="trialMinutes"]').fill('60');
  await page.locator('[data-more] summary').click();
  await expect(page.locator('[data-more]')).not.toHaveAttribute('open', '');
  await page.click('button[type="submit"]');
  await expect(page.locator('[data-errors]')).toContainText('不可以跟預設時長一樣');
  await expect(page.locator('[data-more]'), '錯的那一格在收起來的那一段裡：自己打開').toHaveAttribute('open', '');
  expect((await app.readDoc('config/app/courses', 'course-eecp')).trialMinutes, '沒有存進去').toBe(20);

  await page.locator('input[name="trialMinutes"]').fill('20');
  await page.click('button[type="submit"]');
  await app.saved();
  expect((await app.readDoc('config/app/courses', 'course-eecp')).trialMinutes).toBe(20);
});
