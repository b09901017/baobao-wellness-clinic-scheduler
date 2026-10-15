// 拍 Abovee：照片上的預約狀態為準（.scratch/abovee-status-follows-photo-2026-10-15，07 的 E2E）。
//
// 她 10/15：「如果是本來app上還沒取消的客拍照拍到已取消了，那也幫我把這堂課的狀態改成已取消」
// 「如果是修改的，可以區分開來…誰的什麼時候的甚麼改了，打勾就只是改狀態那些等等，不要多記或少記次數! 次數不能弄錯這很重要 ! !」
//
// 假抄字 `fixtures/ai/aboveeList-status.json`：六種狀態 × 8/29（E2E 的今天）以前／當天／以後。
// 規則的每一格在單元測試（`tests/abovee-*.test.js`）；這一支走一次整條路：拍 →「要改的」那一塊 → 拿掉一個勾 → 記錄 →
// 寫進去的狀態、「取消 Abovee」一出生就勾好、額度剩幾次。例子一律假名。

import { test, expect } from '../fixtures/app.js';
import { customer, entitlement, masterDocs, slot, visit } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';
import { counts } from '../../public/js/domain/entitlements.js';

const MONTH = '2026-09';
const POOL3 = { type: 'pool', label: '復能-三選一(60)', optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60, totalQty: 12 };

function seed() {
  const sis = (over) => ({
    ...slot({ courseId: 'course-recovery', entitlementId: over.entitlementId, equipmentId: 'eq-sis', startsAt: over.startsAt, endsAt: over.endsAt,
      therapistId: over.therapistId ?? null }),
    status: over.status,
  });
  const base = { confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null };
  const wang = (id, date, status, startsAt, endsAt) => visit({
    id, customerId: 'cust-wang', customerName: '王小明', date, status, ...base,
    slots: [sis({ entitlementId: 'w-pool', startsAt, endsAt, status, therapistId: 'staff-zn' })],
  });
  const a = (id, date) => visit({
    id, customerId: 'cust-a', customerName: '客戶A', date, status: 'confirmed', ...base,
    slots: [sis({ entitlementId: 'a-pool', startsAt: '10:00', endsAt: '11:00', status: 'confirmed' })],
  });
  return [
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-wang', { id: 'w-pool', ...POOL3, bookedCount: 3 }),
    entitlement('cust-a', { id: 'a-pool', ...POOL3, bookedCount: 2 }),
    // 照片寫課程完成（過去）→ 改成已完成；照片已取消 → 改成已取消；照片 15:00 → 改期
    wang('v-w25', '2026-08-25', 'pending_confirm', '10:00', '11:00'),
    wang('v-w29', '2026-08-29', 'confirmed', '14:00', '15:00'),
    wang('v-w02', '2026-09-02', 'confirmed', '10:00', '11:00'),
    // 治療師空著（合併檔匯進來的那種），照片上有 → 補上
    a('v-a03', '2026-09-03'),
    a('v-a04', '2026-09-04'),
    {
      path: 'batches', id: 'b-sep',
      data: {
        targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
        queue: ['cust-wang', 'cust-a'].map((id) => ({ customerId: id, customerName: '', state: 'pending', skippedReason: null })),
      },
    },
  ];
}

/** 壓表頁 → 右下角相機 → 相簿選一張 → 送出 → 確認層（同 51）。 */
async function photograph(app, page, name) {
  await app.go('/schedule');
  await page.locator(`[data-month="${MONTH}"]`).click();
  await app.settled();
  await queueAi([name]);
  await page.locator('[data-abovee]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles([await fakePhoto(`${name}.jpg`, { width: 1600, height: 900 })]);
  await expect(page.locator('.cam__thumb')).toHaveCount(1);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0, { timeout: 60_000 });
  await expect(page.locator('[data-abl-row]').first()).toBeVisible();
}

const row = (page, key) => page.locator(`[data-abl-row="${key}"]`);
const remainingOf = (ent, visits) => counts(ent, visits, ent.id).remaining;

test('S1 六種狀態：新的照狀態記、既有的「要改的」那一塊預設勾、拿掉一個就不改；次數照實', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  const ents = [
    await app.readDoc('customers/cust-wang/entitlements', 'w-pool'),
    await app.readDoc('customers/cust-a/entitlements', 'a-pool'),
  ].map((e, i) => ({ ...e, id: ['w-pool', 'a-pool'][i] }));
  const before = await app.readAll('visits');
  await photograph(app, page, 'aboveeList-status');

  // 抬頭：新的 5 段（已取消的那一列不算）、要改 5 段（3 行＋補上 2 段）、要你看 1 段（未來的完成）、
  // 過了還沒結案 1 段（過去的待確認 —— 收起來，中途發現 5）
  await expect(page.locator('.abl__sum')).toContainText('新的 5 段');
  await expect(page.locator('.abl__sum')).toContainText('要改 5 段');
  await expect(page.locator('.abl__sum')).toContainText('要你看 1 段');
  await expect(page.locator('.abl__sum')).toContainText('過了還沒結案 1 段');
  await expect(page.locator('.abl__group--look [data-abl-row="a8"]')).toHaveCount(1);
  await expect(page.locator('.abl__later')).not.toHaveAttribute('open', '');
  await expect(page.locator('.abl__later [data-abl-row="a1"]')).toBeHidden();
  await page.locator('.abl__later > summary').click();
  await expect(page.locator('.abl__later [data-abl-row="a1"]')).toBeVisible();

  // 「要改的」那一塊：一行一件事、預設勾、括號是次數
  const block = page.locator('.abl__group--change');
  await expect(block.locator('.abl-chg')).toHaveCount(4);
  await expect(block.locator('[role="checkbox"][aria-checked="true"]')).toHaveCount(4);
  await expect(block).toContainText('王小明 8/25(二) 10:00 SIS(60)：待確認 → 已完成（次數不變）');
  await expect(block).toContainText('王小明 8/29(六) 14:00 SIS(60)：14:00 → 15:00（次數不變）');
  await expect(block).toContainText('王小明 9/2(三) 10:00 SIS(60)：已確認 → 已取消（還 1 次）');
  await expect(block).toContainText('另外 2 段補上治療師');
  // 點開看得到是哪幾段
  await block.locator('summary').click();
  await expect(block).toContainText('客戶A 9/3(四) 10:00 SIS(60)：治療師 芝寧');
  // 同一列不會兩邊都出現
  for (const key of ['a2', 'a4', 'a5', 'a6', 'a7']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(page.locator(`.abl__group--look [data-abl-row="${key}"]`)).toHaveCount(0);
  }

  // 新的列：過去的失約、今天的聯繫中、未來的確認前往先勾；過去的待確認、未來的完成、已取消不勾（講為什麼）
  const checked = (key) => row(page, key).locator('[data-abl-check]');
  for (const key of ['a0', 'a3', 'a9']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(checked(key)).toHaveAttribute('aria-checked', 'true');
  }
  for (const key of ['a1', 'a8', 'a10']) {
    // eslint-disable-next-line no-await-in-loop
    await expect(checked(key)).toHaveAttribute('aria-checked', 'false');
  }
  await expect(row(page, 'a1')).toContainText('日子過了還沒結案');
  await expect(row(page, 'a8')).toContainText('還沒到就寫完成了');

  // 記錄那一顆：記新的與改既有的分開數；拿掉改期那一個勾少 1
  await expect(page.locator('[data-abl-save]')).toHaveText('記錄 3 段、改 5 段');
  await page.locator('[data-abl-change="adoptMove"][data-abl-for="a4"]').click();
  await expect(page.locator('[data-abl-change="adoptMove"][data-abl-for="a4"]')).toHaveAttribute('aria-checked', 'false');
  await expect(block).toContainText('14:00 → 15:00（不改）');
  await expect(page.locator('[data-abl-save]')).toHaveText('記錄 3 段、改 4 段');
  // 那一列點開：講的是照片要它改成什麼，但這一次不改
  await row(page, 'a4').locator('[data-abl-open]').click();
  await expect(row(page, 'a4')).toContainText('「要改的」那一塊沒勾 —— 這一次不改');
  await row(page, 'a4').locator('[data-abl-open]').click();
  // 拿掉「補上」那一行少 2，再勾回來
  await page.locator('[data-abl-fill]').click();
  await expect(page.locator('[data-abl-save]')).toHaveText('記錄 3 段、改 2 段');
  await page.locator('[data-abl-fill]').click();
  await expect(page.locator('[data-abl-save]')).toHaveText('記錄 3 段、改 4 段');

  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('記錄這 3 段、改 4 段？');
  await expect(app.dialog()).toContainText('照 Abovee 改成「已取消」1 段（還 1 次）');
  await expect(app.dialog()).toContainText('「取消 Abovee」直接勾好');
  await expect(app.dialog()).toContainText('補上 2 段的治療師（app 上原本空著）');
  await expect(app.dialog()).toContainText('照 Abovee 改成「已完成」1 段（次數不變）');
  // 照片上寫聯繫中的那一段不被說成確認前往（中途發現 15）
  await expect(app.dialog()).toContainText('「聯繫中」');
  // 確認框上的次數加總＝存完之後的差
  const lines = await app.dialog().innerText();
  const said = [...lines.matchAll(/（(扣|還) (\d+) 次）/g)].reduce((sum, m) => sum + (m[1] === '扣' ? 1 : -1) * Number(m[2]), 0);
  await app.ok();
  await app.saved();
  await expect(page.locator('.abl')).toHaveCount(0);

  const byId = async (id) => app.readDoc('visits', id);
  expect((await byId('v-w25')).slots.map((s) => s.status), '過去的待確認 → 照片完成').toEqual(['done']);
  expect((await byId('v-w02')).slots.map((s) => [s.status, s.cancelReason]), '已確認 → 照片已取消，理由記在那一段').toEqual([['cancelled', '客人有事']]);
  expect((await byId('v-w29')).slots.map((s) => [s.startsAt, s.status]), '拿掉勾的改期一格都不動').toEqual([['14:00', 'confirmed']]);
  expect((await byId('v-a03')).slots[0].therapistId).toBe('staff-zn');
  expect((await byId('v-a04')).slots[0].therapistId).toBe('staff-zn');

  const after = await app.readAll('visits');
  const fresh = after.filter((v) => !before.some((b) => b.id === v.id));
  expect(fresh.map((v) => [v.customerId, v.date, v.slots.map((s) => s.status).join()]).sort(), '只記勾著的三段，照照片的狀態').toEqual([
    ['cust-a', '2026-08-29', 'pending_confirm'],
    ['cust-wang', '2026-08-20', 'no_show'],
    ['cust-wang', '2026-09-06', 'pending_confirm'],
  ]);

  // 「取消 Abovee」一出生就勾好（照片上已經放掉了）
  const cancels = (await app.readAll('tasks')).filter((t) => t.visitId === 'v-w02' && t.kind === '取消 Abovee');
  expect(cancels.map((t) => t.done)).toEqual([true]);

  // 次數：確認框講的加總＝前後的差；額度上的快取跟現算的一樣
  const used = (list) => ents.reduce((sum, e) => sum - remainingOf(e, list), 0);
  expect(said).toBe(used(after) - used(before));
  for (const e of ents) {
    const path = e.id === 'w-pool' ? 'customers/cust-wang/entitlements' : 'customers/cust-a/entitlements';
    // eslint-disable-next-line no-await-in-loop
    const doc = await app.readDoc(path, e.id);
    const real = counts(e, after, e.id);
    expect([doc.doneCount, doc.bookedCount], e.id).toEqual([real.done, real.booked]);
  }

  // 客戶詳情：剩幾次跟現算的一樣
  await app.go('/customers/cust-wang');
  await expect(page.locator('#view')).toContainText(`剩餘 ${remainingOf(ents[0], after)}`);
});

test('S2 手機寬度：「要改的」那一塊不橫捲、底下的記錄點得到；沒有要改的時一個像素都不佔', async ({ app, page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await app.seed(seed());
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-status');

  const block = page.locator('.abl__group--change');
  await expect(block).toBeVisible();
  const overflow = await page.locator('.abl__body').evaluate((el) => el.scrollWidth - el.clientWidth);
  expect(overflow, '不橫捲').toBeLessThanOrEqual(0);
  const save = page.locator('[data-abl-save]');
  await expect(save).toBeInViewport();
  // 底部那一顆沒有被別的東西蓋住
  const box = await save.boundingBox();
  const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('[data-abl-save]') !== null,
    [box.x + box.width / 2, box.y + box.height / 2]);
  expect(hit).toBe(true);

  // 每一行的勾都拿掉：那一塊還在（勾得回來），只是全部寫「不改」
  for (const el of await block.locator('[data-abl-change]').all()) {
    // eslint-disable-next-line no-await-in-loop
    await el.click();
  }
  await expect(block.locator('[data-abl-change][aria-checked="true"]')).toHaveCount(0);
});

test('S3 照片上一段要改的都沒有 →「要改的」那一塊不畫', async ({ app, page }) => {
  await app.seed(seed().filter((d) => !['v-w25', 'v-w29', 'v-w02', 'v-a03', 'v-a04'].includes(d.id)));
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-status');
  await expect(page.locator('[data-abl-changes]')).toBeEmpty();
  await expect(page.locator('.abl__sum')).not.toContainText('要改');
});

test('S4 照片上的人認不出來、她自己選了那一位：要改的那一行不預設勾，勾了才改、還 1 次（10/16 審查）', async ({ app, page }) => {
  await app.seed(seed());
  await app.signIn('/');
  const before = { ...(await app.readDoc('customers/cust-wang/entitlements', 'w-pool')), id: 'w-pool' };
  const stored = await app.readAll('visits');
  await photograph(app, page, 'aboveeList-picked');

  await expect(row(page, 'a0').locator('.abl-row__tag')).toHaveText('已取消');
  await row(page, 'a0').locator('[data-abl-open]').click();
  await row(page, 'a0').locator('[data-abl-query]').fill('王小');
  await row(page, 'a0').locator('[data-abl-who="cust-wang"]').click();

  // 9/2 10:00 那一段在 app 上是已確認：照片要它改成已取消 ——「要改的」那一行在，但沒勾、講為什麼；那一顆按不下去
  const change = page.locator('[data-abl-change="adoptStatus"][data-abl-for="a0"]');
  await expect(change).toHaveAttribute('aria-checked', 'false');
  await expect(page.locator('.abl__group--change')).toContainText('人是你選的，確定再勾');
  await expect(page.locator('[data-abl-save]')).toBeDisabled();

  await change.click();
  await expect(change).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.abl__group--change')).toContainText('已確認 → 已取消（還 1 次）');
  await expect(page.locator('[data-abl-save]')).toHaveText('改這 1 段');
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('照 Abovee 改成「已取消」1 段（還 1 次）');
  await app.ok();
  await app.saved();

  const v = await app.readDoc('visits', 'v-w02');
  expect(v.slots[0].status).toBe('cancelled');
  const visits = await app.readAll('visits');
  expect(remainingOf(before, visits) - remainingOf(before, stored), '還 1 次').toBe(1);
  const cache = await app.readDoc('customers/cust-wang/entitlements', 'w-pool');
  const real = counts(before, visits, 'w-pool');
  expect([cache.doneCount, cache.bookedCount]).toEqual([real.done, real.booked]);
});

test('S5 健檢與接著它的二返，照片都寫課程完成：存完沒有一張用不到的「追蹤健檢報告」，確認框也不講（10/16 審查）', async ({ app, page }) => {
  const base = { confirmedAt: null, cancelledAt: null, statusAt: null, cancelReason: null, released: null };
  await app.seed([
    ...masterDocs(),
    customer({ id: 'cust-wang', name: '王小明', marks: [{ text: '病歷號 1234', color: 'grey' }] }),
    entitlement('cust-wang', { id: 'w-exam', label: '健檢', courseId: 'course-checkup', totalQty: 1, bookedCount: 1 }),
    entitlement('cust-wang', { id: 'w-fu', label: '二返', courseId: 'course-followup', totalQty: 1, bookedCount: 1, followupForEntitlementId: 'w-exam' }),
    visit({ id: 'v-ex', customerId: 'cust-wang', customerName: '王小明', date: '2026-08-20', status: 'confirmed', ...base,
      slots: [{ ...slot({ courseId: 'course-checkup', entitlementId: 'w-exam', startsAt: '09:00', endsAt: '11:00' }), status: 'confirmed' }] }),
    visit({ id: 'v-fu', customerId: 'cust-wang', customerName: '王小明', date: '2026-08-25', status: 'confirmed', ...base,
      slots: [{ ...slot({ courseId: 'course-followup', entitlementId: 'w-fu', startsAt: '14:00', endsAt: '14:30' }), status: 'confirmed', followupForVisitId: 'v-ex' }] }),
    {
      path: 'batches', id: 'b-sep',
      data: { targetMonth: MONTH, status: 'active', cursor: null, lastDeviceHint: null,
        queue: [{ customerId: 'cust-wang', customerName: '', state: 'pending', skippedReason: null }] },
    },
  ]);
  await app.signIn('/');
  await photograph(app, page, 'aboveeList-exam-done-pair');

  for (const key of ['a0', 'a1']) {
    await expect(page.locator(`[data-abl-change="adoptStatus"][data-abl-for="${key}"]`)).toHaveAttribute('aria-checked', 'true');
  }
  await expect(page.locator('[data-abl-save]')).toHaveText('改這 2 段');
  await page.locator('[data-abl-save]').click();
  await expect(app.dialog()).toContainText('照 Abovee 改成「已完成」2 段（次數不變）');
  await expect(app.dialog()).not.toContainText('追蹤健檢報告');
  await app.ok();
  await app.saved();

  expect((await app.readDoc('visits', 'v-ex')).slots[0].status).toBe('done');
  expect((await app.readDoc('visits', 'v-fu')).slots[0].status).toBe('done');
  // 健檢那一筆先存的那一下二返還沒做完，會長一張；這一位全部存完之後收掉（`dropChainLeftovers()`）
  const report = (await app.readAll('tasks')).filter((t) => t.kind === '追蹤健檢報告' && !t.done && !t.deletedAt);
  expect(report).toEqual([]);
});
