// 上線前補的那一輪（before-golive-2026-10-19）健檢那條鏈的兩支：
// - I1、I2：讀不完整時，會動到次數或健檢那一串待辦的存檔先不存（ADR-0158，issue 01）
// - I3：健檢做的比買的多，多出來那一次也追報告；改了二返額度那一串當場重算（ADR-0159，issue 02）
//
// ── I1、I2 ──
// 她：「沒網路的時候存檔，會收掉健檢那條鏈的待辦，而且剩幾次會少算。 好 修」。
//
// Firestore 開著本機快取，離線（或網路不穩到 SDK 判定離線）時讀取不會失敗，回的是快取裡剛好有的那幾筆。
// 這裡的客戶A 那一次健檢在 200 天前 —— 壓表那一頁只讀 180 天，所以快取裡沒有它。以前離線存一段：
// 拿快取那一份當「全部」→ 健檢不在手上 → 開著的「追蹤健檢報告」被收掉、次數照少的那一份算。
//
// 單元測試（`tests/incomplete-read.test.js`）量擋不擋的那一支與原始碼的順序；這裡從瀏覽器量兩種斷線：
// - 確定離線（`setOffline(true)`，`navigator.onLine` 是 false）
// - 網路不穩到 SDK 自己退回快取（擋掉模擬器的 8080，`navigator.onLine` 照樣是 true）

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY, addDays,
} from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;
/** 壓表那一頁讀 180 天：這一次健檢不在快取裡 */
const EXAM_DAY = addDays(TODAY, -200);

const alive = (rows) => rows.filter((r) => !r.deletedAt);

function seed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-exam', label: '8萬健檢', courseId: 'course-checkup',
      totalQty: 1, doneCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-a', {
      id: 'ent-second', label: '二返（8萬健檢）', courseId: 'course-followup',
      totalQty: 1, followupForEntitlementId: 'ent-exam', durationMin: 30,
    }),
    entitlement('cust-a', {
      id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 10, durationMin: 30,
    }),
    visit({
      id: 'v-exam', customerId: 'cust-a', customerName: '客戶A', date: EXAM_DAY, status: 'done',
      slots: [{
        ...slot({ courseId: 'course-checkup', entitlementId: 'ent-exam', startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3' }),
        status: 'done', attended: true,
      }],
    }),
    task({
      id: 't-report', customerId: 'cust-a', customerName: '客戶A', kind: '追蹤健檢報告',
      dueDate: addDays(EXAM_DAY, 21), visitId: 'v-exam',
    }),
  ];
}

/** 壓表：打開客戶A 的卡、選那一天、復能、器材、時間 —— 停在按「加這一段」之前 */
async function pickSlot(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-a"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
  await page.locator('[data-ent="ent-pool"]').click();
  await app.layer('[data-equipment]');
  await page.locator('[data-equipment]').first().click();
  // 治療師先選好：存檔前只剩「壓好了嗎」那一道
  await app.layer('[data-therapist]');
  await page.locator('[data-therapist]').first().click();
  await page.locator('[data-time="14:00"]').click();
}

/** 資料庫裡跟客戶A 有關、會被這一次存檔動到的那幾樣 */
async function snapshot(app) {
  const visits = alive(await app.readAll('visits')).filter((v) => v.customerId === 'cust-a');
  const tasks = alive(await app.readAll('tasks')).filter((t) => t.customerId === 'cust-a');
  const pool = await app.readDoc('customers/cust-a/entitlements', 'ent-pool');
  return {
    visits: visits.map((v) => v.id).sort(),
    tasks: tasks.map((t) => `${t.kind}:${t.done}`).sort(),
    booked: pool.bookedCount ?? 0,
  };
}

test('I1 離線在壓表記一段：講那一句、一個位元都沒寫、卡片上選好的還在；連上再按 → 寫進去一次、報告那一張還在', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '這一支刻意斷線' });
  await app.seed(seed());
  await app.signIn('/');
  await pickSlot(app, page);
  const before = await snapshot(app);

  await page.context().setOffline(true);
  await page.locator('[data-add]').click();

  const toast = page.locator('#toast');
  await expect(toast).toContainText('網路不穩');
  await expect(toast).toContainText('客戶A');
  await expect(toast).toContainText('先不存');
  await expect(toast, '這一筆一個位元都沒寫，不可以說存在這台裝置上').not.toContainText('這台裝置');
  await expect(app.dialog(), '擋在確認框之前：不要讓她答完一道框才說存不了').toBeHidden();
  // 卡片上選好的留著：她連上之後直接再按一次
  await expect(page.locator('[data-time="14:00"]')).toHaveAttribute('aria-pressed', 'true');

  await page.context().setOffline(false);
  // 排隊的寫入（如果有的話）這時候會送出去 —— 等一下再看資料庫：什麼都不該變
  expect(await snapshot(app), '離線那一下什麼都沒寫').toEqual(before);

  // 連上之後再按：SDK 剛回到線上那一下可能還讀得到快取（照樣擋），她會再按一次
  await expect(async () => {
    await page.locator('[data-add]').click();
    await expect(app.dialog()).toBeVisible({ timeout: 4_000 });
  }).toPass({ timeout: 40_000 });
  await expect(app.dialog(), '「壓好了嗎」那一道').toContainText('14:00');
  await app.ok();
  await app.saved();
  await expect(page.locator('#toast')).toContainText('記好了');

  const after = await snapshot(app);
  expect(after.visits, '寫進去一次').toHaveLength(before.visits.length + 1);
  expect(after.booked, '次數照全部來訪算：多排一段').toBe(before.booked + 1);
  expect(after.tasks, '200 天前那一次健檢的「追蹤健檢報告」沒有被收掉')
    .toContain('追蹤健檢報告:false');
});

test('I2 網路不穩到 SDK 自己退回快取（navigator.onLine 照樣是 true）：勾「追蹤健檢報告」→ 不說「已經存在這台裝置上了」、講那一句、勾選翻回來、資料庫沒動', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '這一支刻意擋掉模擬器' });
  await app.seed(seed());
  await app.signIn('/');
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await expect(page.locator('#view')).toContainText('客戶A');
  const before = await snapshot(app);

  // toast 每換一次字都記下來：中間那幾秒講過什麼，最後一句看不到
  await page.evaluate(() => {
    window.__toastSaid = [];
    const node = document.getElementById('toast');
    new MutationObserver(() => window.__toastSaid.push(node.innerText)).observe(node, { childList: true, subtree: true, characterData: true });
  });

  // 擋掉模擬器的 Firestore（8080）：瀏覽器覺得自己在線上，SDK 連不上、讀取退回快取
  await page.route('http://127.0.0.1:8080/**', (route) => route.abort());
  expect(await page.evaluate(() => navigator.onLine)).toBe(true);

  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();

  await expect(page.locator('#toast'), 'SDK 退回快取之後擋下來').toContainText('網路不穩', { timeout: 45_000 });
  const said = await page.evaluate(() => window.__toastSaid);
  expect(said.join('｜'), '還在讀的那幾秒不可以說「已經存在這台裝置上了」').not.toMatch(/還沒送出去|這台裝置/);
  await expect(page.locator('#toast'), '不給重試鈕：重試拿的還是快取那一份').not.toContainText('重試');

  await page.unroute('http://127.0.0.1:8080/**');
  expect(await snapshot(app), '勾選與健檢鏈一筆都沒寫').toEqual(before);
});

// ── I3（ADR-0159）──
//
// 她：「健檢做的次數比買的多，多出來那一次不會長報告那一串待辦。 好 修」；我問「沒有二返額度的那一次，
// 『約二返』先不長，等你補了額度才長？」她：「是」。
// 以前報告的名額被二返額度的總次數蓋住：買 1 次健檢配 1 次二返、做了第二次健檢 → 一張報告都不長。

const FIRST_EXAM = addDays(TODAY, -60);
const SECOND_DAY = addDays(TODAY, -30);
const EXTRA_EXAM = addDays(TODAY, -3);

function seedExtraExam() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '客戶X' }),
    entitlement('cust-x', {
      id: 'ent-x-exam', label: '8萬健檢', courseId: 'course-checkup',
      totalQty: 1, doneCount: 1, bookedCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-x', {
      id: 'ent-x-second', label: '二返（8萬健檢）', courseId: 'course-followup',
      totalQty: 1, doneCount: 1, followupForEntitlementId: 'ent-x-exam', durationMin: 30,
    }),
    // 買的那一次：做完了、二返也做完了（接在它上面）
    visit({
      id: 'v-x-exam1', customerId: 'cust-x', customerName: '客戶X', date: FIRST_EXAM, status: 'done',
      slots: [{
        ...slot({ courseId: 'course-checkup', entitlementId: 'ent-x-exam', startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3' }),
        status: 'done', attended: true,
      }],
    }),
    visit({
      id: 'v-x-second', customerId: 'cust-x', customerName: '客戶X', date: SECOND_DAY, status: 'done',
      slots: [{
        ...slot({ courseId: 'course-followup', entitlementId: 'ent-x-second', startsAt: '10:00', endsAt: '10:30', roomId: 'room-t3' }),
        followupForVisitId: 'v-x-exam1', status: 'done', attended: true,
      }],
    }),
    // 多做的那一次：同一筆健檢額度（超用，app 不擋 —— ADR-0002），客人來了、還沒簽療程單
    visit({
      id: 'v-x-exam2', customerId: 'cust-x', customerName: '客戶X', date: EXTRA_EXAM, status: 'confirmed',
      slots: [slot({ courseId: 'course-checkup', entitlementId: 'ent-x-exam', startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3' })],
    }),
  ];
}

const liveTasks = async (app) => alive(await app.readAll('tasks')).filter((t) => t.customerId === 'cust-x');
const kindsOf = (tasks) => tasks.map((t) => `${t.kind}:${t.visitId}:${t.done}`).sort();

test('I3 健檢超用：簽療程單 → 長報告；勾掉 → 寄報告、不長約二返；客戶詳情把二返的次數改成 2 → 約二返當場出現', async ({ app, page }) => {
  await app.seed(seedExtraExam());
  await app.signIn('/');

  // ① 簽療程單結掉多做的那一次
  await app.go('/todo/close');
  await expect(page.locator('#view')).toContainText('客戶X');
  await page.locator('[data-open="v-x-exam2"]').click();
  await app.tickAll();
  await page.locator('[data-apply]').click();
  await app.saved();
  await expect.poll(async () => kindsOf(await liveTasks(app)), '多做的那一次也要追報告（以前一張都不長）')
    .toEqual(['追蹤健檢報告:v-x-exam2:false']);

  // ② 勾掉報告：寄報告給醫師長出來；二返額度只有 1 次而且做完了 → 約二返不長
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await expect(page.locator('#view')).toContainText('客戶X');
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();
  await expect.poll(async () => kindsOf(await liveTasks(app)))
    .toEqual(['寄報告給醫師:v-x-exam2:false', '追蹤健檢報告:v-x-exam2:true']);

  // ③ 補額度：客戶詳情 → 二返那一筆「調整」→ 總次數 2 → 儲存。不存任何來訪，約二返當場在待辦上
  const visitsBefore = (await app.readAll('visits')).map((v) => `${v.id}:${v.updatedAt?.seconds ?? v.updatedAt}`).sort();
  await app.go('/customers/cust-x');
  await page.locator('[data-ent="ent-x-second"]').click();
  await app.layer('[name="totalQty"]');
  await page.locator('[name="totalQty"]').fill('2');
  await page.click('button[type="submit"]');
  await app.saved();
  // 那一張表沒有確認框：存完的 toast 講待辦多了什麼（before-golive-2026-10-19/17）
  await expect(page.locator('#toast')).toContainText('已儲存 —— 待辦多 1 張「約二返」');

  await expect.poll(async () => kindsOf(await liveTasks(app)), '補了額度，約二返不用等下一次存來訪')
    .toEqual(['寄報告給醫師:v-x-exam2:false', '約二返:v-x-exam2:false', '追蹤健檢報告:v-x-exam2:true']);
  const second = await app.readDoc('customers/cust-x/entitlements', 'ent-x-second');
  expect(second.totalQty).toBe(2);
  expect((await app.readAll('visits')).map((v) => `${v.id}:${v.updatedAt?.seconds ?? v.updatedAt}`).sort(),
    '重算只寫待辦，一筆來訪都不動').toEqual(visitsBefore);

  // ④ 改回 1：多出來的那一張收起來（次數改少也重算）
  await page.locator('[data-ent="ent-x-second"]').click();
  await app.layer('[name="totalQty"]');
  await page.locator('[name="totalQty"]').fill('1');
  await page.click('button[type="submit"]');
  await app.saved();
  await expect(page.locator('#toast')).toContainText('1 張「約二返」收起來了');
  await expect.poll(async () => kindsOf(await liveTasks(app)), '二返的次數不夠了，約二返收起來')
    .toEqual(['寄報告給醫師:v-x-exam2:false', '追蹤健檢報告:v-x-exam2:true']);
});
