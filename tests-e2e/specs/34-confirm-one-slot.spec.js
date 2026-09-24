// 「確認」也是逐段的（ADR-0097，2026-09-16）。
//
// 她的原話：
//
// > 如果在新增同一個人兩段來訪，然後我只長按其中一段，說客戶已確認，會變成
// > 整天的都變成已確認，能不能我那個時段說確認就那個時段確認就好，然後如果
// > 我想要一次確認整天，我可以去代辦那邊做，然後我這邊確認了某個時段
// > 客戶已確認後 待辦那邊的這個時段就可以收掉
//
// > 我發現這一項代辦，的跟客人確認時間沒有寫的符合事實，也就是如果這天A
// > 已經有兩個已確認的時段如果我新增一個來訪 那原本已確認的那兩個的那一項的
// > 待辦中的跟客人確認時間 就會被取消打勾？
//
// 單元那一側（`tests/visits.test.js`、`tests/todo-flow.test.js`、`tests/tasks.test.js`）
// 問的是「domain 算得對嗎」。這一支從瀏覽器問「接線那一端真的把 slotIndex
// 傳下去了嗎」—— 2026-09-16 之前壞的正是接線：`applyStatus()` 早就收 slotIndex，
// 只有取消那一條路傳了。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const DAY = TODAY;

/**
 * 一位客戶、同一天兩段：上午一段 A 類（復健科醫師門診），下午一段 C 類（復能）。
 *
 * **兩個類別不一樣是刻意的**：A 類確認之後會長 Examine 與耀聖，C 類不會
 * （`RULES`）。同類的話「只有那一段的掛號長出來」就測不到。
 */
function seedTwoSlots({ first = 'pending_confirm', second = 'pending_confirm' } = {}) {
  const v = {
    id: 'v-two', customerId: 'cust-x', customerName: '王小明',
    date: DAY,
    slots: [
      { ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt: '09:00', endsAt: '09:30' }), status: first },
      {
        ...slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '14:00', endsAt: '14:30', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        }),
        status: second,
      },
    ],
  };
  // 整筆那一格是**推導出來又存起來的**（ADR-0081）：由「還沒定案」往「定案」比。
  const status = [first, second].includes('pending_confirm') ? 'pending_confirm' : 'confirmed';
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '王小明' }),
    entitlement('cust-x', {
      id: 'ent-rehab', label: '復健科醫師門診', type: 'single',
      courseId: 'course-rehab', totalQty: 6, bookedCount: 1, durationMin: 30,
    }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能-三選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
      totalQty: 20, bookedCount: 1, durationMin: 30,
    }),
    visit({ ...v, status, confirmedAt: status === 'confirmed' ? new Date().toISOString() : null }),
  ];
}

/** 那一天的抽屜。`[data-day]` 只在月檢視的格子上，所以不切檢視（同 spec 20）。 */
async function openDayDrawer(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
}

/**
 * 長按第 n 列。用真的滑鼠事件 —— `wireLongPress()` 只認 `isPrimary` 的主鍵
 *（同 spec 20 的 `longPressRow()`）。
 */
async function longPressRow(page, index) {
  const row = page.locator('[data-open^="visit:v-two:"]').nth(index);
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
}

// ---------- 01：長按那一段說確認，只確認那一段 ----------

test('C1 長按上午那一段說「客戶說可以」，下午那一段還是待確認', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  // 一列的 class 是 `statusClass()` 給的，而它讀的是 `slotStatus()`（ADR-0081）。
  // **這一條就是她報的那個 bug**：2026-09-16 之前兩列都會變成 `status-confirmed`。
  const rows = page.locator('[data-open^="visit:v-two:"]');
  await expect(rows).toHaveCount(2);
  await expect(
    page.locator('.timerow.status-confirmed'),
    '只有她長按的那一段談定了',
  ).toHaveCount(1);
  // **class 是 `statusClass()` 給的**，而 `pending_confirm` 那一個叫
  // `status-pending`（`STATUS_VIEW`）—— 不是狀態字串本身。
  await expect(
    page.locator('.timerow.status-pending'),
    '下午那一段一個字都沒動',
  ).toHaveCount(1);
});

test('C2 已經談定的那一段，長按選單上沒有「客戶說可以」', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  // 整筆是「待確認」（下午那一段還沒問），但上午那一段自己已經談定了。
  await longPressRow(page, 0);
  await expect(
    page.locator('.drawer--actions'),
    '那一段已經談定了 —— 拿整筆的狀態問會在這裡長出一顆',
  ).not.toContainText('客戶說可以');

  // 「先不要，回去」不是一列，是選單自己那一顆（`actions.js` 的 `[data-actions-close]`）。
  // **那個屬性有兩個節點**：抽屜頂端那條 grip 也帶著它，所以要指名那一顆。
  await page.locator('button.actions__cancel').click();
  await expect(page.locator('.drawer--actions')).toHaveCount(0);

  await longPressRow(page, 1);
  await expect(
    page.locator('.drawer--actions'),
    '下午那一段還沒問過客人',
  ).toContainText('客戶說可以');
});

// ---------- 02：讀取卡片上那兩列照那一段算 ----------

test('C3 讀取卡片：談定那一段的「跟客人確認時間」打勾，沒問的那一段沒有', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  const rows = page.locator('[data-open^="visit:v-two:"]');

  await rows.nth(0).click();
  await app.layer('.popcard');
  const done = page.locator('.taskmirror__row', { hasText: '跟客人確認時間' });
  await expect(done, '那一段早就談定了').toHaveClass(/is-done/);

  // 那張卡用它自己那顆 ×（`card.js` 的 `[data-card-close]`）。關掉之後底下
  // 那張抽屜還在 —— `openDayDrawer()` 會重新 `go('/calendar')`，那一下會被
  // 還沒關掉的卡片擋住。
  await page.locator('[data-card-close]').click();
  await expect(page.locator('.popcard')).toHaveCount(0);

  await page.locator('[data-open^="visit:v-two:"]').nth(1).click();
  await app.layer('.popcard');
  await expect(
    page.locator('.taskmirror__row', { hasText: '跟客人確認時間' }),
    '這一段還沒問過 —— 整筆退回待確認不可以害另一段跟著退回',
  ).not.toHaveClass(/is-done/);
});

// ---------- 03：待辦中心的確認抽屜只列還沒談定的那幾段 ----------

test('C4 待辦中心：談定的那一段收掉了，抽屜裡只剩沒問過的那一段', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/');
  await app.go('/todo/confirm');
  await app.settled();

  // 她的原話：「我這邊確認了某個時段客戶已確認後 待辦那邊的這個時段就可以收掉」
  await expect(page.locator('.card', { hasText: '王小明' })).toContainText('壓了 1 段');

  await page.locator('[data-open="cust-x"]').click();
  await expect(page.locator('.drawer-backdrop .drawer')).toBeVisible();

  const slots = page.locator('.drawer .slotrow');
  await expect(slots, '談定的那一段不再列出來').toHaveCount(1);
  await expect(slots.first()).toContainText('14:00');
  await expect(page.locator('.drawer'), '上午那一段已經談定了').not.toContainText('09:00');
});

// 按下去之後那張卡片也只講抽屜上那幾段。上午那一段（A 類）在日曆上確認的那一刻
// Examine／耀聖就長了 —— 再說一次「待辦會多一張 Examine」是假話（ADR-0070）。
test('C6 確認抽屜上僅剩那一段：卡片寫 1 段，不說會多 Examine', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/');
  await app.go('/todo/confirm');
  await app.settled();

  await page.locator('[data-open="cust-x"]').click();
  await app.tickAll();
  await expect(page.locator('[data-apply]')).toContainText('確認 1 段');
  await page.locator('[data-apply]').click();
  await app.saved();

  const card = page.locator('.popcard');
  await expect(card).toBeVisible();
  await expect(card.locator('[data-card-sub]'), '她按的是「確認 1 段」').toHaveText('1 段');
  await expect(card, '上午那一段不是這一次確認的').not.toContainText('09:00');
  await expect(card, '那兩張早就長了').not.toContainText('Examine');

  const saved = await app.readDoc('visits', 'v-two');
  expect(saved.slots.map((s) => s.status)).toEqual(['confirmed', 'confirmed']);
});

test('C7 把抽屜上僅剩那一段退掉：講的是退掉，上午那一段照舊', async ({ app, page }) => {
  await app.seed(seedTwoSlots({ first: 'confirmed' }));
  await app.signIn('/');
  await app.go('/todo/confirm');
  await app.settled();

  await page.locator('[data-open="cust-x"]').click();
  await page.locator('.drawer [data-pick][data-to="0"]').first().click();
  // 一段「可以」都沒有就是取消，不可逆 —— 先問一次（prelaunch-audit-2026-09-23/issues/12）
  await expect(page.locator('[data-apply]')).toContainText('取消這 1 段');
  await page.locator('[data-apply]').click();
  await expect(app.dialog(), '上午那一段不受影響').toContainText('剩下的 1 段不受影響');
  await app.ok();
  await app.saved();

  // 整筆停在「已確認」（上午那一段談定了），但她這一下退掉的是這張上的全部
  await expect(page.locator('#toast')).toContainText('取消');
  await expect(page.locator('.popcard'), '一段都沒確認，不畫「已確認」那張卡').toHaveCount(0);

  const saved = await app.readDoc('visits', 'v-two');
  expect(saved.slots.map((s) => s.status)).toEqual(['confirmed', 'cancelled']);
});

// 以前寫「全部退回未確認」，按下去卻是整天取消、時段放出去、長「取消 Abovee」，
// 而且沒有再問一次（prelaunch-audit-2026-09-23/issues/12）。
test('C8 抽屜上每一段都是「客人說不行」：按鈕講取消，先問一次，講得出會長「取消 Abovee」', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/');
  await app.go('/todo/confirm');

  await page.locator('[data-open="cust-x"]').click();
  await page.locator('.drawer [data-pick][data-to="0"]').nth(0).click();
  await page.locator('.drawer [data-pick][data-to="0"]').nth(1).click();
  await expect(page.locator('[data-apply]')).toContainText('客人都不行，取消這 2 段');
  await expect(page.locator('[data-apply]')).not.toContainText('退回');

  await page.locator('[data-apply]').click();
  await expect(app.dialog()).toContainText('取消 Abovee');
  await expect(app.dialog()).toContainText('那一天就整個取消了');
  await app.cancelDialog();
  expect((await app.readDoc('visits', 'v-two')).status, '按「先不要」什麼都沒寫').toBe('pending_confirm');

  await page.locator('[data-apply]').click();
  await app.ok();
  await app.saved();
  const saved = await app.readDoc('visits', 'v-two');
  expect(saved.slots.map((sl) => sl.status)).toEqual(['cancelled', 'cancelled']);
  const kinds = (await app.readAll('tasks')).filter((t) => !t.deletedAt).map((t) => t.kind);
  expect(kinds).toContain('取消 Abovee');
});

// ---------- 04：那一段確認了，那一段的掛號才長出來 ----------

test('C5 確認 C 類那一段不長掛號，確認 A 類那一段才長', async ({ app, page }) => {
  await app.seed(seedTwoSlots());
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  // 先確認下午那一段（C 類，`onConfirm` 是空的）
  await longPressRow(page, 1);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  await app.go('/');
  await app.settled();
  await expect(page.locator('body'), 'C 類確認之後沒有後續登記').not.toContainText('Examine');

  // 再確認上午那一段（A 類）
  await openDayDrawer(app, page);
  await longPressRow(page, 0);
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  await app.go('/');
  await app.settled();
  // 2026-09-16 之前閘門看整筆：下午那一段還沒確認時整筆停在待確認，
  // 上午那一段的掛號一張都不長 —— 而她已經可以去 Abovee 壓那一格了。
  await expect(page.locator('body'), 'A 類那一段確認了就該長').toContainText('Examine');
  await expect(page.locator('body')).toContainText('耀聖');
});

// ---------- 掛號逐段（prelaunch-audit-2026-09-23/issues/02） ----------
//
// 同一天：早上復能、10:00 門診（掛好號之後取消了）、15:00 補排的門診。15:00 那一段談定了，
// 要長它自己那一張 Examine、耀聖 —— 以前「一天一種一張」，一張都不長。
test('C9 取消了 10:00 門診、補排 15:00：長按 15:00 說可以 → 那一段自己長 Examine、耀聖', async ({ app, page }) => {
  const rebooked = {
    id: 'v-two', customerId: 'cust-x', customerName: '王小明', date: DAY, status: 'pending_confirm',
    slots: [
      {
        ...slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool', startsAt: '08:00', endsAt: '08:30',
          equipmentId: 'eq-indiba', therapistId: 'staff-tw',
        }),
        status: 'confirmed',
      },
      { ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt: '10:00', endsAt: '10:30' }), status: 'cancelled' },
      { ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt: '15:00', endsAt: '15:30' }), status: 'pending_confirm' },
    ],
  };
  const seed = seedTwoSlots().filter((d) => d.path !== 'visits');
  const registered = (id, kind) => ({
    path: 'tasks', id,
    data: {
      customerId: 'cust-x', customerName: '王小明', kind, dueDate: DAY, visitId: 'v-two',
      done: true, doneAt: DAY, autoGenerated: true, note: null, slotIndexes: [1],
    },
  });
  await app.seed([...seed, visit(rebooked), registered('t-ex', 'Examine'), registered('t-yao', '耀聖')]);
  await app.signIn('/calendar');
  await openDayDrawer(app, page);

  const row = page.locator('[data-open="visit:v-two:2"]');
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();

  // 10:00 那一段的「取消 X」也會長（種子沒放），這裡只看掛號那一族
  const open = (await app.readAll('tasks'))
    .filter((t) => !t.deletedAt && !t.done && ['Examine', '耀聖'].includes(t.kind));
  expect(open.map((t) => [t.kind, t.slotIndexes]).sort()).toEqual([['Examine', [2]], ['耀聖', [2]]]);
});

test('C10 同一天兩張 Examine：待辦中心與客戶詳情各自印出它掛的那一段（issues/21）', async ({ app, page }) => {
  const two = {
    id: 'v-two', customerId: 'cust-x', customerName: '王小明', date: DAY, status: 'confirmed',
    slots: [
      { ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt: '10:00', endsAt: '10:30' }), status: 'confirmed' },
      { ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt: '15:00', endsAt: '15:30' }), status: 'confirmed' },
    ],
  };
  const examine = (id, i) => ({
    path: 'tasks', id,
    data: {
      customerId: 'cust-x', customerName: '王小明', kind: 'Examine', dueDate: DAY, visitId: 'v-two',
      done: false, doneAt: null, autoGenerated: true, note: null, slotIndexes: [i],
    },
  });
  const seed = seedTwoSlots().filter((d) => d.path !== 'visits');
  await app.seed([...seed, visit(two), examine('t-am', 0), examine('t-pm', 1)]);

  await app.signIn(`/todo/${encodeURIComponent('Examine')}`);
  const lines = page.locator('.row__sub');
  await expect(lines.filter({ hasText: '10:00' }), '上午那一張').toHaveCount(1);
  await expect(lines.filter({ hasText: '15:00' }), '下午那一張').toHaveCount(1);

  await app.go('/customers/cust-x');
  await expect(page.locator('#view')).toContainText('10:00');
  await expect(page.locator('#view')).toContainText('15:00');
});

test('C11 壓表：門診早就掛好號的那一天，加一段身體組成不說會多 Examine；再加一段門診才說（issues/22）', async ({ app, page }) => {
  const day = '2026-09-14';
  const settled = {
    id: 'v-day', customerId: 'cust-x', customerName: '王小明', date: day, status: 'confirmed',
    slots: [{ ...slot({ courseId: 'course-rehab', entitlementId: 'ent-rehab', startsAt: '09:00', endsAt: '09:30' }), status: 'confirmed' }],
  };
  const registered = (id, kind) => ({
    path: 'tasks', id,
    data: {
      customerId: 'cust-x', customerName: '王小明', kind, dueDate: '2026-09-13', visitId: 'v-day',
      done: false, doneAt: null, autoGenerated: true, note: null, slotIndexes: [0],
    },
  });
  const seed = seedTwoSlots().filter((d) => d.path !== 'visits');
  await app.seed([
    ...seed,
    entitlement('cust-x', {
      id: 'ent-inbody', label: '身體組成分析', type: 'single', courseId: 'course-inbody', totalQty: 4, durationMin: 20,
    }),
    visit(settled), registered('t-ex', 'Examine'), registered('t-yao', '耀聖'),
  ]);
  await app.signIn('/');

  await app.go('/schedule');
  await page.locator('[data-month="2026-09"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-x"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${day}"]`).first().click();

  const bookingDialog = async (ent, time) => {
    await app.layer(`[data-ent="${ent}"]`);
    await page.locator(`[data-ent="${ent}"]`).click();
    await page.locator(`[data-time="${time}"]`).click();
    await page.locator('[data-add]').click();
    while (!(await app.dialogText()).includes('已確認，記錄')) await app.ok();
    return app.dialogText();
  };

  expect(await bookingDialog('ent-inbody', '15:00'), '門診那一段早就掛好號了').not.toContain('等客人說可以之後');
  await app.cancelDialog();

  expect(await bookingDialog('ent-rehab', '16:00'), '新加的門診那一段自己要掛').toContain('會再多一張「Examine」、一張「耀聖」');
});
