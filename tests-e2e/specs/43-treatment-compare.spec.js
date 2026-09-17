// 療程單比對：簽了的有沒有記、記了的有沒有簽（issue 15）。
//
// 她 2026-09-17：「這個診療單主要就是幫忙比對，客人確定有來有簽的時間段我有沒有漏壓到」
// 「其實大部分的時候診療單的內容都是落後的，可能兩三個月一次吧」。
//
// 四種對不上怎麼判、區間只到最後一次簽名在 `tests/treatment-compare.test.js`。
// 這一支盯畫面：那一行、點開的那幾件、連到日曆那一天、全部比對一次，以及**一筆來訪都沒有被改到**。
// 療程單的照片這裡不放（`photoPath: null`）—— 照片那條路是 42 的事。

import { test, expect } from '../fixtures/app.js';
import { customer, masterDocs } from '../fixtures/data.js';

const slot = (over) => ({
  startsAt: '09:00', endsAt: '10:00', status: 'done', roomId: null, bed: null, therapistId: 'staff-zn', doctorId: null,
  entitlementId: null, courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', ivProductId: null,
  attended: true, followupForVisitId: null, note: null, ...over,
});
const visit = (id, customerId, name, date, slots, status = 'done') => ({
  path: 'visits', id,
  data: {
    customerId, customerName: name, date, status, slots,
    confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null, note: null,
  },
});
const sheet = (customerId, name, id, rows) => ({
  path: `customers/${customerId}/treatmentSheets`, id,
  data: {
    customerId, customerName: name, courseIds: ['course-recovery'], ivProductIds: [], courseName: '復能',
    courseText: '筋骨強身 物理賦能課程', headerDate: null, rows, photoPath: null, photoAt: '2026-08-01T02:00:00.000Z',
    stalePhotoPaths: [],
  },
});
const row = (seq, date, equipmentId, signed = true) => ({ seq: String(seq), date, signed, equipmentIds: equipmentId ? [equipmentId] : [] });

function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明' }),
    customer({ id: 'cust-lee', name: '李小華' }),
    // 王小明：最後一次簽名 7/22，7/29 那一列沒簽 → 區間只到 7/22
    sheet('cust-wang', '王小明', 's-wang', [
      row(1, '2026-07-01', 'eq-sis'), row(2, '2026-07-08', 'eq-indiba'), row(3, '2026-07-15', 'eq-sis'),
      row(4, '2026-07-22', 'eq-sis'), row(5, '2026-07-29', null, false),
    ]),
    visit('v-w1', 'cust-wang', '王小明', '2026-07-01', [slot()]), // 對得上
    visit('v-w8', 'cust-wang', '王小明', '2026-07-08', [slot()]), // 單子勾 INDIBA、app 記 SIS
    visit('v-w10', 'cust-wang', '王小明', '2026-07-10', [slot({ equipmentId: 'eq-indiba' })]), // 單子上沒有
    visit('v-w15', 'cust-wang', '王小明', '2026-07-15', [slot({ status: 'confirmed' })], 'confirmed'), // 還沒結案
    // 7/22 簽了、app 沒有 → 漏記
    visit('v-w29', 'cust-wang', '王小明', '2026-07-29', [slot()]), // 區間外（最後一次簽名之後）
    visit('v-w805', 'cust-wang', '王小明', '2026-08-05', [slot()]), // 區間外
    // 李小華：全部對得上
    sheet('cust-lee', '李小華', 's-lee', [row(1, '2026-07-02', 'eq-sis'), row(2, '2026-07-09', 'eq-sis')]),
    visit('v-l2', 'cust-lee', '李小華', '2026-07-02', [slot()]),
    visit('v-l9', 'cust-lee', '李小華', '2026-07-09', [slot()]),
  ];
}

const snapshot = async (app) => JSON.stringify((await app.readAll('visits'))
  .map(({ updatedAt, createdAt, ...v }) => v).sort((a, b) => a.id.localeCompare(b.id)));

test('C1 那一位的療程單：一行講比到哪天、對得上幾次、要看幾件；點開四種各一件；去日曆停在那一天；一筆來訪都沒改', async ({ app, page }) => {
  await app.seed(seed());
  const before = await snapshot(app);
  await app.signIn('/settings/treatment-sheets/cust-wang');

  const card = page.locator('[data-sheet="s-wang"]');
  const line = card.locator('[data-sheet-compare="s-wang"]');
  await expect(line).toHaveText('比到 7/22(三)：對得上 1 次・要你看 4 件');
  await expect(card.locator('[data-sheet-issues]')).toBeHidden();
  await line.click();

  const issues = card.locator('.tsheet__issue');
  await expect(issues).toHaveText([
    /7\/8\(三\) 單子勾的是 INDIBA，app 記的是 SIS/,
    /7\/10\(五\) app 記 INDIBA 做完了，單子上這一天沒有簽/,
    /7\/15\(三\) 簽了 SIS，app 上還是「已確認」/,
    /7\/22\(三\) 簽了 SIS，app 沒有這一段/,
  ]);
  // 7/29、8/5 在最後一次簽名之後 → 不比
  await expect(card).not.toContainText('7/29');
  await expect(card).not.toContainText('8/5');

  // 這一頁上沒有任何一顆會寫來訪的按鈕：只有看照片、比對、去日曆、刪掉這一張
  const kinds = await page.locator('#view button').evaluateAll((els) => els.map((b) => Object.keys(b.dataset).join(',')));
  for (const k of kinds) expect(['sheetPhoto', 'sheetCompare', 'sheetDay', 'sheetDelete', 'sheetCamera', 'tip', '']).toContain(k.split(',')[0]);

  await issues.nth(3).locator('[data-sheet-day="2026-07-22"]').click();
  await expect(page).toHaveURL(/#\/calendar$/);
  await app.settled();
  await expect(page.locator('.monthweek__hit--on')).toHaveAttribute('data-day', '2026-07-22');

  expect(await snapshot(app), '比對只列不修').toBe(before);
});

test('C2 全部比對一次：只列有要看的那幾位，點進去是那一位', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/settings/treatment-sheets');
  await expect(page.locator('[data-sheet-compare-result]')).toBeEmpty();

  await page.locator('[data-sheet-compare-all]').click();
  const look = page.locator('[data-sheet-look]');
  await expect(look).toHaveCount(1);
  await expect(look).toContainText('王小明');
  await expect(look).toContainText('要你看 4 件');

  await look.click();
  await app.settled();
  await expect(page.locator('.page__title')).toHaveText('王小明');
  await expect(page.locator('[data-sheet-compare="s-wang"]')).toBeVisible();
});

test('C3 李小華那一張都對得上：那一行不是按鈕', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/settings/treatment-sheets/cust-lee');
  const card = page.locator('[data-sheet="s-lee"]');
  await expect(card.locator('.tsheet__compare')).toHaveText('比到 7/9(四)：對得上 2 次');
  await expect(card.locator('[data-sheet-compare]')).toHaveCount(0);
  await expect(card.locator('[data-sheet-photo]')).toContainText('照片不在備份裡');
});
