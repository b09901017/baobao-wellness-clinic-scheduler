// Playwright 設定。
//
// **workers: 1 是必要的，不是保守。** 每一個測試都會把 Firestore 模擬器清空再塞
// 自己那一份資料 —— 兩個測試同時跑就是互相洗掉對方的資料庫。
//
// **headless: false 是刻意的**：她要看得到測試在跑。要在 CI 上跑的話設
// `CI=1`，就會自動轉成無頭並開三個 worker（那時要一人一個 projectId，還沒做）。

import { defineConfig, devices } from '@playwright/test';

const HEADED = !process.env.CI;

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
  retries: 1,
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
    video: 'retain-on-failure',
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
