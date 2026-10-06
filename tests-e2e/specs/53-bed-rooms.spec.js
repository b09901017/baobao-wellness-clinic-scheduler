// 診間：點滴8A／8B、VIP7A／7B 是四間各自的診間；點滴8、VIP7 留著當「沒選床位」（2026-10-06，issue 05，ADR-0127）。
//
// 她的原話：
//
// > 點滴室8床A* 點滴室8床B* 休息室7床A*休息室7床B 幫我算不同的診間可以記.8A .8B vip7A vip7B
// > 其實可以刪，並且可舊來訪以及abovee辨識可以不選床位，沒選床位就寫.8，VIP7等等不要留空
//
// 規則（認診間、搬床位、哪幾間排得到）在 domain，`tests/bed-rooms.test.js` 盯著。這一支從瀏覽器走：
// 既有資料庫按資料健檢那兩列真的寫了什麼、停用的那一間在來訪編輯器裡不會被清掉、壓表選得到 8A 與 8B。
//
// **`masterDocs()` 把每一筆種子都寫成啟用的**（fixture 的寫法）—— 所以這裡的主檔上點滴8、VIP7 是開著的，
// 就是既有資料庫還沒按資料健檢的樣子；要「停用了」的那一種，各測試自己蓋上去。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement, visit, slot, addDays, TODAY } from '../fixtures/data.js';

const MONTH = TODAY.slice(0, 7);
const PICK_DAY = addDays(TODAY, 1).startsWith(MONTH) ? addDays(TODAY, 1) : TODAY;
const PAST = addDays(TODAY, -7);

const NEW_ROOMS = ['room-t6', 'room-vip1', 'room-iv8a', 'room-iv8b', 'room-vip7a', 'room-vip7b'];
/** 2026-10-06 之前的診間主檔：沒有那六間，點滴8 與 VIP7 還開著。 */
const oldRooms = () => masterDocs().filter((d) => !NEW_ROOMS.includes(d.id));
/** 按完資料健檢之後：六間都在，點滴8 與 VIP7 停用。 */
const retired = () => masterDocs().map((d) => (['room-iv8', 'room-vip7'].includes(d.id)
  ? { ...d, data: { ...d.data, active: false } } : d));

const dripCustomer = () => [
  customer({ id: 'cust-b', name: '王小明' }),
  entitlement('cust-b', {
    id: 'ent-drip', label: '營養點滴・護肝排毒', type: 'single', courseId: 'course-iv-drip',
    ivProductId: 'iv-liver', totalQty: 10, doneCount: 1, bookedCount: 1, durationMin: 120,
  }),
];

const dripSlot = (over = {}) => ({
  ...slot({
    courseId: 'course-iv-drip', entitlementId: 'ent-drip', startsAt: '10:00', endsAt: '12:00',
    roomId: 'room-iv8', ivProductId: 'iv-liver',
  }),
  ...over,
});

test('R1 10/6 之前的診間：床位那一筆要先等診間建好；建六間＋停用兩間之後，床 A 搬到 點滴8A，其餘一個字都沒變', async ({ app, page }) => {
  const done = dripSlot({ bed: 'A', status: 'done', attended: true, note: '左手' });
  await app.seed([
    ...oldRooms(), ...dripCustomer(),
    visit({ id: 'v-old', customerId: 'cust-b', customerName: '王小明', date: PAST, status: 'done', slots: [done] }),
  ]);
  await app.signIn('/settings/health');

  const card = (id) => page.locator(`#view [data-check="${id}"]`);

  // 8A 還沒建：那一列沒有按鈕（落到「清掉床位」的話 A 就永遠沒了）
  await expect(card('slotBeds')).toContainText('點滴8A');
  await expect(card('slotBeds')).toContainText('診間清單');
  await expect(card('slotBeds').locator('[data-fix]')).toHaveCount(0);

  // 診間清單：六間建起來、點滴8 與 VIP7 停用（不刪），一次按完
  await expect(card('roomList').locator('[data-fix]')).toHaveCount(8);
  await card('roomList').locator('[data-fix-all]').click();
  await expect(app.dialog()).toBeVisible();
  await app.ok();
  await app.saved();
  await expect(card('roomList')).toContainText('沒問題');

  const iv8 = await app.readDoc('config/app/rooms', 'room-iv8');
  expect([iv8.active, iv8.shortName, iv8.capacity, iv8.deletedAt ?? null], '停用：只動那一格，簡寫與同時幾位都還在')
    .toEqual([false, '.8', 2, null]);
  expect((await app.readDoc('config/app/rooms', 'room-vip7')).active).toBe(false);
  const iv8a = await app.readDoc('config/app/rooms', 'room-iv8a');
  expect([iv8a.name, iv8a.shortName, iv8a.active]).toEqual(['點滴8A', '.8A', true]);

  // 床位那一列現在按得下去了：搬到那一間
  const fix = card('slotBeds').locator('[data-fix]');
  await expect(fix).toHaveCount(1);
  await expect(fix).toContainText('搬到那一間');
  await fix.click();
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText()).toContain('點滴8 床 A 搬到 點滴8A');
  await app.ok();
  await app.saved();
  await expect(card('slotBeds')).toContainText('沒問題');

  const v = await app.readDoc('visits', 'v-old');
  expect(v.slots[0], '除了診間與床位，那一段一個字都沒變').toEqual({ ...done, roomId: 'room-iv8a', bed: null });
  expect(v.status).toBe('done');
  const ent = await app.readDoc('customers/cust-b/entitlements', 'ent-drip');
  expect([ent.doneCount, ent.bookedCount], '次數沒有被動到').toEqual([1, 1]);

  // 設定 → 診間：點滴8 還在清單上、標著已停用
  await app.go('/settings/rooms');
  await expect(page.locator('.card.row').filter({ hasText: '點滴8' }).filter({ hasText: '已停用' })).toHaveCount(1);
});

test('R2 壓表：診間那一排有 8A 與 8B、沒有停用的點滴8；同一個時間一位 8A、一位 8B 不跳撞期', async ({ app, page }) => {
  await app.seed([
    ...retired(), ...dripCustomer(),
    customer({ id: 'cust-c', name: '林小華' }),
    visit({
      id: 'v-other', customerId: 'cust-c', customerName: '林小華', date: PICK_DAY, status: 'confirmed',
      slots: [{ ...dripSlot({ entitlementId: null, roomId: 'room-iv8b', startsAt: '09:00', endsAt: '11:00' }), status: 'confirmed' }],
    }),
  ]);
  await app.signIn('/');
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await page.locator('[data-pick="cust-b"]').first().click();
  await app.layer('[data-day]');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-ent]');
  await page.locator('[data-ent="ent-drip"]').click();
  await app.layer('[data-room]');

  await expect(page.locator('[data-room^="room-iv8a"]')).toBeVisible();
  await expect(page.locator('[data-room^="room-iv8b"]')).toBeVisible();
  await expect(page.locator('[data-room="room-iv8|"]'), '停用的那一間新排的選不到').toHaveCount(0);

  // 09:00 那一格另一位排在 8B；這一位排 8A —— 各是一間，不撞
  await page.locator('[data-time]').first().click();
  await page.locator('[data-room^="room-iv8a"]').click();
  await page.locator('[data-add]').click();
  await expect(app.dialog()).toBeVisible();
  const said = await app.dialogText();
  expect(said, '直接到第二道（沒有撞期那一句）').toContain('壓好表了嗎');
  expect(said).not.toContain('已經排了');
  await app.ok();
  await app.saved();

  const [v] = (await app.readAll('visits')).filter((x) => x.customerId === 'cust-b');
  expect([v.slots[0].roomId, v.slots[0].bed ?? null]).toEqual(['room-iv8a', null]);
});

test('R3 來訪編輯器：還排在點滴8（停用了）的那一段，打開存一次診間還是點滴8；月曆那一格照樣印 .8', async ({ app, page }) => {
  await app.seed([
    ...retired(), ...dripCustomer(),
    visit({
      id: 'v-next', customerId: 'cust-b', customerName: '王小明', date: PICK_DAY, status: 'pending_confirm',
      slots: [{ ...dripSlot(), status: 'pending_confirm' }],
    }),
  ]);
  await app.signIn('/visits/v-next');
  await app.layer('[data-chip="s0-room"]');

  // 那一排上有它、按著、標得出是停用的；8A 也選得到
  const mine = page.locator('[data-chip="s0-room"][data-chip-value="room-iv8|"]');
  await expect(mine).toHaveAttribute('aria-pressed', 'true');
  await expect(mine).toContainText('已停用');
  await expect(page.locator('[data-chip="s0-room"][data-chip-value="room-iv8a|"]')).toHaveCount(1);

  // 只改記一句
  await page.locator('[data-slotnote-toggle="s0-note"]').click();
  await page.locator('textarea[name="s0-note"]').fill('客人說會晚到');
  await page.locator('button[type="submit"]').first().click();
  await app.saved();

  const saved = await app.readDoc('visits', 'v-next');
  expect(saved.slots[0].roomId, '停用的那一間不可以被清成空的').toBe('room-iv8');
  expect(saved.slots[0].note).toBe('客人說會晚到');

  // 日曆那一天：那一段印得出 .8（沒選床位的那一間）
  await app.go('/calendar');
  await page.locator(`[data-day="${PICK_DAY}"]`).first().click();
  await app.layer('[data-open^="visit:v-next:"]');
  await expect(page.locator('[data-open^="visit:v-next:"]').first()).toContainText('.8');
});
