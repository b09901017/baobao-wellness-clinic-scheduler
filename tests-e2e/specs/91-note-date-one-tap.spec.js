// 2026-11-05 第一輪小修 05：隨手記「挑日期」按一下就選好。
//
// 她用手機按「挑日期」→ 跳出日曆、選了一天 → 什麼都沒記上，要再點底下那個長框框選一次才記得上。
// 壞的是程式自己叫 `showPicker()` 那一條路（點原生的框選得上）。改成「挑日期」那一顆本身就是日期框：
// 丸子的樣子，裡面疊一個透明、蓋滿整顆的 `<input type="date">`，點下去就是原生的日期選擇。
//
// Playwright 打不開原生的日期選擇（桌機的、手機的都是），所以這裡量兩件事：
// - 點那一顆（中間、兩頭）點到的**就是那個日期框**（`elementFromPoint()`）—— 點得到才算數
// - 那個框有了值之後，標籤出現、存下去的就是那一天（`fill()` 會觸發 `change`）
// 手機上真的點一次只能請她在 staging 點（手動驗收清單）。
//
// 四個入口共用 `ui/components/note.js` 的 `field()`：首頁那張卡、右下角泡泡、客戶詳情、日曆的待辦編輯器。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, TODAY, addDays } from '../fixtures/data.js';
import { shortDate } from '../../public/js/domain/dates.js';

const seed = () => [...masterDocs(), customer({ id: 'cust-a', name: '客戶A' })];

/**
 * 點「挑日期」那一顆的中間與兩頭，點到的都是它裡面那個日期框嗎？
 *
 * **先等進場動畫播完**（段三：N3 本機紅過）：泡泡那一張抽屜還在往上滑的時候量，那一顆還在畫面外面
 * （top 913、畫面高 896），`elementFromPoint()` 回 null —— 量的是動畫走到哪，不是點不點得到。lessons「查的方法」10/19 那一條
 */
async function hitsTheDateBox(scope) {
  const pick = scope.locator('[data-nd-pick]');
  await expect(pick).toBeVisible();
  await pick.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  return pick.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const y = r.top + r.height / 2;
    return [r.left + 3, r.left + r.width / 2, r.right - 3].map((x) => {
      const at = document.elementFromPoint(x, y);
      return Boolean(at && at.matches('[data-nd-input]') && el.contains(at));
    });
  });
}

/** 量點得到、選一天、標籤出現。 */
async function pickDay(scope, iso) {
  expect(await hitsTheDateBox(scope), '「挑日期」那一顆整顆都點得到日期框').toEqual([true, true, true]);
  await scope.locator('[data-nd-input]').fill(iso);
  await expect(scope.locator('[data-nd-label]')).toHaveText(shortDate(iso));
  await expect(scope.locator('[data-nd-pick]')).toHaveAttribute('data-on', 'true');
  await expect(scope.locator('[data-nd-today]')).toHaveAttribute('aria-pressed', 'false');
}

async function noteNamed(app, text) {
  const notes = await app.readAll('notes');
  return notes.find((n) => n.text === text && !n.deletedAt);
}

test('N1 首頁那張卡：按「挑日期」選一天，不用再點別的就記上了', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  const form = page.locator('[data-newnote]');
  const day = addDays(TODAY, 3);

  await pickDay(form, day);
  await form.locator('input[name="text"]').fill('首頁挑日期');
  await form.locator('button[type="submit"]').click();
  await app.saved();

  expect((await noteNamed(app, '首頁挑日期'))?.date).toBe(day);
});

test('N2 按過「今天」、按過 ✕ 之後，「挑日期」照樣按得動', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  const form = page.locator('[data-newnote]');

  await form.locator('[data-nd-today]').click();
  await expect(form.locator('[data-nd-today]')).toHaveAttribute('aria-pressed', 'true');
  await expect(form.locator('[data-nd-pick]'), '選了今天：「今天」亮、「挑日期」不亮').toHaveAttribute('data-on', 'false');

  await form.locator('[data-nd-clear]').click();
  await expect(form.locator('[data-nd-label]')).toBeHidden();

  await pickDay(form, addDays(TODAY, 5));
  await form.locator('[data-nd-clear]').click();
  await pickDay(form, addDays(TODAY, 6));
});

test('N3 右下角泡泡：按「挑日期」選一天就記上了', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await page.locator('[data-quick]').click();
  await app.layer('[data-quicktext]');
  const drawer = page.locator('.drawer').filter({ has: page.locator('[data-quicktext]') });
  const day = addDays(TODAY, 4);

  await page.locator('[data-quicktext]').fill('泡泡挑日期');
  await pickDay(drawer, day);
  await drawer.locator('[data-save]').click();
  await app.saved();

  expect((await noteNamed(app, '泡泡挑日期'))?.date).toBe(day);
});

test('N4 客戶詳情：按「挑日期」選一天就記上了', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers/cust-a');
  const form = page.locator('[data-newnote]');
  const day = addDays(TODAY, 2);

  await pickDay(form, day);
  await form.locator('input[name="text"]').fill('客戶頁挑日期');
  await form.locator('button[type="submit"]').click();
  await app.saved();

  expect((await noteNamed(app, '客戶頁挑日期'))?.date).toBe(day);
});

test('N5 日曆的待辦編輯器：按「挑日期」換一天就記上了', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/calendar');
  await page.locator('[data-fab]').click();
  await page.locator('[data-new-note]').click();
  await app.layer('[data-noteform]');
  const form = page.locator('[data-noteform]');
  const day = addDays(TODAY, 7);

  await form.locator('input[name="text"]').fill('日曆挑日期');
  await pickDay(form, day);
  await form.locator('button[type="submit"]').click();
  await app.saved();

  expect((await noteNamed(app, '日曆挑日期'))?.date).toBe(day);
});
