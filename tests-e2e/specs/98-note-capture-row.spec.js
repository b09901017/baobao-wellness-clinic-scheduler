// 記一筆那一排（notes-widget 02、03）：今天／挑日期／掛給誰／給營養品排一排、
// 首頁那張卡也有「給營養品」、長按提示收在 `?` 裡；打名字跳出客戶、「掛給誰」可以搜尋。
//
// 三個有「掛給誰」的入口共用 `ui/components/note.js` 的 `wireCapture()`：首頁那張卡、右下角泡泡、日曆的待辦編輯器。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, note, scenarioProducts, TODAY } from '../fixtures/data.js';

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

test('C3 首頁那張卡選一包營養品存下去：掛給誰收起來、字自動填；那一包已經約了 → 改那一筆、不長第二筆', async ({ app, page }) => {
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

  // `ent-c-prod` 本來就有 `note-c-give`（give-bag-once 01）
  const forBag = (await app.readAll('notes')).filter((n) => !n.deletedAt && !n.done && n.entitlementId === 'ent-c-prod');
  expect(forBag.map((n) => n.id), '改本來那一筆，不長第二筆').toEqual(['note-c-give']);
  expect(forBag[0].customerId).toBe('cust-c');
  expect((await app.readAll('notes')).filter((n) => !n.deletedAt).length, '一筆都沒多')
    .toBe(scenarioProducts().filter((d) => d.path === 'notes').length);
});

test('C4 長按提示收在 `?` 裡：首頁那張卡與隨手記那一頁的標題旁邊', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/');
  const cardTip = page.locator('[data-newnote]').locator('xpath=ancestor::section').locator('.card__title [data-tip]');
  await expect(cardTip).toHaveAttribute('data-tip', /長按/);

  await app.go('/todo/notes');
  await expect(page.locator('.page__title [data-tip]')).toHaveAttribute('data-tip', /長按/);
});

// ---------- 03：打名字就跳出客戶、「掛給誰」可以搜尋 ----------

const PEOPLE = () => [
  ...masterDocs(),
  customer({ id: 'wxm', name: '王小明', chartNo: '1234' }),
  customer({ id: 'wdt', name: '王大同' }),
  customer({ id: 'lw', name: '李王' }),
  customer({ id: 'cb', name: '客戶B' }),
];

/** 打開泡泡「記一筆」、等抽屜滑完。 */
async function openQuick(page) {
  await page.locator('[data-quick]').click();
  const drawer = page.locator('.drawer');
  await expect(drawer.locator('[data-quicktext]')).toBeVisible();
  await drawer.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  return drawer;
}

const focused = (loc) => loc.evaluate((el) => document.activeElement === el);

test('S1 泡泡打「請王」：只跳出名字開頭是王的；點王小明 → 框裡換成全名、游標在後面、框還聚焦、掛給他', async ({ app, page }) => {
  await app.seed(PEOPLE());
  await app.signIn('/');
  const drawer = await openQuick(page);
  const input = drawer.locator('[data-quicktext]');
  await input.fill('請王');

  const row = drawer.locator('[data-nsuggest]');
  await expect(row.locator('[data-ns-pick]')).toHaveText(['王大同', '王小明']);
  await row.locator('[data-ns-pick="wxm"]').click();

  await expect(input).toHaveValue('請王小明');
  expect(await focused(input), '框還聚焦（鍵盤不收）').toBe(true);
  expect(await input.evaluate((el) => el.selectionStart)).toBe(4);
  await expect(row).toBeHidden();
  await expect(drawer.locator('[data-nw-label]')).toHaveText('王小明');

  await input.press('End');
  await input.pressSequentially('回電');
  await expect(row, '已經是現在掛的那一位的全名：接著打字不再跳').toBeHidden();
  await drawer.locator('[data-save]').click();
  await app.saved();
  const saved = (await app.readAll('notes')).find((n) => n.text === '請王小明回電');
  expect(saved?.customerId).toBe('wxm');
});

test('S2 注音選字中不跳，選好字才找', async ({ app, page }) => {
  await app.seed(PEOPLE());
  await app.signIn('/');
  const drawer = await openQuick(page);
  const input = drawer.locator('[data-quicktext]');
  await input.focus();
  await input.evaluate((el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.value = '王';
    el.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true, data: '王' }));
  });
  const row = drawer.locator('[data-nsuggest]');
  await expect(drawer.locator('[data-quicktext]')).toHaveValue('王');
  await expect(row, '組字中不跳').toBeHidden();
  await input.evaluate((el) => el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '王' })));
  await expect(row.locator('[data-ns-pick]')).toHaveCount(2);
});

test('S3 已經掛給王小明又點客戶B → 改掛客戶B；把框裡的名字刪掉，掛給誰不自動拿掉', async ({ app, page }) => {
  await app.seed(PEOPLE());
  await app.signIn('/');
  const form = page.locator('[data-newnote]');
  const input = form.locator('input[name="text"]');
  await input.fill('王小');
  await form.locator('[data-ns-pick="wxm"]').click();
  await expect(form.locator('[data-nw-label]')).toHaveText('王小明');

  await input.press('End');
  await input.pressSequentially('跟客戶');
  await form.locator('[data-ns-pick="cb"]').click();
  await expect(input).toHaveValue('王小明跟客戶B');
  await expect(form.locator('[data-nw-label]')).toHaveText('客戶B');

  await input.fill('王小明跟');
  await expect(form.locator('[data-nw-label]'), '名字從框裡刪掉 → 照舊掛客戶B').toHaveText('客戶B');
});

test('S4 「掛給誰」的名單可以搜尋：名字或病歷號；Enter 不送出、剛好一位就選他', async ({ app, page }) => {
  await app.seed(PEOPLE());
  await app.signIn('/');
  const form = page.locator('[data-newnote]');
  await form.locator('[data-nw-toggle]').click();
  const search = form.locator('[data-nw-search]');
  await expect(form.locator('[data-nw-pick]')).toHaveCount(4);

  await search.fill('大同');
  await expect(form.locator('[data-nw-pick]')).toHaveText(['王大同']);
  await search.fill('1234');
  await expect(form.locator('[data-nw-pick]')).toHaveText(['王小明']);
  await search.press('Enter');
  await expect(form.locator('[data-nw-label]')).toHaveText('王小明');
  expect((await app.readAll('notes')).length, 'Enter 沒有把隨手記送出去').toBe(0);
});

test('S5 長按的「改掛給誰」也可以搜尋', async ({ app, page }) => {
  await app.seed([...PEOPLE(), note({ id: 'n1', text: '回電' })]);
  await app.signIn('/');
  const target = page.locator('[data-notes] [data-note="n1"]');
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('[data-action="who"]').click();

  const card = page.locator('.popcard');
  await card.locator('[data-who-search]').fill('李');
  await expect(card.locator('[data-who-pick]')).toHaveText(['李王']);
  await card.locator('[data-who-pick="lw"]').click();
  await app.saved();
  expect((await app.readAll('notes')).find((n) => n.id === 'n1')?.customerId).toBe('lw');
});

test('S6 選了一包營養品：打名字不跳出客戶', async ({ app, page }) => {
  await app.seed([...scenarioProducts(), customer({ id: 'wxm', name: '王小明' })]);
  await app.signIn('/');
  const drawer = await openQuick(page);
  const input0 = drawer.locator('[data-quicktext]');
  await input0.fill('王');
  await expect(drawer.locator('[data-ns-pick]'), '對照：沒選一包時打「王」會跳').toHaveCount(1);
  await drawer.locator('[data-ng-toggle]').click();
  await drawer.locator('[data-ng-cust="cust-c"]').click();
  await drawer.locator('[data-ng-bag="ent-c-prod"]').click();
  const input = drawer.locator('[data-quicktext]');
  await input.focus();
  await input.press('End');
  await input.pressSequentially('王');
  // 選了一包時一打字就收（不等名單讀回來）—— 這裡量的不是「還沒畫出來」
  await expect(drawer.locator('[data-nsuggest]')).toBeHidden();
});

test('S7 日曆的待辦編輯器也有；客戶詳情那一格沒有', async ({ app, page }) => {
  await app.seed(PEOPLE());
  await app.signIn('/calendar');
  await page.locator('[data-fab]').click();
  await page.locator('[data-new-note]').click();
  await app.layer('[data-noteform]');
  const form = page.locator('[data-noteform]');
  await form.locator('input[name="text"]').fill('問王大');
  await form.locator('[data-ns-pick="wdt"]').click();
  await expect(form.locator('input[name="text"]')).toHaveValue('問王大同');
  await form.locator('button[type="submit"]').click();
  await app.saved();
  expect((await app.readAll('notes')).find((n) => n.text === '問王大同')?.customerId).toBe('wdt');

  await app.go('/customers/wxm');
  await expect(page.locator('[data-nsuggest]')).toHaveCount(0);
});

// 段三審查 R7（她 11/6 在 HTC 上）：日曆「＋ → 待辦」也跟首頁那張卡一樣四顆排一排、沒有「哪一天」「掛給誰」兩個標籤
test('S8 日曆 ＋ → 待辦：今天／挑日期／掛給誰／給營養品四顆排一排、沒有那兩個標籤', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/calendar');
  await page.locator('[data-fab]').click();
  await page.locator('[data-new-note]').click();
  await app.layer('[data-noteform]');
  const form = page.locator('[data-noteform]');
  await form.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => null))));
  const t = await tops(form);
  expect(new Set(t).size, `四顆的上緣：${t}`).toBe(1);
  await expect(form.locator('.field__label', { hasText: /^哪一天$/ })).toHaveCount(0);
  await expect(form.locator('.field__label', { hasText: /^掛給誰$/ })).toHaveCount(0);
  await expect(form.locator('.field__label', { hasText: '記什麼' })).toHaveCount(1);

  // 選一包營養品：掛給誰那一顆收起來（同首頁那張卡）
  await form.locator('[data-ng-toggle]').click();
  await form.locator('[data-ng-cust="cust-c"]').click();
  await form.locator('[data-ng-bag="ent-c-prod"]').click();
  await expect(form.locator('[data-nw-toggle]')).toBeHidden();
});

// 上 main 前最後健檢 A（2026-11-07，`.scratch/final-check-2026-11-07`）：營養品的提醒掛給誰由那一包決定 ——
// 長按選單本來就沒有「掛給誰」（`domain/notes.js` 的 `noteActions()`），日曆的待辦編輯器以前照樣有，打名字跳出客戶也接著。
// 改掛給別人之後勾掉，`prepareToggle()` 讀那一位的額度找不到那一包 → 「給了什麼？」不問、交付沒記
test('S9 日曆編輯一筆營養品的提醒：沒有「掛給誰」、打名字不跳客戶；存了掛的人不變、勾掉照樣問給了什麼', async ({ app, page }) => {
  await app.seed([...scenarioProducts({ giveDate: TODAY }), customer({ id: 'cust-b', name: '客戶B' })]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open="note:note-c-give"]');
  await page.locator('[data-open="note:note-c-give"]').click();
  await page.locator('[data-card-edit]').click();
  const form = page.locator('[data-noteform]');
  const input = form.locator('input[name="text"]');
  await expect(input).toBeVisible();
  await expect(form.locator('[data-nw-toggle]'), '掛給誰跟著那一包，不給換').toHaveCount(0);
  await expect(page.locator('.drawer'), '是誰的那一包照樣看得到').toContainText('客戶C 的營養品提醒');

  await input.focus();
  await input.press('End');
  await input.pressSequentially('客戶');
  await expect(form.locator('[data-ns-pick]'), '打名字不跳出客戶').toHaveCount(0);
  await form.locator('button[type="submit"]').click();
  await app.saved();
  const after = await app.readDoc('notes', 'note-c-give');
  expect(after.text.endsWith('客戶'), '字照樣存').toBe(true);
  expect(after.customerId, '掛的人沒有被清掉或換掉').toBe('cust-c');
  expect(after.customerName).toBe('客戶C');
  expect(after.entitlementId).toBe('ent-c-prod');

  await app.go('/todo/notes');
  await page.locator('[data-notes] [data-note="note-c-give"]').click();
  await expect(page.locator('text=給了什麼？'), '勾掉照樣問給了哪幾款').toBeVisible();
});
