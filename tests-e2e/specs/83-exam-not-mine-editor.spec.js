// 健檢不是我排的：日曆新增與來訪編輯器（2026-11-02，ADR-0169，`.scratch/exam-not-mine/issues/06`）。
//
// 她的原話：
//
// > 我只希望我可以拍照或是自己新增來訪的時候可以直接新增二/n返，然後一樣祭悼行事曆以及試算表，一樣可以選醫生，
// > 一樣會出現耀勝等等或是寫紀錄的待辦，就跟一般n返一樣
// > 1. 日曆新增時，沒有健檢的客人那顆「＋ n返」要直接出現，還是收起來點開才看得到
// > ans : 收起來點開才看得到
//
// 那一顆收在「送的／體驗／其他…」裡再收一層「其他 ▸」；第幾返不預選；按了之後只有醫師、時長、診間那幾排，
// 沒有「這是哪一次健檢的」。盯的是「畫面看起來對、存進去是錯的」：沒按第幾返就存成二返、換回別的一顆之後還帶著標記、
// 既有一段改成帶標記時沒有任何一道確認框。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

const DAY = TODAY;
const EXAM_DATE = addDays(TODAY, -10);

const NOT_MINE = '[data-chip="s0-ent"][data-chip-value="__notmine__"]';
const OTHER = '[data-giftfold-group="extra"]';

/** 別人轉來的客人：身上一筆額度都沒有、一次健檢都沒有（她真的要用的那種）。 */
const strayCustomer = () => customer({ id: 'cust-m', name: '王小明' });

/** 一位做完健檢、二返已經約在今天（扣著二返額度、接著那一次）的客人。 */
function seedLinkedSecond() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-k', name: '陳小強' }),
    entitlement('cust-k', {
      id: 'ent-k-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 1, doneCount: 1, bookedCount: 0, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-k', {
      id: 'ent-k-2nd', label: '二返（8萬健檢）', type: 'single', courseId: 'course-followup',
      totalQty: 1, doneCount: 0, bookedCount: 1, followupForEntitlementId: 'ent-k-exam', durationMin: 30,
    }),
    visit({
      id: 'v-k-exam', customerId: 'cust-k', customerName: '陳小強', date: EXAM_DATE, status: 'done',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-k-exam', startsAt: '09:00', endsAt: '11:00',
        roomId: 'room-t3', attended: true, status: 'done',
      })],
    }),
    visit({
      id: 'v-k-2nd', customerId: 'cust-k', customerName: '陳小強', date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-followup', entitlementId: 'ent-k-2nd', followupForVisitId: 'v-k-exam',
        startsAt: '10:00', endsAt: '10:30', doctorId: 'staff-dr-xia', status: 'confirmed',
      })],
    }),
  ];
}

async function newFromCalendar(app, page, customerId) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-addmenu-toggle]');
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator(`[data-pick="${customerId}"]`).click();
  await app.layer('[data-chip="s0-ent"]');
}

/** 打開「送的／體驗／其他…」（收著才按）→「其他 ▸」→「健檢不是我排的」。 */
async function pickNotMine(page) {
  const fold = page.locator('[data-giftfold]').first();
  if (await fold.getAttribute('data-giftfold') !== 'open') await page.locator('[data-giftfold-more]').first().click();
  await expect(page.locator(NOT_MINE), '收在「其他 ▸」裡：點開之前看不到').toBeHidden();
  await page.locator(OTHER).first().click();
  await page.locator(NOT_MINE).click();
}

test('E1 日曆新增：沒有額度、沒有健檢的客人 → 其他 ▸ → 健檢不是我排的 → 第幾返不預選、沒選擋下來 → 三返、選醫師 → 存：三返、不扣、不接、確認框講那一句；長按客戶說可以之後待辦照二返那門課長', async ({ app, page }) => {
  await app.seed([...masterDocs(), strayCustomer()]);
  await app.signIn('/calendar');
  await newFromCalendar(app, page, 'cust-m');

  // 沒有額度的客人：收合照舊自己打開（foldOpen() 不動），「健檢不是我排的」照樣收在「其他 ▸」裡
  await expect(page.locator('[data-giftfold]')).toHaveAttribute('data-giftfold', 'open');
  await expect(page.locator('[data-giftfold-more]')).toContainText('送的／體驗／其他');
  await expect(page.locator(OTHER)).toBeVisible();
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="__nth__"]'), '沒有健檢 → 沒有「＋ n返」').toHaveCount(0);
  await pickNotMine(page);

  await expect(page.locator(NOT_MINE)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.slothead__what'), '還沒選第幾返：不印二返').toHaveText('健檢不是我排的');
  const nth = page.locator('[data-chip="s0-nmnth"]');
  await expect(nth).toHaveCount(9);
  await expect(nth.first()).toHaveText('二返');
  await expect(page.locator('[data-chip="s0-nmnth"][aria-pressed="true"]'), '不預選').toHaveCount(0);
  await expect(page.locator('[data-chip="s0-exam-nth"]'), '沒有「這是哪一次健檢的」').toHaveCount(0);
  await expect(page.locator('[data-chip="s0-nth"]'), '不是 n返 那一排').toHaveCount(0);

  await page.locator('[data-chip="s0-doc"]', { hasText: '夏' }).click();
  await page.locator('button[type="submit"]').first().click();
  await expect(page.locator('[data-errors]')).toContainText('先選第幾返');
  expect(await app.readAll('visits'), '沒選第幾返：一筆都沒存').toHaveLength(0);

  await page.locator('[data-chip="s0-nmnth"][data-chip-value="3"]').click();
  await expect(page.locator('.slothead__what')).toHaveText(/^三返/);
  // 選醫師是 quiet 的，重畫之後要還在
  await expect(page.locator('[data-chip="s0-doc"][aria-pressed="true"]')).toContainText('夏');

  await page.locator('button[type="submit"]').first().click();
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('三返的健檢不是你排的');
  expect(said, '帶標記的三返不再講「加約的」').not.toContain('加約的');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-m');
  expect(v.slots).toHaveLength(1);
  expect(v.slots[0]).toMatchObject({
    examNotMine: true, followupNth: 3, courseId: 'course-followup', courseName: '三返',
    entitlementId: null, followupForVisitId: null, giftKind: null, doctorId: 'staff-dr-xia', status: 'pending_confirm',
  });
  expect(v.slots[0]).not.toHaveProperty('pendingNth');

  // 日曆上印三返；長按「客戶說可以」→ 待辦照二返那門課長（掛號那一族）
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  const row = page.locator(`[data-open^="visit:${v.id}:"]`).first();
  await app.layer(`[data-open^="visit:${v.id}:"]`);
  await expect(row).toContainText('三返');
  await row.scrollIntoViewIfNeeded();
  const box = await row.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
  await page.mouse.up();
  await page.locator('.actionrow', { hasText: '客戶說可以' }).click();
  await app.saved();
  const tasks = (await app.readAll('tasks')).filter((t) => t.visitId === v.id && !t.deletedAt);
  expect(tasks.length, '掛號那一族照二返那門課長').toBeGreaterThan(0);
});

test('E2 選了「健檢不是我排的」再換成功醫門診存下去：標記與返數都清掉', async ({ app, page }) => {
  await app.seed([...masterDocs(), strayCustomer()]);
  await app.signIn('/');
  await app.go(`/visits/new/cust-m/${DAY}`);
  await app.layer('[data-chip="s0-ent"]');
  await pickNotMine(page);
  await page.locator('[data-chip="s0-nmnth"][data-chip-value="4"]').click();
  await expect(page.locator('.slothead__what')).toHaveText(/^四返/);

  await page.locator('[data-chip="s0-ent"][data-chip-value="__course__:course-fm"]').click();
  await expect(page.locator('[data-chip="s0-nmnth"]'), '換掉之後第幾返那一排不見了').toHaveCount(0);
  await page.locator('[data-chip="s0-doc"]', { hasText: '夏' }).click();
  await page.locator('button[type="submit"]').first().click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-m');
  expect(v.slots[0]).toMatchObject({ courseId: 'course-fm', giftKind: 'trial', entitlementId: null });
  expect(v.slots[0]).not.toHaveProperty('examNotMine');
  expect(v.slots[0].followupNth ?? null, '返數清掉').toBeNull();
});

test('E3 既有一段扣著二返額度、接著健檢的二返 → 改成「健檢不是我排的」二返：紅字兩句、確認框講不扣與不再接；原地改（不取消、不重排）', async ({ app, page }) => {
  await app.seed(seedLinkedSecond());
  await app.signIn('/calendar');
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-k-2nd:"]');
  await page.locator('[data-open^="visit:v-k-2nd:"]').first().click();
  await app.layer('.popcard');
  await page.locator('[data-card-edit]').click();
  await app.layer('.slotcard');

  await pickNotMine(page);
  await page.locator('[data-chip="s0-nmnth"][data-chip-value="2"]').click();
  await expect(page.locator('.slothead__what')).toHaveText(/^二返/);
  await expect(page.locator('[data-chip="s0-exam"]'), '不接健檢：沒有「這是哪一次健檢的」').toHaveCount(0);

  await page.locator('button[type="submit"]').first().click();
  // 第一道：紅字（`mustSee()` 的 examNotMine）—— 身上還有二返額度、有一次健檢接得上
  await expect(app.dialog()).toBeVisible();
  const warned = await app.dialogText();
  expect(warned).toContain('二返（8萬健檢）');
  expect(warned).toContain('健檢接得上');
  await app.ok();
  // 第二道：改成帶標記（`chargeSwitchConsequences()`）
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said).toContain('改成「健檢不是我排的」');
  expect(said).toContain('不扣「二返（8萬健檢）」');
  await app.ok();
  await app.saved();

  const v = await app.readDoc('visits', 'v-k-2nd');
  expect(v.slots, '原地改：沒有多一段').toHaveLength(1);
  expect(v.slots[0]).toMatchObject({
    examNotMine: true, entitlementId: null, followupForVisitId: null, giftKind: null,
    courseId: 'course-followup', status: 'confirmed', startsAt: '10:00',
  });
  expect(v.slots[0]).not.toHaveProperty('followupNth');
});

test('E4 打開一段既有的「健檢不是我排的」三返、只換醫師存回去：標記、返數、快照不變；那一排按著它、第幾返按著三返', async ({ app, page }) => {
  await app.seed([...masterDocs(), strayCustomer(), visit({
    id: 'v-m', customerId: 'cust-m', customerName: '王小明', date: DAY, status: 'confirmed',
    slots: [{
      entitlementId: null, courseId: 'course-followup', courseName: '三返', equipmentId: null, ivProductId: null,
      startsAt: '11:00', endsAt: '11:30', minutes: 30, roomId: null, bed: null, therapistId: null, doctorId: 'staff-dr-xia',
      followupForVisitId: null, followupNth: 3, giftKind: null, note: null, status: 'confirmed', examNotMine: true,
    }],
  })]);
  await app.signIn('/calendar');
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-m:"]');
  await page.locator('[data-open^="visit:v-m:"]').first().click();
  await app.layer('.popcard');
  await page.locator('[data-card-edit]').click();
  await app.layer('.slotcard');

  await expect(page.locator('[data-giftfold]'), '選著它：收合打開').toHaveAttribute('data-giftfold', 'open');
  await expect(page.locator(NOT_MINE)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator(NOT_MINE), '「其他 ▸」那一層一打開就是開的').toBeVisible();
  await expect(page.locator('[data-chip="s0-nmnth"][aria-pressed="true"]')).toHaveText('三返');
  await expect(page.locator('.slothead__what')).toHaveText(/^三返/);

  // 簡醫師不是二返指定的那一科：收在「其他醫師」後面
  await page.getByRole('button', { name: '其他醫師' }).click();
  await page.locator('[data-chip="s0-doc"]', { hasText: '簡' }).click();
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const v = await app.readDoc('visits', 'v-m');
  expect(v.slots[0]).toMatchObject({
    examNotMine: true, followupNth: 3, courseName: '三返', entitlementId: null, followupForVisitId: null,
    giftKind: null, doctorId: 'staff-dr-jian', status: 'confirmed', startsAt: '11:00',
  });
});
