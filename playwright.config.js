// Playwright 設定。
//
// **一個 worker 一個模擬器命名空間。** 每一個測試都會把 Firestore 清空再塞自己
// 那一份資料，所以兩個 worker 共用一個命名空間就是互相洗掉對方的資料庫 ——
// 以前 `workers: 1` 正是唯一的隔離手段。現在隔離改由 projectId 做：
// `public/js/firebase-config.js` 的 `projectIdFor(worker)` 是**唯一的推導**，
// app、E2E fixture、`start-emulators.sh` 三邊都呼叫它（`tests/env.test.js` 盯著）。
//
// 一顆 Firestore 模擬器本來就裝得下多個 projectId，但幾個 worker 共用一顆會搶 CPU
// （見底下 `workers` 那一段），所以**平行跑的時候一個 worker 一整組模擬器**（`E2E_WORKERS`，
// `tests-e2e/emulator-groups.mjs`；port 的推導是 `firebase-config.js` 的 `emulatorPortsFor()`）。
//
// **預設無頭，headed 要自己開。** headed + `slowMo: 80` 讓全跑從 12 分鐘變成
// 25 分鐘（.artifacts/results.json 量的），日常改一行程式付不起這個代價。
// 要親眼看測試在跑：`npm run test:e2e:watch`。

import { defineConfig, devices } from '@playwright/test';

import { emulatorPortsFor } from './public/js/firebase-config.js';
import { groupedFrom, workersFrom } from './tests-e2e/emulator-groups.mjs';

// 幾個 worker（見底下 `workers` 那一段）。不合法的值在這裡就丟例外，不會安靜地退回 1
const WORKERS = workersFrom(process.env.E2E_WORKERS);

// 有 HEADLESS 或 CI 就無頭。npm 那幾條路一律經過 `scripts/e2e.mjs`，
// 它會設 HEADLESS=1（`--watch` 那條不設）。
const HEADED = !process.env.CI && !process.env.HEADLESS;

export default defineConfig({
  testDir: './tests-e2e/specs',
  outputDir: './.artifacts/test-results',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  // `fullyParallel: false` ＋ 多個 worker ＝ **同一支檔案裡照順序跑、不同檔案之間平行**。
  // 檔案內平行沒有意義：同一支裡的測試共用不了資料庫（各自清空），只會多搶 CPU。
  fullyParallel: false,
  // **還是 1，但已經不是因為資料會互相洗掉了。**
  //
  // 隔離做好了（一個 worker 一個 projectId，見檔頭），2026-09-09 實測 3 個
  // worker 全跑：**183 過、10 紅、14.2 分鐘**，對照 1 個 worker 的
  // **193 過、0 紅、23.9 分鐘**。快 40%，但那 10 支紅得沒有價值。
  //
  // **10 支沒有一支是資料串台** —— 命名空間是好的。全部是搶 CPU 搶出來的：
  //   7 支「app 根本沒載起來」（`page.goto` 30 秒逾時、等不到 `[data-signin]`
  //     或 `.app__nav`、Firestore 說 client is offline）
  //   3 支「畫出來了但第二段 render 還沒到」（16-record-task 的 R3 就是
  //     `settled()` 註解裡寫的那個金絲雀：課程名還沒補上去）
  //
  // 所以要開平行，得先解掉這兩件事本身，而不是把 `settled()` 的次數往上加
  // 或把 retries 打開 —— 那是拿墊子蓋住訊號，而 CLAUDE.md 說固定等待兩邊都錯。
  // 真正的瓶頸有兩個：那一顆 Firestore 模擬器（單一 Java 行程），以及 app 的
  // Firebase SDK 是每個測試都從 gstatic CDN 重載一次（worker 越多越容易載不到）。
  //
  // **2026-11-04 起可以一個 worker 一整組模擬器**（`E2E_WORKERS=N`，見 `tests-e2e/emulator-groups.mjs`）：
  // 搶的那一顆 Java 行程一人一顆，客廳 e2e-speed 10/29 的實驗 2／3 個 worker 都全過。
  // **沒設就是 1**（家裡的筆電不能長時間滿載，10/2 過熱斷電過）；模擬器也要用同一個值開
  // （`E2E_WORKERS=N npm run emulators`），對不上時 `app.sameNamespace()` 大聲講。
  workers: WORKERS,
  // **1 次重試**：headed 模式下長時間跑會把 Windows 的桌面堆疊吃光
  // （worker 會以 0xC0000142 掛掉），負載一高固定等待就不夠。
  // 真的 bug 會連續失敗兩次，照樣紅 —— 重試只救得了環境造成的抖動。
  //
  // **本機無頭時不重試**：那個桌面堆疊的問題是 headed 才有的，而日常驗收要的是
  // 「壞了立刻知道」—— 重試會讓一支真的紅掉的測試跑兩次，代價是加倍的等待。
  // CI 照樣重試（那裡在意的是 flaky 不要擋住合併）。
  retries: (HEADED || process.env.CI) ? 1 : 0,
  reporter: [
    ['list'],
    ['html', { outputFolder: '.artifacts/report', open: 'never' }],
    ['json', { outputFile: '.artifacts/results.json' }],
  ],
  use: {
    // Hosting 只開在一組上：一個 worker 一組時是 0 號組（`emulatorPortsFor(0)`），平常是 5000
    baseURL: `http://127.0.0.1:${emulatorPortsFor(groupedFrom(process.env.E2E_WORKERS) ? 0 : null).hosting}`,
    // **一定要設。** Playwright 的 click()／fill() 預設是「不逾時」，
    // 所以一個選錯的選擇器會安靜地吃滿整個 test timeout（180 秒），
    // 一支 6 個測試的檔案就跑掉 18 分鐘而且看不出是哪一行卡住。
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    // 慢一點才看得到。純粹為了「她看得到測試在跑」，不影響判定。
    launchOptions: HEADED ? { slowMo: 80 } : {},
    headless: !HEADED,
    // 每一個測試都錄影 + trace 會把資源吃光（見上面 retries 的說明）。
    // 失敗的那幾個照樣留得下完整證據。
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 錄影是**每一個測試都在錄**（只有失敗的留下來），所以它的代價是全部要付的。
    // 本機無頭那條路關掉：trace 有 DOM 快照與逐步截圖，查一個本機的失敗夠用了。
    // 要影片：`npm run test:e2e:watch`，或設 `VIDEO=1`。
    video: (HEADED || process.env.CI || process.env.VIDEO) ? 'retain-on-failure' : 'off',
    // Service worker 會把 app 殼快取起來，測試之間就吃到舊的。
    // 離線那幾支要測 SW 時再自己開回來。
    serviceWorkers: 'block',
    // 她的主力是手機。預設就用手機尺寸跑，寬螢幕另開 project。
    viewport: { width: 414, height: 896 },
    deviceScaleFactor: 2,
    hasTouch: true,
    locale: 'zh-TW',
    timezoneId: 'Asia/Taipei',
  },
  projects: [
    {
      name: 'phone',
      use: { ...devices['Desktop Chrome'], viewport: { width: 414, height: 896 }, hasTouch: true },
    },
    {
      name: 'ipad',
      testMatch: /.*\.wide\.spec\.js/,
      use: { ...devices['Desktop Chrome'], viewport: { width: 1024, height: 768 }, hasTouch: true },
    },
  ],
});
