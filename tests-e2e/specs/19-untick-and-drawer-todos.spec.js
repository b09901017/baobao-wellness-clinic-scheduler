// 反過來的那幾下：拿回一張待辦、取消一筆來訪，以及讀取卡片上的「這一場的待辦」。
//
// 這一支盯的是**畫面說的話**，不是資料的結果（那一半在 02-examine-chain）。
// 兩個方向都要盯：
//
//   少講 —— 拿回「追蹤健檢報告」會靜靜收掉「寄報告給醫師」，
//           她的下一句會是「我明明勾過寄報告，怎麼不見了」
//   多講 —— **不可以說「將會取消已約好的二返」**。拿回一張待辦不會動到
//           任何一筆來訪（ADR-0002），而嚇錯一次之後，真的該停的那次
//           她也不會停。U5 就是在盯這一條。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, task, note, TODAY, addDays,
} from '../fixtures/data.js';

const EXAM_DATE = addDays(TODAY, -3);

/** 買了 2 次健檢、配好二返額度、健檢已確認但還沒結案。 */
function seedBeforeClose() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-b', name: '客戶B' }),
    entitlement('cust-b', {
      id: 'ent-b-exam', label: '8萬健檢', type: 'single', courseId: 'course-checkup',
      totalQty: 2, doneCount: 0, bookedCount: 1, tier: '8萬', durationMin: 120,
    }),
    entitlement('cust-b', {
      id: 'ent-b-followup', label: '二返（8萬健檢）', type: 'single',
      courseId: 'course-followup', totalQty: 2, doneCount: 0, bookedCount: 0,
      followupForEntitlementId: 'ent-b-exam', durationMin: 30,
    }),
    visit({
      id: 'visit-b-exam1', customerId: 'cust-b', customerName: '客戶B',
      date: EXAM_DATE, status: 'confirmed',
      slots: [slot({
        courseId: 'course-checkup', entitlementId: 'ent-b-exam',
        startsAt: '09:00', endsAt: '11:00', roomId: 'room-t3',
      })],
    }),
  ];
}

/** 把那一筆健檢從「簽療程單」那一頁結掉。 */
async function closeExam(app, page) {
  await app.go('/todo/close');
  await expect(page.locator('#view')).toContainText('客戶B');
  await page.locator('[data-open="visit-b-exam1"]').click();
  await expect(page.locator('[data-apply]')).toBeVisible();
  await page.locator('[data-apply]').click();
  await app.saved();
}

/** 勾掉某一種待辦（走待辦中心那一頁的多選 + 標成完成）。 */
async function tick(app, page, kind) {
  await app.go(`/todo/${encodeURIComponent(kind)}`);
  await page.locator('[data-task]').first().check();
  await page.locator('[data-mark]').click();
  await app.ok();
  await app.saved();
}

/** 從「已完成」那一格點回來（不按確認，讓呼叫端自己決定）。 */
async function startUntick(app, page, kind) {
  await app.go(`/todo/${encodeURIComponent(kind)}`);
  await page.locator('[data-task-tab="done"]').click();
  // 那一格裡的「拿回來」出現了才點得到。固定 400ms 是猜的。
  await app.layer('[data-untick]');
  await page.locator('[data-untick]').first().click();
}

test.describe('拿回一張待辦要先講清楚', () => {
  test('U1 勾掉「追蹤健檢報告」→ 長出約二返與寄報告（當基準）', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    const kinds = (await app.readAll('tasks')).filter((t) => !t.deletedAt).map((t) => t.kind);
    expect(kinds).toContain('約二返');
    expect(kinds).toContain('寄報告給醫師');
  });

  test('U2 拿回「追蹤健檢報告」→ 跳確認，而且列得出那兩張', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    await startUntick(app, page, '追蹤健檢報告');
    await expect(app.dialog()).toBeVisible();

    const said = await app.dialogText();
    expect(said).toContain('寄報告給醫師');
    expect(said).toContain('約二返');
    // 還原得回來這件事一定要講 —— 不然那兩張看起來像永遠不見了
    expect(said).toContain('已刪除項目');
  });

  test('U3 按「取消」→ 報告還是已完成，那兩張都還在', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    await startUntick(app, page, '追蹤健檢報告');
    await app.cancelDialog();
    // 按取消不寫任何東西，所以沒有「存完了」可以等 —— 等確認框真的收掉就夠。
    // 以前那 800ms 是在替一件不會發生的寫入留時間。
    await expect(app.dialog()).toHaveCount(0);

    const live = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
    expect(live.find((t) => t.kind === '追蹤健檢報告').done).toBe(true);
    expect(live.some((t) => t.kind === '寄報告給醫師')).toBe(true);
    expect(live.some((t) => t.kind === '約二返')).toBe(true);
  });

  test('U4 按「還是拿回來」→ 報告回到未完成，那兩張真的不見了', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    await startUntick(app, page, '追蹤健檢報告');
    await app.ok();
    await app.saved();

    const live = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
    const report = live.find((t) => t.kind === '追蹤健檢報告');
    expect(report, '那一張報告不可以消失').toBeTruthy();
    expect(report.done).toBe(false);
    expect(live.some((t) => t.kind === '寄報告給醫師')).toBe(false);
    expect(live.some((t) => t.kind === '約二返')).toBe(false);
  });

  test('U5 二返已經約好 → 講得出日期，而且那一筆來訪不會被動到', async ({ app, page }) => {
    // 健檢結案 → 勾掉報告 → 種一場真的二返（指回那一次健檢）
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);
    await tick(app, page, '追蹤健檢報告');

    const FOLLOWUP_DATE = addDays(TODAY, 4);
    await app.seed([
      visit({
        id: 'visit-b-2nd', customerId: 'cust-b', customerName: '客戶B',
        date: FOLLOWUP_DATE, status: 'confirmed',
        slots: [slot({
          courseId: 'course-followup', entitlementId: 'ent-b-followup',
          startsAt: '10:00', endsAt: '10:30', followupForVisitId: 'visit-b-exam1',
        })],
      }),
    ]);
    await app.reload();

    await startUntick(app, page, '追蹤健檢報告');
    await expect(app.dialog()).toBeVisible();
    const said = await app.dialogText();

    // 講得出那一場約在哪一天
    const [, m, d] = FOLLOWUP_DATE.split('-');
    expect(said).toContain(`${Number(m)}/${Number(d)}`);
    // **而且明說那一筆來訪不會被動到**
    expect(said).toContain('不會被動到');
    // 一個字都不可以說「會取消二返」—— 那是假的
    expect(said).not.toContain('取消已約');
    expect(said).not.toContain('取消二返');

    await app.ok();
    await app.saved();

    // 那一筆二返來訪真的一個字都沒被動到
    const kept = await app.readDoc('visits', 'visit-b-2nd');
    expect(kept.status).toBe('confirmed');
    expect(kept.deletedAt ?? null).toBeNull();
  });

  test('U6 拿回 Examine → 不跳確認框（那一種什麼都不會發生）', async ({ app, page }) => {
    const DAY = addDays(TODAY, 2);
    await app.seed([
      ...masterDocs(),
      customer({ id: 'cust-a', name: '客戶A' }),
      entitlement('cust-a', {
        id: 'ent-a', label: '復健科醫師門診', type: 'single', courseId: 'course-rehab',
        totalQty: 4, doneCount: 0, bookedCount: 1,
      }),
      visit({
        id: 'visit-a', customerId: 'cust-a', customerName: '客戶A',
        date: DAY, status: 'confirmed',
        slots: [slot({
          courseId: 'course-rehab', entitlementId: 'ent-a',
          startsAt: '14:00', endsAt: '14:30',
        })],
      }),
      // 種一張已經勾掉的 Examine。**不走真的動線**：任務是來訪存檔那一刻
      // 由 `syncTasksForVisit()` 產生的，種一筆已確認的來訪不會長出它。
      task({
        id: 't-examine', customerId: 'cust-a', customerName: '客戶A',
        kind: 'Examine', visitId: 'visit-a', dueDate: addDays(DAY, -1),
        done: true, doneAt: `${TODAY}T02:00:00.000Z`,
      }),
    ]);
    await app.signIn('/');

    await startUntick(app, page, 'Examine');
    // **這一支要證明「沒有確認框」**，而證明不存在需要等到「該發生的事發生了」。
    // 沒有確認框就是直接寫下去，所以等那一趟寫入結束 —— 比等 1500ms 硬。
    await app.saved();

    await expect(app.dialog()).toHaveCount(0);
    const live = (await app.readAll('tasks')).filter((t) => !t.deletedAt);
    expect(live.find((t) => t.kind === 'Examine').done).toBe(false);
  });

  test('U11 取消一筆健檢 → 確認框印得出 Examine，不是三個系統並列', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/calendar');

    await page.click(`[data-day="${EXAM_DATE}"]`);
    // **取消只剩長按那一條路**（ADR-0089，2026-09-12）：讀取卡片沒有取消那一顆，
    // 鉛筆開的是只有那一段的，而「改這一天」與整天的狀態卡都拿掉了。
    // 那一天只有一段，所以取消那一段就是取消那一天。
    const row = page.locator('[data-open^="visit:visit-b-exam1:"]').first();
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.locator('.actionrow').first()).toBeVisible({ timeout: 5_000 });
    await page.mouse.up();
    await page.locator('.actionrow', { hasText: '取消這一段' }).click();

    await expect(app.dialog()).toBeVisible();
    const said = await app.dialogText();
    expect(said).toContain('取消 Examine');
    expect(said).not.toContain('Abovee');
    await app.cancelDialog();
  });
});

test.describe('讀取卡片上的「這一場的待辦」', () => {
  test('U7 日曆點開一筆健檢 → 看得到「追蹤健檢報告」與死線', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);

    await app.go('/calendar');
    await page.click(`[data-day="${EXAM_DATE}"]`);
    await page.locator('[data-open^="visit:visit-b-exam1:"]').click();

    const mirror = page.locator('.taskmirror');
    await expect(mirror).toBeVisible();
    await expect(mirror).toContainText('追蹤健檢報告');
    // 死線是健檢日 + 21 天
    const due = addDays(EXAM_DATE, 21);
    const [, m, d] = due.split('-');
    await expect(mirror).toContainText(`${Number(m)}/${Number(d)}`);
    // 已經結案的那一筆，「簽療程單」要看得到而且是做完的
    await expect(mirror).toContainText('簽療程單');
  });

  test('U8 那一塊裡一個勾選框都沒有 —— 只給看，不給勾', async ({ app, page }) => {
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);

    await app.go('/calendar');
    await page.click(`[data-day="${EXAM_DATE}"]`);
    await page.locator('[data-open^="visit:visit-b-exam1:"]').click();
    await expect(page.locator('.taskmirror')).toBeVisible();
    await expect(page.locator('.taskmirror input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('.taskmirror button')).toHaveCount(0);
  });

  test('U9 做完的不消失，是淡掉劃掉 —— 她要看到這一場的全部', async ({ app, page }) => {
    // 她 2026-09-04 的原話：「把所有代辦都列出來，然後完成的不要消失，
    // 而是淡掉劃掉，但我還是需要知道這一場的所有代辦。」
    await app.seed(seedBeforeClose());
    await app.signIn('/');
    await closeExam(app, page);

    await app.go('/calendar');
    await page.click(`[data-day="${EXAM_DATE}"]`);
    await page.locator('[data-open^="visit:visit-b-exam1:"]').click();

    const mirror = page.locator('.taskmirror');
    await expect(mirror).toBeVisible();
    // 已經結案了，但那兩列還在
    await expect(mirror).toContainText('跟客人確認時間');
    await expect(mirror).toContainText('簽療程單');

    const done = mirror.locator('.taskmirror__row.is-done');
    expect(await done.count()).toBeGreaterThan(0);
    // 而且真的是劃掉的，不只是變淡
    const struck = await done.first().locator('.taskmirror__kind').evaluate(
      (el) => getComputedStyle(el).textDecorationLine,
    );
    expect(struck).toContain('line-through');
  });

  test('U9b 取消掉的那一筆只剩取消那幾張，沒有的話整塊不出現', async ({ app, page }) => {
    const DAY = addDays(TODAY, 6);
    await app.seed([
      ...masterDocs(),
      customer({ id: 'cust-a', name: '客戶A' }),
      entitlement('cust-a', {
        id: 'ent-a', label: '營養點滴 6 次', type: 'single', courseId: 'course-iv-drip',
        totalQty: 6, doneCount: 0, bookedCount: 0,
      }),
      // 取消掉的：確認與簽單都不會再發生，而種子沒有任何取消任務
      visit({
        id: 'visit-a', customerId: 'cust-a', customerName: '客戶A',
        date: DAY, status: 'cancelled',
        slots: [slot({
          courseId: 'course-iv-drip', entitlementId: 'ent-a',
          startsAt: '14:00', endsAt: '15:00',
        })],
      }),
    ]);
    await app.signIn('/calendar');

    await page.click(`[data-day="${DAY}"]`);
    await page.locator('[data-open^="visit:visit-a:"]').click();
    await expect(page.locator('.popcard')).toBeVisible();
    // 卡片裡那一段（`.readslot`）畫出來了，代表 `visitReadHtml()` 整支跑完 ——
    // 「這一場的待辦」那一塊跟它是同一次 render，所以這時候問得準。
    await expect(page.locator('.popcard .readslot').first()).toBeVisible();
    // 一個空殼會讓她以為那裡壞了
    await expect(page.locator('.taskmirror')).toHaveCount(0);
  });
});

// ---------------------------------------------------------------------------
// 日曆抽屜裡勾一件待辦。她 2026-09-05 的原話：
//
//   > 我按確認之後他又會立刻跳出要不要收回？而且就算我關掉這個收回，
//   > 在這天的抽屜上他還是顯示沒被勾掉，要我重新整理後才會勾掉。
//
// 那是**兩個 bug 疊在一起**：
//
//   跳出第二張 —— `paint()` 的實作是 `openCard()`，而那一支第一行就是
//                 `closeCard()`。所以「原地重畫」在她眼裡是一張關掉、
//                 另一張跳出來，而新那一張寫著「拿回來，還沒做」。
//   抽屜不動   —— 那一塊從頭到尾只在 `openDay()` 那一刻畫過一次；
//                 卡片關掉時跑的 `render()` 重畫的是月曆那一片，
//                 而抽屜掛在 `document.body` 底下，不在 `el` 裡。
//
// 反過來那一邊也要盯：**沒有真的勾掉就不可以關**（營養品沒給完那一次）。
// 那一條在 `01-products.spec.js` 的 J-E9。
// ---------------------------------------------------------------------------

test.describe('日曆抽屜裡勾一件待辦', () => {
  const seedTodos = (extra = []) => [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    note({ id: 'n-today', text: '幫客戶A問週六有沒有位子', date: TODAY }),
    note({ id: 'n-other', text: '訂下個月的耗材', date: TODAY }),
    ...extra,
  ];

  /** 打開那一天的抽屜，點開一筆待辦的讀取卡片。 */
  async function openTodoCard(app, page, id = 'n-today') {
    await page.locator(`[data-day="${TODAY}"]`).first().click();
    await app.layer(`[data-open="note:${id}"]`);
    await page.locator(`[data-open="note:${id}"]`).click();
    await expect(page.locator('.popcard')).toBeVisible();
  }

  /** 抽屜裡那一列現在是不是劃掉的樣子。 */
  const rowOf = (page, id) => page.locator(`.timerow:has([data-open="note:${id}"])`);

  test('U16 勾掉 → 卡片自己收掉，不會再跳一張問要不要收回', async ({ app, page }) => {
    await app.seed(seedTodos());
    await app.signIn('/calendar');
    await openTodoCard(app, page);

    await expect(page.locator('[data-tick]')).toContainText('做完了，勾掉');
    await page.locator('[data-tick]').click();
    await app.saved();

    await expect(page.locator('.popcard'), '勾完那一張卡片要收掉').toHaveCount(0);
    // **不會有第二張。** 以前這裡會浮出一張寫著「拿回來，還沒做」的新卡片。
    // 「第二張沒有浮出來」要留一段時間才問得準，但 `saved()` 已經等到寫入
    // 結束＋畫面穩下來了 —— 那一張如果要浮，這時候已經浮了。
    await expect(page.locator('.popcard')).toHaveCount(0);
    await expect(page.locator('[data-tick]')).toHaveCount(0);

    const saved = await app.readDoc('notes', 'n-today');
    expect(saved.done).toBe(true);
    expect(saved.doneAt, '勾掉的時間要記下來（「已完成」那一格照它排）').toBeTruthy();
  });

  test('U17 抽屜還開著，而且那一列當場劃掉 —— 不用重新整理', async ({ app, page }) => {
    await app.seed(seedTodos());
    await app.signIn('/calendar');
    await openTodoCard(app, page);

    await page.locator('[data-tick]').click();
    await app.saved();

    // 抽屜留在原地 —— 她可能還想看那一天的其他東西
    await expect(page.locator('.drawer')).toBeVisible();
    // **沒有 page.reload()。** 這一行就是她回報的那個症狀。
    await expect(rowOf(page, 'n-today')).toHaveClass(/kind-todo--done/);
    // 而且真的是劃掉的，不只是換一個 class
    const struck = await rowOf(page, 'n-today').locator('.timerow__title').evaluate(
      (el) => getComputedStyle(el).textDecorationLine,
    );
    expect(struck).toContain('line-through');
    // 同一天的另一筆一個字都沒被動到
    await expect(rowOf(page, 'n-other')).not.toHaveClass(/kind-todo--done/);
  });

  test('U18 再點一次拿回來 → 一樣收掉，資料庫也退回去', async ({ app, page }) => {
    await app.seed(seedTodos([
      note({ id: 'n-done', text: '寄收據給客戶A', date: TODAY, done: true, doneAt: `${TODAY}T01:00:00.000Z` }),
    ]));
    await app.signIn('/calendar');
    await openTodoCard(app, page, 'n-done');

    await expect(page.locator('[data-tick]')).toContainText('拿回來，還沒做');
    await page.locator('[data-tick]').click();
    await app.saved();

    await expect(page.locator('.popcard')).toHaveCount(0);
    await expect(page.locator('.drawer')).toBeVisible();
    await expect(rowOf(page, 'n-done')).not.toHaveClass(/kind-todo--done/);

    const back = await app.readDoc('notes', 'n-done');
    expect(back.done).toBe(false);
    expect(back.doneAt).toBe(null);
  });

  test('U19 抽屜捲到一半勾一筆，不會被捲回最上面', async ({ app, page }) => {
    // `sheet.update()` 存在的理由就是這一條（它的註解寫的就是這句話）。
    //
    // **30 筆不是隨手挑的**：抽屜的 `max-height` 是 84dvh（`tokens.css` 的
    // `--sheet-peek-max`），在 414×896 上大約放得下 14 列 —— 剛好等於
    // 「有時候捲得動、有時候捲不動」，而那種測試比沒有測試更糟。
    const many = Array.from({ length: 30 }, (_, i) =>
      note({ id: `n-${i}`, text: `雜事第 ${i + 1} 件`, date: TODAY }));
    await app.seed([...masterDocs(), customer({ id: 'cust-a', name: '客戶A' }), ...many]);
    await app.signIn('/calendar');

    await page.locator(`[data-day="${TODAY}"]`).first().click();
    await app.layer('[data-open^="note:"]');

    const body = page.locator('.drawer__body');
    await body.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    // 捲動停下來了才量。**不要固定等** —— 平滑捲動慢一拍時量到的是半路上
    // 那個值，而這一支整支的判準就是「捲到哪裡」。
    await body.evaluate((el) => new Promise((done) => {
      let last = -1;
      const tick = () => {
        if (el.scrollTop === last) { done(); return; }
        last = el.scrollTop;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }));
    const before = await body.evaluate((el) => el.scrollTop);
    expect(before, '這一支要有東西可捲才問得出問題').toBeGreaterThan(0);

    // 捲到底之後最後那一列就在眼前，點它不會再被捲進來一次
    await page.locator('[data-open^="note:"]').last().click();
    await expect(page.locator('.popcard')).toBeVisible();
    await page.locator('[data-tick]').click();
    await app.saved();

    const after = await body.evaluate((el) => el.scrollTop);
    expect(after, '勾一筆隨手記不該把她捲回最上面').toBeGreaterThan(0);
  });
});

test.describe('哪一筆底下寫了字', () => {
  const DAY = addDays(TODAY, 5);

  const seedTwo = (extra = []) => [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    customer({ id: 'cust-c', name: '客戶C' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '營養點滴 6 次', type: 'single', courseId: 'course-iv-drip',
      totalQty: 6, doneCount: 0, bookedCount: 1,
    }),
    entitlement('cust-c', {
      id: 'ent-c', label: '復能 6 次', type: 'single', courseId: 'course-recovery',
      totalQty: 6, doneCount: 0, bookedCount: 1,
    }),
    // 有「記的話」
    visit({
      id: 'visit-note', customerId: 'cust-a', customerName: '客戶A',
      date: DAY, status: 'confirmed', note: '客人說要換床',
      slots: [slot({
        courseId: 'course-iv-drip', entitlementId: 'ent-a',
        startsAt: '09:00', endsAt: '10:00',
      })],
    }),
    // 什麼都沒有
    visit({
      id: 'visit-bare', customerId: 'cust-c', customerName: '客戶C',
      date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-c',
        startsAt: '11:00', endsAt: '12:00',
      })],
    }),
    ...extra,
  ];

  const rowOf = (page, id) => page.locator(`[data-open^="visit:${id}:"]`);

  test('U10 有「記的話」的那一列看得到記事本，沒有的那一列看不到', async ({ app, page }) => {
    await app.seed(seedTwo());
    await app.signIn('/calendar');
    await page.click(`[data-day="${DAY}"]`);

    await expect(rowOf(page, 'visit-note').locator('[aria-label="有記的話"]')).toHaveCount(1);
    await expect(rowOf(page, 'visit-bare').locator('[aria-label="有記的話"]')).toHaveCount(0);
  });

  test('U10b 掛得到備忘錄的那一列另外一顆圖示，兩顆可以同時在', async ({ app, page }) => {
    await app.seed(seedTwo([{
      path: 'playbooks',
      id: 'pb-drip',
      data: {
        title: '營養點滴', courseIds: ['course-iv-drip'],
        body: '飯後打針\n收好針頭', deletedAt: null,
      },
    }]));
    await app.signIn('/calendar');
    await page.click(`[data-day="${DAY}"]`);

    // 點滴那一筆：記的話 + 備忘錄，兩顆都在
    await expect(rowOf(page, 'visit-note').locator('[aria-label="有記的話"]')).toHaveCount(1);
    await expect(rowOf(page, 'visit-note').locator('[aria-label="有備忘錄"]')).toHaveCount(1);
    // 復能那一筆沒掛到那一份，兩顆都沒有
    await expect(rowOf(page, 'visit-bare').locator('[aria-label="有備忘錄"]')).toHaveCount(0);

    // 兩顆圖示沒有把狀態徽章擠掉（390px 的窄螢幕）
    await expect(rowOf(page, 'visit-note').locator('.badge')).toBeVisible();
  });
});

// ---------- 「已完成」那一格不可以黏到別的分類（prelaunch-audit-2026-09-23/issues/11） ----------

test.describe('分類頁的未完成／已完成', () => {
  const seedTabs = () => [
    ...masterDocs(),
    customer({ id: 'cust-t', name: '客戶A' }),
    task({ id: 't-ex1', customerId: 'cust-t', customerName: '客戶A', kind: 'Examine', dueDate: TODAY, done: true, doneAt: `${TODAY}T01:00:00.000Z` }),
    task({ id: 't-ex2', customerId: 'cust-t', customerName: '客戶A', kind: 'Examine', dueDate: TODAY, done: true, doneAt: `${TODAY}T02:00:00.000Z` }),
    task({ id: 't-yao', customerId: 'cust-t', customerName: '客戶A', kind: '耀聖', dueDate: addDays(TODAY, 1) }),
  ];

  test('U11 Examine 切到已完成 → 回待辦 → 點耀聖：停在未完成，看得到那一張', async ({ app, page }) => {
    await app.seed(seedTabs());
    await app.signIn('/');
    await app.go(`/todo/${encodeURIComponent('Examine')}`);
    await page.locator('[data-task-tab="done"]').click();
    await app.layer('[data-untick]');

    await app.go('/todo');
    await app.go(`/todo/${encodeURIComponent('耀聖')}`);
    await expect(page.locator('[data-task-tab][aria-pressed="true"]')).toHaveAttribute('data-task-tab', 'open');
    await expect(page.locator('[data-task="t-yao"]')).toBeVisible();
  });

  test('U12 在已完成那一格拿回一張：照樣停在已完成', async ({ app, page }) => {
    await app.seed(seedTabs());
    await app.signIn('/');
    await app.go(`/todo/${encodeURIComponent('Examine')}`);
    await page.locator('[data-task-tab="done"]').click();
    await app.layer('[data-untick]');
    await expect(page.locator('[data-untick]')).toHaveCount(2);

    await page.locator('[data-untick]').first().click();
    await app.saved();
    await expect(page.locator('[data-task-tab][aria-pressed="true"]')).toHaveAttribute('data-task-tab', 'done');
    await expect(page.locator('[data-untick]')).toHaveCount(1);
  });
});

test('U11b 同一個分類切到已完成 → 去日曆繞一圈 → 回來：回到未完成', async ({ app, page }) => {
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-t', name: '客戶A' }),
    task({ id: 't-ex1', customerId: 'cust-t', customerName: '客戶A', kind: 'Examine', dueDate: TODAY, done: true, doneAt: `${TODAY}T01:00:00.000Z` }),
    task({ id: 't-ex2', customerId: 'cust-t', customerName: '客戶A', kind: 'Examine', dueDate: addDays(TODAY, 1) }),
  ]);
  await app.signIn('/');
  await app.go(`/todo/${encodeURIComponent('Examine')}`);
  await page.locator('[data-task-tab="done"]').click();
  await app.layer('[data-untick]');

  await app.go('/calendar');
  await app.go(`/todo/${encodeURIComponent('Examine')}`);
  await expect(page.locator('[data-task-tab][aria-pressed="true"]')).toHaveAttribute('data-task-tab', 'open');
  await expect(page.locator('[data-task="t-ex2"]')).toBeVisible();
});
