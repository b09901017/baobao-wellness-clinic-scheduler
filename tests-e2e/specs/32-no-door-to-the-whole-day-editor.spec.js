// 壓表與資料健檢不可以通到整天的編輯器。
//
// `CLAUDE.md` 與 `.scratch/slot-first-and-fewer-words/spec.md:87` 都寫著
// 「`renderEdit()` 那條網址留著，**沒有任何畫面上的連結**，不算一條路」——
// 2026-09-16 實際走過，有兩個入口，其中一個在她最常用的那一頁。
//
// 那條路由是整天全部的段、日期欄、每一段的 ×，所以 ADR-0056（只有日曆改得動
// 一筆來訪）、0085（只改她點的那一段）、0089（改整天的日期一條路都沒有）
// 那一串決定在那裡全部不成立。她 2026-09-16：「整列不給點」「整顆拿掉」。
//
// **網址本身留著**（既有的書籤與稽核紀錄裡的連結不能壞），所以這一支盯的是
// 「畫面上點不點得到」，不是「那條路由還在不在」。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

/** 一位客戶，這個月壓好了一筆。 */
function seedRecorded() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-y', name: '客戶A' }),
    entitlement('cust-y', {
      id: 'ent-ib', label: '身體組成分析 10 次', type: 'single',
      courseId: 'course-inbody', totalQty: 10, bookedCount: 1,
    }),
    visit({
      id: 'v-one', customerId: 'cust-y', customerName: '客戶A',
      date: TODAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-inbody', entitlementId: 'ent-ib',
        startsAt: '09:00', endsAt: '09:20',
      })],
    }),
  ];
}

/** 壓表 → 開那個月 → 點開那一位的記錄面板。 */
async function openDeck(app, page) {
  await app.go('/schedule');
  await page.locator('[data-month="2026-08"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-y"]').first().click();
  await app.settled();
}

test('S1 壓表「這個月壓好的」看得到，但點不下去', async ({ app, page }) => {
  await app.seed(seedRecorded());
  await app.signIn('/schedule');
  await openDeck(app, page);

  await expect(page.locator('#view'), '那一列還是要看得到').toContainText('這個月壓好的');
  await expect(page.locator('#view')).toContainText('身體組成分析');
  await expect(
    page.locator('a[href^="#/visits/"]'),
    'renderEdit() 那條網址不可以有畫面上的入口',
  ).toHaveCount(0);
});

test('S2 資料健檢那幾列也沒有通往整天編輯器的「去看看」', async ({ app, page }) => {
  // 日期已過卻還是「已確認」→「狀態異常」那一列。它最需要出口，
  // 而整天的編輯器**做不到它要她做的事**（狀態卡 2026-09-12 拿掉了）。
  const seed = seedRecorded();
  const v = seed.find((d) => d.id === 'v-one');
  v.data.date = addDays(TODAY, -7);

  await app.seed(seed);
  await app.signIn('/settings/health');
  await app.settled();

  await expect(page.locator('#view'), '那一列還是要列出來').toContainText('狀態異常');
  await expect(page.locator('a[href^="#/visits/"]')).toHaveCount(0);
});
