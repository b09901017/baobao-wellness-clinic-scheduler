// 三返、四返……n返。
//
// 她的原話：「和二返一樣，就是健檢完後會約客戶來聽醫生講解報告……
// 不一樣的點是……三返,四返...n返他不常發生，通常是客戶要求，他聽不懂
// 或是想再聽一遍我才會預約……**這個 n返 不需要先加購才能有**，
// 而是只要有健檢的就可以選，但他也沒有次數限制」。
//
// 這一支從 UI 走一遍真的動線，盯四件事：
//
//   1. 壓表那一頁選得到「n返」，而且**存得下去**（時段沒有額度）
//   2. 存完之後**客戶身上的次數一個都沒有變** —— 她最會擔心的那件事
//   3. 二返那一條鏈**一個字都沒有被動到**
//   4. 日曆、客戶詳情、試算表三個地方都看得到它

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const MONTH = '2026-09';
const PICK_DAY = '2026-09-14';
const EXAM_DATE = addDays(TODAY, -10);   // 2026-08-19

/**
 * 一位做完一次健檢、二返也已經約好的客戶。
 * 這正是她會想加約三返的狀態：報告聽過了，客人說沒聽懂。
 *
 * **身上還留著復能的次數**，所以他會出現在壓表的卡片牆上。
 * 一位什麼都用完的客戶不會在那面牆上（`buildCustomerQueue()` 的
 * `totalRemaining <= 0` 那一道，ADR-0014：那面牆答的是「這個月還有誰要排」），
 * 而那種情況走日曆 —— N7 盯的就是那一條。
 */
function seedAfterSecond(extra = []) {
  return [
    ...masterDocs(),
    customer({ id: 'cust-n', name: '客戶N' }),
    entitlement('cust-n', {
      id: 'ent-n-rehab', label: '復能', type: 'pool', totalQty: 12, doneCount: 3,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    entitlement('cust-n', {
      id: 'ent-n-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 1, doneCount: 1, bookedCount: 0, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-n', {
      id: 'ent-n-2nd', label: '二返（8萬健檢）', type: 'single',
      courseId: 'course-followup', totalQty: 1, doneCount: 1, bookedCount: 0,
      followupForEntitlementId: 'ent-n-exam', durationMin: 30,
    }),
    visit({
      id: 'v-n-exam', customerId: 'cust-n', customerName: '客戶N',
      date: EXAM_DATE, status: 'done',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-n-exam',
        startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3', attended: true,
      })],
    }),
    visit({
      id: 'v-n-2nd', customerId: 'cust-n', customerName: '客戶N',
      date: addDays(EXAM_DATE, 5), status: 'done',
      slots: [slot({
        courseId: 'course-followup', entitlementId: 'ent-n-2nd',
        startsAt: '14:00', endsAt: '14:30', roomId: 'room-t3',
        doctorId: 'staff-dr-xia', followupForVisitId: 'v-n-exam', attended: true,
      })],
    }),
    ...extra,
  ];
}

/** 開一批九月的壓表，點開客戶N 的記錄面板。 */
async function openDeck(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await page.locator('[data-start]').click();
  await app.settled();
  await page.locator('[data-pick="cust-n"]').first().click();
  await page.waitForTimeout(600);
}

test('N1 壓表：「＋ n返」選得到，預設是三返，而且存得下去', async ({ app, page }) => {
  await app.seed(seedAfterSecond());
  await app.signIn('/');
  await openDeck(app, page);

  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(400);

  // 那一顆在「做什麼」那一排的最後面，而且寫著「不扣次數」
  const chip = page.locator('[data-ent="__nth__"]');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('不扣次數');

  await chip.click();
  await page.waitForTimeout(300);

  // 只有一次健檢 → 那一次自動選好，返數預設三返（二返算 2）
  await expect(page.locator('[data-nth="3"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-exam="v-n-exam"]')).toHaveAttribute('aria-pressed', 'true');
  // 那一次健檢底下已經有二返了，要標出來
  await expect(page.locator('[data-exam="v-n-exam"]')).toContainText('二返');

  await page.locator('[data-time]').first().click();
  await page.locator('[data-doctor="staff-dr-li"]').click();
  await page.locator('[data-add]').click();

  // 存檔前那一句是她最會擔心的事
  await expect(app.dialog()).toBeVisible();
  const dialog = await app.dialogText();
  expect(dialog, '三返是加約的 —— 這一句一定要講').toContain('不扣任何次數');
  await app.ok();
  await page.waitForTimeout(2500);

  // ---- 存進去的形狀 ----
  const saved = (await app.readAll('visits'))
    .find((v) => v.date === PICK_DAY && !v.deletedAt);
  expect(saved, '那一筆來訪要存得進去').toBeTruthy();

  const s = saved.slots[0];
  expect(s.entitlementId, '**n返 排不進任何額度**').toBe(null);
  expect(s.followupNth).toBe(3);
  expect(s.followupForVisitId).toBe('v-n-exam');
  expect(s.courseName, '畫面上要看得到「三返」').toBe('三返');
  expect(s.courseId, '借二返那個課程 —— 掛號待辦、免簽單、選醫師都靠它').toBe('course-followup');
  expect(s.doctorId).toBe('staff-dr-li');
});

test('N2 **次數一個都沒有變**，二返那一條鏈也沒被動到', async ({ app, page }) => {
  await app.seed(seedAfterSecond());
  await app.signIn('/');
  await openDeck(app, page);

  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-ent="__nth__"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-time]').first().click();
  await page.locator('[data-add]').click();
  await app.ok();
  await page.waitForTimeout(2500);

  const exam = await app.readDoc('customers/cust-n/entitlements', 'ent-n-exam');
  const second = await app.readDoc('customers/cust-n/entitlements', 'ent-n-2nd');

  expect({ done: exam.doneCount, booked: exam.bookedCount }, '健檢那一筆')
    .toEqual({ done: 1, booked: 0 });
  expect({ done: second.doneCount, booked: second.bookedCount }, '**二返那一筆一次都沒有被多扣**')
    .toEqual({ done: 1, booked: 0 });

  // 二返已經約掉了，所以不該有任何「約二返」的待辦冒出來
  const tasks = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
  expect(tasks.filter((t) => t.kind === '約二返')).toHaveLength(0);
});

test('N3 客戶詳情：三返接在健檢那張卡底下，而且那一排額度沒有多一張卡', async ({ app, page }) => {
  await app.seed(seedAfterSecond([
    visit({
      id: 'v-n-3rd', customerId: 'cust-n', customerName: '客戶N',
      date: '2026-09-20', status: 'confirmed',
      slots: [slot({
        courseId: 'course-followup', entitlementId: null, followupNth: 3,
        startsAt: '15:00', endsAt: '15:30', roomId: 'room-t3',
        doctorId: 'staff-dr-li', followupForVisitId: 'v-n-exam',
      })],
    }),
  ]));
  await app.signIn('/customers/cust-n');

  const body = await app.text();
  expect(body, '加約的那一行接在健檢那張卡底下').toContain('加約');
  expect(body).toContain('三返');
  expect(body, '來訪紀錄那一列也要看得到').toMatch(/9\/20/);

  // n返 沒有額度，所以它不會長成一張額度卡（那一排每一張都寫著「剩 N」）
  expect(body, 'n返 不可以長成一張額度卡 —— 它沒有次數').not.toMatch(/三返.{0,12}剩 \d/);
});

test('N4 日曆上看得到「三返」', async ({ app, page }) => {
  // **日期要落在月檢視畫得出來的那六週裡。** 今天是 8/29，八月那一格
  // 從 7/27 排到 9/6 —— 2026-09-20 那一天根本沒有 `[data-day]` 可以點，
  // 而症狀是那一下靜靜地什麼都沒開。
  const NTH_DAY = addDays(TODAY, 2);
  await app.seed(seedAfterSecond([
    visit({
      id: 'v-n-3rd', customerId: 'cust-n', customerName: '客戶N',
      date: NTH_DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-followup', entitlementId: null, followupNth: 3,
        startsAt: '15:00', endsAt: '15:30', roomId: 'room-t3',
        doctorId: 'staff-dr-li', followupForVisitId: 'v-n-exam',
      })],
    }),
  ]));
  await app.signIn('/calendar');
  await page.waitForTimeout(500);

  await page.locator(`[data-day="${NTH_DAY}"]`).first().click();
  await page.waitForTimeout(600);
  // n返 借二返那個課程，所以名字**只在快照上** —— 讀主檔的話這一列會寫「二返」，
  // 而同一位客戶同一天有二返又有三返時兩列會長得一模一樣。
  await expect(page.locator('body')).toContainText('三返');
});

test('N5 一位**沒有做完健檢**的客戶，那一顆丸子整顆不出現', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-x', name: '客戶X' }),
    entitlement('cust-x', {
      id: 'ent-x', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await page.locator('[data-start]').click();
  await app.settled();
  await page.locator('[data-pick="cust-x"]').first().click();
  await page.waitForTimeout(600);
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(400);

  // 畫成 disabled 的話她每次都會試一下 —— 整顆不畫
  await expect(page.locator('[data-ent="__nth__"]')).toHaveCount(0);
});

test('N6 加第二場：預設變成四返', async ({ app, page }) => {
  await app.seed(seedAfterSecond([
    visit({
      id: 'v-n-3rd', customerId: 'cust-n', customerName: '客戶N',
      date: '2026-09-05', status: 'confirmed',
      slots: [slot({
        courseId: 'course-followup', entitlementId: null, followupNth: 3,
        startsAt: '15:00', endsAt: '15:30', roomId: 'room-t3',
        doctorId: 'staff-dr-li', followupForVisitId: 'v-n-exam',
      })],
    }),
  ]));
  await app.signIn('/');
  await openDeck(app, page);
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-ent="__nth__"]').click();
  await page.waitForTimeout(300);

  await expect(page.locator('[data-nth="4"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('[data-exam="v-n-exam"]'), '已經有二返與三返了')
    .toContainText('三返');
});

/**
 * **一位什麼次數都用完的客戶，走日曆這一條路。**
 *
 * 壓表的卡片牆答的是「這個月還有誰要排」（ADR-0014），所以身上沒有剩餘次數的
 * 客戶不在上面 —— 那是對的，不該為了 n返 把整面牆灌滿已經結案的人
 *（`bookGroupRow()` 為了同一件事把數字整個拿掉過）。
 *
 * 而她真的會遇到這種情況：客人整套上完了，回來說報告沒聽懂。
 * 那時候的入口是日曆 —— 跟排任何一場來訪一樣（ADR-0056）。
 */
test('N7 什麼都用完的客戶：日曆上照樣加得了三返', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-u', name: '客戶U' }),
    entitlement('cust-u', {
      id: 'ent-u-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 1, doneCount: 1, bookedCount: 0, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-u', {
      id: 'ent-u-2nd', label: '二返（8萬健檢）', type: 'single',
      courseId: 'course-followup', totalQty: 1, doneCount: 1, bookedCount: 0,
      followupForEntitlementId: 'ent-u-exam', durationMin: 30,
    }),
    visit({
      id: 'v-u-exam', customerId: 'cust-u', customerName: '客戶U',
      date: EXAM_DATE, status: 'done',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-u-exam',
        startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3', attended: true,
      })],
    }),
  ]);
  await app.signIn('/calendar');
  await page.waitForTimeout(500);

  // 日曆 → 點那一天 → 抽屜抬頭的「＋」→ 新增來訪 → 選人
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await page.waitForTimeout(500);
  await page.locator('[data-pick="cust-u"]').click();
  await page.waitForTimeout(1500);

  // 額度那一排：兩筆都用完了，但「＋ n返」照樣在
  const chip = page.locator('[data-chip="s0-ent"][data-chip-value="__nth__"]');
  await expect(chip, '身上沒有剩餘次數不代表接不了三返').toBeVisible();
  await chip.click();
  await page.waitForTimeout(600);

  await expect(page.locator('[data-chip="s0-nth"][data-chip-value="3"]'))
    .toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-chip="s0-exam-nth"][data-chip-value="v-u-exam"]').click();
  await page.waitForTimeout(300);

  await page.locator('input[name="s0-start"]').fill('15:00');
  await page.waitForTimeout(400);
  await page.locator('button[type="submit"]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await page.waitForTimeout(2500);

  const saved = (await app.readAll('visits')).find((v) => v.date === PICK_DAY && !v.deletedAt);
  expect(saved, '存得下去 —— 這一整輪就是為了這一行').toBeTruthy();
  expect(saved.slots[0].entitlementId).toBe(null);
  expect(saved.slots[0].followupNth).toBe(3);
  expect(saved.slots[0].followupForVisitId).toBe('v-u-exam');
});


// 2026-09-04 她問：「設定那邊的課程沒有 n返？還是其實我設定二返就等於 n返？」
// 是的：n返 借的就是二返那一個課程（時段的 courseId 指著它），所以二返上的
// 每一個設定它都照著走 —— 包含「客人走了之後要補一份紀錄」。
test('J-N7 三返做完也會長出「寫紀錄」—— 它跟著二返的設定走', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-v', name: '客戶V' }),
    entitlement('cust-v', {
      id: 'ent-v-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 1, doneCount: 1, bookedCount: 0, durationMin: 120,
    }),
    visit({
      id: 'v-v-exam', customerId: 'cust-v', customerName: '客戶V',
      date: EXAM_DATE, status: 'done',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-v-exam',
        startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3', attended: true,
      })],
    }),
    // 今天的一場三返：沒有額度，靠 followupNth 站得住（ADR-0063）
    visit({
      id: 'v-v-nth', customerId: 'cust-v', customerName: '客戶V',
      date: TODAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-followup', entitlementId: null,
        courseName: '三返', followupNth: 3, followupForVisitId: 'v-v-exam',
        startsAt: '15:00', endsAt: '15:30', roomId: 'room-t3', doctorId: 'staff-dr-xia',
      })],
    }),
  ]);
  await app.signIn('/todo/close');

  await page.locator('[data-open="v-v-nth"]').click();
  await expect(page.locator('.drawer')).toContainText('寫紀錄');
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(1800);

  const record = (await app.readAll('tasks'))
    .filter((t) => !t.deletedAt)
    .find((t) => t.kind === '寫紀錄');

  expect(record, '三返做完一樣要補一份紀錄').toBeTruthy();
  expect(record.visitId).toBe('v-v-nth');
  expect(record.dueDate).toBe(TODAY);
});
