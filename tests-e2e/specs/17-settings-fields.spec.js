// 設定頁上那幾格數字**存不存得下去**。
//
// 2026-09-04 她回報：「我在設定那邊的二返填時長 30 分鐘，他不讓我儲存，
// 說只能 26 或 31？？」
//
// HTML 的 `step` 從 `min` 起算，所以 `min="1" step="5"` 的合法值是
// 1、6、11、16、21、26、31…… 30 不在裡面。**瀏覽器擋在 submit 之前**，
// 所以這種 bug 有一個很壞的性質：
//
//   - domain 的驗證跑都沒跑到（它只要求「大於 0 的整數」）
//   - 單元測試永遠是綠的
//   - 只有真的把數字打進一個真的 `<input>` 再按存檔，才會撞到它
//
// 所以它只能是端對端。`tests/number-fields.test.js` 從原始碼那一側掃同一件事，
// 兩支一起才蓋得住（一支看得到瀏覽器、一支看得到全部的呼叫端）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs } from '../fixtures/data.js';

/** 那一格現在的 validity。`false` = 瀏覽器會擋下這一次 submit。 */
const validOf = (page, selector) =>
  page.locator(selector).evaluate((el) => el.checkValidity());

test('S1 課程時長填 30 存得起來，重新讀出來還是 30', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-followup"]').click();
  await expect(page.locator('input[name="durationMin"]')).toBeVisible();

  await page.fill('input[name="durationMin"]', '30');
  expect(
    await validOf(page, 'input[name="durationMin"]'),
    '30 分鐘是合法的 —— domain 只要求大於 0 的整數',
  ).toBe(true);

  await page.click('button[type="submit"]');
  await app.settled();
  await page.waitForTimeout(600);

  const course = await app.readDoc('config/app/courses', 'course-followup');
  expect(course.durationMin, '真的存進去了').toBe(30);

  // 再打開一次，畫面上就是 30
  await page.locator('[data-edit="course-followup"]').click();
  await expect(page.locator('input[name="durationMin"]')).toHaveValue('30');
});

test('S2 其他不是 5 的倍數的時長也存得起來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  await page.locator('[data-edit="course-followup"]').click();
  for (const n of ['7', '23', '90']) {
    // eslint-disable-next-line no-await-in-loop
    await page.fill('input[name="durationMin"]', n);
    // eslint-disable-next-line no-await-in-loop
    expect(await validOf(page, 'input[name="durationMin"]'), `${n} 分鐘要收得下`).toBe(true);
  }

  // 0 與負數還是要擋 —— 欄位不可以比 domain 鬆
  await page.fill('input[name="durationMin"]', '0');
  expect(await validOf(page, 'input[name="durationMin"]'), '0 分鐘的課程不存在').toBe(false);
});

test('S3 排序權重填 1.25 存得起來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/preferences');

  await page.fill('input[name="w1"]', '1.25');
  expect(await validOf(page, 'input[name="w1"]'), '權重沒有理由只能一位小數').toBe(true);

  await page.click('button[type="submit"]');
  await app.settled();
  await page.waitForTimeout(600);

  const settings = await app.readDoc('config', 'app');
  expect(settings.sortWeights.w1).toBe(1.25);
});

test('S4 時段間隔填 7 分鐘存得起來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/preferences');

  await page.fill('input[name="slotGapMin"]', '7');
  expect(await validOf(page, 'input[name="slotGapMin"]')).toBe(true);

  await page.click('button[type="submit"]');
  await app.settled();
  await page.waitForTimeout(600);

  const settings = await app.readDoc('config', 'app');
  expect(settings.slotGapMin).toBe(7);
});

test('S5 每一格數字欄位的 min 都是 step 的倍數', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/preferences');

  // 這一頁上全部的數字格一次掃完 —— 掃的是瀏覽器真的看到的屬性，
  // 不是原始碼（`tests/number-fields.test.js` 掃的是那一半）。
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll('#view input[type="number"]')]
      .map((el) => ({ name: el.name, min: el.min, step: el.step }))
      .filter((x) => {
        if (x.step === 'any' || x.step === '') return false;
        const min = Number(x.min || 0);
        const step = Number(x.step);
        return Number.isInteger(step) && Number.isInteger(min) && min % step !== 0;
      }));

  expect(bad, `這幾格會讓她打出正確的數字卻存不下去：${JSON.stringify(bad)}`).toEqual([]);
});

// ---------------------------------------------------------------------------
// LINE 回覆模板（2026-09-04）
//
// 她要的是「一個地方可以一次修改所有回復的模板」。這幾支盯的是那一頁真的
// **接到了另一頭** —— 改了字，待辦中心按下複製時拿到的是新的那一句。
// 單元測試盯得到 `fill()` 與 `textFor()`，盯不到「五個觸發點有沒有把
// templates 傳下去」，而漏掉任何一個的症狀是「改了沒反應」。
// ---------------------------------------------------------------------------

import { customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

test('S6 改一則模板 → 存 → 重新整理，那一頁上還是新的字', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/templates');

  await expect(page.locator('[data-text="confirm"]')).toBeVisible();
  await page.fill('[data-text="confirm"]', '{name}您好，{month} 月排了 {slots}，OK 嗎？');
  await page.click('[data-save]');
  await app.settled();
  await page.waitForTimeout(800);

  // 真的存進去了（不是畫面上有沒有）
  const settings = await app.readDoc('config', 'app');
  expect(settings.messageTemplates.confirm).toContain('OK 嗎？');

  await app.reload();
  await app.go('/settings/templates');
  await expect(page.locator('[data-text="confirm"]')).toHaveValue(/OK 嗎？/);
  // 改過的那一則要標出來
  await expect(page.locator('[data-tpl="confirm"]')).toContainText('已改過');
});

test('S7 改過的字真的用在待辦中心那顆複製鈕上', async ({ app, page }) => {
  const DAY = addDays(TODAY, 3);
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能 6 次', type: 'single', courseId: 'course-recovery',
      totalQty: 6, doneCount: 0, bookedCount: 1,
    }),
    visit({
      id: 'v1', customerId: 'cust-a', customerName: '客戶A',
      date: DAY, status: 'pending_confirm',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-a',
        startsAt: '14:00', endsAt: '15:00',
      })],
    }),
  ]);
  await app.signIn('/settings/templates');

  await page.fill('[data-text="confirm"]', '這是我自己的版本：{slots}');
  await page.click('[data-save]');
  await app.settled();
  await page.waitForTimeout(800);

  await app.go('/todo/confirm');
  await expect(page.locator('#view')).toContainText('客戶A');
  const box = page.locator('textarea.msg').first();
  await expect(box).toHaveValue(/這是我自己的版本/);
  // 變數真的被換掉了，不是原樣印出 `{slots}`
  await expect(box).not.toHaveValue(/\{slots\}/);
});

test('S8 逐則「回復預設」與整份「全部回復」都回得去', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/templates');

  const before = await page.locator('[data-text="ask"]').inputValue();

  await page.fill('[data-text="ask"]', '改過的字');
  await page.click('[data-save]');
  await app.settled();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-tpl="ask"]')).toContainText('已改過');

  // 逐則那一顆：**不走二次確認**（她看得到那一格現在寫什麼）
  await page.locator('[data-reset="ask"]').click();
  await expect(page.locator('[data-text="ask"]')).toHaveValue(before);

  // 存回去之後，那一則不再算「改過」
  await page.click('[data-save]');
  await app.settled();
  await page.waitForTimeout(800);
  await expect(page.locator('[data-tpl="ask"]')).not.toContainText('已改過');

  // 整份那一顆要問一次（它會把她改過的字全部丟掉）
  await page.fill('[data-text="ask"]', '又改了');
  await page.click('[data-save]');
  await app.settled();
  await page.waitForTimeout(800);

  await page.click('[data-reset-all]');
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.settled();
  await page.waitForTimeout(800);

  await expect(page.locator('[data-text="ask"]')).toHaveValue(before);
  const settings = await app.readDoc('config', 'app');
  expect(settings.messageTemplates ?? {}).toEqual({});
});

test('S9 一則刪光存不下去 —— 按下複製會得到一則空訊息', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/templates');

  await page.fill('[data-text="reminder"]', '   ');
  await page.click('[data-save]');
  await page.waitForTimeout(500);

  await expect(page.locator('[data-errors]')).toBeVisible();
  await expect(page.locator('[data-errors]')).toContainText('來訪前提醒');
});

test('S10 變數丸子插在游標處，不是接在最後面', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/templates');

  await page.fill('[data-text="confirm"]', 'AB');
  await page.locator('[data-text="confirm"]').evaluate((el) => {
    el.focus();
    el.setSelectionRange(1, 1);
  });
  await page.locator('[data-var="confirm"][data-name="name"]').click();

  await expect(page.locator('[data-text="confirm"]')).toHaveValue('A{name}B');
});

// 「常用診間」是 2026-09-08 加的第三個欄位（ADR-0079）。
//
// **它是順序不是限制** —— 勾起來的排在最前面，沒勾的照樣選得到。
// 候選只有這個課程排得進去的那幾間：勾一間它排不進去的，那一顆永遠不會出現
// 在壓表上，而一顆按得下去卻什麼都不會發生的勾選框比沒有還糟。
test('S11 常用診間存得下去、讀得回來，而且只列得出排得進去的那幾間', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  // 營養點滴：`allowedRoomTypes` 是點滴室，所以候選只有那八間
  await page.locator('[data-edit="course-iv-drip"]').click();
  const boxes = page.locator('input[name="preferredRoomIds"]');
  await expect(boxes).toHaveCount(8);
  await expect(page.locator('input[name="preferredRoomIds"][value="room-t2"]'),
    '治療室排不進營養點滴，不該列得出來').toHaveCount(0);

  await page.locator('input[name="preferredRoomIds"][value="room-iv10"]').check();
  await page.click('button[type="submit"]');
  await app.settled();
  await page.waitForTimeout(600);

  const course = await app.readDoc('config/app/courses', 'course-iv-drip');
  expect(course.preferredRoomIds, '真的存進去了').toContain('room-iv10');

  // 再打開一次，畫面上那一格還勾著
  await page.locator('[data-edit="course-iv-drip"]').click();
  await expect(page.locator('input[name="preferredRoomIds"][value="room-iv10"]')).toBeChecked();
});

// 種子上 EECP 與 ILIB 的常用診間就是她給的那幾間，而壓表那一排照著它排。
test('S12 不指派診間的課程沒有「常用診間」那一排', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/courses');

  // 健檢 2026-09-08 改成「都不用」，所以那一排一顆候選都沒有
  await page.locator('[data-edit="course-checkup"]').click();
  await expect(page.locator('input[name="preferredRoomIds"]')).toHaveCount(0);
});

// 「同時幾位」是 2026-09-16 加的（ADR-0094）。一間裝得下幾個人決定撞期
// 講不講話，所以它存得下去、讀得回來這件事要真的在瀏覽器上問一次。
test('S13 診間的「同時幾位」：留空是 1，填 2 存得下去也讀得回來', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/rooms');

  await page.locator('[data-edit="room-iv8"]').click();
  await expect(page.locator('input[name="capacity"]')).toBeVisible();

  // `min="1" step="1"`：2 是合法的（踩過三次的那個坑，見檔頭）
  await page.fill('input[name="capacity"]', '2');
  expect(await validOf(page, 'input[name="capacity"]')).toBe(true);

  await page.click('button[type="submit"]');
  // **等寫入真的結束**（`app.saved()` 讀 toast 的狀態機），不要固定等一段時間
  // —— `tests/e2e-waits.test.js` 盯著，而且固定等待兩邊都錯。
  await app.saved();

  const saved = await app.readDoc('config/app/rooms', 'room-iv8');
  expect(saved.capacity, '存進去的是數字不是字串').toBe(2);

  await page.locator('[data-edit="room-iv8"]').click();
  await expect(page.locator('input[name="capacity"]')).toHaveValue('2');
});

test('S14 留空存得下去 —— 沒填就是 1，不是錯誤', async ({ app, page }) => {
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/rooms');

  await page.locator('[data-edit="room-t2"]').click();
  await page.fill('input[name="capacity"]', '');
  await page.click('button[type="submit"]');
  await app.saved();

  const saved = await app.readDoc('config/app/rooms', 'room-t2');
  expect(saved.capacity).toBe(null);
});
