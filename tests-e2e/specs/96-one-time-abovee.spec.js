// 一次性客人：拍 Abovee（2026-11-05，ADR-0172，`.scratch/one-time-guests/issues/07`）。
//
// 第 4 題：照片上「app 裡沒有」那一列多一顆「記成一次性客人」（照片上的名字＋病歷號建名字卡、她按了才建），之後勾得起來、照照片填。
// 第 5 題：「換一位」的搜尋結果標「一次性」。
// 翻譯的細節在 `tests/one-time-abovee.test.js`。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, TODAY } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const MONTH = TODAY.slice(0, 7);
const PHOTO = 'aboveeList-one-time';

/** 一次性客人客戶G（健檢不在 app 裡）、一般客戶王小明（一對健檢＋二返）；壓表開著一批（拍照的入口在壓表頁）。 */
function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-g', name: '客戶G', oneTime: true, active: true }),
    customer({ id: 'cust-p', name: '王小明' }),
    entitlement('cust-p', { id: 'ent-p-exam', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1, doneCount: 0, bookedCount: 0 }),
    entitlement('cust-p', {
      id: 'ent-p-fu', label: '二返（8萬健檢）', courseId: 'course-followup', followupForEntitlementId: 'ent-p-exam',
      totalQty: 1, doneCount: 0, bookedCount: 0,
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

/** 壓表頁 → 右下角相機 → 相簿選一張 → 送出 → 確認層（同 85）。 */
async function photograph(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await queueAi([PHOTO]);
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto(`${PHOTO}.jpg`, { width: 1600, height: 900 })]);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const row = (page, key) => page.locator(`[data-abl-row="${key}"]`);

test('T1 app 裡沒有的那一列：沒按就勾不起來 → 記成一次性客人（名字、病歷號帶好）→ 兩列都認得、二返接他的健檢 → 存：一次性、不扣', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await photograph(app, page);

  // 沒按：認不得、勾不起來
  await expect(row(page, 'a0').locator('.abl-row__tag')).toHaveText('app 裡沒有');
  await expect(row(page, 'a0').locator('[data-abl-check]')).toBeDisabled();
  await expect(row(page, 'a1').locator('[data-abl-check]')).toBeDisabled();

  // 點開：那一句講兩條路、一顆「記成一次性客人」
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0').locator('.abl-row__say').first()).toContainText('記成一次性客人');
  await row(page, 'a0').locator('[data-abl-guest]').click();
  const form = row(page, 'a0').locator('[data-gf-form]');
  await expect(form.locator('[name="name"]')).toHaveValue('客戶E');
  await expect(form.locator('[name="chartNo"]')).toHaveValue('00000777');
  await expect(form.locator('[name="lineId"]'), '快速表單：沒有 LINE 名字').toHaveCount(0);
  await form.locator('[data-gf-submit]').click();
  await app.saved();

  // 名字卡建好了（一次性）
  const guests = (await app.readAll('customers')).filter((c) => c.name === '客戶E');
  expect(guests).toHaveLength(1);
  expect(guests[0]).toMatchObject({ oneTime: true, chartNo: '00000777', active: true });

  // 兩列都變成新的、照照片勾；二返先接好同一張照片上他的健檢
  for (const key of ['a0', 'a1']) {
    await expect(row(page, key).locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');
  }
  await row(page, 'a1').locator('[data-abl-open]').click();
  await expect(row(page, 'a1').locator('.abl-row__whonow .guestmark')).toHaveText('一次性');
  await expect(row(page, 'a1').locator('[data-abl-opt="__guest__:course-followup"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a1').locator('[data-abl-exam][aria-pressed="true"]')).toHaveCount(1);
  await expect(row(page, 'a1').locator('[data-abl-opt^="__course__"]'), '一次性客人那一排沒有送的／體驗').toHaveCount(0);

  await expect(page.locator('[data-abl-save]')).toHaveText('記錄這 2 段');
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).not.toContainText('扣');
  await app.ok();
  await app.saved();
  await expect(page.locator('.abl')).toHaveCount(0);

  const visits = (await app.readAll('visits')).filter((v) => v.customerId === guests[0].id).sort((a, b) => a.date.localeCompare(b.date));
  expect(visits.map((v) => v.date)).toEqual(['2026-09-02', '2026-09-09']);
  expect(visits[0].slots[0]).toMatchObject({ oneTime: true, courseId: 'course-checkup', entitlementId: null, giftKind: null });
  expect(visits[1].slots[0]).toMatchObject({
    oneTime: true, courseId: 'course-followup', entitlementId: null, giftKind: null, followupForVisitId: visits[0].id,
  });
  const fu = await app.readDoc('customers/cust-p/entitlements', 'ent-p-fu');
  expect([fu.doneCount, fu.bookedCount], '別人的二返額度沒被動到').toEqual([0, 0]);

  // 日曆上那一天看得到他；再拍一次：客戶E 直接認得、是「已經記了」
  await app.go('/calendar');
  await page.locator('[data-day="2026-09-02"]').first().click();
  await app.layer('[data-open^="visit:"]');
  await expect(page.locator('[data-open^="visit:"]').first()).toContainText('客戶E');
  await photograph(app, page);
  await expect(row(page, 'a0').locator('.abl-row__tag')).toHaveText('已經記了');
  await expect(row(page, 'a1').locator('.abl-row__tag')).toHaveText('已經記了');
});

test('T2 一次性客人的二返接不上健檢 → 不勾、講一句；換一位標「一次性」，一般 ⇄ 一次性來回換不殘留', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await photograph(app, page);

  // 讀照片那一下：不勾、那一句講一次性客人與「健檢不是我排的」，「二返」那一顆按著（不替她按「健檢不是我排的」）
  await expect(row(page, 'a2').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');
  await page.locator('[data-abl-view="problems"]').click();
  const hint = row(page, 'a2').locator('.abl-row__hint').first();
  await expect(hint).toContainText('一次性客人');
  await expect(hint).toContainText('健檢不是我排的');
  await page.locator('[data-abl-view="result"]').click();
  await row(page, 'a2').locator('[data-abl-open]').click();
  await expect(row(page, 'a2').locator('[data-abl-opt="__guest__:course-followup"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a2').locator('[data-abl-opt="__notmine__"][aria-pressed="true"]')).toHaveCount(0);

  // 換一位：搜尋結果裡一次性客人標「一次性」、一般客戶不標
  await row(page, 'a2').locator('[data-abl-find]').click();
  await row(page, 'a2').locator('[data-abl-query]').fill('客戶G');
  await expect(row(page, 'a2').locator('[data-abl-who="cust-g"] .guestmark')).toHaveText('一次性');
  await row(page, 'a2').locator('[data-abl-query]').fill('王小明');
  await expect(row(page, 'a2').locator('[data-abl-who="cust-p"]')).toBeVisible();
  await expect(row(page, 'a2').locator('[data-abl-who="cust-p"] .guestmark')).toHaveCount(0);

  // 換成一般客戶：那一排是他的額度、預選他的二返額度
  await row(page, 'a2').locator('[data-abl-who="cust-p"]').click();
  await expect(row(page, 'a2').locator('[data-abl-opt="ent-p-fu"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a2').locator('[data-abl-opt^="__guest__"]')).toHaveCount(0);

  // 換回一次性客人：一次性那一排、二返按著、他的額度那一顆不在
  await row(page, 'a2').locator('[data-abl-find]').click();
  await row(page, 'a2').locator('[data-abl-query]').fill('客戶G');
  await row(page, 'a2').locator('[data-abl-who="cust-g"]').click();
  await expect(row(page, 'a2').locator('[data-abl-opt="__guest__:course-followup"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a2').locator('[data-abl-opt="ent-p-fu"]')).toHaveCount(0);
});
