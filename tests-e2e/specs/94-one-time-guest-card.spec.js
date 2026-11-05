// 一次性客人：客戶清單最底下那一排、名字卡那一頁、轉成我的客戶（2026-11-05，ADR-0172，`.scratch/one-time-guests/issues/05`）。
//
// 她：「我同意跟現在的『看已停用的』並排，但能不能都移到那一頁最底下 ?」
// 第 6 題：小頁最底下「轉成我的客戶」，確認框答是才轉；轉了就是一般客戶；以前的那幾段照舊算一次性。
// 規則（三份互斥、同名那一句、確認框講什麼）在 `tests/one-time-name-card.test.js`；這一支走瀏覽器才量得到的：
// 最底下一行點得到（懸浮鈕沒蓋住）、名字卡那一頁沒有加購、改名換快照、轉了之後上清單、稽核留得下。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, visit, TODAY, addDays } from '../fixtures/data.js';

const exam = (over = {}) => ({
  courseId: 'course-checkup', courseName: '健檢', entitlementId: null, giftKind: null, oneTime: true,
  equipmentId: null, ivProductId: null, startsAt: '09:00', endsAt: '10:00', minutes: 60,
  roomId: null, bed: null, therapistId: null, doctorId: null, followupForVisitId: null, note: null,
  status: 'done', ...over,
});

/** 一位一般客戶、一位停用的、一位一次性客人（一次做完的健檢；`ahead` 給了再加一段明天的）。 */
function seed({ ahead = false } = {}) {
  return [
    ...masterDocs(),
    customer({ id: 'cust-r', name: '王小明', phone: '0912' }),
    customer({ id: 'cust-s', name: '王小華', phone: '0913', active: false }),
    customer({ id: 'cust-g', name: '客戶A', oneTime: true, active: true, chartNo: '1234' }),
    visit({
      id: 'v-g1', customerId: 'cust-g', customerName: '客戶A', date: addDays(TODAY, -7), status: 'done',
      slots: [exam()],
    }),
    ...(ahead ? [visit({
      id: 'v-g2', customerId: 'cust-g', customerName: '客戶A', date: addDays(TODAY, 1), status: 'pending_confirm',
      slots: [exam({ status: 'pending_confirm' })],
    })] : []),
  ];
}

const names = (page) => page.locator('[data-rows] .card .row__title').evaluateAll(
  (els) => els.map((el) => el.firstChild.textContent.trim()),
);

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
});

test('O1 標題那一行沒有「看已停用的」；最底下兩顆一行、點得到；三份各列各的', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers');
  await expect(page.locator('[data-rows] .card').first()).toBeVisible();

  await expect(page.locator('.page__row .footlink')).toHaveText(['看這個月的進度', '長備註']);
  const links = page.locator('[data-listlinks] .footlink');
  await expect(links).toHaveText(['看已停用的', '看一次性客人']);
  await expect.poll(() => names(page)).toEqual(['王小明']);

  // 一行：兩顆的上緣一樣；點得到：捲到底之後，兩顆中心點上面最上層的就是它自己（懸浮鈕、導覽列沒蓋住）
  await links.last().scrollIntoViewIfNeeded();
  await page.locator('.app__main').evaluate((m) => { m.scrollTop = m.scrollHeight; });
  const boxes = await links.evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top));
  expect(Math.abs(boxes[0] - boxes[1])).toBeLessThan(2);
  const reachable = await links.evaluateAll((els) => els.map((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return Boolean(hit && el.contains(hit));
  }));
  expect(reachable).toEqual([true, true]);

  await links.last().click();
  await expect(page.locator('[data-listlinks] .footlink')).toHaveText(['看已停用的', '看在服務中的']);
  await expect.poll(() => names(page)).toEqual(['客戶A']);
  await expect(page.locator('[data-guestrow] .guestmark')).toHaveText('一次性');

  await page.locator('[data-listlinks] .footlink').first().click();
  await expect(page.locator('[data-listlinks] .footlink')).toHaveText(['看在服務中的', '看一次性客人']);
  await expect.poll(() => names(page)).toEqual(['王小華']);

  await page.locator('[data-listlinks] .footlink').first().click();
  await expect.poll(() => names(page)).toEqual(['王小明']);
});

test('O2 名字卡那一頁：一次性、病歷號、來訪紀錄點得開；沒有加購、額度、LINE 訊息、停用', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers/cust-g');
  await expect(page.locator('[data-guestpage]')).toBeVisible();
  await expect(page.locator('.hero__name .guestmark')).toHaveText('一次性');
  await expect(page.locator('[data-guestcard]')).toContainText('1234');

  const text = await app.text();
  for (const banned of ['加購', '額度', '買過什麼', 'LINE 訊息', '停用', '長備註', '本輪']) {
    expect(text, banned).not.toContain(banned);
  }
  await expect(page.locator('[data-to-mine]')).toBeVisible();
  await expect(page.locator('[data-guest-delete]')).toBeVisible();

  await page.locator('[data-guestvisits] [data-visit="v-g1"]').click();
  await expect(page.locator('.popcard')).toBeVisible();
  await expect(page.locator('.popcard')).toContainText('健檢');
});

test('O3 編輯名字卡改名：今天以後的來訪跟著換；沒填電話與 LINE 不講「沒有聯絡方式」', async ({ app, page }) => {
  await app.seed(seed({ ahead: true }));
  await app.signIn('/customers/cust-g');
  await page.locator('[data-guest-edit]').click();
  const form = page.locator('[data-gf-form]');
  await expect(form.locator('[name="lineId"]')).toBeVisible();
  await form.locator('[name="name"]').fill('客戶B');
  await form.locator('[data-gf-submit]').click();
  await app.saved();

  await expect(page.locator('.hero__name')).toContainText('客戶B');
  expect((await app.readDoc('customers', 'cust-g')).name).toBe('客戶B');
  expect((await app.readDoc('visits', 'v-g2')).customerName).toBe('客戶B');
  expect((await app.readDoc('visits', 'v-g1')).customerName, '過去做完的留著當時的名字').toBe('客戶A');
});

test('O4 轉成我的客戶：確認框講真的會發生的事 → 上客戶清單、段上的標記留著、稽核留得下', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers/cust-g');
  await page.locator('[data-to-mine]').click();
  const said = await app.dialogText();
  expect(said).toContain('客戶清單');
  expect(said).toContain('記的 1 段照舊算一次性');
  expect(said).toContain('還欠 1 場二返');
  await app.ok();
  await app.saved();

  // 換成一般客戶詳情
  await expect(page.locator('[data-add-ent]')).toBeVisible();
  await expect(page.locator('[data-guestpage]')).toHaveCount(0);
  const doc = await app.readDoc('customers', 'cust-g');
  expect(doc.oneTime).toBe(false);
  expect((await app.readDoc('visits', 'v-g1')).slots[0].oneTime, '以前那一段照舊算一次性').toBe(true);

  const audit = (await app.readAll('audit')).filter((a) => a.targetPath === 'customers/cust-g' && a.action === 'customers.update');
  expect(audit.some((a) => a.before?.oneTime === true && a.after?.oneTime === false)).toBe(true);

  await app.go('/customers');
  await expect(page.locator('[data-rows] .card').first()).toBeVisible();
  await expect.poll(() => names(page)).toContain('客戶A');
});

test('O5 刪除：還掛著明天的來訪刪不掉（同一般客戶）', async ({ app, page }) => {
  await app.seed(seed({ ahead: true }));
  await app.signIn('/customers/cust-g');
  await page.locator('[data-guest-delete]').click();
  await expect(app.dialog()).toContainText('還刪不掉');
  await app.cancelDialog();
  expect((await app.readDoc('customers', 'cust-g')).deletedAt ?? null).toBeNull();
});

test('O5b 刪除：沒有掛著的事就刪得掉', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers/cust-g');
  await page.locator('[data-guest-delete]').click();
  await expect(app.dialog()).toContainText('刪除「客戶A」');
  await app.ok();
  await app.saved();
  expect((await app.readDoc('customers', 'cust-g')).deletedAt).toBeTruthy();
});

test('O6 新增客戶打到一次性客人的名字 → 指路去轉的那一句（⚠ 與存檔前那一道）', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers/new');
  const form = page.locator('[data-cf-form]');
  await form.locator('[name="name"]').fill('客戶A');
  await form.locator('[name="phone"]').fill('0912');
  await expect(form.locator('[data-cf-warn="name"] .tip')).toHaveAttribute('data-tip', /看一次性客人/);
  await form.locator('button[type="submit"]').click();
  await expect(app.dialog()).toContainText('看一次性客人');
  await expect(app.dialog()).toContainText('轉成我的客戶');
});
