# 程式檔先用手機裡的、背景下載新版、「有新版本・點一下更新」

Status: done
段：三（high）
動工前先讀：`public/sw.js` 全部（檔頭的策略、`SHELL`、`install` 的 `skipWaiting()`、`activate` 清舊快取＋`clients.claim()`、`networkFirst()` 的 3 秒逾時）；
commit `0ae20497`（2026-08-18 改成網路優先的理由：部署後打開先看到舊版，要再重新整理一次）；`public/js/app.js` 最後註冊 `sw.js` 那一段；
`tests/shell-cache.test.js`；E2E `10-offline.spec.js`（**唯一開著 service worker 的 spec**，`playwright.config.js` 其餘一律 `serviceWorkers: 'block'`）、`61` 的 headers 那一條；
`firebase.json` 的 headers（`no-cache`）；`docs/STAGING.md`「上線檢查表」那幾句「部署後確認新版真的在跑」；`CLAUDE.md`「`public/` 底下任何檔案」那一列（`SHELL` 與 `VERSION`）；`lessons.md` 九

## 她要的

> 第一 : …會卡在載入中5 6 秒，有辦法讓app先呈現畫面嗎…

> 2. …回答你問的問題 : 照你的建議：跳一條「有新版本・點一下更新」

（她選的是「跳一條、點一下更新」，不是「下次打開自動換、不提示」，也不是「當下自動重新整理」—— 後者可能打斷她正在打的字。）

## 為什麼會這樣

- `sw.js` 對自己的檔案是網路優先：每一支（147 支）都先 `fetch()`，`firebase.json` 給 `no-cache` → 每一支都要跟伺服器確認一次（304），import 排 5 層 → 至少 5 趟來回才開始跑
- 8/18 改成網路優先的理由是對的（快取優先＋自動 `skipWaiting()` → 打開的那一次是舊版、要再整理一次才新）—— 那次缺的是「有新版本」的提示，不是快取優先本身

## 做法（方向）

1. 自己的檔案改**快取優先**（`SHELL` 照 `VERSION` 整份預先快取，換版是**整份一起換**，不會新舊混著 —— 過目查過整個 `public/` 沒有任何 dynamic `import()`）；
   打開 app 的導覽請求回快取的 `/index.html`，**但 `/form.html`（客戶填表那一頁，ADR-0031）不可以被這一條吃掉**。快取沒有的才走網路
2. **Firebase SDK 與字體要換一個不跟著版號清掉的快取**（過目查到）：現在它們存在同一個 `shell-vN`（`sw.js:239` 的 `fetchAndCache()`），`SHELL` 又不含 gstatic，
   換版時 `activate` 把舊快取整個刪掉 → SDK 跟著不見 → **換版後第一次離線打開會開不起來**。這個洞今天就在（網路優先＋`skipWaiting()` 也一樣刪），這一支順手補：
   SDK 與字體放自己的快取（網址帶版號、內容不變，不用跟著清；換 SDK 版本時舊的那幾支留著也只是佔一點空間 —— 或在 `activate` 只清不在用的網址）
3. 新版本：瀏覽器打開時自己會去比 `sw.js`（`no-cache`）→ 不一樣就在背景裝新的（下載新的 `SHELL`）。裝好之後**不要自己接管**（拿掉 `install` 的 `skipWaiting()`），
   讓頁面知道「有新版本在等」→ 畫面底下跳一條「有新版本・點一下更新」→ 她點 → 叫等著的那一個 `skipWaiting()` → `controllerchange` → `location.reload()`
   - 那一條**不擋任何操作**、可以收掉
   - **收掉之後會怎樣**（過目更正）：所有視窗關掉時，等著的新版會自己啟用 → 下次打開（從多工畫面滑掉再開）就是新的。只有 app 一直開著才會停在舊版、照樣看得到那一條。ADR 照這個寫
   - **第一次安裝時 `clients.claim()` 也會觸發 `controllerchange`** → 要擋（只有「本來就有一個 controller、她按了更新」才重新載入），不然第一次打開就會自己重新載入一次
   - 跟 toast、釘住的條、懸浮鈕搶底部那一塊：照 `CLAUDE.md`「貼在畫面底部的東西」那一列，**量位置**（`elementFromPoint()`）
4. **忘了升 `VERSION` 的代價變大**：以前是「慢一輪」，改完是「永遠停在舊版」（快取優先、`sw.js` 沒變就不會裝新的）。要有一道自動的擋。
   **CI 是 checkout 深度 1、拿不到 `origin/develop`**（過目查到）—— 拿 git 比會永遠跳過。建議：提交一份「`SHELL` 每一支的內容雜湊 ＋ `VERSION`」的快照，
   測試重算比對：內容變了、`VERSION` 沒變 → 紅；兩個都變了 → 叫你更新快照（換行符先統一，見 `lessons.md` 的 CRLF 那一條 —— 本機 Windows 是 CRLF、CI 是 LF）
5. **逃生門**：設定頁一顆「重新下載程式」（清掉這一台的程式快取、重新整理；不碰 Firestore 的資料快取）—— 萬一卡在舊版時不用叫她清瀏覽器資料

## 判準

- E2E `10`（開著 service worker 的那一支）多幾條：
  - 第二次打開時，程式檔**沒有**打到網路（看 `response.fromServiceWorker()`；Playwright 攔不攔得到瀏覽器去比對新版 `sw.js` 的那一下，要先驗過）
  - 換版之後**離線**打開 → 打得開（SDK 還在 —— 第 2 點那個洞的紅燈：改之前就是紅的）
  - 第一次安裝（沒有 controller）→ 頁面不會自己重新載入
  - 打開 `/form.html` → 拿到的是填表那一頁，不是 app
  - 改一個檔案＋升 `VERSION`（測試裡換一份 `sw.js` 回應）→ 重新打開 → 跳「有新版本」那一條 → 點 → 頁面重新載入、跑的是新的那一份；**沒點之前**畫面上的程式是舊的、可以照常操作
  - 離線打開照舊打得開（原本那幾條照舊綠）
- 換版的那一刻不會新舊混著：新的 `SHELL` 沒下載完整 → 不算裝好（`install` 失敗就不換）。現在 `install` 是 `Promise.allSettled()`（個別失敗不擋）—— 改成快取優先之後這個寬鬆要重想：少一支就是那一支永遠走網路，還是整份不換？寫進 ADR
- 忘了升版號的那一道擋：只改 `public/js/app.js` 一個字、不升版號 → 紅（本機與 CI 都要紅，不可以「拿不到就跳過」）
- 新的 ADR：推翻 8/18 的網路優先（那次沒有 ADR，寫清楚是 commit `0ae20497` 與 `sw.js` 檔頭那一段）、寫「有新版本」那一條的行為與為什麼不自動換
- **她的手機上**：05 那一張卡「程式」那一格改之前／改之後（staging）

## 連動

- `docs/STAGING.md` 上線檢查表：部署之後要在手機上點一次「有新版本」才看得到新版（那幾句「部署後確認新版真的在跑」要改）
- `docs/常見問題.md`：補「為什麼跳出『有新版本』」「更新之後還是舊的」兩題（後者的怎麼辦＝設定頁「重新下載程式」）
- `lessons.md` 九：「明明改好了卻沒變」多一個原因（沒點更新、或忘了升版號）
- `CLAUDE.md`「`public/` 底下任何檔案」那一列：忘了升 `VERSION` 的代價改了、有一道擋了
- `sw.js` 的 `VERSION`（這個 PR 第一個動 `public/` 的升；跟段二搶的話照 `CLAUDE.md` 那一列：留大的）

## 做完時留下的

- `sw.js`：`SHELL` 照 `VERSION` 整份裝（`addAll()` ＋ `cache: 'reload'`，少一支整份不換）、**不 `skipWaiting()`**（`message` 收到 `skipWaiting` 才換）、
  打開 app 的導覽只有 `/`、`/index.html` 回手機裡的（`APP_PAGES`；`/form.html` 與 `/__/auth/…` 照舊走網路 —— 後者是過目沒提到的：
  Google 登入轉回來那一頁也在同一個網域）、讀的是**指定的那一格**（新版裝好、還沒換的那段時間舊的那一頁拿舊的）。
  SDK 與字體在 `external-v1`，`activate` 只清 `shell-*`；換到這一版的那一次從舊的那一格搬過來（`adoptExternals()`）
- 頁面那一側 `ui/swUpdate.js`：`register()`（排在 `main()` 之前 —— `main()` 壞掉的那一版，修好的那一版照樣要裝得進來）、`onUpdateReady()`、
  `applyUpdate()`（按了才在 `controllerchange` 重新載入）、`redownload()`（設定頁）。回到 app（`visibilitychange`）時 `reg.update()`
- **那一條放在最上面，不是底下**（跟方向第 3 點不一樣）：底部有導覽列、toast、懸浮鈕、釘住的條四樣在搶；放在 `.app__body` 的最上面
  （手機在離線那一條底下、iPad 橫放在側邊那一欄右邊 —— 放在 `.app` 那一層的話 iPad 上 `.app` 是橫排，會變成一條直的），在文件流裡不蓋任何東西。
  綠底（`--accent`）白字（`--accent-text`），整條是一顆按鈕、右邊 × 收掉。E2E `81` P4 用 `elementFromPoint()` 量點得到
- 忘了升版號的擋：`scripts/shell-snapshot.mjs`（`npm run shell:snapshot`）＋`tests/shell-version.snapshot.json`＋`tests/shell-version.test.js`。
  雜湊的是 `git ls-files public` 每一支（文字檔 CRLF → LF、`sw.js` 拿掉 VERSION 那一行）。**同一個 VERSION 只能對一份內容**，所以同一支 PR 裡第二次動 `public/` 也要再加一 ——
  `CLAUDE.md` 那一列的「後面的不用再升」改掉了。**這一段例外**：快照是這一段才有的、v202 還沒部署，07、08 的 commit 重產快照時先刪掉再跑（段四之後照新規矩加一）
- 設定 →「程式」→ 重新下載程式（確認框）：unregister ＋ 清 `shell-*` ＋ 重新整理
- **E2E 攔不到瀏覽器去比對 `sw.js` 的那一下**（`context.route('**/sw.js')` 一次都沒被叫到，量過）。所以 `81` P4 用 `register('/sw.js?e2e=next')`
  造出「新的一版在等」（網址不一樣就是新的一版）、新版的 `index.html` 攔得到（service worker 自己去抓的那一下攔得到）。
  換 VERSION 時清哪幾格、留哪幾格、少一支整份不換：`tests/sw-cache.test.js` 拿假的 `caches` 跑 `sw.js` 本身（`vm`）
- 判準那幾條：P1 第二次打開 service worker 一支程式檔都沒打到網路（安裝時量得到 161 支，所以不是量不到）、P2 第一次安裝不重新載入、P3 `/form.html`、P4 那一條／點了才換／換完離線打得開
- 「換版之後離線打開 → 改之前是紅的」沒有在 E2E 重現（造不出換 VERSION）；`sw-cache.test.js` 的「換版」那一條在舊的 `sw.js` 上會紅（舊的整格刪、而且 `skipWaiting()`）
- 驗收：`npm test` 5197 全綠；E2E `00`、`10`、`79`、`81` 15 支全綠（`CI=1`）。`app.js`、`shell.js` 是 GLOBAL → 全量丟 CI（段三最後）
- 第一次安裝之後**第一次離線打開**可能還是缺 SDK（第一次載入時 service worker 還沒接手，SDK 沒經過它）—— 改之前就是這樣、`10` 的 O3 兩種結果都收；
  第二次打開之後就在了。沒有把 SDK 的網址列進 `install`（那一份會跟 `firebase.js` 的版本各寫一次）

