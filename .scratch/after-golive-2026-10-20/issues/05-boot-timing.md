# 量打開 app 每一段花多久（記在這一台、設定頁看得到）

Status: todo
段：一（high）
動工前先讀：`public/index.html`（「載入中…」、12 秒的保險絲 `__appBooted`）；`public/js/app.js`（`main()`、`watchAuth()` 的四種結果、`booted()`、註冊 `sw.js`）；
`public/js/data/auth.js` 的 `watchAuth()`／`accessState()`；`public/js/data/firebase.js` 的 `initFirebase()`；`public/js/ui/shell.js` 的 `renderShell()`；
`public/js/ui/views/home.js` 的 `render()`（五份 `Promise.all` → `paint(ctx)`）；`public/js/ui/views/settings.js`（「外觀」「打開 LINE 對話」兩張是記在這一台的，`lineMacroCard()` 是寫法的範本）；
`tests/no-dev-words.test.js`、`tests/ui-copy.test.js`（畫面上的字）、`tests/fewer-words.test.js`（常駐說明的 `KEEP`）；`spec.md`「三、打開 app」那一節

## 她要的

> 第一 : 我發現app有時候會載入很慢，尤其是剛打開app的時候，會卡在載入中5 6 秒，有辦法讓app先呈現畫面嗎，一般大神，資深工程師他們這都怎麼解決?，讓使用者使用起來更直覺順暢 ?

> 好，打包照你的建議，量完再決定，開始/kickoff吧

（量出來的數字決定 09 做不做、打包做不做：A＋B＋C 之後「程式」那一格還超過 0.3 秒才打包。）

## 為什麼要先量

`spec.md` 那張表的四格都是讀程式碼估的。**真正慢在哪只有她的手機上量得到**：手機的 CPU、她那裡的網路、Auth 那個 iframe 在手機上才會先載（`_shouldInitProactively`）——
桌機與 headless 都不準。改之前沒有數字，改完就說不出快了多少，也決定不了 09 與打包。

## 做法（方向）

1. 開機那幾個點記時間（`performance.now()`，從 `performance.timeOrigin` 起算），至少：
   - **程式**：`app.js` 開始執行（＝147 支 import 全部到齊）
   - **登入**：`onAuthStateChanged` 第一次回來
   - **權限**：`accessState()` 回來
   - **畫面**：殼畫出來（`renderShell()`）
   - **資料**：首頁第一次 `paint(ctx)`（她看得到數字的那一刻）
   順帶記：這一次程式檔有沒有走 service worker 的快取（`performance.getEntriesByType('resource')` 的 `transferSize`／`deliveryType`，或 `navigator.serviceWorker.controller` 有沒有）、是不是今天第一次打開
2. 記在這一台（`localStorage`，最近 10 次；讀寫都包 `try`，記不住就不記，不影響開機）。**不寫進 Firestore**：那是這一台的事，不是她的資料
3. 設定頁一張小卡（記在這一台，同「外觀」）：最近一次「打開到看得到待辦數字：2.8 秒（程式 1.1・登入 0.9・權限 0.4・資料 0.4）」＋最近幾次的列表。
   **記里程碑的時間點、照先後算差**，不要假設五格接連：07、08 之後各段會重疊（殼比登入早、快取的數字比雲端早），「加起來＝總數」就不成立 —— 卡上印的是「幾秒的時候到了哪一步」，或照先後的差
   字要白話：兩支掃字測試其實**不擋**「auth」「SW」這種字（`no-dev-words` 也不掃 `data/`），要自己守；「程式 1.1」可以、「程式裡」會紅。
   `settings.js` 不在 `fewer-words` 的 `KEEP`／`MUTED_DIM_KEEP` 裡 —— 用 `card__note`、`page__lead`、`muted dim` 都會紅，照「外觀」「打開 LINE 對話」那兩張的寫法（說明收進 `tip()`）
   **只有從首頁打開的那幾次才算到「資料」**（從別頁網址打開的那一次只記到「畫面」）
4. 只在正常開機那條路記：登入頁、沒有權限、連不上那三種畫面不記（不然平均被拉歪）

## 判準

- E2E（新的 spec 或 `24` 那種量版面的）：打開首頁 → 設定頁那一張卡看得到五個里程碑、照先後遞增、最後一個等於總數；`localStorage` 擋掉（init script 讓它丟例外）→ 照樣開機、卡上寫「這一台記不住」
- 記時間的程式**一行都不擋開機**：拿掉那一張卡、`localStorage` 壞掉，開機的時間與流程不變
- 保險絲（`__appBooted`）的時機不變
- **她的手機上**（驗收清單）：staging 關掉 app（從多工畫面滑掉）→ 打開，重複 5 次（含一次隔了一小時以上再開）→ 設定頁那一張卡截圖給我（數字裡沒有客戶名字，截圖可以給）

## 連動

- `sw.js` 的 `VERSION`（同一段 01 升過就不用再升）
- 這一張卡是 06～09 的驗收工具：那幾支的判準都寫「她手機上改之前／改之後的數字」
