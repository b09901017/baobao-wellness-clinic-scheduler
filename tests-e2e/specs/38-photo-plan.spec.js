// 拍方案文宣 → 方案範本（issue 07，ADR-0099）。
//
// 她 2026-09-17：「可以再設定方案範本新增旁邊多一個相機的icon，然後一樣是可以拍照選照片，
// 然後說辯是到了什麼內容，然後可以微調，然後介面一樣不要太複雜」。
//
// 走的是整條路：設定 → 方案範本 → 相機 → 相簿選一張 → 送出 → **原本那張方案編輯器**事先填好。
// 模擬器裡的 Function 回 `fixtures/ai/planFlyer.json`（筋骨強身那張文宣的版面）。

import { test, expect } from '../fixtures/app.js';
import { masterDocs } from '../fixtures/data.js';
import { fakePhoto, queueAi } from '../fixtures/ai/index.js';
import { dayKey } from '../../functions/lib/guard.js';

test.use({ today: dayKey(new Date()) });

async function photoToEditor(app, page, fixture) {
  await queueAi([fixture]);
  const file = await fakePhoto(`${fixture}.jpg`);
  await app.seed([...masterDocs()]);
  await app.signIn('/settings/plans');
  await page.locator('[data-photo-plan]').click();
  await expect(page.locator('.cam')).toBeVisible();
  await page.locator('[data-cam-album-input]').setInputFiles(file);
  await page.locator('[data-cam-send]').click();
  await expect(page.locator('.cam')).toHaveCount(0);
  await expect(page.locator('[data-form] .photohead')).toBeVisible();
}

test('P1 筋骨強身那張 → 七個項目、次數 6／4／4／4／4／12／20，復能是三台擇一池 60 分，名字是算出來的', async ({ app, page }) => {
  await photoToEditor(app, page, 'planFlyer');

  const items = page.locator('[data-form] [data-item]');
  await expect(items).toHaveCount(7);
  const qty = await page.locator('[data-form] input[name$="-qty"]').evaluateAll((els) => els.map((e) => e.value));
  expect(qty).toEqual(['6', '4', '4', '4', '4', '12', '20']);

  await expect(page.locator('input[name="item-5-label"]')).toHaveValue('復能-三選一(60)');
  await expect(page.locator('select[name="item-5-type"]')).toHaveValue('pool');
  await expect(page.locator('input[name="item-5-duration"]')).toHaveValue('60');
  const pool = await page.locator('input[name="item-5-equip"]:checked').evaluateAll((els) => els.map((e) => e.value).sort());
  expect(pool).toEqual(['eq-indiba', 'eq-laser', 'eq-sis']);
  await expect(page.locator('select[name="item-6-type"]')).toHaveValue('single');
  await expect(page.locator('input[name="item-6-label"]')).toHaveValue('ILIB(60)');

  // 每一項旁邊看得到照片上的原字；點一下看照片
  await expect(items.nth(5).locator('.seen').first()).toContainText('高能量雷射 或 超磁場 或 INDIBA');
  await items.nth(5).locator('.seen').first().click();
  await expect(page.locator('.seenview img')).toBeVisible();
  await page.locator('[data-seenview-close]').click();
  await expect(page.locator('.seenview')).toHaveCount(0);
});

test('P2 存下去之後跟手打的長得一樣：沒有「來自照片」之類多出來的欄位', async ({ app, page }) => {
  await photoToEditor(app, page, 'planFlyer');
  // 種子裡已經有一張筋骨強身，改個名字才存得下去（同名驗證照舊）
  await page.locator('input[name="name"]').fill('筋骨強身（拍照）');
  await page.locator('[data-form] button[type="submit"]').click();
  await app.saved();

  const plans = await app.readAll('config/app/plans');
  const saved = plans.find((p) => p.name === '筋骨強身（拍照）');
  expect(saved).toBeTruthy();
  expect(Object.keys(saved).filter((k) => k.startsWith('__') || /photo|seen/i.test(k))).toEqual([]);
  expect(saved.items).toHaveLength(7);
  for (const it of saved.items) {
    expect(Object.keys(it).filter((k) => !['type', 'label', 'qty', 'durationMin', 'courseId', 'optionEquipmentIds', 'frequencyRule'].includes(k))).toEqual([]);
  }
  expect(saved.membershipMonths).toBe(12);
  expect(saved.note).toBe('總價 288,000，限本人');
});

test('P3 主檔沒有的課程 → 那一項空著、看得到原字、存不下去直到選好', async ({ app, page }) => {
  await photoToEditor(app, page, 'planFlyer-unknown');
  const unknown = page.locator('[data-form] [data-item="1"]');
  await expect(unknown).toHaveClass(/pool--unresolved/);
  await expect(unknown.locator('.seen').first()).toContainText('冷凍減脂');

  await page.locator('[data-form] button[type="submit"]').click();
  await expect(page.locator('[data-errors]')).toContainText('要選一個課程');

  await page.locator('select[name="item-1-course"]').selectOption('course-eecp');
  await page.locator('[data-form] button[type="submit"]').click();
  await app.saved();
  const plans = await app.readAll('config/app/plans');
  expect(plans.some((p) => p.name === '試做方案' && p.membershipMonths === 6)).toBe(true);
});
