// 「寫紀錄」——任務的第二個時機。ADR-0066。
//
// 她的原話：「二返……事後（客人來完後）要寫二返紀錄。然後營養諮詢也是要寫紀錄。」
//
// 現有的任務全部長在**來訪之前**（死線是來訪日的前一天，客人確認之後才產生）。
// 這一種相反：那一場**做完**才長，死線就是來訪那一天。
//
// 這一支盯的是「兩族併在一起之後最容易壞掉」的那幾格：
//
//   1. 結案 → 長出「寫紀錄」，死線是來訪那一天（不是它的前一天）
//   2. **同一刻，還沒做完的 Examine／耀聖一張都不會被收掉**
//      （`tasksForVisit()` 不看狀態，就是為了這一條）
//   3. 沒有勾「做完要寫紀錄」的課程一張都不長
//   4. 未到不長 —— 人沒來，沒有紀錄要寫
//
// 「來訪從已完成拿回來」那一格走不到這裡：已完成是唯讀鎖定區（SPEC 第 6.4 節），
// 畫面上沒有那條路。規則本身由 `tests/tasks.test.js` 盯著。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY,
} from '../fixtures/data.js';

/**
 * 一位今天有一場二返的客戶G，掛號那兩張已經在了（客人早就確認過）。
 *
 * 二返在種子主檔上是 `needsRecord: true`，所以結案之後要多一張「寫紀錄」。
 */
function seedFollowupToday({ withRegistrations = true } = {}) {
  return [
    ...masterDocs(),
    customer({ id: 'cust-g', name: '客戶G' }),
    entitlement('cust-g', {
      id: 'ent-g-followup', label: '二返（8萬健檢）', type: 'single',
      courseId: 'course-followup', totalQty: 2, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'visit-g-followup', customerId: 'cust-g', customerName: '客戶G',
      date: TODAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-followup', entitlementId: 'ent-g-followup',
        startsAt: '14:00', endsAt: '14:30', roomId: 'room-t3', doctorId: 'staff-dr-xia',
      })],
    }),
    ...(withRegistrations ? [
      task({
        id: 'task-g-examine', visitId: 'visit-g-followup', customerId: 'cust-g',
        customerName: '客戶G', kind: 'Examine', dueDate: TODAY,
      }),
      task({
        id: 'task-g-yaosheng', visitId: 'visit-g-followup', customerId: 'cust-g',
        customerName: '客戶G', kind: '耀聖', dueDate: TODAY,
      }),
    ] : []),
  ];
}

/** 把今天那一場從「簽療程單」結掉。`attended` 預設全部有做。 */
async function closeToday(app, page, visitId) {
  await app.go('/todo/close');
  await page.locator(`[data-open="${visitId}"]`).click();
  await expect(page.locator('[data-apply]')).toBeVisible();
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(1800);
}

const live = async (app) => (await app.readAll('tasks')).filter((t) => !t.deletedAt);

test('R1 結案 → 長出「寫紀錄」，死線是來訪那一天（不是前一天）', async ({ app, page }) => {
  await app.seed(seedFollowupToday());
  await app.signIn('/');
  await closeToday(app, page, 'visit-g-followup');

  const record = (await live(app)).find((t) => t.kind === '寫紀錄');

  expect(record, '二返做完要去補一份紀錄').toBeTruthy();
  expect(record.visitId).toBe('visit-g-followup');
  expect(record.dueDate, '死線就是來訪那一天 —— 這件事是當天做的').toBe(TODAY);
  expect(record.done).toBe(false);
});

test('R2 結案的同一刻，還沒做完的掛號一張都不會被收掉', async ({ app, page }) => {
  await app.seed(seedFollowupToday());
  await app.signIn('/');
  await closeToday(app, page, 'visit-g-followup');

  const after = await live(app);
  expect(
    after.filter((t) => ['Examine', '耀聖'].includes(t.kind)).length,
    '**結案不可以把她還沒做完的掛號洗掉**（ADR-0027 的 Consequences）',
  ).toBe(2);
  expect(after.some((t) => t.kind === '寫紀錄'), '而且同一刻多一張寫紀錄').toBe(true);
});

test('R3 待辦中心上那一列講得出是哪一天、哪一場', async ({ app, page }) => {
  await app.seed(seedFollowupToday());
  await app.signIn('/');
  await closeToday(app, page, 'visit-g-followup');

  await app.go(`/todo/${encodeURIComponent('寫紀錄')}`);
  const body = await app.text();
  expect(body).toContain('客戶G');
  expect(body, '課程名要印出來 —— 光是「寫紀錄」看不出是哪一場').toContain('二返');
});

test('R4 沒勾「做完要寫紀錄」的課程一張都不長', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-h', name: '客戶H' }),
    entitlement('cust-h', {
      id: 'ent-h-recovery', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    visit({
      id: 'visit-h-recovery', customerId: 'cust-h', customerName: '客戶H',
      date: TODAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-h-recovery',
        startsAt: '10:00', endsAt: '11:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      })],
    }),
  ]);
  await app.signIn('/');
  await closeToday(app, page, 'visit-h-recovery');

  expect((await live(app)).some((t) => t.kind === '寫紀錄'),
    '復能做完沒有紀錄要補').toBe(false);
});
