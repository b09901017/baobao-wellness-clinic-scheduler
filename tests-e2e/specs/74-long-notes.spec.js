// 長備註與備註那一段的順序（staging-polish 14、15，ADR-0156）。
//
// 只有瀏覽器量得到的那幾件：那一串畫成什麼、電話與 LINE 的連結、中間那張卡開了關得掉
// （返回鍵關的是卡、不是那一頁）、按住上下拖之後存下去的順序、按住電話是複製不是撥號。
// 順序的規則本身（佔位、接在最後、跳過不存在的）在 `tests/customer-notes.test.js`。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer } from '../fixtures/data.js';

const LONG_BODY = '週二、週四是女兒開車載來，其他天自己搭計程車。\n\n要改時間先傳 LINE 給本人。\n\n停車在後面那個收費停車場。';

function clientA(extra = {}) {
  return customer({
    id: 'cust-n',
    name: '客戶A',
    phone: '0912-345-678',
    lineId: 'kehu-a',
    marks: [{ text: '喜歡下午', color: 'green' }, { text: '指定女治療師', color: 'blue' }],
    longNotes: [{ id: 'n1', title: '家人與接送', body: LONG_BODY }],
    ...extra,
  });
}

/** 備註那一串，照畫面上的順序，一顆一個字串。 */
async function chipTexts(page) {
  return page.locator('[data-notesblock] [data-notes-row] > *').evaluateAll((els) =>
    els.map((el) => el.textContent.replace(/\s+/g, ' ').trim()));
}

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
});

test('N1 沒排過：電話、LINE、長備註、短備註一排丸子；撥號與 LINE 的連結；抬頭數字不算電話與 LINE', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  expect(await chipTexts(page)).toEqual(['0912-345-678', 'LINE', '家人與接送', '喜歡下午', '指定女治療師']);
  await expect(page.locator('[data-notesblock] [data-notes-phone]')).toHaveAttribute('href', 'tel:0912345678');
  const line = page.locator('[data-notesblock] [data-notes-line]');
  await expect(line).toHaveAttribute('href', 'https://line.me/R/ti/p/~kehu-a');
  await expect(line).toHaveAttribute('target', '_blank');
  await expect(page.locator('[data-notesblock] .section__n')).toHaveText('3');

  // 390px 沒有橫向捲動（捲的是 .app__main）
  const wide = await page.locator('.app__main').evaluate((m) => m.scrollWidth > m.clientWidth);
  expect(wide).toBe(false);
});

test('N2 沒有長備註、沒排過、沒有電話的舊客戶：跟以前一樣只有短備註', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({
    id: 'cust-old', name: '客戶B', marks: [{ text: '週三不行', color: 'grey' }],
  })]);
  await app.signIn('/customers/cust-old');
  expect(await chipTexts(page)).toEqual(['週三不行']);
  await expect(page.locator('[data-notes-sort]')).toHaveCount(0);
});

test('N3 點長備註 → 中間那張卡看得到全文 → 返回鍵關的是卡、不是離開客戶詳情', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-notes-long="n1"]').click();
  await app.layer('.lncard');
  await expect(page.locator('.lncard__title')).toHaveText('家人與接送');
  await expect(page.locator('.lncard__body')).toContainText('停車在後面那個收費停車場');
  // 開著的時候那一顆是隱形的（看起來是它變大了）
  await expect(page.locator('[data-notes-long="n1"]')).toHaveClass(/is-source/);

  await page.goBack();
  await expect(page.locator('.lnov')).toHaveCount(0);
  expect(page.url()).toContain('#/customers/cust-n');
  await expect(page.locator('[data-notes-long="n1"]')).not.toHaveClass(/is-source/);
});

test('N4 中間那張卡上改這一則 → 存起來 → 資料與卡片都是新的', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-notes-long="n1"]').click();
  await app.layer('.lncard');
  await page.locator('[data-notecard-edit]').click();
  await page.locator('[data-notecard-title]').fill('接送');
  await page.locator('[data-notecard-body]').fill('改成兒子載');
  await page.locator('[data-notecard-save]').click();
  await app.saved();

  await expect(page.locator('.lncard__title')).toHaveText('接送');
  await expect(page.locator('.lncard__body')).toHaveText('改成兒子載');
  const doc = await app.readDoc('customers', 'cust-n');
  expect(doc.longNotes).toEqual([{ id: 'n1', title: '接送', body: '改成兒子載' }]);
  // 短備註一個字都沒動
  expect(doc.marks.map((m) => m.text)).toEqual(['喜歡下午', '指定女治療師']);

  await page.locator('.lncard__x').click();
  await expect(page.locator('.lnov')).toHaveCount(0);
  await expect(page.locator('[data-notes-long="n1"]')).toContainText('接送');
});

test('N5 改到一半按返回 → 先問；「不要了」才丟掉', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-notes-long="n1"]').click();
  await app.layer('.lncard');
  await page.locator('[data-notecard-edit]').click();
  await page.locator('[data-notecard-body]').fill('打到一半');
  await page.goBack();
  await app.layer('.dialog');
  await page.locator('.dialog button', { hasText: '不要了' }).click();
  await expect(page.locator('.lnov')).toHaveCount(0);
  expect(page.url()).toContain('#/customers/cust-n');
  const doc = await app.readDoc('customers', 'cust-n');
  expect(doc.longNotes[0].body).toBe(LONG_BODY);
});

test('N6 調整順序：把電話拖到最後、一則短備註拖到最前 → 完成 → 重新整理之後照她排的', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-notes-sort]').click();
  await app.layer('[data-reorder-box]');
  const row = (key) => page.locator(`[data-reorder-key="${key}"]`);

  // 一列 50px＋間距 8px（`noteReorder.js`）。起點照位置算，不量那一列 —— 上一次放開的過場可能還在走
  const drag = async (key, fromIndex, toIndex) => {
    const top = await page.locator('[data-reorder-box]').boundingBox();
    const x = top.x + top.width - 20;
    await expect(row(key)).not.toHaveClass(/is-settling/);
    await page.mouse.move(x, top.y + fromIndex * 58 + 25);
    await page.mouse.down();
    await page.mouse.move(x, top.y + toIndex * 58 + 25, { steps: 8 });
    await page.mouse.up();
    await expect(row(key)).not.toHaveClass(/is-lifted/);
  };

  // 起點：phone、line、long:n1、mark:0、mark:1
  await drag('phone', 0, 4);
  await drag('mark:1', 3, 0);
  await page.locator('[data-notes-sort-done]').click();
  await app.saved();

  const want = ['指定女治療師', 'LINE', '家人與接送', '喜歡下午', '0912-345-678'];
  expect(await chipTexts(page)).toEqual(want);
  const doc = await app.readDoc('customers', 'cust-n');
  expect(doc.noteOrder).toEqual(['mark', 'line', 'long:n1', 'mark', 'phone']);
  // 短備註本身照新的先後（她 10/19 同意），`notes` 鏡像跟著
  expect(doc.marks.map((m) => m.text)).toEqual(['指定女治療師', '喜歡下午']);
  expect(doc.notes).toBe('指定女治療師\n喜歡下午');

  await app.reload();
  expect(await chipTexts(page)).toEqual(want);
});

test('N7 調整順序按「取消」：什麼都沒寫', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');
  await page.locator('[data-notes-sort]').click();
  await app.layer('[data-reorder-box]');
  // 鍵盤也排得動
  await page.locator('[data-reorder-key="phone"]').focus();
  await page.keyboard.press('ArrowDown');
  await page.locator('[data-notes-sort-cancel]').click();
  expect(await chipTexts(page)).toEqual(['0912-345-678', 'LINE', '家人與接送', '喜歡下午', '指定女治療師']);
  const doc = await app.readDoc('customers', 'cust-n');
  expect(doc.noteOrder).toBeUndefined();
});

test('N8 編輯：刪掉第 2 則短備註、加一則長的 → 其餘的位置照舊', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA({
    marks: [{ text: 'a', color: 'grey' }, { text: 'b', color: 'grey' }, { text: 'c', color: 'grey' }],
    noteOrder: ['mark', 'phone', 'mark', 'long:n1', 'mark', 'line'],
  })]);
  await app.signIn('/customers/cust-n');
  expect(await chipTexts(page)).toEqual(['a', '0912-345-678', 'b', '家人與接送', 'c', 'LINE']);

  await page.locator('[data-notes-edit]').click();
  await app.layer('[data-notes-editor] .edlist');
  await page.locator('[data-notesed-del="mark:1"]').click();
  await page.locator('[data-notesed-tab="long"]').click();
  await page.locator('[data-notesed-long-title]').fill('打點滴前');
  await page.locator('[data-notesed-long-body]').fill('右手比較好打');
  // 不按「加入」直接按儲存：輸入框裡的那一則一起收進去
  await page.locator('.drawer [data-save]').click();
  await app.saved();

  expect(await chipTexts(page)).toEqual(['a', '0912-345-678', '家人與接送', 'c', 'LINE', '打點滴前']);
  const doc = await app.readDoc('customers', 'cust-n');
  expect(doc.marks.map((m) => m.text)).toEqual(['a', 'c']);
  expect(doc.longNotes.map((n) => n.title)).toEqual(['家人與接送', '打點滴前']);
});

test('N9 按住電話是複製，不是撥號', async ({ app, page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  const phone = page.locator('[data-notesblock] [data-notes-phone]');
  // 撥號那一下不要真的離開（無頭瀏覽器對 tel: 的反應不一定）：記下有沒有被點到
  await page.evaluate(() => {
    window.__dialed = 0;
    document.addEventListener('click', (e) => {
      if (e.target.closest('[data-notes-phone]')) { window.__dialed += 1; e.preventDefault(); }
    });
  });
  const b = await phone.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await expect(page.locator('#toast')).toContainText('已複製 0912-345-678', { timeout: 3000 });
  await page.mouse.up();
  expect(await page.evaluate(() => window.__dialed)).toBe(0);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('0912-345-678');
});

test('N10 減少動態效果：卡片只淡入，不從那一顆長出來', async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');
  await page.locator('[data-notes-long="n1"]').click();
  await app.layer('.lncard');
  const grows = await page.evaluate(() => document.getAnimations()
    .some((a) => a.effect?.target?.classList?.contains('lncard__bg')));
  expect(grows).toBe(false);
});
