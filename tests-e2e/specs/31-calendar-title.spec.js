// 日曆的標題、點標題跳日期、iPad 橫式的週檢視（`.scratch/asks-2026-09-13/issues/09`–`11`）。
//
// 她 2026-09-13：
//
// > a 我希望呈現2026年.....那邊可以寫的是幾月，因為光是2026年就會占掉手機版的版面導致後面都會變...
// > b 我希望點calbar__title那邊點了之後可以選日期，但是在月曆那邊可以選的是月，週那邊可以選週，日那邊可以選日
// > c 在週顯示那邊，我發現一個就是如果是橫的顯示(ipad) 他會變成好擠，所有字都會變成直得顯示?
//
// fixture 的「今天」是 2026-08-29（週六）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

async function openCalendar(app, page, docs = [...masterDocs()]) {
  await app.seed(docs);
  await app.signIn('/calendar');
  await app.go('/calendar');
}

async function switchView(app, page, view) {
  await page.locator(`[data-view="${view}"]`).click();
  await app.settled();
}

const title = (page) => page.locator('.calbar__title');

// ---------- 09 標題 ----------

test('375 寬：三種標題都不被截，而且講得出是哪一月、第幾週', async ({ app, page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await openCalendar(app, page);

  await expect(title(page)).toHaveText('8月');
  await switchView(app, page, 'week');
  // 8/24–8/30：週四 8/27 → 8 月第 4 週
  await expect(title(page)).toHaveText('8月 W4');
  await switchView(app, page, 'day');
  await expect(title(page)).toHaveText('8/29(六)');

  for (const view of ['month', 'week', 'day']) {
    await switchView(app, page, view);
    const fits = await title(page).evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(fits, `${view} 的標題被截掉了`).toBe(true);
  }
});

test('週檢視每一天的抬頭寫 8/24，不是只寫 24', async ({ app, page }) => {
  await openCalendar(app, page);
  await switchView(app, page, 'week');
  await expect(page.locator('.swipe__pane[data-offset="0"] .weekday__n').first()).toHaveText('8/24');
});

test('往後滑到明年一月，標題帶年份', async ({ app, page }) => {
  await openCalendar(app, page);
  for (let i = 0; i < 5; i += 1) {
    await page.locator('.calbar [data-move="1"]').click();
    await app.settled();
  }
  await expect(title(page)).toHaveText('2027年1月');
});

// ---------- 10 點標題跳日期 ----------

test('月檢視：點標題選一個月', async ({ app, page }) => {
  await openCalendar(app, page);
  await title(page).locator('button').click();
  await app.layer('[data-pick-month]');

  await expect(page.locator('[data-pick-month]')).toHaveCount(12);
  await page.locator('[data-pick-month="2026-11"]').click();
  await app.settled();
  await expect(title(page)).toHaveText('11月');
  await expect(page.locator('[data-pick-month]'), '選完面板收掉').toHaveCount(0);
});

test('月檢視：年份往後一年再選一月', async ({ app, page }) => {
  await openCalendar(app, page);
  await title(page).locator('button').click();
  await app.layer('[data-pick-month]');
  await page.locator('[data-pick-step="1"]').click();
  await page.locator('[data-pick-month="2027-01"]').click();
  await app.settled();
  await expect(title(page)).toHaveText('2027年1月');
});

test('週檢視：點標題，點一整列選那一週', async ({ app, page }) => {
  await openCalendar(app, page);
  await switchView(app, page, 'week');
  await title(page).locator('button').click();
  await app.layer('[data-pick-week]');

  await page.locator('[data-pick-week="2026-08-10"]').click();
  await app.settled();
  await expect(title(page)).toHaveText('8月 W2');
  await expect(page.locator('.swipe__pane[data-offset="0"] .weekday__n').first()).toHaveText('8/10');
});

test('日檢視：點標題，點一天', async ({ app, page }) => {
  await openCalendar(app, page);
  await switchView(app, page, 'day');
  await title(page).locator('button').click();
  await app.layer('[data-pick-day]');

  await page.locator('[data-pick-day="2026-08-20"]').click();
  await app.settled();
  await expect(title(page)).toHaveText('8/20(四)');
});

test('面板開著按返回鍵：面板收掉，人還在日曆', async ({ app, page }) => {
  await openCalendar(app, page);
  await title(page).locator('button').click();
  await app.layer('[data-pick-month]');
  await page.goBack();
  await expect(page.locator('[data-pick-month]')).toHaveCount(0);
  expect(page.url()).toContain('#/calendar');
});

// ---------- 11 iPad 橫式的週檢視 ----------

function seedWeek() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-w', name: '王小明' }),
    entitlement('cust-w', {
      id: 'ent-w', label: '復能-三選一(60)', type: 'pool', durationMin: 60,
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 10,
    }),
    visit({
      id: 'v-w', customerId: 'cust-w', customerName: '王小明', date: TODAY, status: 'confirmed',
      slots: [slot({ courseId: 'course-recovery', entitlementId: 'ent-w', startsAt: '09:00', endsAt: '10:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw' })],
    }),
  ];
}

for (const width of [1024, 1180]) {
  test(`iPad 橫式 ${width}：週檢視的名字一行放得下，不是一字一行`, async ({ app, page }) => {
    await page.setViewportSize({ width, height: 768 });
    await openCalendar(app, page, seedWeek());
    await switchView(app, page, 'week');

    const titleEl = page.locator('.swipe__pane[data-offset="0"] .weekgrid .timerow__title').first();
    await expect(titleEl).toContainText('王小明');
    const box = await titleEl.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      return { width: r.width, lines: Math.round(r.height / lh) };
    });
    expect(box.width, '名字那一格至少要放得下三四個字').toBeGreaterThanOrEqual(60);
    expect(box.lines, '一行就好').toBe(1);
  });
}

test('手機的週檢視一個像素都沒動：時間仍然在左邊那一欄', async ({ app, page }) => {
  await openCalendar(app, page, seedWeek());
  await switchView(app, page, 'week');
  const clock = page.locator('.swipe__pane[data-offset="0"] .weekgrid .timerow__clock').first();
  const width = await clock.evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBe(42);
});
