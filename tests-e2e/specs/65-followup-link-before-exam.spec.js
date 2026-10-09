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

// ---------- 05 簽療程單：二返接的那一次健檢還沒做完，✓ 按不下去 ----------

test('L2 二返接在還沒做完的健檢上、二返那一天先到：✓ 按不下去、講出原因；「全部 ✓」跳過它；✗ 照樣按得下去', async ({ app, page }) => {
  await app.seed([
    ...seedTwoExams().filter((d) => d.id !== 't-old-book'),
    // 健檢（B）在明天；二返約在今天、接在 B 上（日期排錯了，或客人先來聽別的）
    visit({
      id: 'v-second', customerId: 'cust-a', customerName: '客戶A', date: TODAY, status: 'confirmed',
      slots: [
        { ...slot({ courseId: 'course-followup', entitlementId: 'ent-second', startsAt: '10:00', endsAt: '10:30' }),
          status: 'confirmed', followupForVisitId: 'v-exam' },
        { ...slot({ courseId: 'course-checkup', entitlementId: 'ent-exam', startsAt: '11:00', endsAt: '13:00', roomId: 'room-t3' }),
          status: 'confirmed' },
      ],
    }),
  ]);
  await app.signIn('/');
  await app.go('/todo/close');
  await page.locator('[data-open="v-second"]').click();
  await app.layer('.drawer [data-apply]');

  const yes = page.locator('.drawer [data-pick="0"][data-to="1"]');
  // 補讀那一位的來訪之後才知道那一次健檢還沒做完
  await expect(page.locator('.drawer [data-close-blocked="0"]')).toContainText('接的那一次健檢');
  await expect(yes, '二返的 ✓ 按不下去').toBeDisabled();

  await page.locator('.drawer [data-pick-all]').click();
  await expect(yes, '「全部 ✓」跳過它').toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('.drawer [data-pick="1"][data-to="1"]'), '同一天別段照常').toHaveAttribute('aria-pressed', 'true');
  // 那一列自己講為什麼（上面的 data-close-blocked）；底下那幾句講它留著
  await expect(page.locator('.drawer .dialog__list')).toContainText('還有 1 段先不結');

  await page.locator('[data-apply]').click();
  await app.saved();
  const v = await app.readDoc('visits', 'v-second');
  expect(v.slots[0].status, '二返那一段沒有被簽成做了').toBe('confirmed');
  expect(v.slots[1].status).toBe('done');

  // ✗ 照樣按得下去
  await page.locator('[data-open="v-second"]').click();
  await app.layer('.drawer [data-apply]');
  await page.locator('.drawer [data-pick="0"][data-to="0"]').click();
  await page.locator('[data-apply]').click();
  await app.saved();
  expect((await app.readDoc('visits', 'v-second')).slots[0].status).toBe('no_show');
});

// ---------- 06 健檢取消：確認框講「後面接著一場二返，不會跟著取消」；07 另約一次健檢時講還接在取消的那一次上 ----------

/** 客戶A：健檢（B）約好了，二返已經接在 B 上 */
function seedLinked() {
  return [
    ...seedTwoExams().filter((d) => d.id !== 't-old-book'),
    visit({
      id: 'v-second', customerId: 'cust-a', customerName: '客戶A', date: SECOND_DAY, status: 'confirmed',
      slots: [{
        ...slot({ courseId: 'course-followup', entitlementId: 'ent-second', startsAt: '14:00', endsAt: '14:30' }),
        status: 'confirmed', followupForVisitId: 'v-exam',
      }],
    }),
  ];
}

async function longPress(page, row) {
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

test('L3 日曆長按取消健檢那一段：確認框講後面接著那一場二返、不會跟著取消；二返一個字都沒動', async ({ app, page }) => {
  await app.seed(seedLinked());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${EXAM_DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-exam:"]');
  await longPress(page, page.locator('[data-open^="visit:v-exam:"]').first());
  await page.locator('.actionrow', { hasText: '取消這一段' }).click();

  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('那一場二返接在');
  expect(said).toContain('不會跟著取消');
  expect(said, '叫她重新約好之後回去換').toContain('換「這是哪一次健檢的」');
  await app.ok();
  await app.saved();

  const second = await app.readDoc('visits', 'v-second');
  expect(second.slots[0].status, '二返不自動取消').toBe('confirmed');
  expect(second.slots[0].followupForVisitId, '連結不自動搬、不清掉').toBe('v-exam');
});

test('L4 健檢取消之後另約一次健檢：存檔前那一道講「那一場二返還接在已取消的那一次上」，連結照舊', async ({ app, page }) => {
  await app.seed(seedLinked().map((d) => (d.id === 'v-exam' ? { ...d, data: {
    ...d.data, status: 'cancelled', slots: d.data.slots.map((s) => ({ ...s, status: 'cancelled' })),
  } } : d)));
  await app.signIn('/calendar');
  // 今天她還沒有來訪（健檢與二返在之後那兩天）—— 新的一筆
  await page.locator(`[data-day="${TODAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-a"]').click();
  await app.layer('[data-chip="s0-ent"]');
  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-exam"]').click();
  await page.click('button[type="submit"]');

  // 提醒那一道（還沒選診間之類）先按掉，到「壓好了嗎」那一道看那一句
  let said = '';
  for (let i = 0; i < 3 && await app.dialog().isVisible(); i += 1) {
    // eslint-disable-next-line no-await-in-loop
    said += await app.dialogText();
    // eslint-disable-next-line no-await-in-loop
    await app.ok();
  }
  expect(said).toContain('那一場二返還接在「已取消」的');
  expect(said).toContain('去日曆點那一場二返改「這是哪一次健檢的」');
  await app.saved();
  expect((await app.readDoc('visits', 'v-second')).slots[0].followupForVisitId, '只講不改').toBe('v-exam');
});
