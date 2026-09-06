// 警示（永久限制的第一層）。ADR-0064 + ADR-0074。
//
// 她的原話（2026-08）：「要多備註一個，血管難打，就是我壓表的時候要能明顯看到
// 這個客人是血管難打，像體內有金屬那樣標記。」
//
// 她的原話（2026-09-06）：「我覺得可以合併成兩層(警示/其餘)，然後血管難打，
// 體內有金屬，可以最明顯……其餘的提醒希望也可以選樣式，例如實心，什麼顏色，
// 或是空心甚麼顏色等等」
//
// 這一支盯的是**永久限制那兩層在畫面上真的分得出來**：
//
//   警示   自己挑顏色與填法（.flag--alert + .flag--solid / --outline）
//   其餘   壓表卡片牆上不畫              「固定禮拜五不行」那一種
//
// 第二層不畫是刻意的（`ui/components/flags.js` 的檔頭）：一張卡上十個字
// 等於全都沒有重點。
//
// **還盯一件更重要的事**：體內金屬**不再擋任何器材**（ADR-0074）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);

/**
 * 客戶E 身上兩層各有東西：
 *   體內金屬（警示，種子裡是紅・實心）
 *   血管難打（警示，種子裡是茶・空心）
 *   固定禮拜五不行（其餘）
 */
function seedTwoTiers() {
  return [
    ...masterDocs(),
    customer({
      id: 'cust-e',
      name: '客戶E',
      flags: ['體內金屬', '血管難打', '固定禮拜五不行'],
    }),
    entitlement('cust-e', {
      id: 'ent-e-recovery', label: '復能三選一(60)', type: 'pool', totalQty: 12,
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

test.describe('警示', () => {
  test('C1 壓表卡片牆上警示都看得到，其餘不畫', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
    await app.signIn('/');
    await openWall(app, page);

    const card = page.locator('[data-pick="cust-e"]');
    await expect(card).toContainText('體內金屬');
    await expect(card).toContainText('血管難打');
    // 第二層照舊不畫 —— 一張卡上十個字等於全都沒有重點
    await expect(card).not.toContainText('固定禮拜五不行');
  });

  test('C2 兩個警示的樣式各自跟著主檔走', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
    await app.signIn('/');
    await openWall(app, page);

    const card = page.locator('[data-pick="cust-e"]');
    // 種子：體內金屬 紅・實心、血管難打 茶・空心
    await expect(card.locator('.flag--solid')).toHaveText('體內金屬');
    await expect(card.locator('.flag--outline')).toHaveText('血管難打');
    await expect(card.locator('.flag--solid'))
      .toHaveAttribute('style', /--flag-fg: var\(--evcolor-red\)/);
  });

  test('C3 記錄面板上兩層都在（SPEC 4.3：任何畫面都不可摺疊隱藏）', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
    await app.signIn('/');
    await openWall(app, page);

    await page.locator('[data-pick="cust-e"]').first().click();
    await page.waitForTimeout(600);

    const deck = page.locator('.deck__card').first();
    await expect(deck).toContainText('體內金屬');
    await expect(deck).toContainText('血管難打');
    await expect(deck).toContainText('固定禮拜五不行');
  });

  test('C4 客戶詳情上兩層各自的畫法', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
    await app.signIn('/customers/cust-e');

    const hero = page.locator('.hero__flags');
    await expect(hero.locator('.flag--solid')).toHaveText('體內金屬');
    await expect(hero.locator('.flag--outline')).toHaveText('血管難打');
    await expect(hero).toContainText('固定禮拜五不行');
  });

  test('C5 編輯永久限制時，警示是一排點得到的丸子，不是自由輸入', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
    await app.signIn('/customers/cust-e');

    await page.locator('[data-edit]').click();
    await app.settled();

    // 種子資料裡的三個都在（體內金屬、血管難打、第一針）
    await expect(page.locator('[data-alert]')).toHaveCount(3);
    await expect(page.locator('[data-alert="血管難打"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-alert="體內金屬"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-alert="第一針"]')).toHaveAttribute('aria-pressed', 'false');

    // **自由輸入那一欄不可以又出現一次警示** —— 那會讓整張表單
    // 因為重複而存不下去，而畫面上沒有一個欄位看起來是錯的
    await expect(page.locator('[data-others]')).toHaveValue('固定禮拜五不行');
  });

  test('C6 點一顆丸子把「第一針」加上去，存完之後卡片牆上就看得到', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
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

  test('C7 體內金屬不再擋掉任何器材 —— 三台照樣三台，選了才講一句', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
    await app.signIn('/');
    await openWall(app, page);

    await page.locator('[data-pick="cust-e"]').first().click();
    await page.waitForTimeout(600);
    await page.locator('[data-ent="ent-e-recovery"]').click();
    await app.settled();

    // 三顆都在，而且**一顆都沒有被關掉**
    const chips = page.locator('[data-equipment]');
    await expect(chips).toHaveCount(3);
    await expect(page.locator('[data-equipment][disabled]')).toHaveCount(0);

    // 還沒選 → 一句話都不講
    await expect(page.locator('[data-eqnotice]')).toBeEmpty();

    // 選了 INDIBA（沒事的那一台）→ 照樣不講
    await page.locator('[data-equipment="eq-indiba"]').click();
    await expect(page.locator('[data-eqnotice]')).toBeEmpty();

    // 選了超磁場 → 跳出來，而且講得出原因與建議
    await page.locator('[data-equipment="eq-sis"]').click();
    const notice = page.locator('[data-eqnotice] .warn--hard');
    await expect(notice).toContainText('超磁場');
    await expect(notice).toContainText('體內金屬');
    await expect(notice).toContainText('建議改用 INDIBA');
  });

  test('C8 設定裡加一個新的警示並挑顏色，客戶那一排就多一顆', async ({ app, page }) => {
    await app.seed(seedTwoTiers());
    await app.signIn('/settings/clinicalFlags');

    await page.locator('[data-new]').click();
    await app.settled();
    await page.fill('input[name="name"]', '怕痛');
    await page.locator('[data-colour="violet"]').click();
    await page.locator('[data-chip="fill"][data-chip-value="solid"]').click();
    // 預覽要當場跟著改，不是存完才看得到
    await expect(page.locator('[data-alertpreview] .flag--solid'))
      .toHaveAttribute('style', /--flag-fg: var\(--evcolor-violet\)/);

    await page.locator('button[type="submit"]').click();
    await app.settled();
    await expect(page.locator('#view')).toContainText('怕痛');

    await app.go('/customers/cust-e');
    await page.locator('[data-edit]').click();
    await app.settled();
    await expect(page.locator('[data-alert="怕痛"]')).toHaveCount(1);
  });
});
