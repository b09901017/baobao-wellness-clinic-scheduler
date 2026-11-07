---
paths:
  - "tests-e2e/**"
  - "scripts/e2e.mjs"
  - "scripts/e2e-changes.mjs"
  - "playwright.config.js"
---

# E2E：挑哪幾支、多組模擬器、等待的寫法

根目錄 `CLAUDE.md`「測試怎麼跑」的細節。那一節講的規則照舊（`npm run verify`、不全跑、登記 `related.js`、起模擬器的目錄、`E2E_WORKERS`、不用固定等待），這裡只放怎麼做與為什麼。

## 「這次改動」怎麼算

- 「這次改動」是**上一次 verify 全綠之後動過的**，而且只跑跟 develop 也不一樣的那幾支（`scripts/e2e-changes.mjs`，2026-10-16 以前是整條分支，一輪後段每次都幾乎全跑）。
- **比的是 GitHub 上那一份**（先 `git fetch` 再比 `origin/develop`，2026-11-04；本機的 `develop` 不會自己跟上）。
- 要整條分支重驗一次：`node scripts/e2e.mjs --related --base origin/develop`。

## 哪幾支算「相關」（`tests-e2e/related.js`）

- 只寫在 `tests-e2e/related.js`；只被別人 import 的檔案進 `FOLLOWS`（`tests/e2e-related.test.js` 盯著）。
- `pick()` 認不出來的檔案**一律退回全跑** —— 漏列的代價是多跑幾支，不是安靜地少跑一支。
- **`ui/views.js` 只多了一頁的登記**（一行都沒刪、加的只有 `import * as X from './views/…'` 與完整的 `register()`）時，交給 `pick()` 之前換成那一頁、加上網址撞得到的既有那幾頁（`scripts/e2e-changes.mjs` 的 `narrowViews()`，2026-10-19）；其餘照舊全跑。
- **`app.css` 每一條動到的規則都只指著某一個元件的 class**（`.abl-*`、`.giftfold*`…，那一組 class 與畫得出它的檔案只寫在 `related.js` 的 `CSS_SCOPES`）時，只挑看 CSS 而且摸得到那個元件的那幾支（`narrowCss()`，2026-11-03；比的是規則不是行，搬位置、混著共用 class、`@keyframes` 照舊整份）。
- **新的一組 class 被別的檔案也拿去用，要加進那一組的 `owners`**（`tests/e2e-css-scopes.test.js` 掃 `public/` 盯著）。

## 幾個 worker、多組模擬器

- **幾個 worker 由 `E2E_WORKERS` 給，沒設就是 1**（CI 照舊 1、靠六台切）。
- 她的兩台都設 2：家裡與雲端 VM 的 `~/.claude/settings.json` 的 `env`（2026-11-04 她說的；同一個對話開的模擬器與 E2E 才拿到同一個值）—— VM 量過全量 2 個 33 分最划算、3 個只再快 3 分而紅的多；家裡 10/29 量 10 個檔 2 個 3.5 分、CPU 平均約 3 成。
- 筆電的規則是不要長時間跑滿（10/2 過熱斷電過），不是鎖成 1。
- 大於 1 時**一個 worker 一整組模擬器**：模擬器與 E2E 要帶同一個值（`E2E_WORKERS=2 npm run emulators`、`E2E_WORKERS=2 npm run verify`），第 k 組的 port 是 `firebase-config.js` 的 `emulatorPortsFor(k)`（平常的 port 加 `20000+10k`，平常那一組開著也跑得起來）、專案是 `projectIdFor(k)`、Hosting 只開在 0 號組；接法在 `tests-e2e/emulator-groups.mjs`，兩邊值對不上 `app.sameNamespace()` 會大聲講。
- **新增一處連模擬器的程式要讀 `emulatorPorts`／fixture 的 `PORTS`、`APP_ORIGIN`、`FIRESTORE_ORIGIN`，不寫死 port**（`tests/env.test.js` 掃 fixture 與 spec）。
- 收掉照那幾組的 port 停（`node tests-e2e/emulator-groups.mjs stop`），平常的 port 不碰。

## 等待的寫法

- 等 locator 的狀態：`app.layer(選擇器)` 等一層推上來、`app.saved()` 等一次寫入結束（讀 `ui/toast.js` 的狀態機，寫失敗會大聲）、`app.settled()` 等一頁畫完。
- 固定等待（`page.waitForTimeout()`）兩邊都錯 —— 順的時候白等，慢一拍的時候讀到還沒重畫的畫面，而**兩種症狀都不指向那一行**。
- `tests/e2e-waits.test.js` 盯著，還沒清完的那幾支在它的 `PENDING` 裡而且只准變短。
