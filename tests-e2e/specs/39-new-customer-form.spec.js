// 新增客戶畫面重畫（issue 08，ADR-0102）。
//
// 她 2026-09-17：「新增一個客戶的介面UIUX好醜…"field__hint" 竟然沒有變成tooltip?難怪版面好擠…
// 最下面的card card--flat提醒，我覺得可以變成三角形警示提醒的icon的tooltip」
// 「同名提醒照上面那樣做（姓名欄旁的 ⚠，存檔前再講一次），可以」。
//
// **拿掉那兩句之後，有沒有任何一條路讓她建出一位同名客人、而她完全沒看過那句話？**
// —— N2 盯著：存檔前那一道一定會出現。

import { test, expect } from '../fixtures/app.js';
import { customer, masterDocs } from '../fixtures/data.js';

const warnIn = (page, slot) => page.locator(`[data-cf-warn="${slot}"] .tip--warn`);

test('N1 新增客戶那一頁：沒有手寫的 field__hint、沒有 card--flat，三塊各一個標題', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/customers/new');
  await expect(page.locator('[data-cf-form]')).toBeVisible();
  await expect(page.locator('#view .field__hint')).toHaveCount(0);
  await expect(page.locator('#view .card--flat')).toHaveCount(0);
  await expect(page.locator('.cform__title')).toHaveText(['是誰', '買了什麼', '要記得的']);
  // 沒事的時候一顆 ⚠ 都沒有（電話空著那一顆除外 —— 那是真的有事）
  await expect(warnIn(page, 'name')).toHaveCount(0);
});

test('N2 打一個已經有的名字 → 姓名欄旁出現 ⚠；按建立先跳「先看一下」，裡面有同名那一句；刪一個字 ⚠ 消失而且沒有捲回最上面', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-w', name: '王小明', phone: '0900000000' })]);
  await app.signIn('/customers/new');

  const name = page.locator('[data-cf-form] input[name="name"]');
  await name.fill('王小明');
  await expect(warnIn(page, 'name')).toHaveCount(1);
  await warnIn(page, 'name').click();
  await expect(page.locator('.tip__bubble')).toContainText('已經有 1 位客戶也叫「王小明」');
  await page.keyboard.press('Escape');

  await page.locator('[data-cf-form] input[name="phone"]').fill('0911111111');
  await page.locator('.cform__bar button[type="submit"]').click();
  await expect(app.dialog()).toContainText('已經有 1 位客戶也叫「王小明」');
  await app.cancelDialog();
  expect((await app.readAll('customers')).length, '回去改 → 一位都沒建').toBe(1);

  // 捲到下面再刪字：⚠ 換掉了，但頁面沒有被整個重畫、沒有捲回最上面
  await page.locator('.cform__group').nth(2).scrollIntoViewIfNeeded();
  await name.focus();
  const before = await page.evaluate(() => document.scrollingElement.scrollTop + (document.querySelector('.app__main')?.scrollTop ?? 0));
  await page.keyboard.press('End');
  await page.keyboard.press('Backspace');
  await expect(warnIn(page, 'name')).toHaveCount(0);
  await expect(name).toBeFocused();
  const after = await page.evaluate(() => document.scrollingElement.scrollTop + (document.querySelector('.app__main')?.scrollTop ?? 0));
  expect(Math.abs(after - before)).toBeLessThan(40);
});

test('N3 選方案、幾套打 0 → 數量旁出現 ⚠；照樣建得起來，方案不展開', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/customers/new');
  await page.locator('[data-cf-form] input[name="name"]').fill('李小華');
  await page.locator('[data-cf-form] input[name="phone"]').fill('0922222222');
  await page.locator('[data-cf-form] [data-chip="planId"][data-chip-value="plan-jingu"]').click();
  const qty = page.locator('[data-cf-form] input[name="quantity"]');
  await expect(qty).toBeVisible();
  await expect(page.locator('.cform__expand li').first()).toBeVisible();
  await qty.fill('0');
  await expect(warnIn(page, 'quantity')).toHaveCount(1);
  await expect(page.locator('.cform__expand')).toHaveCount(0);

  await page.locator('.cform__bar button[type="submit"]').click();
  await app.saved();
  await expect(page).toHaveURL(/#\/customers\/[^/]+$/);
  const created = (await app.readAll('customers')).find((c) => c.name === '李小華');
  expect(created).toBeTruthy();
  expect(await app.readAll(`customers/${created.id}/entitlements`)).toHaveLength(0);
});

test('N4 客戶詳情 → 編輯：永久限制與合作機構那一塊也沒有常駐說明，而且存得起來', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-e', name: '客戶A', phone: '0933333333' })]);
  await app.signIn('/customers/cust-e');
  await page.locator('[data-edit]').click();
  await expect(page.locator('[data-flags] .fieldgroup')).toBeVisible();
  await expect(page.locator('#view .field__hint')).toHaveCount(0);
  await page.locator('[data-others]').fill('固定禮拜五不行');
  await page.locator('#view form button[type="submit"]').first().click();
  await app.saved();
  expect((await app.readDoc('customers', 'cust-e')).flags).toContain('固定禮拜五不行');
});

test('N5 mountCustomerForm() 掛在一個空的 <div> 裡、帶一份草稿 → 欄位都是草稿的值（09 的小鉛筆用這一條）', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/');
  const values = await page.evaluate(async () => {
    const { mountCustomerForm, blankDraft } = await import('/js/ui/components/customerForm.js');
    const host = document.createElement('div');
    document.body.append(host);
    mountCustomerForm(host, {
      draft: { ...blankDraft('2026-08-27'), name: '王小明', source: '0827 顧客會', lineId: 'wang' },
      plans: [], existing: [], alerts: [], master: { partners: [] },
      onSubmit: () => {},
    });
    const v = (n) => host.querySelector(`[name="${n}"]`).value;
    const out = { name: v('name'), source: v('source'), lineId: v('lineId'), purchasedAt: v('purchasedAt') };
    host.remove();
    return out;
  });
  expect(values).toEqual({ name: '王小明', source: '0827 顧客會', lineId: 'wang', purchasedAt: '2026-08-27' });
});

// 她 2026-09-18：「新增一位客戶那邊的，取消以及建立客戶的那排按鈕懸空了，很像之前壓表批次取消那時候發生的事」
// （`.scratch/asks-2026-09-18/issues/04`）。同一個形狀：sticky 的 `bottom: 0` 從捲動區的內容邊算，
// `.app__main` 底下留給導覽列的那 44px（iPad 30px）讓那一條永遠停在留白上緣。
// **量畫出來的位置，不掃 CSS**（批次取消 9/10 那次掃字串的測試綠著、畫面照樣懸空）。

function measureBar(page) {
  return page.evaluate(() => {
    const box = (el) => el && el.getBoundingClientRect();
    const bar = box(document.querySelector('.cform__bar'));
    const nav = box(document.querySelector('.app__nav'));
    const view = document.querySelector('#view');
    const rows = [...document.querySelectorAll('.cform .fieldgroup, .cform .field')];
    // 手機導覽在下面，底就是它的頂；iPad 導覽在側邊，底就是畫面底
    const floor = nav.top > window.innerHeight / 2 ? nav.top : window.innerHeight;
    return { barTop: bar.top, barBottom: bar.bottom, floor, lastRowBottom: box(rows.at(-1)).bottom,
      scrollH: view.scrollHeight, clientH: view.clientHeight };
  });
}

const scrollView = (page, to) => page.evaluate((where) => {
  const v = document.querySelector('#view');
  v.scrollTop = where === 'end' ? v.scrollHeight : where;
}, to);

for (const vp of [{ width: 414, height: 896, label: '手機' }, { width: 1024, height: 768, label: 'iPad' }]) {
  test(`N9 ${vp.label}：取消／建立客戶那一條貼在底上 —— 捲到一半沒有縫，捲到底最後一排完整露出來`, async ({ app, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await app.seed([...masterDocs()]);
    await app.signIn('/customers/new');
    await expect(page.locator('.cform__bar')).toBeVisible();

    await scrollView(page, 300);
    const mid = await measureBar(page);
    expect(mid.scrollH, '這一頁比一個畫面長，才有「捲到一半」').toBeGreaterThan(mid.clientH);
    expect(Math.abs(mid.barBottom - mid.floor), `捲到一半：那一條的底 ${mid.barBottom}、底線 ${mid.floor}`)
      .toBeLessThanOrEqual(1);

    await scrollView(page, 'end');
    const end = await measureBar(page);
    expect(Math.abs(end.barBottom - end.floor), `捲到底：那一條的底 ${end.barBottom}、底線 ${end.floor}`)
      .toBeLessThanOrEqual(1);
    expect(end.lastRowBottom, '最後一排在那一條上面，不是被它蓋住').toBeLessThanOrEqual(end.barTop + 1);
  });
}
