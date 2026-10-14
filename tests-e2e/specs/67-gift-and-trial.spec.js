// 送的／體驗（2026-10-14，gift-and-trial）。
//
// 她的原話：
//
// > 就是如果有標註體驗的就直接送不算次數，就不會被沒有額度檔，畢竟是送的，但是來訪以及試算表還是要標註(送的)、(體驗)
//
// 規則（放不放行、名字、次數）在 domain，`tests/gift-kind.test.js` 盯著；拍 Abovee 的翻譯在
// `tests/gift-kind-entrances.test.js`。這一支從瀏覽器走**來訪編輯器**那幾條 node 裡走不到的路 ——
// 盯的是「畫面看起來對、存進去是錯的」：送的被安靜地改成體驗、體驗改回扣額度時那一格被留著、
// 器材那一排選得到 ILIB、時長那一排沒有 30。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

const DAY = TODAY;
const MONTH = TODAY.slice(0, 7);
/** 壓表那個月裡還沒過的一天（月底那幾天就用今天）。 */
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;

const poolCustomer = () => [
  customer({ id: 'cust-g', name: '王小明' }),
  entitlement('cust-g', {
    id: 'ent-pool', label: '復能-三選一(60)', type: 'pool',
    optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
    totalQty: 12, doneCount: 2, bookedCount: 0, durationMin: 60,
  }),
];

const giftVisit = (slotOver, visitOver = {}) => visit({
  id: 'v-g', customerId: 'cust-g', customerName: '王小明', date: DAY, status: 'pending_confirm',
  ...visitOver,
  slots: [{ status: visitOver.status ?? 'pending_confirm', ...slotOver }],
});

async function openDay(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
}

/** 點那一列 → 讀取卡片 → 按鉛筆 → 編輯器（同 `25` 的動線）。 */
async function openEditor(app, page) {
  await page.locator('[data-open^="visit:v-g:"]').first().click();
  await app.layer('.popcard');
  await page.locator('[data-card-edit]').click();
  await app.layer('.slotcard');
}

test('G1 一段「送的」心臟科評估只選一位醫師存回去：還是送的（不會被安靜地改成體驗）', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({ courseId: 'course-cardio', entitlementId: null, startsAt: '10:00', endsAt: '10:30' }),
    giftKind: 'gift',
  })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await expect(page.locator('[data-open^="visit:v-g:"]').first(), '日／週那一列看得出是送的').toContainText('(送的)');
  await openEditor(app, page);

  await expect(page.locator('.slothead__what')).toHaveText('心臟科評估(送的)');
  await page.locator('[data-chip="s0-doc"]', { hasText: '簡' }).click();
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-g');
  expect(saved.slots).toHaveLength(1);
  expect(saved.slots[0].giftKind).toBe('gift');
  expect(saved.slots[0].entitlementId).toBeNull();
  expect(saved.slots[0].doctorId).toBe('staff-dr-jian');
});

test('G2 一段體驗的復能：器材只有復能那三台、排多久有 30／60；改回扣三選一 → 那一格清掉、扣那一筆', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({
      courseId: 'course-recovery', entitlementId: null, startsAt: '10:00', endsAt: '10:30',
      equipmentId: 'eq-indiba', therapistId: 'staff-tw',
    }),
    giftKind: 'trial', minutes: 30,
  })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditor(app, page);

  await expect(page.locator('.slothead__what')).toHaveText('IN(30)(體驗)');
  await expect(page.locator('[data-chip="s0-equip"]'), '復能那三台').toHaveCount(3);
  await expect(page.locator('[data-chip="s0-equip"][data-chip-value="eq-ilib"]'), '沒有 ILIB').toHaveCount(0);
  await expect(page.locator('[data-chip="s0-min"]')).toHaveCount(2);
  await expect(page.locator('[data-chip="s0-min"][data-chip-value="30"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-pool"]').click();
  await expect(page.locator('.slothead__what'), '扣額度的段不帶標記').toHaveText('IN(60)');
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-g');
  expect(saved.slots).toHaveLength(1);
  expect(saved.slots[0].entitlementId).toBe('ent-pool');
  expect(saved.slots[0].giftKind, '兩種身分只挑一種').toBeNull();
  expect(saved.slots[0].equipmentId).toBe('eq-indiba');
  const ent = await app.readDoc('customers/cust-g/entitlements', 'ent-pool');
  expect(ent.bookedCount, '這一段開始扣').toBe(1);
});

test('G3 改一段體驗的時間（取消＋重新排）：取消的那一段與新的那一段都是體驗', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({ courseId: 'course-cardio', entitlementId: null, startsAt: '10:00', endsAt: '10:30', doctorId: 'staff-dr-jian' }),
    giftKind: 'trial',
  }, { status: 'confirmed' })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditor(app, page);

  await page.locator('input[name="s0-start"]').fill('14:00');
  await page.locator('button[type="submit"]').first().click();
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-g');
  expect(saved.slots.map((s) => [s.startsAt, s.status, s.giftKind])).toEqual([
    ['10:00', 'cancelled', 'trial'],
    ['14:00', 'pending_confirm', 'trial'],
  ]);
});

// ---------- 04：送的／體驗收在最後一顆「送的／體驗…」，按了才展開 ----------
//
// > 然後我希望這種不算次數的，在壓表或是新增來訪那邊可以先預設不出現先收合或是擺到底下，畢竟不常用
//
// 哪幾顆收、順序、要不要一打開就展開在 `tests/gift-fold.test.js`；這幾條量只有瀏覽器看得到的：
// 看不看得到、按下去存了什麼、有沒有整塊重畫、手機寬度。

/** 壓表 → 這個月 → 那一位 → 那一天。 */
async function openScheduleDay(app, page, customerId = 'cust-g') {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator(`[data-pick="${customerId}"]`).first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
}

const shownEnts = (page) => page.locator('[data-ent]').evaluateAll((els) => els
  .filter((el) => el.offsetParent !== null).map((el) => el.dataset.ent));

test('G4 壓表：有額度的客戶只看得到額度＋「送的／體驗…」；別的課當體驗 → 復能 → INDIBA → 30 分 → 一段 IN(30) 體驗、不扣，那一排沒有重畫', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer()]);
  await app.signIn('/');
  await openScheduleDay(app, page);

  expect(await shownEnts(page), '收著的那幾顆看不到').toEqual(['ent-pool']);
  const fold = page.locator('[data-giftfold]');
  await expect(fold).toHaveAttribute('data-giftfold', 'closed');

  // 記住那一排的節點 —— 展開、選一顆都不可以整塊重畫、捲回最上面（ADR-0038）
  const card = page.locator('.deck__card:not(.deck__card--peek)');
  await fold.evaluate((el) => { el.dataset.e2eMark = 'same'; });

  await page.locator('[data-giftfold-more]').click();
  await expect(fold).toHaveAttribute('data-giftfold', 'open');
  await expect(page.locator('[data-ent="__course__:course-fm"]')).toBeVisible();
  await expect(page.locator('[data-ent="__course__:course-hrv"]')).toBeVisible();
  await expect(page.locator('[data-ent="__course__:course-checkup"]'), '健檢不能當體驗').toHaveCount(0);
  await expect(page.locator('[data-ent="__course__:course-followup"]'), '二返也不能').toHaveCount(0);
  // 兩門以上的分類按了才露出那幾門
  await expect(page.locator('[data-ent="__course__:course-rehab"]')).toBeHidden();
  await page.locator('[data-giftfold-group]', { hasText: '醫師門診' }).click();
  await expect(page.locator('[data-ent="__course__:course-rehab"]')).toBeVisible();

  // 復能那一類只有一門：那一顆直接就是復能。按之前量卡片捲到哪（按那幾顆時 Playwright 會先往下捲到看得到）
  const recovery = page.locator('[data-ent="__course__:course-recovery"]');
  await recovery.scrollIntoViewIfNeeded();
  const before = await card.evaluate((el) => el.scrollTop);
  expect(before, '卡片已經捲下去了（不然量不出捲回最上面）').toBeGreaterThan(0);
  await recovery.click();
  await expect(page.locator('[data-giftkind="trial"]'), '預設體驗').toHaveAttribute('aria-pressed', 'true');
  await expect(fold, '那一排沒有整塊重畫').toHaveAttribute('data-e2e-mark', 'same');
  expect(await card.evaluate((el) => el.scrollTop), '沒有捲回最上面').toBeGreaterThanOrEqual(before - 1);

  await expect(page.locator('[data-equipment="eq-ilib"]'), '體驗的復能：器材只有復能那三台').toHaveCount(0);
  await page.locator('[data-equipment="eq-indiba"]').click();
  await page.locator('[data-minutes="30"]').click();
  await page.locator('[data-time="10:00"]').click();
  await page.locator('[data-therapist="staff-tw"]').click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText()).toContain('(體驗) —— 客戶身上的數字一個都不會變');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-g');
  expect(v.slots[0]).toMatchObject({
    courseId: 'course-recovery', equipmentId: 'eq-indiba', entitlementId: null, giftKind: 'trial',
    startsAt: '10:00', endsAt: '10:30', therapistId: 'staff-tw',
  });
  const ent = await app.readDoc('customers/cust-g/entitlements', 'ent-pool');
  expect([ent.doneCount, ent.bookedCount], '那一筆三選一一次都沒扣').toEqual([2, 0]);
});

test('G5 壓表：功醫門診 → 換成「送的」→ 存下去是送的', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer()]);
  await app.signIn('/');
  await openScheduleDay(app, page);

  await page.locator('[data-giftfold-more]').click();
  await page.locator('[data-ent="__course__:course-fm"]').click();
  await page.locator('[data-giftkind="gift"]').click();
  await expect(page.locator('[data-giftkind="gift"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-giftkind="trial"]')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('[data-time="10:00"]').click();
  await page.locator('[data-doctor]').first().click();
  await page.locator('[data-add]').click();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-g');
  expect([v.slots[0].courseId, v.slots[0].entitlementId, v.slots[0].giftKind]).toEqual(['course-fm', null, 'gift']);
});

test('G6 來訪編輯器：什麼都沒買的客戶 —— 那一組一打開就是展開的、預設功醫門診體驗；換成送的存下去', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-n', name: '王小明' })]);
  await app.signIn('/');
  await app.go(`/visits/new/cust-n/${PICK_DAY}`);
  await app.layer('[data-chip="s0-ent"]');

  await expect(page.locator('[data-giftfold]')).toHaveAttribute('data-giftfold', 'open');
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="__course__:course-fm"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-chip="s0-gift"][data-chip-value="trial"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slothead__what')).toHaveText('功醫門診(體驗)');

  await page.locator('[data-chip="s0-gift"][data-chip-value="gift"]').click();
  await expect(page.locator('.slothead__what')).toHaveText('功醫門診(送的)');
  // 第一顆是「還沒定」—— 指名一位，不然存檔前多一道「還沒選醫師」
  await page.locator('[data-chip="s0-doc"]', { hasText: '夏' }).click();
  await page.locator('button[type="submit"]').first().click();
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText()).toContain('功醫門診(送的) —— 客戶身上的數字一個都不會變');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-n');
  expect([v.slots[0].courseId, v.slots[0].entitlementId, v.slots[0].giftKind]).toEqual(['course-fm', null, 'gift']);
});

test('G7 來訪編輯器：打開一段舊的功醫門診（沒有那一格）—— 那一組展開、功醫門診按著、「體驗」按著', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '10:00', endsAt: '10:30', doctorId: 'staff-dr-jian' }),
  })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditor(app, page);

  await expect(page.locator('[data-giftfold]')).toHaveAttribute('data-giftfold', 'open');
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="__course__:course-fm"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-chip="s0-gift"][data-chip-value="trial"]')).toHaveAttribute('aria-pressed', 'true');
  // 她身上有還有剩的額度，但這一段本來就是體驗：照樣展開（不然畫面上是「一顆都沒按」）
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="ent-pool"]')).toHaveAttribute('aria-pressed', 'false');
});

test('G8 手機寬度（360px）：展開之後那一排不撐出橫向捲動（壓表、來訪編輯器）', async ({ app, page }) => {
  await page.setViewportSize({ width: 360, height: 760 });
  await app.seed([...masterDocs(), ...poolCustomer()]);
  await app.signIn('/');
  await openScheduleDay(app, page);
  await page.locator('[data-giftfold-more]').click();
  await page.locator('[data-giftfold-group]', { hasText: '運動區' }).click();
  const card = page.locator('.deck__card:not(.deck__card--peek)');
  const [sw, cw] = await card.evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(sw, '壓表那張卡').toBeLessThanOrEqual(cw + 1);

  await app.go(`/visits/new/cust-g/${PICK_DAY}`);
  await app.layer('[data-chip="s0-ent"]');
  await page.locator('[data-giftfold-more]').click();
  await page.locator('[data-giftfold-group]', { hasText: '醫師門診' }).click();
  const [msw, mcw] = await page.locator('.app__main').evaluate((el) => [el.scrollWidth, el.clientWidth]);
  expect(msw, '來訪編輯器（捲的是 .app__main）').toBeLessThanOrEqual(mcw + 1);
});
