// 「問這輪的時間」依月份。
//
// 這一頁 2026-09-02 之前做兩件她沒有要求過的事：月份寫死是下個月，
// 名單綁死「身上還有沒有次數」。她的原話：
//
//   「不用看他身上還有沒有次數，就單純看他那個月有沒有被排過時間」
//   「已發連結（如果對方已回覆填寫完 或是他回覆我確認完 都不要消失
//     就把狀態呈現在已發連結這邊就好）」
//
// 四件事在這裡被盯著，四件都是「畫面看起來對、其實答錯了問題」的那一種：
//
//   1. 換得動月份，而且**產生的連結帶的是選中的那個月**
//   2. 身上 0 次的人照樣列得出來
//   3. 填完、收下之後那一列**不會消失**，狀態寫在那一列上
//   4. 她自己記的那幾位收在摺疊區，不是不見了

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, availability, TODAY,
} from '../fixtures/data.js';

// TODAY = 2026-08-29，所以預設看的是 9 月
const THIS_MONTH = '2026-08';
const NEXT_MONTH = '2026-09';

function seedPeople() {
  return [
    ...masterDocs(),

    // 甲：什麼都沒問過，身上還有次數
    customer({ id: 'cust-a', name: '客戶甲' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12, doneCount: 2,
      optionEquipmentIds: ['equip-indiba', 'equip-magnet', 'equip-laser'],
    }),

    // 乙：**次數用完了**。以前這一位整個不會出現
    customer({ id: 'cust-b', name: '客戶乙' }),
    entitlement('cust-b', {
      id: 'ent-b', label: '復能', type: 'pool', totalQty: 12, doneCount: 12,
      optionEquipmentIds: ['equip-indiba', 'equip-magnet', 'equip-laser'],
    }),

    // 丙：她自己在 LINE 問完、直接記進「不能的時間」的那一種（9 月那一份）
    customer({ id: 'cust-c', name: '客戶丙' }),
    entitlement('cust-c', {
      id: 'ent-c', label: '靜脈', type: 'single', courseId: 'course-iv-laser', totalQty: 10,
    }),
    availability('cust-c', {
      id: 'av-c-sep', rawText: '9/6 那星期不行',
      validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: '2026-08-18',
      rules: [{ kind: 'exclude_range', from: '2026-09-06', to: '2026-09-12' }],
    }),
  ];
}

test('A1 預設看下個月，而且身上 0 次的人照樣列得出來', async ({ app, page }) => {
  await app.seed(seedPeople());
  await app.signIn('/todo/ask');

  const body = await app.text();
  expect(body, '抬頭要印出在看哪個月').toMatch(/9\s*月/);
  expect(body).toContain('客戶甲');
  expect(body, '她的原話：「不用看他身上還有沒有次數」').toContain('客戶乙');
  expect(body, '剩幾次還是要講出來 —— 那是她提醒加購的線索').toContain('還剩 0 次');

  // 丙已經有 9 月的時間了，所以他不在要問的名單裡，但也沒有消失
  expect(body).not.toContain('客戶丙');
  expect(body).toMatch(/9月已經問到了\s*1\s*位/);

  // 按鈕上要印月份 —— 這一頁換得動月份，「產生表單連結」說不出是哪一個月的
  await expect(page.locator('[data-makelink="cust-a"]')).toContainText('產生9月的連結');
});

test('A2 換到上個月：名單跟著換，連結按鈕也跟著換', async ({ app, page }) => {
  await app.seed(seedPeople());
  await app.signIn('/todo/ask');

  await page.locator('[data-month-step="-1"]').click();
  await app.settled();

  const body = await app.text();
  expect(body, '往回一格是 8 月').toMatch(/8\s*月/);
  // 丙只有 9 月那一份，所以 8 月他也還沒問到 —— 這一格要看得到他
  expect(body).toContain('客戶丙');
  await expect(page.locator('[data-makelink="cust-a"]')).toContainText('產生8月的連結');

  // 再往前兩格到 10 月
  await page.locator('[data-month-step="1"]').click();
  await app.settled();
  await page.locator('[data-month-step="1"]').click();
  await app.settled();
  expect(await app.text()).toMatch(/10\s*月/);
});

test('A3 產生的連結帶的是**選中的那個月**，不是寫死的下個月', async ({ app, page }) => {
  await app.seed(seedPeople());
  await app.signIn('/todo/ask');

  // 換到這個月（8 月）再產生
  await page.locator('[data-month-step="-1"]').click();
  await app.settled();
  await page.locator('[data-makelink="cust-a"]').click();
  await page.waitForTimeout(2000);

  const invites = (await app.readAll('formInvites')).filter((i) => !i.deletedAt);
  expect(invites).toHaveLength(1);
  expect(invites[0].month, '以前這裡永遠是下個月').toBe(THIS_MONTH);
  expect(invites[0].validFrom).toBe('2026-08-01');
  expect(invites[0].validTo).toBe('2026-08-31');
  expect(invites[0].customerId).toBe('cust-a');
});

test('A4 別的月份的連結不算數 —— 8 月發過不代表 9 月問過', async ({ app, page }) => {
  await app.seed(seedPeople());
  await app.signIn('/todo/ask');

  // 在 8 月那一格發一條
  await page.locator('[data-month-step="-1"]').click();
  await app.settled();
  await page.locator('[data-makelink="cust-a"]').click();
  await page.waitForTimeout(2000);

  // 8 月：他在「已經發出」那一格
  await expect(page.locator('[data-asktab="sent"]')).toHaveAttribute('aria-pressed', 'true');
  expect(await app.text()).toContain('等待回覆');

  // 回到 9 月：他回到「還沒發連結」，而且看得到那一顆「產生9月的連結」
  await page.locator('[data-month-step="1"]').click();
  await app.settled();
  await page.locator('[data-asktab="todo"]').click();
  await page.waitForTimeout(300);
  await expect(page.locator('[data-makelink="cust-a"]')).toContainText('產生9月的連結');
});

/**
 * 這一條是這支測試存在的主要理由。以前客戶填完、她按「收下」之後，
 * 那一位就從這一頁**整個消失** —— 事情做完了沒有痕跡。
 */
test('A5 收下之後那一列還在「已經發出」，狀態變成「已確認排定」', async ({ app, page }) => {
  await app.seed([
    ...seedPeople(),
    // 已經發出、客戶已經填好、而且她已經收下的那一種
    {
      path: 'formInvites',
      id: 'inv-a-sep',
      data: {
        customerId: 'cust-a', customerName: '客戶甲', month: NEXT_MONTH,
        validFrom: '2026-09-01', validTo: '2026-09-30', sentAt: '2026-08-20',
      },
    },
    {
      path: 'formResponses',
      id: 'inv-a-sep',
      data: {
        token: 'inv-a-sep', customerId: 'cust-a', month: NEXT_MONTH,
        weekdays: [], dates: [], freeText: '', takenAt: '2026-08-22',
      },
    },
    availability('cust-a', {
      id: 'av-a-sep', rawText: '（客戶自己填的）', source: 'form',
      validFrom: '2026-09-01', validTo: '2026-09-30', collectedAt: '2026-08-22', rules: [],
    }),
  ]);
  await app.signIn('/todo/ask');

  await page.locator('[data-asktab="sent"]').click();
  await page.waitForTimeout(300);

  const body = await app.text();
  expect(body, '她的原話：「都不要消失」').toContain('客戶甲');
  expect(body).toContain('已確認排定');
  expect(body, '什麼時候收下的也要看得到').toMatch(/8\/22/);

  // 而且**不可以**掉到摺疊區去 —— 連結是發過的
  expect(body).not.toMatch(/9月已經問到了\s*2\s*位/);
});

test('A6 客戶填了、她還沒收下 → 「已填寫時段」，而且是琥珀色（她還有事要做）', async ({ app, page }) => {
  await app.seed([
    ...seedPeople(),
    {
      path: 'formInvites',
      id: 'inv-b-sep',
      data: {
        customerId: 'cust-b', customerName: '客戶乙', month: NEXT_MONTH,
        validFrom: '2026-09-01', validTo: '2026-09-30', sentAt: '2026-08-21',
      },
    },
    {
      path: 'formResponses',
      id: 'inv-b-sep',
      data: {
        token: 'inv-b-sep', customerId: 'cust-b', month: NEXT_MONTH,
        weekdays: [], dates: [], freeText: '', takenAt: null,
      },
    },
  ]);
  await app.signIn('/todo/ask');

  await page.locator('[data-asktab="sent"]').click();
  await page.waitForTimeout(300);

  const badge = page.locator('[data-card="cust-b"] .badge').first();
  await expect(badge).toHaveText('已填寫時段');
  await expect(badge, '這一格是她還有事要做的那一格').toHaveClass(/badge--soon/);
});

test('A7 這一頁是**看**的，換月份不會偷寫任何東西', async ({ app, page }) => {
  await app.seed(seedPeople());
  await app.signIn('/todo/ask');

  const before = (await app.readAll('formInvites')).length;

  for (const step of ['-1', '1', '1', '-1']) {
    // eslint-disable-next-line no-await-in-loop
    await page.locator(`[data-month-step="${step}"]`).click();
    // eslint-disable-next-line no-await-in-loop
    await app.settled();
  }

  expect((await app.readAll('formInvites')).length, '換月份不可以產生連結').toBe(before);
  expect(TODAY).toBe('2026-08-29');   // 這一支的月份預期全部靠它
});
