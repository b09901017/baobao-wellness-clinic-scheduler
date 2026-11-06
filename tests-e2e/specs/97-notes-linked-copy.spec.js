// 2026-11-06 隨手記這一輪 04、05：複製到別天、預設連在一起（ADR-0179）。
//
// 她：「我想要連起來誒，不然就是可以複製的時候決定，但預設是連起來的，然後複製這個功能也可以放入長按裡面?」
//
// 量的是：
// - 長按 → 複製到別天 → 小月曆點兩天（跨到下個月）→ 一個 commit 建兩筆、原本那一筆補 linkId
// - 清單上一組是一列（「共 3 天」），日曆上每一天各一筆
// - 在日曆勾其中一天 → 整組一起勾，**連不在這個月、畫面上沒有的那一天也勾**（寫的那一刻重讀）
// - 拆開這一天 → 以後各勾各的
// - 日曆編輯器只改日期按存 → 另外那幾天一則稽核都不多
// - 「改日期」那張卡、營養品的提醒沒有「複製到別天」、點外面關掉不建任何一筆

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, note, TODAY, addDays,
} from '../fixtures/data.js';

/** fixture 的 `note()` 沒有 linkId 那一格（不改它：其他 spec 的種子一個位元都不變） */
const linked = (o, linkId) => {
  const d = note(o);
  return { ...d, data: { ...d.data, linkId } };
};

const D2 = addDays(TODAY, 2); // 8/31
const D4 = addDays(TODAY, 4); // 9/2（下個月）
const FAR = addDays(TODAY, 12); // 9/10：八月的月曆上一定沒有

const trio = () => [
  linked({ id: 'n1', text: '提醒客戶A喝水', date: TODAY, customerId: 'cust-a', customerName: '客戶A' }, 'n1'),
  linked({ id: 'n2', text: '提醒客戶A喝水', date: D2, customerId: 'cust-a', customerName: '客戶A' }, 'n1'),
  linked({ id: 'n3', text: '提醒客戶A喝水', date: FAR, customerId: 'cust-a', customerName: '客戶A' }, 'n1'),
];

const seed = (extra = []) => [...masterDocs(), customer({ id: 'cust-a', name: '客戶A' }), ...extra];

/** 長按一列，等選單出來再放開（放開不算點一下）。 */
async function longPress(page, target) {
  await expect(target).toBeVisible();
  const box = await target.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

const liveNotes = async (app) => (await app.readAll('notes')).filter((n) => !n.deletedAt);

test('L1 首頁長按 → 複製到別天：小月曆點兩天（跨月）→ 三筆同一組，清單上一列「共 3 天」', async ({ app, page }) => {
  await app.seed(seed([note({ id: 'n1', text: '提醒客戶A喝水', date: TODAY, customerId: 'cust-a', customerName: '客戶A' })]));
  await app.signIn('/');

  await longPress(page, page.locator('[data-notes] [data-note="n1"]'));
  // 她 11/6 定的五顆
  await expect(page.locator('.actionrow .actionrow__label')).toHaveText(['做完了，勾掉', '改日期', '改掛給誰', '改文字', '複製到別天']);
  await page.locator('[data-action="copy"]').click();

  const card = page.locator('.popcard');
  await expect(card.locator('.popcard__title')).toHaveText('複製到別天');
  await expect(card.locator(`[data-cd-day="${TODAY}"]`), '它自己那一天點不了').toBeDisabled();
  await expect(card.locator('[data-cd-ok]'), '一天都沒點：按不下去').toBeDisabled();
  await expect(card.locator('[data-cd-linked]'), '連在一起預設打開').toBeChecked();

  await card.locator(`[data-cd-day="${D2}"]`).click();
  await card.locator('[data-cd-step="1"]').click();
  await card.locator(`[data-cd-day="${D4}"]`).click();
  await expect(card.locator('[data-cd-ok]')).toHaveText('複製到 2 天');
  // 連按兩下也只建一份
  await card.locator('[data-cd-ok]').dblclick();
  await app.saved();

  const notes = await liveNotes(app);
  expect(notes.map((n) => n.date).sort()).toEqual([TODAY, D2, D4].sort());
  expect(new Set(notes.map((n) => n.linkId))).toEqual(new Set(['n1']));
  expect(notes.every((n) => n.text === '提醒客戶A喝水' && n.customerId === 'cust-a' && !n.done)).toBe(true);

  // 首頁那張卡：一列、旁邊「共 3 天」；「隨手記 1」
  await expect(page.locator('[data-notes] .noterow')).toHaveCount(1);
  await expect(page.locator('[data-notes] .notecount')).toHaveText('共 3 天');
});

test('L2 日曆上每一天各一筆；勾其中一天 → 整組一起勾，連不在這個月的那一天也勾', async ({ app, page }) => {
  await app.seed(seed(trio()));
  await app.signIn('/calendar');

  // 每一天各一筆
  await page.locator(`[data-day="${D2}"]`).first().click();
  await app.layer('[data-open="note:n2"]');
  await page.keyboard.press('Escape');

  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open="note:n1"]');
  await page.locator('[data-open="note:n1"]').click();
  await page.locator('[data-tick]').click();
  await app.saved();

  for (const id of ['n1', 'n2', 'n3']) {
    expect((await app.readDoc('notes', id)).done, `${id} 一起勾掉`).toBe(true);
  }
});

test('L3 隨手記那一頁：一組是一列、兩個數字一組算 1；拆開這一天 → 以後各勾各的', async ({ app, page }) => {
  await app.seed(seed([...trio(), note({ id: 'z', text: '訂耗材' })]));
  await app.signIn('/todo/notes');

  await expect(page.locator('[data-notes-tab="open"]')).toHaveText('未完成 2');
  await expect(page.locator('[data-notes] .notecount')).toHaveText('共 3 天');

  await longPress(page, page.locator('[data-notes] [data-note="n1"]'));
  await expect(page.locator('.actions__tags .actions__tag'), '選單最上面列出是哪幾天').toHaveCount(3);
  await page.locator('[data-action="copy"]').click();
  await page.locator('.popcard [data-cd-split]').click();
  await app.saved();

  expect((await app.readDoc('notes', 'n1')).linkId ?? null).toBe(null);
  expect((await app.readDoc('notes', 'n2')).linkId).toBe('n1');

  // n2、n3 還連著：勾那一列 → 兩天一起；n1 不動
  await expect(page.locator('[data-notes-tab="open"]')).toHaveText('未完成 3');
  await page.locator('[data-notes] [data-note="n2"]').click();
  await app.saved();
  expect((await app.readDoc('notes', 'n2')).done).toBe(true);
  expect((await app.readDoc('notes', 'n3')).done).toBe(true);
  expect((await app.readDoc('notes', 'n1')).done).toBe(false);
});

test('L4 日曆編輯器只改日期按存 → 另外那幾天一則稽核都不多', async ({ app, page }) => {
  await app.seed(seed(trio()));
  await app.signIn('/calendar');

  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-open="note:n1"]');
  await page.locator('[data-open="note:n1"]').click();
  await page.locator('[data-card-edit]').click();
  const form = page.locator('[data-noteform]');
  await expect(page.locator('[data-linkhint]'), '連在一起的講出會一起改').toContainText('另外 2 天');
  await form.locator('[data-nd-input]').fill(addDays(TODAY, 1));
  await form.locator('button[type="submit"]').click();
  await app.saved();

  const audit = await app.readAll('audit');
  const about = (id) => audit.filter((a) => a.targetPath === `notes/${id}`);
  expect(about('n1').length).toBe(1);
  expect(about('n2').length + about('n3').length, '只改日期：另外那幾天不寫').toBe(0);
  expect((await app.readDoc('notes', 'n2')).date).toBe(D2);
});

test('L5 「改日期」那張卡：沒日期的有改成今天、改成某天，沒有拿掉日期', async ({ app, page }) => {
  await app.seed(seed([note({ id: 'u', text: '沒日期的那一筆' })]));
  await app.signIn('/todo/notes');

  await longPress(page, page.locator('[data-notes] [data-note="u"]'));
  await page.locator('[data-action="date"]').click();
  const card = page.locator('.popcard');
  await expect(card.locator('[data-dc]')).toHaveCount(2);
  await expect(card.locator('[data-dc="undate"]')).toHaveCount(0);
  await card.locator('[data-dc="today"]').click();
  await app.saved();
  expect((await app.readDoc('notes', 'u')).date).toBe(TODAY);
});

test('L6 營養品的提醒長按沒有「複製到別天」；點外面關掉小月曆不建任何一筆', async ({ app, page }) => {
  await app.seed(seed([
    note({ id: 'p', text: '給客戶A營養品', customerId: 'cust-a', customerName: '客戶A', entitlementId: 'e-x' }),
    note({ id: 'q', text: '一般的那一筆' }),
  ]));
  await app.signIn('/todo/notes');

  await longPress(page, page.locator('[data-notes] [data-note="p"]'));
  await expect(page.locator('[data-action="copy"]')).toHaveCount(0);
  await page.locator('.actions__cancel[data-actions-close]').click();
  // 等那一張收乾淨（收起來有動畫、還有一趟返回鍵的紀錄要退）再按下一列
  await expect(page.locator('.drawer--actions')).toHaveCount(0);
  await app.settled();

  await longPress(page, page.locator('[data-notes] [data-note="q"]'));
  await page.locator('[data-action="copy"]').click();
  const card = page.locator('.popcard');
  await card.locator(`[data-cd-day="${D2}"]`).click();
  // 點卡片外面
  await page.mouse.click(5, 5);
  await expect(card).toHaveCount(0);
  expect((await liveNotes(app)).length).toBe(2);
});

test('L7 長按 → 改文字：卡上講「另外 2 天會一起改」，存完三天的字都換了；toast 講共 3 天', async ({ app, page }) => {
  await app.seed(seed(trio()));
  await app.signIn('/todo/notes');

  await longPress(page, page.locator('[data-notes] [data-note="n1"]'));
  await expect(page.locator('[data-action="edit"] .actionrow__note')).toHaveText('3 天一起改');
  await page.locator('[data-action="edit"]').click();
  const card = page.locator('.popcard');
  await expect(card.locator('.popcard__sub')).toHaveText('另外 2 天會一起改');
  await card.locator('[data-edittext]').fill('提醒客戶A回電');
  await card.locator('[data-edittext-ok]').click();
  await app.saved();
  await expect(page.locator('#toast')).toContainText('共 3 天');

  for (const id of ['n1', 'n2', 'n3']) {
    expect((await app.readDoc('notes', id)).text, id).toBe('提醒客戶A回電');
  }
});
