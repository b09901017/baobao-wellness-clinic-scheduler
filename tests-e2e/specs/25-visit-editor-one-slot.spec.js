// 來訪編輯器：改一段就是改那一段，一天就是一筆，那一句話記在段上。
//
// ADR-0083（一人一天一筆）、0084（記一句在時段上）、0085（改一筆＝改那一段）
// 這三支落地的時候，**單元測試那一側大部分是原始碼掃描** ——
// 比對 `blankSlot()` 裡有沒有 `status: INITIAL_STATUS` 這一串字、
// `mountEdit()` 收不收 `slotIndex`、`readDraft()` 有沒有那一行 early return。
// 掃描擋得住「有人把那一行刪掉」，擋不住「那一行還在、行為照樣是錯的」：
// 搬去別的函式、被上游覆蓋、或者接線那一端根本沒把值傳進來，掃描全部照樣綠。
//
// 所以這一支從瀏覽器那一端問同樣的問題。盯五件事：
//
//   1. 讀取卡片上的鉛筆 → 編輯器**只有那一段**，也沒有「＋新增一個時段」
//   2. 存那一段 → **沒畫出來的那幾段一個欄位都不動**（`status`、`bed` 這種
//      沒有欄位的格子最危險 —— 重組一份的話會被寫死的 null 清掉）
//   3. 同一天再新增一次 → **接著編輯那一筆**，不是長出第二筆
//   4. 併進一筆**已確認**的來訪時，新的那一段是「待確認」——
//      繼承的話，一段從沒問過客人的時間會被靜默標成談定了，而且開始佔次數
//   5. 那一句話**記在段上**：三段只記了一段，就只有那一列亮夾板
//
// 第 5 點在 `19-untick-and-drawer-todos` 的 U10 已經有一支，但那一支餵的是
// **舊形狀**（整筆的 `visit.note` ＋ 那一天只有一段），所以 ADR-0084 真正修的
// 那個症狀（一天三段、只記一段、三列全亮）它抓不到。這裡兩種形狀都問一次。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const DAY = TODAY;

// ---------- 種子 ----------

/**
 * 一位客戶、同一天三段，而且**第三段是取消掉的**。
 *
 * 那一段身上有兩格「畫面上沒有欄位」的東西：`status`（取消）與 `bed`（舊資料
 * 才有的床位，ADR-0079 之後不再寫新的）。改第二段存下去之後這兩格都要原封不動
 * —— 掉了 `status` 的話 `withSlotStatuses()` 會拿整筆的補上去，一段取消掉的
 * 來訪就這樣**自己活回來並且重新開始佔次數**。
 */
function seedThreeSlots() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-x', name: '王小明' }),
    entitlement('cust-x', {
      id: 'ent-pool', label: '復能-四選一(30)', type: 'pool',
      optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser', 'eq-ilib'],
      totalQty: 20, bookedCount: 2, durationMin: 30,
    }),
    entitlement('cust-x', {
      id: 'ent-ilib', label: 'ILIB(60)', type: 'single', courseId: 'course-iv-laser',
      totalQty: 10, bookedCount: 1, durationMin: 60,
    }),
    visit({
      id: 'v-three', customerId: 'cust-x', customerName: '王小明',
      date: DAY, status: 'confirmed',
      slots: [
        slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '09:00', endsAt: '09:30', equipmentId: 'eq-indiba',
          therapistId: 'staff-tw',
        }),
        slot({
          courseId: 'course-recovery', entitlementId: 'ent-pool',
          startsAt: '10:00', endsAt: '10:30', equipmentId: 'eq-sis',
          therapistId: 'staff-zn',
        }),
        // 取消掉的那一段。`slot()` 不收 `status` / `bed` 以外的欄位，
        // 所以這兩格自己補上去 —— 它們正是這一支要盯的東西。
        {
          ...slot({
            courseId: 'course-iv-laser', entitlementId: 'ent-ilib',
            startsAt: '11:00', endsAt: '12:00', roomId: 'room-t2', bed: 'A',
          }),
          status: 'cancelled',
        },
      ],
    }),
  ];
}

/**
 * 一位客戶，今天**已經有一筆已確認的來訪**，身上只有一種額度。
 *
 * 「身體組成分析」是刻意挑的：`assigns: 'none'`、不用器材、不用品項，
 * 所以新加的那一段不必填任何東西就存得下去 —— 這一支要問的是狀態與筆數，
 * 不是欄位驗證。
 */
function seedOneConfirmedVisit() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-y', name: '客戶A' }),
    entitlement('cust-y', {
      id: 'ent-ib', label: '身體組成分析 10 次', type: 'single',
      courseId: 'course-inbody', totalQty: 10, bookedCount: 1,
    }),
    visit({
      id: 'v-one', customerId: 'cust-y', customerName: '客戶A',
      date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-inbody', entitlementId: 'ent-ib',
        startsAt: '09:00', endsAt: '09:20',
      })],
    }),
  ];
}

// ---------- 共用動線 ----------

/**
 * 那一天的抽屜。
 *
 * `[data-day]` 只在月檢視的格子上（日檢視畫的是時間軸，沒有格子），
 * 所以這裡不切檢視 —— 抽屜裡那一份清單跟日檢視是同一支 `dayHtml()`。
 */
async function openDay(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
}

/** 點第 n 列 → 讀取卡片 → 按鉛筆 → 編輯器。回來時編輯器已經畫好了。 */
async function openEditorForSlot(app, page, visitId, index) {
  await page.locator(`[data-open^="visit:${visitId}:"]`).nth(index).click();
  await app.layer('.popcard');
  await page.locator('[data-card-edit]').click();
  await app.layer('.slotcard');
}

// ---------- 一、鉛筆只帶那一段（ADR-0085） ----------

test('V1 鉛筆進來只有那一段，而且沒有「＋新增一個時段」', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditorForSlot(app, page, 'v-three', 1);

  const cards = page.locator('.slotcard');
  await expect(cards, '她點的是第二段，就只該畫第二段').toHaveCount(1);
  await expect(
    cards.first().locator('input[name="s1-start"]'),
    '而且是原本那一段的索引，不是重新編號成 s0',
  ).toHaveValue('10:00');

  await expect(
    page.locator('[data-add-slot]'),
    '改一段時不給加新的 —— 她點進來要改的就是這一段',
  ).toHaveCount(0);

  // 整筆那幾顆**一個都不畫**（ADR-0088，2026-09-10）。
  //
  // 2026-09-09 的第一版是收在一摺裡、預設收著 —— 理由是 ADR-0060
  //（長按是捷徑，不是唯一的路），而那兩顆在別的地方點不到。但 ADR-0085
  // 寫的是「沒有整筆的狀態卡與危險區」，而**摺著不算沒有**：她點早上那一段
  // 進來改，畫面最底下照樣有一顆動整天的取消和一顆刪除。
  //
  // 第二條路搬到日曆讀取卡片底下那一顆「改這一天」（`[data-edit-day]`），
  // 由 `tests-e2e/specs/27-read-card-one-slot.spec.js` 盯著它真的開得出整天那一張。
  await expect(page.locator('details.advanced'), '摺起來不算拿掉').toHaveCount(0);
  await expect(page.locator('[data-status]'), '狀態按鈕動的是整天').toHaveCount(0);
  await expect(page.locator('[data-delete]'), '刪除動的也是整天').toHaveCount(0);

  // 那顆 × 在**存過的**段上是「取消」不是「移除」（ADR-0081）
  await expect(page.locator('[data-cancel-slot="1"]'), '存過的那一段：取消').toHaveCount(1);
  await expect(page.locator('[data-del-slot]'), '存過的那一段不可以是「移除」').toHaveCount(0);
});

test('V2 存那一段，沒畫出來的那幾段一個欄位都不動', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditorForSlot(app, page, 'v-three', 1);

  await page.locator('input[name="s1-start"]').fill('14:00');
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-three');

  expect(saved.slots, '三段都要還在').toHaveLength(3);
  expect(saved.slots[1].startsAt, '她改的那一段').toBe('14:00');
  expect(saved.slots[1].endsAt, '結束時間跟著時長重算').toBe('14:30');

  // 第一段：一個字都不該動
  expect(saved.slots[0].startsAt).toBe('09:00');
  expect(saved.slots[0].equipmentId).toBe('eq-indiba');
  expect(saved.slots[0].therapistId).toBe('staff-tw');

  // 第三段：**那兩格畫面上沒有欄位**。重組一份的話它們會被清掉 ——
  // `status` 掉了就是一段取消掉的來訪自己活回來，而且重新開始佔次數。
  expect(saved.slots[2].status, '取消掉的那一段不可以被復活').toBe('cancelled');
  expect(saved.slots[2].bed, '沒有欄位的舊格子也要原封不動').toBe('A');
  expect(saved.slots[2].roomId).toBe('room-t2');
});

// ---------- 二、一天一筆（ADR-0083） ----------

test('V3 同一天再新增一次 → 接著編輯那一筆，不是長出第二筆', async ({ app, page }) => {
  await app.seed(seedOneConfirmedVisit());
  await app.signIn('/calendar');
  await openDay(app, page);

  // 抽屜抬頭右上角那顆「＋」→ 新增來訪 → 選人
  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-y"]').click();
  await app.layer('.slotcard');

  // **只畫剛加上去的那一段。** 既有那一段她早就壓過也早就問過客人了，
  // 畫出來會讓這張表單看起來像在改整天。
  await expect(page.locator('.slotcard'), '只有新的那一段改得動').toHaveCount(1);
  await expect(
    page.locator('input[name="s1-start"]'),
    '新的那一段接在既有那一段後面（09:20 + 間隔）',
  ).toBeVisible();
  await expect(
    page.locator('input[name="s0-start"]'),
    '既有那一段不畫 —— 她點的不是它',
  ).toHaveCount(0);

  // 還沒存過的那一段，× 是「移除」不是「取消」——
  // 走進取消那條路會替一個從來不存在的時段長出一張「取消 Abovee」。
  await expect(page.locator('[data-del-slot="1"]'), '沒存過的那一段：移除').toHaveCount(1);
  await expect(page.locator('[data-cancel-slot]'), '沒存過的不可以是「取消」').toHaveCount(0);

  await page.locator('button[type="submit"]').first().click();

  // **這一道以前不會跳。** 問的是「有沒有新的時段」而不是「這筆來訪是新的」
  //（`hasNewSlots()`）—— 問後者的話，既有那一筆按新增一段一道確認都不跳。
  await expect(app.dialog(), '併進既有那一筆時 Abovee 那一道照樣要問').toBeVisible();
  expect(await app.dialogText()).toContain('Abovee');
  await app.ok();
  await app.saved();

  const all = await app.readAll('visits');
  expect(all, '同一位客戶同一天只能有一筆').toHaveLength(1);
  expect(all[0].id).toBe('v-one');
  expect(all[0].slots, '那一段接在同一筆的後面').toHaveLength(2);
});

test('V4 併進已確認的那一天，新的那一段是「待確認」不是繼承', async ({ app, page }) => {
  await app.seed(seedOneConfirmedVisit());
  await app.signIn('/calendar');
  await openDay(app, page);

  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-y"]').click();
  await app.layer('.slotcard');

  await page.locator('button[type="submit"]').first().click();
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-one');

  expect(saved.slots[0].status, '既有那一段照舊').toBe('confirmed');
  expect(
    saved.slots[1].status,
    '新的那一段還沒問過客人 —— 繼承「已確認」等於靜默替她談定了一個時間，而且開始佔次數',
  ).toBe('pending_confirm');
});

// **這一支現在是紅的，而且是刻意留著的。**
//
// 時段那一層兩個入口都對（上面那一支綠的），壞的是整筆那一格：
//
//   壓表  → `withExtraSlot()` 把整筆退回「待確認」，`confirmedAt` 一起清掉
//   日曆  → `withNewSlot()` 一個字都沒碰 `visit.status`
//
// 而 `visit.status` 是推導出來又存起來的，四個地方讀它（索引、Rules、
// 試算表、備份）。停在「已確認」的後果是那一筆查不到、待辦中心不會叫她
// 去問新加的那一段，而資料健檢會把它列成「狀態跟時段對不起來」——
// 那一列是拿來抓歷史髒資料的，不該是 app 自己每次併段都生一筆。
//
// 定案與做法在 `.scratch/coverage-gaps/issues/03`。**修好的那天這一支會
// 轉紅**（`test.fail()` 的測試通過時 Playwright 讓整份紅），所以忘不掉 ——
// 修的人記得把這個標記拿掉。
test('V4b 併進之後整筆的狀態要跟著時段重推（issues/03，還沒修）', async ({ app, page }) => {
  test.fail(true, '日曆這條路沒走 withExtraSlot()，見 .scratch/coverage-gaps/issues/03');

  await app.seed(seedOneConfirmedVisit());
  await app.signIn('/calendar');
  await openDay(app, page);

  await page.locator('[data-addmenu-toggle]').click();
  await page.locator('[data-add="visit"]').click();
  await app.layer('[data-pick]');
  await page.locator('[data-pick="cust-y"]').click();
  await app.layer('.slotcard');

  await page.locator('button[type="submit"]').first().click();
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-one');
  // 一段已確認、一段待確認 → `visitStatusFrom()` 說整筆是「待確認」。
  expect(saved.status, '整筆的狀態要跟著時段重推').toBe('pending_confirm');
});

// ---------- 三、那一句話記在段上（ADR-0084） ----------

test('V5 三段只記了一段：只有那一列亮夾板', async ({ app, page }) => {
  const seed = seedThreeSlots();
  const v = seed.find((d) => d.id === 'v-three');
  v.data.slots[1] = { ...v.data.slots[1], note: '她說想換一台' };

  await app.seed(seed);
  await app.signIn('/calendar');
  await openDay(app, page);

  const row = (i) => page.locator(`[data-open="visit:v-three:${i}"]`);
  const clip = '[aria-label="有記的話"]';

  await expect(row(1).locator(clip), '記了字的那一段要亮').toHaveCount(1);
  await expect(row(0).locator(clip), '沒記字的那一段不可以亮').toHaveCount(0);
  await expect(row(2).locator(clip), '沒記字的那一段不可以亮').toHaveCount(0);
});

test('V6 舊資料那一句還是整天的：三段都看得到（退回規則沒有變）', async ({ app, page }) => {
  const seed = seedThreeSlots();
  const v = seed.find((d) => d.id === 'v-three');
  // 舊資料：那一句在整筆上，時段身上一個字都沒有。
  v.data.note = '她今天下午要早退';

  await app.seed(seed);
  await app.signIn('/calendar');
  await openDay(app, page);

  const clip = '[aria-label="有記的話"]';
  for (const i of [0, 1, 2]) {
    await expect(
      page.locator(`[data-open="visit:v-three:${i}"]`).locator(clip),
      `舊資料那一句本來就是那一天的，第 ${i + 1} 段也印得出來`,
    ).toHaveCount(1);
  }
});

// **兩種狀態拆成兩支，不要在同一頁上跑兩趟動線。** 第一版是「開第二段 →
// 回日曆 → 再開第一段」，而換頁不會關掉那張抽屜 —— 第二趟點那一天的格子
// 會被還開著的那一層擋掉，紅在 `openDay()` 上，看起來像日曆壞了。
test('V7 記一句：有字的那一段，收起來也看得到一行', async ({ app, page }) => {
  const seed = seedThreeSlots();
  const v = seed.find((d) => d.id === 'v-three');
  v.data.slots[1] = { ...v.data.slots[1], note: '她說想換一台' };

  await app.seed(seed);
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditorForSlot(app, page, 'v-three', 1);

  const peek = page.locator('.slotnote__peek');
  await expect(peek, '有字的一定看得到（收起來是縮成一行，不是藏起來）').toBeVisible();
  await expect(peek).toHaveText('她說想換一台');

  // **這一下以前按不到。** 那顆 × 的感應範圍（`::after` 撐開的 44px）貼錯了
  // 盒子，整格都是它的 —— 她想記一句，跳出來的是「取消第 2 段？」。
  // 見 `.scratch/coverage-gaps/issues/04`。
  await page.locator('[data-slotnote-toggle="s1-note"]').click();
  await expect(page.locator('textarea[name="s1-note"]')).toBeVisible();
  await expect(app.dialog(), '按夾板不可以跳出取消那一道').toHaveCount(0);
});

test('V7b 記一句：沒字的那一段，一個像素都不佔', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditorForSlot(app, page, 'v-three', 0);

  await expect(
    page.locator('.slotnote__peek'),
    '沒字的時候那一行不畫（她：不然感覺會很占版面）',
  ).toBeHidden();
  await expect(
    page.locator('[data-slotnote-toggle="s0-note"]'),
    '但那顆夾板一定要在 —— 沒有它就沒有地方記第一句',
  ).toBeVisible();
});

test('V8 打一句話存下去，寫在那一段身上，不是整筆', async ({ app, page }) => {
  await app.seed(seedThreeSlots());
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditorForSlot(app, page, 'v-three', 1);

  await page.locator('[data-slotnote-toggle="s1-note"]').click();
  await page.locator('textarea[name="s1-note"]').fill('下次改約下午');
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-three');
  expect(saved.slots[1].note, '記在她點的那一段身上').toBe('下次改約下午');
  expect(saved.slots[0].note ?? null, '別的段不該跟著長出一句').toBeNull();
  expect(saved.slots[2].note ?? null, '別的段不該跟著長出一句').toBeNull();
});
