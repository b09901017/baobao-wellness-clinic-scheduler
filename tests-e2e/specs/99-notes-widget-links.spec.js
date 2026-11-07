// 給 Android 小工具開的兩條網址（notes-widget 10）：
//   #/todo/notes/note/<id>   打開隨手記那一頁，營養品的提醒直接問「給了哪幾款」、一般的跳出長按選單
//   #/todo/notes/new/give    打開隨手記那一頁、「記一筆」打開、給營養品已經展開
//
// `signIn(網址)` 是從那一條網址冷開機（app 沒開著時從小工具打開）；`go()` 是 app 開著時換過去。
// 處理完網址換回 `#/todo/notes`：重新整理不會再跳一次。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, note, scenarioProducts } from '../fixtures/data.js';

const live = async (app) => (await app.readAll('notes')).filter((n) => !n.deletedAt);

test('W1 冷開機 …/new/give：記一筆打開、給營養品展開；選了已經約了的那一包 → 改那一筆、不長第二筆；網址換回隨手記', async ({ app, page, today }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/todo/notes/new/give');

  const drawer = page.locator('.drawer');
  await expect(drawer.locator('[data-ng-cust="cust-c"]'), '給營養品已經展開').toBeVisible();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/todo/notes');

  await drawer.locator('[data-ng-cust="cust-c"]').click();
  await drawer.locator('[data-ng-bag="ent-c-prod"]').click();
  await drawer.locator('[data-nd-today]').click();
  await drawer.locator('[data-save]').click();
  await app.saved();
  // `ent-c-prod` 本來就有 `note-c-give`（她 11/7 在小工具上記出兩筆一樣的，give-bag-once 01）
  const forBag = (await live(app)).filter((n) => n.entitlementId === 'ent-c-prod' && !n.done);
  expect(forBag.map((n) => n.id), '改本來那一筆，不長第二筆').toEqual(['note-c-give']);
  expect(forBag[0].date, '選了今天就改成今天').toBe(today);
  await expect(page.locator('.toast')).toContainText('本來就有提醒');
});

test('W2 冷開機 …/note/<營養品的提醒>：先問給了哪幾款，按「先不要」什麼都沒勾', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/todo/notes/note/note-c-give');

  await expect(page.locator('[data-give-ok]'), '直接問給了哪幾款').toBeVisible();
  await page.locator('[data-give-cancel]').click();
  expect((await live(app)).find((n) => n.id === 'note-c-give')?.done, '沒有不問就勾掉的路').toBeFalsy();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/todo/notes');
});

test('W3 app 開著時換到 …/note/<一般的>：跳出它的長按選單', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-a', name: '客戶A' }), note({ id: 'n1', text: '回電' })]);
  await app.signIn('/');
  await page.evaluate(() => { window.location.hash = '/todo/notes/note/n1'; });
  await expect(page.locator('[data-action="copy"]'), '長按選單出來了').toBeVisible();
  await expect(page.locator('[data-notes] [data-note="n1"]')).toBeVisible();
});

test('W4 找不到那一筆、已經勾掉的：講一句，頁面照樣是隨手記', async ({ app, page }) => {
  await app.seed([...masterDocs(), note({ id: 'd1', text: '做好了', done: true })]);
  await app.signIn('/todo/notes/note/nope');
  await expect(page.locator('.toast')).toContainText('找不到這一筆');
  await expect(page.locator('.page__title')).toContainText('隨手記');

  await app.go('/todo/notes/note/d1');
  await expect(page.locator('.toast')).toContainText('已經勾掉了');
});

test('W5 舊的 #/todo/notes 照舊', async ({ app, page }) => {
  await app.seed([...masterDocs(), note({ id: 'n1', text: '回電' })]);
  await app.signIn('/todo/notes');
  await expect(page.locator('[data-notes] [data-note="n1"]')).toBeVisible();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page.locator('.actionrow')).toHaveCount(0);
});
