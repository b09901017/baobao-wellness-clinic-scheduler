// 上 main 前的第二堆（2026-11-07，`.scratch/final-check-2026-11-07`）：三件畫面上的事，從瀏覽器走一次。
//
// F3 批次建立打到一次性客人的名字 → 那一列講「轉成我的客戶」那一句，不說「已經有 1 位」（`duplicateSay()`）
// F4 日曆新增一段二返、接在「約二返」還開著的那一次健檢上 → 確認框講那一張會收起來（backlog 19，`followupBookingLines()`）
// F5 拍 Abovee、每一列都是 app 裡沒有的人 → 抬頭講「app 裡沒有 N 段」（backlog 20，`aboveeSummaryLine()`）
// 規則本身在 `tests/one-time-name-card.test.js`、`tests/consequences.test.js`、`tests/abovee-import.test.js`。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY, addDays,
} from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';

const MONTH = TODAY.slice(0, 7);
const alive = (rows) => rows.filter((t) => !t.deletedAt);

test('F3 批次建立打到一次性客人的名字：那一列指路去轉成我的客戶，不說「已經有 1 位」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-g', name: '客戶E', oneTime: true, active: true }),
    customer({ id: 'cust-p', name: '王小明' }),
  ]);
  await app.signIn('/customers');
  await app.go('/customers/bulk');
  for (const n of ['客戶E', '王小明']) {
    await page.locator('[data-name]').fill(n);
    await page.locator('[data-name]').press('Enter');
  }
  const rows = page.locator('[data-roster] li.roster__row');
  await expect(page.locator('[data-roster] [data-chart]')).toHaveCount(2);
  const guestRow = rows.filter({ hasText: '客戶E' });
  await expect(guestRow.locator('.roster__warn').first()).toContainText('轉成我的客戶');
  await expect(guestRow).not.toContainText('已經有 1 位');
  // 一般客戶同名照舊
  await expect(rows.filter({ hasText: '王小明' }).locator('.roster__warn').first())
    .toHaveText(/已經有 1 位叫這個名字 —— 確認不是同一個人/);
});

test('F4 日曆新增二返、接在「約二返」開著的那一次健檢上：存檔前那幾道講那一張會收起來，存完真的收了', async ({ app, page }) => {
  const OLD_DAY = addDays(TODAY, -100);
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-exam', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1, doneCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-a', {
      id: 'ent-second', label: '二返（8萬健檢）', courseId: 'course-followup',
      totalQty: 1, followupForEntitlementId: 'ent-exam', durationMin: 30,
    }),
    visit({
      id: 'v-old', customerId: 'cust-a', customerName: '客戶A', date: OLD_DAY, status: 'done',
      slots: [{
        ...slot({ courseId: 'course-checkup', entitlementId: 'ent-exam', startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3' }),
        status: 'done', attended: true,
      }],
    }),
    task({
      id: 't-old-report', customerId: 'cust-a', customerName: '客戶A', kind: '追蹤健檢報告',
      dueDate: addDays(OLD_DAY, 21), visitId: 'v-old', done: true, doneAt: `${addDays(OLD_DAY, 18)}T02:00:00.000Z`,
    }),
    task({
      id: 't-old-send', customerId: 'cust-a', customerName: '客戶A', kind: '寄報告給醫師',
      dueDate: addDays(OLD_DAY, 25), visitId: 'v-old', done: true, doneAt: `${addDays(OLD_DAY, 19)}T02:00:00.000Z`,
    }),
    task({
      id: 't-old-book', customerId: 'cust-a', customerName: '客戶A', kind: '約二返',
      dueDate: addDays(OLD_DAY, 25), visitId: 'v-old', done: false,
    }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-a"]').click();
  await app.layer('[data-chip="s0-ent"]');
  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-second"]').click();
  const exam = page.locator('[data-chip="s0-exam"][data-chip-value="v-old"]');
  if ((await exam.getAttribute('aria-pressed')) !== 'true') await exam.click();
  await expect(exam).toHaveAttribute('aria-pressed', 'true');
  await page.click('button[type="submit"]');

  // 提醒那一道可能有、可能沒有，而壓好了嗎那一道要等一次讀取才開（chainInputs）：
  // 沒講那一句的先按掉，等到講那一句的那一道出來為止
  await expect.poll(async () => {
    if (!(await app.dialog().isVisible())) return 'none';
    const text = await app.dialogText();
    if (/那一次健檢的「約二返」會收起來/.test(text)) return 'found';
    await app.ok();
    return 'other';
  }, { timeout: 20_000 }).toBe('found');
  await app.ok();
  await app.saved();

  const book = alive(await app.readAll('tasks')).find((t) => t.id === 't-old-book');
  expect(book && !book.done, '那一句講的是真的：存完那一張收掉了').toBeFalsy();
});

test('F5 拍 Abovee、每一列都是 app 裡沒有的人：抬頭講「app 裡沒有 2 段」，不說沒讀到', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-p', name: '王小明' }),
    entitlement('cust-p', { id: 'ent-p-exam', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1, doneCount: 0, bookedCount: 0 }),
    {
      path: 'batches', id: 'b-now',
      data: {
        targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
        queue: [{ customerId: 'cust-p', customerName: '', state: 'pending', skippedReason: null }],
      },
    },
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await queueAi(['aboveeList-strangers']);
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto('aboveeList-strangers.jpg', { width: 1600, height: 900 })]);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-abl-row]')).toHaveCount(2);

  await expect(page.locator('[data-abl-row="a0"] .abl-row__tag')).toHaveText('app 裡沒有');
  await expect(page.locator('[data-abl-sum]')).toHaveText('app 裡沒有 2 段');
});

test('F7 桌機用滑鼠把面板往上拖、放在灰底上：面板不關（backlog 21）；之後點灰底照樣關、點面板裡的按鈕照樣按得到', async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.seed([...masterDocs()]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  const drawer = page.locator('.drawer-backdrop .drawer');
  await expect(drawer).toBeVisible();

  // 從面板的抬頭按下去、一路拖到螢幕最上面（面板最高 94dvh，上面那一截是灰底）再放開
  const head = await drawer.boundingBox();
  await page.mouse.move(head.x + head.width / 2, head.y + 12);
  await page.mouse.down();
  for (const y of [head.y - 40, head.y - 200, 30, 8]) {
    // eslint-disable-next-line no-await-in-loop
    await page.mouse.move(head.x + head.width / 2, y, { steps: 4 });
  }
  const under = await page.evaluate(() => document.elementFromPoint(195, 8)?.className ?? '');
  expect(under, '放開的那一點在灰底上（不然這一條測不到）').toContain('drawer-backdrop');
  await page.mouse.up();

  // Chrome 把 click 派給共同祖先（灰底）—— 以前那一下就把面板關了
  await expect(drawer).toBeVisible();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(1);

  // 拖過之後只吞那一下：面板裡的按鈕照樣按得到
  await page.locator('[data-addmenu-toggle]').click();
  await expect(page.locator('[data-add="visit"]')).toBeVisible();

  // 點灰底照樣關（不是把關掉的路整條拿掉）
  await page.mouse.click(195, 8);
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});
