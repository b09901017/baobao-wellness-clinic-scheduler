// 量打開 app 每一步花多久（`ui/bootTiming.js`，`.scratch/after-golive-2026-10-20/issues/05`）。
//
// 她 2026-10-20：「剛打開app的時候，會卡在載入中5 6 秒」。真正慢在哪只有她的手機量得到，
// 所以這一支盯的不是快不快，是**量的那一張對不對、會不會擋開機**：
//   B1 從首頁打開 → 設定頁那一張看得到五步、照先後排、總數＝「資料」那一步（先畫殼之後登入、權限可能比數字晚到，ADR-0167）
//   B2 從別頁打開 → 只記到「畫面」
//   B3 記不住（那一個 key 一碰就丟例外）→ 照樣開機、那一張寫「記不住」

import { test, expect } from '../fixtures/app.js';

/** 設定頁那一張卡上最新那一列：每一步的毫秒（照畫出來的先後）與那一列的總數。 */
async function latestRow(app, page) {
  await app.go('#/settings');
  const row = page.locator('[data-boottimes] [data-boot]').first();
  await expect(row).toBeVisible();
  return row.evaluate((li) => ({
    total: Number(li.dataset.bootTotal),
    steps: [...li.querySelectorAll('[data-step]')].map((s) => ({ id: s.dataset.step, ms: Number(s.dataset.ms), text: s.textContent })),
  }));
}

test('B1 從首頁打開 → 設定頁那一張：五步照先後排、總數是「資料」那一步', async ({ app, page }) => {
  await app.signIn('/');
  // 第一次登入的那一趟可能走過登入頁（那一次不記）—— 重新打開一次，才是一次正常開機。
  // **要 reload**：`goto()` 到只差 hash 的同一頁不會重新載入
  await page.reload();
  await expect(page.locator('#root[data-access="allowed"]')).toBeVisible();
  await app.settled();

  const { total, steps } = await latestRow(app, page);
  expect(steps.map((s) => s.id)).toEqual(expect.arrayContaining(['code', 'auth', 'access', 'shell', 'data']));
  expect(steps).toHaveLength(5);
  for (let i = 1; i < steps.length; i += 1) {
    expect(steps[i].ms, `${steps[i].text} 要在 ${steps[i - 1].text} 之後`).toBeGreaterThanOrEqual(steps[i - 1].ms);
  }
  // 先畫殼（ADR-0167）：重新整理時這一台記著上一次通過了，畫面比登入早到
  expect(steps[0].id, '程式最先').toBe('code');
  const at = Object.fromEntries(steps.map((s) => [s.id, s.ms]));
  expect(at.shell, '殼比登入早畫出來').toBeLessThanOrEqual(at.auth);
  expect(total, '總數是她看到待辦數字的那一刻').toBe(at.data);
  // 抬頭那一句講的是同一個數字
  await expect(page.locator('[data-boot-latest]')).toHaveText(`${(Math.round(total / 100) / 10).toFixed(1)} 秒`);
  await expect(page.locator('[data-boottimes]')).toContainText('看到待辦的數字');
  // 字是白話
  await expect(page.locator('[data-boottimes] [data-boot]').first()).toContainText('程式');
});

test('B2 從別頁打開 → 只記到「畫面」，之後回首頁畫出數字不算進那一次', async ({ app, page }) => {
  await app.signIn('/customers');
  await page.reload();
  await expect(page.locator('#root[data-access="allowed"]')).toBeVisible();
  await app.settled();
  await app.go('#/');
  const { total, steps } = await latestRow(app, page);
  expect(steps.map((s) => s.id).sort()).toEqual(['access', 'auth', 'code', 'shell']);
  expect(total, '從別頁打開：總數是畫面那一步').toBe(steps.find((s) => s.id === 'shell').ms);
  await expect(page.locator('[data-boottimes]')).toContainText('從別頁打開');
});

// **只擋這一張自己那一個 key**：整個 localStorage 一碰就丟例外的話，app 本身就開不起來
// （Firestore 那一層丟 INTERNAL UNHANDLED ERROR、停在登入頁 —— 2026-10-21 量的，跟量開機無關，記在 HANDOFF 的中途發現）。
// 這裡盯的是「量的那一段壞掉，開機的流程不變」
test('B3 這一台記不住（那一個 key 一讀一寫就丟例外）→ 照樣開機，那一張寫「記不住」', async ({ app, page }) => {
  await page.addInitScript((key) => {
    for (const name of ['getItem', 'setItem']) {
      const real = Storage.prototype[name];
      Storage.prototype[name] = function guarded(k, ...rest) {
        if (k === key) throw new DOMException('blocked', 'SecurityError');
        return real.call(this, k, ...rest);
      };
    }
  }, 'scheduler.bootTimes');
  await app.signIn('/');
  await page.reload();
  await expect(page.locator('#root[data-access="allowed"]')).toBeVisible();
  await app.settled();
  await app.go('#/settings');
  await expect(page.locator('[data-boottimes]')).toContainText('這一台記不住');
  await expect(page.locator('[data-boottimes] [data-boot]')).toHaveCount(0);
});
