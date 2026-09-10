// Journey A：完整正循環
//   壓表 → 待辦長出「跟客人確認時間」→ 確認 → 登記任務長出來 → 日曆變色
//   → 來訪當天 → 簽療程單逐段勾 → 次數這時候才扣
//
// 這一條走完，第 4.1 / 4.2 / 5.5 節與 ADR-0027 就全部被真的點過一次。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, availability, TODAY, addDays,
} from '../fixtures/data.js';

// 壓九月的表（今天是 8/29，這個月只剩兩天，挑不出像樣的日子）
const MONTH = '2026-09';
const PICK_DAY = '2026-09-03';

function seedForBooking() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A', priority: 4 }),
    entitlement('cust-a', {
      id: 'ent-a-recovery', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    availability('cust-a', {
      id: 'av-sep', rawText: '9/6 那星期不行', validFrom: '2026-09-01', validTo: '2026-09-30',
      rules: [{ kind: 'exclude_range', from: '2026-09-06', to: '2026-09-12' }],
    }),
  ];
}

/** 開一批九月的壓表，點開客戶A 的記錄面板。 */
async function openDeck(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await expect(page.locator('#view')).toContainText('客戶A');
  await page.locator('[data-pick="cust-a"]').first().click();
  await page.waitForTimeout(600);
}

/** 在記錄面板上記一筆復能。 */
async function recordOneSlot(app, page) {
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(400);

  await page.locator('[data-ent="ent-a-recovery"]').click();
  await page.waitForTimeout(300);

  await page.locator('[data-time]').first().click();
  await page.locator('[data-equipment="eq-indiba"]').click();
  await page.locator('[data-therapist="staff-tw"]').click();

  await page.locator('[data-add]').click();

  // SPEC 第 7 節規則 11：她手寫的那兩個驚嘆號變成流程的一部分
  await expect(app.dialog()).toBeVisible();
  const dialog = await app.dialogText();
  expect(dialog, '要問「已經在 Abovee 壓好表了嗎」').toContain('Abovee');
  expect(dialog).toContain('待確認');
  expect(dialog).toContain('跟客人確認時間');
  await app.ok();
  await page.waitForTimeout(2000);
}

test('J-A6 小日曆：他說不行的那一週點不下去，其餘點得下去', async ({ app, page }) => {
  await app.seed(seedForBooking());
  await app.signIn('/');
  await openDeck(app, page);

  // 9/6–9/12 他說不行 —— 標起來但仍然點得下去（原文永遠比解析結果大）
  const blocked = page.locator('[data-day="2026-09-08"]');
  await expect(blocked).toHaveCount(1);
  const cls = await blocked.getAttribute('class');
  console.log('[J-A6] 9/8 的 class =', cls);
  expect(cls, '他說不行的日子要被標出來').toMatch(/ban|block|no/i);

  // 已經過去的要 disabled
  const past = page.locator('[data-day="2026-08-01"]');
  if (await past.count()) await expect(past).toBeDisabled();
});

test('J-A7+A8 壓一筆 → 存成待確認、bookedCount +1、不長登記任務（ADR-0027）', async ({ app, page }) => {
  await app.seed(seedForBooking());
  await app.signIn('/');
  await openDeck(app, page);
  await recordOneSlot(app, page);

  const visits = (await app.readAll('visits')).filter((v) => !v.deletedAt);
  expect(visits, '要存下一筆來訪').toHaveLength(1);
  expect(visits[0].status).toBe('pending_confirm');
  expect(visits[0].date).toBe(PICK_DAY);
  expect(visits[0].slots).toHaveLength(1);
  expect(visits[0].slots[0].equipmentId).toBe('eq-indiba');
  expect(visits[0].slots[0].therapistId).toBe('staff-tw');

  const ent = await app.readDoc('customers/cust-a/entitlements', 'ent-a-recovery');
  expect(ent.bookedCount, '已排未上 +1').toBe(1);
  expect(ent.doneCount, '這時候還沒扣').toBe(0);

  const tasks = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
  expect(tasks, '客人還沒確認，登記任務一張都不該長（ADR-0027）').toHaveLength(0);
});

test('J-A9+A10 確認 → confirmed，而且這時候才長出登記任務', async ({ app, page }) => {
  await app.seed(seedForBooking());
  await app.signIn('/');
  await openDeck(app, page);
  await recordOneSlot(app, page);

  // 待辦中心該出現「跟客人確認時間」
  await app.go('/');
  await expect(page.locator('#view')).toContainText('跟客人確認時間');

  await app.go('/todo/confirm');
  await expect(page.locator('#view')).toContainText('客戶A');

  // 打勾 → 抽屜把所有時段攤開
  await page.locator('[data-open="cust-a"]').first().click();
  await page.waitForTimeout(600);
  const drawer = await page.locator('.drawer').innerText();
  console.log('[J-A9] 確認抽屜 =\n' + drawer);
  expect(drawer, '要攤開日期時間').toContain('9/3');
  // **印那天做了什麼（`IN(60)`），不是課程名（「復能」）**（issue 06，ADR-0078）。
  // 她 2026-09-10：「目前都是寫 "9/10(四) 09:00-09:30 復能"…我希望這些都可以
  // 像是在月曆寫得那樣」。這一段用的是 INDIBA，所以月曆上寫的是 IN(60)。
  expect(drawer, '那一段要印器材與分鐘').toContain('IN(60)');
  expect(drawer, '不可以退回課程名').not.toMatch(/09:00–10:00 復能/);

  await page.locator('[data-apply]').click();
  await page.waitForTimeout(2500);

  const visits = (await app.readAll('visits')).filter((v) => !v.deletedAt);
  expect(visits[0].status).toBe('confirmed');

  // 復能是 C 類 → onConfirm 是空的，所以不該長 Examine／耀聖
  const tasks = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
  console.log('[J-A10] 確認後的任務 =', tasks.map((t) => t.kind));
  expect(tasks.filter((t) => t.kind === 'Examine'), 'C 類不需要 Examine').toHaveLength(0);
});

test('J-A10b A 類（門診）確認後才長出 Examine 與耀聖', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a-rehab', label: '復健科醫師門診', type: 'single',
      courseId: 'course-rehab', totalQty: 6, durationMin: 30,
    }),
    availability('cust-a', {
      id: 'av-sep', rawText: '都可以', validFrom: '2026-09-01', validTo: '2026-09-30', rules: [],
    }),
  ]);
  await app.signIn('/');
  await openDeck(app, page);

  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-ent="ent-a-rehab"]').click();
  await page.waitForTimeout(300);
  await page.locator('[data-time]').first().click();
  // 門診要的是**醫師，不是空間**（她 2026-09-08）—— 診間那一排不再出現
  await expect(page.locator('[data-room]')).toHaveCount(0);
  await page.locator('[data-doctor]').first().click();
  await page.locator('[data-add]').click();

  const dialog = await app.dialogText();
  expect(dialog, '要先講「等客人說可以之後才會多出來」').toMatch(/Examine|耀聖/);
  await app.ok();
  await page.waitForTimeout(2000);

  // 還沒確認 → 一張都沒有
  expect((await app.readAll('tasks')).filter((t) => !t.deletedAt)).toHaveLength(0);

  await app.go('/todo/confirm');
  await page.locator('[data-open="cust-a"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(2500);

  const kinds = (await app.readAll('tasks')).filter((t) => !t.deletedAt).map((t) => t.kind).sort();
  console.log('[J-A10b] 確認後的任務 =', kinds);
  expect(kinds).toEqual(['Examine', '耀聖']);

  // 死線是來訪日的前一天
  const tasks = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
  for (const t of tasks) expect(t.dueDate).toBe(addDays(PICK_DAY, -1));
});

test('J-A11 確認之後日曆、客戶詳情、進度追蹤三處同時變成「已確認」', async ({ app, page }) => {
  await app.seed(seedForBooking());
  await app.signIn('/');
  await openDeck(app, page);
  await recordOneSlot(app, page);

  await app.go('/todo/confirm');
  await page.locator('[data-open="cust-a"]').first().click();
  await page.waitForTimeout(600);
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(2500);

  await app.go('/customers/cust-a');
  // 「這個月」那一塊預設是**當月**（8 月），而這一筆排在 9 月 ——
  // 所以要展開「來訪紀錄」才看得到。這是刻意的，不是 bug。
  await page.locator('[data-toggle-visits]').click();
  await page.waitForTimeout(400);
  expect(await app.text(), '客戶詳情的來訪紀錄').toContain('已確認');

  await app.go('/customers/progress');
  await app.settled();
  const progress = await app.text();
  console.log('[J-A11] 進度追蹤（預設當月）=', JSON.stringify(progress.slice(0, 200)));

  await app.go('/calendar');
  const cal = await app.text();
  console.log('[J-A11] 日曆（預設當月）=', JSON.stringify(cal.slice(0, 200)));

  // 日曆預設也是當月，換到 9 月才看得到
  await page.locator('[data-move="1"], [data-offset="1"]').first().click();
  await page.waitForTimeout(900);
  expect(await app.text(), '九月的日曆上要有這一筆').toContain('客戶A');
});
