// 反過來的那幾下：拿回一張待辦、取消一筆來訪，以及讀取卡片上的「這一場的待辦」。
//
// 這一支盯的是**畫面說的話**，不是資料的結果（那一半在 02-examine-chain）。
// 兩個方向都要盯：
//
//   少講 —— 拿回「追蹤健檢報告」會靜靜收掉「寄報告給醫師」，
//           她的下一句會是「我明明勾過寄報告，怎麼不見了」
//   多講 —— **不可以說「將會取消已約好的二返」**。拿回一張待辦不會動到
//           任何一筆來訪（ADR-0002），而嚇錯一次之後，真的該停的那次
//           她也不會停。U5 就是在盯這一條。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY, addDays,
} from '../fixtures/data.js';

const EXAM_DATE = addDays(TODAY, -3);

/** 買了 2 次健檢、配好二返額度、健檢已確認但還沒結案。 */
function seedBeforeClose() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-b', {
      id: 'ent-b-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 2, doneCount: 0, bookedCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-b', {
      id: 'ent-b-followup', label: '二返（8萬健檢）', type: 'single',
      courseId: 'course-followup', totalQty: 2, doneCount: 0, bookedCount: 0,
      followupForEntitlementId: 'ent-b-exam', durationMin: 30,
    }),
    visit({
      id: 'visit-b-exam1', customerId: 'cust-b', customerName: '客戶B',
      date: EXAM_DATE, status: 'confirmed',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-b-exam',
        startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3',
      })],
    }),
  ];
}

/** 把那一筆健檢從「簽療程單」那一頁結掉。 */
async function closeExam(app, page) {
  await app.go('/todo/close');
  await expect(page.locator('#view')).toContainText('客戶B');
  await page.locator('[data-open="visit-b-exam1"]').click();
  await expect(page.locator('[data-apply]')).toBeVisible();
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(1800);
}

/** 勾掉某一種待辦（走待辦中心那一頁的多選 + 標成完成）。 */
async function tick(app, page, kind) {
  await app.go(`/todo/${encodeURIComponent(kind)}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await page.waitForTimeout(2000);
}

/** 從「已完成」那一格點回來（不按確認，讓呼叫端自己決定）。 */
async function startUntick(app, page, kind) {
  await app.go(`/todo/${encodeURIComponent(kind)}`);
  await page.locator('[data-task-tab="done"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-untick]').first().click();
}

test.describe('拿回一張待辦要先講清楚', () => {
  test('U1 勾掉「追蹤健檢報告」→ 長出約二返與寄報告（當基準）', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    const kinds = (await app.readAll('tasks')).filter((t) => !t.deletedAt).map((t) => t.kind);
    expect(kinds).toContain('約二返');
    expect(kinds).toContain('寄報告給醫師');
  });

  test('U2 拿回「追蹤健檢報告」→ 跳確認，而且列得出那兩張', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    await startUntick(app, page, '追蹤健檢報告');
    await expect(app.dialog()).toBeVisible();

    const said = await app.dialogText();
    expect(said).toContain('寄報告給醫師');
    expect(said).toContain('約二返');
    // 還原得回來這件事一定要講 —— 不然那兩張看起來像永遠不見了
    expect(said).toContain('已刪除項目');
  });

  test('U3 按「取消」→ 報告還是已完成，那兩張都還在', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    await startUntick(app, page, '追蹤健檢報告');
    await app.cancelDialog();
    await page.waitForTimeout(800);

    const live = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
    expect(live.find((t) => t.kind === '追蹤健檢報告').done).toBe(true);
    expect(live.some((t) => t.kind === '寄報告給醫師')).toBe(true);
    expect(live.some((t) => t.kind === '約二返')).toBe(true);
  });

  test('U4 按「還是拿回來」→ 報告回到未完成，那兩張真的不見了', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    await startUntick(app, page, '追蹤健檢報告');
    await app.ok();
    await page.waitForTimeout(2000);

    const live = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
    const report = live.find((t) => t.kind === '追蹤健檢報告');
    expect(report, '那一張報告不可以消失').toBeTruthy();
    expect(report.done).toBe(false);
    expect(live.some((t) => t.kind === '寄報告給醫師')).toBe(false);
    expect(live.some((t) => t.kind === '約二返')).toBe(false);
  });

  test('U5 二返已經約好 → 講得出日期，而且那一筆來訪不會被動到', async ({ app, page }) => {
    // 健檢結案 → 勾掉報告 → 種一場真的二返（指回那一次健檢）
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    const FOLLOWUP_DATE = addDays(TODAY, 4);
    await app.seed([
      visit({
        id: 'visit-b-2nd', customerId: 'cust-b', customerName: '客戶B',
        date: FOLLOWUP_DATE, status: 'confirmed',
        slots: [slot({
          courseId: 'course-followup', entitlementId: 'ent-b-followup',
          startsAt: '10:00', endsAt: '10:30', followupForVisitId: 'visit-b-exam1',
        })],
      }),
    ]);
    await app.reload();

    await startUntick(app, page, '追蹤健檢報告');
    await expect(app.dialog()).toBeVisible();
    const said = await app.dialogText();

    // 講得出那一場約在哪一天
    const [, m, d] = FOLLOWUP_DATE.split('-');
    expect(said).toContain(`${Number(m)}/${Number(d)}`);
    // **而且明說那一筆來訪不會被動到**
    expect(said).toContain('不會被動到');
    // 一個字都不可以說「會取消二返」—— 那是假的
    expect(said).not.toContain('取消已約');
    expect(said).not.toContain('取消二返');

    await app.ok();
    await page.waitForTimeout(2000);

    // 那一筆二返來訪真的一個字都沒被動到
    const kept = await app.readDoc('visits', 'visit-b-2nd');
    expect(kept.status).toBe('confirmed');
    expect(kept.deletedAt ?? null).toBeNull();
  });

  test('U6 拿回 Examine → 不跳確認框（那一種什麼都不會發生）', async ({ app, page }) => {
    const DAY = addDays(TODAY, 2);
    await app.seed([
      ...masterDocs(),
      customer({ id: 'cust-a', name: '客戶A' }),
      entitlement('cust-a', {
        id: 'ent-a', label: '復健科醫師門診', type: 'single', courseId: 'course-rehab',
        totalQty: 4, doneCount: 0, bookedCount: 1,
      }),
      visit({
        id: 'visit-a', customerId: 'cust-a', customerName: '客戶A',
        date: DAY, status: 'confirmed',
        slots: [slot({
          courseId: 'course-rehab', entitlementId: 'ent-a',
          startsAt: '14:00', endsAt: '14:30',
        })],
      }),
      // 種一張已經勾掉的 Examine。**不走真的動線**：任務是來訪存檔那一刻
      // 由 `syncTasksForVisit()` 產生的，種一筆已確認的來訪不會長出它。
      task({
        id: 't-examine', customerId: 'cust-a', customerName: '客戶A',
        kind: 'Examine', visitId: 'visit-a', dueDate: addDays(DAY, -1),
        done: true, doneAt: `${TODAY}T02:00:00.000Z`,
      }),
    ]);
    await app.signIn('/');

    await startUntick(app, page, 'Examine');
    await page.waitForTimeout(1500);

    await expect(app.dialog()).toHaveCount(0);
    const live = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
    expect(live.find((t) => t.kind === 'Examine').done).toBe(false);
  });

  test('U11 取消一筆健檢 → 確認框印得出 Examine，不是三個系統並列', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/calendar');

    await page.click(`[data-day="${EXAM_DATE}"]`);
    await page.locator('[data-open="visit:visit-b-exam1"]').click();
    await expect(page.locator('.popcard')).toBeVisible();
    // 讀取卡片沒有取消那一顆 —— 走鉛筆進編輯器（ADR-0056）
    await page.locator('[data-card-edit]').click();
    await page.waitForTimeout(600);
    await page.locator('[data-status="cancelled"]').click();

    await expect(app.dialog()).toBeVisible();
    const said = await app.dialogText();
    expect(said).toContain('取消 Examine');
    expect(said).not.toContain('Abovee');
    await app.cancelDialog();
  });
});

test.describe('讀取卡片上的「這一場的待辦」', () => {
  test('U7 日曆點開一筆健檢 → 看得到「追蹤健檢報告」與死線', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);

    await app.go('/calendar');
    await page.click(`[data-day="${EXAM_DATE}"]`);
    await page.locator('[data-open="visit:visit-b-exam1"]').click();

    const mirror = page.locator('.taskmirror');
    await expect(mirror).toBeVisible();
    await expect(mirror).toContainText('追蹤健檢報告');
    // 死線是健檢日 + 21 天
    const due = addDays(EXAM_DATE, 21);
    const [, m, d] = due.split('-');
    await expect(mirror).toContainText(`${Number(m)}/${Number(d)}`);
    // 已經結案的那一筆，「簽療程單」要看得到而且是做完的
    await expect(mirror).toContainText('簽療程單');
  });

  test('U8 那一塊裡一個勾選框都沒有 —— 只給看，不給勾', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);

    await app.go('/calendar');
    await page.click(`[data-day="${EXAM_DATE}"]`);
    await page.locator('[data-open="visit:visit-b-exam1"]').click();
    await expect(page.locator('.taskmirror')).toBeVisible();
    await expect(page.locator('.taskmirror input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('.taskmirror button')).toHaveCount(0);
  });

  test('U9 一件待辦都沒有的來訪 → 整塊不出現，不是一個空框', async ({ app, page }) => {
    const DAY = addDays(TODAY, 6);
    await app.seed([
      ...masterDocs(),
      customer({ id: 'cust-a', name: '客戶A' }),
      entitlement('cust-a', {
        id: 'ent-a', label: '營養點滴 6 次', type: 'single', courseId: 'course-iv-drip',
        totalQty: 6, doneCount: 0, bookedCount: 1,
      }),
      // 已確認、日子還沒到、C 類（確認後沒有登記任務）→ 一件都沒有
      visit({
        id: 'visit-a', customerId: 'cust-a', customerName: '客戶A',
        date: DAY, status: 'confirmed',
        slots: [slot({
          courseId: 'course-iv-drip', entitlementId: 'ent-a',
          startsAt: '14:00', endsAt: '15:00',
        })],
      }),
    ]);
    await app.signIn('/calendar');

    await page.click(`[data-day="${DAY}"]`);
    await page.locator('[data-open="visit:visit-a"]').click();
    await expect(page.locator('.popcard')).toBeVisible();
    await page.waitForTimeout(900);
    await expect(page.locator('.taskmirror')).toHaveCount(0);
  });
});

test.describe('哪一筆底下寫了字', () => {
  const DAY = addDays(TODAY, 5);

  const seedTwo = (extra = []) => [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    customer({ id: 'cust-c', name: '客戶C' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '營養點滴 6 次', type: 'single', courseId: 'course-iv-drip',
      totalQty: 6, doneCount: 0, bookedCount: 1,
    }),
    entitlement('cust-c', {
      id: 'ent-c', label: '復能 6 次', type: 'single', courseId: 'course-recovery',
      totalQty: 6, doneCount: 0, bookedCount: 1,
    }),
    // 有「記的話」
    visit({
      id: 'visit-note', customerId: 'cust-a', customerName: '客戶A',
      date: DAY, status: 'confirmed', note: '客人說要換床',
      slots: [slot({
        courseId: 'course-iv-drip', entitlementId: 'ent-a',
        startsAt: '09:00', endsAt: '10:00',
      })],
    }),
    // 什麼都沒有
    visit({
      id: 'visit-bare', customerId: 'cust-c', customerName: '客戶C',
      date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-c',
        startsAt: '11:00', endsAt: '12:00',
      })],
    }),
    ...extra,
  ];

  const rowOf = (page, id) => page.locator(`[data-open="visit:${id}"]`);

  test('U10 有「記的話」的那一列看得到記事本，沒有的那一列看不到', async ({ app, page }) => {
    await app.seed(seedTwo());
    await app.signIn('/calendar');
    await page.click(`[data-day="${DAY}"]`);

    await expect(rowOf(page, 'visit-note').locator('[aria-label="有記的話"]')).toHaveCount(1);
    await expect(rowOf(page, 'visit-bare').locator('[aria-label="有記的話"]')).toHaveCount(0);
  });

  test('U10b 掛得到備忘錄的那一列另外一顆圖示，兩顆可以同時在', async ({ app, page }) => {
    await app.seed(seedTwo([{
      path: 'playbooks',
      id: 'pb-drip',
      data: {
        title: '營養點滴', courseIds: ['course-iv-drip'],
        body: '飯後打針\n收好針頭', deletedAt: null,
      },
    }]));
    await app.signIn('/calendar');
    await page.click(`[data-day="${DAY}"]`);

    // 點滴那一筆：記的話 + 備忘錄，兩顆都在
    await expect(rowOf(page, 'visit-note').locator('[aria-label="有記的話"]')).toHaveCount(1);
    await expect(rowOf(page, 'visit-note').locator('[aria-label="有備忘錄"]')).toHaveCount(1);
    // 復能那一筆沒掛到那一份，兩顆都沒有
    await expect(rowOf(page, 'visit-bare').locator('[aria-label="有備忘錄"]')).toHaveCount(0);

    // 兩顆圖示沒有把狀態徽章擠掉（390px 的窄螢幕）
    await expect(rowOf(page, 'visit-note').locator('.badge')).toBeVisible();
  });
});
