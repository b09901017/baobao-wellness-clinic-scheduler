// 2026-10-08 上線前修正，第三段（`.scratch/prelaunch-fixes-2026-10-08/issues/15`–`18`）：規則與待辦。
//
// 單元測試釘得住規則本身；這裡從瀏覽器問的是「她眼前那一句」與「存完資料庫裡真的有的」是不是同一件事 ——
// 這一段的兩支都是「畫面說會發生、存完沒有發生」或「改了設定、已經談定的那幾天沒有跟上」。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const alive = (rows) => rows.filter((t) => !t.deletedAt);

// ---------- 15 健檢和二返同一次排好：報告那兩張照樣長（ADR-0139） ----------

const EXAM_DAY = addDays(TODAY, -2);
const SECOND_DAY = addDays(TODAY, 20);

/**
 * 客戶A：健檢和二返**同一次排好**、兩段都談定了。健檢那一天已經過了、還沒簽療程單；
 * 二返在二十天後，還接不到那一次健檢（健檢沒做完之前那一排按不下去）。
 */
function seedBookedTogether() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-exam', label: '8萬健檢', courseId: 'course-checkup',
      totalQty: 1, bookedCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-a', {
      id: 'ent-second', label: '二返（8萬健檢）', courseId: 'course-followup',
      totalQty: 1, bookedCount: 1, followupForEntitlementId: 'ent-exam', durationMin: 30,
    }),
    visit({
      id: 'v-exam', customerId: 'cust-a', customerName: '客戶A', date: EXAM_DAY, status: 'confirmed',
      slots: [{
        ...slot({
          courseId: 'course-checkup', entitlementId: 'ent-exam',
          startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3',
        }),
        status: 'confirmed',
      }],
    }),
    visit({
      id: 'v-second', customerId: 'cust-a', customerName: '客戶A', date: SECOND_DAY, status: 'confirmed',
      slots: [{
        ...slot({ courseId: 'course-followup', entitlementId: 'ent-second', startsAt: '14:00', endsAt: '14:30' }),
        status: 'confirmed',
      }],
    }),
  ];
}

test('K1 健檢和二返同一次排好 → 簽療程單：抽屜說會多一張報告，存完真的有；勾掉報告只多寄報告', async ({ app, page }) => {
  await app.seed(seedBookedTogether());
  await app.signIn('/');

  // 簽療程單 → 那一天 → ✓
  await app.go('/todo/close');
  await page.locator('[data-open="v-exam"]').click();
  await app.layer('.drawer [data-apply]');
  await app.tickAll();

  // 抽屜那一句是補讀之後才畫的（這位客戶的額度、來訪、任務）
  await expect(page.locator('.drawer .dialog__list'), '抽屜要講會多一張追蹤健檢報告')
    .toContainText('追蹤健檢報告');
  await page.locator('[data-apply]').click();
  await app.saved();

  // 存完真的長出來了，而且只有那一張
  let tasks = alive(await app.readAll('tasks'));
  const report = tasks.find((t) => t.kind === '追蹤健檢報告');
  expect(report, '二返先約好了，報告那一張照樣要長').toBeTruthy();
  expect(report.visitId).toBe('v-exam');
  expect(report.dueDate, '死線照舊：健檢那一天 + 21').toBe(addDays(EXAM_DAY, 21));
  expect(tasks.filter((t) => t.kind === '約二返'), '二返已經約好了，不可以叫她再約').toHaveLength(0);

  // 待辦中心看得到那一張
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await expect(page.locator('#view')).toContainText('客戶A');

  // 勾掉 → 多一張「寄報告給醫師」，沒有「約二返」
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  tasks = alive(await app.readAll('tasks'));
  expect(tasks.find((t) => t.kind === '寄報告給醫師'), '報告拿到了要寄一份給醫師').toBeTruthy();
  expect(tasks.filter((t) => t.kind === '約二返'), '勾掉報告也不可以多一張約二返').toHaveLength(0);

  // 那一場先約好的二返一個字都沒被動到
  const second = await app.readDoc('visits', 'v-second');
  expect(second.status).toBe('confirmed');
  expect(second.slots[0].followupForVisitId ?? null, '系統不替她接連結').toBe(null);
});
