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
    lineId: '王小明',
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

test('N1 沒排過：電話、LINE、長備註、短備註一排丸子；撥號是連結、LINE 是按鈕；抬頭數字不算電話與 LINE', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  expect(await chipTexts(page)).toEqual(['0912-345-678', 'LINE', '家人與接送', '喜歡下午', '指定女治療師']);
  await expect(page.locator('[data-notesblock] [data-notes-phone]')).toHaveAttribute('href', 'tel:0912345678');
  const line = page.locator('[data-notesblock] [data-notes-line]');
  // 那一格是她 LINE 上的名字，不是網址（ADR-0157）：點了交給手機上的 MacroDroid，見 75
  await expect(line).toHaveJSProperty('tagName', 'BUTTON');
  await expect(line).not.toHaveAttribute('href', /./);
  await expect(line).toHaveAttribute('aria-label', '打開 王小明 的 LINE 對話');
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

const TWO_LINES = ['右手比較好打', '左手血管細'].join(String.fromCharCode(10));

test('N13 編輯：打到一半切去另一種、刪一則 → 兩格打的字都還在（段八審查 b）', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-notes-edit]').click();
  await app.layer('[data-notes-editor] .edlist');
  await page.locator('[data-notesed-tab="long"]').click();
  await page.locator('[data-notesed-long-title]').fill('打點滴前');
  await page.locator('[data-notesed-long-body]').fill(TWO_LINES);
  // 手滑點到「加一則短的」、打幾個字，再點回來
  await page.locator('[data-notesed-tab="mark"]').click();
  await page.locator('[data-notesed-mark]').fill('怕冷');
  await page.locator('[data-notesed-tab="long"]').click();
  await expect(page.locator('[data-notesed-long-title]')).toHaveValue('打點滴前');
  await expect(page.locator('[data-notesed-long-body]')).toHaveValue(TWO_LINES);

  // 刪一則也是整塊重畫
  await page.locator('[data-notesed-del="mark:0"]').click();
  await expect(page.locator('[data-notesed-long-body]')).toHaveValue(TWO_LINES);
  await page.locator('[data-notesed-tab="mark"]').click();
  await expect(page.locator('[data-notesed-mark]')).toHaveValue('怕冷');

  // 按了「加入」的那一格才清空
  await page.locator('[data-notesed-add-mark]').click();
  await expect(page.locator('[data-notesed-mark]')).toHaveValue('');
  await page.locator('[data-notesed-tab="long"]').click();
  await expect(page.locator('[data-notesed-long-title]')).toHaveValue('打點滴前');
});

test('N14 編輯：兩格都打了、停在「短的」那一頁按儲存 → 兩則都存進去（看得到還在的字不可以存不下去）', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-notes-edit]').click();
  await app.layer('[data-notes-editor] .edlist');
  await page.locator('[data-notesed-tab="long"]').click();
  await page.locator('[data-notesed-long-title]').fill('打點滴前');
  await page.locator('[data-notesed-long-body]').fill('右手比較好打');
  await page.locator('[data-notesed-tab="mark"]').click();
  await page.locator('[data-notesed-mark]').fill('怕冷');
  await page.locator('.drawer [data-save]').click();
  await app.saved();

  const doc = await app.readDoc('customers', 'cust-n');
  expect(doc.marks.map((m) => m.text)).toEqual(['喜歡下午', '指定女治療師', '怕冷']);
  expect(doc.longNotes.map((n) => n.title)).toEqual(['家人與接送', '打點滴前']);
});

test('N15 編輯：長的那一格只打了內文、停在「短的」那一頁按儲存 → 不存、切到長的那一頁講要有標題', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA()]);
  await app.signIn('/customers/cust-n');

  await page.locator('[data-notes-edit]').click();
  await app.layer('[data-notes-editor] .edlist');
  await page.locator('[data-notesed-tab="long"]').click();
  await page.locator('[data-notesed-long-body]').fill('右手比較好打');
  await page.locator('[data-notesed-tab="mark"]').click();
  await page.locator('.drawer [data-save]').click();

  await expect(page.locator('[data-notesed-tab="long"]')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('[data-notesed-long-body]')).toHaveValue('右手比較好打');
  await expect(page.locator('[data-notesed-long-title]')).toBeFocused();
  const doc = await app.readDoc('customers', 'cust-n');
  expect(doc.longNotes.map((n) => n.title)).toEqual(['家人與接送']);
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

test('N11 電話排在長備註底下那一排：點長備註的下緣開的是長備註，不是撥號（撐開的觸控區不跨到上一排）', async ({ app, page }) => {
  // 丸子一排 34px、上下兩排之間 6px。電話撐開的觸控區比那 6px 的一半還多的話，
  // 疊到上一排那一顆的下緣，而它在 DOM 裡排在後面 —— 疊到的那一段由它贏（CLAUDE.md「一顆小圖示按鈕的觸控區」）
  await app.seed([...masterDocs(), clientA({
    longNotes: [{ id: 'n1', title: '家人與接送還有停車的地方', body: LONG_BODY }],
    noteOrder: ['long:n1', 'phone', 'line', 'mark', 'mark'],
  })]);
  await app.signIn('/customers/cust-n');

  const long = await page.locator('[data-notesblock] [data-notes-long]').boundingBox();
  const phone = await page.locator('[data-notesblock] [data-notes-phone]').boundingBox();
  expect(phone.y).toBeGreaterThan(long.y + long.height); // 電話真的在下一排
  const x = Math.max(long.x, phone.x) + 4;
  for (const y of [long.y + long.height - 1, long.y + long.height - 0.5]) {
    const hit = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest('[data-notes-long]') ? 'long' : el?.closest('[data-notes-phone]') ? 'phone' : el?.className ?? null;
    }, [x, y]);
    expect(hit).toBe('long');
  }
});

test('N12 客戶清單的卡片：長備註排在最前面也只畫短備註（issue 14 判準：讀 marks 的那一側一個字都不變）', async ({ app, page }) => {
  await app.seed([...masterDocs(), clientA({ noteOrder: ['long:n1', 'phone', 'line', 'mark', 'mark'] })]);
  await app.signIn('/customers');

  const card = page.locator('a.card[href="#/customers/cust-n"]');
  await expect(card).toContainText('喜歡下午');
  await expect(card).toContainText('指定女治療師');
  await expect(card).not.toContainText('家人與接送');
});

// ---------------------------------------------------------------------------
// 15 客戶頁上面的「長備註」：一疊左右滑的卡
// ---------------------------------------------------------------------------

function twoClients() {
  return [
    customer({
      id: 'cust-a', name: '客戶A',
      longNotes: [{ id: 'a1', title: '家人與接送', body: '週二女兒載' }, { id: 'a2', title: '打點滴前', body: '右手比較好打' }],
    }),
    customer({
      id: 'cust-c', name: '客戶C', active: false,
      longNotes: [{ id: 'c1', title: '停用前的狀況', body: '搬去外縣市' }, { id: 'c2', title: '聯絡', body: '傳 LINE' }],
    }),
    customer({ id: 'cust-b', name: '客戶B', marks: [{ text: '週三不行', color: 'grey' }] }),
  ];
}

const deckKeys = (page) => page.locator('[data-deck] [data-card]').evaluateAll((els) => els.map((el) => el.dataset.card));

test('L1 客戶頁上面那一排有「長備註」；那一頁四張卡、在服務中的在前、停用的標「已停用」；360px 那一排放得下', async ({ app, page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers');

  const row = page.locator('.page__row');
  const fits = await row.evaluate((r) => r.scrollWidth <= r.clientWidth);
  expect(fits).toBe(true);
  const link = page.locator('.footlinks--inline a.footlink', { hasText: '長備註' });
  const box = await link.boundingBox();
  expect(box.x + box.width).toBeLessThanOrEqual(360);

  await link.click();
  await app.settled();
  expect(page.url()).toContain('#/customers/notes');
  expect(await deckKeys(page)).toEqual(['cust-a:a1', 'cust-a:a2', 'cust-c:c1', 'cust-c:c2']);
  await expect(page.locator('[data-card="cust-c:c1"] .badge')).toHaveText('已停用');
  await expect(page.locator('.pbchips [data-goto]')).toHaveCount(4);

  // 丸子點了跳到那一張
  await page.locator('[data-goto="cust-c:c2"]').click();
  await expect(page.locator('[data-goto="cust-c:c2"]')).toHaveAttribute('aria-pressed', 'true');
});

test('L2 搜尋：人名只剩他的兩張；標題的一個字找得到；內文的字也找得到', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers/notes');

  await page.locator('[data-search-toggle]').click();
  await page.locator('[data-search]').fill('客戶 A');
  expect(await deckKeys(page)).toEqual(['cust-a:a1', 'cust-a:a2']);
  await page.locator('[data-search]').fill('停用前');
  expect(await deckKeys(page)).toEqual(['cust-c:c1']);
  await page.locator('[data-search]').fill('右手');
  expect(await deckKeys(page)).toEqual(['cust-a:a2']);
});

test('L3 ＋ 選客戶B、寫一則 → 存在客戶B身上 → 他的詳情備註那一段看得到（同一份資料）', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers/notes');

  await page.locator('[data-new]').click();
  await app.layer('[data-pick-list]');
  await page.locator('[data-pick-search]').fill('客戶B');
  await page.locator('[data-pick-customer="cust-b"]').click();
  await app.layer('.pbcard--edit');
  await page.locator('.pbcard--edit [data-title]').fill('喜歡聊園藝');
  await page.locator('.pbcard--edit [data-body]').fill('陽台種了很多香草');
  await page.locator('.pbcard--edit [data-save]').click();
  await app.saved();

  const doc = await app.readDoc('customers', 'cust-b');
  expect(doc.longNotes.map((n) => n.title)).toEqual(['喜歡聊園藝']);
  expect(doc.marks.map((m) => m.text)).toEqual(['週三不行']);
  const key = `cust-b:${doc.longNotes[0].id}`;
  expect(await deckKeys(page)).toContain(key);

  // 卡上的客戶名點了到他的詳情
  await page.locator(`[data-card="${key}"] [data-who]`).click();
  await app.settled();
  expect(page.url()).toContain('#/customers/cust-b');
  await expect(page.locator('[data-notesblock] [data-notes-long]')).toContainText('喜歡聊園藝');
});

test('L4 這一頁改一則的內文 → 客戶詳情中間那張卡看到的是改過的', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers/notes');

  await page.locator('[data-edit="cust-a:a1"]').click();
  await app.layer('.pbcard--edit');
  await page.locator('.pbcard--edit [data-body]').fill('改成兒子載');
  await page.locator('.pbcard--edit [data-save]').click();
  await app.saved();

  await app.go('/customers/cust-a');
  await page.locator('[data-notes-long="a1"]').click();
  await app.layer('.lncard');
  await expect(page.locator('.lncard__body')).toHaveText('改成兒子載');
});

test('L5 編輯中按返回 → 先問；關掉那道框是繼續改；「不要了」才收', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers');
  await app.go('/customers/notes');

  await page.locator('[data-edit="cust-a:a1"]').click();
  await app.layer('.pbcard--edit');
  await page.locator('.pbcard--edit [data-body]').fill('打到一半');
  await page.goBack();
  await app.layer('.dialog');
  expect(page.url()).toContain('#/customers/notes');
  // 關掉那道框（Escape）＝繼續改
  await page.keyboard.press('Escape');
  await expect(page.locator('.dialog')).toHaveCount(0);
  await expect(page.locator('.pbcard--edit [data-body]')).toHaveValue('打到一半');

  // 再按一次返回 → 還是先問（那一層補回來了）
  await page.goBack();
  await app.layer('.dialog');
  await page.locator('.dialog button', { hasText: '不要了' }).click();
  await expect(page.locator('.pbcard--edit')).toHaveCount(0);
  expect(page.url()).toContain('#/customers/notes');
  const doc = await app.readDoc('customers', 'cust-a');
  expect(doc.longNotes[0].body).toBe('週二女兒載');
});

test('L5b 改到一半點底下的「日曆」→ 換到日曆、不在那一頁上問；回來按返回不會再問', async ({ app, page }) => {
  // 換 hash 時瀏覽器先發 popstate，編輯那一層的 onPop 會被叫到（CLAUDE.md「存起來的 pushLayer() handle」
  // 的最後一句）：網址已經換了就不要問，不然那一道框留在日曆上、存的是舊的草稿、還會把這一頁畫回日曆上面
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers');
  await app.go('/customers/notes');

  await page.locator('[data-edit="cust-a:a1"]').click();
  await app.layer('.pbcard--edit');
  await page.locator('.pbcard--edit [data-body]').fill('打到一半');
  await page.locator('.app__nav a[href="#/calendar"]').click();
  await app.settled();
  expect(page.url()).toContain('#/calendar');
  await expect(page.locator('.app__nav a[aria-current="page"]')).toContainText('日曆');
  await expect(page.locator('.dialog')).toHaveCount(0);
  await expect(page.locator('[data-page] .pbdeck')).toHaveCount(0);
  expect((await app.readDoc('customers', 'cust-a')).longNotes[0].body).toBe('週二女兒載');

  // 日曆上按返回：回長備註那一頁，沒有一道從上一頁留下來的框
  await page.goBack();
  await app.settled();
  expect(page.url()).toContain('#/customers/notes');
  await expect(page.locator('.dialog')).toHaveCount(0);
});

test('L6 刪一則要按兩次；第一次只是變紅', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers/notes');

  await page.locator('[data-edit="cust-a:a2"]').click();
  await app.layer('.pbcard--edit');
  // 等那一張的進場動畫（`pbcard-in`，往上浮 8px）播完再按。還在動的時候 Playwright 判「不穩」、
  // 重試時自己捲一次，橫向那一疊被它捲走 78px —— 量到的是它捲的，不是 app（10/19 審查時查到：
  // 以前只等「x 不動」，動畫在 y 上，一半的回合紅；手指點不會捲）
  await page.locator('.pbcard--edit').evaluate((el) =>
    Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  await page.locator('.pbcard--edit [data-del]').click();
  await expect(page.locator('.pbcard--edit [data-del]')).toContainText('再按一次刪掉');
  // 那一張還在畫面上（以前按一下整疊重畫、橫向捲動回到第一張，正在改的那一張就滑走了）
  const card = await page.locator('.pbcard--edit').boundingBox();
  expect(card.x).toBeGreaterThanOrEqual(0);
  expect(card.x + card.width).toBeLessThanOrEqual(390);
  expect((await app.readDoc('customers', 'cust-a')).longNotes).toHaveLength(2);
  await page.locator('.pbcard--edit [data-del]').click();
  await app.saved();
  expect((await app.readDoc('customers', 'cust-a')).longNotes.map((n) => n.id)).toEqual(['a1']);
  expect(await deckKeys(page)).toEqual(['cust-a:a1', 'cust-c:c1', 'cust-c:c2']);
});

test('L7 客戶詳情中間那張卡「在長備註那一疊看」→ 這一疊開在那一張', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...twoClients()]);
  await app.signIn('/customers/cust-a');

  await page.locator('[data-notes-long="a2"]').click();
  await app.layer('.lncard');
  await page.locator('[data-notecard-deck]').click();
  await app.settled();
  expect(page.url()).toContain('#/customers/notes/cust-a');
  await expect(page.locator('.lnov')).toHaveCount(0);
  await expect(page.locator('[data-goto="cust-a:a2"]')).toHaveAttribute('aria-pressed', 'true');
});

test('N13 LINE 排在長備註底下那一排：LINE 改成按鈕之後，點長備註的下緣照樣開長備註（ADR-0157）', async ({ app, page }) => {
  // `button.mark::after` 上下撐 8px；LINE 從 <a> 換成 <button> 之後要吃的是 -3px 那一條（N11 的同一個形狀）
  await app.seed([...masterDocs(), clientA({
    longNotes: [{ id: 'n1', title: '家人與接送還有停車的地方都要先問過女兒', body: LONG_BODY }],
    noteOrder: ['long:n1', 'line', 'phone', 'mark', 'mark'],
  })]);
  await app.signIn('/customers/cust-n');

  const long = await page.locator('[data-notesblock] [data-notes-long]').boundingBox();
  const line = await page.locator('[data-notesblock] [data-notes-line]').boundingBox();
  expect(line.y).toBeGreaterThan(long.y + long.height); // LINE 真的在下一排
  const x = Math.max(long.x, line.x) + 4;
  for (const y of [long.y + long.height - 1, long.y + long.height - 0.5]) {
    const hit = await page.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return el?.closest('[data-notes-long]') ? 'long' : el?.closest('[data-notes-line]') ? 'line' : el?.className ?? null;
    }, [x, y]);
    expect(hit).toBe('long');
  }
});
