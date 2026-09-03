// Journey D：examine（健檢課程）→ 追蹤健檢報告 →（寄報告給醫師 ＋ 約二返）
//
// 這是整個 app 唯一的**鏈式**待辦，也是歷史上壞過最多次的一段：
//   1. 勾掉報告不會長出約二返（2026-08-25 以前）
//   2. 二返額度被配了兩次，於是二返補不進去（commit a8a0932）
//   3. 「約二返」勾得掉但其實沒約
//   4. 把報告那一張「拿回來」會被誤判成舊資料，於是刪掉約二返
//   5. 2026-09-03 起第二站是**兩張**（ADR-0065）。最危險的一格是
//      「二返約好了、報告還沒寄」—— 寄報告如果擠在 owed() 那道閘門裡面，
//      它會在她約好二返的那一刻被靜默收掉（J-D5 盯著）
//   6. 2026-09-04：反過來的同一個坑 —— 二返一有進度，**未完成的追蹤報告**
//      會在她把它勾回去的那一刻被靜默軟刪除（J-D6 盯著，ADR-0068）
//
// 注意：這幾張待辦**不是種子塞得出來的**，它們由 `syncFollowupTasks()` 在
// 寫入的那一刻產生。所以這一支一律走真的動線去觸發。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const EXAM_DATE = addDays(TODAY, -3);

/** 一位買了 2 次 examine、已經配好二返額度、examine 已確認但還沒結案的客戶。 */
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

/** 把那一筆 examine 從「簽療程單」那一頁結掉。 */
async function closeExam(app, page) {
  await app.go('/todo/close');
  await expect(page.locator('#view')).toContainText('客戶B');
  await page.locator('[data-open="visit-b-exam1"]').click();
  await expect(page.locator('[data-apply]')).toBeVisible();
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(1800);
}

test('J-D1 結案 examine → 長出「追蹤健檢報告」，死線是 examine 日 + 21 天', async ({ app, page }) => {
  await app.seed(seedBeforeClose());
  await app.signIn('/');
  await closeExam(app, page);

  const tasks = await app.readAll('tasks');
  const report = tasks.find((t) => t.kind === '追蹤健檢報告' && !t.deletedAt);

  expect(report, '結案之後該長出「追蹤健檢報告」').toBeTruthy();
  expect(report.visitId, '掛在那一筆 examine 的來訪上').toBe('visit-b-exam1');
  expect(report.dueDate, 'DEFAULT_REPORT_DUE_DAYS = 21').toBe(addDays(EXAM_DATE, 21));
  expect(report.done).toBe(false);

  // 這時候還不該有「約二返」—— 報告都還沒拿到
  expect(tasks.filter((t) => t.kind === '約二返' && !t.deletedAt)).toHaveLength(0);

  // 次數在「已完成」才扣
  const ent = await app.readDoc('customers/cust-b/entitlements', 'ent-b-exam');
  expect(ent.doneCount).toBe(1);
  expect(ent.bookedCount).toBe(0);
});

test('J-D2 勾掉「追蹤健檢報告」→ 同一刻長出「約二返」，死線從勾掉那天算', async ({ app, page }) => {
  await app.seed(seedBeforeClose());
  await app.signIn('/');
  await closeExam(app, page);

  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await expect(page.locator('#view')).toContainText('客戶B');

  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await page.waitForTimeout(2000);

  const tasks = await app.readAll('tasks');
  const booking = tasks.find((t) => t.kind === '約二返' && !t.deletedAt);

  expect(booking, '勾掉報告的那一刻就要長出「約二返」').toBeTruthy();
  expect(booking.visitId).toBe('visit-b-exam1');
  expect(booking.dueDate, '死線 = 勾掉那天 + 7，不是 examine 日 + 7')
    .toBe(addDays(TODAY, 7));

  // ADR-0065：同一站的第二張。兩張的死線一樣 —— 它們是同一個動作的兩半。
  const send = tasks.find((t) => t.kind === '寄報告給醫師' && !t.deletedAt);
  expect(send, '報告拿到了就要寄一份給醫師').toBeTruthy();
  expect(send.visitId).toBe('visit-b-exam1');
  expect(send.dueDate).toBe(booking.dueDate);

  const report = tasks.find((t) => t.kind === '追蹤健檢報告');
  expect(report.done, '報告那一張要留著，只是勾掉了').toBe(true);
});

test('J-D5 二返約好了、報告還沒寄 → **寄報告那一張要留著**', async ({ app, page }) => {
  await app.seed(seedBeforeClose());
  await app.signIn('/');
  await closeExam(app, page);

  // 勾掉報告 → 第二站兩張都長出來
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await page.waitForTimeout(2000);

  // 再把「約二返」勾掉（她去約了）
  await app.go(`/todo/${encodeURIComponent('約二返')}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await page.waitForTimeout(2000);

  const tasks = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
  const send = tasks.find((t) => t.kind === '寄報告給醫師');

  expect(send, '寄報告不因為二返約好了而消失 —— 那是兩件事').toBeTruthy();
  expect(send.done, '而且它還沒被做掉').toBe(false);
});

test('J-D3 把報告那一張「拿回來」→ 退回上一站，約二返收起來，報告留著', async ({ app, page }) => {
  await app.seed(seedBeforeClose());
  await app.signIn('/');
  await closeExam(app, page);

  // 先勾掉報告
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await page.waitForTimeout(2000);

  // 再從「已完成」那一格點回來
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await page.locator('[data-task-tab="done"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-untick]').first().click();
  await page.waitForTimeout(2000);

  const tasks = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
  const report = tasks.find((t) => t.kind === '追蹤健檢報告');
  const booking = tasks.find((t) => t.kind === '約二返');

  expect(report, '報告那一張要還在').toBeTruthy();
  expect(report.done, '而且回到未完成').toBe(false);
  expect(booking, '約二返要收起來 —— 報告都還沒拿到，不到約的時候').toBeFalsy();

  const send = tasks.find((t) => t.kind === '寄報告給醫師');
  expect(send, '寄報告也一起收起來 —— 報告都還沒拿到，沒有東西可以寄').toBeFalsy();
});

// 2026-09-04 她實測回報的那一個：J-D3 走的是「勾掉 → 立刻反悔」，那一條本來就對。
// 壞掉的是**中間做了事**再反悔 —— 二返一有進度，owed() 就掉到 0，那一次健檢
// 整個退出候選，於是她剛拿回來的那一張報告自己被軟刪除。見 ADR-0068。
test('J-D6 約二返勾掉了，再把報告拿回來 → 報告還在，而且回到未完成', async ({ app, page }) => {
  await app.seed(seedBeforeClose());
  await app.signIn('/');
  await closeExam(app, page);

  // 勾掉報告 → 第二站兩張都長出來
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await page.waitForTimeout(2000);

  // 她去約了，把「約二返」也勾掉
  await app.go(`/todo/${encodeURIComponent('約二返')}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await page.waitForTimeout(2000);

  // 這時候才發現按錯了，把報告那一張拿回來
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await page.locator('[data-task-tab="done"]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-untick]').first().click();
  await page.waitForTimeout(2000);

  const all = await app.readAll('tasks');
  const report = all.find((t) => t.kind === '追蹤健檢報告');

  expect(report, '那一張報告不可以消失').toBeTruthy();
  expect(report.deletedAt ?? null, '而且不可以被軟刪除到「已刪除項目」裡').toBeNull();
  expect(report.done, '要回到未完成').toBe(false);

  // 畫面上真的看得到它
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await expect(page.locator('#view')).toContainText('客戶B');
  await expect(page.locator('[data-task]')).toHaveCount(1);
});

test('J-D4 買 2 次只做 1 次 → 只欠 1 次二返，不是 2 次', async ({ app, page }) => {
  await app.seed(seedBeforeClose());
  await app.signIn('/customers/cust-b');
  await closeExam(app, page);

  await app.go('/customers/cust-b');
  const body = await app.text();
  expect(body).toMatch(/健檢做完\s*1\s*次/);
  expect(body).toMatch(/二返還欠\s*1\s*次/);
});

test('J-D9 沒有金額等級的 examine 不會被補一個猜的金額', async ({ app }) => {
  const docs = seedBeforeClose().map((d) => {
    if (d.id === 'ent-b-exam') {
      const { tier, ...rest } = d.data;
      return { ...d, data: { ...rest, label: '健檢' } };
    }
    // 二返的名字是抄來源額度的，來源沒有等級時它也不該有
    if (d.id === 'ent-b-followup') return { ...d, data: { ...d.data, label: '二返（健檢）' } };
    return d;
  });
  await app.seed(docs);
  await app.signIn('/customers/cust-b');

  const body = await app.text();
  expect(body).toContain('健檢');
  expect(body, '不可以憑空生出一個金額').not.toMatch(/\d+萬健檢/);
});

test('J-D10 二返額度不可以被配第二次（回歸 a8a0932）', async ({ app, page }) => {
  await app.seed(seedBeforeClose());
  await app.signIn('/settings/health');
  await app.settled();

  const body = await app.text();
  // 這位客戶已經配好二返了，資料健檢不該說她還缺
  const followupSection = body.match(/二返額度[\s\S]{0,200}/)?.[0] ?? '';
  console.log('[J-D10] 資料健檢的二返額度那一段 =', JSON.stringify(followupSection.slice(0, 200)));
  expect(followupSection, '已經配好的不該再被列成缺').not.toMatch(/客戶B/);

  const ents = await app.readAll('customers/cust-b/entitlements');
  const followups = ents.filter((e) => e.followupForEntitlementId === 'ent-b-exam' && !e.deletedAt);
  expect(followups, '一筆 examine 只能配一筆二返').toHaveLength(1);
});
