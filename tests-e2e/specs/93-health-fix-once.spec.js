// 2026-11-05 第一輪小修段三（審查 02）：資料健檢「補上二返額度」真的只建一筆 —— 這一支**真的跑寫入那一層**。
//
// 02 的單元測試（`tests/health-fix-idempotent.test.js`）只掃原始碼：`data/health.js` import Firebase、node 跑不起來。
// 「已經在了就不寫」（`notYetWritten()`）與鏈照 id 去重是靠讀資料庫的，掃原始碼看不出它有沒有真的擋住。
// 這裡在頁面裡 import app 自己那一支（同一個模組實體、同一個模擬器），照畫面的順序叫：`run()` 掃描 → `applyFixes()`。
//
// H1 是審查抓到的那一個角落：同一筆修正從兩條路一起送出（單筆「修正」與「全部修正」的 key 不一樣，`withSaveState()` 擋不到）——
// 兩趟都讀到「還沒寫」，拿同一個 id 各寫一次：第二次整份蓋掉第一次、稽核多一筆「建立」、健檢那條鏈各長一份待辦。

import { test, expect } from '../fixtures/app.js';
import { scenarioExamineChain } from '../fixtures/data.js';

const ENTS = 'customers/cust-b/entitlements';

/** 客戶B 有一筆做過一次的 8 萬健檢、身上沒有二返額度 → 資料健檢列「補上二返額度」 */
function scenario() {
  return scenarioExamineChain().filter((d) => d.id !== 'ent-b-followup');
}

/** 在頁面裡掃一次、拿「二返額度」那一項的第一筆修正，掛在 window 上（同一個物件 = 畫面上同一顆按鈕拿的那一份） */
async function scanFix(page) {
  return page.evaluate(async () => {
    const health = await import('/js/data/health.js');
    const { todayISO } = await import('/js/domain/dates.js');
    const result = await health.run(todayISO());
    const fix = result.checks.find((c) => c.id === 'followups')?.findings?.[0]?.fix ?? null;
    window.__fix = fix;
    return fix ? { kind: fix.kind, id: fix.id } : null;
  });
}

const applyOnce = (page) => page.evaluate(async () => {
  const health = await import('/js/data/health.js');
  return health.applyFixes([window.__fix]);
});

/** 二返額度（連軟刪除的） */
const followups = async (app) => (await app.readAll(ENTS)).filter((e) => e.followupForEntitlementId === 'ent-b-exam');

/** 稽核上「建立這一筆」幾次 —— `batch.set` 同一個 id 兩次時文件只有一份，稽核看得出來 */
const createsOf = async (app, id) => (await app.readAll('audit'))
  .filter((a) => a.action === `${ENTS}.create` && String(a.targetPath ?? '').endsWith(`/${id}`)).length;

/** 健檢那條鏈長出來的待辦（不管哪一種），照種類數 */
const chainTasks = async (app) => (await app.readAll('tasks'))
  .filter((t) => t.customerId === 'cust-b' && !t.deletedAt)
  .reduce((acc, t) => ({ ...acc, [t.kind]: (acc[t.kind] ?? 0) + 1 }), {});

test('H1 同一筆修正兩趟一起送出（單筆「修正」＋「全部修正」）→ 只建一次、鏈只長一份', async ({ app, page }) => {
  await app.seed(scenario());
  await app.signIn('/');
  const fix = await scanFix(page);
  expect(fix?.kind, '資料健檢列得出「補上二返額度」').toBe('addFollowup');
  expect(fix.id, 'id 在掃描時就鑄好').toBeTruthy();

  await page.evaluate(async () => {
    const health = await import('/js/data/health.js');
    await Promise.all([health.applyFixes([window.__fix]), health.applyFixes([window.__fix])]);
  });

  expect((await followups(app)).length, '二返額度一筆').toBe(1);
  expect(await createsOf(app, fix.id), '只建了一次（第二趟沒有整份蓋掉第一趟）').toBe(1);
  const tasks = await chainTasks(app);
  for (const [kind, n] of Object.entries(tasks)) expect(n, `「${kind}」只長一份`).toBe(1);
});

test('H2 寫完之後拿同一筆再送一次（toast 的重試）→ 不寫、那一筆原封不動', async ({ app, page }) => {
  await app.seed(scenario());
  await app.signIn('/');
  const fix = await scanFix(page);
  await applyOnce(page);
  const [first] = await followups(app);
  const tasksBefore = await chainTasks(app);

  await applyOnce(page);

  const after = await followups(app);
  expect(after.length).toBe(1);
  expect(after[0].createdAt, '沒有整份蓋掉（createdAt 沒有重設）').toEqual(first.createdAt);
  expect(await createsOf(app, fix.id)).toBe(1);
  expect(await chainTasks(app), '鏈沒有再長一份').toEqual(tasksBefore);
});

test('H3 寫完、她刪掉那一筆，再拿同一筆送一次 → 不救活', async ({ app, page }) => {
  await app.seed(scenario());
  await app.signIn('/');
  const fix = await scanFix(page);
  await applyOnce(page);
  await page.evaluate(async (id) => {
    const customers = await import('/js/data/customers.js');
    await customers.removeEntitlement('cust-b', id, '測試：她刪掉的');
  }, fix.id);
  expect((await followups(app))[0].deletedAt, '刪掉了').toBeTruthy();

  await applyOnce(page);

  const after = await followups(app);
  expect(after.length).toBe(1);
  expect(after[0].deletedAt, '還是刪掉的').toBeTruthy();
});
