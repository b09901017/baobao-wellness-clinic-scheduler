// 健檢不是我排的：壓表（2026-11-02，ADR-0169，`.scratch/exam-not-mine/issues/07`）。
//
// 她沒點名壓表，但三個入口共用「做什麼」那一排（`slotOptionsFor()`），那一顆在壓表上一定會出現。
// 會在牆上的是「另外還有額度、健檢又不是她排的」那種客人（身上沒有剩次數的不會進佇列）。
//
// 盯的是：那一顆收在「送的／體驗／其他…」的「其他 ▸」裡；第幾返不預選、也不替她選健檢；只改 aria-pressed、不整頁重畫（ADR-0038）；
// 存進去不扣任何一筆額度；按回額度那一顆之後組出來的段乾淨（`resetCourseBoundPicks()`）；紅字在存檔前那一道講。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
/** 壓表那個月裡還沒過的一天（月底那幾天就用今天）。 */
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;
const EXAM_DATE = addDays(TODAY, -10);

const NOT_MINE = '[data-ent="__notmine__"]';

/** 別人轉來健檢的客人：身上一筆三選一（所以在牆上），沒有健檢、沒有二返額度。 */
const poolOnly = () => [
  customer({ id: 'cust-p', name: '王小明' }),
  entitlement('cust-p', {
    id: 'ent-p-pool', label: '復能-三選一(60)', type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
    totalQty: 12, doneCount: 2, bookedCount: 0, durationMin: 60,
  }),
];

/** 做完健檢、二返還沒約的客人（她不該按那一顆的那種）。 */
const examDone = () => [
  customer({ id: 'cust-e', name: '陳小強' }),
  entitlement('cust-e', {
    id: 'ent-e-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
    totalQty: 1, doneCount: 1, bookedCount: 0, tier: '8萬', durationMin: 120,
  }),
  entitlement('cust-e', {
    id: 'ent-e-2nd', label: '二返（8萬健檢）', type: 'single', courseId: 'course-followup',
    totalQty: 1, doneCount: 0, bookedCount: 0, followupForEntitlementId: 'ent-e-exam', durationMin: 30,
  }),
  visit({
    id: 'v-e-exam', customerId: 'cust-e', customerName: '陳小強', date: EXAM_DATE, status: 'done',
    slots: [slot({
      courseId: 'course-checkup', entitlementId: 'ent-e-exam', startsAt: '09:00', endsAt: '11:00',
      roomId: 'room-t3', attended: true, status: 'done',
    })],
  }),
];

async function openScheduleDay(app, page, customerId) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator(`[data-pick="${customerId}"]`).first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
}

/** 「送的／體驗／其他…」（收著才按）→「其他 ▸」→「健檢不是我排的」。 */
async function pickNotMine(page) {
  const fold = page.locator('[data-giftfold]');
  if (await fold.getAttribute('data-giftfold') !== 'open') await page.locator('[data-giftfold-more]').click();
  await expect(page.locator(NOT_MINE), '收在「其他 ▸」裡：點開之前看不到').toBeHidden();
  await page.locator('[data-giftfold-group="extra"]').click();
  await page.locator(NOT_MINE).click();
}

/** 醫師那一排：那一科剛好一位時已經先選好（`pickDoctorIfOnly()`），沒選好才按 —— 再按一次是取消 */
async function ensureDoctor(page, id = 'staff-dr-xia') {
  const doc = page.locator(`[data-doctor="${id}"]`);
  if (await doc.getAttribute('aria-pressed') !== 'true') await doc.click();
}

test('B1 壓表：有額度、沒健檢的客人 → 其他 ▸ → 健檢不是我排的 → 第幾返不預選、沒選擋下來 → 二返 → 存：不扣任何一筆、不接健檢；那一排沒有整塊重畫', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolOnly()]);
  await app.signIn('/');
  await openScheduleDay(app, page, 'cust-p');

  await expect(page.locator('[data-giftfold]')).toHaveAttribute('data-giftfold', 'closed');
  await expect(page.locator('[data-giftfold-more]')).toHaveText('送的／體驗／其他…');
  const fold = page.locator('[data-giftfold]');
  await fold.evaluate((el) => { el.dataset.e2eMark = 'same'; });

  await pickNotMine(page);
  await expect(page.locator(NOT_MINE)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(NOT_MINE)).toContainText('不扣次數');
  await expect(fold, '那一排沒有整塊重畫').toHaveAttribute('data-e2e-mark', 'same');

  await expect(page.locator('[data-nmnth]')).toHaveCount(9);
  await expect(page.locator('[data-nmnth][aria-pressed="true"]'), '不預選').toHaveCount(0);
  await expect(page.locator('[data-nth]'), '不是 n返 那一排').toHaveCount(0);
  await expect(page.locator('[data-exam]'), '不接健檢：沒有「這是哪一次健檢的」').toHaveCount(0);

  await page.locator('[data-time="10:00"]').click();
  await ensureDoctor(page);
  await page.locator('[data-add]').click();
  await expect(page.locator('[data-errors]')).toContainText('先選第幾返');

  await page.locator('[data-nmnth="2"]').click();
  await expect(page.locator('[data-nmnth="2"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText()).toContain('二返的健檢不是你排的');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-p');
  expect(v.slots[0]).toMatchObject({
    examNotMine: true, courseId: 'course-followup', courseName: '二返', entitlementId: null,
    followupForVisitId: null, giftKind: null, startsAt: '10:00', doctorId: 'staff-dr-xia', status: 'pending_confirm',
  });
  expect(v.slots[0], '二返不寫返數').not.toHaveProperty('followupNth');
  const ent = await app.readDoc('customers/cust-p/entitlements', 'ent-p-pool');
  expect([ent.doneCount, ent.bookedCount], '那一筆三選一一次都沒扣').toEqual([2, 0]);
});

test('B2 壓表：選了「健檢不是我排的」、四返，再按回額度那一顆存下去：組出來的段乾淨（沒有標記、沒有返數）', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolOnly()]);
  await app.signIn('/');
  await openScheduleDay(app, page, 'cust-p');

  await pickNotMine(page);
  await page.locator('[data-nmnth="4"]').click();
  await page.locator('[data-ent="ent-p-pool"]').click();
  await expect(page.locator('[data-nmnth]'), '換掉之後第幾返那一排不見了').toHaveCount(0);

  await page.locator('[data-equipment="eq-indiba"]').click();
  await page.locator('[data-time="10:00"]').click();
  await page.locator('[data-therapist="staff-tw"]').click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-p');
  expect(v.slots[0]).toMatchObject({ entitlementId: 'ent-p-pool', equipmentId: 'eq-indiba', giftKind: null });
  expect(v.slots[0]).not.toHaveProperty('examNotMine');
  expect(v.slots[0].followupNth ?? null).toBeNull();
});

test('B3 壓表：做完健檢、身上還有二返額度的客人按了它（二返）→ 存檔前那一道講兩句紅字（還有二返額度、有健檢接得上）', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...examDone()]);
  await app.signIn('/');
  await openScheduleDay(app, page, 'cust-e');

  await pickNotMine(page);
  await page.locator('[data-nmnth="2"]').click();
  await page.locator('[data-time="10:00"]').click();
  await ensureDoctor(page);
  await page.locator('[data-add]').click();

  await expect(app.dialog()).toBeVisible();
  const warned = await app.dialogText();
  expect(warned).toContain('二返（8萬健檢）');
  expect(warned).toContain('健檢接得上');
  // 先不要：一筆都沒存
  await app.cancelDialog();
  expect((await app.readAll('visits')).filter((x) => x.customerId === 'cust-e'), '只有那一次健檢').toHaveLength(1);
});
