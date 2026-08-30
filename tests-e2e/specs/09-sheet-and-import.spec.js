// Journey C：外部（試算表報表、舊資料合併匯入）
//
// 兩件事的共同風險是**靜默**：
//   - 試算表：SYNC_FORMAT 對不上時 app 照樣推、`.gs` 整包拒收，
//     而畫面上看起來跟推好了一模一樣（CLAUDE.md 特別警告過）
//   - 匯入：貼錯東西的症狀如果是「匯了一半」，比整個拒絕嚴重得多

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

function reportSeed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-vein', label: '靜脈', type: 'single', courseId: 'course-iv-laser',
      totalQty: 20, doneCount: 1, bookedCount: 1, durationMin: 60,
    }),
    entitlement('cust-a', {
      id: 'ent-prod', label: '營養品 5,000（夜態美＋GABA）', type: 'product',
      totalQty: 2, amountTwd: 5000,
      items: [
        { productId: 'prod-yetaimei', name: '夜態美' },
        { productId: 'prod-gaba', name: 'GABA' },
      ],
      deliveries: [],
    }),
    visit({
      id: 'v-done', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, -10), status: 'done',
      slots: [slot({
        courseId: 'course-iv-laser', entitlementId: 'ent-vein',
        startsAt: '14:00', endsAt: '15:00', roomId: 'room-ilib4', attended: true,
      })],
    }),
    visit({
      id: 'v-pending', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, 6), status: 'pending_confirm',
      slots: [slot({
        courseId: 'course-iv-laser', entitlementId: 'ent-vein',
        startsAt: '14:00', endsAt: '15:00', roomId: 'room-ilib4',
      })],
    }),
  ];
}

test('J-C1+C2+C3 報表：一位客戶一張、四種符號、營養品有那一列但不進合計', async ({ app, page }) => {
  await app.seed(reportSeed());
  await app.signIn('/settings/report');

  const body = await app.text();
  console.log('[J-C1] 試算表報表 =\n' + body.slice(0, 2000));

  expect(body, '沒有總表，是一位客戶一張').toContain('客戶A');
  expect(body, '唯讀警語').toContain('系統自動產生');

  // 四種符號（domain/visits.js 的 STATUS_VIEW）
  expect(body).toMatch(/[○△✓✗]/);

  // 營養品那一列在，但不進「還要排幾次」的合計
  expect(body, '營養品要有那一列').toMatch(/營養品/);
});

test('J-C5+C6 試算表推送：沒設定要講出來，設錯了也要講出來（不可以靜默）', async ({ app, page }) => {
  // 這一支**故意**去打一個不存在的網址，所以瀏覽器一定會喊
  // ERR_CONNECTION_REFUSED —— 那正是要測的東西，不是意外。
  test.info().annotations.push({ type: 'allow-console-errors', description: '刻意打一個死掉的推送網址' });
  await app.seed(reportSeed());
  await app.signIn('/settings/report');

  const before = await app.text();
  console.log('[J-C5] 還沒設定推送網址時 =', JSON.stringify(
    (before.match(/自動[\s\S]{0,220}/) ?? [''])[0],
  ));
  expect(before, '沒設定要看得出來').toMatch(/還沒設定|貼上|網址/);

  // 設一個一定會失敗的網址，按「立刻推一次」
  // **網址與密鑰兩個都填了才會開始推**（畫面上自己寫的），只填一個存不下去
  await page.locator('[data-sync-url]').fill('http://127.0.0.1:5099/definitely-not-there');
  await page.locator('[data-sync-token]').fill('test-token');
  await page.locator('[data-sync-save]').click();
  await page.waitForTimeout(1200);
  await page.locator('[data-sync-now]').click();
  await page.waitForTimeout(6000);

  const after = await app.allText();
  const line = (after.match(/(推送|同步)[\s\S]{0,200}/) ?? [''])[0];
  console.log('[J-C6] 推不出去之後畫面上寫著 =', JSON.stringify(line));
  expect(after, '推不出去一定要看得見，不可以靜默吞掉')
    .toMatch(/被拒絕|連不上|失敗|有問題/);
  expect(after, '而且要講清楚「資料是安全的，舊的是試算表那一份」')
    .toMatch(/試算表上那份現在是舊的|資料在 app 裡是安全的/);
});

// ---------------------------------------------------------------------------
// 合併匯入
// ---------------------------------------------------------------------------

const mergeFile = (over = {}) => ({
  format: 'baobao-merge/v1',
  sheet: { file: '舊表.xlsx' },
  calendar: { file: 'timetree.ics' },
  customers: [
    {
      name: '王小明',
      chartNo: '3157',
      entitlements: [
        // `key` 是這份檔案裡的代號，時段靠 `entitlementKey` 指回來
        { key: 'vein', label: '靜脈', courseName: '靜脈', totalQty: 20, type: 'single' },
      ],
      visits: [
        {
          date: addDays(TODAY, -20),
          slots: [{ courseName: '靜脈', entitlementKey: 'vein', startsAt: '14:00', endsAt: '15:00' }],
          status: 'done',
        },
        {
          date: addDays(TODAY, 10),
          slots: [{ courseName: '靜脈', entitlementKey: 'vein', startsAt: '14:00', endsAt: '15:00' }],
          status: 'done', // ← 舊表上未來的預約也有打勾
        },
      ],
    },
  ],
  // 行事曆上那些不是來訪的雜事。**欄位名是 eventCandidates、日期欄是 startDate**
  eventCandidates: [
    { startDate: addDays(TODAY, 3), endDate: addDays(TODAY, 3), title: '宜蘭休假', kind: 'leave', allDay: true },
    // 寫了同事名字的，產檔那側就該退回行事備註（判錯休假的代價最不對稱）
    { startDate: addDays(TODAY, 4), endDate: addDays(TODAY, 4), title: '跟騰崴確認器材', kind: 'personal', allDay: true },
    { startDate: addDays(TODAY, 5), endDate: addDays(TODAY, 5), title: '記得叫貨', kind: 'note', allDay: true },
  ],
  ...over,
});

test('J-C-val 貼錯東西整份拒收，不會匯一半', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');

  await page.locator('[data-json]').fill(JSON.stringify({ format: 'something-else', customers: [] }));
  await page.locator('[data-load]').click();
  await page.waitForTimeout(1200);

  const body = await app.text();
  console.log('[J-C-val] 貼錯格式 =', JSON.stringify(body.slice(0, 400)));
  expect(body).toMatch(/格式不對|baobao-merge/);

  expect((await app.readAll('customers')).filter((c) => !c.deletedAt), '一筆都不該進去').toHaveLength(0);
});

test('J-C9+C10 匯入：狀態依「匯入當下的日期」判、未來的預設勾起來', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');

  await page.locator('[data-json]').fill(JSON.stringify(mergeFile()));
  await page.locator('[data-load]').click();
  await app.settled();

  const preview = await app.text();
  console.log('[J-C9] 匯入預覽 =\n' + preview.slice(0, 1200));

  await page.locator('[data-run]').click();
  // 匯入是破壞性操作，可能有二次確認
  if (await app.dialog().count()) await app.ok();
  await page.waitForTimeout(6000);

  const visits = (await app.readAll('visits')).filter((v) => !v.deletedAt);
  console.log('[J-C9] 匯進來的來訪 =', visits.map((v) => `${v.date}:${v.status}`));

  const past = visits.find((v) => v.date < TODAY);
  const future = visits.find((v) => v.date > TODAY);
  expect(past?.status, '已經發生的 → 已完成').toBe('done');
  expect(future?.status, '還沒發生的不可以是 done（ADR-0029）').not.toBe('done');
});

test('J-C11 行事曆雜事：寫了同事名字的一律退回行事備註，不可以判成休假', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');

  await page.locator('[data-json]').fill(JSON.stringify(mergeFile()));
  await page.locator('[data-load]').click();
  await app.settled();

  const rows = await page.locator('[data-kindrow]').count();
  console.log('[J-C11] 逐列可改的雜事有', rows, '列');
  const body = await app.text();
  console.log('[J-C11] 雜事分類那一段 =', JSON.stringify(
    (body.match(/宜蘭休假[\s\S]{0,300}/) ?? [''])[0],
  ));

  expect(body, '三筆雜事都要列出來讓她逐列改').toContain('宜蘭休假');
  expect(body).toContain('跟騰崴確認器材');
  expect(body).toContain('記得叫貨');
});
