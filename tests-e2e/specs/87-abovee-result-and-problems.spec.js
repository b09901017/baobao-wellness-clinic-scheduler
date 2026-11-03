// 拍 Abovee 辨識完：照片底下切換「辨識結果」／「發現問題 N」（abovee-confirm-glance 04，ADR-0170）。
//
// 她 11/3：
//
// > 能不能不要上面那段話，像是"對過 … 都在這次的照片上。"，… 讓我認知負荷過載，我在想能不能有一個切換功能 …
// > 就是那健檢出來，"要你看"，不一樣等等怪怪的地方，能不能切換之後才看到，然後我剛拍完照辨識完我希望出現的畫面就是如圖那樣，不要有說明文字
// > 一列有好幾個提醒時，只寫最要緊的那一個，後面接「+1」字是紅的、短的，掃過去一眼就看得到
//
// 盯的是：剛打開一句說明都沒有；什麼事都沒有時「發現問題 0」灰掉；有事的列收著就有紅字短標記（手機寬也不被截、不橫向捲）；
// 「發現問題」上的 N 等於那一頁列出來的件數；在那一頁拿掉勾、回到辨識結果是同一個勾、最後一件處理完回到辨識結果；
// 「要改的」她沒切過去就按記錄，確認框照樣講。N 的數法在 `tests/abovee-problems-page.test.js`。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, slot, visit } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const MONTH = '2026-09';
const POOL3 = { type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60 };

/** 辨識結果上不可以有的那幾種（說明句、列底下的提示行、「發現問題」那一頁的每一塊） */
const EXPLAINERS = [
  '.abl__absentsay', '.abl-row__hint', '.abl__pairing', '.abl__notes',
  '.abl__group--look', '.abl__group--flag', '.abl__group--change', '.abl__group--later', '.abl__group--gone',
];

function batch(id) {
  return {
    path: 'batches', id: 'b-sep',
    data: {
      targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
      queue: [{ customerId: id, customerName: '', state: 'pending', skippedReason: null }],
    },
  };
}

/** 壓表頁 → 右下角相機 → 相簿選一張 → 送出 → 確認層（同 `86`）。 */
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
const tab = (page, which) => page.locator(`[data-abl-view="${which}"]`);

async function view(page, which) {
  await tab(page, which).click();
  await expect(tab(page, which)).toHaveAttribute('aria-pressed', 'true');
}

/** 「發現問題」那一頁列出來的列有幾列（同一列只畫一次）＋沒拍到的段 */
const listed = (page) => page.locator('.abl__body [data-abl-row], .abl-row--gone').count();

test('R1 什麼事都沒有：一句說明都沒有、「發現問題 0」灰掉按不下去', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-b', { id: 'b-pool', ...POOL3, totalQty: 12 }),
    batch('cust-b'),
  ]);
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-days');

  await expect(page.locator('[data-abl-row]')).toHaveCount(3);
  await expect(tab(page, 'result')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab(page, 'problems')).toHaveText('發現問題 0');
  await expect(tab(page, 'problems')).toBeDisabled();
  for (const sel of EXPLAINERS) {
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator(sel), sel).toHaveCount(0);
  }
  await expect(page.locator('.abl-row__flag')).toHaveCount(0);
  // 抬頭那一行照留（她沒劃掉）
  await expect(page.locator('.abl__sum')).toHaveText('新的 3 段');
});

test('R2 有事的列收著就有紅字短標記（375 寬不截、不橫捲）；N＝那一頁列出來的；那一頁拿掉勾、回到辨識結果是同一個勾；最後一件處理完回到辨識結果', async ({ app, page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-b', { id: 'b-pool', ...POOL3, totalQty: 1 }),
    batch('cust-b'),
  ]);
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-days');

  // 只買 1 次、三天各一段、都勾著 → 三列都「次數不夠」；辨識結果上一句說明都沒有
  for (const key of ['a0', 'a1', 'a2']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(row(page, key).locator('.abl-row__flag')).toHaveText('次數不夠');
  }
  for (const sel of EXPLAINERS) {
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator(sel), sel).toHaveCount(0);
  }
  // 手機寬：標記整個在列裡面（前面那一格截、標記不截），整層不橫向捲
  const fit = await page.evaluate(() => {
    const flags = [...document.querySelectorAll('.abl-row__flag')].map((flag) => {
      const main = flag.closest('.abl-row__main').getBoundingClientRect();
      const box = flag.getBoundingClientRect();
      return box.width > 0 && box.left >= main.left - 1 && box.right <= main.right + 1 && flag.scrollWidth <= flag.clientWidth + 1;
    });
    const wide = [...document.querySelectorAll('.abl, .abl *')].filter((el) => {
      const s = getComputedStyle(el);
      return ['auto', 'scroll'].includes(s.overflowX) && el.scrollWidth > el.clientWidth + 1;
    }).map((el) => el.className);
    return { flags, wide, doc: document.documentElement.scrollWidth > document.documentElement.clientWidth };
  });
  expect(fit).toEqual({ flags: [true, true, true], wide: [], doc: false });

  // 發現問題 3：那一頁列的就是那三列（「有提醒的」），整句在列底下、時間前面有日期
  await expect(tab(page, 'problems')).toHaveText('發現問題 3');
  await view(page, 'problems');
  await expect(page.locator('.abl__group--flag [data-abl-row]')).toHaveCount(3);
  expect(await listed(page)).toBe(3);
  await expect(row(page, 'a0').locator('.abl-row__hint--warn')).toContainText('排完這次會超過總次數');
  await expect(row(page, 'a0').locator('.abl-row__date')).toHaveText('9/22(二)');
  await expect(page.locator('.abl__absentsay'), '都在照片上：那一塊不畫').toHaveCount(0);

  // 在這一頁拿掉 a1 的勾：它不會寫進去 → 離開這一頁；剩兩列照舊超用 → N 跟著變
  await row(page, 'a1').locator('[data-abl-check]').click();
  await expect(row(page, 'a1')).toHaveCount(0);
  await expect(tab(page, 'problems')).toHaveText('發現問題 2');
  expect(await listed(page)).toBe(2);

  // 再拿掉 a2：剩 a0 剛好 1 次 → 最後一件也處理了 → 回到辨識結果、那一顆灰掉
  await row(page, 'a2').locator('[data-abl-check]').click();
  await expect(tab(page, 'result')).toHaveAttribute('aria-pressed', 'true');
  await expect(tab(page, 'problems')).toHaveText('發現問題 0');
  await expect(tab(page, 'problems')).toBeDisabled();
  await expect(page.locator('.abl-row__flag')).toHaveCount(0);
  // 同一個勾：在那一頁拿掉的，這一頁也是拿掉的
  await expect(row(page, 'a0').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');
  await expect(row(page, 'a1').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');
  await expect(row(page, 'a2').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');

  // 記錄寫進去的就是勾著的那一列
  await expect(page.locator('[data-abl-save]')).toHaveText('記錄這 1 段');
  await page.locator('[data-abl-save]').click();
  await app.ok();
  await app.saved();
  const added = await app.readAll('visits');
  expect(added.map((v) => v.date)).toEqual(['2026-09-22']);
});

test('R3「要改的」預設勾著、她沒切到發現問題就按記錄：確認框照樣講要改的那一件', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-p', name: '王小明' }),
    entitlement('cust-p', {
      id: 'ent-p-pool', label: '復能-三選一(60)', type: 'pool', optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 12, doneCount: 0, bookedCount: 1, durationMin: 60,
    }),
    // 9/5 已經記了：治療師是芝寧，照片上寫騰崴 →「要改的」那一行預設勾
    visit({
      id: 'v-p05', customerId: 'cust-p', customerName: '王小明', date: '2026-09-05', status: 'confirmed',
      confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null,
      slots: [{
        ...slot({ courseId: 'course-recovery', entitlementId: 'ent-p-pool', equipmentId: 'eq-sis', startsAt: '10:00', endsAt: '11:00', therapistId: 'staff-zn' }),
        status: 'confirmed',
      }],
    }),
    batch('cust-p'),
  ]);
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-glance');

  // 辨識結果上：「要改的」那一塊不在這一頁，只在那一顆的數字裡
  await expect(page.locator('.abl__group--change')).toHaveCount(0);
  await expect(tab(page, 'problems')).toBeEnabled();
  await expect(page.locator('.abl__sum')).toContainText('要改 1 段');

  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('治療師成 Abovee 上的');
  await app.cancelDialog();
  await expect(tab(page, 'result'), '取消之後還在原本那一頁').toHaveAttribute('aria-pressed', 'true');
});
