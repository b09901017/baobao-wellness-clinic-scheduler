// 拍 Abovee：每一列收著就看得到治療師／醫師／診間（abovee-confirm-glance 02）。
//
// 她 11/3：
//
// > 我拍完照辨識完後，能不能也看到診間和醫師 不要我每個都要點開 像日曆那邊一樣 IN 60 某璇 或是像IL 60 治2，能讓我一眼確認，不對的我在點開就好
// > 想請你幫我確認，我辨識三返，有辨識到醫生嗎 ?
//
// 盯的是：照片上三返、還沒按任何一顆，列上就印得出醫師、點開醫師那一排先選好；沒認到的那一格是灰色「治療師？」；
// 已經記了的那一列印存完之後的人（「要改的」那一格拿掉勾就印 app 上的）、課程印日曆上的名字；手機寬（375）不橫向捲動。
// 規則的每一種形狀在 `tests/abovee-row-glance.test.js`。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, slot, visit } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const MONTH = '2026-09';

function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-p', name: '王小明' }),
    entitlement('cust-p', {
      id: 'ent-p-pool', label: '復能-三選一(60)', type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 12, doneCount: 0, bookedCount: 1, durationMin: 60,
    }),
    // 9/5 已經記了：治療師是芝寧，照片上寫騰崴
    visit({
      id: 'v-p05', customerId: 'cust-p', customerName: '王小明', date: '2026-09-05', status: 'confirmed',
      confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null,
      slots: [{
        ...slot({ courseId: 'course-recovery', entitlementId: 'ent-p-pool', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '11:00', therapistId: 'staff-zn' }),
        status: 'confirmed',
      }],
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
const people = (page, key) => row(page, key).locator('.abl-row__main .abl-row__person');

/** 照片底下那一個切換（ADR-0170）：`problems` 發現問題（要改的、要你看、列底下那幾句）、`result` 辨識結果 */
async function view(page, which) {
  await page.locator(`[data-abl-view="${which}"]`).click();
  await expect(page.locator(`[data-abl-view="${which}"]`)).toHaveAttribute('aria-pressed', 'true');
}

test('W1 拍 Abovee：列上印治療師／醫師（三返還沒按也印）、沒認到的灰色、已經記了的照「要改的」勾不勾印；375 寬不橫向捲', async ({ app, page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await app.seed(seed());
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-glance');

  // 三返、還沒按任何一顆：列上就有醫師（她第三件）
  await expect(row(page, 'a0').locator('.abl-row__course')).toHaveText('三返');
  await expect(people(page, 'a0')).toHaveText(['夏']);
  // 治療師的課：印治療師、不印診間
  await expect(people(page, 'a1')).toHaveText(['騰崴']);
  // 認不得服務資源：灰色「治療師？」
  await expect(people(page, 'a2')).toHaveText(['治療師？']);
  await expect(people(page, 'a2')).toHaveClass(/abl-row__person--none/);

  // 已經記了：課程印日曆上的名字（跟新的那一列同一種），不是照片原字；人印存完之後的（預設照 Abovee 改 → 騰崴）
  await expect(row(page, 'a3').locator('.abl-row__tag')).toHaveText('已經記了');
  await expect(row(page, 'a3').locator('.abl-row__course')).not.toHaveText('SIS 60');
  await expect(row(page, 'a3').locator('.abl-row__course')).toHaveText(await row(page, 'a1').locator('.abl-row__course').innerText());
  await expect(people(page, 'a3')).toHaveText(['騰崴']);
  // 「要改的」那一格（在「發現問題」那一頁，ADR-0170）拿掉 → 不改 → 辨識結果上印 app 上的芝寧
  await view(page, 'problems');
  await page.locator('[data-abl-change="adopt"][data-abl-for="a3"]').click();
  await expect(page.locator('[data-abl-change="adopt"][data-abl-for="a3"]')).toHaveAttribute('aria-checked', 'false');
  await view(page, 'result');
  await expect(people(page, 'a3')).toHaveText(['芝寧']);

  // 手機寬：每一列都不撐出橫向捲動，課程＋人那一格截在列裡面
  const overflow = await page.evaluate(() => {
    const wide = [...document.querySelectorAll('.abl, .abl *')].filter((el) => {
      const s = getComputedStyle(el);
      return ['auto', 'scroll'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
    }).map((el) => el.className);
    const rows = [...document.querySelectorAll('.abl-row__main')].filter((main) => {
      const glance = main.querySelector('.abl-row__glance');
      return glance && glance.getBoundingClientRect().right > main.getBoundingClientRect().right + 1;
    }).length;
    return { wide, rows, doc: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(overflow).toEqual({ wide: [], rows: 0, doc: false });

  // 點開三返那一列：還沒按任何一顆，醫師那一排照樣畫、照片上那一位先選好（她：「也不能選醫生」）
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0').locator('[data-abl-opt][aria-pressed="true"]')).toHaveCount(0);
  await expect(row(page, 'a0').locator('[data-abl-doctor="staff-dr-xia"]')).toHaveAttribute('aria-pressed', 'true');
  // 換一位醫師：列上那一行跟著換
  await row(page, 'a0').locator('[data-abl-doctor="staff-dr-xu"]').click();
  await expect(people(page, 'a0')).toHaveText(['許']);
});
