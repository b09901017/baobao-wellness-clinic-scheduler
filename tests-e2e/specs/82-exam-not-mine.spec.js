// 健檢不是我排的（2026-11-02，ADR-0169，`.scratch/exam-not-mine/`）。
//
// 她的原話：
//
// > 客戶A是別人丟給我的客戶，健檢在他那邊做完了，我需要幫忙安排他三返
// > …然後一樣祭悼行事曆以及試算表，一樣可以選醫生，一樣會出現耀勝等等或是寫紀錄的待辦，就跟一般n返一樣
//
// 時段上多一格 `examNotMine: true`：不扣任何一筆額度、不接任何一次健檢，其餘照二返那門課。
// 規則（組時段、驗證、試算表那一列、紅字、確認框）在 domain，`tests/exam-not-mine.test.js`、
// `tests/exam-not-mine-warnings.test.js` 盯著。這一支從瀏覽器走 node 裡走不到的那一段：
// 帶標記的段存進 Firestore、讀回來畫在日曆上、走一次真的存檔（長按「客戶說可以」）之後形狀不變、待辦照二返那門課長。
// 那一顆怎麼按、紅字畫在哪是段二、段三的事（05～09），由那幾段補。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, visit, TODAY } from '../fixtures/data.js';

const DAY = TODAY;

/** 一段帶標記的段（照 `slotFromPicks()` 會組出來的形狀）。 */
const notMine = (over = {}) => ({
  entitlementId: null, courseId: 'course-followup', courseName: '二返', equipmentId: null, ivProductId: null,
  startsAt: '10:00', endsAt: '10:30', minutes: 30, roomId: null, bed: null, therapistId: null, doctorId: 'staff-dr-xia',
  followupForVisitId: null, giftKind: null, note: null, status: 'pending_confirm', examNotMine: true, ...over,
});

/** 別人轉來的客人：身上一筆額度、一次健檢都沒有。一天兩段：二返、三返，都是健檢不是她排的。 */
function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-m', name: '王小明' }),
    visit({
      id: 'v-m', customerId: 'cust-m', customerName: '王小明', date: DAY, status: 'pending_confirm',
      slots: [
        notMine(),
        notMine({ courseName: '三返', followupNth: 3, startsAt: '11:00', endsAt: '11:30' }),
      ],
    }),
  ];
}

async function openDayDrawer(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-m:"]');
}

async function longPressRow(page, index) {
  const row = page.locator('[data-open^="visit:v-m:"]').nth(index);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

test('X1 日曆上印二返與三返（不是兩個二返）；長按「客戶說可以」存得下去、標記與返數讀回來不變、Examine 與耀聖照二返那門課長、健檢那條鏈一張都不長', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  const rows = page.locator('[data-open^="visit:v-m:"]');
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText('二返');
  await expect(rows.nth(1), '三返要讀快照，不可以印成二返').toContainText('三返');
  await expect(rows.nth(1)).not.toContainText('二返');

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-m');
  expect(saved.slots).toHaveLength(2);
  expect(saved.slots[0]).toMatchObject({
    status: 'confirmed', examNotMine: true, entitlementId: null, followupForVisitId: null, giftKind: null, courseId: 'course-followup',
  });
  expect(saved.slots[0], '二返不寫返數').not.toHaveProperty('followupNth');
  expect(saved.slots[1]).toMatchObject({
    status: 'pending_confirm', examNotMine: true, entitlementId: null, followupForVisitId: null, giftKind: null, followupNth: 3,
  });

  const tasks = (await app.readAll('tasks')).filter((t) => t.visitId === 'v-m' && !t.deletedAt);
  const kinds = tasks.map((t) => t.kind).sort();
  expect(kinds, '照二返那門課：Examine、耀聖').toEqual(expect.arrayContaining(['Examine', '耀聖']));
  for (const t of tasks.filter((x) => ['Examine', '耀聖'].includes(x.kind))) {
    expect(t.slotIndexes, '只掛談定的那一段').toEqual([0]);
  }
  const chain = (await app.readAll('tasks')).filter((t) => ['約二返', '追蹤健檢報告', '寄報告給醫師'].includes(t.kind));
  expect(chain, '不接健檢：那條鏈一張都不長').toHaveLength(0);
});
