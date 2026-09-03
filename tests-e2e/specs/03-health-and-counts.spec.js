// 資料健檢（`#/settings/health`）與次數對帳。
//
// ADR-0004：詳情頁**現算**、清單頁**讀快取**，兩邊對不起來時把差異顯示出來，
// **不自動偷改**。這一支就是去踩那條線。

import { test, expect } from '../fixtures/app.js';
import {
  scenarioBrokenCounts, masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

test('H0 一份乾淨的資料庫，資料健檢應該一條都不報', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-vein', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 20,
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  console.log('[H0] 資料健檢全文 =\n' + body);
  expect(body).not.toMatch(/這一頁出錯了/);
});

test('H1 計數欄位歪掉 → 資料健檢列出來，客戶詳情顯示差異但不偷改', async ({ app, page }) => {
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/settings/health');

  const health = await app.text();
  console.log('[H1] 資料健檢 =\n' + health.slice(0, 1500));
  expect(health, '次數對帳要抓到').toMatch(/次數對帳/);

  // 客戶詳情：顯示差異，畫面上用的是重算值
  await app.go('/customers/cust-e');
  const detail = await app.text();
  expect(detail).toContain('計數欄位與來訪對不起來');
  expect(detail).toContain('把計數欄位改成重算值');

  // 還沒按修正之前，資料庫裡的歪值要原封不動（ADR-0007：只算不寫）
  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect(ent.doneCount, '沒按修正就不准動').toBe(5);
  expect(ent.bookedCount).toBe(3);
});

test('H2 按下「把計數欄位改成重算值」→ 真的改對，而且留得下稽核', async ({ app, page }) => {
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/customers/cust-e');

  await page.locator('[data-fix]').first().click();

  // 修正是破壞性操作，會先跳二次確認並把前後值列出來（SPEC 6.5）
  await expect(app.dialog()).toBeVisible();
  const dialog = await app.dialogText();
  expect(dialog, '要講出改成什麼').toMatch(/已完成\s*5\s*→\s*1/);
  expect(dialog).toMatch(/已排未上\s*3\s*→\s*0/);
  await app.ok();
  await page.waitForTimeout(1500);

  const ent = await app.readDoc('customers/cust-e/entitlements', 'ent-e-vein');
  expect(ent.doneCount, '來訪只算得出 1 次已完成').toBe(1);
  expect(ent.bookedCount).toBe(0);

  const audit = await app.readAll('audit');
  expect(audit.length, '每一次寫入都要留稽核').toBeGreaterThan(0);
});

test('H3 客戶總覽讀快取、詳情頁現算 —— 兩邊刻意會不一樣（ADR-0004）', async ({ app }) => {
  await app.seed(scenarioBrokenCounts());
  await app.signIn('/customers');

  // 總覽讀的是 doneCount/bookedCount（5+3=8，剩 12）
  const list = await app.text();
  console.log('[H3] 客戶總覽 =', JSON.stringify(list.slice(0, 400)));

  await app.go('/customers/cust-e');
  const detail = await app.text();
  // 詳情現算：已完成 1、已排 0、剩 19
  expect(detail).toMatch(/已完成\s*1/);
  expect(detail).toMatch(/剩餘\s*19/);
});

test('H4 額度超用只提醒不擋，而且資料健檢列得出來', async ({ app }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-f', name: '客戶F' }),
    entitlement('cust-f', {
      id: 'ent-f', label: '靜脈', type: 'single', courseId: 'course-iv-laser',
      totalQty: 1, doneCount: 2, bookedCount: 1,
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  console.log('[H4] =\n' + body.slice(0, 1200));
  expect(body).toContain('額度超用');
});

test('H5 同一個月記了兩份可用性 → 列出來，但不自動合併（ADR-0053）', async ({ app }) => {
  const { availability } = await import('../fixtures/data.js');
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-g', name: '客戶G' }),
    entitlement('cust-g', {
      id: 'ent-g', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 10,
    }),
    availability('cust-g', {
      id: 'av-1', rawText: '9/6 那星期不行', validFrom: '2026-09-01', validTo: '2026-09-30',
    }),
    availability('cust-g', {
      id: 'av-2', rawText: '禮拜五都不行', validFrom: '2026-09-01', validTo: '2026-09-30',
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  expect(body).toContain('同一個月有兩份');

  // 不自動合併：兩份都還在
  const rows = await app.readAll('customers/cust-g/availability');
  expect(rows.filter((r) => !r.deletedAt)).toHaveLength(2);
});

test('H6 孤兒資料：指向不存在的課程的來訪要被列出來', async ({ app }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-h', name: '客戶H' }),
    entitlement('cust-h', {
      id: 'ent-h', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 10,
    }),
    visit({
      id: 'visit-orphan', customerId: 'cust-h', customerName: '客戶H',
      date: addDays(TODAY, 3), status: 'confirmed',
      slots: [{
        courseId: 'course-does-not-exist', courseName: '不存在的課',
        entitlementId: 'ent-h', startsAt: '10:00', endsAt: '11:00',
      }],
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  console.log('[H6] =\n' + body.slice(0, 1500));
  expect(body).toContain('孤兒資料');
});


// issue 04，2026-09-04：排班的兩個入口以前把主檔裡全部的品項列出來，所以
// 「營養點滴・護肝排毒」那筆額度底下排成別款是存得下去的。現在畫面預設就是
// 買的那一款、存檔會提醒 —— 但**已經存進去的那幾筆不會自己好**，
// 而她看不到。資料健檢就是讓她看得到它們的地方。
test('H8 已經存進去的品項錯配列得出來，而且不自動改', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-i', name: '客戶I' }),
    entitlement('cust-i', {
      id: 'ent-i-drip', label: '營養點滴・護肝排毒', type: 'single',
      courseId: 'course-iv-drip', totalQty: 6, durationMin: 60,
      // 次數要先對得起來，不然這一支會連帶抓到「次數對帳」那一項
      doneCount: 1, bookedCount: 0,
      ivProductId: 'iv-liver',
    }),
    visit({
      id: 'v-i-drip', customerId: 'cust-i', customerName: '客戶I',
      date: addDays(TODAY, -2), status: 'done',
      slots: [slot({
        courseId: 'course-iv-drip', entitlementId: 'ent-i-drip',
        startsAt: '10:00', endsAt: '11:00', roomId: 'room-iv8', bed: 'A',
        ivProductId: 'iv-heart', attended: true,
      })],
    }),
  ]);
  await app.signIn('/settings/health');

  const body = await app.text();
  expect(body).toContain('品項跟買的不一樣');
  expect(body, '一列要講清楚買的是哪一款、排成了哪一款').toContain('買的是 護肝排毒');
  expect(body).toContain('排成了 護心抗老');

  // **不給一鍵修正** —— Abovee 上那一筆也要跟著改，那不是 app 做得到的事
  const fixable = await page.locator('#view [data-fix]').count();
  expect(fixable).toBe(0);
});
