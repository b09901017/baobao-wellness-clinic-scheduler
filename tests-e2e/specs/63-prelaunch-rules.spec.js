// 2026-10-08 上線前修正，第三段（`.scratch/prelaunch-fixes-2026-10-08/issues/15`–`18`）：規則與待辦。
//
// 單元測試釘得住規則本身；這裡從瀏覽器問的是「她眼前那一句」與「存完資料庫裡真的有的」是不是同一件事 ——
// 這一段的兩支都是「畫面說會發生、存完沒有發生」或「改了設定、已經談定的那幾天沒有跟上」。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, TODAY, addDays,
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

// ---------- 16 改了課程「壓哪幾個系統」：談定的那幾天跟著補長或收掉（ADR-0140） ----------

const COURSES = 'config/app/courses';
const sys = (page, name) => page.locator(`input[name="systems"][value="${name}"]`);

/** 一段某一門課的來訪。`status` 整筆與那一段一樣。 */
const oneSlot = (id, date, courseId, status) => visit({
  id, customerId: 'cust-a', customerName: '客戶A', date, status,
  slots: [{
    ...slot({ courseId, entitlementId: `ent-${courseId}`, startsAt: '10:00', endsAt: '10:30' }),
    status,
  }],
});

/**
 * 客戶A 三天 HA-PRP（種子上只壓 Abovee、設定暫定）：五天後那一天談定了、昨天那一天談定了還沒簽療程單、
 * 七天後那一天還在等客人回。
 */
function seedHaPrp() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', { id: 'ent-course-ha-prp', label: 'HA-PRP', courseId: 'course-ha-prp', totalQty: 5, bookedCount: 3 }),
    oneSlot('v-soon', addDays(TODAY, 5), 'course-ha-prp', 'confirmed'),
    oneSlot('v-past', addDays(TODAY, -1), 'course-ha-prp', 'confirmed'),
    oneSlot('v-wait', addDays(TODAY, 7), 'course-ha-prp', 'pending_confirm'),
  ];
}

test('M1 替一門課多勾「耀聖」：確認框講會影響 1 天，存完那一天多一張；過了的、還沒談定的不長；來訪一個字都沒動', async ({ app, page }) => {
  await app.seed(seedHaPrp());
  await app.signIn('/settings/courses');
  const before = await app.readDoc('visits', 'v-soon');

  await page.locator('[data-edit="course-ha-prp"]').click();
  await sys(page, '耀聖').check();
  await page.click('button[type="submit"]');

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('會影響 1 天');
  expect(said).toContain('多 1 張「耀聖」');
  await app.ok();
  await app.saved();

  expect((await app.readDoc(COURSES, 'course-ha-prp')).systems).toEqual(['Abovee', '耀聖']);

  const tasks = alive(await app.readAll('tasks'));
  expect(tasks.map((t) => [t.kind, t.visitId]), '只有談定、還沒到的那一天').toEqual([['耀聖', 'v-soon']]);
  expect(tasks[0].slotIndexes, '記著它掛的是哪一段').toEqual([0]);
  expect(tasks[0].dueDate).toBe(addDays(TODAY, 4));

  // 只寫任務：那一筆來訪連 updatedAt 都沒變（變了就是走到存來訪那條路了）
  const after = await app.readDoc('visits', 'v-soon');
  expect(after.updatedAt).toEqual(before.updatedAt);
  expect(after.slots).toEqual(before.slots);

  // 待辦中心看得到
  await app.go(`/todo/${encodeURIComponent('耀聖')}`);
  await expect(page.locator('#view')).toContainText('客戶A');

  // 再打開存一次（什麼都沒改）：不問、也不多長
  await app.go('/settings/courses');
  await page.locator('[data-edit="course-ha-prp"]').click();
  await page.click('button[type="submit"]');
  await app.saved();
  await expect(app.dialog()).toHaveCount(0);
  expect(alive(await app.readAll('tasks'))).toHaveLength(1);
});

/**
 * 回測報告（種子上三個系統都勾）：三天後那一天談定了、兩張都還沒掛；三天前那一天做完了、Examine 她忘了勾；
 * 四天後那一天的 Examine 掛好了；六天後那一天有一段取消了、「取消 Abovee」收過了。
 */
function seedRetest() {
  const t = (id, visitId, kind, over = {}) => ({
    ...task({ id, customerId: 'cust-a', customerName: '客戶A', kind, dueDate: addDays(TODAY, 2), visitId }),
    ...over,
  });
  const withIdx = (doc, slotIndexes, more = {}) => ({ ...doc, data: { ...doc.data, slotIndexes, ...more } });
  const cancelledDay = visit({
    id: 'v-r4', customerId: 'cust-a', customerName: '客戶A', date: addDays(TODAY, 6), status: 'confirmed',
    slots: [
      { ...slot({ courseId: 'course-retest', entitlementId: 'ent-course-retest', startsAt: '09:00', endsAt: '09:30' }), status: 'cancelled' },
      { ...slot({ courseId: 'course-eecp', entitlementId: 'ent-eecp', startsAt: '14:00', endsAt: '15:00', roomId: 'room-t5' }), status: 'confirmed' },
    ],
  });
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', { id: 'ent-course-retest', label: '回測報告', courseId: 'course-retest', totalQty: 6, doneCount: 1, bookedCount: 2 }),
    entitlement('cust-a', { id: 'ent-eecp', label: 'EECP', courseId: 'course-eecp', totalQty: 10, bookedCount: 1 }),
    oneSlot('v-r1', addDays(TODAY, 3), 'course-retest', 'confirmed'),
    oneSlot('v-r2', addDays(TODAY, -3), 'course-retest', 'done'),
    oneSlot('v-r3', addDays(TODAY, 4), 'course-retest', 'confirmed'),
    cancelledDay,
    withIdx(t('t-r1-ex', 'v-r1', 'Examine'), [0]),
    withIdx(t('t-r1-ys', 'v-r1', '耀聖'), [0]),
    withIdx(t('t-r2-ex', 'v-r2', 'Examine'), [0]),
    withIdx(t('t-r3-ex', 'v-r3', 'Examine'), [0], { done: true, doneAt: `${addDays(TODAY, -1)}T02:00:00.000Z` }),
    withIdx(t('t-r4-cx', 'v-r4', '取消 Abovee'), [0], { done: true, doneAt: `${addDays(TODAY, -1)}T03:00:00.000Z` }),
  ];
}

test('M2 取消勾「Examine」：還沒做的收掉（結案那一天的也收），勾過的不動，一張「取消 X」都不長', async ({ app, page }) => {
  await app.seed(seedRetest());
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-retest"]').click();
  await sys(page, 'Examine').uncheck();
  await page.click('button[type="submit"]');

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('會影響 2 天');
  expect(said).toContain('還沒做的「Examine」收掉 2 張');
  expect(said).toContain('勾過的不動');
  await app.ok();
  await app.saved();

  const all = await app.readAll('tasks');
  const byId = Object.fromEntries(all.map((t) => [t.id, t]));
  expect(Boolean(byId['t-r1-ex'].deletedAt), '談定那一天還沒掛的 Examine').toBe(true);
  expect(Boolean(byId['t-r2-ex'].deletedAt), '結案那一天忘了勾的 Examine').toBe(true);
  expect(byId['t-r1-ex'].done, '收掉不是勾掉').toBe(false);
  expect(byId['t-r3-ex'].deletedAt ?? null, '勾過的一張都不動').toBe(null);
  expect(byId['t-r3-ex'].done).toBe(true);
  expect(byId['t-r1-ys'].deletedAt ?? null, '耀聖還勾著，留著').toBe(null);
  expect(all, '沒有多長任何一張（尤其是取消類）').toHaveLength(5);
});

test('M3 改的是名字：不問，一按就存，待辦一張都沒動', async ({ app, page }) => {
  await app.seed(seedRetest());
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-retest"]').click();
  await page.fill('input[name="name"]', '回測報告（改名）');
  await page.click('button[type="submit"]');
  await app.saved();
  await expect(app.dialog()).toHaveCount(0);

  expect((await app.readDoc(COURSES, 'course-retest')).name).toBe('回測報告（改名）');
  const all = await app.readAll('tasks');
  expect(all.filter((t) => t.deletedAt)).toHaveLength(0);
  expect(all).toHaveLength(5);
});
