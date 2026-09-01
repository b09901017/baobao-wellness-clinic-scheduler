// 離線。
//
// 這一組補的是 2026-09-01 那份體檢報告 §2.1 的洞，而那個洞的形狀是這樣：
//
//   **Firestore 的寫入 Promise 在離線時既不 resolve 也不 reject。**
//   它會把寫入放進本機快取、然後一直等到網路回來 —— 沒有內建逾時。
//
// 所以 `ui/toast.js` 的 `withSaveState()` 那個 `catch` 在離線時**永遠不會執行**，
// 而「儲存中…」會停在畫面上直到她重新整理。整個 app 的錯誤處理都建立在
// 「失敗會丟例外」這個假設上，而那個假設在她最常遇到的情境下不成立
//（SPEC 6.9：她在公司大樓裡用行動網路）。
//
// 這三支測的**不是**「離線時要存得進去」（那是 Firestore 的事，它做得很好），
// 而是「離線時畫面有沒有誠實地講出現在的狀況」。

import { test, expect } from '../fixtures/app.js';
import { masterDocs, customer, entitlement } from '../fixtures/data.js';

/** `ui/toast.js` 的 PENDING_MS 是 8 秒，等久一點才不會抓到邊界。 */
const PAST_PENDING = 11_000;

function baseSeed() {
  return [
    ...masterDocs(),
    customer({ id: 'cust-a', name: '客戶A' }),
    entitlement('cust-a', {
      id: 'ent-a', label: '復能', type: 'pool', totalQty: 12,
      optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'], durationMin: 60,
    }),
  ];
}

/** 打開右下角那顆泡泡、打一行字、按存。**不等它回來** —— 離線時它不會回來。 */
async function typeQuickNote(page, text) {
  await page.locator('[data-quick]').click();
  await page.waitForTimeout(400);
  await page.locator('[data-quicktext]').fill(text);
}

const saveButton = (page) =>
  page.locator('.drawer [type="submit"], .drawer [data-save]').first();

// ---------------------------------------------------------------------------

test('O1 離線存一筆：畫面一定要講話，不可以停在「儲存中…」', async ({ app, page }) => {
  // 刻意斷線，所以瀏覽器一定會喊 ERR_INTERNET_DISCONNECTED。
  // 那是這一支在製造的情境，不是意外（同 09 那一支打死推送網址）。
  test.info().annotations.push({ type: 'allow-console-errors', description: '這一支刻意斷線' });
  await app.seed(baseSeed());
  await app.signIn('/todo/notes');

  await page.context().setOffline(true);
  await typeQuickNote(page, '離線的時候記一筆');
  await saveButton(page).click();

  // 8 秒之前是「儲存中…」，那是對的 —— 它真的還在飛。
  await page.waitForTimeout(1500);
  const early = await page.locator('#toast').innerText();
  console.log('[O1] 剛按下去 =', JSON.stringify(early));
  expect(early).toMatch(/儲存中/);

  // 8 秒之後一定要換一句話。
  await page.waitForTimeout(PAST_PENDING);
  const later = await page.locator('#toast').innerText();
  console.log('[O1] 等超過 8 秒之後 =', JSON.stringify(later));

  expect(later, '離線時不可以一直停在「儲存中…」').not.toMatch(/^儲存中/);
  expect(later, '要講出「還沒送出去，但資料在」').toMatch(/還沒送出去/);
  // **不可以說失敗。** 資料已經在本機快取裡了，說失敗會讓她再存一次，
  // 而那才真的會變成兩筆。
  expect(later, '這不是失敗，不可以說成失敗').not.toMatch(/失敗/);

  await page.context().setOffline(false);
});

test('O2 離線連按三次「記下來」→ 回到線上只寫進去一筆', async ({ app, page }) => {
  // 刻意斷線，所以瀏覽器一定會喊 ERR_INTERNET_DISCONNECTED。
  // 那是這一支在製造的情境，不是意外（同 09 那一支打死推送網址）。
  test.info().annotations.push({ type: 'allow-console-errors', description: '這一支刻意斷線' });
  await app.seed(baseSeed());
  await app.signIn('/todo/notes');

  await page.context().setOffline(true);
  await typeQuickNote(page, '連按三次的那一筆');

  // 離線時那一趟永遠不會回來，所以「儲存中…」會一直在 —— 而那正是
  // 她會多按幾下的情境。`withSaveState` 的 key 要讓後面兩下接到同一趟。
  for (let i = 0; i < 3; i += 1) {
    await saveButton(page).click({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
  }

  await page.context().setOffline(false);

  // 回到線上之後排隊的寫入會送出去。等它真的落地。
  await expect.poll(
    async () => (await app.readAll('notes')).filter((n) => !n.deletedAt).length,
    { timeout: 30_000, message: '等排隊的寫入送出去' },
  ).toBeGreaterThan(0);

  await page.waitForTimeout(3000); // 如果有第二筆，這段時間夠它也落地
  const notes = (await app.readAll('notes')).filter((n) => !n.deletedAt);
  console.log('[O2] 真的寫進去的 =', notes.map((n) => n.text));

  expect(notes.length, '連按三次只能有一筆').toBe(1);
});

// 這一支要**離線之後重新整理**，而那只有 service worker 活著才做得到 ——
// 它就是為了「訊號差時 app 還打得開」而存在的（`public/sw.js` 的檔頭）。
//
// 整個 E2E 套件預設把 SW 關掉（`playwright.config.js`：不關的話測試之間會吃到
// 舊的 app 殼）。這裡是唯一開回來的地方，所以**它順便是 `sw.js` 唯一的測試** ——
// 在這之前那支檔案從來沒有被任何測試執行過。
test.describe('離線重新整理（要 service worker）', () => {
  test.use({ serviceWorkers: 'allow' });

  test('O3 離線開 app → 不可以說「這個帳號還沒有權限」', async ({ app, page }) => {
    // 刻意斷線，所以瀏覽器一定會喊 ERR_INTERNET_DISCONNECTED。
    // 那是這一支在製造的情境，不是意外（同 09 那一支打死推送網址）。
    test.info().annotations.push({ type: 'allow-console-errors', description: '這一支刻意斷線' });
    await app.seed(baseSeed());
    await app.signIn('/');

    // 等 SW 真的接管，否則斷線之後連 index.html 都拿不到，
    // 測到的就只是「Playwright 沒開 SW」而不是 app 的行為。
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(1500);

    // 斷線之後重新整理。這時 `data/auth.js` 的 `accessState()` 讀不讀得到
    // allowedUsers 取決於離線快取裡有沒有 —— **兩種結果都可以接受**：
    // 有快取就正常進 app，沒快取就說「連不上」。
    //
    // 不可以接受的只有一種：說「這個帳號還沒有權限」，然後教她去 Firebase
    // Console 建一個她早就有的白名單。她只是在電梯裡。
    await page.context().setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const body = await app.text();
    console.log('[O3] 離線重新整理之後的畫面 =', JSON.stringify(body.slice(0, 140)));

    expect(body, '離線不等於沒有權限').not.toMatch(/還沒有權限/);
    expect(body.trim().length, '畫面不可以是空的').toBeGreaterThan(5);
    expect(body, '也不可以永遠停在載入中').not.toMatch(/^\s*載入中…\s*$/);

    await page.context().setOffline(false);
  });
});
