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
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

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
  // 既有那一段改了扣法（體驗 → 扣額度）：原地改、存之前講一句（2026-10-18，ADR-0154）
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText()).toContain('改成扣「復能-三選一(60)」（扣 1 次）');
  await app.ok();
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

test('G11 匯進來的 IN 30 體驗（沒有 minutes 那一格）只換治療師：還是 30 分（審查：以前照課程預設畫成 60、存回去就變 60）', async ({ app, page }) => {
  // 合併檔與補登不傳 `minutes` —— 切換那天匯進來的 SIS 30／IN 30 體驗都長這樣
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({
      courseId: 'course-recovery', entitlementId: null, startsAt: '10:00', endsAt: '10:30',
      equipmentId: 'eq-indiba', therapistId: 'staff-tw',
    }),
    giftKind: 'trial',
  })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditor(app, page);

  await expect(page.locator('[data-chip="s0-min"][data-chip-value="30"]'), '按著的是它現在的長度').toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-chip="s0-staff"][data-chip-value="staff-zn"]').click();
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-g');
  expect(saved.slots.map((s) => [s.endsAt, s.giftKind, s.therapistId])).toEqual([['10:30', 'trial', 'staff-zn']]);
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

// ---------- 06：拍 Abovee 讀「預約來源」 ----------

/** 王小明（復能池＋健檢）在九月那一批；拍一張預約來源寫體驗的 Abovee，等確認層出來。 */
async function openTrialPhoto(app, page) {
  const month = '2026-09';
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }),
    entitlement('cust-wang', {
      id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'],
      durationMin: 60, totalQty: 12,
    }),
    entitlement('cust-wang', { id: 'w-exam', label: '健檢', courseId: 'course-checkup', totalQty: 1 }),
    {
      path: 'batches', id: 'b-sep',
      data: {
        targetMonth: month, status: 'active', cursor: null, lastDeviceHint: null,
        queue: [{ customerId: 'cust-wang', customerName: '', state: 'pending', skippedReason: null }],
      },
    },
  ]);
  await app.signIn('/schedule');
  await page.locator(`[data-month="${month}"]`).click();
  await app.settled();
  await queueAi(['aboveeList-trial']);
  await page.locator('[data-abovee]').click();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto('aboveeList-trial.jpg', { width: 1600, height: 900 })]);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  const row = (key) => page.locator(`[data-abl-row="${key}"]`);
  await expect(row('a0')).toBeVisible();
  return row;
}

test('G9 拍 Abovee：預約來源寫體驗的 IN 30 → 預選體驗的復能、INDIBA、不扣；寫體驗的健檢照扣、收著也看得到那一句', async ({ app, page }) => {
  const row = await openTrialPhoto(app, page);

  // 健檢那一列收著：Abovee 寫體驗、健檢沒有體驗 —— 照扣的那一句不點開也看得到（mustSee）
  await expect(row('a1').locator('.abl-row__hint--warn')).toContainText('健檢、二返沒有體驗');

  await row('a0').locator('[data-abl-open]').click();
  await expect(row('a0').locator('[data-abl-opt="__course__:course-recovery"]'), '身上有復能池也預選體驗').toHaveAttribute('aria-pressed', 'true');
  await expect(row('a0').locator('[data-abl-gift="trial"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('a0').locator('[data-abl-eq="eq-indiba"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('a0').locator('.abl-row__seen')).toContainText('體驗');
  await row('a0').locator('[data-abl-therapist="staff-zn"]').click();
  await expect(row('a0').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');

  await page.locator('[data-abl-save]').click();
  await app.ok();
  await app.saved();

  const added = await app.readAll('visits');
  const at = (date) => added.find((v) => v.date === date)?.slots ?? [];
  expect(at('2026-09-10').map((s) => [s.courseId, s.equipmentId, s.entitlementId, s.giftKind, s.endsAt])).toEqual([
    ['course-recovery', 'eq-indiba', null, 'trial', '10:30'],
  ]);
  expect(at('2026-09-11').map((s) => [s.courseId, s.entitlementId, s.giftKind])).toEqual([['course-checkup', 'w-exam', null]]);
});

// ---------- staging-polish 03：「送的／體驗…」收得回去 ----------
//
// > 我希望送的/體驗這個，也可以展開之後再縮合回去，當然不只app拍照壓表這邊，而是其他有這種送的/體驗這個，都可以展開，收合回去
//
// 收起來時選著的那一門寫在開關上、是按下去的樣子；開或收是她決定的，撐得過重畫。

const more = (scope) => scope.locator('[data-giftfold-more]');

test('G12 壓表：展開 → 選功醫門診 → 收回（開關寫著功醫門診、按著）→ 按額度那一顆（不重畫也變回來）→ 存下去是額度', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer()]);
  await app.signIn('/');
  await openScheduleDay(app, page);
  const fold = page.locator('[data-giftfold]');

  await more(page).click();
  await expect(fold).toHaveAttribute('data-giftfold', 'open');
  await expect(more(page), '展開時開關還在、按得回去').toBeVisible();
  await expect(more(page)).toHaveAttribute('aria-expanded', 'true');
  await page.locator('[data-ent="__course__:course-fm"]').click();

  await more(page).click();
  await expect(fold).toHaveAttribute('data-giftfold', 'closed');
  await expect(page.locator('[data-ent="__course__:course-fm"]')).toBeHidden();
  await expect(more(page), '收起來時寫出選了哪一門').toContainText('功醫門診');
  await expect(more(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-ent="__course__:course-fm"]'), '選擇沒有被收起來吃掉').toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-ent="ent-pool"]').click();
  await expect(more(page), '換成額度：開關變回原本的字').toHaveText('送的／體驗…');
  await expect(more(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(fold, '換一顆額度不動她收起來的').toHaveAttribute('data-giftfold', 'closed');
});

test('G13 來訪編輯器：一打開就展開的那一組收得回去，改開始時間、選醫師（整張重畫）之後還是收著；存下去照樣是功醫門診體驗', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-n', name: '王小明' })]);
  await app.signIn('/');
  await app.go(`/visits/new/cust-n/${PICK_DAY}`);
  await app.layer('[data-chip="s0-ent"]');
  const fold = page.locator('[data-giftfold]');
  await expect(fold, 'foldOpen() 照舊：什麼都沒買 → 一打開就展開').toHaveAttribute('data-giftfold', 'open');

  await more(page).click();
  await expect(fold).toHaveAttribute('data-giftfold', 'closed');
  await expect(more(page)).toContainText('功醫門診');
  await expect(more(page)).toHaveAttribute('aria-pressed', 'true');

  await page.locator('input[name="s0-start"]').fill('14:00');
  await page.locator('input[name="s0-start"]').dispatchEvent('change');
  await page.locator('[data-chip="s0-doc"]', { hasText: '夏' }).click();
  await expect(page.locator('[data-chip="s0-doc"]', { hasText: '夏' })).toHaveAttribute('aria-pressed', 'true');
  await expect(fold, '重畫之後還是收著').toHaveAttribute('data-giftfold', 'closed');

  await page.locator('button[type="submit"]').first().click();
  await app.ok();
  await app.saved();
  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-n');
  expect([v.slots[0].courseId, v.slots[0].entitlementId, v.slots[0].giftKind]).toEqual(['course-fm', null, 'trial']);
});

test('G14 拍 Abovee：預選體驗的那一列展開著 → 收回 → 換治療師（整列重畫）還是收著 → 再按一次展開', async ({ app, page }) => {
  const row = await openTrialPhoto(app, page);
  await row('a0').locator('[data-abl-open]').click();
  const fold = row('a0').locator('[data-giftfold]');
  await expect(fold).toHaveAttribute('data-giftfold', 'open');

  await more(row('a0')).click();
  await expect(fold).toHaveAttribute('data-giftfold', 'closed');
  await expect(more(row('a0'))).toContainText('復能');
  await expect(more(row('a0'))).toHaveAttribute('aria-pressed', 'true');

  await row('a0').locator('[data-abl-therapist="staff-zn"]').click();
  await expect(row('a0').locator('[data-abl-therapist="staff-zn"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row('a0').locator('[data-giftfold]'), '重畫之後還是收著').toHaveAttribute('data-giftfold', 'closed');

  await more(row('a0')).click();
  await expect(row('a0').locator('[data-giftfold]')).toHaveAttribute('data-giftfold', 'open');
  await expect(row('a0').locator('[data-abl-opt="__course__:course-recovery"]')).toHaveAttribute('aria-pressed', 'true');
});

// ---------- 08：合併檔 v7 ----------

test('G10 合併檔 v7：摘要卡講幾位帶電話 → 匯入 → 客戶身上有電話；一段 IN 30 體驗不扣那一池、30 分', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  const day = addDays(TODAY, -20);
  const file = {
    format: 'baobao-merge/v7',
    calendar: { file: 'timetree.ics' },
    eventCandidates: [],
    customers: [{
      sheetName: '客戶A', name: '客戶A', phone: '0900-000-001',
      entitlements: [{ key: 'r1', type: 'pool', label: '復能', totalQty: 12, courseName: null, optionEquipmentNames: ['INDIBA', 'SIS'] }],
      visits: [{
        date: day, status: 'done',
        slots: [{ entitlementKey: null, giftKind: 'trial', courseName: '復能', startsAt: '10:00', endsAt: '10:30', equipmentName: 'INDIBA' }],
      }],
    }],
  };
  await page.locator('[data-json]').fill(JSON.stringify(file));
  await page.locator('[data-load]').click();
  await app.settled();
  await expect(page.locator('main')).toContainText('1 位帶電話');

  await page.locator('[data-run]').click();
  await app.ok();
  await expect(page.locator('#toast')).toContainText('客戶都匯進去了', { timeout: 20_000 });

  const [cust] = (await app.readAll('customers')).filter((c) => c.name === '客戶A');
  expect(cust.phone).toBe('0900-000-001');
  const [v] = (await app.readAll('visits')).filter((x) => x.date === day);
  expect(v.slots.map((s) => [s.courseId, s.equipmentId, s.entitlementId, s.giftKind, s.endsAt]))
    .toEqual([['course-recovery', 'eq-indiba', null, 'trial', '10:30']]);
  const [pool] = await app.readAll(`customers/${cust.id}/entitlements`);
  expect([pool.doneCount, pool.bookedCount], '那一池一次都沒扣').toEqual([0, 0]);
});
