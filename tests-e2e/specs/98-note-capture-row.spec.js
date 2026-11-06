// 記一筆那一排（notes-widget 02、03）：今天／挑日期／掛給誰／給營養品排一排、
// 首頁那張卡也有「給營養品」、長按提示收在 `?` 裡；打名字跳出客戶、「掛給誰」可以搜尋。
//
// 三個有「掛給誰」的入口共用 `ui/components/note.js` 的 `wireCapture()`：首頁那張卡、右下角泡泡、日曆的待辦編輯器。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, scenarioProducts } from '../fixtures/data.js';

const CHIPS = ['[data-nd-today]', '[data-nd-pick]', '[data-nw-toggle]', '[data-ng-toggle]'];

/** 四顆的上緣一樣（同一排）。 */
async function tops(scope) {
  return Promise.all(CHIPS.map((sel) => scope.locator(sel).evaluate((el) => Math.round(el.getBoundingClientRect().top))));
}

test('C1 首頁那張卡：四顆排一排，給營養品也在', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/');
  const form = page.locator('[data-newnote]');
  await expect(form.locator('[data-ng-toggle]')).toBeVisible();
  const t = await tops(form);
  expect(new Set(t).size, `四顆的上緣：${t}`).toBe(1);
});

test('C2 泡泡：四顆排一排；打開掛給誰，名單在那一排底下', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-a', name: '客戶A' })]);
  await app.signIn('/');
  await page.locator('[data-quick]').click();
  const drawer = page.locator('.drawer');
  await expect(drawer.locator('[data-quicktext]')).toBeVisible();
  await drawer.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const t = await tops(drawer);
  expect(new Set(t).size, `四顆的上緣：${t}`).toBe(1);

  await drawer.locator('[data-nw-toggle]').click();
  await expect(drawer.locator('[data-nw-pick]')).toHaveCount(1);
  // 名單淡入（`deck-in`）是從上面 8px 滑下來的：量動畫走完的位置
  await drawer.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const listTop = await drawer.locator('[data-nw-list]').evaluate((el) => el.getBoundingClientRect().top);
  const chipsBottom = await drawer.locator('[data-ng-toggle]').evaluate((el) => el.getBoundingClientRect().bottom);
  expect(listTop, '名單在丸子那一排底下，不擠在中間').toBeGreaterThanOrEqual(chipsBottom);
});

test('C3 首頁那張卡選一包營養品存下去：帶著 entitlementId、掛給誰收起來、字自動填', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/');
  const form = page.locator('[data-newnote]');
  await form.locator('[data-ng-toggle]').click();
  await form.locator('[data-ng-cust="cust-c"]').click();
  await form.locator('[data-ng-bag="ent-c-prod"]').click();
  await expect(form.locator('[data-nw-toggle]')).toBeHidden();
  await expect(form.locator('input[name="text"]')).toHaveValue(/客戶C/);
  await form.locator('button[type="submit"]').click();
  await app.saved();

  const notes = (await app.readAll('notes')).filter((n) => !n.deletedAt && n.id !== 'note-c-give');
  expect(notes).toHaveLength(1);
  expect(notes[0].entitlementId).toBe('ent-c-prod');
  expect(notes[0].customerId).toBe('cust-c');
});

test('C4 長按提示收在 `?` 裡：首頁那張卡與隨手記那一頁的標題旁邊', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/');
  const cardTip = page.locator('[data-newnote]').locator('xpath=ancestor::section').locator('.card__title [data-tip]');
  await expect(cardTip).toHaveAttribute('data-tip', /長按/);

  await app.go('/todo/notes');
  await expect(page.locator('.page__title [data-tip]')).toHaveAttribute('data-tip', /長按/);
});
