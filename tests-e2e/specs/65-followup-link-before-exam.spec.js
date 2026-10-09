// 二返可以先接上還沒做完的那一次健檢（`.scratch/followup-link-before-exam`，ADR-0145）。
//
// 單元測試釘得住規則本身；這裡從瀏覽器問的是「那一排按得下去」「存完資料庫裡接上了」「別次健檢的約二返沒有被收掉」
// 是不是同一件事 —— 這一支要修的正是「畫面上按不下去、存完待辦少一張」。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY, addDays,
} from '../fixtures/data.js';

const alive = (rows) => rows.filter((t) => !t.deletedAt);

const OLD_DAY = addDays(TODAY, -100);
// 都要落在今天那一個月裡：日曆打開是這個月
const MONTH = TODAY.slice(0, 7);
const EXAM_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;
const SECOND_DAY = addDays(EXAM_DAY, 1).startsWith(MONTH) ? addDays(EXAM_DAY, 1) : EXAM_DAY;

/**
 * 客戶A：舊的那一次健檢（A）做完了、報告與寄報告都勾了、「約二返」開著；
 * 這一次健檢（B）約好了還沒做 —— 她要當場把二返一起約、接在 B 上。
 */
function seedTwoExams() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-exam', label: '8萬健檢', courseId: 'course-checkup',
      totalQty: 2, doneCount: 1, bookedCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-a', {
      id: 'ent-second', label: '二返（8萬健檢）', courseId: 'course-followup',
      totalQty: 2, followupForEntitlementId: 'ent-exam', durationMin: 30,
    }),
    visit({
      id: 'v-old', customerId: 'cust-a', customerName: '客戶A', date: OLD_DAY, status: 'done',
      slots: [{
        ...slot({ courseId: 'course-checkup', entitlementId: 'ent-exam', startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3' }),
        status: 'done', attended: true,
      }],
    }),
    visit({
      id: 'v-exam', customerId: 'cust-a', customerName: '客戶A', date: EXAM_DAY, status: 'confirmed',
      slots: [{
        ...slot({ courseId: 'course-checkup', entitlementId: 'ent-exam', startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3' }),
        status: 'confirmed',
      }],
    }),
    task({
      id: 't-old-report', customerId: 'cust-a', customerName: '客戶A', kind: '追蹤健檢報告',
      dueDate: addDays(OLD_DAY, 21), visitId: 'v-old', done: true, doneAt: `${addDays(OLD_DAY, 18)}T02:00:00.000Z`,
    }),
    task({
      id: 't-old-send', customerId: 'cust-a', customerName: '客戶A', kind: '寄報告給醫師',
      dueDate: addDays(OLD_DAY, 25), visitId: 'v-old', done: true, doneAt: `${addDays(OLD_DAY, 19)}T02:00:00.000Z`,
    }),
    task({
      id: 't-old-book', customerId: 'cust-a', customerName: '客戶A', kind: '約二返',
      dueDate: addDays(OLD_DAY, 25), visitId: 'v-old', done: false,
    }),
  ];
}

/** 存檔前那幾道確認一道一道按掉（提醒那一道、壓好了嗎那一道） */
async function okAll(app) {
  for (let i = 0; i < 3; i += 1) {
    // eslint-disable-next-line no-await-in-loop
    if (!(await app.dialog().isVisible())) return;
    // eslint-disable-next-line no-await-in-loop
    await app.ok();
  }
}

test('L1 健檢約好還沒做、當場約二返：那一排按得下去、存完接在那一次上；舊的那一次的約二返沒有被收掉', async ({ app, page }) => {
  await app.seed(seedTwoExams());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${SECOND_DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-a"]').click();
  await app.layer('[data-chip="s0-ent"]');
  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-second"]').click();

  // 這一次（還沒做）按得下去；舊的那一次做完了、也按得下去 —— 兩顆都能選，不替她選
  const exam = page.locator('[data-chip="s0-exam"][data-chip-value="v-exam"]');
  await expect(exam, '排著的那一次按得下去').toBeEnabled();
  await expect(page.locator('[data-chip="s0-exam"][data-chip-value="v-old"]')).toBeEnabled();
  await expect(page.locator('[data-chip="s0-exam"][aria-pressed="true"]'), '兩顆都能選就不替她選').toHaveCount(0);
  await exam.click();
  await page.click('button[type="submit"]');
  await okAll(app);
  await app.saved();

  const mine = (await app.readAll('visits')).filter((v) => v.customerId === 'cust-a' && v.date === SECOND_DAY);
  expect(mine).toHaveLength(1);
  expect(mine[0].slots[0].followupForVisitId, '接在還沒做完的那一次上').toBe('v-exam');

  const book = alive(await app.readAll('tasks')).find((t) => t.id === 't-old-book');
  expect(book, '舊的那一次的「約二返」沒有被收掉 —— 這一場是 B 的').toBeTruthy();
  expect(book.done).toBe(false);
});
