// 待辦中心「依客戶」那張原地展開的抽屜。
//
// 2026-09-02 以前那一列是 `<a href="#/customers/:id">`，點下去會離開待辦中心。
// 她的原話是「打斷批次處理待辦事項的操作節奏」——處理一位客戶要五步，
// 而且回來之後「依客戶」那個看法還會掉回「總覽」。
//
// 這一支盯四件事，四件都是「看起來對、其實不對」的那一種：
//
//   1. 點下去**網址不變**（換頁的話這一整輪就白做了）
//   2. 抽屜裡勾一筆 → 底下那張卡片的數字跟著減（樂觀更新有沒有接到底層）
//   3. 勾掉「追蹤健檢報告」→ 抽屜裡**當場多一張「約二返」**（ADR-0042 的鏈條）
//   4. 那顆數字＝任務＋跟客人確認時間＋簽療程單（她 2026-09-02 決定的三種相加）

import { test, expect } from '../fixtures/app.js';
import { FIRESTORE_ORIGIN } from '../fixtures/emulator.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY, addDays,
} from '../fixtures/data.js';

const EXAM_DATE = addDays(TODAY, -3);

/**
 * 一位身上三種都有的客戶：
 *   兩張任務（Examine、耀聖）＋ 一筆待確認的來訪 ＋ 一筆日子到了還沒結案的來訪
 * 所以「依客戶」那一列的數字應該是 4。
 */
function seedMixed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-rehab', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['equip-indiba', 'equip-magnet', 'equip-laser'],
      bookedCount: 2,
    }),

    // ① 待確認：待辦中心「跟客人確認時間」那一列
    visit({
      id: 'visit-a-pending', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, 5), status: 'pending_confirm',
      slots: [slot({
        courseId: 'course-rehab', entitlementId: 'ent-a-rehab',
        startsAt: '10:30', endsAt: '11:30', equipmentId: 'equip-indiba',
        therapistId: 'staff-t1',
      })],
    }),

    // ② 日子到了還沒結案：「簽療程單」那一列
    visit({
      id: 'visit-a-toclose', customerId: 'cust-a', customerName: '客戶A',
      date: addDays(TODAY, -1), status: 'confirmed',
      slots: [slot({
        courseId: 'course-rehab', entitlementId: 'ent-a-rehab',
        startsAt: '14:00', endsAt: '15:00', equipmentId: 'equip-indiba',
        therapistId: 'staff-t1',
      })],
    }),

    // ③ 兩張真的勾得掉的任務
    task({
      id: 'task-a-examine', customerId: 'cust-a', customerName: '客戶A',
      kind: 'Examine', dueDate: addDays(TODAY, 4), visitId: 'visit-a-pending',
    }),
    task({
      id: 'task-a-yaosheng', customerId: 'cust-a', customerName: '客戶A',
      kind: '耀聖', dueDate: addDays(TODAY, 4), visitId: 'visit-a-pending',
    }),
  ];
}

/** 「依客戶」那一格。切換不進網址，所以每次都要自己點。 */
async function openByCustomer(app, page) {
  await app.go('/');
  await page.locator('[data-tab="who"]').click();
  await expect(page.locator('[data-tab="who"]')).toHaveAttribute('aria-pressed', 'true');
}

const drawer = (page) => page.locator('.drawer-backdrop .drawer');

test('D1 點一位客戶：原地展開抽屜，網址一個字都不變', async ({ app, page }) => {
  await app.seed(seedMixed());
  await app.signIn('/');
  await openByCustomer(app, page);

  const before = page.url();
  await page.locator('[data-who="cust-a"]').click();
  await expect(drawer(page)).toBeVisible();

  expect(page.url(), '抽屜不是一個新的位置 —— 換頁的話這一輪就白做了').toBe(before);
  await expect(drawer(page)).toContainText('客戶A');
  await expect(drawer(page)).toContainText('Examine');
  await expect(drawer(page)).toContainText('耀聖');
});

test('D2 那顆數字是三種相加：任務＋跟客人確認時間＋簽療程單', async ({ app, page }) => {
  await app.seed(seedMixed());
  await app.signIn('/');
  await openByCustomer(app, page);

  // 2 張任務 + 1 筆待確認 + 1 筆待結案
  await expect(page.locator('[data-who="cust-a"] .badge')).toHaveText('4');

  await page.locator('[data-who="cust-a"]').click();
  await expect(drawer(page)).toBeVisible();

  // 清單要對得起那顆數字 —— 兩種「要去別的地方做的」也要在抽屜裡看得到
  await expect(drawer(page)).toContainText('跟客人確認時間');
  await expect(drawer(page)).toContainText('簽療程單');

  // 但它們**不是勾選框**：抽屜裡勾得掉的只有那兩張任務
  await expect(drawer(page).locator('[data-task]')).toHaveCount(2);
});

test('D3 抽屜裡勾一筆 → 那一列劃掉，底下那張卡片的數字跟著減', async ({ app, page }) => {
  await app.seed(seedMixed());
  await app.signIn('/');
  await openByCustomer(app, page);
  await page.locator('[data-who="cust-a"]').click();
  await expect(drawer(page)).toBeVisible();

  await drawer(page).locator('[data-task="task-a-examine"]').click();

  // 勾掉的**不會消失** —— 她會勾錯，看得到才點得回來
  await expect(drawer(page).locator('[data-task="task-a-examine"]'))
    .toHaveClass(/note--done/);
  await app.saved();

  // 底層跟著更新：4 → 3
  await expect(page.locator('[data-who="cust-a"] .badge')).toHaveText('3');

  const saved = await app.readDoc('tasks', 'task-a-examine');
  expect(saved.done, '不是只有畫面動 —— 資料庫也要寫進去').toBe(true);
  expect(saved.doneAt, '勾掉的時間要記下來（「今天做了什麼」照它分組）').toBeTruthy();

  // 點回來
  await drawer(page).locator('[data-task="task-a-examine"]').click();
  await app.saved();
  await expect(page.locator('[data-who="cust-a"] .badge')).toHaveText('4');
  expect((await app.readDoc('tasks', 'task-a-examine')).done).toBe(false);
});

/**
 * 這一條是這支測試存在的主要理由。
 *
 * `data/tasks.js` 的 `setDone()` 勾掉「追蹤健檢報告」時，會把「約二返」
 * 寫在**同一個 commit** 裡（ADR-0042）。所以那一種勾完之後這個人身上的事
 * 是「少一件又多一件」—— 就地更新只會看到少一件，關掉抽屜再打開又變回來，
 * 而那個形狀她會以為系統壞了。
 */
test('D4 勾掉「追蹤健檢報告」→ 抽屜裡當場多一張「約二返」', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-b', {
      id: 'ent-b-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 1, doneCount: 1, bookedCount: 0, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-b', {
      id: 'ent-b-followup', label: '二返（8萬健檢）', type: 'single',
      courseId: 'course-followup', totalQty: 1, doneCount: 0, bookedCount: 0,
      followupForEntitlementId: 'ent-b-exam', durationMin: 30,
    }),
    visit({
      id: 'visit-b-exam', customerId: 'cust-b', customerName: '客戶B',
      date: EXAM_DATE, status: 'done',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-b-exam',
        startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3', attended: true,
      })],
    }),
    task({
      id: 'task-b-report', customerId: 'cust-b', customerName: '客戶B',
      kind: '追蹤健檢報告', dueDate: addDays(EXAM_DATE, 21), visitId: 'visit-b-exam',
    }),
  ]);
  await app.signIn('/');
  await openByCustomer(app, page);
  await page.locator('[data-who="cust-b"]').click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page)).toContainText('追蹤健檢報告');

  await drawer(page).locator('[data-task="task-b-report"]').click();
  await app.saved();

  // **同一張抽屜裡**看得到下一站，不用關掉再打開
  await expect(drawer(page)).toContainText('約二返');
  await expect(drawer(page).locator('[data-task="task-b-report"]'))
    .toHaveClass(/note--done/);

  const tasks = await app.readAll('tasks');
  const booking = tasks.find((t) => t.kind === '約二返' && !t.deletedAt);
  expect(booking, '勾掉報告的那一刻就要長出「約二返」').toBeTruthy();
  expect(booking.dueDate, '死線 = 勾掉那天 + 7').toBe(addDays(TODAY, 7));
});

/**
 * 2026-11-04 雲端 VM 上 D3、D4 怎樣都紅（CI 綠）：抽屜**第一次**掛上的那一下，勾選框沒有接上點擊 ——
 * `openSheet()` 在回傳之前就叫 `onMount`，那時候 `whoDrawer.sheet` 還是 null，接線的那一支直接 return；
 * 要等「那一天・哪一場」那幾份讀回來、重畫一次才接上。抽屜滑進來要 340ms，讀得比這慢（VM 上的模擬器、
 * 訊號差的手機）她點下去的那一下就被吃掉；那幾份讀失敗的話整張抽屜一直勾不掉。
 * 這一支把那幾份扣住，抽屜一停好就勾。
 */
test('D6 抽屜剛打開、那幾列的細節還沒讀回來就勾 → 照樣劃掉、寫得進去', async ({ app, page }) => {
  await app.seed(seedMixed());
  await app.signIn('/');
  await openByCustomer(app, page);

  // 雲端扣著：抽屜打開時去讀的那幾份（那一天、診間、人員、課程…）回不來，勾下去之後才放
  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(`${FIRESTORE_ORIGIN}/**`, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });

  await page.locator('[data-who="cust-a"]').click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page).locator('[data-task="task-a-examine"]').click();
  await expect(drawer(page).locator('[data-task="task-a-examine"]'), '畫面先動（樂觀更新）')
    .toHaveClass(/note--done/);

  release();
  await app.saved();
  await page.unroute(`${FIRESTORE_ORIGIN}/**`);
  await expect(drawer(page).locator('[data-task="task-a-examine"]'), '細節讀回來重畫之後還是劃掉的')
    .toHaveClass(/note--done/);
  expect((await app.readDoc('tasks', 'task-a-examine')).done, '資料庫也寫進去').toBe(true);
});

/**
 * 同一個時機的另一顆：「詳情」。29 的 S2、S2b 在忙的 VM 上紅的就是這一下（點下去沒有反應）。
 * 接上點擊之後，那一天還沒讀回來時以前講「還在讀，等一下再按一次」—— 任務那一頁早就改成先等它（issue 11），抽屜沒跟上。
 */
test('D7 抽屜剛打開、那一天還沒讀回來就按「詳情」→ 讀回來就打開那一天，不叫她再按一次', async ({ app, page }) => {
  await app.seed(seedMixed());
  await app.signIn('/');
  await openByCustomer(app, page);

  let release;
  const gate = new Promise((r) => { release = r; });
  await page.route(`${FIRESTORE_ORIGIN}/**`, async (route) => {
    await gate;
    await route.continue().catch(() => {});
  });

  await page.locator('[data-who="cust-a"]').click();
  await expect(drawer(page)).toBeVisible();
  await drawer(page).locator('[data-task-visit="visit-a-pending"]').first().click();
  release();
  await app.layer('.popcard');
  await page.unroute(`${FIRESTORE_ORIGIN}/**`);
  await expect(page.locator('.popcard')).toContainText('客戶A');
  await expect(page.locator('#toast'), '不叫她再按一次').not.toContainText('再按一次');
});

test('D5 抽屜吃返回鍵：關掉的是抽屜，不是這一頁', async ({ app, page }) => {
  await app.seed(seedMixed());
  await app.signIn('/');
  await openByCustomer(app, page);

  await page.locator('[data-who="cust-a"]').click();
  await expect(drawer(page)).toBeVisible();

  await page.goBack();

  await expect(drawer(page)).toHaveCount(0);
  // 還在待辦中心，而且還在「依客戶」那一格
  await expect(page.locator('[data-tab="who"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-who="cust-a"]')).toBeVisible();
});
