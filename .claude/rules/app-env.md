---
paths:
  - "public/js/app.js"
  - "public/js/firebase-config.js"
  - "public/js/data/auth.js"
  - "public/js/data/firebase.js"
  - "public/js/data/backup.js"
  - "public/js/ui/bootTiming.js"
  - "scripts/restore-backup.mjs"
  - "tests-e2e/project-id.mjs"
  - "tests-e2e/start-emulators.sh"
  - ".github/workflows/**"
  - "firebase.json"
---

# 打開 app、環境、部署、備份

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 哪個網址算哪個環境

- 只寫在 `public/js/firebase-config.js` 的 `envOf()`。
- **模擬器那一份的 `projectId` 是算出來的，不是寫死的**：唯一的推導是同一支檔案的 `projectIdFor(worker)`，三邊都呼叫它 —— `tests-e2e/start-emulators.sh`（經 `tests-e2e/project-id.mjs`，bash import 不動 ES module）、`tests-e2e/fixtures/emulator.js` 的 `PROJECT_ID`、以及 app 自己（讀 `window.__E2E_WORKER`，E2E 用 `context.addInitScript()` 塞）。
- **不要在任何一邊寫死一份 `demo-` 字串** —— 對不上的症狀特別壞：fixture 塞進 A 命名空間、app 讀 B，每個 E2E 都是「畫面空的」而且**沒有錯誤訊息**。
- `tests/env.test.js` 盯著三邊算的是同一支（而且真的跑一次 shell 那條路），`app.sameNamespace()` 在每次登入後再問一次。
- 環境設定與部署指令見 `docs/STAGING.md`。
- **登入走的網域也照網址算**（`authDomainFor()`，ADR-0168：自己的網址就用自己的，iPad 主畫面那一顆才登得進去）—— 多一個網址（自訂網域）要先在 Google Cloud 的 OAuth 用戶端登記 `/__/auth/handler`，不然連瀏覽器分頁都登不進去

## `data/backup.js` 的 `exportAll()` 加一個集合

- `scripts/restore-backup.mjs` 的 `SECTIONS` 要跟著加一列，否則還原完會**少一整類資料**，而且要等到她去找那一類東西才會發現（`notes` 與 `events` 已經被漏掉過一次，見那支檔案的檔頭；`playbooks` 是 2026-09-03 加的，兩邊同時加）。
- `tests/restore-backup.test.js` 盯著兩邊。
- **一份文件**（`settings`＝`config/app`、`aiConfig`＝`config/ai`，2026-11-07）**不進 `SECTIONS`**、在 `checkCoverage()` 的名單上另外寫 —— 放進去的話 plan 裡多一個 `config` 路徑，`--wipe` 會把 config 底下不在備份裡的每一份（含那一份設定）標成已刪除

## 打開 app 那一段（`app.js` 的 `main()`、`auth.js`、待辦首頁的 `render()`）

- **先用手機裡的**（ADR-0167）：這一台上次通過白名單（`auth.js` 記的 uid）就**不等登入先畫殼**，登入回來不是同一位／沒有權限／被登出才換掉、記的那一筆一起清；連不上而殼就是這一位的留著。
- **殼可能畫第二次**：掛在 `#root`、`window` 上的監聽要先拆或只掛一次（`router.start()`、`shell.js` 的 `wireBackLinks()`、離線那一條、「有新版本」那一條、`watchSystemTheme()`）；**殼換成登入頁時也要拆**（`renderGate()` 先 `unmountShell()` —— 登入頁沒有 `#view`，路由還掛著的話換網址就是 TypeError）。
- `freshView()` 換頁時不抄上一頁掛在 `#view` 上的 `data-*`（段四審查）。
- **寫入的稽核等登入回答了才記是誰**（`repo.commit()` 的 `authStateReady()`；Rules 只收 `actor == 她的 uid`）。
- 待辦首頁先讀快取（`listCached()`，**先問 `confirmedAsRemembered()`** —— 快取不經過 Rules）、雲端回來不一樣才重畫，**換同一個 `ctx` 的內容**。
- **E2E 的「登入好了」是 `#root[data-access="allowed"]`**（不是 `.app__nav` —— 殼在確認之前就在了），`settled()` 把首頁停在快取那一份（`#view[data-home-data="cache"]`）算成還沒畫完；量開機（`ui/bootTiming.js`）的總數是她等到的那一步。
- **登入那一塊開機不載**（ADR-0173）：`firebase.js` 用 `initializeAuth()` 不帶 `popupRedirectResolver`（帶了或換回 `getAuth()`，iPad／手機／Safari 一打開就先載 Google 的腳本與 iframe），`signIn()` 自己帶；轉頁回來那一次由 `watchAuth()` 先 `getRedirectResult()` 再開始聽；iPad／手機／Safari 的分頁走轉頁（彈窗趕不上同步開窗）。
- `tests/auth-no-proactive-iframe.test.js`、E2E `81` 的 P14（iPad 的 UA）。E2E `81`

## `firebase-tools` 的版本

- 部署 Firestore 那一步**釘在 13**。
- 14 開始會先問 serviceusage「API 開了沒」，而正式專案的服務帳號沒有那個權限 —— 升上去正式環境就 403（Hosting 照樣成功，所以看起來不像版本問題）。
- 要升先照 `docs/STAGING.md` 補 IAM 角色
