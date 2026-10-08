// 2026-10-08 上線前修正，第二段（`.scratch/prelaunch-fixes-2026-10-08/issues/09`–`14`）：拍 Abovee 與拍訂購單。
//
// 翻譯的規則在單元測試（`tests/abovee-*.test.js`、`tests/order-form*.test.js`）；這一支盯的是
// **她眼前那一層真的拿對的那一份資料、那一句真的畫在不用點開的地方**。
// 一段一支 spec，少開幾次模擬器（她的筆電會過熱）。
//
// 模擬器裡的 Function 不叫 Gemini，回 `fixtures/ai/*.json`。fixture 全部是編出來的（王小明、李小華、客戶A）。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, visit, slot, TODAY, addDays } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const MONTH = '2026-09';
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const POOL3 = { type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60 };

/** 壓表那一頁只讀最近 180 天；這幾天都在那之前。 */
const LONG_AGO = [0, 1, 2, 3, 4, 5].map((i) => addDays(TODAY, -200 - 14 * i));

function batch(ids) {
  return {
    path: 'batches', id: 'b-sep',
    data: {
      targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
      queue: ids.map((id) => ({ customerId: id, customerName: '', state: 'pending', skippedReason: null })),
    },
  };
}

/**
 * 王小明：兩筆營養點滴，「護肝排毒」半年前打完、「腸道修復」還沒用。
 * 李小華：身上有「體內金屬」，復能那一筆兩次都在半年前做完了。客戶A：什麼事都沒有。
 */
function seedHistory() {
  const done = (id, customerId, customerName, date, s) => visit({
    id, customerId, customerName, date, status: 'done', slots: [{ ...slot(s), status: 'done' }],
  });
  return [
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明', marks: chart('1234') }),
    customer({ id: 'cust-lee', name: '李小華', marks: chart('5678'), flags: ['體內金屬'] }),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-wang', { id: 'w-liver', label: '營養點滴-護肝排毒', courseId: 'course-iv-drip', ivProductId: 'iv-liver', totalQty: 6, doneCount: 6 }),
    entitlement('cust-wang', { id: 'w-gut', label: '營養點滴-腸道修復', courseId: 'course-iv-drip', ivProductId: 'iv-gut', totalQty: 6 }),
    entitlement('cust-lee', { id: 'l-pool', ...POOL3, totalQty: 2, doneCount: 2 }),
    entitlement('cust-a', { id: 'a-pool', ...POOL3, totalQty: 12 }),
    ...LONG_AGO.map((date, i) => done(`v-w${i}`, 'cust-wang', '王小明', date, {
      entitlementId: 'w-liver', courseId: 'course-iv-drip', ivProductId: 'iv-liver', startsAt: '10:00', endsAt: '11:30', roomId: 'room-iv5',
    })),
    ...LONG_AGO.slice(0, 2).map((date, i) => done(`v-l${i}`, 'cust-lee', '李小華', date, {
      entitlementId: 'l-pool', courseId: 'course-recovery', equipmentId: 'eq-sis', startsAt: '14:00', endsAt: '15:00', therapistId: 'staff-zn',
    })),
    batch(['cust-wang', 'cust-lee', 'cust-a']),
  ];
}

async function openBatch(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await expect(page.locator('[data-abovee]')).toBeVisible();
}

/** 壓表頁 → 右下角相機 → 相簿選一兩張 → 送出 → 確認層（同 `41-abovee`）。 */
async function photograph(page, fixtures) {
  await queueAi(fixtures);
  const files = [];
  for (const [i, name] of fixtures.entries()) {
    // eslint-disable-next-line no-await-in-loop
    files.push(await fakePhoto(`${name}-${i}.jpg`, { width: 1600, height: 900 }));
  }
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles(files);
  await expect(page.locator('.cam__thumb')).toHaveCount(fixtures.length);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.abl')).toBeVisible();
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const row = (page, key) => page.locator(`[data-abl-row="${key}"]`);

// ---------- 09 算「還剩幾次」拿的是這位客戶的全部來訪 ----------

test('P1 拍 Abovee：半年前打完的那一筆不會被預選 —— 預選的是還沒用的那一筆，品項不一樣那一句點開就在', async ({ app, page }) => {
  await app.seed(seedHistory());
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-history']);

  // 照片上寫的是護肝排毒；那一筆半年前打完了（壓表那一頁讀的 180 天裡一次都看不到）
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0').locator('[data-abl-opt="w-gut"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(row(page, 'a0').locator('[data-abl-opt="w-liver"]')).toHaveAttribute('aria-pressed', 'false');
  await expect(row(page, 'a0').locator('[data-abl-opt="w-liver"]')).toContainText('剩 0');
  await expect(row(page, 'a0').locator('.abl-row__warnings')).toContainText('品項跟買的不一樣');
  // 讀到全部了：沒有「沒有讀到全部」那一句，那一列照舊先勾好
  await expect(row(page, 'a0')).not.toContainText('沒有讀到全部');
  await expect(row(page, 'a0').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');
});

// ---------- 12 會改變寫入結果的提醒，不點開那一列也看得到 ----------

test('P2 拍 Abovee：體內金屬、超過總次數、品項不一樣那幾句收著也在；一路不點開，存檔前那一道也講', async ({ app, page }) => {
  await app.seed(seedHistory());
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-history']);

  // 李小華：身上有體內金屬、復能那一筆兩次都在半年前做完了。那一列預設打勾、收著
  await expect(row(page, 'a1').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 'a1').locator('[data-abl-open]')).toHaveAttribute('aria-expanded', 'false');
  const shut = row(page, 'a1').locator('.abl-row__hint--warn');
  await expect(shut).toHaveCount(2);
  await expect(shut.nth(0)).toContainText('SIS 對「體內金屬」要注意');
  await expect(shut.nth(1)).toContainText('排完這次會超過總次數');
  // 「還沒選治療師」那一種幾乎每一列都有，照舊點開才看
  await expect(row(page, 'a1')).not.toContainText('還沒選治療師');
  // 王小明那一列：品項跟買的不一樣。客戶A 什麼事都沒有：一個字都不多
  await expect(row(page, 'a0').locator('.abl-row__hint--warn')).toContainText('品項跟買的不一樣');
  await expect(row(page, 'a2').locator('.abl-row__hint')).toHaveCount(0);

  // 取消勾選的那一列不會寫進去：那一行跟著收掉，確認框也不算它
  await row(page, 'a0').locator('[data-abl-check]').click();
  await expect(row(page, 'a0').locator('.abl-row__hint--warn')).toHaveCount(0);

  await expect(page.locator('[data-abl-save]')).toHaveText('記錄這 2 段');
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('其中 1 段有提醒');
  await expect(app.dialog()).toContainText('李小華');
  await expect(app.dialog()).toContainText('SIS 對「體內金屬」要注意');
  await expect(app.dialog()).toContainText('排完這次會超過總次數');
  expect(await app.dialogText()).not.toMatch(/品項跟買的不一樣|還沒選治療師/);
  await app.cancelDialog();

  // 點開那一列：完整的那一份在底下（連「還沒選治療師」），收著的那一行不畫兩次
  await row(page, 'a1').locator('[data-abl-open]').click();
  await expect(row(page, 'a1').locator('.abl-row__hint--warn')).toHaveCount(0);
  await expect(row(page, 'a1').locator('.abl-row__warnings li')).toHaveCount(3);
  await expect(row(page, 'a1').locator('.abl-row__warnings')).toContainText('還沒選治療師');
});
