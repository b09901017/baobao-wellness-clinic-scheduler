// 三選一 / 四選一：要治療師還是治療室，由她挑的那一台器材決定。
//
// 她 2026-09-08：
//
// > 在新增來訪壓表選「三選一」或「四選一」時，無論使用者細選哪一種器材，
// > 系統均只強制彈出「診間/治療室」選項，未切換為指派治療師。
//
// 根因在 `coursesForEntitlement()`：預設課程是「池上第一台器材指到的那一個」，
// 而池上的順序來自主檔讀回來的順序（`data/repo.js` 的 `list()` 沒有 orderBy，
// Firestore 回文件 id 升冪，`eq-ilib` 剛好排最前面）。於是四選一的預設課程
// 變成 ILIB —— 要診間。
//
// 這一支盯三件事：
//   1. 還沒挑器材時**兩排都不畫**，而且講得出為什麼
//   2. 挑了復能那三台之一 → 治療師
//   3. 挑了 ILIB → 治療室，而且剛剛挑的治療師被清掉

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement } from '../fixtures/data.js';

const MONTH = '2026-09';
const PICK_DAY = '2026-09-03';

function seedFourInOne() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A', priority: 4 }),
    entitlement('cust-a', {
      id: 'ent-four', label: '復能-四選一(60)', type: 'pool', totalQty: 12,
      // **ILIB 排第一** —— 這正是她資料庫裡的順序（文件 id 升冪）
      optionEquipmentIds: ['eq-ilib', 'eq-indiba', 'eq-laser', 'eq-sis'],
      durationMin: 60,
    }),
  ];
}

async function openDeck(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await page.locator('[data-start]').click();
  await app.settled();
  await page.locator('[data-pick="cust-a"]').first().click();
  await page.waitForTimeout(600);
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await page.waitForTimeout(400);
  await page.locator('[data-ent="ent-four"]').click();
  await page.waitForTimeout(300);
}

const therapistRow = (page) => page.locator('[data-therapist]');
const roomRow = (page) => page.locator('[data-room]');

test('四選一：還沒挑器材時兩排都不畫，挑了才知道要誰', async ({ app, page }) => {
  await app.seed(seedFourInOne());
  await app.signIn('/');
  await openDeck(app, page);

  // 器材那一排在，指派那兩排都不在
  await expect(page.locator('[data-equipment]')).toHaveCount(4);
  await expect(therapistRow(page), '還沒挑器材就不該出現治療師').toHaveCount(0);
  await expect(roomRow(page), '還沒挑器材更不該出現診間').toHaveCount(0);
  await expect(page.locator('#view')).toContainText('先選上面那一台');

  // 挑 SIS → 治療師
  await page.locator('[data-equipment="eq-sis"]').click();
  await page.waitForTimeout(300);
  await expect(therapistRow(page).first(), 'SIS 要物理治療師').toBeVisible();
  await expect(roomRow(page)).toHaveCount(0);

  await page.locator('[data-therapist="staff-tw"]').click();

  // 換成 ILIB → 治療室，而且剛剛挑的治療師要被清掉
  await page.locator('[data-equipment="eq-ilib"]').click();
  await page.waitForTimeout(300);
  await expect(roomRow(page).first(), 'ILIB 要治療室').toBeVisible();
  await expect(therapistRow(page), 'ILIB 不佔治療師').toHaveCount(0);

  // 再換回 INDIBA → 又是治療師，而且沒有留著剛剛那一間
  await page.locator('[data-equipment="eq-indiba"]').click();
  await page.waitForTimeout(300);
  await expect(therapistRow(page).first()).toBeVisible();
  await expect(roomRow(page)).toHaveCount(0);
  await expect(
    page.locator('[data-therapist][aria-pressed="true"]'),
    '換過器材之後治療師要重挑 —— 留著舊的會存進一段不相干的指派',
  ).toHaveCount(0);
});

test('四選一：池選了、器材沒選，存不下去', async ({ app, page }) => {
  await app.seed(seedFourInOne());
  await app.signIn('/');
  await openDeck(app, page);

  await page.locator('[data-time]').first().click();
  await page.locator('[data-add]').click();
  await page.waitForTimeout(400);

  // 訊息裡要寫得出是哪一筆額度 ——「ILIB 每次都要記錄器材」是一句她看不懂的話
  await expect(page.locator('#view')).toContainText('復能-四選一(60)');
  await expect(page.locator('#view')).toContainText('器材');
});
