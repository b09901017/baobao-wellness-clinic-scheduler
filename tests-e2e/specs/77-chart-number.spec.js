// 病歷號是一格、在備註那一段是一顆丸子（before-golive-2026-10-19 issue 05，ADR-0160）。
//
// 只有瀏覽器量得到的那幾件：編輯與新增兩張表都填得到、存完那一顆畫在備註那一段、點了不開任何東西、
// 按住是複製、拖得動、同號那一句存檔前講、客戶清單打號碼找得到、390px 不撐寬、觸控區不跨到隔壁。
// 規則本身（搬家、認人、同號比對）在 `tests/chart-no-field.test.js`。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot } from '../fixtures/data.js';
import { seedDocs } from '../fixtures/emulator.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const clientA = (extra = {}) => customer({
  id: 'cust-c', name: '客戶A', phone: '0912-345-678',
  marks: [{ text: '喜歡下午', color: 'green' }],
  ...extra,
});

const chips = (page) => page.locator('[data-notesblock] [data-notes-row] > *').evaluateAll((els) =>
  els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('C1 編輯客戶 → 病歷號打 1234 → 存：備註那一段多一顆（電話後面）；點了不開任何東西', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-c');
  await expect(page.locator('[data-notes-chart]')).toHaveCount(0);

  await page.locator('[data-edit]').click();
  const input = page.locator('[data-form] input[name="chartNo"]');
  await expect(input).toHaveAttribute('inputmode', 'numeric');
  await expect(input).toHaveAttribute('type', 'text');
  await input.fill('1234');
  await page.locator('[data-form] button[type="submit"]').click();
  await app.saved();

  const chart = page.locator('[data-notesblock] [data-notes-chart]');
  await expect(chart).toHaveText('1234');
  await expect(chart.locator('.mark__glyph--chartNo svg')).toHaveCount(1);
  expect(await chips(page)).toEqual(['0912-345-678', '1234', '喜歡下午']);
  expect((await app.readDoc('customers', 'cust-c')).chartNo).toBe('1234');

  const url = page.url();
  await chart.click();
  await expect(page.locator('.lnov, .dialog, .drawer')).toHaveCount(0);
  expect(page.url()).toBe(url);

  const wide = await page.locator('.app__main').evaluate((m) => m.scrollWidth > m.clientWidth);
  expect(wide).toBe(false);
});

test('C2 按住病歷號是複製', async ({ app, page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await app.seed([...masterDocs(), clientA({ chartNo: '1234' })]);
  await app.signIn('/customers/cust-c');

  const b = await page.locator('[data-notesblock] [data-notes-chart]').boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(page.locator('#toast')).toContainText('已複製 1234', { timeout: 3000 });
  await page.mouse.up();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('1234');
});

test('C3 另一位已經是 1234 → 編輯存檔前講是誰；照樣存得進去', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA(), customer({ id: 'cust-w', name: '客戶B', chartNo: '00001234' })]);
  await app.signIn('/customers/cust-c');
  await page.locator('[data-edit]').click();
  await page.locator('[data-form] input[name="chartNo"]').fill('1234');
  await page.locator('[data-form] button[type="submit"]').click();
  await expect(app.dialog()).toContainText('病歷號 1234 已經是客戶B的');
  await app.ok();
  await app.saved();
  expect((await app.readDoc('customers', 'cust-c')).chartNo).toBe('1234');
});

test('C4 新增客戶：病歷號那一格、同號 ⚠、建好的人身上有那一格', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-w', name: '客戶B', chartNo: '4321' })]);
  await app.signIn('/customers/new');
  await page.locator('[data-cf-form] input[name="name"]').fill('客戶C');
  await page.locator('[data-cf-form] input[name="phone"]').fill('0911111111');
  const chart = page.locator('[data-cf-form] input[name="chartNo"]');
  await chart.fill('4321');
  await expect(page.locator('[data-cf-warn="chartNo"] .tip--warn')).toHaveCount(1);
  await chart.fill('1234');
  await expect(page.locator('[data-cf-warn="chartNo"] .tip--warn')).toHaveCount(0);
  await page.locator('.cform__bar button[type="submit"]').click();
  await app.saved();
  const made = (await app.readAll('customers')).find((c) => c.name === '客戶C');
  expect(made.chartNo).toBe('1234');
});

test('C5 調整順序拖得動病歷號；存完重新整理照舊', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA({ chartNo: '1234' })]);
  await app.signIn('/customers/cust-c');
  await page.locator('[data-notes-sort]').click();
  await app.layer('[data-reorder-box]');
  await expect(page.locator('[data-reorder-key="chartNo"]')).toContainText('1234');

  const box = await page.locator('[data-reorder-box]').boundingBox();
  const x = box.x + box.width - 20;
  // 起點：phone、chartNo、mark:0 —— 病歷號拖到最後（一列 50＋8px）
  await page.mouse.move(x, box.y + 1 * 58 + 25);
  await page.mouse.down();
  await page.mouse.move(x, box.y + 2 * 58 + 25, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('[data-reorder-key="chartNo"]')).not.toHaveClass(/is-lifted/);
  await page.locator('[data-notes-sort-done]').click();
  await app.saved();

  expect((await app.readDoc('customers', 'cust-c')).noteOrder).toEqual(['phone', 'mark', 'chartNo']);
  await app.reload();
  expect(await chips(page)).toEqual(['0912-345-678', '喜歡下午', '1234']);
});

test('C6 客戶清單打號碼找得到（補零一樣），還寫成短備註的也找得到', async ({ app, page }) => {
  await app.seed([...masterDocs(),
    clientA({ chartNo: '00001234' }),
    customer({ id: 'cust-o', name: '客戶D', marks: [{ text: '病歷號 4321', color: 'grey' }] }),
  ]);
  await app.signIn('/customers');
  const search = page.locator('[data-search]');
  await expect(search).toHaveAttribute('placeholder', /病歷號/);
  await search.fill('1234');
  await expect(page.locator('a.card[href="#/customers/cust-c"]')).toHaveCount(1);
  await expect(page.locator('a.card[href="#/customers/cust-o"]')).toHaveCount(0);
  await search.fill('4321');
  await expect(page.locator('a.card[href="#/customers/cust-o"]')).toHaveCount(1);
  await expect(page.locator('a.card[href="#/customers/cust-c"]')).toHaveCount(0);
});

test('C7 病歷號跟電話並排：按在兩顆中間那一段不會按到隔壁（觸控區貼在自己身上）', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA({ chartNo: '1234' })]);
  await app.signIn('/customers/cust-c');
  const phone = await page.locator('[data-notesblock] [data-notes-phone]').boundingBox();
  const chart = await page.locator('[data-notesblock] [data-notes-chart]').boundingBox();
  const y = chart.y + chart.height / 2;
  const at = (px) => page.evaluate(([x, yy]) => {
    const el = document.elementFromPoint(x, yy);
    return el?.closest('[data-notes-chart]') ? 'chart' : el?.closest('[data-notes-phone]') ? 'phone' : null;
  }, [px, y]);
  expect(await at(chart.x + 2)).toBe('chart');
  expect(await at(phone.x + phone.width - 2)).toBe('phone');
});

// ---------------------------------------------------------------------------
// 06 照片認人：名字對上、app 那一位沒有病歷號 → 不先勾、講一句；她勾了存的時候記上
// ---------------------------------------------------------------------------

test('C8 拍 Abovee：app 上的王小明沒有病歷號、照片上有 → 沒勾、講一句；勾了記錄 → 那一格記成 1234', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明' }),
    entitlement('cust-wang', {
      id: 'w-pool', type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12,
    }),
    {
      path: 'batches', id: 'b-sep',
      data: {
        targetMonth: '2026-09', status: 'active', cursor: null, lastDeviceHint: null,
        queue: [{ customerId: 'cust-wang', customerName: '王小明', state: 'pending', skippedReason: null }],
      },
    },
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator('[data-month="2026-09"]').click();
  await app.settled();

  await queueAi(['aboveeList-no-chart']);
  await page.locator('[data-abovee]').click();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto('no-chart.jpg', { width: 1600, height: 900 })]);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.abl')).toBeVisible({ timeout: 60_000 });

  const r = page.locator('[data-abl-row="a0"]');
  await expect(r.locator('.abl-row__tag')).toHaveText('新的');
  const check = r.locator('[data-abl-check]');
  await expect(check).toHaveAttribute('aria-checked', 'false');
  await expect(r.locator('.abl-row__hint--near')).toContainText('app 上這一位還沒有病歷號，照片上是 1234');

  await check.click();
  await expect(check).toHaveAttribute('aria-checked', 'true');
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('王小明 的病歷號記成 1234');
  await app.ok();
  await app.saved();
  await expect(page.locator('.abl')).toHaveCount(0);
  await expect.poll(async () => (await app.readDoc('customers', 'cust-wang')).chartNo).toBe('1234');
});

// ---------------------------------------------------------------------------
// 07 客戶清單的卡片：照她排的順序前四個
// ---------------------------------------------------------------------------

test('C10 客戶清單卡片：病歷號、長備註、電話、短備註 → 這四個、這個順序；卡片裡沒有巢狀的連結或按鈕；長的截成一行', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA({
    chartNo: '1234', lineId: '客戶A的LINE',
    longNotes: [{ id: 'n1', title: '家人與接送還有停車的地方還有一大串很長很長很長的字一直寫下去', body: '' }],
    marks: [{ text: '喜歡下午', color: 'green' }, { text: '指定女治療師', color: 'blue' }],
    noteOrder: ['chartNo', 'long:n1', 'phone', 'mark', 'line', 'mark'],
  })]);
  await app.signIn('/customers');

  const card = page.locator('a.card[href="#/customers/cust-c"]');
  const preview = card.locator('[data-notes-preview] > .mark:not(.mark--empty)');
  expect(await preview.evaluateAll((els) => els.map((el) => el.textContent.replace(/\s+/g, ' ').trim())))
    .toEqual(['1234', '家人與接送還有停車的地方還有一大串很長很長很長的字一直寫下去', '0912-345-678', '喜歡下午']);
  await expect(card.locator('[data-notes-preview] .mark--empty')).toHaveText('還有 2 則');
  expect(await card.evaluate((a) => a.querySelectorAll('a, button').length)).toBe(0);

  // 長的那一顆截成一行：高度是一行、整欄不撐寬（捲的是 .app__main）
  const long = card.locator('[data-notes-preview] .mark--long');
  const h = await long.evaluate((el) => el.getBoundingClientRect().height);
  expect(h).toBeLessThan(34);
  expect(await page.locator('.app__main').evaluate((m) => m.scrollWidth > m.clientWidth)).toBe(false);

  await card.click();
  await expect(page).toHaveURL(/#\/customers\/cust-c$/);
});

// ---------------------------------------------------------------------------
// 08 客戶清單左上角「客戶」被壓成直的
// ---------------------------------------------------------------------------

/** h1 是一行（高度 ≈ 一行的 line-height），右邊那一排每一顆都看得到。 */
async function titleOneLine(page) {
  return page.locator('.page__row').first().evaluate((row) => {
    const h1 = row.querySelector('.page__title');
    const line = parseFloat(getComputedStyle(h1).lineHeight);
    const links = [...row.querySelectorAll('.footlink')].map((a) => a.getBoundingClientRect());
    return {
      oneLine: h1.getBoundingClientRect().height < line * 1.5,
      allVisible: links.every((r) => r.width > 0 && r.right <= window.innerWidth + 0.5 && r.left >= -0.5),
    };
  });
}

for (const [w, h] of [[360, 780], [390, 844], [768, 1024]]) {
  test(`C11 ${w}px：「客戶」兩個字在同一行、三顆連結都看得到；換行的話兩排的觸控區不疊`, async ({ app, page }) => {
    await page.setViewportSize({ width: w, height: h });
    await app.seed([...masterDocs(), clientA()]);
    await app.signIn('/customers');
    await expect(page.locator('.page__title')).toHaveText('客戶');
    expect(await titleOneLine(page)).toEqual({ oneLine: true, allVisible: true });

    // 兩排的話：交界上下那一點各是自己那一排的
    const rows = await page.locator('.page__row .footlink').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().top));
    const tops = [...new Set(rows.map((t) => Math.round(t)))];
    if (tops.length > 1) {
      const [upper, lower] = await page.locator('.page__row .footlink').evaluateAll((els) => {
        const r = els.map((e) => e.getBoundingClientRect());
        const first = r[0];
        const second = r.find((x) => x.top > first.bottom);
        return [first, second];
      });
      const mid = (upper.bottom + lower.top) / 2;
      const who = (y) => page.evaluate(([x, yy]) => document.elementFromPoint(x, yy)?.closest('.footlink')?.textContent.trim() ?? null,
        [lower.left + 4, y]);
      expect(await who(lower.top + 1)).not.toBeNull();
      // 交界往上一點不可以按到下面那一排
      const above = await who(mid - 1);
      const lowerText = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.footlink')?.textContent.trim(), [lower.left + 4, lower.top + 1]);
      expect(above).not.toBe(lowerText);
    }
  });
}

test('C12 待辦首頁與壓表那一列的標題照舊一行（同一條 CSS）', async ({ app, page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await app.seed([...masterDocs()]);
  await app.signIn('/');
  await expect(page.locator('.page__row').first()).toBeVisible();
  expect((await titleOneLine(page)).oneLine).toBe(true);
  await app.go('/schedule');
  await app.settled();
  expect((await titleOneLine(page)).oneLine).toBe(true);
});

// ---------------------------------------------------------------------------
// 13 刪客戶之前讀全部（中途發現第 1 條）
// ---------------------------------------------------------------------------

test('C13 打開客戶詳情之後別台才記了一段待確認 → 按刪除照樣「還刪不掉」（按下去那一刻重讀，不拿打開時那一份）', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-c');
  await expect(page.locator('[data-danger]')).toBeVisible();

  await seedDocs([visit({
    id: 'v-late', customerId: 'cust-c', customerName: '客戶A', date: '2099-01-05',
    slots: [slot({ courseId: 'course-recovery', entitlementId: null, startsAt: '10:00', endsAt: '11:00' })],
  })]);

  await page.locator('[data-danger]').click();
  await page.locator('[data-delete]').click();
  await expect(app.dialog()).toContainText('還刪不掉');
  await app.cancelDialog();
  expect((await app.readDoc('customers', 'cust-c')).deletedAt ?? null).toBeNull();
});
