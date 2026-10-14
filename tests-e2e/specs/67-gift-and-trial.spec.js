// 送的／體驗（2026-10-14，gift-and-trial）。
//
// 她的原話：
//
// > 就是如果有標註體驗的就直接送不算次數，就不會被沒有額度檔，畢竟是送的，但是來訪以及試算表還是要標註(送的)、(體驗)
//
// 規則（放不放行、名字、次數）在 domain，`tests/gift-kind.test.js` 盯著；拍 Abovee 的翻譯在
// `tests/gift-kind-entrances.test.js`。這一支從瀏覽器走**來訪編輯器**那幾條 node 裡走不到的路 ——
// 盯的是「畫面看起來對、存進去是錯的」：送的被安靜地改成體驗、體驗改回扣額度時那一格被留著、
// 器材那一排選得到 ILIB、時長那一排沒有 30。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, TODAY } from '../fixtures/data.js';

const DAY = TODAY;

const poolCustomer = () => [
  customer({ id: 'cust-g', name: '王小明' }),
  entitlement('cust-g', {
    id: 'ent-pool', label: '復能-三選一(60)', type: 'pool',
    optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'],
    totalQty: 12, doneCount: 2, bookedCount: 0, durationMin: 60,
  }),
];

const giftVisit = (slotOver, visitOver = {}) => visit({
  id: 'v-g', customerId: 'cust-g', customerName: '王小明', date: DAY, status: 'pending_confirm',
  ...visitOver,
  slots: [{ status: visitOver.status ?? 'pending_confirm', ...slotOver }],
});

async function openDay(app, page) {
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
}

/** 點那一列 → 讀取卡片 → 按鉛筆 → 編輯器（同 `25` 的動線）。 */
async function openEditor(app, page) {
  await page.locator('[data-open^="visit:v-g:"]').first().click();
  await app.layer('.popcard');
  await page.locator('[data-card-edit]').click();
  await app.layer('.slotcard');
}

test('G1 一段「送的」心臟科評估只選一位醫師存回去：還是送的（不會被安靜地改成體驗）', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({ courseId: 'course-cardio', entitlementId: null, startsAt: '10:00', endsAt: '10:30' }),
    giftKind: 'gift',
  })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await expect(page.locator('[data-open^="visit:v-g:"]').first(), '日／週那一列看得出是送的').toContainText('(送的)');
  await openEditor(app, page);

  await expect(page.locator('.slothead__what')).toHaveText('心臟科評估(送的)');
  await page.locator('[data-chip="s0-doc"]', { hasText: '簡' }).click();
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-g');
  expect(saved.slots).toHaveLength(1);
  expect(saved.slots[0].giftKind).toBe('gift');
  expect(saved.slots[0].entitlementId).toBeNull();
  expect(saved.slots[0].doctorId).toBe('staff-dr-jian');
});

test('G2 一段體驗的復能：器材只有復能那三台、排多久有 30／60；改回扣三選一 → 那一格清掉、扣那一筆', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({
      courseId: 'course-recovery', entitlementId: null, startsAt: '10:00', endsAt: '10:30',
      equipmentId: 'eq-indiba', therapistId: 'staff-tw',
    }),
    giftKind: 'trial', minutes: 30,
  })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditor(app, page);

  await expect(page.locator('.slothead__what')).toHaveText('IN(30)(體驗)');
  await expect(page.locator('[data-chip="s0-equip"]'), '復能那三台').toHaveCount(3);
  await expect(page.locator('[data-chip="s0-equip"][data-chip-value="eq-ilib"]'), '沒有 ILIB').toHaveCount(0);
  await expect(page.locator('[data-chip="s0-min"]')).toHaveCount(2);
  await expect(page.locator('[data-chip="s0-min"][data-chip-value="30"]')).toHaveAttribute('aria-pressed', 'true');

  await page.locator('[data-chip="s0-ent"][data-chip-value="ent-pool"]').click();
  await expect(page.locator('.slothead__what'), '扣額度的段不帶標記').toHaveText('IN(60)');
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-g');
  expect(saved.slots).toHaveLength(1);
  expect(saved.slots[0].entitlementId).toBe('ent-pool');
  expect(saved.slots[0].giftKind, '兩種身分只挑一種').toBeNull();
  expect(saved.slots[0].equipmentId).toBe('eq-indiba');
  const ent = await app.readDoc('customers/cust-g/entitlements', 'ent-pool');
  expect(ent.bookedCount, '這一段開始扣').toBe(1);
});

test('G3 改一段體驗的時間（取消＋重新排）：取消的那一段與新的那一段都是體驗', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...poolCustomer(), giftVisit({
    ...slot({ courseId: 'course-cardio', entitlementId: null, startsAt: '10:00', endsAt: '10:30', doctorId: 'staff-dr-jian' }),
    giftKind: 'trial',
  }, { status: 'confirmed' })]);
  await app.signIn('/calendar');
  await openDay(app, page);
  await openEditor(app, page);

  await page.locator('input[name="s0-start"]').fill('14:00');
  await page.locator('button[type="submit"]').first().click();
  await app.ok();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-g');
  expect(saved.slots.map((s) => [s.startsAt, s.status, s.giftKind])).toEqual([
    ['10:00', 'cancelled', 'trial'],
    ['14:00', 'pending_confirm', 'trial'],
  ]);
});
