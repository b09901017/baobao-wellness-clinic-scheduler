// 備忘錄／SOP。ADR-0067。
//
// 她要的是「在手機版可一鍵隨時查閱，不需要變成打勾任務」，而且入口要跟
// 客戶頁的「看這個月的進度」同一顆（她指名的做法）。
//
// 這一支盯五件事，五件都是「看起來對、其實不對」的那一種：
//
//   1. 待辦那一頁的右上角進得去（入口在導覽列以外的地方，很容易接漏）
//   2. 寫一份 → 存 → 清單上看得到 → 點進去讀得到每一行
//   3. 章節收起來之後**內容真的看不到**（grid 0fr 只是高度變 0，
//      文字節點還在 DOM 裡 —— 用 toBeVisible 才問得出來）
//   4. 編輯改一節 → 返回鍵回到**閱讀模式**，不是離開這一份（ADR-0048）
//   5. 這一頁上**一個勾選框都沒有**

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, playbook, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

test.describe('備忘錄／SOP', () => {
  test('P1 待辦頁右上角進得去，而且導覽列一個字都沒變', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/');

    // 導覽列還是五格 —— 這一輪刻意不動它
    await expect(page.locator('.app__nav a')).toHaveCount(5);

    await page.click('.page__row a[href="#/playbook"]');
    await app.settled();

    expect(page.url()).toContain('#/playbook');
    await expect(page.locator('.page__title')).toContainText('備忘錄');
  });

  test('P2 一份都沒有的時候給的是一條路，不是一句「沒有資料」', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/playbook');

    await expect(page.locator('#view')).toContainText('還沒有備忘錄');
    await expect(page.locator('[data-new]').first()).toBeVisible();
  });

  test('P3 寫一份、存起來、讀得到每一行', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/playbook');

    await page.click('[data-new]');
    await page.fill('input[name="title"]', '營養點滴');
    await page.fill('input[name="tag"]', '點滴');

    // 第一節：事前
    await page.selectOption('[data-when="0"]', 'before');
    await page.fill('[data-heading="0"]', '前情提醒');
    await page.fill('[data-body="0"]', '飯後打針（通知客人）\n預約系統註記');

    // 第二節：當天
    await page.click('[data-add]');
    await page.selectOption('[data-when="1"]', 'onday');
    await page.fill('[data-heading="1"]', '當天');
    await page.fill('[data-body="1"]', '提早十分鐘檢查房間');

    await page.click('button[type="submit"]');
    await app.settled();

    // 存完直接落在閱讀頁
    await expect(page.locator('.pb__title')).toHaveText('營養點滴');
    await expect(page.locator('.pblines li')).toHaveCount(3);
    await expect(page.locator('.pblines li').first()).toHaveText('飯後打針（通知客人）');

    // 有時機就有脊線；兩節都標了，所以是「事前」與「當天」
    await expect(page.locator('.pb__sections--staged')).toHaveCount(1);
    await expect(page.locator('.pbsec__when')).toHaveText(['事前', '當天']);

    // 回清單看得到
    await app.go('/playbook');
    await expect(page.locator('.pbcard__title')).toContainText('營養點滴');
    await expect(page.locator('.pbcard__meta')).toContainText('事前・當天');
  });

  test('P4 收起來之後那幾行**真的看不見**，再點一次又回來', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      playbook({
        id: 'pb-drip', title: '營養點滴', tag: '點滴',
        sections: ['before|前情提醒|飯後打針', 'onday|當天|提早十分鐘'],
      }),
    ]);
    await app.signIn('/playbook/pb-drip');

    // **量高度，不要問 toBeVisible。** 收起來的做法是 grid 的 0fr 加上
    // 外層 overflow:hidden，而 Playwright 的可見性不看祖先有沒有把它裁掉 ——
    // 那一行文字照樣「可見」。畫面上看不到的判準在這裡是高度。
    const wrap = page.locator('.pbsec').first().locator('.pbsec__wrap');
    const heightOf = async () => (await wrap.boundingBox())?.height ?? -1;

    expect(await heightOf()).toBeGreaterThan(10);

    await page.locator('.pbsec__head').first().click();
    await expect(page.locator('.pbsec__head').first()).toHaveAttribute('aria-expanded', 'false');
    await expect.poll(heightOf, { timeout: 5000 }).toBeLessThan(2);

    await page.locator('.pbsec__head').first().click();
    await expect(page.locator('.pbsec__head').first()).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(heightOf, { timeout: 5000 }).toBeGreaterThan(10);
  });

  test('P5 一節都沒標時機的那一份不畫脊線 —— 結構要講得出內容的真話', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      playbook({
        id: 'pb-rehab', title: '復健科流程', tag: '復健科',
        sections: ['||3 樓簽療程單報到\n4 樓 X 光'],
      }),
    ]);
    await app.signIn('/playbook/pb-rehab');

    await expect(page.locator('.pb__sections')).toHaveCount(1);
    await expect(page.locator('.pb__sections--staged')).toHaveCount(0);
    await expect(page.locator('.pbsec__dot')).toHaveCount(0);
    await expect(page.locator('.pblines li')).toHaveCount(2);
  });

  test('P6 編輯改一節，返回鍵回到閱讀模式而不是離開這一份', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      playbook({
        id: 'pb-drip', title: '營養點滴', tag: '點滴',
        sections: ['before|前情提醒|飯後打針'],
      }),
    ]);
    await app.signIn('/playbook/pb-drip');

    await page.click('[data-edit]');
    await expect(page.locator('[data-body="0"]')).toHaveValue('飯後打針');

    await page.goBack();
    await app.settled();

    // 回到閱讀模式，而且還在這一份上
    await expect(page.locator('.pb__title')).toHaveText('營養點滴');
    expect(page.url()).toContain('#/playbook/pb-drip');
  });

  test('P7 加一節之後，已經打到一半的字不會被弄丟', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/playbook');

    await page.click('[data-new]');
    await page.fill('input[name="title"]', '外檢');
    await page.fill('[data-body="0"]', '外院檢送總表');
    // 這一下會重畫章節那一塊 —— 沒有先把值收回 draft 的話上面那行就沒了
    await page.click('[data-add]');

    await expect(page.locator('[data-body="0"]')).toHaveValue('外院檢送總表');
    await expect(page.locator('[data-sec]')).toHaveCount(2);
  });

  test('P8 這一頁上一個勾選框都沒有 —— 它不是第二個待辦中心', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      playbook({
        id: 'pb-drip', title: '營養點滴',
        sections: ['before|前情提醒|飯後打針', 'onday|當天|提早十分鐘'],
      }),
    ]);
    await app.signIn('/playbook/pb-drip');

    await expect(page.locator('#view input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('#view')).not.toContainText('%');
  });

  test('P9 刪掉之後清單上沒有了，而且還原得回來', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      playbook({ id: 'pb-x', title: '要刪掉的', sections: ['||一行'] }),
    ]);
    await app.signIn('/playbook/pb-x');

    await page.click('[data-edit]');
    await page.click('[data-delete]');
    await page.click('[data-ok]');
    await app.settled();

    await expect(page.locator('#view')).toContainText('還沒有備忘錄');

    // 還原得回來（軟刪除，SPEC 第 6.1 節）
    await app.go('/settings/trash');
    await expect(page.locator('#view')).toContainText('要刪掉的');
  });
});

// ---------------------------------------------------------------------------
// 自己浮出來（ui/components/playbookHint.js）
//
// 「飯後打針該何時提醒」的答案：不開任務，而是讓點滴那份備忘錄的「事前」
// 那一節，在她正在發確認訊息的那一刻出現在畫面上。
// ---------------------------------------------------------------------------

test.describe('備忘錄自己浮出來', () => {
  const DRIP = playbook({
    id: 'pb-drip', title: '營養點滴', tag: '點滴', courseIds: ['course-iv-drip'],
    sections: [
      'before|前情提醒|飯後打針（通知客人）',
      'onday|當天|提早十分鐘檢查房間',
      'after|結束後|四樓要清理',
    ],
  });

  /** 一位排了點滴的客戶A。`when` 由那一筆的日期與狀態決定。 */
  function seedDrip({ date, status }) {
    return [
      ...masterDocs(),
      DRIP,
      customer({ id: 'cust-a', name: '客戶A' }),
      entitlement('cust-a', {
        id: 'ent-a-drip', label: '營養點滴', courseId: 'course-iv-drip', totalQty: 10,
      }),
      visit({
        id: 'v-drip', customerId: 'cust-a', customerName: '客戶A', date, status,
        slots: [slot({
          courseId: 'course-iv-drip', entitlementId: 'ent-a-drip',
          startsAt: '10:30', endsAt: '11:30', roomId: 'room-iv8', bed: 'A',
          ivProductId: 'iv-liver',
        })],
      }),
    ];
  }

  test('H1 日曆上點開還沒到的那一筆 → 浮出「事前」那一節', async ({ app, page }) => {
    await app.seed(seedDrip({ date: addDays(TODAY, 3), status: 'confirmed' }));
    await app.signIn('/calendar');

    await page.locator(`[data-day="${addDays(TODAY, 3)}"]`).first().click();
    await page.locator('[data-open="visit:v-drip"]').first().click();

    await expect(page.locator('.pbhint__when')).toHaveText('事前');
    await expect(page.locator('.pbhint li')).toHaveText(['飯後打針（通知客人）']);
  });

  test('H2 就是今天的那一筆 → 換成「當天」那一節', async ({ app, page }) => {
    await app.seed(seedDrip({ date: TODAY, status: 'confirmed' }));
    await app.signIn('/calendar');

    await page.locator(`[data-day="${TODAY}"]`).first().click();
    await page.locator('[data-open="visit:v-drip"]').first().click();

    await expect(page.locator('.pbhint__when')).toHaveText('當天');
    await expect(page.locator('.pbhint li')).toHaveText(['提早十分鐘檢查房間']);
  });

  test('H3 沒掛課程的那一份不會浮出來，而且整塊不留空殼', async ({ app, page }) => {
    const loose = playbook({
      id: 'pb-loose', title: '外院檢送', courseIds: [], sections: ['before|事前|帶血液常規'],
    });
    await app.seed([...seedDrip({ date: addDays(TODAY, 3), status: 'confirmed' }), loose]);
    await app.signIn('/calendar');

    await page.locator(`[data-day="${addDays(TODAY, 3)}"]`).first().click();
    await page.locator('[data-open="visit:v-drip"]').first().click();

    await expect(page.locator('.pbhint')).toHaveCount(1);
    await expect(page.locator('.popcard')).not.toContainText('外院檢送');
  });

  test('H4 「跟客人確認時間」那一頁固定浮「事前」—— 她正在打那則訊息', async ({ app, page }) => {
    await app.seed(seedDrip({ date: addDays(TODAY, 3), status: 'pending_confirm' }));
    await app.signIn('/todo/confirm');

    await expect(page.locator('.pbhint__when')).toHaveText('事前');
    await expect(page.locator('.pbhint li')).toHaveText(['飯後打針（通知客人）']);
  });

  test('H5 「看整份」通到那一份備忘錄', async ({ app, page }) => {
    await app.seed(seedDrip({ date: addDays(TODAY, 3), status: 'pending_confirm' }));
    await app.signIn('/todo/confirm');

    await page.click('.pbhint__more');
    await app.settled();

    expect(page.url()).toContain('#/playbook/pb-drip');
    await expect(page.locator('.pb__title')).toHaveText('營養點滴');
  });
});
