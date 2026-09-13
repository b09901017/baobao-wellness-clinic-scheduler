// 客戶抬頭那一行與「買過什麼」（`.scratch/asks-2026-09-13/issues/05`、`06`，ADR-0090）。
//
// 她 2026-09-13：
//
// > 有關hero__meta(就是姓名下面的那個小標題)，不論是點進去詳情還是在客戶那頁呈現的
// > 我希望不用寫上次，下次麼時候來，不用寫line，電話……然後有關顧客會的我希望可以呈現像是
// > "0723 顧客會 新8萬方案x2+12萬健檢+EECPx40+sis(60)x5+ILIB(60)x5等等
//
// > 客戶詳情，額度，買過什麼那邊，不要把方案品項都列出來，只要像小標題那樣呈現就好
//
// 單元那一側（`tests/purchases.test.js`）釘的是字怎麼組；這一支釘的是兩頁真的印出來、
// 以前那幾樣真的不見了。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY, addDays } from '../fixtures/data.js';

const PHONE = '0912-000-111';
const LINE_ID = 'line-demo-01';

function seed() {
  const plan = { sourcePlanName: '新8萬方案', sourcePlanSets: 2, purchaseId: 'P-plan', purchasedAt: '2026-07-23' };
  return [
    ...masterDocs(),
    customer({ id: 'cust-h', name: '王小明', source: '顧客會', phone: PHONE, lineId: LINE_ID }),
    entitlement('cust-h', {
      id: 'e-pool', label: '復能-三選一(60)', type: 'pool', durationMin: 60,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'],
      totalQty: 27, sourcePlanQty: 24, ...plan,
    }),
    entitlement('cust-h', {
      id: 'e-ilib', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60,
      totalQty: 40, sourcePlanQty: 40, ...plan,
    }),
    entitlement('cust-h', {
      id: 'e-eecp', label: 'EECP', courseId: 'course-eecp', totalQty: 40,
      purchaseId: 'P-eecp', purchasedAt: '2026-07-23',
    }),
    entitlement('cust-h', {
      id: 'e-sis', label: '復能-SIS(60)', type: 'pool', durationMin: 60, optionEquipmentIds: ['eq-sis'],
      totalQty: 5, purchaseId: 'P-sis', purchasedAt: '2026-09-01',
    }),
    // 讓「上次」有東西可以印 —— 那一句要真的不見，不是剛好沒有來訪
    visit({
      id: 'v-h', customerId: 'cust-h', customerName: '王小明', date: addDays(TODAY, -3), status: 'done',
      slots: [slot({ courseId: 'course-eecp', entitlementId: 'e-eecp', startsAt: '10:00', endsAt: '10:30', attended: true })],
    }),
  ];
}

const HEADLINE = '0723 顧客會 新8萬方案x2+EECPx40+SIS(60)x5';

test('客戶頁的卡片：抬頭是買了什麼，沒有上次、下次、電話、LINE', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers');
  await app.go('/customers');

  const card = page.locator('a.card[href="#/customers/cust-h"]');
  const meta = card.locator('.hero__meta');
  await expect(meta).toHaveText(HEADLINE);
  await expect(card, '她：「不用寫上次，下次麼時候來」').not.toContainText('上次');
  await expect(card).not.toContainText('下次');
  await expect(card).not.toContainText(PHONE);
});

test('客戶詳情的抬頭：同一行，電話與 LINE 不上抬頭', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers/cust-h');
  await app.go('/customers/cust-h');

  const hero = page.locator('.hero');
  await expect(hero.locator('.hero__meta')).toHaveText(HEADLINE);
  await expect(hero).not.toContainText(PHONE);
  await expect(hero).not.toContainText(LINE_ID);
});

test('電話還找得到人（欄位留著，只是不上抬頭）', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/customers');
  await app.go('/customers');

  await page.locator('[data-search]').fill(PHONE);
  await expect(page.locator('a.card[href="#/customers/cust-h"]')).toBeVisible();
});
