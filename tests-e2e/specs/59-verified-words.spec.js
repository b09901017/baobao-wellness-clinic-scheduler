// 2026-10-07 逐條驗證過的那份問題清單，第二支 PR：資料是對的、畫面講錯話的那幾條，
// 加上內部用語與版面（`.scratch/verified-bugs-2026-10-07/issues/08`–`17`）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = TODAY;

// ---------- 08 讀取卡片：取消／未到的段不寫「扣 X」 ----------

test('W1 讀取卡片：取消的那一段寫「沒扣」，還排著的那一段照舊寫「扣」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'v-a', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
          }),
          status: 'cancelled',
        },
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-sis', therapistId: 'staff-tw',
          }),
          status: 'confirmed',
        },
      ],
    }),
  ]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open="visit:v-a:0"]');

  await page.locator('[data-open="visit:v-a:0"]').first().click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot__from'), '取消的那一段沒有扣').toHaveText('沒扣 復能-三選一(30)');

  // 重新進來一次再點另一段（Escape 會連底下那一天的面板一起收掉）
  await app.reload();
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open="visit:v-a:1"]');
  await page.locator('[data-open="visit:v-a:1"]').first().click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot__from')).toHaveText('扣 復能-三選一(30)');
});

// ---------- 10 取消那幾道確認框 ----------

/** 日曆 → 那一天 → 長按那一段，等選單升起來（`wireLongPress()` 只認主鍵的真滑鼠事件，同 spec 52）。 */
async function longPress(app, page, date, open) {
  await page.locator(`[data-day="${date}"]`).first().click();
  await app.layer(`[data-open="${open}"]`);
  const row = page.locator(`[data-open="${open}"]`).first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

test('W2 那一天已完成之後再加的那一段，長按取消：不說「那一天就整個取消了」；不要的那一顆寫「先不要，回去」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    visit({
      id: 'v-done', customerId: 'cust-b', customerName: '客戶B', date: DAY, status: 'done',
      slots: [{ ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '09:00', endsAt: '09:30' }), status: 'done' }],
    }),
    // 那一天已完成，所以這一段在另一筆來訪裡（ADR-0083）
    visit({
      id: 'v-second', customerId: 'cust-b', customerName: '客戶B', date: DAY, status: 'pending_confirm',
      slots: [{ ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '14:30', endsAt: '15:00' }), status: 'pending_confirm' }],
    }),
  ]);
  await app.signIn('/calendar');
  await longPress(app, page, DAY, 'visit:v-second:0');
  await page.locator('.actionrow', { hasText: '取消這一段' }).click();

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '已完成的那一段還在').not.toContain('整個取消了');
  expect(said).toContain('那一天剩下的 1 段不受影響');
  await expect(app.dialog().locator('[data-cancel]'), '兩顆不可以都叫「取消」').toHaveText('先不要，回去');
  await expect(app.dialog().locator('[data-ok]')).toHaveText('取消這一段');
});

// ---------- 11 「已經在 Abovee 壓好表了嗎？」底下不列不用壓的段 ----------

test('W3 功醫門診＋HRV 一起存：抬頭問 Abovee，底下只列功醫門診，HRV 另外講「不用壓表」', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-c', name: '客戶C' })]);
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-c"]').click();
  await app.layer('[data-chip="s0-ent"]');

  await page.locator('[data-chip="s0-ent"][data-chip-value="__course__:course-fm"]').click();
  await page.locator('[data-chip="s0-doc"]', { hasText: '夏' }).click();
  await page.locator('[data-add-slot]').click();
  await app.layer('[data-chip="s1-ent"]');
  await page.locator('[data-chip="s1-ent"][data-chip-value="__course__:course-hrv"]').click();
  await page.click('button[type="submit"]');

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('已經在 Abovee 壓好表了嗎？');
  expect(said).toContain('HRV 不用壓表，會一起記下來');
  await expect(app.dialog().locator('li', { hasText: /^\d\d:\d\d.*功醫門診/ }), '要壓的那一段列在底下').toHaveCount(1);
  await expect(app.dialog().locator('li', { hasText: /^\d\d:\d\d.*HRV/ }), 'HRV 不列在「壓好了嗎」底下').toHaveCount(0);
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-c');
  expect(v.slots.map((s) => s.courseId), '兩段都記下來了').toEqual(['course-fm', 'course-hrv']);
});

// ---------- 12 待辦的「確認」「簽療程單」兩張抽屜：按返回是收抽屜，不是離開頁面 ----------

/** 一位客戶：明天一段還沒問過的（確認那一頁）、今天一段談定的（簽療程單那一頁）。 */
function seedTwoDrawers() {
  const ent = entitlement('cust-d', {
    id: 'ent-d', label: '復能-三選一(60)', type: 'pool',
    optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 2, durationMin: 60,
  });
  const one = (startsAt, status) => ({
    ...slot({
      courseId: 'course-recovery', entitlementId: 'ent-d',
      startsAt, endsAt: '10:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
    }),
    status,
  });
  return [
    ...masterDocs(),
    customer({ id: 'cust-d', name: '客戶D' }),
    ent,
    visit({
      id: 'v-pending', customerId: 'cust-d', customerName: '客戶D', date: addDays(DAY, 1),
      status: 'pending_confirm', slots: [one('09:00', 'pending_confirm')],
    }),
    visit({
      id: 'v-today', customerId: 'cust-d', customerName: '客戶D', date: DAY,
      status: 'confirmed', slots: [one('09:00', 'confirmed')],
    }),
  ];
}

test('W4 確認抽屜：按返回只收抽屜；按幾下 ✓ 之後也是一次就收；用 × 關掉之後返回是正常回上一頁', async ({ app, page }) => {
  await app.seed(seedTwoDrawers());
  await app.signIn('/calendar');
  await app.go('/todo/confirm');

  await page.locator('[data-open="cust-d"]').click();
  await app.layer('.drawer');
  await page.goBack();
  await expect(page.locator('.drawer'), '返回鍵收的是抽屜').toHaveCount(0);
  await expect(page, '人還在這一頁').toHaveURL(/#\/todo\/confirm/);

  // 抽屜開著時整頁重畫好幾次（按 ✓、再按一次放掉、再按 ✓）—— 那一層只推一次
  await page.locator('[data-open="cust-d"]').click();
  await app.layer('.drawer');
  const tick = page.locator('.drawer [data-pick][data-to="1"]').first();
  await tick.click();
  await page.locator('.drawer [data-pick][data-to="1"]').first().click();
  await page.locator('.drawer [data-pick][data-to="1"]').first().click();
  await page.goBack();
  await expect(page.locator('.drawer'), '一次就收掉，不是要按好幾次').toHaveCount(0);
  await expect(page).toHaveURL(/#\/todo\/confirm/);

  // 她自己關掉之後，那一層要還回去 —— 不然下一次返回會被吃掉一次
  await page.locator('[data-open="cust-d"]').click();
  await app.layer('.drawer');
  await page.locator('.drawer [data-close-drawer]').first().click();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await page.goBack();
  await expect(page, '回到上一頁').toHaveURL(/#\/calendar/);
});

test('W5 簽療程單抽屜：按返回只收抽屜；送出之後返回是正常回上一頁', async ({ app, page }) => {
  await app.seed(seedTwoDrawers());
  await app.signIn('/calendar');
  await app.go('/todo/close');

  await page.locator('[data-open="v-today"]').click();
  await app.layer('.drawer');
  await page.goBack();
  await expect(page.locator('.drawer')).toHaveCount(0);
  await expect(page).toHaveURL(/#\/todo\/close/);

  await page.locator('[data-open="v-today"]').click();
  await app.layer('.drawer');
  await app.tickAll();
  await page.locator('[data-apply]').click();
  await app.saved();
  await expect(page.locator('.drawer'), '送出之後抽屜自己收掉').toHaveCount(0);
  await page.goBack();
  await expect(page, '沒有被吃掉一次').toHaveURL(/#\/calendar/);
});

// ---------- 13 長按「客人來了，去簽療程單」直接開那一天的那一張 ----------

test('W6 日曆長按「去簽療程單」：落在那一天的抽屜上、一段都沒有先被勾；返回收抽屜；之後正常點進來不會自己彈', async ({ app, page }) => {
  await app.seed([
    ...seedTwoDrawers(),
    // 另一位今天也要簽 —— 清單上不只一列，才問得出「開的是她長按的那一筆」
    customer({ id: 'cust-e', name: '客戶E' }),
    visit({
      id: 'v-other', customerId: 'cust-e', customerName: '客戶E', date: DAY, status: 'confirmed',
      slots: [{ ...slot({ courseId: 'course-fm', entitlementId: null, startsAt: '11:00', endsAt: '11:30' }), status: 'confirmed' }],
    }),
  ]);
  await app.signIn('/calendar');
  await longPress(app, page, DAY, 'visit:v-today:0');
  await page.locator('.actionrow', { hasText: '簽療程單' }).click();

  // **等的是待辦那一頁自己的抽屜**（送出那一顆只有它有）。日曆那一天的面板也是 `.drawer`，
  // 換頁的那一下它還在 —— 只等 `.drawer` 的話，接下來按的返回會落在那一頁還沒畫好的時候
  await expect(page).toHaveURL(/#\/todo\/close/);
  const drawer = page.locator('#view .drawer');
  await app.layer('#view .drawer [data-apply]');
  await expect(drawer, '開的是她長按的那一位').toContainText('客戶D');
  await expect(drawer, '不是清單上的另一位').not.toContainText('客戶E');
  await expect(drawer.locator('[data-pick][aria-pressed="true"]'), '不替她預先勾任何一段（ADR-0110）').toHaveCount(0);

  await page.goBack();
  await expect(drawer, '返回收的是抽屜').toHaveCount(0);
  await expect(page).toHaveURL(/#\/todo\/close/);

  // 那一句話只活一次：之後從別的地方進這一頁不會又彈出來
  await app.go('/todo');
  await app.go('/todo/close');
  await expect(page.locator('[data-open="v-today"]')).toBeVisible();
  await expect(drawer).toHaveCount(0);
});

// ---------- 09 講來訪的數字數的是段 ----------

test('W7 一天兩段、取消一段：月曆上方「1 段來訪」，週檢視那一天右上角「1 項」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    visit({
      id: 'v-a', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [
        { ...slot({ courseId: 'course-recovery', entitlementId: null, equipmentId: 'eq-sis', startsAt: '09:00', endsAt: '10:00' }), status: 'cancelled' },
        { ...slot({ courseId: 'course-recovery', entitlementId: null, equipmentId: 'eq-sis', startsAt: '14:00', endsAt: '15:00' }), status: 'confirmed' },
      ],
    }),
  ]);
  await app.signIn('/calendar');
  await app.settled();
  await expect(page.locator('#view')).toContainText('1 段來訪');
  await expect(page.locator('#view')).not.toContainText('筆來訪');

  await page.locator('[data-view="week"]').click();
  await app.settled();
  const head = page.locator(`.swipe__pane[data-offset="0"] .weekday__head[data-day="${DAY}"]`);
  // 底下兩列：一列劃掉的（取消）、一列沒劃掉的 —— 數字是沒劃掉的那一列
  await expect(head).toContainText('1 項');
});

// ---------- 16 她自己打的字太長：版面不被撐寬 ----------
//
// 只有量位置看得出來（`CLAUDE.md`「貼在畫面底部的東西」那一列的教訓）。她是安卓，所以量 360 寬。

const LONG_OTHER = '這是一段很長很長的其他限制'.repeat(5); // 65 個字
const LONG_ALERT = '一個她在設定頁自己取的很長的警示名字';
const LONG_URL = 'https://example.com/aaaaaaaaaaaaaaaaaaaa'; // 40 個字元，沒有空白

function longCustomerDocs() {
  return [
    ...masterDocs(),
    { path: 'config/app/clinicalFlags', id: 'cf-long', data: { name: LONG_ALERT, color: 'red', fill: 'solid', active: true } },
    customer({ id: 'cust-long', name: '客戶A', flags: [LONG_ALERT, LONG_OTHER], marks: [{ text: LONG_URL, color: 'grey' }] }),
    customer({ id: 'cust-ok', name: '客戶B', flags: ['怕痛'] }),
  ];
}

/** 整頁能不能左右滑。捲的是 `.app__main` 不是 document（document 量起來永遠是 false）。 */
const pageScrolls = (page) => page.evaluate(() => [document.documentElement, document.querySelector('.app__main')]
  .some((el) => el && el.scrollWidth > el.clientWidth + 1));

for (const width of [360, 393]) test(`W8 ${width} 寬：其他限制 65 字、備註一串網址 —— 客戶清單不能左右滑、每張卡一樣寬、那一則截成一行`, async ({ app, page }) => {
  await page.setViewportSize({ width, height: 740 });
  await app.seed(longCustomerDocs());
  await app.signIn('/customers');
  await app.settled();

  const cards = page.locator('.cardgrid > *');
  await expect(cards).toHaveCount(2);
  expect(await pageScrolls(page), '整頁不能左右滑').toBe(false);
  const widths = await cards.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(new Set(widths).size, `每一張卡一樣寬：${widths.join('、')}`).toBe(1);

  const other = page.locator('.cardgrid > *', { hasText: '客戶A' }).locator('.badge', { hasText: '這是一段' });
  const clip = await other.evaluate((el) => ({ lines: Math.round(el.getBoundingClientRect().height / 21), cut: el.scrollWidth > el.clientWidth }));
  expect(clip.lines, '清單上一行').toBe(1);
  expect(clip.cut, '超過的截掉（…）').toBe(true);
});

test('W9 360 寬：同一位的客戶詳情不能左右滑，其他限制、警示與備註的字全部看得到', async ({ app, page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await app.seed(longCustomerDocs());
  await app.signIn('/customers/cust-long');
  await app.settled();

  await expect(page.locator('#view')).toContainText(LONG_OTHER);
  expect(await pageScrolls(page), '整頁不能左右滑').toBe(false);
  for (const text of [LONG_OTHER, LONG_ALERT, LONG_URL]) {
    const el = page.locator('#view').getByText(text, { exact: true }).first();
    const cut = await el.evaluate((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > window.innerWidth);
    expect(cut, `「${text.slice(0, 6)}…」整句看得到`).toBe(false);
  }
});

// ---------- 17 她點名的三條小的 ----------

test('W10 客戶詳情「停用與刪除」：有「先不要，回去」，按了只收面板、什麼都沒改', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-a', name: '客戶A' })]);
  await app.signIn('/customers/cust-a');
  await app.settled();
  await page.locator('[data-danger]').click();
  await app.layer('.drawer-backdrop .drawer');
  await page.locator('.drawer-backdrop .drawer').getByRole('button', { name: '先不要，回去' }).click();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(page.locator('#view')).not.toContainText('已停用');
});

test('W11 設定清單：營養點滴品項的小字不寫種類名；方案範本的項目名不印兩次', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/ivProducts');
  await app.settled();
  await expect(page.locator('#view .row__main > .muted', { hasText: /^營養點滴品項$/ })).toHaveCount(0);

  await app.go('/settings/plans');
  await app.settled();
  const item = page.locator('#view li', { hasText: '身體組成分析' }).first();
  await expect(item).toBeVisible();
  // 項目名就是課程名時只印一次；擇一池那一項照印「擇一：…」
  expect((await item.innerText()).match(/身體組成分析/g)).toHaveLength(1);
  await expect(page.locator('#view li', { hasText: '擇一：' }).first()).toBeVisible();
});
