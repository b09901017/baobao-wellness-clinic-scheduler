// 備忘錄／SOP。ADR-0067（拿來讀的不是拿來勾的）與 ADR-0069（一疊左右滑的卡牌）。
//
// 她 2026-09-04 點過第一版之後要的：「像卡牌一樣可以左右滑動」「所有的清單可以
// 快速選，就顯示標題」「鉛筆點擊修改」「加一個備忘錄是右下角的浮動小泡泡」
// 「原本『寫一份』那個按鈕做成放大鏡，點開之後可以快速搜尋」。
//
// 這一支盯的是「看起來對、其實不對」的那幾種：
//
//   1. 待辦那一頁的右上角進得去（入口在導覽列以外的地方，很容易接漏）
//   2. 泡泡 → 打字 → 存 → 重新整理之後還在（存進去了沒，不是畫面上有沒有）
//   3. 丸子點一顆 → 那一張真的滑到畫面正中間（scrollIntoView 是非同步的）
//   4. 鉛筆 → **就地**編輯，不換頁（換頁會讓她失去「我在看第三張」）
//   5. 放大鏡 → 篩掉的是卡牌**與**丸子兩邊
//   6. 這一頁上一個勾選框都沒有

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, playbook, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const DRIP = playbook({
  id: 'pb-drip',
  title: '營養點滴',
  courseIds: ['course-iv-drip'],
  body: ['飯後打針（通知客人）', '預約系統註記', '提早十分鐘檢查房間', '四樓要清理', '收好針頭'],
});

const REHAB = playbook({
  id: 'pb-rehab', title: '復健科流程', courseIds: [], body: ['三樓報到', '帶健保卡'],
});

const LAB = playbook({
  id: 'pb-lab', title: '外院檢送', courseIds: [], body: ['帶血液常規'],
});

/** 一張卡有沒有真的停在畫面正中間附近。 */
async function centred(page, id) {
  return page.evaluate((cardId) => {
    const deck = document.querySelector('[data-deck]');
    const card = document.querySelector(`[data-card="${cardId}"]`);
    if (!deck || !card) return null;
    const d = deck.getBoundingClientRect();
    const c = card.getBoundingClientRect();
    return Math.abs((c.left + c.width / 2) - (d.left + d.width / 2));
  }, id);
}

test.describe('備忘錄／SOP', () => {
  test('P1 待辦頁右上角進得去，而且導覽列一個字都沒變', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/');

    // 導覽列還是五格 —— 這一輪刻意不動它
    await expect(page.locator('.app__nav a')).toHaveCount(5);

    await page.click('a[href="#/playbook"]');
    await app.settled();

    expect(page.url()).toContain('#/playbook');
    await expect(page.locator('.page__title')).toContainText('備忘錄');
  });

  test('P2 一份都沒有的時候給的是一條路，不是一句「沒有資料」', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/playbook');

    await expect(page.locator('#view')).toContainText('還沒有備忘錄');
    await expect(page.locator('[data-new]')).toBeVisible();
  });

  test('P3 右下角泡泡 → 打字 → 存 → **重新整理之後還在**', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/playbook');

    await page.click('[data-new]');
    await page.fill('[data-title]', '營養點滴');
    await page.fill('[data-body]', '飯後打針（通知客人）\n預約系統註記');

    // 掛一個課程：之後日曆點開那一筆才會自己浮出來
    await page.click('[data-chip="courseIds"][data-chip-value="course-iv-drip"]');

    await page.click('[data-save]');
    await app.settled();
    await page.waitForTimeout(600);

    await expect(page.locator('.pbcard__title')).toHaveText('營養點滴');
    await expect(page.locator('.pbcard__body')).toContainText('飯後打針（通知客人）');
    await expect(page.locator('.pbcard__courses')).toContainText('營養點滴');

    // 存進去了沒，不是畫面上有沒有
    await page.reload();
    await app.settled();
    await expect(page.locator('.pbcard__title')).toHaveText('營養點滴');
    await expect(page.locator('.pbcard__body')).toContainText('預約系統註記');
  });

  test('P4 標題空的存不下去，而且它講得出為什麼', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/playbook');

    await page.click('[data-new]');
    await page.fill('[data-body]', '有內容但沒標題');
    await page.click('[data-save]');

    await expect(page.locator('[data-errors]')).toContainText('要有一個標題');
    // 還留在編輯狀態，她打的字不可以被洗掉
    await expect(page.locator('[data-body]')).toHaveValue('有內容但沒標題');
  });

  test('P5 內容空的也存不下去 —— 打開會什麼都沒有', async ({ app, page }) => {
    await app.seed([...masterDocs()]);
    await app.signIn('/playbook');

    await page.click('[data-new]');
    await page.fill('[data-title]', '只有標題');
    await page.click('[data-save]');

    await expect(page.locator('[data-errors]')).toContainText('內容是空的');
  });

  test('P6 一疊卡照她寫下來的順序，丸子點一顆就滑到那一張', async ({ app, page }) => {
    await app.seed([...masterDocs(), DRIP, REHAB, LAB]);
    await app.signIn('/playbook');

    await expect(page.locator('.pbcard')).toHaveCount(3);
    await expect(page.locator('[data-goto]')).toHaveCount(3);
    await expect(page.locator('.pbdot')).toHaveCount(3);

    // 第三顆丸子 → 第三張滑到正中間
    await page.click('[data-goto="pb-lab"]');
    await expect.poll(() => centred(page, 'pb-lab'), { timeout: 4000 }).toBeLessThan(30);

    // 那一顆丸子與那一顆圓點跟著亮起來
    await expect(page.locator('[data-goto="pb-lab"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-dot="pb-lab"]')).toHaveAttribute('data-on', 'true');
  });

  test('P7 鉛筆 → 就地改 → 存 → 卡片上是新的字，重新整理還在', async ({ app, page }) => {
    await app.seed([...masterDocs(), REHAB]);
    await app.signIn('/playbook');

    await page.click('[data-edit="pb-rehab"]');
    // **沒有換頁** —— 網址一個字都不變，那正是卡牌的價值
    expect(page.url()).toContain('#/playbook');
    await expect(page.locator('.pbcard--edit')).toBeVisible();

    await page.fill('[data-body]', '三樓報到\n帶健保卡\n先量血壓');
    await page.click('[data-save]');
    await app.settled();
    await page.waitForTimeout(600);

    await expect(page.locator('.pbcard__body')).toContainText('先量血壓');

    await page.reload();
    await app.settled();
    await expect(page.locator('.pbcard__body')).toContainText('先量血壓');
  });

  test('P7b 編輯中右下角那顆泡泡收起來 —— 按下去會把她正在打的那一張換掉', async ({ app, page }) => {
    await app.seed([...masterDocs(), REHAB]);
    await app.signIn('/playbook');

    await expect(page.locator('[data-fab]')).toBeVisible();
    await page.click('[data-edit="pb-rehab"]');
    await expect(page.locator('[data-fab]')).not.toBeVisible();

    await page.click('[data-cancel]');
    await expect(page.locator('[data-fab]')).toBeVisible();
  });

  test('P8 取消不會留下任何東西', async ({ app, page }) => {
    await app.seed([...masterDocs(), REHAB]);
    await app.signIn('/playbook');

    await page.click('[data-edit="pb-rehab"]');
    await page.fill('[data-body]', '打到一半反悔了');
    await page.click('[data-cancel]');

    await expect(page.locator('.pbcard--edit')).toHaveCount(0);
    await expect(page.locator('.pbcard__body')).toContainText('三樓報到');
    await expect(page.locator('.pbcard__body')).not.toContainText('反悔');
  });

  test('P9 放大鏡 → 卡牌與丸子兩邊一起篩，收起來就還原', async ({ app, page }) => {
    await app.seed([...masterDocs(), DRIP, REHAB, LAB]);
    await app.signIn('/playbook');

    // 一開始搜尋列是收起來的
    await expect(page.locator('[data-searchwrap]')).toHaveAttribute('data-open', 'false');

    await page.click('[data-search-toggle]');
    await expect(page.locator('[data-searchwrap]')).toHaveAttribute('data-open', 'true');

    await page.fill('[data-search]', '復健');
    await expect(page.locator('.pbcard')).toHaveCount(1);
    await expect(page.locator('[data-goto]')).toHaveCount(1);
    await expect(page.locator('.pbcard__title')).toHaveText('復健科流程');

    // 內文也搜得到
    await page.fill('[data-search]', '針頭');
    await expect(page.locator('.pbcard__title')).toHaveText('營養點滴');

    // 收起來 = 清掉篩選。看不見的篩選條件會讓她以為備忘錄不見了
    await page.click('[data-search-toggle]');
    await expect(page.locator('.pbcard')).toHaveCount(3);
  });

  test('P10 刪掉要二次確認，而且還原得回來', async ({ app, page }) => {
    await app.seed([...masterDocs(), REHAB]);
    await app.signIn('/playbook');

    await page.click('[data-edit="pb-rehab"]');
    await page.click('[data-del]');
    await expect(app.dialog()).toBeVisible();
    await app.ok();
    await app.settled();
    await page.waitForTimeout(600);

    await expect(page.locator('#view')).toContainText('還沒有備忘錄');

    // 軟刪除：在「已刪除項目」裡看得到
    await app.go('/settings/trash');
    await expect(page.locator('#view')).toContainText('復健科流程');
  });

  test('P11 這一頁上**一個勾選框都沒有**（ADR-0067）', async ({ app, page }) => {
    await app.seed([...masterDocs(), DRIP, REHAB]);
    await app.signIn('/playbook');

    await expect(page.locator('#view input[type="checkbox"]')).toHaveCount(0);
    await expect(page.locator('#view')).not.toContainText('完成');

    // 編輯的時候也沒有
    await page.click('[data-edit="pb-drip"]');
    await expect(page.locator('#view input[type="checkbox"]')).toHaveCount(0);
  });

  test('P12 網址帶 id 就開在那一張 —— 它不是另一頁', async ({ app, page }) => {
    await app.seed([...masterDocs(), DRIP, REHAB, LAB]);
    await app.signIn('/playbook/pb-lab');

    // 整疊還在（這是「這一疊，開在那一張」，不是單獨一頁）
    await expect(page.locator('.pbcard')).toHaveCount(3);
    await expect.poll(() => centred(page, 'pb-lab'), { timeout: 4000 }).toBeLessThan(30);
  });
});

// ---------------------------------------------------------------------------
// 自己浮出來（ui/components/playbookHint.js）
//
// 「飯後打針該何時提醒」的答案：不開任務，而是讓點滴那份備忘錄的前幾行，
// 在她正在發確認訊息的那一刻出現在畫面上。洗版由**行數**擋（ADR-0069）。
// ---------------------------------------------------------------------------

test.describe('備忘錄自己浮出來', () => {
  /** 一位排了點滴的客戶A。 */
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

  test('H1 日曆上點開那一筆 → 浮出前幾行，並且說還有幾行', async ({ app, page }) => {
    await app.seed(seedDrip({ date: addDays(TODAY, 3), status: 'confirmed' }));
    await app.signIn('/calendar');

    await page.locator(`[data-day="${addDays(TODAY, 3)}"]`).first().click();
    await page.locator('[data-open^="visit:v-drip:"]').first().click();

    await expect(page.locator('.pbhint__title')).toHaveText('營養點滴');
    // 五行只印前四行，剩下的用一句話帶過 —— 那就是她說的「避免洗版」
    await expect(page.locator('.pbhint li')).toHaveCount(4);
    await expect(page.locator('.pbhint li').first()).toHaveText('飯後打針（通知客人）');
    await expect(page.locator('.pbhint__rest')).toContainText('還有 1 行');
  });

  test('H2 沒掛課程的那一份不會浮出來，而且整塊不留空殼', async ({ app, page }) => {
    await app.seed([...seedDrip({ date: addDays(TODAY, 3), status: 'confirmed' }), LAB]);
    await app.signIn('/calendar');

    await page.locator(`[data-day="${addDays(TODAY, 3)}"]`).first().click();
    await page.locator('[data-open^="visit:v-drip:"]').first().click();

    await expect(page.locator('.pbhint')).toHaveCount(1);
    await expect(page.locator('.popcard')).not.toContainText('外院檢送');
  });

  test('H3 「跟客人確認時間」那一頁也浮 —— 她正在打那則訊息', async ({ app, page }) => {
    await app.seed(seedDrip({ date: addDays(TODAY, 3), status: 'pending_confirm' }));
    await app.signIn('/todo/confirm');

    await expect(page.locator('.pbhint__title')).toHaveText('營養點滴');
    await expect(page.locator('.pbhint li').first()).toHaveText('飯後打針（通知客人）');
  });

  test('H4 「看整份」通到那一疊，而且開在那一張', async ({ app, page }) => {
    await app.seed([...seedDrip({ date: addDays(TODAY, 3), status: 'pending_confirm' }), REHAB]);
    await app.signIn('/todo/confirm');

    await page.click('.pbhint__more');
    await app.settled();

    expect(page.url()).toContain('#/playbook/pb-drip');
    await expect(page.locator('.pbcard')).toHaveCount(2);
    await expect.poll(() => centred(page, 'pb-drip'), { timeout: 4000 }).toBeLessThan(30);
  });
});
