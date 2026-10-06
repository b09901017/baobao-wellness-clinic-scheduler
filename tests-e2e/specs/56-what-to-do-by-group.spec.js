// 來訪的「做什麼」那一排：照分類排、每一類一個小標（2026-10-06，issue 08）。
//
// 她的原話（問她兩層還是小標）：
//
// > 問題 5：我覺得先照你的建議依照分類排列並加小標，不增加點選步驟，但是要提醒我去測試和你說好不好
//
// 順序與小標的規則在 `tests/slot-options-order.test.js`（`arrangeSlotOptions()`）。
// 這一支量的是只有畫面上看得到的那一件：**健檢與二返實體上不是隔壁**。
// 只掃字串的測試在這種事上騙過人（`CLAUDE.md`「貼在畫面底部的東西」那一列）—— 所以量位置。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, addDays, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
/** 這個月裡還沒過的一天（月底那幾天就用今天）。 */
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;

const someone = () => [
  customer({ id: 'cust-w', name: '客戶A' }),
  entitlement('cust-w', {
    id: 'e-pool', label: '復能-三選一(60)', type: 'pool',
    optionEquipmentIds: ['eq-indiba', 'eq-sis', 'eq-laser'], totalQty: 12, durationMin: 60,
  }),
  entitlement('cust-w', { id: 'e-cardio', label: '心臟科評估', courseId: 'course-cardio', totalQty: 1 }),
  entitlement('cust-w', { id: 'e-chk', label: '8萬健檢', courseId: 'course-checkup', totalQty: 1, tier: '8萬' }),
  entitlement('cust-w', {
    id: 'e-fu', label: '二返(8萬健檢)', courseId: 'course-followup', totalQty: 1,
    followupForEntitlementId: 'e-chk',
  }),
];

const texts = (loc) => loc.evaluateAll((els) => els.map((el) => el.textContent.trim()));

/**
 * 幾個元素的位置，**在同一個畫面裡一次量**。分兩次 `boundingBox()` 的話，點了某一天之後那一張還在
 * 平滑捲動，兩個數字來自不同的時刻（第一次跑就是這樣紅的）。
 */
const rects = (page, selectors) => page.evaluate((list) => list.map((s) => {
  const r = document.querySelector(s).getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, mid: (r.top + r.bottom) / 2, height: r.height };
}), selectors);

/** 二返那一顆在健檢那一顆底下（另起一行），不是在它右邊。 */
async function below(page, exam, back) {
  const [a, b] = await rects(page, [exam, back]);
  expect(b.top, '二返那一顆要在健檢那一顆的下一行').toBeGreaterThanOrEqual(a.bottom - 1);
}

test('W1 壓表：照分類排、每一類一個小標；二返那一組另起一行', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...someone()]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-w"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');

  expect(await texts(page.locator('.chips .chiprow__lead')))
    .toEqual(['復能', '醫師門診', '健檢', '二返・n返']);
  // 醫師門診那一組：額度在前、不算次數的課接在後面
  const order = await page.locator('.chips [data-ent]').evaluateAll((els) => els.map((el) => el.dataset.ent));
  expect(order.slice(0, 2)).toEqual(['e-pool', 'e-cardio']);
  expect(order.at(-2)).toBe('e-chk');
  expect(order.at(-1), '二返照舊排最後').toBe('e-fu');
  await below(page, '[data-ent="e-chk"]', '[data-ent="e-fu"]');
  // 小標跟那一類第一顆在同一行（這一排會換行 —— 分開的話小標會掛在上一行的尾巴）
  for (const first of ['e-cardio', 'e-chk', 'e-fu']) {
    // 那一類的小標就是那一顆前面那一個（`.chips__head` 裡的第一個）
    const [lead, chip] = await rects(page, [
      `.chips__head:has([data-ent="${first}"]) .chiprow__lead`, `[data-ent="${first}"]`,
    ]);
    expect(Math.abs(lead.mid - chip.mid), `${first} 那一類的小標跟它在同一行`).toBeLessThan(chip.height / 2);
  }
});

test('W2 來訪編輯器：同一個順序與小標；二返在第二行', async ({ app, page }) => {
  await app.seed([...masterDocs(), ...someone()]);
  await app.signIn('/');
  await app.go(`/visits/new/cust-w/${PICK_DAY}`);
  await app.layer('[data-chip="s0-ent"]');

  const row = page.locator('.fieldgroup').filter({ has: page.locator('[data-chip="s0-ent"]') });
  expect(await texts(row.locator('.chiprow__lead'))).toEqual(['復能', '醫師門診', '健檢', '二返・n返']);
  await expect(row.locator('.chiprow--next [data-chip-value="e-fu"]')).toHaveCount(1);
  await below(page, '[data-chip="s0-ent"][data-chip-value="e-chk"]', '[data-chip="s0-ent"][data-chip-value="e-fu"]');

  // 新的一段預設扣的是那一排最左邊那一顆（不是讀回來的第一筆）
  await expect(page.locator('[data-chip="s0-ent"][aria-pressed="true"]')).toHaveAttribute('data-chip-value', 'e-pool');

  // 選一顆只換按著的那一顆，二返照樣按得到
  await page.locator('[data-chip="s0-ent"][data-chip-value="e-fu"]').click();
  await expect(page.locator('[data-chip="s0-ent"][data-chip-value="e-fu"]')).toHaveAttribute('aria-pressed', 'true');
});
