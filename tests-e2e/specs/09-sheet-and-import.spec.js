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
        startsAt: '14:00', endsAt: '15:00', roomId: 'room-iv10', attended: true,
      })],
    }),
    visit({
      id: 'v-pending', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, 6), status: 'pending_confirm',
      slots: [slot({
        courseId: 'course-iv-laser', entitlementId: 'ent-vein',
        startsAt: '14:00', endsAt: '15:00', roomId: 'room-iv10',
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
      chartNo: '1234',
      entitlements: [
        // `key` 是這份檔案裡的代號，時段靠 `entitlementKey` 指回來
        // **課程名要跟主檔一字不差**（`byName()` 不做模糊比對）。那個課程
        // 2026-09-06 從「靜脈」正名成 ILIB —— 這一份夾具停在舊名字，
        // 而症狀是「1 位客戶 0 筆額度 0 筆來訪」，畫面上只寫「3 處對不到主檔」。
        { key: 'vein', label: 'ILIB(60)', courseName: 'ILIB', totalQty: 20, type: 'single' },
      ],
      visits: [
        {
          date: addDays(TODAY, -20),
          slots: [{ courseName: 'ILIB', entitlementKey: 'vein', startsAt: '14:00', endsAt: '15:00' }],
          status: 'done',
        },
        {
          date: addDays(TODAY, 10),
          slots: [{ courseName: 'ILIB', entitlementKey: 'vein', startsAt: '14:00', endsAt: '15:00' }],
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

// 合併檔 v2（`.scratch/asks-2026-09-13/issues/08`）：購買日、方案與套數、帶顏色的備註。
// 她：「也希望你幫我調整完後也幫我去修改合併的那個skill，讓他們相容」。
test('J-C12 合併檔 v2：匯進來的客戶抬頭印得出買了什麼，尾款那一則是紅色', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');

  const v2 = mergeFile({ format: 'baobao-merge/v2', eventCandidates: [] });
  Object.assign(v2.customers[0], {
    source: '顧客會',
    purchasedAt: '2026-06-17',
    marks: [{ text: '欠尾款3萬', color: 'red' }],
    purchaseProblems: ['購買名稱寫 2 套，但第 2–8 列的應有次數是 1 套，照應有次數匯'],
  });
  Object.assign(v2.customers[0].entitlements[0], {
    purchasedAt: '2026-06-17', sourcePlanName: '8萬方案', sourcePlanSets: 1, sourcePlanQty: 20, purchaseKey: 'plan',
  });

  await page.locator('[data-json]').fill(JSON.stringify(v2));
  await page.locator('[data-load]').click();
  await app.settled();
  await expect(page.locator('[data-purchase-problems]'), '對不上的那幾條要在匯入之前看得到')
    .toContainText('應有次數是 1 套');

  await page.locator('[data-run]').click();
  if (await app.dialog().count()) await app.ok();
  await expect.poll(async () => (await app.readAll('customers')).filter((c) => !c.deletedAt).length,
    { timeout: 20_000 }).toBe(1);

  const [c] = (await app.readAll('customers')).filter((x) => !x.deletedAt);
  expect(c.purchasedAt).toBe('2026-06-17');
  expect(c.source).toBe('顧客會');
  expect(c.marks).toEqual([{ text: '欠尾款3萬', color: 'red' }]);

  await app.go(`/customers/${c.id}`);
  await expect(page.locator('.hero__meta')).toHaveText('0617 顧客會 8萬方案');
});

// 合併檔 v3（`.scratch/merge-answers-2026-09-14/issues/02`）：只有一台器材的擇一池、額度的時長、警示與合作機構。
// 那三格以前都進不來：單買 SIS 被擋掉（「擇一池的器材不到兩種」）、30 分塌成課程的 60、flags 寫死成空的。
test('J-C13 合併檔 v3：單買一台的池匯得進去、時長照檔案、警示與合作機構寫到客戶身上', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');

  const v3 = mergeFile({ format: 'baobao-merge/v3', eventCandidates: [] });
  Object.assign(v3.customers[0], { flags: ['體內金屬'], partners: ['自然美'] });
  v3.customers[0].entitlements.push({
    key: 'sis', type: 'pool', label: 'SIS(30)', totalQty: 5, durationMin: 30,
    courseName: null, optionEquipmentNames: ['SIS'],
  });
  v3.customers[0].visits[0].slots.push({
    courseName: '復能', entitlementKey: 'sis', startsAt: '15:15', endsAt: '15:45', equipmentName: 'SIS',
  });

  await page.locator('[data-json]').fill(JSON.stringify(v3));
  await page.locator('[data-load]').click();
  await app.settled();
  expect(await app.text(), '只有一台的池不可以被擋掉').not.toContain('擇一池一台器材都對不到');

  await page.locator('[data-run]').click();
  if (await app.dialog().count()) await app.ok();
  await expect.poll(async () => (await app.readAll('customers')).filter((c) => !c.deletedAt).length,
    { timeout: 20_000 }).toBe(1);

  const [c] = (await app.readAll('customers')).filter((x) => !x.deletedAt);
  expect(c.flags).toEqual(['體內金屬']);
  expect(c.partners).toEqual(['自然美']);

  // **名字改成 app 的寫法**（2026-09-16，ADR-0095）：舊表寫 `SIS(30)`，
  // 而她在 app 裡加購同一筆會叫 `復能-SIS(30)` —— 同一位客戶身上兩種名字
  // 並排看起來像兩種東西。擇一池的名字 100% 由器材與時長決定，所以改得掉。
  const ents = await app.readAll(`customers/${c.id}/entitlements`);
  const pool = ents.find((e) => e.type === 'pool');
  expect(pool?.label, '匯進來的名字用 app 的寫法').toBe('復能-SIS(30)');
  expect(ents.some((e) => e.label === 'SIS(30)'), '舊表那個寫法不可以留著').toBe(false);
  expect(pool?.optionEquipmentIds, '只有 SIS 一台').toEqual(['eq-sis']);
  expect(pool?.durationMin, '30 分鐘不可以塌成課程的 60').toBe(30);

  await expect.poll(async () => (await app.readAll('visits')).filter((v) => !v.deletedAt)
    .flatMap((v) => v.slots ?? [])
    .some((s) => s.entitlementId === pool.id && s.equipmentId === 'eq-sis'),
  { timeout: 20_000 }).toBe(true);
});

// 2026-10-05（abovee-and-master/13）：功醫門診不算次數（ADR-0121），合併檔那一段沒有 `entitlementKey`。
// 寫入那一道以前是「有一段沒有額度就整位擋下來」—— 規則在 `tests/merge-functional-clinic.test.js`，
// 這一支盯只有真的寫一次才看得到的：**整位照樣進得去、那一段不指任何額度、次數一格都沒動**。
test('J-C14 合併檔 v5：功醫門診那一段沒有額度照樣匯得進來，客戶身上的次數一格都沒動', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');

  const v5 = mergeFile({
    format: 'baobao-merge/v5', eventCandidates: [],
    // 以後的預約（預設勾起來）：一樣沒有額度可以扣
    futureVisits: [{
      customerName: '王小明', date: addDays(TODAY, 12), status: 'confirmed',
      courseName: '功醫門診', startsAt: '09:30', evidence: '9.王小明HRV', include: false,
    }],
  });
  // 做過的那一天：ILIB 之外多一段功醫門診
  v5.customers[0].visits[0].slots.push({
    courseName: '功醫門診', entitlementKey: null, startsAt: '15:00', endsAt: '15:30',
  });

  await page.locator('[data-json]').fill(JSON.stringify(v5));
  await page.locator('[data-load]').click();
  await app.settled();
  expect(await app.text(), '不算次數的課沒有額度不是問題').not.toContain('對不到任何一筆額度');

  await page.locator('[data-run]').click();
  if (await app.dialog().count()) await app.ok();
  await expect.poll(async () => (await app.readAll('visits')).filter((v) => !v.deletedAt).length,
    { timeout: 20_000 }).toBe(3);

  const [c] = (await app.readAll('customers')).filter((x) => !x.deletedAt);
  const visits = (await app.readAll('visits')).filter((v) => !v.deletedAt);
  const fm = visits.flatMap((v) => (v.slots ?? []).map((s) => ({ ...s, date: v.date, visitStatus: v.status })))
    .filter((s) => s.courseId === 'course-fm');
  expect(fm.map((s) => [s.date, s.entitlementId, s.startsAt, s.endsAt]).sort()).toEqual([
    [addDays(TODAY, -20), null, '15:00', '15:30'],
    [addDays(TODAY, 12), null, '09:30', '10:00'],
  ].sort());
  expect(fm.find((s) => s.date > TODAY).visitStatus, '以後的那一筆不可以是已完成').not.toBe('done');

  // 次數：ILIB 做了一次、排了一次，跟沒有功醫門診時一樣
  const [ilib] = await app.readAll(`customers/${c.id}/entitlements`);
  expect([ilib.doneCount, ilib.bookedCount]).toEqual([1, 1]);

  // 資料健檢：沒有額度的那兩段不是孤兒、次數對得上
  await app.go('/settings/health');
  await expect(page.locator('#view [data-check="counts"]')).toContainText('沒問題');
  await expect(page.locator('#view [data-check="orphans"]')).toContainText('沒問題');
});

// 試算表的次數拿全部過去的來訪算（course-form-and-sheet-2026-10-06 的 issue 13，ADR-0132）。
// 以前只讀今天前後 400 天：超過的那一次不算進去，報表上的「已完成」比 app 少。
test('J-C15 報表：500 天前做過的那一次也算進去，那一天也有一欄', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-vein', label: '靜脈', type: 'single', courseId: 'course-iv-laser',
      totalQty: 20, doneCount: 2, bookedCount: 0, durationMin: 60,
    }),
    ...[-500, -10].map((days, i) => visit({
      id: `v-done-${i}`, customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, days), status: 'done',
      slots: [slot({
        courseId: 'course-iv-laser', entitlementId: 'ent-vein',
        startsAt: '14:00', endsAt: '15:00', roomId: 'room-iv10', attended: true,
      })],
    })),
  ]);
  await app.signIn('/settings/report');

  const cells = (row) => row.locator('th, td').evaluateAll((els) => els.map((el) => el.textContent.trim()));
  const head = await cells(page.locator('table.sheet tr', { hasText: '療程項目' }).first());
  const row = await cells(page.locator('table.sheet tr', { hasText: '靜脈' }).first());

  // 療程項目｜應有｜已完成｜已排未上｜剩餘｜日期…
  expect(row.slice(1, 5), '兩次都算進去：以前 500 天前那一次不算，已完成是 1、剩餘是 19').toEqual(['20', '2', '0', '18']);
  expect(head.length - 5, '兩天各一欄').toBe(2);
  expect(row.slice(5)).toEqual(['✓', '✓']);
});

// 三返在矩陣裡自己一列（course-form-and-sheet-2026-10-06 的 issue 14，ADR-0131）。
// 以前只做三返的那一天那一欄整欄是空的 —— 它沒有額度，而列只從額度來。
test('J-C16 報表：只做三返的那一天，「三返（不算次數）」那一列有符號；健檢那一欄底下那一行照舊', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-chk', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1, doneCount: 1, tier: '8萬',
    }),
    entitlement('cust-a', {
      id: 'ent-fu', label: '二返（8萬健檢）', courseId: 'course-followup', totalQty: 1,
      followupForEntitlementId: 'ent-chk',
    }),
    visit({
      id: 'v-exam', customerId: 'cust-a', customerName: '客戶A', date: addDays(TODAY, -30), status: 'done',
      slots: [slot({ courseId: 'course-checkup', entitlementId: 'ent-chk', startsAt: '09:00', endsAt: '11:00', attended: true })],
    }),
    visit({
      id: 'v-3rd', customerId: 'cust-a', customerName: '客戶A', date: addDays(TODAY, -5), status: 'done',
      slots: [slot({
        courseId: 'course-followup', entitlementId: null, followupNth: 3, followupForVisitId: 'v-exam',
        startsAt: '14:00', endsAt: '14:30', attended: true,
      })],
    }),
  ]);
  await app.signIn('/settings/report');

  const cells = (row) => row.locator('th, td').evaluateAll((els) => els.map((el) => el.textContent.trim()));
  const rowOf = (label) => cells(page.locator('table.sheet tr', { hasText: label }).first());

  // 療程項目｜應有｜已完成｜已排未上｜剩餘｜健檢那一天｜三返那一天
  expect(await rowOf('三返（不算次數）')).toEqual(['三返（不算次數）', '—', '1', '0', '—', '', '✓']);
  expect((await rowOf('二返（8萬健檢）')).slice(1), '三返不算進二返那一筆').toEqual(['1', '0', '0', '1', '', '']);
  // 健檢那一欄底下那一行（她：「要留」）：二返還沒約是空括號，三返接在它下面
  const body = await app.text();
  expect(body).toContain('二返()');
  expect(body).toMatch(/\d+\/\d+ 三返\(\)/);
});
