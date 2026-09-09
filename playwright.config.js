// Playwright 設定。
//
// **workers: 1 是必要的，不是保守。** 每一個測試都會把 Firestore 模擬器清空再塞
// 自己那一份資料 —— 兩個測試同時跑就是互相洗掉對方的資料庫。要平行跑得先讓
// 一個 worker 一個 projectId（三個地方要同時改，見 `tests-e2e/fixtures/emulator.js`）。
// **`CI=1` 不會開多個 worker** —— `workers` 是寫死的 1。
//
// **預設無頭，headed 要自己開。** headed + `slowMo: 80` 讓全跑從 12 分鐘變成
// 25 分鐘（.artifacts/results.json 量的），日常改一行程式付不起這個代價。
// 要親眼看測試在跑：`npm run test:e2e:watch`。

import { defineConfig, devices } from '@playwright/test';

// 有 HEADLESS 或 CI 就無頭。npm 那幾條路一律經過 `scripts/e2e.mjs`，
// 它會設 HEADLESS=1（`--watch` 那條不設）。
const HEADED = !process.env.CI && !process.env.HEADLESS;

export default defineConfig({
  testDir: './tests-e2e/specs',
  outputDir: './.artifacts/test-results',
  timeout: 180_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
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
    baseURL: 'http://127.0.0.1:5000',
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
