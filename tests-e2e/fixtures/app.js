// Playwright 的共用 fixture：把「乾淨資料庫 → 登入 → 落在某一頁」變成一行。
//
// 三件事是自動的，每一個測試都吃得到：
//
//   1. **每個測試前清空 Firestore**，再塞這個測試自己的資料。
//      （**一個 worker 一個命名空間**，所以清空只清得到自己那一份；
//      隔離怎麼做見 playwright.config.js 的檔頭）
//   2. **蒐集 console error 與未捕獲例外**。測試結束時如果有沒被宣告預期的，
//      直接讓那個測試紅掉 —— 靜默的 console error 正是「畫面看起來正常、
//      其實壞了」的那一種 bug。
//   3. **固定「今天」**。用 setFixedTime 而不是 install：只換掉 Date，
//      計時器照跑 —— 把計時器也假掉的話 Firestore 的連線會卡住。

import { test as base, expect } from '@playwright/test';

import {
  clearFirestore, seedDocs, ensureUser, allowUser, readDoc, readAll,
  APP_ORIGIN, PROJECT_ID, WORKER_INDEX,
} from './emulator.js';
import { TODAY } from './data.js';

/**
 * **登入一次就好：把 Firebase 的登入狀態抄起來，之後的測試直接寫回去。**
 *
 * 為什麼不能用 Playwright 的 `storageState`：它存的是 cookie ＋ localStorage，
 * 而 Firebase JS SDK 的登入狀態**存在 IndexedDB**（`firebaseLocalStorageDb`
 * 的 `firebaseLocalStorage`，key 是 `firebase:authUser:<apiKey>:[DEFAULT]`）。
 * 2026-09-09 實際問過一次登入完的頁面：`localStorage` 是空的、cookie 也是空的。
 *
 * 所以走的是「把那幾筆抄下來，開機前寫回去」。量到的：一次真的登入
 * （開彈窗 → 載入 → 點 → 等殼）大約 1 秒，193 支就是 3 分鐘。
 *
 * **這一份是每個 worker 一份**（module 層變數），跟命名空間一樣。
 *
 * **壞掉會大聲。** 寫回去的格式不對（例如升了一版 firebase、key 變了）的話
 * app 會停在登入頁，而 `signIn()` 等的是 `.app__nav` —— 30 秒逾時，
 * 訊息看得懂。它不會安靜地變成「沒登入但測試照樣過」。
 */
let authSnapshot = null;

const AUTH_DB = 'firebaseLocalStorageDb';
const AUTH_STORE = 'firebaseLocalStorage';

/** 把 IndexedDB 裡那幾筆登入狀態讀出來。 */
function readAuthSnapshot(page) {
  return page.evaluate(async ({ db: dbName, store }) => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open(dbName);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    if (!db.objectStoreNames.contains(store)) { db.close(); return []; }
    const rows = await new Promise((res, rej) => {
      const r = db.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return rows;
  }, { db: AUTH_DB, store: AUTH_STORE });
}

/**
 * 開機前把登入狀態寫回 IndexedDB。
 *
 * 用 `addInitScript` 而不是 `evaluate`：它在**頁面自己的任何程式跑之前**執行，
 * 所以 Firebase SDK 初始化、去 IndexedDB 找登入狀態的時候，那幾筆已經在了。
 */
function primeAuth(page, rows) {
  return page.addInitScript(({ db: dbName, store, rows: data }) => {
    const open = indexedDB.open(dbName, 1);
    open.onupgradeneeded = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(store)) {
        db.createObjectStore(store, { keyPath: 'fbase_key' });
      }
    };
    open.onsuccess = () => {
      const db = open.result;
      if (!db.objectStoreNames.contains(store)) { db.close(); return; }
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      for (const row of data) os.put(row);
      tx.oncomplete = () => db.close();
    };
  }, { db: AUTH_DB, store: AUTH_STORE, rows });
}

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
  // **拍照辨識那一支 Function 回 4xx／500 是一種回答，不是 app 壞了**（ADR-0100）。
  // 暫停中、超過上限、辨識失敗都是用 HTTP 狀態碼回來的，瀏覽器會自己印一句沒頭沒尾的
  // 「Failed to load resource」—— 那一句只有 `location().url` 認得出來。
  // 畫面有沒有把原因講對，由拍照那幾支 spec 自己斷言（例如「AI 暫停中」）。
  // 範圍只有那一支的網址。
  /^http:\/\/127\.0\.0\.1:5001\/[^/]+\/asia-east1\/extract$/,
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

/**
 * 各頁面「還在讀」時填的佔位字。**畫面上出現這幾個字就不算畫完。**
 *
 * 少一個的症狀特別壞：斷言讀到的是那三四個字，而錯誤訊息長得像
 * 「應該要有『次數對帳』，實際是『掃描中…』」—— 看起來像 app 壞了，
 * 其實是測試問得太早。`tests/e2e-waits.test.js` 掃 `public/js/` 盯著這張表。
 */
// **只放畫進 `#view` 的**。toast 那一族（「儲存中…」「送出中…」）不算 ——
// 那是 `app.saved()` 在判的，而 `#view.textContent` 本來就讀不到 toast。
const PLACEHOLDERS = ['載入中…', '掃描中…', '讀取中…', '找人中…', '算佇列中…'];

export const test = base.extend({
  /**
   * 告訴這個瀏覽器它是第幾號 worker。**掛在 context 這一層，不是某個 fixture。**
   *
   * `firebase-config.js` 讀 `window.__E2E_WORKER` 去算要連哪一個模擬器命名空間，
   * 而 `addInitScript()` 保證它在任何 app 程式跑之前就已經在了。
   *
   * 掛在 `app` fixture 上會漏掉自己 `page.goto()` 的測試（`00-smoke` 的 S3
   * 就是），而漏掉的症狀是那一頁悄悄去讀 0 號的資料 —— 畫面看起來很正常，
   * 只是資料是別人的。
   */
  context: async ({ context }, use) => {
    await context.addInitScript((w) => { window.__E2E_WORKER = w; }, WORKER_INDEX);
    await use(context);
  },

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

      /**
       * 打開 app 並登入。回來時已經在待辦中心（或指定的那一頁）。
       *
       * **這個 worker 的第一個測試才真的走一次登入彈窗**，走完把 Firebase
       * 存在 IndexedDB 的那幾筆抄起來（見 `authSnapshot`）；之後每一個測試
       * 直接在開機前寫回去，省掉開彈窗／等它載入／點那一下 —— 量到約 1 秒，
       * 193 支就是 3 分鐘。
       *
       * **想測「沒有權限的人」的話不要用這一支。** `00-smoke` 的 S3 是自己
       * 從 `page.goto()` 開始走一次真的登入的，刻意不經過這裡 —— 把登入
       * 變快很容易連「沒登入」那個狀態也一起跳過，那一支就會假綠。
       * 所以這裡動的只有 `signIn()` 自己，**沒有**在 context 上掛任何東西。
       */
      async signIn(hash = '/') {
        if (authSnapshot?.length) {
          await primeAuth(page, authSnapshot);
          await page.goto(`${APP_ORIGIN}/#${hash}`);
          await helpers.sameNamespace();
          // 寫回去的格式不對的話 app 會停在登入頁，這一行 30 秒逾時 ——
          // 看得懂的錯，不是靜默。
          await page.waitForSelector('.app__nav', { timeout: 30_000 });
          await page.waitForSelector('#view', { timeout: 10_000 });
          await helpers.settled();
          return helpers;
        }

        await page.goto(`${APP_ORIGIN}/#${hash}`);
        await page.waitForSelector('[data-signin]', { timeout: 30_000 });
        await helpers.sameNamespace();

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

        // 這個 worker 的第一次登入 —— 把狀態抄起來給後面的測試用。
        authSnapshot = await readAuthSnapshot(page);
        return helpers;
      },

      /**
       * **app 跟 fixture 真的在同一個模擬器命名空間嗎。**
       *
       * 這是整件事唯一會大聲的地方。對不上的話 fixture 把種子塞進 A、
       * app 去 B 讀，於是每一個測試都是「畫面空的」而且**沒有任何錯誤訊息**——
       * 因為「命名空間裡沒東西」跟「這位客戶本來就沒資料」在畫面上長得一樣。
       * 沒有這一支，查起來就只能猜，而猜著猜著會加一層「先等兩秒再試」。
       *
       * 問的是 app **自己載進去的那一份** config（同一個網址 = 同一個模組實體），
       * 不是照著規則在這裡再推論一次。
       */
      async sameNamespace() {
        const seen = await page.evaluate(
          () => import('/js/firebase-config.js').then((m) => m.firebaseConfig.projectId),
        );
        if (seen !== PROJECT_ID) {
          throw new Error(
            `app 跟種子不在同一個模擬器命名空間：app 讀的是 ${seen}，`
            + `種子塞在 ${PROJECT_ID}（第 ${WORKER_INDEX} 號 worker）。`
            + '這種狀況下畫面會全空而且沒有任何錯誤 —— 先檢查 addInitScript 有沒有掛上。',
          );
        }
      },

      /** 換到某一頁，並等它畫完（不再是「載入中…」）。 */
      async go(hash) {
        await page.evaluate((h) => { window.location.hash = h; }, hash);
        await helpers.settled();
      },

      /**
       * 等畫面不再是載入中，**而且不再動了**。
       *
       * 兩件事一起判，因為它們會互相掩護：
       *
       * 1. **不可以停在佔位字上。** `PLACEHOLDERS` 那幾個字是各頁面「還在讀」
       *    時填的。以前這裡只認得「載入中…」，而資料健檢那一頁用的是
       *    **「掃描中…」**（`ui/views/health.js:26`）—— 於是 `03-health-and-counts`
       *    整支讀到的是那三個字。這個洞一直都在，只是被底下那個固定等待
       *    加上 `retries: 1` 蓋著，2026-09-09 兩層墊子一起拿掉才露出來。
       *
       * 2. **要等它不再重畫。** 好幾頁是「先畫出來、數字等資料回來再補」
       *    （`views/calendar.js:161`）。以前這裡是 `waitForTimeout(350)`。
       *
       * 固定 350ms 兩邊都錯：順的時候白等（一次全跑幾百次 `go()`／`signIn()`／
       * `reload()`），慢一拍的時候不夠 —— 那就是「重跑就過」的 flaky 來源。
       *
       * 改成**連續 3 次量到一樣才算穩**。3 是刻意的：`polling` 是 120ms，
       * 所以最快也要 ~360ms 才回得來 —— **不會比原本那 350ms 早**，
       * 而畫面還在動的時候它會一直等下去。降到 2 次（~240ms）會讓
       * 「第二段 render 在 300ms 才到」的那幾頁讀到只畫了一半的畫面
       *（`16-record-task` 的 R3 就是這樣紅的：課程名還沒補上去）。
       */
      async settled() {
        await page.evaluate(() => { window.__e2eSettle = { len: -1, same: 0 }; });
        await page.waitForFunction(
          (marks) => {
            const st = window.__e2eSettle;
            const v = document.querySelector('#view');
            if (!v) { st.same = 0; return false; }
            const t = v.textContent ?? '';
            if (!t.trim() || marks.some((m) => t.includes(m))) { st.same = 0; return false; }
            const now = v.innerHTML.length;
            if (now === st.len) st.same += 1; else { st.len = now; st.same = 0; }
            return st.same >= 3;
          },
          PLACEHOLDERS,
          { timeout: 20_000, polling: 120 },
        );
      },

      /**
       * 等一次寫入真的結束。**取代存檔後那一串 `waitForTimeout(2500)`。**
       *
       * 判準是 `ui/toast.js` 的狀態機：`withSaveState()` 一開始喊
       * 「儲存中…」（`timeout: 0`，不會自己消失），成功換成「已儲存」、
       * 失敗換成「儲存失敗：…」、太久換成「還沒送出去…」。
       *
       * 所以「寫完了」＝ toast 離開「儲存中」。固定等待兩邊都錯：
       * 模擬器順的時候 2500ms 有 2000ms 是白等的，而它慢一拍的時候
       * 2500ms 不夠，接下來那一句斷言就會讀到還沒重畫的畫面。
       *
       * **失敗要大聲。** 以前 `waitForTimeout(2500)` 之後畫面上停著
       * 「儲存失敗：…」，測試照樣往下跑，紅在後面某一句莫名其妙的斷言上。
       */
      async saved({ timeout = 20_000 } = {}) {
        const toast = page.locator('#toast');
        // 先等它進到「儲存中…」。有些路徑（純本機、或者根本沒寫入）快到
        // 看不見那一格 —— 那不是錯，所以短逾時就放過去。
        await toast.filter({ hasText: '儲存中' })
          .waitFor({ state: 'attached', timeout: 3_000 })
          .catch(() => {});

        await expect(toast, '寫入沒有結束 —— toast 還停在「儲存中…」')
          .not.toContainText('儲存中', { timeout });

        const said = (await toast.textContent()) ?? '';
        if (said.includes('儲存失敗')) throw new Error(`寫入失敗了：${said.trim()}`);
        if (said.includes('還沒送出去')) throw new Error(`寫入逾時（PENDING_MS）：${said.trim()}`);

        await helpers.settled();
      },

      /**
       * 等某一層（抽屜、卡片、面板）真的推上來了。
       * **取代點一下之後那一串 `waitForTimeout(700)`。**
       *
       * @param {string} selector 那一層裡面一定會有的東西
       */
      async layer(selector, { timeout = 15_000 } = {}) {
        await expect(page.locator(selector).first()).toBeVisible({ timeout });
      },

      /**
       * 確認抽屜與簽療程單抽屜：每一段都按 ✓（ADR-0110）。
       *
       * 兩張抽屜 2026-09-24 起**預設都沒按**（還沒回／先不結）。不只一段時上面有一顆
       * 「全部 ✓」；只有一段時那一顆不畫，就按那一段自己的 ✓。「全部 ✓」排在列的前面，
       * 所以 `.first()` 拿到的一定是它。
       */
      async tickAll() {
        const first = page.locator('[data-pick-all], [data-pick][data-to="1"]').first();
        await expect(first).toBeVisible({ timeout: 15_000 });
        await first.click();
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
