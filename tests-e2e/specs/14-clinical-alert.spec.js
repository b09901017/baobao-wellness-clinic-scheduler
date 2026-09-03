// 臨床提醒（血管難打）。ADR-0064。
//
// 她的原話：「要多備註一個，血管難打，就是我壓表的時候要能明顯看到這個客人是
// 血管難打，像體內有金屬那樣標記。」
//
// 這一支盯的是**永久限制那三層在畫面上真的分得出來**：
//
//   醫療禁忌   實心紅（.flag--block）  這台機器不能用
//   臨床提醒   茶色外框（.flag--alert） 這個人做起來要注意
//   其餘       壓表卡片牆上不畫        「固定禮拜五不行」那一種
//
// 第三層不畫是刻意的（`ui/components/flags.js` 的檔頭）：一張卡上十個字
// 等於全都沒有重點。而這一輪要證明的正是「血管難打**不在**第三層」。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);

/**
 * 客戶E 身上三層各一個：
 *   體內金屬（禁忌，會鎖掉超磁場與高能量雷射）
 *   血管難打（臨床提醒，什麼都不擋）
 *   固定禮拜五不行（其餘）
 */
function seedThreeTiers() {
  return [
    ...masterDocs(),
    customer({
      id: 'cust-e',
      name: '客戶E',
      flags: ['體內金屬', '血管難打', '固定禮拜五不行'],
    }),
    entitlement('cust-e', {
      id: 'ent-e-recovery', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
  ];
}

/** 開一批這個月的壓表，停在卡片牆上（還沒點進任何一位）。 */
async function openWall(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await page.locator('[data-start]').click();
  await app.settled();
}

test.describe('臨床提醒', () => {
  test('C1 壓表卡片牆上兩層都看得到，第三層不畫', async ({ app, page }) => {
    await app.seed(seedThreeTiers());
    await app.signIn('/');
    await openWall(app, page);

    const card = page.locator('[data-pick="cust-e"]');
    await expect(card).toContainText('體內金屬');
    // **這是她要的那一件事**：血管難打要跟體內金屬一樣出現在卡片牆上
    await expect(card).toContainText('血管難打');
    // 第三層照舊不畫 —— 一張卡上十個字等於全都沒有重點
    await expect(card).not.toContainText('固定禮拜五不行');
  });

  test('C2 兩層的畫法分得出來 —— 一個擋東西，一個只是要注意', async ({ app, page }) => {
    await app.seed(seedThreeTiers());
    await app.signIn('/');
    await openWall(app, page);

    const card = page.locator('[data-pick="cust-e"]');
    await expect(card.locator('.flag--block').first()).toHaveText('體內金屬');
    await expect(card.locator('.flag--alert')).toHaveText('血管難打');
  });

  test('C3 記錄面板上三層都在（SPEC 4.3：任何畫面都不可摺疊隱藏）', async ({ app, page }) => {
    await app.seed(seedThreeTiers());
    await app.signIn('/');
    await openWall(app, page);

    await page.locator('[data-pick="cust-e"]').first().click();
    await page.waitForTimeout(600);

    const deck = page.locator('.deck__card').first();
    await expect(deck).toContainText('體內金屬');
    await expect(deck).toContainText('血管難打');
    await expect(deck).toContainText('固定禮拜五不行');
  });

  test('C4 客戶詳情上三層各自的畫法', async ({ app, page }) => {
    await app.seed(seedThreeTiers());
    await app.signIn('/customers/cust-e');

    const hero = page.locator('.hero__flags');
    await expect(hero.locator('.flag--alert')).toHaveText('血管難打');
    await expect(hero).toContainText('體內金屬');
    await expect(hero).toContainText('固定禮拜五不行');
  });

  test('C5 編輯永久限制時，臨床提醒是一排點得到的丸子，不是自由輸入', async ({ app, page }) => {
    await app.seed(seedThreeTiers());
    await app.signIn('/customers/cust-e');

    await page.locator('[data-edit]').click();
    await app.settled();

    // 種子資料裡的兩個都在
    await expect(page.locator('[data-alert]')).toHaveCount(2);
    await expect(page.locator('[data-alert="血管難打"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-alert="第一針"]')).toHaveAttribute('aria-pressed', 'false');

    // **自由輸入那一欄不可以又出現一次血管難打** —— 那會讓整張表單
    // 因為重複而存不下去，而畫面上沒有一個欄位看起來是錯的
    await expect(page.locator('[data-others]')).toHaveValue('固定禮拜五不行');
  });

  test('C6 點一顆丸子把「第一針」加上去，存完之後卡片牆上就看得到', async ({ app, page }) => {
    await app.seed(seedThreeTiers());
    await app.signIn('/customers/cust-e');

    await page.locator('[data-edit]').click();
    await app.settled();
    await page.locator('[data-alert="第一針"]').click();
    await page.locator('button[type="submit"]').click();
    await app.settled();

    await expect(page.locator('.hero__flags')).toContainText('第一針');

    await openWall(app, page);
    await expect(page.locator('[data-pick="cust-e"]')).toContainText('第一針');
  });

  test('C7 臨床提醒不擋任何器材 —— 擇一池三台照樣三台', async ({ app, page }) => {
    await app.seed([
      ...masterDocs(),
      customer({ id: 'cust-f', name: '客戶F', flags: ['血管難打'] }),
      entitlement('cust-f', {
        id: 'ent-f-recovery', label: '復能', type: 'pool', totalQty: 12,
        optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
      }),
    ]);
    await app.signIn('/');
    await openWall(app, page);

    const card = page.locator('[data-pick="cust-f"]');
    await expect(card).toContainText('血管難打');
    // 「只能 INDIBA」那一句只有在真的被擋住的時候才出現
    await expect(card).not.toContainText('只能');
    await expect(card).not.toContainText('不能用');
  });

  test('C8 設定裡加一個新的臨床提醒，客戶那一排就多一顆', async ({ app, page }) => {
    await app.seed(seedThreeTiers());
    await app.signIn('/settings/clinicalFlags');

    await page.locator('[data-new]').click();
    await app.settled();
    await page.fill('input[name="name"]', '怕痛');
    await page.locator('button[type="submit"]').click();
    await app.settled();
    await expect(page.locator('#view')).toContainText('怕痛');

    await app.go('/customers/cust-e');
    await page.locator('[data-edit]').click();
    await app.settled();
    await expect(page.locator('[data-alert="怕痛"]')).toHaveCount(1);
  });
});
