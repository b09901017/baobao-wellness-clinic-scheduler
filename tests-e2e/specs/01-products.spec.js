// Journey E：營養品（一次購買 = 一個金額 + 好幾款 + 幾個月）
//
// 重點在「四個勾隨手記的入口是不是真的共用同一份」。
// `ui/components/note.js` 的檔頭自己寫著：
//   「四邊各寫一次的話遲早有一邊只勾不記，而少掉的那一筆紀錄要到她對帳時才會被發現」

import { test, expect } from '../fixtures/app.js';
import {
  scenarioProducts, masterDocs, customer, entitlement, visit, slot,
  TODAY, addDays,
} from '../fixtures/data.js';

const GIVE_DATE = addDays(TODAY, 2);

test('J-E1 營養品在客戶詳情上自成一段，不混進額度卡', async ({ app }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/customers/cust-c');

  const body = await app.text();
  // 金額進名字裡（她的舊表就是那樣寫的）
  expect(body).toMatch(/5,?000/);
  expect(body).toContain('夜態美');
  expect(body).toContain('還沒給');
});

test('J-E7 營養品不流進「還要排幾次」', async ({ app }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/customers');

  const list = await app.text();
  // 客戶總覽那一列寫的是「剩 N 次」。客戶C 只有復能 10 次排得進來訪，
  // 營養品那 2 個月不可以被加進去。
  expect(list, '營養品的月數不可以出現在剩餘次數裡').not.toMatch(/剩\s*12/);
});

test('J-E3 有日期的提醒會出現在日曆的「待辦」那一類', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/calendar');

  // 月檢視上那一天要有一條待辦
  await expect(page.locator('#view')).toContainText('待辦');
  const body = await app.text();
  expect(body).toContain('給客戶C營養品');
});

test('J-E4 從首頁那張卡勾掉 → 會問「給了哪些」，而且寫進 deliveries[]', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/');

  await page.locator('[data-note="note-c-give"]').first().click();

  // 問話面板要出現
  await expect(page.locator('[data-sheet-title]')).toContainText('給了什麼');
  await expect(page.locator('[data-give]')).toHaveCount(4);

  // 預設全部打勾 → 直接按「都給了，記起來」
  await page.locator('[data-give-ok]').click();
  await app.saved();

  const ent = await app.readDoc('customers/cust-c/entitlements', 'ent-c-prod');
  expect(ent.deliveries, '交付要寫進額度').toHaveLength(1);
  expect(ent.deliveries[0].productIds).toHaveLength(4);

  const note = await app.readDoc('notes', 'note-c-give');
  expect(note.done, '四款都給完了，提醒才勾掉').toBe(true);
});

test('J-E5 只給一部分 → 提醒不勾掉，文字換成剩下的那幾款', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/');

  await page.locator('[data-note="note-c-give"]').first().click();
  await expect(page.locator('[data-sheet-title]')).toContainText('給了什麼');

  // 點掉兩款（切成「沒給」）
  await page.locator('[data-give="prod-linengkang"]').click();
  await page.locator('[data-give="prod-gaba"]').click();
  await page.locator('[data-give-ok]').click();
  await app.saved();

  const ent = await app.readDoc('customers/cust-c/entitlements', 'ent-c-prod');
  expect(ent.deliveries[0].productIds).toHaveLength(2);

  const note = await app.readDoc('notes', 'note-c-give');
  expect(note.done, '沒給完就留著那筆提醒').toBe(false);
  expect(note.text, '文字要換成剩下的那幾款').toContain('粒能康');
  expect(note.text).toContain('GABA');
  expect(note.text, '已經給掉的不該還留在提醒上').not.toContain('夜態美');
  expect(note.date, '日期不動 —— 它不是死線').toBe(GIVE_DATE);
});

test('J-E4b 從客戶詳情勾掉 → 一樣會問', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/customers/cust-c');

  await page.locator('[data-note="note-c-give"]').first().click();
  await expect(page.locator('[data-sheet-title]')).toContainText('給了什麼');
});

// ---------------------------------------------------------------------------
// 這一支是第一階段靜態讀程式碼時發現的，現在用真的點擊證明它。
//
// `ui/views/home.js` 的 `tickNote()`（`#/todo/notes` 那一頁）直接呼叫
// `notesData.setDone()`，繞過了 `note.prepareToggle()`。
// 另外三個入口（首頁卡、客戶詳情、日曆待辦卡）都有接。
//
// 2026-08-30 修好了（`tickNote()` 改走 `note.prepareToggle()`）。這一支從
// 「證明它壞了」變成守著它不要再壞，所以多了**按下確認**那一步 ——
// 原本沒按就去讀 `deliveries`，那是在問一件還沒發生的事：面板是刻意等她
// 回答的，沒回答就什麼都不寫（見 `note.js` 的 `prepareToggle()`）。
// ---------------------------------------------------------------------------
test('J-E6 🔴 從 #/todo/notes 勾掉營養品提醒，不會問「給了哪些」，交付紀錄整筆消失', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/todo/notes');

  await expect(page.locator('[data-note="note-c-give"]')).toBeVisible();
  await page.locator('[data-note="note-c-give"]').click();
  // 那張問話面板出來了才問得下去。以前它不出現就是這一支要抓的 bug，
  // 所以這裡等的是**面板**，不是一段秒數。
  await app.layer('[data-give-ok]');

  // 第一件事：這一頁到底有沒有問。以前它直接寫進去，面板根本不會出現。
  const asked = await page.locator('[data-give-ok]').count();
  console.log('[J-E6] 有沒有問「給了哪些」=', asked > 0);
  expect(asked, '應該要跟另外三個入口一樣先問「給了哪些」').toBeGreaterThan(0);

  // 第二件事：答完之後那筆紀錄真的進得去。逐項預設全部打勾，
  // 所以直接按「都給了，記起來」就好 —— 跟 J-E4 走同一條路。
  await page.locator('[data-give-ok]').click();
  await app.saved();

  const ent = await app.readDoc('customers/cust-c/entitlements', 'ent-c-prod');
  const note = await app.readDoc('notes', 'note-c-give');

  console.log('[J-E6] deliveries =', JSON.stringify(ent.deliveries));
  console.log('[J-E6] note.done =', note.done);

  expect(ent.deliveries, '交付紀錄要寫進額度（那是要進試算表的東西）').toHaveLength(1);
  expect(ent.deliveries[0].productIds).toHaveLength(4);
  expect(note.done, '四款都給完了，提醒才勾掉').toBe(true);
});

// ---------------------------------------------------------------------------
// 第二個靜態發現：日曆上的待辦卡片，部分交付之後樂觀更新會說謊。
// `recordDelivery()` 在沒給完時刻意保留 done:false，
// 但 `calendar.js` 直接 `next = { ...current, done: !current.done }`。
// ---------------------------------------------------------------------------
test('J-E9 🟡 日曆待辦卡：只給一部分，卡片卻說已經勾掉了', async ({ app, page }) => {
  await app.seed(scenarioProducts());
  await app.signIn('/calendar');

  // 點那一天 → 底部滑出 → 點那一筆待辦 → 浮出讀取卡片
  await page.locator(`[data-day="${GIVE_DATE}"]`).first().click();
  await app.layer('[data-open^="note:"]');
  await page.locator('[data-open^="note:"]').first().click();
  await app.layer('.popcard');

  await expect(page.locator('[data-tick]')).toContainText('做完了，勾掉');
  await page.locator('[data-tick]').click();

  // 問話面板：點掉一款再確認
  await expect(page.locator('[data-sheet-title]')).toContainText('給了什麼');
  await page.locator('[data-give="prod-gaba"]').click();
  await page.locator('[data-give-ok]').click();
  await app.saved();

  const note = await app.readDoc('notes', 'note-c-give');
  expect(note.done, '資料庫：沒給完就不勾掉').toBe(false);

  // 畫面應該跟資料庫講同一件事（SPEC 6.9：樂觀更新要誠實）
  const label = await page.locator('[data-tick]').innerText().catch(() => '(卡片關了)');
  console.log('[J-E9] 資料庫 done =', note.done, '／卡片上的按鈕寫著 =', label);
  expect(label, '卡片不該說它已經勾掉了').toContain('做完了，勾掉');
});


// ---------------------------------------------------------------------------
// 營養點滴的品項（不是營養品）。issue 04，2026-09-04。
//
// 她問的：「我營養點滴如果一開始加購的是 A，但是我排來訪的時候，選營養點滴
// 還能排到其他 BCD？這不太對吧。」
//
// 品項是**購買的時候就定下來的**（存在額度身上）。所以排班的時候預設就是那一款，
// 其餘的收在「換一款」後面 —— 不是不給選：「今天 A 剛好用完，先打了 B」
// 是真的會發生的事（ADR-0002）。
// ---------------------------------------------------------------------------

const DRIP_DAY = addDays(TODAY, 3);
const DRIP_MONTH = DRIP_DAY.slice(0, 7);

/** 一位買了「營養點滴・護肝排毒」的客戶I。 */
function seedDrip() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-i', name: '客戶I' }),
    entitlement('cust-i', {
      id: 'ent-i-drip', label: '營養點滴・護肝排毒', type: 'single',
      courseId: 'course-iv-drip', totalQty: 6, durationMin: 60,
      ivProductId: 'iv-liver',
    }),
  ];
}

test('J-E10 壓表時品項預設就是她買的那一款，其餘要按「換一款」才看得到', async ({ app, page }) => {
  await app.seed(seedDrip());
  await app.signIn('/');

  await app.go('/schedule');
  await page.locator(`[data-month="${DRIP_MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-i"]').first().click();
  await app.layer(`[data-day="${DRIP_DAY}"]`);

  await page.locator(`[data-day="${DRIP_DAY}"]`).first().click();
  await app.layer('[data-ent="ent-i-drip"]');
  await page.locator('[data-ent="ent-i-drip"]').click();
  // 選了額度之後那一排品項丸子才長出來。**壓表這一側是 `[data-ivproduct]`**，
  // 來訪編輯器那一側才是 `[data-chip="s0-iv"]`（J-E11）—— 同一件事兩個入口
  // 兩種寫法，等錯一個不存在的選擇器就是跑滿 15 秒再紅在無關的那一句上。
  await app.layer('[data-ivproduct]');

  // 買的那一款已經選好了
  await expect(page.locator('[data-ivproduct="iv-liver"]'))
    .toHaveAttribute('aria-pressed', 'true');

  // 其餘六款都收起來（在 DOM 裡，但看不到）
  await expect(page.locator('[data-ivproduct="iv-heart"]')).not.toBeVisible();
  await expect(page.locator('[data-chip-more]')).toBeVisible();

  // 按下去才長出來
  await page.locator('[data-chip-more]').click();
  await expect(page.locator('[data-ivproduct="iv-heart"]')).toBeVisible();
  await expect(page.locator('[data-chip-more]')).not.toBeVisible();
});

test('J-E11 真的換一款存得下去，但那一段會說「跟買的不一樣」', async ({ app, page }) => {
  await app.seed([
    ...seedDrip(),
    visit({
      id: 'v-i-drip', customerId: 'cust-i', customerName: '客戶I',
      date: DRIP_DAY, status: 'pending_confirm',
      slots: [slot({
        courseId: 'course-iv-drip', entitlementId: 'ent-i-drip',
        startsAt: '10:00', endsAt: '11:00', roomId: 'room-iv8', bed: 'A',
        ivProductId: 'iv-liver',
      })],
    }),
  ]);
  await app.signIn('/visits/v-i-drip');

  // 換成別款
  await page.locator('[data-chip-more]').click();
  await page.locator('[data-chip="s0-iv"][data-chip-value="iv-heart"]').click();
  await expect(
    page.locator('[data-chip="s0-iv"][data-chip-value="iv-heart"]'),
    '換一款＝那顆丸子被按下去（壓表不重畫整頁，只換 aria-pressed，ADR-0038）',
  ).toHaveAttribute('aria-pressed', 'true');

  // **那一句提醒 2026-09-09 從表單上方搬到存檔前那一道**（ADR-0086）——
  // 她的原話是「所以新增來訪的這個表單最上面就不需要還有一個提醒了」。
  await expect(page.locator('#view'), '表單上不再常駐提醒').not.toContainText('跟買的不一樣');

  await page.locator('button[type="submit"]').first().click();
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText(), '那一句要在第一道裡').toContain('跟買的不一樣');

  // **存得下去** —— 這不是錯誤，是一句提醒
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-i-drip');
  expect(saved.slots[0].ivProductId, '她的決定要記得下來').toBe('iv-heart');
});
