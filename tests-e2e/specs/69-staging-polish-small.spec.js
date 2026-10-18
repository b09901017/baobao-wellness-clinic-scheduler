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
  // x 與 y 都要停：toast 往左拖了之後彈回去是橫的（只看 y 的話量到過場的半路）
  await expect.poll(async () => {
    const b = await loc.boundingBox();
    const at = b ? `${b.x},${b.y}` : null;
    const same = at !== null && at === last;
    last = at;
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

// ---------------------------------------------------------------------------
// 05 復原那一條滑得掉（12 秒、「哪幾種給滑」在 tests/toast-swipe.test.js）
// ---------------------------------------------------------------------------

/** 從 (x, y) 拖 (dx, dy) 放開。Playwright 的滑鼠送出的是 pointer 事件，跟手指走同一條路。 */
async function drag(page, { x, y }, dx, dy) {
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 6 });
  await page.mouse.up();
}

const centerOf = async (loc) => {
  const b = await loc.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};

/** 建一位客戶 → 「已建立 復原」那一條。 */
async function savedToast(app, page, name) {
  await app.go('/customers/new');
  await page.locator('[data-cf-form] input[name="name"]').fill(name);
  await page.locator('[data-cf-form] input[name="phone"]').fill('0911111111');
  await page.locator('.cform__bar button[type="submit"]').click();
  await app.saved();
  await expect(page.locator('#toast [data-undo]')).toBeVisible();
  return page.locator('#toast');
}

test('P5 復原那一條：往左拖 120px 收掉；拖 20px 彈回原處；從「復原」上往下拖走 → 收掉、沒有復原', async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.seed([...masterDocs()]);
  await app.signIn('/');

  // 往左拖 20px 放開：還在、回到原處
  let toast = await savedToast(app, page, '客戶A');
  const home = await toast.boundingBox();
  const text = await centerOf(toast.locator('span').first());
  await drag(page, text, -20, 0);
  await expect(toast).toBeVisible();
  await steady(toast);
  expect((await toast.boundingBox()).x, '彈回原處').toBeCloseTo(home.x, 0);

  // 往左拖 120px 放開：收掉
  await drag(page, text, -120, 0);
  await expect(toast).toBeHidden();

  // 從「復原」那顆按下去、往下拖走：收掉，而且沒有觸發復原（她：「比較不會誤按」）
  toast = await savedToast(app, page, '客戶B');
  await drag(page, await centerOf(toast.locator('[data-undo]')), 0, 100);
  await expect(toast).toBeHidden();
  const names = (await app.readAll('customers')).filter((c) => !c.deletedAt).map((c) => c.name).sort();
  expect(names, '兩位都還在 —— 拖走那一下不是按「復原」').toEqual(['客戶A', '客戶B']);

  // 點一下「復原」照舊復原
  toast = await savedToast(app, page, '客戶C');
  await toast.locator('[data-undo]').click();
  await expect(toast).toContainText('已復原');
});
