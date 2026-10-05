// 不算次數的課（2026-10-05，issue 05，ADR-0121）。
//
// 她的原話：
//
// > 五、不算次數的課：功醫門診不扣額度，現在排不進去。
// > 功醫門診：跟二返不同；不算次數、不簽療程單、不寫紀錄；三個系統都要壓；要選醫師
//
// 規則（放不放行、次數動不動、確認框講什麼）在 domain，`tests/uncounted-courses.test.js` 盯著。
// 這一支從瀏覽器走她會走的那幾條路：一位**沒有任何額度**的客戶從日曆排得進去、佇列裡的客戶
// 從壓表排得進去、做完之後每一筆額度的數字都沒變、來回換額度存下去的是對的。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, addDays, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;

// 功醫門診（`course-fm`）2026-10-05 起在種子裡（issue 12）：不算次數、三個系統、不簽療程單。

const FM_PICK = '__course__:course-fm';

const poolCustomer = () => [
  customer({ id: 'cust-p', name: '王小明' }),
  entitlement('cust-p', {
    id: 'ent-pool', label: '復能-三選一(60)', type: 'pool',
    optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
    totalQty: 12, doneCount: 2, bookedCount: 1, durationMin: 60,
  }),
];

const fmVisit = (over = {}) => visit({
  id: 'v-fm', customerId: 'cust-n', customerName: '林小華', date: TODAY, status: 'confirmed',
  ...over,
  slots: [{
    ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '10:00', endsAt: '10:30', doctorId: 'staff-dr-xia' }),
    status: over.status ?? 'confirmed',
  }],
});

const liveTasks = async (app, visitId) => (await app.readAll('tasks'))
  .filter((t) => t.visitId === visitId && !t.deletedAt).map((t) => t.kind).sort();

test('U1 設定 → 課程：種子的功醫門診看得出不算次數；她自己再勾一門也存得下去', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');
  await expect(page.locator('[data-course]').filter({ hasText: '功醫門診' })).toContainText('不算次數');

  // 她之後自己加的那一種（Abovee 醫師門診那一類裡的一門，種子沒有建）
  await page.locator('[data-new]').click();
  await page.locator('[data-newgroup="醫師門診"]').click();
  await page.fill('input[name="name"]', '回測報告');
  await expect(page.locator('input[name="uncounted"]')).not.toBeChecked();
  await page.locator('input[name="uncounted"]').check();
  await page.locator('input[name="needsTreatmentForm"]').uncheck();
  await page.click('button[type="submit"]');
  await app.saved();

  const made = (await app.readAll('config/app/courses')).find((c) => c.name === '回測報告');
  expect(made.uncounted).toBe(true);
  expect(made.needsTreatmentForm).toBe(false);
  await expect(page.locator('[data-course]').filter({ hasText: '回測報告' })).toContainText('不算次數');
});

test('U2 一位沒有任何額度的客戶：日曆 → 新增，功醫門診已經選好、存得下去、日曆上看得到', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-n', name: '林小華' })]);
  // **走她真的會走的那條路**：日曆 → 那一天 → ＋ → 來訪 → 選人（那一份名單不看有沒有額度）。
  // 一位沒有額度的客戶不在壓表那面牆上（ADR-0041），這是她唯一排得到他的地方
  await app.signIn('/calendar');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-n"]').click();
  await app.layer('[data-chip="s0-ent"]');

  // 沒有額度可以預設 → 第一段就是那門不算次數的課
  const chip = page.locator(`[data-chip="s0-ent"][data-chip-value="${FM_PICK}"]`);
  await expect(chip).toHaveAttribute('aria-pressed', 'true');
  await expect(chip).toContainText('不扣次數');
  await expect(page.locator('.slothead__what')).toContainText('功醫門診');
  await expect(page.locator('.slothead__end')).toHaveText('09:30');

  await page.locator('[data-chip="s0-doc"]', { hasText: '夏' }).click();
  await page.click('button[type="submit"]');
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '她最會擔心的那一句').toContain('功醫門診不算次數');
  expect(said, '三個系統都壓：等客人說可以之後長 Examine、耀聖').toMatch(/Examine/);
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-n');
  expect(v.slots).toHaveLength(1);
  expect(v.slots[0].entitlementId, '不扣任何額度').toBeNull();
  expect(v.slots[0].courseId).toBe('course-fm');
  expect(v.slots[0].doctorId).toBe('staff-dr-xia');
  expect(v.status).toBe('pending_confirm');

  // 存完面板收起來，月曆那一格已經有它；點進那一天，那一段就在上面
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  await expect(page.locator(`[data-open^="visit:${v.id}:"]`).first()).toContainText('功醫門診');
});

test('U3 壓表：佇列裡的客戶那一排有「功醫門診 不扣次數」，排了之後額度的數字一格都沒動', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer()]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-p"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');

  const chip = page.locator(`[data-ent="${FM_PICK}"]`);
  await expect(chip).toContainText('功醫門診');
  await expect(chip).toContainText('不扣次數');
  // 她身上的額度那一顆照樣在
  await expect(page.locator('[data-ent="ent-pool"]')).toContainText('剩 9');

  await chip.click();
  await app.layer('[data-doctor]');
  // 不扣額度的那一段沒有器材、沒有治療師那兩排（照課程自己的設定）
  await expect(page.locator('[data-equipment]')).toHaveCount(0);
  await expect(page.locator('[data-therapist]')).toHaveCount(0);
  await page.locator('[data-time]').first().click();
  await page.locator('[data-doctor="staff-dr-xu"]').click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText()).toContain('功醫門診不算次數');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-p');
  expect(v.slots[0].entitlementId).toBeNull();
  expect(v.slots[0].courseId).toBe('course-fm');

  const ent = await app.readDoc('customers/cust-p/entitlements', 'ent-pool');
  expect([ent.doneCount, ent.bookedCount], '次數不多不少').toEqual([2, 1]);
});

test('U4 做完那一段：確認框不講「扣掉次數」，客戶身上每一筆額度的數字都沒變，不長寫紀錄', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(), ...poolCustomer(),
    fmVisit({ customerId: 'cust-p', customerName: '王小明' }),
  ]);
  await app.signIn('/todo/close');

  await page.locator('[data-open="v-fm"]').click();
  await app.tickAll();
  await expect(page.locator('.drawer')).toContainText('不扣次數');
  await expect(page.locator('.drawer')).not.toContainText('扣掉次數');
  await expect(page.locator('.drawer')).not.toContainText('寫紀錄');
  await page.locator('[data-apply]').click();
  await app.saved();

  const v = await app.readDoc('visits', 'v-fm');
  expect(v.status).toBe('done');
  const ent = await app.readDoc('customers/cust-p/entitlements', 'ent-pool');
  expect([ent.doneCount, ent.bookedCount]).toEqual([2, 1]);
  expect(await liveTasks(app, 'v-fm')).not.toContain('寫紀錄');
});

test('U5 客人說可以之後：三個系統都勾的功醫門診長 Examine、耀聖', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(), customer({ id: 'cust-n', name: '林小華' }),
    fmVisit({ status: 'pending_confirm', date: PICK_DAY }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');

  const row = page.locator('[data-open^="visit:v-fm:"]').first();
  await row.scrollIntoViewIfNeeded();
  const at = await row.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  expect(await liveTasks(app, 'v-fm')).toEqual(['Examine', '耀聖']);
});

test('U6 來訪編輯器：功醫門診換成一筆額度、再換回來，存下去的是不扣額度的那一段', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer()]);
  await app.signIn('/');
  await app.go(`/visits/new/cust-p/${PICK_DAY}`);
  await app.layer('[data-chip="s0-ent"]');

  const ent = page.locator('[data-chip="s0-ent"][data-chip-value="ent-pool"]');
  const fm = page.locator(`[data-chip="s0-ent"][data-chip-value="${FM_PICK}"]`);

  // 有額度的客戶預設是他的額度；不算次數的那一顆排在後面
  await expect(ent).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-chip="s0-equip"]').first()).toBeVisible();

  await fm.click();
  await expect(fm).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slothead__what')).toContainText('功醫門診');
  await expect(page.locator('[data-chip="s0-equip"]'), '器材那一排跟著收掉').toHaveCount(0);
  await expect(page.locator('[data-chip="s0-doc"]').first()).toBeVisible();

  await ent.click();
  await expect(page.locator('[data-chip="s0-equip"]').first()).toBeVisible();
  await expect(page.locator('[data-chip="s0-doc"]')).toHaveCount(0);

  await fm.click();
  await page.locator('[data-chip="s0-doc"]', { hasText: '李' }).click();
  await page.click('button[type="submit"]');
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-p');
  expect(v.slots).toHaveLength(1);
  expect(v.slots[0].entitlementId, '換回來是 null').toBeNull();
  expect(v.slots[0].courseId).toBe('course-fm');
  expect(v.slots[0].equipmentId ?? null).toBeNull();
  expect(v.slots[0].doctorId).toBe('staff-dr-li');
  const stored = await app.readDoc('customers/cust-p/entitlements', 'ent-pool');
  expect([stored.doneCount, stored.bookedCount]).toEqual([2, 1]);
});

test('U7 加購那一排沒有功醫門診；取消一段不扣次數的不講「次數也會還回來」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(), ...poolCustomer(),
    fmVisit({ customerId: 'cust-p', customerName: '王小明', date: PICK_DAY }),
  ]);
  await app.signIn('/customers/cust-p');

  await page.locator('[data-add-ent]').click();
  await app.layer('[data-chip="buy"]');
  await expect(page.locator('[data-chip="buy"]').filter({ hasText: '復健科醫師門診' })).toHaveCount(1);
  await expect(page.locator('[data-chip="buy"]').filter({ hasText: '功醫門診' })).toHaveCount(0);

  await app.go('/calendar');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  const row = page.locator('[data-open^="visit:v-fm:"]').first();
  await row.scrollIntoViewIfNeeded();
  const at = await row.boundingBox();
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('.actionrow', { hasText: '取消這一段' }).click();
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('本來就不扣次數');
  expect(said).not.toContain('次數也會還回來');
  expect(said, '壓在 Abovee 的那一格照樣要回去放掉').toContain('取消 Abovee');
});
