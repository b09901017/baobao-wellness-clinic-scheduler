// 她 10/18 在 staging 上點出來的六個小畫面（.scratch/staging-polish-2026-10-18/ 的 01～06）。
//
// 每一條都只有瀏覽器量得到：兩排按鈕之間的距離、收合之後撐不撐得過重畫、
// 抽屜拉高之後最下面那一顆點不點得到、手指拖走之後復原有沒有被觸發。
// 量的是 `getBoundingClientRect()` 與 `elementFromPoint()`，不是 CSS 字串 ——
// CLAUDE.md「貼在畫面底部的東西」那一列講過量字串會綠著騙人。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, TODAY } from '../fixtures/data.js';

/** 等那一個停下來（抽屜滑上來的過場還在走的時候量到的是半路的位置）。 */
async function steady(loc) {
  let last = null;
  await expect.poll(async () => {
    const y = (await loc.boundingBox())?.y ?? null;
    const same = y !== null && y === last;
    last = y;
    return same;
  }, { intervals: [50, 100, 100, 200] }).toBe(true);
}

/** 上面那一個的下緣到下面那一個的上緣。 */
async function gapBetween(upper, lower) {
  await steady(lower);
  const a = await upper.boundingBox();
  const b = await lower.boundingBox();
  return b.y - (a.y + a.height);
}

// ---------------------------------------------------------------------------
// 01 「＋ 加一項」跟送出那一排拉開
// ---------------------------------------------------------------------------

test('P1 三個「＋ 加一項」跟底下那一排都隔開至少 22px，而且看起來是清單的最後一列', async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.seed([...masterDocs(), customer({ id: 'cust-p', name: '客戶A' })]);

  // 客戶詳情 → 加購方案（她圖 4 那一張）
  await app.signIn('/customers/cust-p');
  await page.locator('[data-add-plan]').click();
  await page.locator('[data-chip="planId"]').first().click();
  const add = page.locator('[data-addextra]');
  await expect(add).toBeVisible();
  const submit = page.locator('[data-planform] .form__actions button[type="submit"]');
  expect(await gapBetween(add, submit), '客戶詳情：加一項 → 加購').toBeGreaterThanOrEqual(22);
  await expect(add, '虛線外框：清單的最後一列，不是另一顆送出鈕').toHaveClass(/btn--addrow/);

  // 新增客戶
  await app.go('/customers/new');
  const cfAdd = page.locator('[data-cf-addextra]');
  await expect(cfAdd).toBeVisible();
  expect(await gapBetween(cfAdd, page.locator('#cf-remember')), '新增客戶：加一項 → 下一段').toBeGreaterThanOrEqual(22);
  await expect(cfAdd).toHaveClass(/btn--addrow/);

  // 批次建立 → 微調
  await app.go('/customers/bulk');
  await page.locator('[data-name]').fill('客戶B');
  await page.locator('[data-name]').press('Enter');
  await page.locator('[data-tune]').first().click();
  const tuneAdd = page.locator('.drawer [data-addextra]');
  await expect(tuneAdd).toBeVisible();
  expect(await gapBetween(tuneAdd, page.locator('[data-apply]')), '批次建立：加一項 → 好了').toBeGreaterThanOrEqual(22);
  await expect(tuneAdd).toHaveClass(/btn--addrow/);
});

// ---------------------------------------------------------------------------
// 04 日曆那一天的抽屜按「＋」：先拉到全高，選單才不會被螢幕底部切掉
// ---------------------------------------------------------------------------

test('P4 390×844：半高的那一天按「＋」→ 抽屜拉到全高、三顆都在畫面裡、最下面那一顆點得到；收起選單不退回半高、不多一層返回', async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.seed([...masterDocs()]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  const drawer = page.locator('.drawer');
  await steady(drawer);
  const peekTop = (await drawer.boundingBox()).y;
  expect(peekTop, '一打開是半高').toBeGreaterThan(200);
  const depth = await page.evaluate(() => history.length);

  await page.locator('[data-addmenu-toggle]').click();
  const items = page.locator('[data-addmenu-list] [data-add]');
  await expect(items).toHaveCount(3);
  await expect(items.last()).toBeVisible();
  await steady(items.last());
  const vh = page.viewportSize().height;
  for (let i = 0; i < 3; i += 1) {
    const box = await items.nth(i).boundingBox();
    expect(box.y + box.height, `第 ${i + 1} 顆在畫面裡`).toBeLessThanOrEqual(vh);
  }
  const last = await items.last().boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-add]')?.dataset.add ?? null,
    [last.x + last.width / 2, last.y + last.height / 2]);
  expect(hit, '最下面那一顆點得到（不只量外框）').toBe('event');
  expect((await drawer.boundingBox()).y, '抽屜拉到全高').toBeLessThan(peekTop);
  expect(await page.evaluate(() => history.length), '拉高不是多一層').toBe(depth);

  // 收起選單：抽屜留在全高（她可能接著要看那一天的列）
  const tallTop = (await drawer.boundingBox()).y;
  await page.locator('[data-addmenu-toggle]').click();
  await expect(page.locator('[data-addmenu-list]')).toBeHidden();
  await steady(drawer);
  expect((await drawer.boundingBox()).y).toBe(tallTop);
});

