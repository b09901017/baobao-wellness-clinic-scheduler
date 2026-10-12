// 「一天只是一個抬頭」（ADR-0089，2026-09-12）。
//
// 她的原話：
//
// > a 盡量能讓使用者一開始分段點就分段點…希望不要點進去就是一整天的
// > b 如果是一整天的詳情，那也請不要呈現"這一天的待辦"和SOP，直接呈現那幾個
// >   分段讓我點就好，點進去再呈現那項的詳情
// > d 我點這一項，應該只需要出現這一項的SOP
// > e 並且也不需要出現改這一整天的按鈕
//
// 單元那一側全部是原始碼掃描（`tests/slot-first.test.js`）——
// 那幾支 view 進不了 node。掃描擋得住「有人把那一行改回去」，擋不住
// 「那一行還在、接線那一端沒把值傳進來」，所以這一支從瀏覽器問同樣的問題。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, playbook, task, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = TODAY;

/**
 * 一位客戶、同一天兩段、兩個不同的課程，各掛一份 SOP，另外掛一份合作機構的。
 *
 * 兩個課程是為了問「SOP 只浮這一段的嗎」——
 * 同一個課程的話兩段浮出來的是同一份，那就測不到東西。
 */
function seedTwoCourses() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '王小明', partners: ['自然美'] }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser', 'eq-ilib'],
      totalQty: 20, bookedCount: 2, durationMin: 30,
    }),
    entitlement('cust-x', {
      id: 'ent-drip', label: '營養點滴（60）', type: 'single',
      courseId: 'course-iv-drip', totalQty: 10, bookedCount: 1, durationMin: 60,
    }),
    playbook({
      id: 'pb-recovery', title: '復能要注意的', courseIds: ['course-recovery'],
      body: '先問有沒有不舒服\n護具要自己帶',
    }),
    playbook({
      id: 'pb-drip', title: '點滴要注意的', courseIds: ['course-iv-drip'],
      body: '飯後打針\n血管難打的先看註記',
    }),
    playbook({
      id: 'pb-partner', title: '自然美對接', courseIds: [],
      body: '報到單要蓋章',
    }),
    task({
      id: 'task-two', customerId: 'cust-x', customerName: '王小明',
      kind: 'Abovee', dueDate: addDays(DAY, -1), visitId: 'v-two',
    }),
    visit({
      id: 'v-two', customerId: 'cust-x', customerName: '王小明',
      date: DAY, status: 'pending_confirm',
      slots: [
        {
          ...slot({
            courseId: 'course-recovery', entitlementId: 'ent-pool',
            startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba',
            therapistId: 'staff-tw',
          }),
          status: 'confirmed',
          note: '她說想換一台',
        },
        {
          ...slot({
            courseId: 'course-iv-drip', entitlementId: 'ent-drip',
            startsAt: '14:00', endsAt: '15:00', roomId: 'room-iv10',
          }),
          status: 'pending_confirm',
        },
      ],
    }),
  ];
}

/** 一位客戶、同一天只有一段。那一天「這一天」與「這一段」是同一件事。 */
function seedOneSlot() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-y', name: '客戶A' }),
    entitlement('cust-y', {
      id: 'ent-one', label: '復能 - 四選一（30）', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis'], totalQty: 10, bookedCount: 1,
      durationMin: 30,
    }),
    playbook({
      id: 'pb-recovery', title: '復能要注意的', courseIds: ['course-recovery'],
      body: '先問有沒有不舒服',
    }),
    visit({
      id: 'v-one', customerId: 'cust-y', customerName: '客戶A',
      date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-one',
        startsAt: '10:00', endsAt: '10:30', equipmentId: 'eq-indiba',
        therapistId: 'staff-tw',
      })],
    }),
    task({
      id: 'task-x', customerId: 'cust-y', customerName: '客戶A',
      kind: 'Abovee', dueDate: addDays(DAY, -1), visitId: 'v-one',
    }),
  ];
}

// ---------- 一整天那一張只是目錄 ----------

test('S1 進度追蹤：每一段自己是一顆按鈕，日期那一列點不下去', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  await expect(
    page.locator('button.progslot[data-visit="v-two"]'),
    '兩段各一顆',
  ).toHaveCount(2);
  await expect(
    page.locator('button.progday'),
    '整天那一顆大按鈕不在了 —— 日期是抬頭不是選項',
  ).toHaveCount(0);

  // 點第二段 → 卡片上只有第二段，副標是第二段的狀態
  await page.locator('[data-visit="v-two"][data-slot="1"]').click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot')).toHaveCount(1);
  await expect(page.locator('.popcard'), '點的是下午那一段').toContainText('14:00');
  await expect(page.locator('.popcard__sub'), '第二段還沒問過客人')
    .toContainText('已壓表，等客戶回覆');
});

test('S2 待辦中心點人名：目錄那一張沒有待辦也沒有 SOP，點一段才有', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/');
  await page.locator('[data-tab="who"]').click();
  await page.locator('[data-who="cust-x"]').click();
  await expect(page.locator('.drawer-backdrop .drawer')).toBeVisible();

  await page.locator('[data-task-visit="v-two"]').first().click();
  await app.layer('.popcard');

  // 目錄：兩段都在，而且一個待辦、一份 SOP 都沒有
  await expect(page.locator('.popcard .readslot')).toHaveCount(2);
  await expect(page.locator('.popcard .taskmirror'), '目錄那一張不畫待辦').toHaveCount(0);
  await expect(page.locator('.popcard .pbhint'), '目錄那一張不畫 SOP').toHaveCount(0);

  // 每一段自己那一列印得出它記的那一句
  await expect(page.locator('.popcard .readslot').first(), '那一句長在自己那一列裡')
    .toContainText('她說想換一台');

  // 點第一段 → 這時候才有待辦
  await page.locator('.popcard .readslot[data-open]').first().click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot')).toHaveCount(1);
  await expect(page.locator('.popcard'), '抬頭只剩這一種說法').toContainText('這一項的待辦');
  await expect(page.locator('.popcard'), '整天那一種說法沒有了').not.toContainText('這一天的待辦');
});

// ---------- 一張待辦的詳情只開它那幾段（asks-2026-09-24/issues/08） ----------
//
// 她 2026-09-24：「為甚麼不是只呈現真的被取消的那幾段?而是其他段也會顯示出來 ?」
// 單元那一側測 `taskSlots()`；這一支問三個入口有沒有真的把「是哪一張」傳進去。

test('S2b 只掛下午那一段的 Examine：三個入口的「詳情」都直接是那一段、分類頁寫 1 項', async ({ app, page }) => {
  const pm = {
    path: 'tasks', id: 'task-pm',
    data: {
      customerId: 'cust-x', customerName: '王小明', kind: 'Examine', dueDate: addDays(DAY, -1),
      visitId: 'v-two', done: false, doneAt: null, autoGenerated: true, note: null, slotIndexes: [1],
    },
  };
  await app.seed([...seedTwoCourses(), pm]);
  const onlyAfternoon = async (where) => {
    await app.layer('.popcard');
    await expect(page.locator('.popcard .readslot'), `${where}：只有那一段`).toHaveCount(1);
    await expect(page.locator('.popcard'), `${where}：是下午那一段`).toContainText('14:00');
  };

  await app.signIn(`/todo/${encodeURIComponent('Examine')}`);
  await expect(page.locator('[data-slots="task-pm"]'), '數的是這一張的段，不是整天').toHaveText('1 項');
  await page.locator('[data-task-id="task-pm"]').click();
  await onlyAfternoon('分類頁');

  await app.go('/');
  await page.locator('[data-tab="who"]').click();
  await page.locator('[data-who="cust-x"]').click();
  await expect(page.locator('.drawer-backdrop .drawer')).toBeVisible();
  await page.locator('.drawer [data-tasklist-task="task-pm"]').click();
  await onlyAfternoon('依客戶抽屜');

  await app.go('/customers/cust-x');
  await page.locator('[data-tasklist-task="task-pm"]').click();
  await onlyAfternoon('客戶詳情');
});

test('S2c 取消兩段的那一張：一段一行小字，系統寫的那一句不畫、連 ? 都沒有（asks-2026-09-24-evening/issues/01）', async ({ app, page }) => {
  // 她：「他會寫 : 2026-9-24 有一段取消了..........其實完全不用寫，畢竟標題就寫了取消above」
  // 9/24 晚：「c改時間/取消"2026-09-08的來訪取消了....放掉"不需要，是多餘的」—— 連收進 ? 都不要
  const said = `${DAY} 有一段取消了，回去把 Abovee 上壓的那個時段放掉`;
  const both = {
    path: 'tasks', id: 'task-cx',
    data: {
      customerId: 'cust-x', customerName: '王小明', kind: '取消 Abovee', dueDate: DAY,
      visitId: 'v-two', done: false, doneAt: null, autoGenerated: true, note: said, slotIndexes: [0, 1],
    },
  };
  await app.seed([...seedTwoCourses(), both]);

  await app.signIn('/todo/cancel');
  const lines = page.locator('[data-taskwhen="task-cx"]');
  await expect(lines).toBeVisible();
  expect((await lines.innerText()).split('\n').filter(Boolean), '兩段兩行').toHaveLength(2);
  await expect(page.locator('#view'), '系統那一句不再常駐').not.toContainText('有一段取消了');
  // 那一顆 ? 以前夾在種類與「N 項」兩顆標籤中間；頁標題那一顆（「來訪取消後，要回去…」）也拿掉了
  await expect(page.locator('#view .tip'), '改時間／取消這一頁一顆 ? 都沒有').toHaveCount(0);

  await app.go('/customers/cust-x');
  await expect(page.locator('.note__lines').first()).toBeVisible();
  await expect(page.locator('#view'), '客戶詳情也一樣').not.toContainText('有一段取消了');
  await expect(page.locator('.taskrow .tip'), '客戶詳情的待辦那幾列沒有 ?').toHaveCount(0);
});

test('S2d 跟標題講同一件事的 ? 拿掉，Examine 那一顆留著（asks-2026-09-24-evening/issues/01）', async ({ app, page }) => {
  // 她：「a追蹤健檢報告那邊的待辦，不需要提醒"健檢做完了，去問報告出來沒" 這是多餘的話」
  // 「b簽療程單那邊寫的"有幾段到現在還是.....沒來就打叉"看不懂且沒必要，是多餘的」
  const past = addDays(DAY, -2);
  await app.seed([
    ...seedTwoCourses(),
    task({
      id: 'task-report', customerId: 'cust-x', customerName: '王小明',
      kind: '追蹤健檢報告', dueDate: addDays(DAY, 10), note: '健檢做完了，去問報告出來了沒',
    }),
    task({
      id: 'task-exam', customerId: 'cust-x', customerName: '王小明',
      kind: 'Examine', dueDate: addDays(DAY, 3), visitId: 'v-two',
    }),
    // 日子過了還是「待確認」的那一段 —— 以前簽療程單那張卡上會多一顆 ?
    visit({
      id: 'v-past', customerId: 'cust-x', customerName: '王小明', date: past, status: 'pending_confirm',
      slots: [{
        ...slot({ courseId: 'course-recovery', entitlementId: 'ent-pool', startsAt: '10:00', endsAt: '10:30',
          equipmentId: 'eq-sis', therapistId: 'staff-tw' }),
        status: 'pending_confirm',
      }],
    }),
  ]);

  await app.signIn(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await expect(page.locator('#view')).toContainText('王小明');
  await expect(page.locator('#view .tip'), '追蹤健檢報告：標題與那一列都沒有 ?').toHaveCount(0);
  await expect(page.locator('#view')).not.toContainText('健檢做完了');

  await app.go('/todo/close');
  await expect(page.locator('[data-open="v-past"]')).toBeVisible();
  await expect(page.locator('#view .tip'), '簽療程單：標題與卡上都沒有 ?').toHaveCount(0);

  await app.go('/todo/overdue');
  await expect(page.locator('#view')).toContainText('王小明');
  await expect(page.locator('.page__title .tip'), '逾期的：「死線已經過去了」拿掉').toHaveCount(0);

  // Examine 那一句是另一個系統上的步驟，不是在重講標題 —— 留著
  await app.go('/todo/Examine');
  await expect(page.locator('#view')).toContainText('王小明');
  await expect(page.locator('.page__title .tip')).toHaveCount(1);
});

// ---------- SOP 跟著段走 ----------

test('S3 點復能那一段：只浮復能那一份，點滴與自然美那兩份都不浮', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-two:"]');
  await page.locator('[data-open^="visit:v-two:"]').first().click();
  await app.layer('.popcard');

  const card = page.locator('.popcard');
  await expect(card).toContainText('復能要注意的');
  await expect(card, '別段的 SOP 不該浮出來').not.toContainText('點滴要注意的');
  await expect(card, '掛機構的那一份也一起收掉了').not.toContainText('自然美對接');
});

// ---------- 一天只有一段 ----------

test('S4 只有一段的那一天：直接就是那一段的詳情，不是一張一列的目錄', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await app.go('/customers/progress');

  await page.locator('[data-visit="v-one"]').first().click();
  await app.layer('.popcard');

  await expect(page.locator('.popcard .readslot')).toHaveCount(1);
  await expect(page.locator('.popcard .taskmirror'), '那一天就是那一段，待辦要看得到')
    .toHaveCount(1);
  await expect(page.locator('.popcard')).toContainText('這一項的待辦');
});

// ---------- 整天那幾顆不在了 ----------

test('S5 只有一段的那一天照樣取消得掉，而且填得了理由', async ({ app, page }) => {
  await app.seed(seedOneSlot());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-one:"]');

  const row = page.locator('[data-open^="visit:v-one:"]').first();
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();

  const menu = page.locator('.drawer--actions');
  await expect(menu, '單段那一天不可以一顆取消都沒有').toContainText('取消這一段');
  await expect(menu, '整天那一顆拿掉了').not.toContainText('取消一整天');
  await expect(menu, '改整天那一顆也拿掉了').not.toContainText('改這一天');

  await page.locator('.actionrow', { hasText: '取消這一段' }).click();
  await expect(app.dialog()).toBeVisible();
  await page.locator('[data-dialog-field]').fill('客人要改時間');
  await app.ok();
  await app.saved();

  const v = await app.readDoc('visits', 'v-one');
  expect(v.status, '最後一段取消掉，整筆跟著變').toBe('cancelled');
  expect(v.cancelReason, '那一格「為什麼」要跟著搬過來').toBe('客人要改時間');
});

test('S6 鉛筆開的那一張沒有整天的狀態卡與刪除', async ({ app, page }) => {
  await app.seed(seedTwoCourses());
  await app.signIn('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-two:"]');
  await page.locator('[data-open^="visit:v-two:"]').first().click();
  await app.layer('.popcard');

  await expect(page.locator('.popcard [data-edit-day]'), '那一顆拿掉了').toHaveCount(0);

  await page.locator('.popcard [data-card-edit]').click();
  await app.layer('[data-form]');
  await expect(page.locator('[data-status]'), '整天的狀態卡不在了').toHaveCount(0);
  await expect(page.locator('[data-delete]'), '刪除這一天沒有路了').toHaveCount(0);
});
