// 拍 Abovee：「app 有、這次照片上沒有」（course-form-and-sheet-2026-10-06/09，ADR-0129）。
//
// 她 2026-10-06：「能不能同個月，如果有這次拍照沒有的來訪也列出 … 如果沒有拍到但是我app卻有紀錄的話那可能是錯的」。
//
// 範圍怎麼算、對象是誰、哪幾段不算在 `tests/abovee-absent.test.js`；這一支盯只有瀏覽器看得到的那幾件：
// 那一塊畫在哪、抬頭的數字、**那一顆按鈕會不會讓她在看完之前丟掉照片**（照片不留，ADR-0101）。
// 模擬器裡的 Function 不叫 Gemini，回 `fixtures/ai/aboveeList-absent.json`。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, slot, visit } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const MONTH = '2026-09';
const POOL3 = { type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 };

function seed() {
  const sis = (id, date, status) => visit({
    id, customerId: 'cust-wang', customerName: '王小明', date, status,
    slots: [{ ...slot({ courseId: 'course-recovery', entitlementId: 'w-pool', equipmentId: 'eq-sis', startsAt: '09:00', endsAt: '10:00' }), status }],
  });
  return [
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }),
    customer({ id: 'cust-lee', name: '李小華', marks: [{ text: '病歷號 5678', color: 'grey' }] }),
    entitlement('cust-wang', { id: 'w-pool', ...POOL3 }),
    entitlement('cust-wang', { id: 'w-exam', label: '健檢', courseId: 'course-checkup', totalQty: 1 }),
    entitlement('cust-lee', { id: 'l-eecp', label: 'EECP', courseId: 'course-eecp', totalQty: 40 }),
    sis('v-03', '2026-09-03', 'confirmed'),
    sis('v-10', '2026-09-10', 'confirmed'),
    // 照片上沒有的那一段
    sis('v-24', '2026-09-24', 'pending_confirm'),
    // 健檢壓在 Examine → 不列
    visit({
      id: 'v-26', customerId: 'cust-wang', customerName: '王小明', date: '2026-09-26', status: 'confirmed',
      slots: [{ ...slot({ courseId: 'course-checkup', entitlementId: 'w-exam', startsAt: '09:00', endsAt: '11:00' }), status: 'confirmed' }],
    }),
    // 照片篩選的是王小明 → 別人的不列
    visit({
      id: 'v-lee', customerId: 'cust-lee', customerName: '李小華', date: '2026-09-24', status: 'confirmed',
      slots: [{ ...slot({ courseId: 'course-eecp', entitlementId: 'l-eecp', startsAt: '14:00', endsAt: '15:00' }), status: 'confirmed' }],
    }),
    {
      path: 'batches', id: 'b-sep',
      data: {
        targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
        queue: ['cust-wang', 'cust-lee'].map((id) => ({ customerId: id, customerName: '', state: 'pending', skippedReason: null })),
      },
    },
  ];
}

/** 壓表頁 → 右下角相機 → 相簿選一張 → 送出 → 確認層（同 51）。 */
async function photograph(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await queueAi(['aboveeList-absent']);
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto('absent.jpg', { width: 1600, height: 900 })]);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const gone = (page) => page.locator('.abl__group--gone');

test('G1 一個人一個月、只有一頁：9/24 那一段列出來（健檢、別人的不列）、抬頭算進要你看；按鈕先記勾起來的那一段再去日曆', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await photograph(app, page);

  await expect(page.locator('.abl__sum')).toHaveText('新的 1 段・已經記了 2 段・要你看 1 段');
  await expect(gone(page).locator('.abl__day')).toHaveText('app 有、這次照片上沒有');
  await expect(gone(page).locator('.abl__absentsay')).toHaveText('對過 王小明 9/1–9/30 在 app 上的段：這 1 段這次照片上沒有。');
  await expect(gone(page).locator('.abl-row')).toHaveCount(1);
  await expect(gone(page).locator('.abl-row')).toContainText('9/24(四)');
  await expect(gone(page).locator('.abl-row')).toContainText('SIS(60)');
  await expect(gone(page).locator('.abl-row__tag')).toHaveText('待確認');
  // 只講不改：列上一顆按鈕都沒有
  await expect(gone(page).locator('.abl-row button')).toHaveCount(0);

  // 9/17 那一列是新的、勾著 → 那一顆先走既有的存檔（同一道確認框），記好才換頁
  const go = gone(page).locator('[data-abl-gone]');
  await expect(go).toHaveText('先記勾起來的 1 段，再去日曆 9/24(四)');
  await go.click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();
  await expect(page).toHaveURL(/#\/calendar/);
  await expect(page.locator('.abl')).toHaveCount(0);
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0);
  const added = (await app.readAll('visits')).find((v) => v.date === '2026-09-17');
  expect(added?.slots.map((s) => [s.courseId, s.equipmentId, s.status])).toEqual([['course-recovery', 'eq-sis', 'pending_confirm']]);
});

test('G2 確認框按取消 → 留在這一層、照片還在；沒有勾的時候那一顆直接去日曆、什麼都不寫', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await photograph(app, page);

  const go = gone(page).locator('[data-abl-gone]');
  await go.click();
  await expect(app.dialog()).toBeVisible();
  await app.cancelDialog();
  await expect(page.locator('.abl')).toBeVisible();
  await expect(page.locator('.abl__thumb')).toHaveCount(1);

  // 把 9/17 那一列的勾拿掉 → 字跟著變
  await page.locator('[data-abl-row="a2"] [data-abl-check]').click();
  await expect(go).toHaveText('去日曆 9/24(四)（照片不會留著）');
  await go.click();
  await expect(page).toHaveURL(/#\/calendar/);
  await expect(page.locator('.abl')).toHaveCount(0);
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0);
  expect((await app.readAll('visits')).some((v) => v.date === '2026-09-17')).toBe(false);
});
