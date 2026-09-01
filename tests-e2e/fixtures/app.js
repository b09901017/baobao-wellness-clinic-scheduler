// Playwright 的共用 fixture：把「乾淨資料庫 → 登入 → 落在某一頁」變成一行。
//
// 三件事是自動的，每一個測試都吃得到：
//
//   1. **每個測試前清空 Firestore**，再塞這個測試自己的資料。
//      （workers 一定要是 1，見 playwright.config.js）
//   2. **蒐集 console error 與未捕獲例外**。測試結束時如果有沒被宣告預期的，
//      直接讓那個測試紅掉 —— 靜默的 console error 正是「畫面看起來正常、
//      其實壞了」的那一種 bug。
//   3. **固定「今天」**。用 setFixedTime 而不是 install：只換掉 Date，
//      計時器照跑 —— 把計時器也假掉的話 Firestore 的連線會卡住。

import { test as base, expect } from '@playwright/test';

import {
  clearFirestore, seedDocs, ensureUser, allowUser, readDoc, readAll, APP_ORIGIN,
} from './emulator.js';
import { TODAY } from './data.js';

/** 已知會出現、而且不代表壞掉的 console 訊息。 */
const BENIGN = [
  /Service Worker registration blocked by Playwright/i,
  /Failed to load resource.*fonts\.googleapis\.com/i,
  /Failed to load resource.*fonts\.gstatic\.com/i,
  /net::ERR_.*fonts\./i,
  // 模擬器自己會喊的那幾句
  /You are not currently authenticated/i,
  /Firestore.*emulator/i,
  /WebChannelConnection/i,
  // **時間旅行的副作用，不是 app 的問題。**
  // 我們把瀏覽器的 Date 撥到未來（例如 2028 年測閏日），而模擬器寫進去的
  // serverTimestamp 還是真實的現在 —— SDK 就會喊「更新時間在未來」。
  // 真實使用不會發生，把它當成錯誤會讓每一支時間旅行的測試都紅掉。
  /Detected an update time that is in the future/i,
  // **Firestore 自己的長連線在重建時會回 400。**
  // 那是 SDK 的傳輸層（WebChannel）在換一條連線，它自己會重送，
  // 資料不會少 —— 上面那條 /WebChannelConnection/ 擋的是 SDK 印出來的警告，
  // 但瀏覽器另外會印一句沒有頭沒有尾的
  // 「Failed to load resource: the server responded with a status of 400」，
  // 那一句的文字裡沒有任何線索，只有 `location().url` 認得出來。
  // 2026-09-02 C13 就是被這一句弄成 flaky 的（重試就過，斷言從來沒錯過）。
  //
  // 範圍刻意收得很窄：只有 Firestore 自己那兩條通道的網址。
  // 權限被 Rules 擋掉走的是另一條路（SDK 會丟 permission-denied，
  // 而畫面上那句話有各自的測試在盯），不會被這一條蓋掉。
  /\/google\.firestore\.v1\.Firestore\/(Write|Listen)\/channel/,
];

/**
 * 這一則 console 錯誤可以忽略嗎。
 *
 * **文字與來源網址都要問。** 瀏覽器對「某個請求失敗了」印的那一句
 * （`Failed to load resource: …`）裡面沒有網址，只有 `location().url` 有 ——
 * 只看文字的話，Firestore 傳輸層的重連跟 app 真的打壞了一個請求長得一模一樣。
 */
const isBenign = (text, url = '') =>
  BENIGN.some((re) => re.test(text) || (url && re.test(url)));

export const test = base.extend({
  // 刻意**沒有** seed 這個 option fixture。
  //
  // 試過 `seed: [[], { option: true }]` + `test.use({ seed: [...] })`，
  // 而 Playwright 會把傳進去的陣列當成 `[值, 選項]` 的 tuple 再拆一次 ——
  // 進到 fixture 的東西已經不是陣列了，`seed.length` 是 undefined，
  // 於是整段塞資料被**靜默跳過**，畫面只是空的，沒有任何錯誤。
  // 改成測試自己呼叫 `app.seed(...)`：少一層魔法，也看得出是誰塞的。

  /** 這個測試的「今天」。字串沒有那個歧義，所以留成 option。 */
  today: [TODAY, { option: true }],

  /** 這個測試蒐集到的 console error / pageerror。 */
  errors: async ({}, use) => {
    const list = [];
    await use(list);
  },

  app: async ({ page, today, errors }, use) => {
    // ---- 資料 ----
    const { uid } = await ensureUser();
    await clearFirestore();
    await allowUser(uid);

    // ---- 錯誤蒐集 ----
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const text = m.text();
      // 網址在 location() 裡，不在訊息裡（見 isBenign 的說明）。
      const url = m.location?.()?.url ?? '';
      if (!isBenign(text, url)) errors.push({ kind: 'console', text, url });
    });
    page.on('pageerror', (e) => {
      if (!isBenign(e.message)) errors.push({ kind: 'pageerror', text: e.message, stack: e.stack });
    });

    // ---- 固定今天 ----
    // 中午 12 點，避開時區換日的邊界（Asia/Taipei = UTC+8）。
    await page.clock.setFixedTime(new Date(`${today}T12:00:00+08:00`));

    const helpers = {
      uid,
      today,
      readDoc,
      readAll,

      /**
       * 塞資料。**要在 signIn() 之前呼叫。**
       * 塞完會確認真的寫進去了 —— 靜默塞不進去害我查了半小時。
       */
      async seed(docs = []) {
        if (!Array.isArray(docs)) throw new Error('app.seed() 收的是陣列');
        if (!docs.length) return 0;

        await seedDocs(docs);

        // 塞完之後**回頭確認它真的在**。模擬器的清空是非同步的，晚到的那一次
        // 會把剛塞的洗掉（見 `emulator.js` 的 clearFirestore），而症狀只是
        // 畫面空白 —— 沒有錯誤、沒有線索。
        const canary = docs.find((d) => d.id);
        if (canary) {
          for (let i = 0; i < 3; i += 1) {
            // eslint-disable-next-line no-await-in-loop
            if (await readDoc(canary.path, canary.id)) return docs.length;
            // eslint-disable-next-line no-await-in-loop
            await seedDocs(docs);
          }
          throw new Error(`種子塞不進去：${canary.path}/${canary.id} 讀不回來`);
        }
        return docs.length;
      },

      /** 打開 app 並登入。回來時已經在待辦中心（或指定的那一頁）。 */
      async signIn(hash = '/') {
        await page.goto(`${APP_ORIGIN}/#${hash}`);
        await page.waitForSelector('[data-signin]', { timeout: 30_000 });

        const [popup] = await Promise.all([
          page.waitForEvent('popup'),
          page.click('[data-signin]'),
        ]);
        await popup.waitForLoadState('domcontentloaded');
        await popup.click('li.js-reuse-account');
        // 刻意**不等**彈窗的 close 事件：它常常在我們開始等之前就關掉了，
        // 而 waitForEvent 沒有預設逾時 —— 那會直接掛死整個測試。
        // 「登入成功」的判準是主畫面出現，不是彈窗消失。

        // 登入成功 = 殼掛上來了（底部導覽出現）
        await page.waitForSelector('.app__nav', { timeout: 30_000 });
        await page.waitForSelector('#view', { timeout: 10_000 });
        await helpers.settled();
        return helpers;
      },

      /** 換到某一頁，並等它畫完（不再是「載入中…」）。 */
      async go(hash) {
        await page.evaluate((h) => { window.location.hash = h; }, hash);
        await helpers.settled();
      },

      /** 等畫面不再是載入中。 */
      async settled() {
        await page.waitForFunction(
          () => {
            const v = document.querySelector('#view');
            if (!v) return false;
            const t = v.textContent ?? '';
            return t.trim().length > 0 && !t.includes('載入中…');
          },
          { timeout: 20_000 },
        );
        // 讓「先畫出來、數字等資料回來再補」那幾塊補完
        await page.waitForTimeout(350);
      },

      /** 重新整理整個 app（測跨日、測快取用）。 */
      async reload() {
        await page.reload();
        await page.waitForSelector('.app__nav', { timeout: 30_000 });
        await helpers.settled();
      },

      /** 把「今天」換掉，然後重新整理。跨日測試用。 */
      async travelTo(day) {
        await page.clock.setFixedTime(new Date(`${day}T12:00:00+08:00`));
        await helpers.reload();
      },

      /**
       * 二次確認框（`ui/components/dialog.js`）。
       *
       * **不要用 `[role="dialog"]`** —— 抽屜、卡片、確認框三種都掛那個角色，
       * 抓到的常常是底下那一層而不是確認框本身。
       */
      dialog() {
        return page.locator('.dialog-backdrop .dialog');
      },

      /** 確認框裡寫了什麼。SPEC 6.5 要求它講出具體後果，所以這一段值得斷言。 */
      dialogText() {
        return helpers.dialog().innerText();
      },

      /** 按下確認框的主要按鈕。 */
      async ok() {
        await page.locator('.dialog-backdrop [data-ok]').click();
      },

      /** 按下確認框的取消。 */
      async cancelDialog() {
        await page.locator('.dialog-backdrop [data-cancel]').click();
      },

      /** 目前這一頁的可見文字。做寬鬆比對用。 */
      text() {
        return page.locator('#view').innerText();
      },

      /** 整頁（含底部導覽、toast）的可見文字。 */
      allText() {
        return page.locator('body').innerText();
      },
    };

    await use(helpers);

    // ---- 收尾：沒被宣告預期的 console error 一律讓測試紅掉 ----
    if (errors.length && !test.info().annotations.some((a) => a.type === 'allow-console-errors')) {
      // 網址一起印出來 —— 「Failed to load resource」那一句沒有網址就查不下去，
      // 而那正是查 C13 那個 flaky 花掉最多時間的地方。
      const lines = errors
        .map((e) => `  [${e.kind}] ${e.text}${e.url ? `\n          ← ${e.url}` : ''}`)
        .join('\n');
      throw new Error(`這個測試在 console 留下了 ${errors.length} 筆錯誤：\n${lines}`);
    }
  },
});

export { expect };
