// 上線前健檢報告（`.scratch/prelaunch-review-2026-09-16/report.md`）第一、二章的
// **重現測試**。這一支現在是紅的，而且是刻意的 —— 每一條斷言寫的是文件說它
// 應該怎樣，紅掉的那一行就是報告講的那件事。
//
// §1.3 不在這裡：`25-visit-editor-one-slot.spec.js` 的 V4b 已經掛著 `test.fail()`。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

const DAY = TODAY;
const NEXT = addDays(TODAY, 1);
const EMPTY = addDays(TODAY, 2);

/** 一位客戶，今天已經有一筆**待確認**的來訪（身體組成分析：不用選任何欄位）。 */
function seedOpenVisit(status = 'pending_confirm') {
  return [
    ...masterDocs(),
    customer({ id: 'cust-y', name: '客戶A' }),
    entitlement('cust-y', {
      id: 'ent-ib', label: '身體組成分析 10 次', type: 'single',
      courseId: 'course-inbody', totalQty: 10, bookedCount: 1,
    }),
    visit({
      id: 'v-one', customerId: 'cust-y', customerName: '客戶A',
      date: DAY, status,
      slots: [slot({
        courseId: 'course-inbody', entitlementId: 'ent-ib',
        startsAt: '09:00', endsAt: '09:20',
      })],
    }),
  ];
}

/** 抽屜裡那一天。`[data-day]` 只在月檢視的格子上。 */
async function openDay(app, page, day) {
  await app.go('/calendar');
  await page.locator(`[data-day="${day}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
}

/** 抽屜抬頭右上角那顆「＋」→ 新增來訪 → 選人 → 編輯器畫好了。 */
async function addVisitFor(app, page, customerId) {
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator(`[data-pick="${customerId}"]`).click();
  await app.layer('.slotcard');
}

// ---------- §1.2 併進同一天既有那一筆時，日期欄還在 ----------

test('P1 併進同一天既有那一筆時，不可以畫出「來訪日期」', async ({ app, page }) => {
  await app.seed(seedOpenVisit());
  await app.signIn('/calendar');
  await openDay(app, page, DAY);
  await addVisitFor(app, page, 'cust-y');

  // 確認真的併進來了（只畫新的那一段）
  await expect(page.locator('.slotcard'), '只有新的那一段改得動').toHaveCount(1);

  // ADR-0085：只改一段時日期不給改。ADR-0089：改整天的日期一條路都沒有。
  // 她按的是「新增」，而那條路 `isNew` 是 true，於是日期欄照樣畫出來。
  await expect(
    page.locator('input[name="date"]'),
    '改了它，那一天原本那幾段會一起搬走，而存檔前那一道只列新的那一段',
  ).toHaveCount(0);
});

test('P2 併進來之後改日期，原本那一段不可以跟著搬走', async ({ app, page }) => {
  await app.seed(seedOpenVisit());
  await app.signIn('/calendar');
  await openDay(app, page, DAY);
  await addVisitFor(app, page, 'cust-y');

  const dateField = page.locator('input[name="date"]');
  if (await dateField.count()) {
    await dateField.fill(NEXT);
    await app.settled();
  }

  await page.locator('button[type="submit"]').first().click();
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-one');
  expect(saved.date, `原本那一段是 ${DAY} 的，她只是在那一天加一段`).toBe(DAY);
});

// ---------- §1.2b 反過來：改日期會長出「同一天第二筆」 ----------

test('P3 從空的那一天新增、把日期改到他已經有一段的那一天：不可以長出第二筆', async ({ app, page }) => {
  await app.seed(seedOpenVisit());
  await app.signIn('/calendar');
  await openDay(app, page, EMPTY);
  await addVisitFor(app, page, 'cust-y');

  await page.locator('input[name="date"]').fill(DAY);
  await app.settled();

  await page.locator('button[type="submit"]').first().click();
  await app.ok();
  await app.saved();

  const all = await app.readAll('visits');
  const mine = all.filter((v) => v.customerId === 'cust-y' && v.date === DAY && !v.deletedAt);
  expect(mine, 'ADR-0083：一位客戶同一天只有一筆').toHaveLength(1);
});

// ---------- §2.1 壓表「這個月壓好的」通到整天的編輯器 ----------

test('P4 壓表「這個月壓好的」那一列不可以通到 #/visits/:id', async ({ app, page }) => {
  await app.seed(seedOpenVisit('confirmed'));
  await app.signIn('/schedule');

  await page.locator('[data-month="2026-08"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-y"]').first().click();
  await app.settled();

  await expect(page.locator('#view'), '這位客戶這個月壓好的那一列要在').toContainText('這個月壓好的');
  await expect(
    page.locator('a[href^="#/visits/"]'),
    'CLAUDE.md：renderEdit() 那條網址「沒有任何畫面上的連結，不算一條路」',
  ).toHaveCount(0);
});

test('P5 走那條路進去，看到的是整天的編輯器（日期欄＋每一段）', async ({ app, page }) => {
  await app.seed(seedOpenVisit('confirmed'));
  await app.signIn('/calendar');
  await app.go('/visits/v-one');
  await app.layer('.slotcard');

  await expect(
    page.locator('input[name="date"]'),
    'ADR-0089：改整天的日期一條路都沒有',
  ).toHaveCount(0);
});

test('P6 從壓表點進去、按「取消」，不可以被帶離壓表', async ({ app, page }) => {
  await app.seed(seedOpenVisit('confirmed'));
  await app.signIn('/schedule');

  await page.locator('[data-month="2026-08"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-y"]').first().click();
  await app.settled();

  await page.locator('a[href="#/visits/v-one"]').click();
  await app.layer('.slotcard');
  await page.locator('[data-cancel-edit]').click();
  await app.settled();

  expect(page.url(), '她只是點進去看一眼，卡片組那一層不該沒了').toContain('#/schedule');
});
