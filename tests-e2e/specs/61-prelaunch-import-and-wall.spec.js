// 2026-10-08 上線前修正，第一段（`.scratch/prelaunch-fixes-2026-10-08/issues/01`–`08`）。
//
// 這一段的共同點：**單元測試釘得住規則，釘不住「那顆按鈕這時候按不按得下去」
// 「那一排真的畫在她眼前」**。一段一支 spec，少開幾次模擬器（她的筆電會過熱）。
//
// fixture 全部是編出來的（客戶A、客戶B）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY, addDays,
} from '../fixtures/data.js';
import { APP_ORIGIN } from '../fixtures/emulator.js';

// ---------- 01 舊資料匯入只跑得了一趟 ----------

/** 一位假客戶：一筆 ILIB 額度、一次已經發生的來訪。 */
const person = (name) => ({
  sheetName: name,
  name,
  entitlements: [{ key: 'r8', type: 'single', label: 'ILIB(60)', totalQty: 12, courseName: 'ILIB' }],
  visits: [{
    date: addDays(TODAY, -20),
    status: 'done',
    slots: [{ entitlementKey: 'r8', courseName: 'ILIB', startsAt: '10:00', endsAt: '11:00' }],
  }],
});

const mergeFile = (over = {}) => ({
  format: 'baobao-merge/v5',
  sheet: { file: '舊表.xlsx' },
  calendar: { file: 'timetree.ics' },
  customers: [person('客戶A'), person('客戶B')],
  eventCandidates: [],
  ...over,
});

const liveCustomers = async (app) => (await app.readAll('customers')).filter((c) => !c.deletedAt);

async function paste(app, page, file) {
  await page.locator('[data-json]').fill(JSON.stringify(file));
  await page.locator('[data-load]').click();
  await app.settled();
}

test('I1 匯入：確認框開著、匯入在跑的時候那顆按鈕按不下去，跑完剛好兩位', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  await paste(app, page, mergeFile());

  await page.locator('[data-run]').click();
  await expect(app.dialog()).toBeVisible();
  // 確認框開著的那一段也算進行中：她可能在第一個確認框還沒按之前又點一次
  await expect(page.locator('[data-run]'), '確認框開著時').toBeDisabled();
  await expect(page.locator('[data-load]'), '換一份檔案的那一顆也鎖著').toBeDisabled();
  // 02：每一樣都對得到、沒有人同名的那一份（正常的切換日），確認框一個字都不多
  expect(await app.dialogText()).not.toMatch(/對不到主檔|同名/);

  // **匯入開始跑的同一下，繞過畫面上的鎖再按一次**：把 `disabled` 拿掉才按 —— 鎖著的按鈕 `.click()` 根本不發事件，
  // 那樣量到的只有「按鈕是灰的」，`run()` 自己那一道（進來先問是不是正在跑）沒有人在盯（2026-10-09 審查）。
  // 兩下放在同一趟裡：按了「匯入」、第一趟還沒往下走的那一刻就硬按，不靠「匯入跑得夠久」。
  // 少了那一道，這裡會再跳一個確認框（而她按下去就是每一位多建一份）
  await page.evaluate(() => {
    document.querySelector('.dialog-backdrop [data-ok]').click();
    const btn = document.querySelector('[data-run]');
    btn.disabled = false;
    btn.click();
  });
  await expect(page.locator('.dialog-backdrop'), '匯入在跑時硬按：不會再跳一個確認框').toHaveCount(0);
  await expect(page.locator('#toast')).toContainText('2 位客戶都匯進去了', { timeout: 20_000 });
  await app.settled();

  expect(await liveCustomers(app), '剛好兩位').toHaveLength(2);
  await expect(page.locator('[data-run]'), '整份匯好了：檔案清掉，那顆按鈕不在了').toHaveCount(0);
});

test('I2 匯入：按「先不要」之後按鈕回來，一個字都沒寫', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  await paste(app, page, mergeFile());

  await page.locator('[data-run]').click();
  await expect(app.dialog()).toBeVisible();
  await app.cancelDialog();

  await expect(page.locator('[data-run]')).toBeEnabled();
  expect(await liveCustomers(app)).toHaveLength(0);
});

test('I3 匯入：客戶都寫完、雜事那一步失敗之後再按一次，一位都不會多', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors' });
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  // 一筆 201 個字的待辦：Rules 不收（`validNote()` 上限 200），所以 `importNotes()` 會丟例外 ——
  // 而那時候兩位客戶與那一筆休假已經寫進去了
  await paste(app, page, mergeFile({
    eventCandidates: [
      { startDate: addDays(TODAY, 2), endDate: addDays(TODAY, 2), title: '休', kind: 'leave', allDay: true },
      { startDate: addDays(TODAY, 3), endDate: addDays(TODAY, 3), title: '記'.repeat(201), kind: 'note', allDay: true },
    ],
  }));

  await page.locator('[data-run]').click();
  await app.ok();
  await expect(page.locator('#toast')).toContainText('匯入失敗', { timeout: 20_000 });
  await app.settled();
  expect(await liveCustomers(app), '第一次：兩位').toHaveLength(2);
  await expect(page.locator('[data-import-result]'), '結果留在這一頁上').toContainText('雜事沒有寫完');

  // 02：客戶都進去了、還有一筆待辦沒寫進去 → 還重試得了，而且只寫沒寫進去的那一筆
  const again = page.locator('[data-run]');
  await expect(again, '只剩雜事也重試得了').toBeEnabled();
  await again.click();
  expect(await app.dialogText(), '確認框講的是這一次真的會做的事').toContain('客戶都已經在系統裡了');
  expect(await app.dialogText(), '休假那一筆已經寫了，不再列').toContain('沒有勾任何行事備註或休假');
  await app.ok();
  await expect(page.locator('#toast')).toContainText('匯入失敗', { timeout: 20_000 });
  await app.settled();

  expect(await liveCustomers(app), '再按一次：還是兩位').toHaveLength(2);
  expect((await app.readAll('events')).filter((e) => !e.deletedAt), '休假沒有多一份').toHaveLength(1);
});

// ---------- 02 確認框與完成那一張：對不到主檔幾處、同名跳過幾位 ----------

test('I4 匯入：有東西對不到主檔、有人同名 → 確認框講出來，匯完清單還看得到', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-b', name: '客戶B' })]);
  await app.signIn('/settings/merge');

  const file = mergeFile();
  // 客戶A 多一筆主檔裡沒有的課程：那一筆額度整筆不匯，它底下那一段也跟著不匯
  file.customers[0].entitlements.push({ key: 'r9', type: 'single', label: '新課(60)', totalQty: 3, courseName: '主檔沒有的課' });
  file.customers[0].visits[0].slots.push({ entitlementKey: 'r9', courseName: '主檔沒有的課', startsAt: '13:00', endsAt: '14:00' });
  await paste(app, page, file);

  await page.locator('[data-run]').click();
  const said = await app.dialogText();
  expect(said, '幾處對不到主檔').toContain('2 處對不到主檔');
  expect(said, '後果：匯完補不回來').toContain('補不回來');
  expect(said, '同名跳過幾位').toContain('1 位因為系統裡已經有同名的客戶');
  await app.ok();

  await expect(page.locator('#toast')).toContainText('1 位客戶都匯進去了', { timeout: 20_000 });
  await app.settled();
  const result = page.locator('[data-import-result]');
  await expect(result).toContainText('有 2 處對不到主檔');
  await expect(result).toContainText('1 位因為系統裡已經有同名的客戶');
  await expect(result.locator('details li'), '那張清單匯完還看得到').toHaveCount(2);
});

// ---------- 04 程式檔每次都先問伺服器 ----------

// `firebase.json` 的 `headers` 寫得對不對，`tests/deploy-config.test.js` 自己解 glob 驗過一次；
// 這一條拿模擬器（superstatic，Hosting 的 glob 就是照它）再問一次 —— 特別是首頁網址 `/`。
// **Windows 上跳過**：模擬器用的 `glob-slasher` 在 Windows 把規則裡的 `/` 換成 `\`，一條都對不上
// （連 2026-08 就有的 `/sw.js` 那一條也是）。CI 是 Linux，全量跑的時候這一條會跑到。
test('H1 模擬器回的快取標頭：程式檔與首頁 no-cache、圖示一小時', async ({ request }) => {
  test.skip(process.platform === 'win32', '模擬器在 Windows 上對不上任何一條 headers 規則（glob-slasher）');

  for (const path of ['/', '/index.html', '/sw.js', '/js/app.js', '/css/app.css', '/form.html', '/manifest.webmanifest']) {
    const res = await request.get(`${APP_ORIGIN}${path}`);
    expect(res.headers()['cache-control'], path).toBe('no-cache');
  }
  const icon = await request.get(`${APP_ORIGIN}/icons/icon-192.png`);
  expect(icon.headers()['cache-control']).toBe('public, max-age=3600');
});

// ---------- 05 讀取卡片最上面那一排：這位客人的警示 ----------

const DAY = TODAY;

/** 客戶A 有「體內金屬」、客戶B 什麼警示都沒有；兩位今天各有一段已確認的 ILIB，客戶A 還掛著一張 Examine。 */
function seedAlerts() {
  const oneVisit = (id, customerId, customerName, startsAt) => visit({
    id, customerId, customerName, date: DAY, status: 'confirmed',
    slots: [{
      ...slot({ courseId: 'course-iv-laser', entitlementId: `ent-${customerId}`, startsAt, endsAt: startsAt.replace(':00', ':59') }),
      status: 'confirmed',
    }],
  });
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A', flags: ['體內金屬', '固定禮拜五不行'] }),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-a', { id: 'ent-cust-a', label: 'ILIB(60)', courseId: 'course-iv-laser', totalQty: 10, bookedCount: 1 }),
    entitlement('cust-b', { id: 'ent-cust-b', label: 'ILIB(60)', courseId: 'course-iv-laser', totalQty: 10, bookedCount: 1 }),
    oneVisit('v-a', 'cust-a', '客戶A', '10:00'),
    oneVisit('v-b', 'cust-b', '客戶B', '14:00'),
    task({ id: 'task-a', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine', dueDate: DAY, visitId: 'v-a' }),
  ];
}

test('A1 日曆點一段：卡片最上面有警示；沒有警示的客人那一排不在', async ({ app, page }) => {
  await app.seed(seedAlerts());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-a:"]');

  await page.locator('[data-open^="visit:v-a:"]').first().click();
  await app.layer('.popcard');
  const alerts = page.locator('.popcard .readalerts');
  await expect(alerts, '警示那一層').toContainText('體內金屬');
  await expect(alerts, '其他限制不在這一排').not.toContainText('固定禮拜五不行');
  await expect(alerts.locator('.blockchips'), '在會換行的包裝裡（裸放會被拉滿整行）').toHaveCount(1);
  await expect(page.locator('.popcard input[type="checkbox"]'), '這張卡只給看').toHaveCount(0);
  // 任務那一塊補讀回來之後那一排還在（`fillMirror()` 的那一次重畫），而且只有一排
  await app.layer('.popcard .taskmirror');
  await expect(alerts).toHaveCount(1);
  // 這一排在那一段的上面。**等那一次重畫完才量** —— 重畫到一半量到的是被換掉的舊節點（兩個都是 0）
  const top = (await alerts.boundingBox()).y;
  const slotTop = (await page.locator('.popcard .readslot').first().boundingBox()).y;
  expect(top, '畫在那一段的上面').toBeLessThan(slotTop);
  await page.locator('[data-card-close]').click();

  await page.locator('[data-open^="visit:v-b:"]').first().click();
  await app.layer('.popcard .taskmirror');
  await expect(page.locator('.popcard'), '開的是客戶B').toContainText('14:00');
  await expect(page.locator('.popcard .readalerts'), '沒有警示：一個像素都不佔').toHaveCount(0);
});

test('A2 待辦中心「詳情」與進度追蹤：同一張卡，同一排警示', async ({ app, page }) => {
  await app.seed(seedAlerts());
  await app.signIn('/todo/Examine');

  await page.locator('[data-visit="v-a"]').first().click();
  await expect(page.locator('.popcard .readalerts'), '待辦中心').toContainText('體內金屬');
  await page.locator('[data-card-close]').click();

  await app.go('/customers/progress');
  await page.locator('button.progslot[data-visit="v-a"]').first().click();
  await expect(page.locator('.popcard .readalerts'), '進度追蹤').toContainText('體內金屬');
  await page.locator('[data-card-close]').click();

  await app.go('/customers/cust-a');
  await page.locator('button.progslot[data-visit="v-a"]').first().click();
  await expect(page.locator('.popcard .readalerts'), '客戶詳情').toContainText('體內金屬');
});

// ---------- 07 刪掉的客戶不留在壓表牆上 ----------

const MONTH = TODAY.slice(0, 7);

/** 三位都有一筆還有剩的額度，所以開批時三位都在牆上。 */
function seedWall(over = {}) {
  const one = (id, name) => [
    customer({ id, name, ...(over[id] ?? {}) }),
    entitlement(id, { id: `ent-${id}`, label: 'ILIB(60)', courseId: 'course-iv-laser', totalQty: 10 }),
  ];
  return [...masterDocs(), ...one('cust-a', '客戶A'), ...one('cust-b', '客戶B'), ...one('cust-c', '客戶C')];
}

const wallIds = (page) => page.locator('[data-wall] [data-pick]')
  .evaluateAll((nodes) => nodes.map((n) => n.dataset.pick));

async function openMonth(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await app.layer('[data-wall] [data-pick]');
}

test('W1 壓表：開批之後刪掉一位，牆上沒有他、分母少一；還原之後回到原本的位置', async ({ app, page }) => {
  await app.seed(seedWall());
  await app.signIn('/');
  await openMonth(app, page);

  const before = await wallIds(page);
  expect(before, '開批時三位都在').toHaveLength(3);
  await expect(page.locator('.page__lead')).toContainText('已壓 0 / 3 位');

  // 她把誤建的那一位刪掉（軟刪除：`deletedAt` 有值）
  await app.seed([customer({ id: 'cust-b', name: '客戶B', deletedAt: new Date(`${TODAY}T10:00:00+08:00`) })]);
  await app.go('/');
  await openMonth(app, page);

  expect(await wallIds(page), '牆上沒有客戶B，其餘順序照舊').toEqual(before.filter((id) => id !== 'cust-b'));
  await expect(page.locator('.page__lead'), '分母跟著少一').toContainText('已壓 0 / 2 位');
  // 篩選丸子上的數字也是牆上的人數
  await expect(page.locator('[data-filter="all"]')).toContainText('2');
  // 存下來的那一份名單沒有被改：他的 id 還在原本的位置
  const [batch] = (await app.readAll('batches')).filter((b) => !b.deletedAt);
  expect(batch.queue.map((q) => q.customerId), '存在資料庫裡的名單一筆都不少').toEqual(before);

  // 從「已刪除項目」還原
  await app.seed([customer({ id: 'cust-b', name: '客戶B' })]);
  await app.go('/');
  await openMonth(app, page);
  expect(await wallIds(page), '還原之後回到原本的位置').toEqual(before);
  await expect(page.locator('.page__lead')).toContainText('已壓 0 / 3 位');
});

test('W2 壓表：正開著那一位的卡片時他被刪了 →「加這一段」不會存進去，講一句', async ({ app, page }) => {
  await app.seed(seedWall());
  await app.signIn('/');
  await openMonth(app, page);

  await page.locator('[data-pick="cust-b"]').first().click();
  await app.layer('[data-deck] [data-day]');
  const day = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;
  await page.locator(`[data-deck] [data-day="${day}"]`).first().click();
  await app.layer('[data-ent]');
  await page.locator('[data-ent="ent-cust-b"]').click();
  await page.locator('[data-time]').first().click();

  // 另一台裝置在這時候把他刪了
  await app.seed([customer({ id: 'cust-b', name: '客戶B', deletedAt: new Date(`${TODAY}T10:00:00+08:00`) })]);
  await page.locator('[data-add]').click();

  await expect(page.locator('#toast')).toContainText('已經被刪掉了');
  await expect(page.locator('[data-deck]'), '那一疊收掉').toHaveCount(0);
  await app.settled();
  expect(await wallIds(page), '牆上也沒有他了').not.toContain('cust-b');
  expect((await app.readAll('visits')).filter((v) => !v.deletedAt), '一筆來訪都沒有建').toHaveLength(0);
});
