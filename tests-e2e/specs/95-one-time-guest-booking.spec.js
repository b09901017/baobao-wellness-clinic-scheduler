// 一次性客人：日曆新增「＋ 新增一次性客人」、來訪編輯器的「做什麼」、讀取卡片的「一次性」、「約二返」去日曆排（2026-11-05，ADR-0172，`.scratch/one-time-guests/issues/06`）。
//
// 她：「一樣寫說他做了什麼跟哪一個診間……跟哪個醫生」「我還是需要在日曆上看到他們的來訪，知道今天有哪些人」。
// 第 4 題：打名字找不到時多一顆「＋ 新增一次性客人『X』」→ 名字卡 → 接著排；「做什麼」那一排列全部的課（先分類再項目），不扣任何東西。
// 第 5 題：讀取卡片的名字旁邊標「一次性」；「扣 X／沒扣 X」那一行一次性的段不畫。
// 規則（組時段、驗證、那一排有哪幾顆）在 domain，`tests/one-time-guest-booking.test.js` 盯著。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, task, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = TODAY;
const EXAM_DATE = addDays(TODAY, -10);
const GUEST = (id) => `[data-chip="s0-ent"][data-chip-value="__guest__:${id}"]`;

const oneTimeSlot = (over = {}) => ({
  courseId: 'course-checkup', courseName: '健檢', entitlementId: null, giftKind: null, oneTime: true,
  equipmentId: null, ivProductId: null, startsAt: '09:00', endsAt: '11:00', minutes: null,
  roomId: null, bed: null, therapistId: null, doctorId: null, followupForVisitId: null, note: null,
  status: 'done', ...over,
});

/** 一位一次性客人：十天前做完一次一次性的健檢。 */
const guestWithExam = (extra = {}) => [
  customer({ id: 'cust-g', name: '客戶A', oneTime: true, active: true, ...extra }),
  visit({ id: 'v-g-exam', customerId: 'cust-g', customerName: '客戶A', date: EXAM_DATE, status: 'done', slots: [oneTimeSlot()] }),
];

async function openNew(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-search]');
}

/** 存檔前那幾道確認框一道一道按「確定」，直到存好。 */
async function saveThrough(app, page) {
  await page.locator('button[type="submit"]').first().click();
  const box = app.dialog();
  const title = async () => ((await box.isVisible()) ? box.locator('#dlg-title').textContent() : null);
  for (let n = 0; n < 4; n += 1) {
    try {
      await box.waitFor({ state: 'visible', timeout: 3_000 });
    } catch {
      break;
    }
    const was = await title();
    await app.ok();
    // 下一道可能緊接著換上來（同一個框換字），所以等「字變了或收掉」
    await expect.poll(title).not.toBe(was);
  }
  await app.saved();
}

test('B1 要幫誰排？打一個沒有的名字 →「＋ 新增一次性客人」→ 名字卡（名字帶好、只有三格）→ 接著排一段健檢 → 存：名字卡一次性、那一段不扣、日曆上看得到', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-r', name: '王小明' })]);
  await app.signIn('/calendar');
  await openNew(app, page);

  await page.locator('[data-search]').fill('客戶B');
  const add = page.locator('[data-new-guest]');
  await expect(add).toHaveText('＋ 新增一次性客人「客戶B」');
  await page.locator('[data-search]').fill('王');
  await expect(add, '找得到人就沒有那一顆').toHaveCount(0);
  await page.locator('[data-search]').fill('客戶B');
  await add.click();

  const form = page.locator('[data-gf-form]');
  await expect(form.locator('[name="name"]')).toHaveValue('客戶B');
  await expect(form.locator('[name="lineId"]'), '快速表單只有三格').toHaveCount(0);
  await form.locator('[name="chartNo"]').fill('5678');
  await form.locator('[data-gf-submit]').click();
  await app.saved();

  // 接著排：「做什麼」那一排是全部的課、沒有送的／體驗
  await app.layer('[data-guestpicks]');
  await expect(page.locator('[data-giftfold-more]'), '沒有「送的／體驗／其他…」').toHaveCount(0);
  await page.locator(GUEST('course-checkup')).click();
  await expect(page.locator(GUEST('course-checkup'))).toHaveAttribute('aria-pressed', 'true');
  await saveThrough(app, page);

  const guests = (await app.readAll('customers')).filter((c) => c.name === '客戶B');
  expect(guests).toHaveLength(1);
  expect(guests[0]).toMatchObject({ oneTime: true, chartNo: '5678', active: true });
  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === guests[0].id);
  expect(v.slots).toHaveLength(1);
  expect(v.slots[0]).toMatchObject({ oneTime: true, courseId: 'course-checkup', entitlementId: null, giftKind: null, status: 'pending_confirm' });
  expect((await app.readAll(`customers/${guests[0].id}/entitlements`)), '沒有任何額度').toHaveLength(0);

  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await expect(page.locator(`[data-open^="visit:${v.id}:"]`).first()).toBeVisible();
});

test('B2 一次性客人在「要幫誰排？」標一次性；他的二返沒接健檢、也沒按「健檢不是我排的」→ 那一排講要做什麼、存不下去', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-g', name: '客戶A', oneTime: true, active: true })]);
  await app.signIn('/calendar');
  await openNew(app, page);
  await expect(page.locator('[data-pick="cust-g"] .guestmark')).toHaveText('一次性');
  await page.locator('[data-pick="cust-g"]').click();
  await app.layer('[data-guestpicks]');

  // 二返在「醫師門診」那一類裡（一類兩門以上：先分類再項目）
  await page.locator('[data-guestpicks] [data-giftfold-group]', { hasText: '醫師門診' }).click();
  await page.locator(GUEST('course-followup')).click();
  await expect(page.locator('[data-guestexam-none]')).toContainText('健檢不是我排的');
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="__notmine__"]'), '「健檢不是我排的」收在「其他 ▸」').toBeHidden();
  await page.locator('[data-guestpicks] [data-giftfold-group="extra"]').click();
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="__notmine__"]')).toBeVisible();

  await page.locator('button[type="submit"]').first().click();
  await expect(page.locator('[data-errors]')).toContainText('一次性的二返要接一次健檢');
  expect(await app.readAll('visits')).toHaveLength(0);
});

test('B3 一次性客人的二返接他那一次一次性健檢 → 存：一次性、不扣、接著那一次', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...guestWithExam()]);
  await app.signIn('/calendar');
  await openNew(app, page);
  await page.locator('[data-pick="cust-g"]').click();
  await app.layer('[data-guestpicks]');
  await page.locator('[data-guestpicks] [data-giftfold-group]', { hasText: '醫師門診' }).click();
  await page.locator(GUEST('course-followup')).click();
  const exam = page.locator('[data-chip="s0-gexam"][data-chip-value="v-g-exam"]');
  await expect(exam).toBeVisible();
  await exam.click();
  await saveThrough(app, page);

  const v = (await app.readAll('visits')).find((x) => x.customerId === 'cust-g' && x.id !== 'v-g-exam');
  expect(v.slots[0]).toMatchObject({
    oneTime: true, courseId: 'course-followup', entitlementId: null, giftKind: null, followupForVisitId: 'v-g-exam',
    startsAt: '09:00', endsAt: '09:30', minutes: 30,
  });
});

test('B4 讀取卡片：從日曆與名字卡那一頁打開都有「一次性」；一次性的段沒有「扣／沒扣」那一行', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-g', name: '客戶A', oneTime: true, active: true }),
    visit({ id: 'v-g', customerId: 'cust-g', customerName: '客戶A', date: DAY, status: 'pending_confirm',
      slots: [oneTimeSlot({ status: 'pending_confirm' })] }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-g:"]');
  await page.locator('[data-open^="visit:v-g:"]').first().click();
  const card = page.locator('.popcard');
  await expect(card.locator('.readguest .guestmark')).toHaveText('一次性');
  await expect(card.locator('.readslot')).not.toContainText('扣');

  await app.go('/customers/cust-g');
  await page.locator('[data-guestvisits] [data-visit="v-g"]').click();
  await expect(page.locator('.popcard .readguest .guestmark')).toHaveText('一次性');
});

test('B5 一次性客人的「約二返」→ 那一顆是「去日曆排」→ 打開日曆新增、他已經選好', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(), ...guestWithExam(),
    task({ id: 't-g-book', customerId: 'cust-g', customerName: '客戶A', kind: '約二返', dueDate: DAY, visitId: 'v-g-exam' }),
  ]);
  await app.signIn('/todo/today');
  const btn = page.locator('[data-book-followup="t-g-book"]');
  await expect(btn).toHaveText('去日曆排');
  await btn.click();
  await expect(page).toHaveURL(/#\/calendar/);
  await app.layer('[data-guestpicks]');
  await expect(page.locator('.drawer')).toContainText('客戶A');
});

test('B6 轉成我的客戶、又買了二返額度：「二返（一次性那一次）」只在還欠的時候有；按了存下去的段一次性、不扣他買的那一筆', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(), ...guestWithExam({ oneTime: false }),
    entitlement('cust-g', {
      id: 'ent-g-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup', totalQty: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-g', {
      id: 'ent-g-2nd', label: '二返（8萬健檢）', type: 'single', courseId: 'course-followup', totalQty: 1,
      followupForEntitlementId: 'ent-g-exam', durationMin: 30,
    }),
  ]);
  await app.signIn('/calendar');
  await openNew(app, page);
  await page.locator('[data-pick="cust-g"]').click();
  await app.layer('[data-chip="s0-ent"]');

  const second = page.locator('[data-chip="s0-ent"][data-chip-value="__onetime2nd__"]');
  await expect(second).toContainText('一次性那一次');
  await second.click();
  await page.locator('[data-chip="s0-gexam"][data-chip-value="v-g-exam"]').click();
  await saveThrough(app, page);

  const v = (await app.readAll('visits')).find((x) => x.customerId === 'cust-g' && x.id !== 'v-g-exam');
  expect(v.slots[0]).toMatchObject({ oneTime: true, entitlementId: null, followupForVisitId: 'v-g-exam', courseId: 'course-followup' });
  const ent = await app.readDoc('customers/cust-g/entitlements', 'ent-g-2nd');
  expect(ent.bookedCount ?? 0, '不扣他買的那一筆二返').toBe(0);

  // 那一場約好之後就不欠了：再開一次新增（併進同一天、只畫新的那一段），那一顆不見了
  await openNew(app, page);
  await page.locator('[data-search]').fill('客戶A');
  await page.locator('[data-pick="cust-g"]').click();
  await app.layer('[data-chip$="-ent"]');
  await expect(page.locator('[data-chip$="-ent"][data-chip-value="__onetime2nd__"]')).toHaveCount(0);
});

test('B7 壓表：轉成我的客戶之後「二返（一次性那一次）」→ 接那一次一次性健檢（只有一次就先選好）→ 存：一次性、不扣', async ({ app, page }) => {
  const MONTH = TODAY.slice(0, 7);
  const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;
  await app.seed([
    ...masterDocs(), ...guestWithExam({ oneTime: false }),
    entitlement('cust-g', {
      id: 'ent-g-pool', label: '復能-三選一(60)', type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 12, doneCount: 0, bookedCount: 0, durationMin: 60,
    }),
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-g"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');

  const second = page.locator('[data-ent="__onetime2nd__"]');
  await expect(second).toContainText('一次性那一次');
  await second.click();
  await expect(page.locator('[data-exam="v-g-exam"]'), '只有一次就先選好').toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-time="10:00"]').click();
  const doc = page.locator('[data-doctor="staff-dr-xia"]');
  if (await doc.getAttribute('aria-pressed') !== 'true') await doc.click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const v = (await app.readAll('visits')).find((x) => x.customerId === 'cust-g' && x.id !== 'v-g-exam');
  expect(v.slots[0]).toMatchObject({ oneTime: true, entitlementId: null, followupForVisitId: 'v-g-exam', courseId: 'course-followup' });
  const ent = await app.readDoc('customers/cust-g/entitlements', 'ent-g-pool');
  expect(ent.bookedCount ?? 0).toBe(0);
});
