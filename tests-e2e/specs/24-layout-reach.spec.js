// 兩個「看得到但摸不到」的版面問題。都只能在真的瀏覽器裡量。
//
// ## 1. 收合抽屜的第一幀
//
// 她 2026-09-08：「關閉抽屜時會先往上微跳一下，才往下滑動收合」。
//
// `dismiss()` 先 `goTall()`（面板變滿高，上緣往上跑 `peekY`，然後用 `setY()`
// 推回原位補償），接著同一輪就開始過場。但 `goTall()` 裡有兩次
// `getBoundingClientRect()` —— 那會強制算一次樣式，而那一刻 class 已經加上、
// 位移還沒補。於是過場的**起點**被定在「已經變高、還沒補位移」那個位置。
//
// **單元測試看不到這個**：程式碼兩種寫法都「呼叫了 goTall 然後 settleAt」，
// 差別只有隔不隔一幀。所以這一支量的是真的畫出來的位置。
//
// ## 2. 備忘錄編輯卡的「存起來」
//
// 她 2026-09-04 回報過一次：東西在那裡但看不到也捲不到。卡片裡除了內文那一格
// 每一項都要 `flex: none`，少一條那一項就會被 flex 壓扁。
//
// 而 2026-09-08 把「掛課程」與「掛機構」收成一行（分段切換）正是為了這個 ——
// 兩排各自一個標籤加一排丸子是四行，那兩行就是把「存起來」擠出畫面的原因。
//
// **這一條是她要的那件事**：展開編輯，不用捲動就看得到「存起來」。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, playbook, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

// ---------------------------------------------------------------------------
// 1. 收合抽屜不可以先往上跳
// ---------------------------------------------------------------------------

function seedOneVisit() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-d', name: '王小明' }),
    entitlement('cust-d', {
      id: 'ent-1', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 20, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'v-one', customerId: 'cust-d', customerName: '王小明',
      date: TODAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-1',
        startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      })],
    }),
  ];
}

test('D1 收合抽屜的每一幀都只往下，不往上跳', async ({ app, page }) => {
  await app.seed(seedOneVisit());
  await app.signIn('/calendar');
  await app.go('/calendar');

  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await page.waitForTimeout(800);
  await expect(page.locator('.drawer')).toBeVisible();

  // 先架好取樣，再按叉叉 —— 反過來的話第一幀已經過去了
  await page.evaluate(() => {
    window.__tops = [];
    const el = document.querySelector('.drawer');
    const step = () => {
      if (!el.isConnected || window.__tops.length >= 40) return;
      window.__tops.push(el.getBoundingClientRect().top);
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });

  await page.locator('.drawer .drawer__x').click();
  await page.waitForTimeout(700);

  const tops = await page.evaluate(() => window.__tops);
  expect(tops.length, '至少要量到幾幀').toBeGreaterThan(3);

  // 起點就是她按下去那一刻看到的位置。往上跳 = 有一幀的 top 比起點小。
  // 容忍 2px 給次像素捨入。
  const highest = Math.min(...tops);
  expect(
    highest,
    `收合的過程中往上跳了 ${(tops[0] - highest).toFixed(1)}px —— `
      + `goTall() 的補位移要隔一幀才落地（起點 ${tops[0].toFixed(1)}）`,
  ).toBeGreaterThan(tops[0] - 2);
});

// ---------------------------------------------------------------------------
// 2. 展開編輯，不用捲動就看得到「存起來」
// ---------------------------------------------------------------------------

const REHAB = playbook({
  id: 'pb-r', title: '復健科流程', courseIds: ['course-recovery'],
  body: ['三樓報到', '帶健保卡', '先量血壓', '結束後回四樓', '拿藥單'],
});

test('E1 備忘錄編輯卡展開後「存起來」在畫面裡，不用捲', async ({ app, page }) => {
  await app.seed([...masterDocs(), REHAB]);
  await app.signIn('/playbook');
  await app.settled();

  await page.click('[data-edit="pb-r"]');
  await expect(page.locator('.pbcard--edit')).toBeVisible();
  await page.waitForTimeout(400);

  const save = page.locator('.pbcard--edit [data-save]');
  await expect(save).toBeVisible();

  // `toBeVisible()` 對「在 overflow 裡被切掉」是綠的，所以要自己量：
  // 那顆按鈕的框要真的落在卡片的可視範圍裡
  const fits = await page.evaluate(() => {
    const card = document.querySelector('.pbcard--edit');
    const btn = card.querySelector('[data-save]');
    const c = card.getBoundingClientRect();
    const b = btn.getBoundingClientRect();
    return {
      inCard: b.bottom <= c.bottom + 1 && b.top >= c.top - 1,
      inViewport: b.bottom <= window.innerHeight + 1 && b.top >= 0,
      cardScrolls: card.scrollHeight > card.clientHeight + 1,
    };
  });

  expect(fits.inCard, '「存起來」被卡片切掉了').toBe(true);
  expect(fits.inViewport, '「存起來」在畫面外').toBe(true);
  expect(fits.cardScrolls, '卡片不該需要捲動 —— 掛課程與掛機構收成一行就是為了這個').toBe(false);
});

test('E2 掛課程與掛機構是同一行的分段切換，兩個 hidden input 都留在 DOM 裡', async ({ app, page }) => {
  await app.seed([...masterDocs(), REHAB]);
  await app.signIn('/playbook');
  await app.settled();

  await page.click('[data-edit="pb-r"]');
  await expect(page.locator('.pbcard--edit')).toBeVisible();

  const tabs = page.locator('.pbcard--edit [data-hang]');
  await expect(tabs, '兩排收成一行 = 兩顆分段按鈕').toHaveCount(2);

  // 切過去只換 hidden 與 aria-selected —— 拿掉節點的話她切一下就把掛好的課程清光了
  await tabs.nth(1).click();
  await page.waitForTimeout(200);

  await expect(page.locator('.pbcard--edit [data-hang-panel="courseIds"]')).toHaveCount(1);
  await expect(page.locator('.pbcard--edit [data-hang-panel="partners"]')).toHaveCount(1);

  // 切回去，掛好的課程還在
  await tabs.nth(0).click();
  await page.waitForTimeout(200);
  await page.click('.pbcard--edit [data-save]');
  await app.settled();
  await page.waitForTimeout(700);

  const saved = await app.readDoc('playbooks', 'pb-r');
  expect(saved.courseIds, '切一下分頁不可以把掛好的課程清掉').toEqual(['course-recovery']);
});
