// 備忘錄的手感：捲得動、貼得乾淨、emoji 點得到。
//
// 三件事都是「看起來對、其實不對」的那一種：
//
//   1. 框裡有字，但那些字**捲不到**（flex-shrink 把 textarea 壓回 200px）
//   2. 貼進來的字**被瀏覽器安靜截斷**（maxlength 對 paste 是硬截，不發事件）
//   3. 清洗把她自己打的全形括號一起改掉
//
// 全部只有在瀏覽器裡才看得出來 —— 前兩件是排版，第三件的規則有單元測試，
// 但「有沒有真的接上 paste」沒有。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, playbook, customer, entitlement, visit, slot, TODAY,
} from '../fixtures/data.js';

/** 她從 LINE 筆記本複製出來的那一段（真名換成客戶A）。 */
const LINE_PASTE = [
  '(emoji)今天反思：客訴×顧客會點滴（客戶A）',
  '(emoji)前情提醒',
  '(加1)飯後打針 （通知客人）',
  '(2)預約系統註記（*第一針或*血管難打）',
  '(emoji)當天',
  '(加1)前一天詢問阿長房間負責人',
  '(2)提早10分，來檢查房間（乾淨度），開好冷氣',
  '*休2 萬用卡',
  '(3)檢查療程單在幾樓',
  '(4)結束後，拆止血帶＆詢問車牌號碼＆收回房間鑰匙',
  '(emoji)結束',
  '四樓要清理',
].join('\n');

const DRIP = playbook({
  id: 'pb-drip', title: '營養點滴', courseIds: ['course-iv-drip'], body: ['飯後打針', '收好針頭'],
});

/** 在瀏覽器裡貼一段字進去（真的走 paste 事件，不是 fill）。 */
async function pasteInto(page, selector, text) {
  await page.locator(selector).click();
  await page.evaluate(({ sel, value }) => {
    const el = document.querySelector(sel);
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
    const data = new DataTransfer();
    data.setData('text/plain', value);
    el.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: data, bubbles: true, cancelable: true,
    }));
  }, { sel: selector, value: text });
  await page.waitForTimeout(120);
}

/** 進到「營養點滴」那一張的編輯模式。 */
async function openEditor(app, page) {
  await app.seed([...masterDocs(), DRIP]);
  await app.signIn('/playbook');
  await page.click('[data-edit="pb-drip"]');
  await expect(page.locator('[data-body]')).toBeVisible();
}

test.describe('備忘錄：捲動、貼上、emoji', () => {
  test('M1 貼六十行進去，框裡捲得動，而且存檔鈕還在畫面上', async ({ app, page }) => {
    await openEditor(app, page);

    const long = Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行要做的事`).join('\n');
    await page.fill('[data-body]', long);
    await page.waitForTimeout(120);

    // 框裡真的有東西可以捲 —— 這一條就是那個 bug 本身。
    // 修好之前 scrollHeight 會被壓成跟 clientHeight 一樣（overflow:hidden + 被 shrink）
    const box = await page.locator('[data-body]').evaluate((el) => ({
      scroll: el.scrollHeight, client: el.clientHeight,
    }));
    expect(box.scroll).toBeGreaterThan(box.client + 20);

    // 捲到最底看得到最後一行
    await page.locator('[data-body]').evaluate((el) => { el.scrollTop = el.scrollHeight; });
    await page.waitForTimeout(80);
    const bottom = await page.locator('[data-body]').evaluate(
      (el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 4,
    );
    expect(bottom).toBe(true);

    // **存檔鈕一定要在畫面內。** 打完看不到存檔鈕，等於這一格又壞了一次。
    const save = page.locator('[data-save]');
    await expect(save).toBeInViewport();
  });

  test('M2 貼她那段 LINE 筆記，代碼全部換掉', async ({ app, page }) => {
    await openEditor(app, page);
    await page.fill('[data-body]', '');
    await pasteInto(page, '[data-body]', LINE_PASTE);

    const value = await page.locator('[data-body]').inputValue();
    expect(value).toContain('🐻 今天反思');
    expect(value).toContain('1️⃣ 飯後打針');
    expect(value).toContain('4️⃣ 結束後');
    expect(value).not.toContain('(emoji)');
    expect(value).not.toContain('(加1)');

    // 清洗完要說一句 —— 靜靜地改掉她貼進來的字是這個 app 最不該做的事
    await expect(page.locator('#toast')).toContainText('貼圖代碼');
  });

  test('M3 全形括號與括號外的數字一個字都不動', async ({ app, page }) => {
    await openEditor(app, page);
    await page.fill('[data-body]', '');
    await pasteInto(page, '[data-body]', LINE_PASTE);

    const value = await page.locator('[data-body]').inputValue();
    // 她自己打的全形括號
    expect(value).toContain('（乾淨度）');
    expect(value).toContain('（通知客人）');
    // 括號外面的數字：`*休2 萬用卡`、`提早10分`
    expect(value).toContain('*休2 萬用卡');
    expect(value).toContain('提早10分');
  });

  test('M4 點一顆 emoji 插在游標處，焦點留在輸入框', async ({ app, page }) => {
    await openEditor(app, page);
    await page.fill('[data-body]', 'AB');

    // 游標放在 A 跟 B 中間
    await page.locator('[data-body]').evaluate((el) => {
      el.focus();
      el.setSelectionRange(1, 1);
    });
    await page.click('[data-emoji="⏰"]');

    expect(await page.locator('[data-body]').inputValue()).toBe('A⏰B');

    // 焦點沒有跑掉 —— 跑掉的話她點完一顆還要再點一次輸入框
    const focused = await page.evaluate(
      () => document.activeElement?.dataset?.body !== undefined,
    );
    expect(focused).toBe(true);
  });

  test('M5 存起來、重新整理，emoji 與換行原樣還在', async ({ app, page }) => {
    await openEditor(app, page);
    await page.fill('[data-body]', '');
    await pasteInto(page, '[data-body]', LINE_PASTE);
    await page.click('[data-save]');
    await app.settled();

    await app.reload();
    await app.go('/playbook');

    // 存進去了沒，不是畫面上有沒有
    const saved = await app.readDoc('playbooks', 'pb-drip');
    expect(saved.body).toContain('🐻 今天反思');
    expect(saved.body).toContain('2️⃣ 預約系統註記');
    expect(saved.body.split(String.fromCharCode(10)).length).toBeGreaterThan(10);

    await expect(page.locator('[data-card="pb-drip"] .pbcard__body')).toContainText('🐻 前情提醒');
  });

  test('M6 帶 emoji 的備忘錄，日曆點開來訪浮出來時不破版', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      playbook({
        id: 'pb-drip', title: '營養點滴', courseIds: ['course-iv-drip'],
        body: ['🐻 前情提醒', '1️⃣ 飯後打針（通知客人）', '2️⃣ 預約系統註記', '3️⃣ 檢查療程單在幾樓'],
      }),
      customer({ id: 'c1', name: '客戶A' }),
      entitlement('c1', { id: 'e1', label: '營養點滴 6 次', courseId: 'course-iv-drip', totalQty: 6 }),
      visit({
        id: 'v1', customerId: 'c1', customerName: '客戶A', date: TODAY, status: 'confirmed',
        slots: [slot({
          courseId: 'course-iv-drip', entitlementId: 'e1',
          startsAt: '14:00', endsAt: '15:00',
        })],
      }),
    ]);
    await app.signIn('/calendar');

    await page.click(`[data-day="${TODAY}"]`);
    await page.click('[data-open="visit:v1"]');

    const hint = page.locator('.pbhint').first();
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('1️⃣ 飯後打針');

    // 不溢出：那一塊的內容寬度不可以超過它自己的框
    const overflow = await hint.evaluate((el) => el.scrollWidth - el.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });

  test('M7 這一頁還是一個勾選框都沒有（emoji 是按鈕，不是打勾）', async ({ app, page }) => {
    await openEditor(app, page);
    await expect(page.locator('#view input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('[data-emoji]').first()).toBeVisible();
  });

  test('M8 編輯中整張卡不用捲：emoji 那一排與存檔鈕都在畫面上', async ({ app, page }) => {
    // 她 2026-09-04 回報的 c 與 d：底下那些 icon「完全沒有顯示出來，感覺被壓
    // 在底下但滾輪又滾不到」，而存檔鈕要往下滑才看得到。
    // 根本原因是 flex-shrink 把 `.emojirow` 壓成 2px 高。
    await openEditor(app, page);
    await page.fill('[data-body]', Array.from({ length: 60 }, (_, i) => `第 ${i + 1} 行`).join('\n'));
    await page.waitForTimeout(200);

    const geo = await page.evaluate(() => {
      const card = document.querySelector('.pbcard--edit');
      const row = document.querySelector('.emojirow');
      const body = document.querySelector('.pbedit__body');
      return {
        cardOverflow: card.scrollHeight - card.clientHeight,
        rowHeight: Math.round(row.getBoundingClientRect().height),
        bodyScrolls: body.scrollHeight - body.clientHeight,
      };
    });

    expect(geo.rowHeight, 'emoji 那一排不可以被壓扁').toBeGreaterThan(30);
    expect(geo.cardOverflow, '整張卡不應該需要捲').toBeLessThanOrEqual(1);
    expect(geo.bodyScrolls, '要捲的是內文那一格').toBeGreaterThan(0);

    await expect(page.locator('[data-emoji]').first()).toBeInViewport();
    await expect(page.locator('[data-save]')).toBeInViewport();
    await expect(page.locator('[data-cancel]')).toBeInViewport();
  });

  test('M9 全形括號的代碼也清得掉', async ({ app, page }) => {
    await openEditor(app, page);
    await page.fill('[data-body]', '');
    await pasteInto(page, '[data-body]', '（emoji）前情提醒' + '\n' + '（加1）飯後打針');

    const value = await page.locator('[data-body]').inputValue();
    expect(value).toContain('🐻 前情提醒');
    expect(value).toContain('1️⃣ 飯後打針');
  });

  test('M10 已經在框裡的代碼，用那一顆按鈕清得掉', async ({ app, page }) => {
    // 貼上那條路蓋不到「這個功能上線之前就存在的字」。
    await app.seed([...masterDocs(), playbook({
      id: 'pb-old', title: '舊的', courseIds: [],
      body: ['(emoji)前情提醒', '(加1)飯後打針'],
    })]);
    await app.signIn('/playbook');
    await page.click('[data-edit="pb-old"]');
    await expect(page.locator('[data-body]')).toBeVisible();

    // 有代碼 → 那一顆要看得到
    await expect(page.locator('[data-clean]')).toBeVisible();
    await page.click('[data-clean]');
    await page.waitForTimeout(200);

    const value = await page.locator('[data-body]').inputValue();
    expect(value).toContain('🐻 前情提醒');
    expect(value).not.toContain('(emoji)');
    // 清完就沒事做了，那一顆收起來
    await expect(page.locator('[data-clean]')).toBeHidden();
  });

  test('M11 沒有代碼的時候那一顆不出現', async ({ app, page }) => {
    await openEditor(app, page);
    await expect(page.locator('[data-clean]')).toBeHidden();
  });
});
