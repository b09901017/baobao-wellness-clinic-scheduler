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

// ---------------------------------------------------------------------------
// 3. 一按鉛筆反而變矮（issue 07）
//
// 她 2026-09-10：「希望可以預設那個備忘錄可以長一點，我點鉛筆修改的時候他就會
// 變短？能不能在長一點，尤其是在修改的時候不要變短」。
//
// 量高度這件事單元測試釘不住 —— `.pbdeck[data-editing='true']` 的天花板
// 只有在真的畫出來的瀏覽器裡才看得到。
// ---------------------------------------------------------------------------

/** 一個選擇器現在畫出來多高。量不到回 null，不要靜靜地回 0。 */
function heightOf(page, selector) {
  return page.evaluate((s) => {
    const el = document.querySelector(s);
    return el ? el.getBoundingClientRect().height : null;
  }, selector);
}

test('E3 按鉛筆進編輯之後，那張卡不會比讀的時候矮', async ({ app, page }) => {
  await app.seed([...masterDocs(), REHAB]);
  await app.signIn('/playbook');
  await app.settled();

  await expect(page.locator('[data-card="pb-r"]')).toBeVisible();
  const read = await heightOf(page, '[data-card="pb-r"]');

  await page.click('[data-edit="pb-r"]');
  await expect(page.locator('.pbcard--edit')).toBeVisible();
  await expect(page.locator('.pbedit__body')).toBeVisible();
  const edit = await heightOf(page, '.pbcard--edit');

  expect(
    edit,
    `讀的時候 ${read.toFixed(0)}px，一按鉛筆變成 ${edit.toFixed(0)}px —— `
      + '底下那一排清空之後，.pbdeck[data-editing] 的天花板就沒有存在理由了',
  ).toBeGreaterThanOrEqual(read - 1);

  // 而且輸入框要真的吃掉卡片裡剩下的空間（她的 e）
  const body = await heightOf(page, '.pbedit__body');
  expect(body, '內文那一格沒有被撐開').toBeGreaterThan(edit * 0.4);
});

test('E4 「存起來」在右上角，底下那一排整個不見了', async ({ app, page }) => {
  await app.seed([...masterDocs(), REHAB]);
  await app.signIn('/playbook');
  await app.settled();

  await page.click('[data-edit="pb-r"]');
  await expect(page.locator('.pbcard--edit')).toBeVisible();

  // 底下那一排（存起來／取消／刪掉）整排清空 —— 那正是天花板可以拿掉的理由
  await expect(page.locator('.pbedit__actions')).toHaveCount(0);
  await expect(page.locator('[data-cancel]'), '取消移除了，改成點外面才問').toHaveCount(0);

  // 存起來搬到原本鉛筆的位置：它在卡片的上半部
  const geo = await page.evaluate(() => {
    const card = document.querySelector('.pbcard--edit');
    const save = card.querySelector('[data-save]');
    const del = card.querySelector('[data-del]');
    const c = card.getBoundingClientRect();
    const s = save.getBoundingClientRect();
    const d = del.getBoundingClientRect();
    return {
      saveFromTop: s.top - c.top,
      cardHeight: c.height,
      // 兩顆之間的視覺間距，**不管誰在左邊**。44px 的感應範圍要不疊到，中間至少留 16px
      gap: Math.max(s.left - d.right, d.left - s.right),
      // 存起來在最右邊 —— 那是鉛筆原本的位置
      saveIsRightmost: s.right >= d.right,
    };
  });

  expect(geo.saveFromTop, '「存起來」不在卡片的上半部').toBeLessThan(geo.cardHeight / 2);
  expect(geo.saveIsRightmost,
    '她：「放在這個備忘錄的右上角就是原本鉛筆的地方」—— 垃圾桶在它左邊').toBe(true);
  expect(geo.gap, '兩顆並排中間至少留 16px，不然兩個 44px 的感應範圍會疊')
    .toBeGreaterThanOrEqual(16);
});

// ---------------------------------------------------------------------------
// 3. toast 不可以蓋在導覽列或懸浮鈕上（`.scratch/asks-2026-09-18/issues/01`）
// ---------------------------------------------------------------------------
//
// 她 2026-09-18：「存完客戶想點『壓表』分頁，結果點到 toast 的『復原』，把剛建的客戶整個刪掉了」。
// 那時 toast 是 `bottom: 22px`，手機的導覽列有 58px 高 —— 「復原」整顆疊在「壓表」「日曆」上。
// 往上搬還不夠：六頁有懸浮鈕，置中的長訊息會把「復原」推到懸浮鈕上，同一個問題往上搬一層。

const rectOf = (page, sel) => page.evaluate((s) => {
  const r = document.querySelector(s)?.getBoundingClientRect();
  return r ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right } : null;
}, sel);

test('F1 建好客戶的那一條 toast 在導覽列上面，每一格導覽都按得到', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/customers/new');
  await page.locator('[data-cf-form] input[name="name"]').fill('客戶A');
  await page.locator('[data-cf-form] input[name="phone"]').fill('0911111111');
  await page.locator('.cform__bar button[type="submit"]').click();
  await expect(page.locator('#toast [data-undo]')).toBeVisible();

  const toast = await rectOf(page, '#toast');
  const nav = await rectOf(page, '.app__nav');
  expect(toast.bottom, `toast 的底 ${toast.bottom} 要在導覽列的頂 ${nav.top} 上面`).toBeLessThanOrEqual(nav.top);

  // 每一格導覽的正中間按下去，按到的是那一格 —— 不是「復原」
  const hits = await page.evaluate(() => [...document.querySelectorAll('.app__nav a')].map((a) => {
    const r = a.getBoundingClientRect();
    return Boolean(document.elementFromPoint((r.left + r.right) / 2, r.top + 4)?.closest('.app__nav'));
  }));
  expect(hits.every(Boolean), '導覽列最上緣那一條也按得到').toBe(true);
});

for (const vp of [{ width: 414, height: 896, label: '手機' }, { width: 1024, height: 768, label: 'iPad' }]) {
  test(`F2 ${vp.label}：長訊息的 toast 也不會蓋到懸浮鈕`, async ({ app, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await app.seed([...masterDocs()]);
    await app.signIn('/customers');
    await expect(page.locator('.fab__main').first()).toBeVisible();

    // 最長的那一種：一句話外加「復原」。走 app 自己的那一份模組（同一個網址＝同一個實例）
    await page.evaluate(async () => {
      const toast = await import('/js/ui/toast.js');
      toast.saved('已儲存，這一句故意寫得很長很長，看它換行之後會不會伸到右下角的懸浮鈕上面', async () => {});
    });
    await expect(page.locator('#toast [data-undo]')).toBeVisible();

    const toast = await rectOf(page, '#toast');
    const fab = await rectOf(page, '.fab__main');
    const apart = toast.right <= fab.left || toast.bottom <= fab.top || toast.top >= fab.bottom;
    expect(apart, `toast ${JSON.stringify(toast)} 跟懸浮鈕 ${JSON.stringify(fab)} 疊在一起`).toBe(true);
    const undo = await rectOf(page, '#toast [data-undo]');
    expect(undo.bottom - undo.top, '訊息再長縮的也是字，「復原」不可以被擠成兩行').toBeLessThan(50);
  });

  test(`F3 ${vp.label}：新增客戶那一頁，存失敗的那一句不會蓋在「取消／建立客戶」上`, async ({ app, page }) => {
    await page.setViewportSize({ width: vp.width, height: vp.height });
    await app.seed([...masterDocs()]);
    await app.signIn('/customers/new');
    await expect(page.locator('.cform__bar')).toBeVisible();

    // 帶「重試」的那一句不會自己消失 —— 蓋住的話就是一直蓋著
    await page.evaluate(async () => {
      const toast = await import('/js/ui/toast.js');
      toast.failed('儲存失敗：網路斷了，這一句也寫得長一點看它會不會往下長', () => {});
    });
    await expect(page.locator('#toast [data-retry]')).toBeVisible();

    const toast = await rectOf(page, '#toast');
    const bar = await rectOf(page, '.cform__bar');
    expect(toast.bottom, `toast 的底 ${toast.bottom} 要在那一條的頂 ${bar.top} 上面`).toBeLessThanOrEqual(bar.top);
  });
}

test('F4 面板開著的時候 toast 在最上面，不擋面板裡的任何一列', async ({ app, page }) => {
  await app.seed(seedOneVisit());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');

  await page.evaluate(async () => {
    const toast = await import('/js/ui/toast.js');
    toast.saved('這一段改成已確認', async () => {});
  });
  await expect(page.locator('#toast [data-undo]')).toBeVisible();

  const toast = await rectOf(page, '#toast');
  const drawer = await rectOf(page, '.drawer');
  expect(toast.bottom, `toast 的底 ${toast.bottom} 要在面板的頂 ${drawer.top} 上面`).toBeLessThanOrEqual(drawer.top);
});
