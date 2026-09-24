// 拍 Abovee → 一次新增很多來訪（issue 13，ADR-0104）。
//
// 她 2026-09-17：「在壓表那頁，右下角多一個相機的懸浮泡泡…一口氣新增很多來訪」
// 「讓我一次上傳兩張圖片，也接受上傳一張」「不需要放一個「這幾位標成壓完」的開關，直接標成壓完」。
//
// 模擬器裡的 Function 不叫 Gemini，回 `fixtures/ai/aboveeList-*.json`（王小明、李小華、客戶A、陳大文）。
// 翻譯的細節在 `tests/abovee-import.test.js`；這一支盯整條路與寫進去的東西。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';
import { PROJECT_ID, allowUser } from '../fixtures/emulator.js';

const MONTH = '2026-09';
const chart = (no) => [{ text: `病歷號 ${no}`, color: 'grey' }];
const POOL3 = { type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 };
const EXISTING = ['v-a12', 'v-ch12', 'v-ch15'];

function seed() {
  const slot = (over) => ({
    startsAt: '09:00', endsAt: '10:00', status: 'confirmed', roomId: null, bed: null, therapistId: null,
    doctorId: null, equipmentId: null, ivProductId: null, attended: null, followupForVisitId: null, note: null, ...over,
  });
  const visit = (id, over) => ({
    path: 'visits', id,
    data: { confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null, note: null, ...over },
  });
  return [
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明', marks: chart('1234') }),
    customer({ id: 'cust-lee', name: '李小華', marks: chart('5678') }),
    customer({ id: 'cust-a', name: '客戶A' }),
    customer({ id: 'cust-chen', name: '陳大文', marks: chart('9999') }),
    entitlement('cust-wang', { id: 'w-pool', ...POOL3 }),
    entitlement('cust-wang', { id: 'w-ilib', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 20 }),
    entitlement('cust-lee', { id: 'l-eecp', label: 'EECP', courseId: 'course-eecp', totalQty: 40 }),
    entitlement('cust-a', { id: 'a-pool', ...POOL3, doneCount: 1 }),
    entitlement('cust-chen', { id: 'ch-ilib', label: 'ILIB(60)', courseId: 'course-iv-laser', durationMin: 60, totalQty: 20, bookedCount: 2 }),
    visit('v-a12', {
      customerId: 'cust-a', customerName: '客戶A', date: '2026-09-12', status: 'done',
      slots: [slot({ entitlementId: 'a-pool', courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis', status: 'done' })],
    }),
    visit('v-ch12', {
      customerId: 'cust-chen', customerName: '陳大文', date: '2026-09-12', status: 'confirmed',
      slots: [slot({ entitlementId: 'ch-ilib', courseId: 'course-iv-laser', courseName: 'ILIB', startsAt: '11:00', endsAt: '12:00', roomId: 'room-iv2' })],
    }),
    visit('v-ch15', {
      customerId: 'cust-chen', customerName: '陳大文', date: '2026-09-15', status: 'pending_confirm',
      slots: [slot({ entitlementId: 'ch-ilib', courseId: 'course-iv-laser', courseName: 'ILIB', status: 'pending_confirm', roomId: 'room-iv2' })],
    }),
    {
      path: 'batches', id: 'b-sep',
      data: {
        targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
        queue: ['cust-wang', 'cust-lee', 'cust-a'].map((id) => ({ customerId: id, customerName: '', state: 'pending', skippedReason: null }))
          .concat([{ customerId: 'cust-chen', customerName: '陳大文', state: 'done', skippedReason: null }]),
      },
    },
  ];
}

async function openBatch(app, page) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await expect(page.locator('[data-abovee]')).toBeVisible();
}

/** 壓表頁 → 右下角相機 → 相簿選一兩張 → 送出 → 確認層。 */
async function photograph(page, fixtures) {
  await queueAi(fixtures);
  const files = [];
  for (const [i, name] of fixtures.entries()) {
    // eslint-disable-next-line no-await-in-loop
    files.push(await fakePhoto(`${name}-${i}.jpg`, { width: 1600, height: 900 }));
  }
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles(files);
  await expect(page.locator('.cam__thumb')).toHaveCount(fixtures.length);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('.abl')).toBeVisible();
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const row = (page, key) => page.locator(`[data-abl-row="${key}"]`);

const DOCS = `http://127.0.0.1:8080/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const OWNER = { Authorization: 'Bearer owner' };

/** 把白名單整份拿掉（讓接下來的寫入被 Rules 擋），回傳原本的 uid 好放回去（同 40）。 */
async function revokeEveryone() {
  const list = await (await fetch(`${DOCS}/allowedUsers`, { headers: OWNER })).json();
  const ids = (list.documents ?? []).map((d) => d.name.split('/').pop());
  for (const id of ids) {
    // eslint-disable-next-line no-await-in-loop
    const res = await fetch(`${DOCS}/allowedUsers/${id}`, { method: 'DELETE', headers: OWNER });
    if (!res.ok) throw new Error(`拿不掉白名單 ${res.status}`);
  }
  return ids;
}

test('A1 左右兩張：新的 5 段勾好、已經記了 3 段、已取消 2 列沒勾；記下去都是待確認、沒長任務、標成壓完、記住治療師的寫法', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-left', 'aboveeList-right']);

  await expect(page.locator('.abl__sum')).toHaveText('新的 5 段・已經記了 3 段');
  await expect(page.locator('.abl__pairing')).toContainText('照列的順序');
  for (const key of ['a0', 'a1', 'a3', 'a8', 'a9']) {
    await expect(row(page, key).locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');
  }
  for (const key of ['a2', 'a7']) {
    await expect(row(page, key).locator('.abl-row__tag')).toHaveText('已取消');
    await expect(row(page, key).locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');
  }
  for (const key of ['a4', 'a5', 'a6']) {
    await expect(row(page, key).locator('.abl-row__tag')).toHaveText('已經記了');
    await expect(row(page, key).locator('[data-abl-check]')).toBeDisabled();
  }
  // Abovee 上的「確認前往」只照原字印
  await expect(row(page, 'a0').locator('.abl-row__tag')).toHaveText('新的');

  // 王小明 SIS 那一列：服務資源的全名認不出來 → 點開、看得到原字、選芝寧 → 會記住
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0').locator('.seen', { hasText: '陳美玲' })).toBeVisible();
  await row(page, 'a0').locator('[data-abl-therapist="staff-zn"]').click();
  await expect(row(page, 'a0').locator('.abl-row__learn')).toContainText('「陳美玲」都認成 芝寧');

  await expect(page.locator('[data-abl-save]')).toHaveText('記錄這 5 段');
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('3 位・4 天・5 段');
  await expect(app.dialog()).toContainText('以後 Abovee 上的「陳美玲」都認成 芝寧');
  await expect(app.dialog()).toContainText('9月壓表清單上標成壓完');
  await app.ok();
  await app.saved();
  await expect(page.locator('.abl')).toHaveCount(0);
  await expect(page.locator('[data-wall]')).toBeVisible();

  const visits = (await app.readAll('visits')).filter((v) => !EXISTING.includes(v.id));
  expect(visits.map((v) => `${v.customerId} ${v.date}`).sort()).toEqual([
    'cust-a 2026-09-17', 'cust-lee 2026-09-11', 'cust-lee 2026-09-18', 'cust-wang 2026-09-10',
  ]);
  for (const v of visits) {
    expect(v.status).toBe('pending_confirm');
    for (const s of v.slots) expect(s.status, 'Abovee 上的「確認前往」不是 app 的已確認').toBe('pending_confirm');
  }
  const wang = visits.find((v) => v.customerId === 'cust-wang');
  expect(wang.slots.map((s) => [s.startsAt, s.courseId, s.equipmentId, s.therapistId, s.roomId])).toEqual([
    ['09:00', 'course-recovery', 'eq-sis', 'staff-zn', null],
    ['10:30', 'course-iv-laser', null, null, 'room-iv10'],
  ]);
  expect(visits.find((v) => v.date === '2026-09-11').slots[0].roomId).toBe('room-t8');
  expect(await app.readAll('tasks'), '客人確認之前不長任務（ADR-0027）').toHaveLength(0);

  const batch = await app.readDoc('batches', 'b-sep');
  expect(batch.queue.map((q) => [q.customerId, q.state])).toEqual([
    ['cust-wang', 'done'], ['cust-lee', 'done'], ['cust-a', 'done'], ['cust-chen', 'done'],
  ]);
  expect((await app.readDoc('config/app/staff', 'staff-zn')).aboveeNames).toEqual(['陳美玲']);
});

test('A2 右半邊只有 9 列 → 不配對、最上面講出來、診間空著；還有沒記的就離開 → 先問，停在壓表頁', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-left', 'aboveeList-right9']);

  await expect(page.locator('.abl__pairing--warn')).toContainText('左 10 列、右 9 列');
  await row(page, 'a1').locator('[data-abl-open]').click();
  await expect(row(page, 'a1').locator('[data-abl-room]').first()).toBeVisible();
  await expect(row(page, 'a1').locator('[data-abl-room][aria-pressed="true"]')).toHaveCount(0);

  await page.locator('[data-abl-close]').click();
  await expect(app.dialog()).toContainText('還有 5 段沒記');
  await page.locator('.dialog-backdrop [data-choice="leave"]').click();
  await expect(page.locator('.abl')).toHaveCount(0);
  await expect(page.locator('[data-wall]')).toBeVisible();
  expect((await app.readAll('visits')).length).toBe(3);
});

test('A3 對不上的那一列勾不了、連得到日曆；認不得的人選了才勾得了；寫入失敗講得出是誰，再按一次只記一次', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '刻意拿掉白名單讓寫入失敗' });
  await app.seed(seed());
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-check']);

  await expect(page.locator('.abl__sum')).toHaveText('要你看 2 段');
  await expect(row(page, 'a0').locator('.abl-row__tag')).toHaveText('對不上');
  await expect(row(page, 'a0').locator('[data-abl-check]')).toBeDisabled();
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0').locator('[data-abl-day="2026-09-12"]')).toBeVisible();

  await expect(row(page, 'a1').locator('.abl-row__tag')).toHaveText('認不得');
  await expect(row(page, 'a1').locator('[data-abl-check]')).toBeDisabled();
  await row(page, 'a1').locator('[data-abl-open]').click();
  await expect(row(page, 'a1')).toContainText('病歷號對上了，名字不一樣');
  await row(page, 'a1').locator('[data-abl-who="cust-wang"]').click();
  await expect(row(page, 'a1').locator('.abl-row__tag')).toHaveText('新的');
  const check = row(page, 'a1').locator('[data-abl-check]');
  await expect(check).toHaveAttribute('aria-checked', 'false');
  await check.click();
  await expect(check).toHaveAttribute('aria-checked', 'true');

  const allowed = await revokeEveryone();
  await page.locator('[data-abl-save]').click();
  await app.ok();
  await expect(page.locator('.abl__why')).toContainText('王小明 那一天沒記', { timeout: 20_000 });
  expect((await app.readAll('visits')).length).toBe(3);

  for (const uid of allowed) await allowUser(uid); // eslint-disable-line no-await-in-loop
  await page.locator('[data-abl-save]').click();
  await app.ok();
  await app.saved();
  await expect(page.locator('.abl')).toHaveCount(0);
  const added = (await app.readAll('visits')).filter((v) => !EXISTING.includes(v.id));
  expect(added.map((v) => `${v.customerId} ${v.date} ${v.slots.length}`)).toEqual(['cust-wang 2026-09-22 1']);
});

// 存到一半停下來、再按一次接著記：**第一次已經標好的壓完不可以被第二次蓋回去**。
// 第二次算壓完用的是打開這一層時讀的那一份清單 —— 沒跟著更新的話，寫回去的整份 queue 裡
// 第一次那幾位又是「還沒壓」。讓第二位穩定寫失敗：額度的 tier 超過 Rules 的長度，修掉再按一次就過
test('A4 存到第二位失敗、修好再按一次 → 兩次標的壓完都在，治療師的寫法也在', async ({ app, page }) => {
  test.info().annotations.push({ type: 'allow-console-errors', description: '刻意讓第二位的寫入被 Rules 擋' });
  const data = seed().map((d) => (d.id === 'l-eecp' ? { ...d, data: { ...d.data, tier: 'x'.repeat(25) } } : d));
  await app.seed(data);
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-left', 'aboveeList-right']);

  await row(page, 'a0').locator('[data-abl-open]').click();
  await row(page, 'a0').locator('[data-abl-therapist="staff-zn"]').click();
  await page.locator('[data-abl-save]').click();
  await app.ok();
  // 照客戶排：客戶A 先記好、李小華那一天被擋
  await expect(page.locator('.abl__why')).toContainText('李小華 那一天沒記', { timeout: 20_000 });
  const first = await app.readDoc('batches', 'b-sep');
  expect(first.queue.find((q) => q.customerId === 'cust-a').state).toBe('done');

  const res = await fetch(`${DOCS}/customers/cust-lee/entitlements/l-eecp?updateMask.fieldPaths=tier`, {
    method: 'PATCH', headers: { ...OWNER, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: { tier: { nullValue: null } } }),
  });
  expect(res.ok).toBe(true);

  await page.locator('[data-abl-save]').click();
  await app.ok();
  await app.saved();
  await expect(page.locator('.abl')).toHaveCount(0);

  const batch = await app.readDoc('batches', 'b-sep');
  expect(batch.queue.map((q) => [q.customerId, q.state])).toEqual([
    ['cust-wang', 'done'], ['cust-lee', 'done'], ['cust-a', 'done'], ['cust-chen', 'done'],
  ]);
  expect((await app.readDoc('config/app/staff', 'staff-zn')).aboveeNames).toEqual(['陳美玲']);
});

// 「去日曆（照片不會留著）」是她自己點的換頁。換網址時瀏覽器也會先發一下 popstate，
// 那一下會被當成返回鍵、叫這一層問「還有 N 段沒記」—— 接著換頁把這一層收掉，那一道確認框卻留在日曆上
test('A5 有勾起來還沒記的，點「對不上」那一列的去日曆 → 停在日曆那一天，沒有留下「還有 N 段沒記」', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-check']);

  await row(page, 'a1').locator('[data-abl-open]').click();
  await row(page, 'a1').locator('[data-abl-who="cust-wang"]').click();
  await row(page, 'a1').locator('[data-abl-check]').click();
  await expect(row(page, 'a1').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'true');

  await row(page, 'a0').locator('[data-abl-open]').click();
  await row(page, 'a0').locator('[data-abl-day="2026-09-12"]').click();
  await expect(page).toHaveURL(/#\/calendar$/);
  await app.settled();
  await expect(page.locator('.abl')).toHaveCount(0);
  await expect(page.locator('.dialog-backdrop')).toHaveCount(0);
});

test('A6 預約狀態對一次（ADR-0116）：app 上取消了的不是新的、Abovee 上取消了的排進要你看', async ({ app, page }) => {
  // 她 2026-09-24 晚：「拍 Abovee上面也有標已取消等等的標記…其實也可以當作某一方面的交叉驗證?」
  const base = { confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null, note: null };
  const sis = (over) => ({
    entitlementId: null, courseId: 'course-recovery', courseName: '復能', equipmentId: 'eq-sis',
    startsAt: '09:00', endsAt: '10:00', roomId: null, bed: null, therapistId: null, doctorId: null,
    ivProductId: null, attended: null, followupForVisitId: null, note: null, ...over,
  });
  await app.seed([
    ...seed(),
    // a0：Abovee 上 9/10 09:00 王小明 SIS 還是「確認前往」，app 上那一段取消了（還沒回 Abovee 放掉）
    { path: 'visits', id: 'v-w10', data: { ...base, customerId: 'cust-wang', customerName: '王小明', date: '2026-09-10',
      status: 'cancelled', slots: [sis({ entitlementId: 'w-pool', status: 'cancelled' })] } },
    // a7：Abovee 上 9/16 09:00 客戶A SIS「已取消」，app 上那一段還是已確認
    { path: 'visits', id: 'v-a16', data: { ...base, customerId: 'cust-a', customerName: '客戶A', date: '2026-09-16',
      status: 'confirmed', slots: [sis({ entitlementId: 'a-pool', status: 'confirmed' })] } },
  ]);
  await app.signIn('/');
  await openBatch(app, page);
  await photograph(page, ['aboveeList-left', 'aboveeList-right']);

  await expect(page.locator('.abl__sum')).toContainText('要你看 2 段');

  await expect(row(page, 'a0').locator('.abl-row__tag')).toHaveText('對不上');
  await expect(row(page, 'a0').locator('[data-abl-check]')).toHaveAttribute('aria-checked', 'false');
  await expect(row(page, 'a0').locator('[data-abl-check]')).toBeDisabled();
  await row(page, 'a0').locator('[data-abl-open]').click();
  await expect(row(page, 'a0').locator('.abl-row__say')).toContainText('app 上取消了');
  await expect(row(page, 'a0').locator('.abl-row__say')).toContainText('回 Abovee 放掉');

  await expect(row(page, 'a7').locator('.abl-row__tag')).toHaveText('對不上');
  await row(page, 'a7').locator('[data-abl-open]').click();
  await expect(row(page, 'a7').locator('.abl-row__say')).toContainText('Abovee 上取消了，app 上還是「已確認」');
});
