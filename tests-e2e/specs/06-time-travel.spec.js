// 跨時間邏輯（Time-Traveling）
//
// 用 `page.clock.setFixedTime()` 把「今天」釘住，再往前／往後跳。
// 刻意**不用** `clock.install()`：那會連 setTimeout 一起假掉，
// Firestore 的連線計時器會卡住，整個 app 就再也讀不到東西。
//
// 這一組要證明的核心是 ADR-0036：
//   **「哪一份可用性算數」看的是你在問哪個月，不是今天。**

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, note, availability,
  TODAY, addDays,
} from '../fixtures/data.js';

/**
 * 首頁那三顆大數字。**版面是「數字在標籤前面」**，
 * 寫成 `/逾期.*1/` 會抓到下一顆的數字 —— 這種斷言寫反了會一直是綠的。
 */
function tileCount(text, label) {
  const m = text.match(new RegExp(`(\\d+)\\s*\\n\\s*${label}`));
  return m ? Number(m[1]) : null;
}

test('T1 壓明天的來訪，跨到明天之後從「來訪前一天」移到「簽療程單」', async ({ app, page }) => {
  const tomorrow = addDays(TODAY, 1);
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復健科醫師門診', type: 'single', courseId: 'course-rehab',
      totalQty: 6, bookedCount: 1, durationMin: 30,
    }),
    visit({
      id: 'visit-tm', customerId: 'cust-a', customerName: '客戶A',
      date: tomorrow, status: 'confirmed',
      slots: [slot({
        courseId: 'course-rehab', entitlementId: 'ent-a',
        startsAt: '14:00', endsAt: '14:30', roomId: 'room-t3', doctorId: 'staff-dr-xia',
      })],
    }),
    task({
      id: 'task-exam', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine',
      dueDate: TODAY, visitId: 'visit-tm',
    }),
  ]);
  await app.signIn('/');

  const before = await app.text();
  expect(tileCount(before, '今天'), '死線是今天的那一張').toBe(1);
  expect(tileCount(before, '逾期')).toBe(0);

  await app.go('/todo/close');
  expect(await app.text(), '明天的來訪還不用收尾').not.toContain('客戶A');

  // ---- 跨到明天 ----
  await app.travelTo(tomorrow);

  await app.go('/todo/close');
  expect(await app.text(), '日子到了，要出現在簽療程單').toContain('客戶A');

  await app.go('/');
  const after = await app.text();
  expect(tileCount(after, '逾期'), '死線是昨天了').toBe(1);
  expect(tileCount(after, '今天')).toBe(0);

  await app.go('/todo/Examine');
  expect(await app.text()).toContain('逾期 1 天');
});

test('T2 跨過死線 → 任務從「快到了」變成「逾期」，首頁那顆數字跟著動', async ({ app }) => {
  const due = addDays(TODAY, 1);
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    task({
      id: 'task-1', customerId: 'cust-a', customerName: '客戶A', kind: 'Examine',
      dueDate: due, visitId: null,
    }),
  ]);
  await app.signIn('/');

  const before = await app.text();
  expect(tileCount(before, '逾期'), '今天還沒逾期').toBe(0);
  expect(tileCount(before, '明天'), '死線在明天').toBe(1);

  await app.travelTo(addDays(due, 2));
  const after = await app.text();
  console.log('[T2] 跨過死線之後 =', JSON.stringify(after.slice(0, 200)));
  expect(tileCount(after, '逾期')).toBe(1);
  expect(tileCount(after, '今天')).toBe(0);
});

test('T4 隨手記的日期過了只變色，**不進「逾期」那顆數字**（它不是死線）', async ({ app, page }) => {
  const when = addDays(TODAY, 1);
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    note({
      id: 'note-1', text: '記得帶健保卡', date: when,
      customerId: 'cust-a', customerName: '客戶A',
    }),
  ]);
  await app.signIn('/');

  await app.travelTo(addDays(when, 5));
  const body = await app.text();

  expect(body, '隨手記還在').toContain('記得帶健保卡');
  expect(tileCount(body, '逾期'), '過期的隨手記不可以被算進「逾期」').toBe(0);
  expect(tileCount(body, '今天')).toBe(0);
  expect(tileCount(body, '明天')).toBe(0);

  // 日期標籤要變色（notetag--past），但不是紅底
  const tag = page.locator('.notetag--date').first();
  await expect(tag).toHaveClass(/notetag--past/);
});

// ---------------------------------------------------------------------------
// ADR-0036 的核心：八月坐下來壓九月的表。
//
// 這一支第一次寫的時候我把預期寫反了 —— `currentCollection()` 刻意**保留**
// 還沒生效的那一份（`collectionState()` 的 'upcoming' 沒有被濾掉），
// 而待辦那一頁問的正是「下一輪」。所以「已經填好九月」的人不該再被問。
//
// 2026-09-02 那一頁改成綁月份（`customersToAskForMonth()`）之後，這一條的
// **結論沒有變、理由換了一個**：填好九月的人不再出現在「還沒發連結」那一格，
// 但他不是消失了 —— 他收在「9月已經問到了」那個摺疊區裡。
// ---------------------------------------------------------------------------
test('T7 待辦中心的「問這輪的時間」：填好那個月的人不再被問，沒填的才被問', async ({ app }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    availability('cust-a', {
      id: 'av-sep', rawText: '9/6 那星期不行', validFrom: '2026-09-01', validTo: '2026-09-30',
      rules: [{ kind: 'exclude_range', from: '2026-09-06', to: '2026-09-12' }],
    }),
    // 這一位什麼都沒填
    customer({ id: 'cust-z', name: '客戶Z' }),
    entitlement('cust-z', {
      id: 'ent-z', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 10,
    }),
  ]);
  await app.signIn('/todo/ask');

  const ask = await app.text();
  console.log('[T7] 問這輪的時間 =', JSON.stringify(ask.slice(0, 400)));
  expect(ask, '這一頁要講出在看哪個月').toMatch(/9\s*月/);
  expect(ask, '沒填過的要被列出來').toContain('客戶Z');
  expect(ask, '已經填好九月的不該出現在要問的名單裡').not.toContain('客戶A');
  expect(ask, '但他也不是消失了 —— 摺疊區的抬頭要數得到他')
    .toMatch(/9月已經問到了\s*1\s*位/);
});

test('T6 八月壓九月的表 → 用得到九月那一份（collectionFor）', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    availability('cust-a', {
      id: 'av-sep', rawText: '9/6 那星期不行', validFrom: '2026-09-01', validTo: '2026-09-30',
      rules: [{ kind: 'exclude_range', from: '2026-09-06', to: '2026-09-12' }],
    }),
  ]);
  await app.signIn('/schedule');

  await page.locator('[data-month="2026-09"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-a"]').first().click();
  await page.waitForTimeout(900);

  const deck = await page.locator('[data-deck]').innerText();
  console.log('[T6] 九月壓表 =', JSON.stringify(deck.slice(0, 400)));
  expect(deck, '九月那一份要被挑到').not.toMatch(/還沒問\s*9\s*月/);

  const cls = await page.locator('[data-day="2026-09-08"]').first().getAttribute('class');
  expect(cls, '9/8 是他說不行的那一週').toContain('ban');
});

test('T6b 壓八月的表 → 九月那一份不可以被拿來硬算，而且要講出是哪個月', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    availability('cust-a', {
      id: 'av-sep', rawText: '9/6 那星期不行', validFrom: '2026-09-01', validTo: '2026-09-30',
      rules: [{ kind: 'exclude_range', from: '2026-09-06', to: '2026-09-12' }],
    }),
  ]);
  await app.signIn('/schedule');

  await page.locator('[data-month="2026-08"]').click();
  await app.settled();
  await page.locator('[data-pick="cust-a"]').first().click();
  await page.waitForTimeout(900);

  const deck = await page.locator('[data-deck]').innerText();
  expect(deck, '八月沒問過就要講出來，而且要講出是哪個月').toMatch(/還沒問\s*8\s*月/);
  expect(deck, '不可以出現一個假的「可用 0 天」').not.toMatch(/可用\s*0\s*天/);
});

test('T10+T11 追蹤報告死線跨月正確；約二返的死線從勾掉那天算', async ({ app, page }) => {
  const examDate = '2026-08-25';
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-b', {
      id: 'ent-b-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 1, doneCount: 0, bookedCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-b', {
      id: 'ent-b-fu', label: '二返（8萬健檢）', type: 'single', courseId: 'course-followup',
      totalQty: 1, followupForEntitlementId: 'ent-b-exam', durationMin: 30,
    }),
    visit({
      id: 'v-exam', customerId: 'cust-b', customerName: '客戶B',
      date: examDate, status: 'confirmed',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-b-exam',
        startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3',
      })],
    }),
  ]);
  await app.signIn('/todo/close');

  await page.locator('[data-open="v-exam"]').click();
  await page.waitForTimeout(600);
  await page.locator('[data-apply]').click();
  await page.waitForTimeout(2200);

  const report = (await app.readAll('tasks')).find((t) => t.kind === '追蹤健檢報告');
  expect(report.dueDate, '8/25 + 21 天 = 9/15，跨月要算對').toBe('2026-09-15');

  // 跳到 9/10 再勾掉報告 → 約二返的死線是 9/10 + 7 = 9/17
  await app.travelTo('2026-09-10');
  await app.go(`/todo/${encodeURIComponent('追蹤健檢報告')}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await page.waitForTimeout(2200);

  const booking = (await app.readAll('tasks'))
    .find((t) => t.kind === '約二返' && !t.deletedAt);
  expect(booking, '勾掉報告就該長出約二返').toBeTruthy();
  expect(booking.dueDate, '死線 = 勾掉那天(9/10) + 7 = 9/17，不是 examine 日 + 7')
    .toBe('2026-09-17');
});

test('T14 跨年與閏年：2/29 與 12/31 都畫得出來', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
  ]);
  await app.signIn('/calendar');

  // 日曆為了左右滑會同時畫上／下一個月，所以同一天會有不只一顆
  // 標題 2026-09-13 起只寫月，不是今年才帶年份（`.scratch/asks-2026-09-13/issues/09`）——
  // 「今天」被撥到那一年，所以這裡是「2月」
  await app.travelTo('2028-02-28');
  await expect(page.locator('.calbar__title')).toHaveText('2月');
  expect(
    await page.locator('[data-day="2028-02-29"]').count(),
    '閏日要畫得出來',
  ).toBeGreaterThan(0);

  await app.travelTo('2026-12-31');
  await expect(page.locator('.calbar__title')).toHaveText('12月');
  expect(await page.locator('[data-day="2026-12-31"]').count()).toBeGreaterThan(0);

  // 往後翻一個月要進到 2027 年 1 月 —— 不是今年了，標題帶年份
  await page.locator('[data-move="1"], [data-offset="1"]').first().click();
  await page.waitForTimeout(900);
  await expect(page.locator('.calbar__title'), '跨年要跨得過去，而且看得出是哪一年').toHaveText('2027年1月');
});
