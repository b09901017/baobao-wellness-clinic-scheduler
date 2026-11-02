// 健檢不是我排的：拍 Abovee（2026-11-02，ADR-0169，`.scratch/exam-not-mine/issues/08`、`09`）。
//
// 她 11/2：
//
// > 我現在遇到的問題是，我拍了客戶A的三返，但是app會問這是哪一堂以及沒有n反讓我選也不能選醫生
// > 我想要的是我拍照後能認出三返或是二返或是四返，並且可以如果沒有綁健檢或是這個人身上沒有健檢的話只提醒他沒有，而是不是直接不能選 ?
//
// 盯的是：讀照片那一下不替她按、不替她勾（講一句、排進「要你看」）；那一顆收在「送的／體驗／其他…」的「其他 ▸」裡；
// 按了之後第幾返照照片、沒有「接哪一次健檢」、醫師選得到；存進去不扣任何一筆額度；再拍一次同一張是「已經記了」。
// 翻譯的細節在 `tests/exam-not-mine-abovee.test.js`。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, TODAY } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const MONTH = TODAY.slice(0, 7);
const NOT_MINE = '[data-abl-opt="__notmine__"]';

/** 別人轉來健檢的客人：身上一筆三選一（還有剩 —— 所以收合一打開是收著的），沒有健檢、沒有二返額度。 */
function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-p', name: '王小明' }),
    entitlement('cust-p', {
      id: 'ent-p-pool', label: '復能-三選一(60)', type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 12, doneCount: 2, bookedCount: 0, durationMin: 60,
    }),
    {
      path: 'batches', id: 'b-now',
      data: {
        targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
        queue: [{ customerId: 'cust-p', customerName: '', state: 'pending', skippedReason: null }],
      },
    },
  ];
}

/** 壓表頁 → 右下角相機 → 相簿選一張 → 送出 → 確認層（同 51）。 */
async function photograph(app, page, name) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await queueAi([name]);
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto(`${name}.jpg`, { width: 1600, height: 900 })]);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const row = (page, key) => page.locator(`[data-abl-row="${key}"]`);

/** 點開著的那一列：「送的／體驗／其他…」（收著才按）→「其他 ▸」→「健檢不是我排的」。 */
async function pickNotMine(page, key) {
  const r = row(page, key);
  const fold = r.locator('[data-giftfold]');
  if (await fold.getAttribute('data-giftfold') !== 'open') await r.locator('[data-giftfold-more]').click();
  await expect(r.locator(NOT_MINE), '收在「其他 ▸」裡：點開之前看不到').toBeHidden();
  await r.locator('[data-giftfold-group="extra"]').click();
  await r.locator(NOT_MINE).click();
  await expect(r.locator(NOT_MINE)).toHaveAttribute('aria-pressed', 'true');
}

test('Y1 拍 Abovee：沒有健檢、沒有二返額度的客人，三返與二返 → 不替她按、不勾、講一句 → 按「健檢不是我排的」、選醫師、勾 → 存：不扣、不接健檢；再拍一次是「已經記了」', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-not-mine');

  // 讀照片那一下：兩列都排進「要你看」、沒勾、一顆都沒按，那一句指她去「其他」
  for (const [key, label] of [['a0', '三返'], ['a1', '二返']]) {
    await expect(page.locator(`.abl__group--look [data-abl-row="${key}"]`)).toHaveCount(1);
    await expect(row(page, key).locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');
    const hint = row(page, key).locator('.abl-row__hint').first();
    await expect(hint).toContainText(`照片上是${label}`);
    await expect(hint).toContainText('「其他」、按「健檢不是我排的」');
  }
  await expect(row(page, 'a1').locator('.abl-row__hint').first()).toContainText('沒有二返額度');
  await expect(page.locator('[data-abl-save]'), '一列都沒勾：記錄按不下去').toBeDisabled();

  // a0（三返）：點開 → 那一排一顆都沒按 → 其他 ▸ → 按它 → 第幾返照照片按好三返、不是 n返 那一排、沒有接哪一次健檢
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0').locator('[data-abl-opt]').first()).toBeVisible();
  await expect(row(page, 'a0').locator('[data-abl-opt][aria-pressed="true"]')).toHaveCount(0);
  await pickNotMine(page, 'a0');
  await expect(row(page, 'a0').locator(NOT_MINE)).toContainText('不扣次數');
  await expect(row(page, 'a0').locator('[data-abl-nmnth]')).toHaveCount(9);
  await expect(row(page, 'a0').locator('[data-abl-nmnth="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a0').locator('[data-abl-nth]'), '不是 n返 那一排').toHaveCount(0);
  await expect(row(page, 'a0').locator('[data-abl-exam]'), '不接健檢').toHaveCount(0);
  await expect(row(page, 'a0').locator('.abl-row__hint', { hasText: '健檢不是我排的' }), '按了就不再講').toHaveCount(0);
  // 醫師那一排選得到（她：「也不能選醫生」）
  await row(page, 'a0').locator('[data-abl-doctor="staff-dr-xia"]').click();
  await expect(row(page, 'a0').locator('[data-abl-doctor="staff-dr-xia"]')).toHaveAttribute('aria-pressed', 'true');
  await row(page, 'a0').locator('[data-abl-check]').click();
  await expect(row(page, 'a0').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 'a0').locator('.abl-row__problems')).toHaveCount(0);
  // 沒有二返額度、沒有健檢：一句紅字都不跳
  await expect(row(page, 'a0').locator('.abl-row__warnings')).toHaveCount(0);

  // a1（二返）：第幾返是二返；換成四返再換回二返也照按
  await row(page, 'a1').locator('[data-abl-open]').click();
  await pickNotMine(page, 'a1');
  await expect(row(page, 'a1').locator('[data-abl-nmnth="2"]')).toHaveAttribute('aria-pressed', 'true');
  await row(page, 'a1').locator('[data-abl-nmnth="4"]').click();
  await expect(row(page, 'a1').locator('[data-abl-nmnth="4"]')).toHaveAttribute('aria-pressed', 'true');
  await row(page, 'a1').locator('[data-abl-nmnth="2"]').click();
  await row(page, 'a1').locator('[data-abl-doctor="staff-dr-xia"]').click();
  await row(page, 'a1').locator('[data-abl-check]').click();

  await expect(page.locator('[data-abl-save]')).toHaveText('記錄這 2 段');
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('三返的健檢不是你排的');
  await expect(app.dialog()).toContainText('二返的健檢不是你排的');
  await app.ok();
  await app.saved();
  await expect(page.locator('.abl')).toHaveCount(0);

  const visits = (await app.readAll('visits')).filter((v) => v.customerId === 'cust-p').sort((a, b) => a.date.localeCompare(b.date));
  expect(visits.map((v) => v.date)).toEqual(['2026-08-30', '2026-08-31']);
  expect(visits[0].slots).toHaveLength(1);
  expect(visits[0].slots[0]).toMatchObject({
    examNotMine: true, courseId: 'course-followup', courseName: '三返', followupNth: 3, entitlementId: null,
    followupForVisitId: null, giftKind: null, startsAt: '10:00', doctorId: 'staff-dr-xia', status: 'pending_confirm',
  });
  expect(visits[1].slots[0]).toMatchObject({
    examNotMine: true, courseId: 'course-followup', courseName: '二返', entitlementId: null,
    followupForVisitId: null, giftKind: null, startsAt: '14:00', doctorId: 'staff-dr-xia', status: 'pending_confirm',
  });
  expect(visits[1].slots[0], '二返不寫返數').not.toHaveProperty('followupNth');
  const ent = await app.readDoc('customers/cust-p/entitlements', 'ent-p-pool');
  expect([ent.doneCount, ent.bookedCount], '那一筆三選一一次都沒扣').toEqual([2, 0]);

  // 日曆上那一天印三返（不是二返）
  await app.go('/calendar');
  await page.locator('[data-day="2026-08-30"]').first().click();
  await app.layer('[data-open^="visit:"]');
  await expect(page.locator('[data-open^="visit:"]').first()).toContainText('三返');

  // 再拍一次同一張 → 兩列都是「已經記了」、沒有勾、沒有那一句、記錄按不下去（不會多記一段）
  await photograph(app, page, 'aboveeList-not-mine');
  for (const key of ['a0', 'a1']) {
    await expect(row(page, key).locator('.abl-row__tag')).toHaveText('已經記了');
    await expect(row(page, key).locator('.abl-row__hint', { hasText: '健檢不是我排的' })).toHaveCount(0);
  }
  await expect(page.locator('[data-abl-save]')).toBeDisabled();
  await page.locator('[data-abl-close]').click();
  expect((await app.readAll('visits')).filter((v) => v.customerId === 'cust-p')).toHaveLength(2);
});
