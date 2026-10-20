// 逾期／今天／明天那三頁的「已完成」（.scratch/after-golive-2026-10-20/ 的 03、04，ADR-0166，推翻 ADR-0152 決定 4）。
//
// 她 10/20：「我發現待辦首頁，的今天，他的已完成是不是裝飾啊 ? 我勾起來的怎麼沒有跑到已完成……
// 到了明天後，未完成就會到逾期，已完成就會清空，但只是這邊呈現清空，再隨手記那邊或月曆其他地方不會被清掉……
// 就是我想要今天份的點進去後可以看到已完成和未完成，包含重其他地方點的完成也是放已完成」
//
// 以前已完成那一格只有任務：隨手記、簽療程單勾掉了哪裡都不在。三頁的已完成也拿掉了垃圾桶與「清掉這 N 筆」
// （按下去會真的把隨手記刪掉，跟「只是這邊呈現清空」相反），只給看與拿回來。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, task, visit, slot, note, TODAY, addDays,
} from '../fixtures/data.js';

const YESTERDAY = addDays(TODAY, -1);
const TOMORROW = addDays(TODAY, 1);
const LAST_WEEK = addDays(TODAY, -7);

/** 台灣的時間 → `doneAt`／`statusAt` 存的樣子（`toISOString()`，UTC）。 */
const iso = (local) => new Date(`${local}+08:00`).toISOString();
/** 種子很久以前建的那一刻（`createdAt`）。 */
const LONG_AGO = new Date(`${addDays(TODAY, -28)}T09:00:00+08:00`);

/**
 * 建立之後又被寫過一次（她勾的、簽的那一下）。**種子自己補的 `createdAt`／`updatedAt` 是兩次 `new Date()`**，
 * 常常是同一毫秒 —— 那在 app 眼裡是「一出生就做完的」（ADR-0166 決定 3），會被排除。所以做完的那幾筆一律自己給。
 */
const touched = (d, at) => ({ ...d, data: { ...d.data, createdAt: LONG_AGO, updatedAt: new Date(at) } });
/** 一出生就做完的：同一次寫入，兩格同一刻。 */
const born = (d, at) => ({ ...d, data: { ...d.data, createdAt: new Date(at), updatedAt: new Date(at) } });

const ivEnt = (cust, id) => entitlement(cust, {
  id, label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 20, bookedCount: 1, durationMin: 60,
});
const ivSlot = (ent, status, startsAt = '10:00', endsAt = '11:00') => ({
  ...slot({ courseId: 'course-iv-laser', entitlementId: ent, startsAt, endsAt }), status,
});
const people = () => [
  customer({ id: 'cust-a', name: '客戶A' }),
  customer({ id: 'cust-b', name: '客戶B' }),
  customer({ id: 'cust-c', name: '客戶C' }),
  ivEnt('cust-a', 'ent-a'), ivEnt('cust-b', 'ent-b'), ivEnt('cust-c', 'ent-c'),
];

const doneTab = (page) => page.locator('[data-task-tab="done"]');
const openTab = (page) => page.locator('[data-task-tab="open"]');

/** 三頁的已完成只給看與拿回來：一顆會刪東西的按鈕都沒有。 */
async function nothingDeletes(page) {
  await expect(page.locator('[data-clear-done]')).toHaveCount(0);
  await expect(page.locator('[data-drop]')).toHaveCount(0);
  await expect(page.locator('.noterow__trash')).toHaveCount(0);
}

// ---------------------------------------------------------------------------
// 今天：三個入口勾的，都在今天的已完成；到了明天自己空了，別的地方照舊在
// ---------------------------------------------------------------------------

test('D1 今天那一頁勾任務、日曆勾隨手記、簽療程單那一頁簽掉 → 今天的已完成三塊各一件；隔天空了、別處照舊在', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    ...people(),
    task({ id: 't-ex', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine', dueDate: TODAY }),
    note({ id: 'n-cal', text: '帶同意書給客戶A', date: TODAY }),
    visit({
      id: 'v-b', customerId: 'cust-b', customerName: '客戶B', date: TODAY, status: 'confirmed',
      slots: [ivSlot('ent-b', 'confirmed')],
    }),
  ]);
  await app.signIn('/todo/today');
  await expect(openTab(page)).toHaveText('未完成 3');
  await expect(doneTab(page)).toHaveText('已完成');

  // 1. 在今天那一頁勾任務
  await page.locator('[data-task="t-ex"]').check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await app.saved();

  // 2. 在日曆勾隨手記
  await app.go('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open="note:n-cal"]');
  await page.locator('[data-open="note:n-cal"]').click();
  await page.locator('[data-tick]').click();
  await app.saved();

  // 3. 在簽療程單那一頁簽掉
  await app.go('/todo/close');
  await page.locator('[data-open="v-b"]').click();
  await app.tickAll();
  await page.locator('[data-apply]').click();
  await app.saved();

  // 回今天那一頁：未完成空了，已完成三塊各一件
  await app.go('/todo/today');
  await expect(openTab(page)).toHaveText('未完成');
  await expect(doneTab(page)).toHaveText('已完成 3');
  await doneTab(page).click();
  await expect(page.locator('[data-untick="t-ex"]')).toBeVisible();
  await expect(page.locator('[data-visit="v-b"]')).toContainText('1 段做了');
  await expect(page.locator('[data-done-notes] [data-note="n-cal"]')).toBeVisible();
  await expect(page.locator('#view')).toContainText('待辦 1');
  await expect(page.locator('#view')).toContainText('簽療程單 1');
  await expect(page.locator('#view')).toContainText('隨手記 1');
  await nothingDeletes(page);

  // 到了明天：今天的已完成空了 —— 只是這邊呈現清空
  await app.travelTo(TOMORROW);
  await expect(doneTab(page)).toHaveText('已完成');
  await doneTab(page).click();
  await expect(page.locator('#view')).toContainText('還沒有勾掉的。');
  // 逾期那一頁也沒有它們（那幾件是昨天做完的，不是今天）
  await app.go('/todo/overdue');
  await expect(doneTab(page)).toHaveText('已完成');

  // 別的地方照舊在
  await app.go('/todo/notes');
  await page.locator('[data-notes-tab="done"]').click();
  await expect(page.locator('#view')).toContainText('帶同意書給客戶A');
  await app.go('/todo/Examine');
  await doneTab(page).click();
  await expect(page.locator('[data-untick="t-ex"]')).toBeVisible();
  expect((await app.readDoc('notes', 'n-cal')).deletedAt).toBeNull();
  expect((await app.readDoc('visits', 'v-b')).status).toBe('done');
});

// ---------------------------------------------------------------------------
// 逾期：只收今天才做完的
// ---------------------------------------------------------------------------

test('D2 逾期：死線昨天、今天勾的在；上週、昨天勾的不在；昨天的今天才簽的在、昨天就簽的不在；拍照一出生就結案的不在', async ({ app, page }) => {
  const doneSlot = [ivSlot('ent-c', 'done')];
  await app.seed([
    ...masterDocs(),
    ...people(),
    task({ id: 't-yday', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine', dueDate: YESTERDAY }),
    touched(task({
      id: 't-old', customerId: 'cust-a', customerName: '客戶A', kind: '耀聖', dueDate: LAST_WEEK,
      done: true, doneAt: iso(`${YESTERDAY}T10:00:00`),
    }), iso(`${YESTERDAY}T10:00:00`)),
    touched(visit({
      id: 'v-signed-today', customerId: 'cust-b', customerName: '客戶B', date: YESTERDAY, status: 'done',
      slots: [ivSlot('ent-b', 'done')], statusAt: iso(`${TODAY}T09:00:00`),
    }), iso(`${TODAY}T09:00:00`)),
    touched(visit({
      id: 'v-signed-yday', customerId: 'cust-c', customerName: '客戶C', date: YESTERDAY, status: 'done',
      slots: doneSlot, statusAt: iso(`${YESTERDAY}T18:00:00`),
    }), iso(`${YESTERDAY}T18:00:00`)),
    born(visit({
      id: 'v-photo', customerId: 'cust-c', customerName: '客戶C', date: LAST_WEEK, status: 'done',
      slots: doneSlot, statusAt: iso(`${TODAY}T11:00:00`),
    }), iso(`${TODAY}T11:00:00`)),
  ]);
  await app.signIn('/todo/overdue');
  await expect(openTab(page)).toHaveText('未完成 1');
  // 種子裡已經有一件：昨天的、今天才簽的
  await expect(doneTab(page)).toHaveText('已完成 1');

  await page.locator('[data-task="t-yday"]').check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await app.saved();

  await expect(doneTab(page)).toHaveText('已完成 2');
  await doneTab(page).click();
  await expect(page.locator('[data-untick="t-yday"]')).toBeVisible();
  await expect(page.locator('[data-visit="v-signed-today"]')).toBeVisible();
  await expect(page.locator('[data-untick="t-old"]')).toHaveCount(0);
  await expect(page.locator('[data-visit="v-signed-yday"]')).toHaveCount(0);
  await expect(page.locator('[data-visit="v-photo"]')).toHaveCount(0);
  await nothingDeletes(page);
});

// ---------------------------------------------------------------------------
// 點一列：隨手記拿回來（不接長按）、簽好的那一天開讀取卡片；分類頁照舊有垃圾桶
// ---------------------------------------------------------------------------

test('D3 已完成的隨手記：長按沒有選單、點一下拿回來；簽好的那一天開讀取卡片；Examine 那一頁照舊清得掉', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    ...people(),
    touched(note({
      id: 'n-done', text: '已經打過電話', date: TODAY, done: true, doneAt: iso(`${TODAY}T10:00:00`),
    }), iso(`${TODAY}T10:00:00`)),
    touched(visit({
      id: 'v-signed', customerId: 'cust-b', customerName: '客戶B', date: TODAY, status: 'done',
      slots: [ivSlot('ent-b', 'done'), ivSlot('ent-b', 'no_show', '13:00', '14:00')], statusAt: iso(`${TODAY}T11:00:00`),
    }), iso(`${TODAY}T11:00:00`)),
    touched(task({
      id: 't-ex-done', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine', dueDate: LAST_WEEK,
      done: true, doneAt: iso(`${LAST_WEEK}T10:00:00`),
    }), iso(`${LAST_WEEK}T10:00:00`)),
  ]);
  await app.signIn('/todo/today');
  await expect(doneTab(page)).toHaveText('已完成 2');
  await doneTab(page).click();
  await expect(page.locator('[data-visit="v-signed"]')).toContainText('1 段做了、1 段沒來');

  // 按住已完成的那一則：長按根本沒接上（按下去那一刻就不會有按壓的回饋）；放開＝點一下＝拿回來
  const done = page.locator('[data-done-notes] [data-note="n-done"]');
  const box = await done.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(done).not.toHaveClass(/is-pressing/);
  await page.mouse.up();
  await app.saved();
  expect((await app.readDoc('notes', 'n-done')).done).toBe(false);
  await expect(doneTab(page)).toHaveText('已完成 1');

  // 對照：回到未完成那一側的同一則，長按照舊有選單 —— 上面那一句「沒有按壓的回饋」量得到東西
  await openTab(page).click();
  const open = page.locator('[data-notes] [data-note="n-done"]');
  const box2 = await open.boundingBox();
  await page.mouse.move(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.mouse.down();
  await expect(open).toHaveClass(/is-pressing/);
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('.actions__cancel[data-actions-close]').click();

  // 簽好的那一天 → 讀取卡片，只給看（沒有簽單抽屜那幾顆、沒有勾選框），也沒有跳「找不到這一天的來訪」
  await doneTab(page).click();
  await page.locator('[data-visit="v-signed"]').click();
  const card = page.getByRole('dialog', { name: /客戶B/ });
  await expect(card).toBeVisible();
  await expect(card).toContainText('13:00–14:00');
  await expect(card.locator('input, [data-pick]')).toHaveCount(0);
  await expect(page.locator('#toast')).not.toContainText('找不到這一天的來訪');
  await expect(page).toHaveURL(/#\/todo\/today$/);

  // 分類頁的已完成照舊：垃圾桶與「清掉這 N 筆」都在
  await app.go('/todo/Examine');
  await doneTab(page).click();
  await expect(page.locator('[data-drop="t-ex-done"]')).toBeVisible();
  await expect(page.locator('[data-clear-done]')).toBeVisible();
});

// ---------------------------------------------------------------------------
// 明天：提早做完的在明天的已完成；到了明天就在今天的已完成
// ---------------------------------------------------------------------------

test('D4 明天那一頁提早勾掉任務與隨手記 → 在明天的已完成、不在今天的；到了明天它們在今天的已完成', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    ...people(),
    task({ id: 't-tom', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine', dueDate: TOMORROW }),
    note({ id: 'n-tom', text: '明天要帶的東西', date: TOMORROW }),
  ]);
  await app.signIn('/todo/tomorrow');
  await expect(openTab(page)).toHaveText('未完成 2');

  await page.locator('[data-task="t-tom"]').check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await app.saved();
  await page.locator('[data-notes] [data-note="n-tom"]').click();
  await app.saved();

  await expect(doneTab(page)).toHaveText('已完成 2');
  await doneTab(page).click();
  await expect(page.locator('[data-untick="t-tom"]')).toBeVisible();
  await expect(page.locator('[data-done-notes] [data-note="n-tom"]')).toBeVisible();
  await nothingDeletes(page);

  await app.go('/todo/today');
  await expect(doneTab(page)).toHaveText('已完成');

  await app.travelTo(TOMORROW);
  await expect(doneTab(page)).toHaveText('已完成 2');
});
