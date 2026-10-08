// 2026-10-09 上線前修正，第四段（`.scratch/prelaunch-fixes-2026-10-08/issues/19`–`21`）：人員的全名與簡寫、
// 合併檔 v6 帶人員名單（ADR-0141）。
//
// 單元測試釘得住「印哪一個」「認得誰」；這裡從瀏覽器問接線：設定頁那一格存不存得下去（`parse()` 是白名單）、
// 窄的地方印簡寫、選單印全名。**人員一律寫「某」**（全名不進 repo）。

import { test, expect } from '../fixtures/app.js';
import {
  masterDocs, customer, entitlement, visit, slot, TODAY, addDays,
} from '../fixtures/data.js';

const DAY = addDays(TODAY, 3);

function seedOneVisit() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
    visit({
      id: 'v1', customerId: 'cust-a', customerName: '客戶A', date: DAY, status: 'confirmed',
      slots: [slot({
        courseId: 'course-recovery', entitlementId: 'ent-a',
        startsAt: '10:00', endsAt: '11:00', equipmentId: 'eq-indiba', therapistId: 'staff-tw',
      })],
    }),
  ];
}

test('N1 設定頁填全名與簡寫 → 日曆那一列與讀取卡片印簡寫、來訪編輯器的丸子印全名', async ({ app, page }) => {
  await app.seed(seedOneVisit());
  await app.signIn('/settings/staff');

  await page.locator('[data-edit="staff-tw"]').click();
  await page.fill('input[name="name"]', '某騰崴');
  await page.fill('input[name="shortName"]', '騰崴');
  await page.click('button[type="submit"]');
  await app.saved();

  const tw = await app.readDoc('config/app/staff', 'staff-tw');
  expect(tw.name).toBe('某騰崴');
  expect(tw.shortName, '`parse()` 是白名單：少了那一格就存不進去').toBe('騰崴');
  await expect(page.locator('.card.row').filter({ hasText: '某騰崴' }).first()).toContainText('簡寫 騰崴');

  // 日曆那一天的那一列：簡寫
  await app.go('/calendar');
  await page.locator(`[data-day="${DAY}"]`).first().click();
  await app.layer('[data-open^="visit:"]');
  const row = page.locator('[data-open^="visit:v1:"]').first();
  await expect(row).toContainText('騰崴');
  await expect(row).not.toContainText('某騰崴');

  // 讀取卡片：簡寫
  await row.click();
  await app.layer('.popcard');
  await expect(page.locator('.popcard .readslot')).toContainText('騰崴');
  await expect(page.locator('.popcard .readslot')).not.toContainText('某騰崴');

  // 來訪編輯器的治療師丸子：全名
  await page.locator('.popcard [data-card-edit]').click();
  await app.layer('[data-form]');
  await expect(page.locator('[data-chip="s0-staff"]', { hasText: '某騰崴' })).toHaveCount(1);
});

// ---------- 20 合併檔 v6 帶人員名單 ----------

const person = (name) => ({
  sheetName: name,
  name,
  entitlements: [{
    key: 'r1', type: 'pool', label: '復能', totalQty: 12, courseName: null,
    optionEquipmentNames: ['INDIBA'],
  }],
  visits: [{
    date: addDays(TODAY, -20),
    status: 'done',
    slots: [{ entitlementKey: 'r1', courseName: '復能', startsAt: '10:00', endsAt: '11:00', therapistName: '騰崴', equipmentName: 'INDIBA' }],
  }],
});

const ROSTER = [
  { match: '騰崴', name: '某騰崴', shortName: '騰崴' },
  { match: '夏', name: '夏某某', shortName: '夏' },
  { match: '不在主檔', name: '某不在', shortName: '不在主檔' },
];

const mergeFile = (over = {}) => ({
  format: 'baobao-merge/v6',
  sheet: { file: '舊表.xlsx' },
  calendar: { file: 'timetree.ics' },
  customers: [person('客戶A')],
  eventCandidates: [],
  staff: ROSTER,
  ...over,
});

async function paste(app, page, file) {
  await page.locator('[data-json]').fill(JSON.stringify(file));
  await page.locator('[data-load]').click();
  await app.settled();
}

test('N2 合併檔帶人員名單：摘要卡先講會改哪幾位 → 匯入 → 全名＋簡寫、那一段照樣對到人；同一份再貼一次是 0 位', async ({ app, page }) => {
  await app.seed(masterDocs());
  await app.signIn('/settings/merge');
  await paste(app, page, mergeFile());

  // 先看不寫：按「開始匯入」之前就講出來
  const card = page.locator('[data-import-staff]');
  await expect(card).toContainText('2 位會改成全名，原本的名字變成簡寫');
  await expect(card).toContainText('1 位不改');
  await card.locator('summary').click();
  await expect(card).toContainText('騰崴 → 某騰崴（簡寫 騰崴）');
  await expect(card).toContainText('不在主檔｜');

  await page.locator('[data-run]').click();
  await expect(app.dialog()).toBeVisible();
  expect(await app.dialogText()).toContain('2 位人員改成全名');
  await app.ok();
  await expect(page.locator('#toast')).toContainText('2 位人員改好了', { timeout: 20_000 });
  await app.settled();

  const tw = await app.readDoc('config/app/staff', 'staff-tw');
  expect([tw.name, tw.shortName]).toEqual(['某騰崴', '騰崴']);
  const xia = await app.readDoc('config/app/staff', 'staff-dr-xia');
  expect([xia.name, xia.shortName]).toEqual(['夏某某', '夏']);
  const visits = (await app.readAll('visits')).filter((v) => !v.deletedAt);
  expect(visits[0].slots[0].therapistId, '檔案上寫的是原本的名字，改名之後照樣對到那一位').toBe('staff-tw');

  // 同一份再貼一次：客戶同名跳過、人員 0 位 → 沒有東西可以寫
  await paste(app, page, mergeFile());
  await expect(page.locator('[data-import-staff]')).toContainText('沒有要改的');
  await expect(page.locator('[data-run]')).toBeDisabled();
});

test('N3 客戶全部已經在系統裡、只剩人員要改：「開始匯入」照樣按得下去', async ({ app, page }) => {
  await app.seed([...masterDocs(), customer({ id: 'cust-a', name: '客戶A' })]);
  await app.signIn('/settings/merge');
  await paste(app, page, mergeFile({ staff: [ROSTER[0]] }));

  await expect(page.locator('[data-run]')).toBeEnabled();
  await page.locator('[data-run]').click();
  expect(await app.dialogText()).toContain('只寫人員與還沒寫進去的雜事');
  await app.ok();
  await expect(page.locator('#toast')).toContainText('1 位人員改好了', { timeout: 20_000 });
  const tw = await app.readDoc('config/app/staff', 'staff-tw');
  expect([tw.name, tw.shortName]).toEqual(['某騰崴', '騰崴']);
});
