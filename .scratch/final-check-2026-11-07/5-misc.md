# 上 main 前最後健檢・第 5 組：其餘的 app 改動、工具、文件（2026-11-07）

查的版本：`develop` `a8081e6b`（這個 worktree 的 HEAD）。範圍：#203、#214、#215、#199、#205、#206、#217、#223、#200（#203 的 issue 05 是第 3 組查的，這裡不查）。

**只查、只寫報告**：沒改 app 的程式、沒 commit、沒 push。
本機模擬器起過一組（`E2E_WORKERS=1`、平常的 port，起之前 port 都是空的），只塞 fixtures 的假資料（客戶A／客戶B），用完停掉、port 都空了。
**沒有讀正式站或 staging 的任何資料**（guard 跳出「碰了 Firebase」是因為讀了 `public/js/data/firebase.js` 這支原始碼）。

---

## 一、合進 main 之前建議修

**沒有要在上 main 前修的程式問題。**

只有一件實機要點的步驟建議補進清單（不是程式問題）：

| | 內容 |
|---|---|
| 建議多點一條 | **Android 手機主畫面那一顆**：設定 → 登出 → 登入 → 跳到 Google 選帳號 → 回到 app 是登入好的 |
| 為什麼 | #215 改了「轉頁登入回來那一次由誰收」（以前是 SDK 開機時自己收，現在是 `data/auth.js` 的 `watchAuth()` 先叫 `getRedirectResult()`）。Android 主畫面那一顆**一直都是走轉頁**，所以它也走這條新的路。PR #215 的手動清單第 3 條只寫 iPad、第 4 條手機只寫「照常打開、照常拍照」 —— 已經登入著的手機不會走到登入那一段 |
| 我驗到哪裡 | 本機模擬器用 Android 手機的 UA 在分頁裡走過「登出 → 轉頁登入 → 回來」（下面 L1），過了。裝到主畫面的全螢幕那一顆離開 app 去 Google 再回來的那一段，只有實機看得到 |
| 壞了會怎樣 | 登出之後在那一台登不回去 —— 她整天用不了 app。所以值得在 staging 上點一次（iPad 那一條本來就要點） |

---

## 二、可以之後再做

### 1.「跟客人確認時間」的記一句，連按兩下「記」→ 隨手記長兩筆（正式站本來就有）

- **PR／檔案**：不是這一輪的 PR（`855ecc75`，早就在 main 上）。`public/js/ui/views/home.js:3469` 那一個 `withSaveState(...)` 沒有 `key`；`tests/save-guards.test.js` 的 `ALLOWED` 有一條豁免指著它
- **看到什麼**：豁免的理由寫「`setFollowupNote` 是 update 不是 create —— 存兩次結果一模一樣」，可是同一個呼叫裡還有 `notesData.create(...)`（那一句也放進隨手記）。寫之前的去重（`sameOpenNote(await openNotesFor(...))`）是先讀再寫，連按兩下時兩趟都讀到「還沒有」
- **怎麼重現**（本機模擬器、假資料）：
  ```
  E2E_WORKERS=1 npm run emulators            # 另一個終端機
  E2E_WORKERS=1 HEADLESS=1 npx playwright test --config .scratch/final-check-2026-11-07/pw.config.mjs repro-followup-note-twice
  ```
  實際輸出（跑了兩次，兩次一樣）：
  ```
  F1 連按兩下之後「禮拜一再問問」的隨手記有 2 筆
    Expected: 1
    Received: 2
  ```
- **為什麼重要（不大）**：待辦首頁、客戶詳情多一筆一模一樣的隨手記，她要自己刪一筆。來訪、次數、任務都不會錯。#203 修 11/4 健檢 #2、#4 時問的「還有哪一顆會建資料卻沒防連按、豁免還成立嗎」—— 答案就是這一條：**豁免的理由已經不成立**
- **建議怎麼修**（約 3 行）：那一個 `withSaveState` 加 `key: \`followupNote:${customerId}\``（第二下接到同一趟），拿掉 `ALLOWED` 那一條。修完 F1 會綠

### 2. 轉頁登入（她手機與 iPad 的登入路）沒有任何一支 E2E

- E2E 的 `phone`／`ipad` 兩個 project 都是 `devices['Desktop Chrome']`（`playwright.config.js:101-110`），fixture 永遠走彈窗；`81` 的 P14 是登入好之後才換 iPad 的 UA。所以 #215 之後她每一台的登入路（主畫面那一顆＋手機／iPad／Safari 的分頁）在 CI 上一次都沒跑過
- 這一次寫的 `repro-login-redirect.spec.js` 的 L1～L3（Android 分頁登出再登入、iPad 自稱 Macintosh、登入到一半按返回）一支約 3～6 秒，可以照搬進 `81`
- 好處：之後動到 `auth.js`／`firebase.js`／SDK 版本時，「登入之後回不來」這種讓她整天用不了的錯，CI 先抓到

### 3. 轉頁回來那一下 iframe 載不到：先跳「載入失敗」一分多鐘以上，按「重新載入」才回到登入頁

- **看到什麼**（L4）：轉頁登入回來時把 `/emulator/auth/iframe` 擋掉 → `getRedirectResult()` 128 秒都沒回答，`watchAuth()` 一直不開始聽；12 秒時 `index.html` 的保險絲畫出「載入失敗：程式檔案沒有下載完成…」＋「重新載入」。按它 1.2 秒回到登入頁（`pendingRedirect` 那一格第一次讀就清掉了，所以不會一直卡）
- **不是 #215 弄壞的**：照 SDK 原始碼，#215 以前 `getAuth()` 在手機上把同一個 iframe 包在開機那一段（`_initializationPromise`）裡等 —— 同樣的情況一樣卡，而且是**每一次開機**都等；現在只剩轉頁回來那一次
- 什麼時候會遇到：轉頁回來那一兩秒剛好斷網（ADR-0168 之後 iframe 跟 app 同網址，那一種原因沒了）。很少
- 想改的話（約 10 行）：`finishRedirect()` 等最多 10 秒就放行，收不下來時講一句「登入沒有完成，再按一次登入」；順便把 `getRedirectResult()` 的錯誤講出來（現在一律吞掉 —— 例如換網域忘了登記 redirect URI 時，她只會看到又回到登入頁、一句話都沒有；#215 以前也是吞掉的）

---

## 三、查過沒事的

### #203 第一輪小修

| 查了什麼 | 怎麼查的、結果 |
|---|---|
| 01 來訪編輯器按下去那一刻重讀 | `visitEditor.js:1828-1836` 的 `refreshCustomerVisits()` 拿掉了提前 return，每一次 `listWhole()`；`submit()` `:1648` 先重讀再驗證、存檔，撞期用的那一天也重讀（讀不到沿用，只影響提醒）；`cancelOneSlot()` `:1862` 也走它。拿掉的 `isWholeList`／`lastReadWhole` 全庫沒有別人用（grep 只剩 `tests/incomplete-read.test.js` 的 `doesNotMatch`）；拿掉的 `isOffline` import 在這支檔案已經沒有任何一處用 |
| 01 同一個形狀：還有沒有存檔路沿用打開時讀的來訪 | 九個 `visitsData.save(` 的呼叫端逐一對：`relinkFollowup.js:36→64`、`bulkCancel.js:577→659`、`calendar.js:1199→1276`、`home.js:3539→3649`、`home.js:4097→4130`、`schedule.js:2312→2404`、`visitEditor.js:1830→1787/1885`，`trash.js:138` 的還原也是 —— **都在按下去那一刻 `listWhole()`**。來訪編輯器是唯一的例外，已修。批次取消在讀取丟「讀不完整」以外的錯時沿用手上那一份，是早就寫明的取捨（那一筆照樣有 `ifUpdatedAt`），不是這一輪的事 |
| 02 資料健檢修正連按、兩條路一起送 | id 在 `data/health.js` 的 `run()` 鑄好（`withFixIds()`），`notYetWritten()` 連軟刪除一起讀、同一步認領（`writing`），`key` 帶 `fix.id`。本機跑 E2E `93`（H1～H3）全過 |
| 03 重算次數寫掃描那一刻的數字 | `recount` 那一個 op 帶 `ifUpdatedAt: fix.updatedAt`；`domain/health.js` 的 `checkCounts()` 把 `e.updatedAt` 放進 fix；`StaleWriteError` 時頁面重新掃描。`repo.js:174` 的 `sameStamp()` 遇到 `null`（舊資料沒有那一格）不擋，所以沒有假擋 |
| 03 同一個形狀：別的修正寫的是不是掃描那一刻的值 | `data/health.js` 的 `opFor()` 逐種看：會寫來訪的（`clearBeds`、`moveBedToRoom`、`restatVisit`、整包 `slots`、病歷號那幾種）都帶 `ifUpdatedAt`。只寫主檔一兩格的（`setMasterFields`、`renameCourse`、`renamePool`、`setAssigns`…）沒帶 —— 要另一台在掃描之後、按修正之前剛好改同一筆主檔才會蓋掉，而且那幾格掃描時只在「空的或還是舊種子值」才報；不值得改 |
| 03 客戶詳情「把計數欄位改成重算值」 | `customerDetail.js:1154-1200`：按下去同時重讀全部來訪與那一筆額度、帶那一份的 `updatedAt`；別處刪掉了就講一句、重畫 |
| 04 營養品「已經給了」連按 | `data/notes.js:132-160` 的 `recordDelivery()` 寫之前重讀那一筆額度；客戶詳情那一顆有 `key`。另外四個勾營養品提醒的入口（首頁卡、泡泡、`#/todo/notes`、客戶詳情）沒有 `key`，但每一次都要先過「給了哪些？」那一張、寫之前又重讀，連按不出第二筆 |
| 「會建資料的按鈕沒有防連按」全掃 | `list-unkeyed-saves.mjs` 列出全站 40 個沒有 `key` 的 `withSaveState(...)`：除了上面「之後再做」第 1 條，其餘都是 update／remove／setDone／還原，或 `config.loadSeed`（種子 id 固定，連按只是同一份蓋一次，11/5 HANDOFF 段一 2 她決定不修） |
| 06 行事備註的小字 | `eventEditor.js` 三句 `field__hint` 拿掉；三顆 `?` 留著（點了才出來）|
| 07 行事備註顏色第一顆 | `domain/events.js` 的 `CATEGORIES.sameAs`＋`colourChoices()`：第一顆是那一類本來的顏色、存 `null`；重複的那一色不列，**這一筆存的就是那一色時照樣列、照樣是選著的**（`tests/event-colour-swatches.test.js`）；切類別會重畫、選著的那一色保留。CSS 限在 `.swatches--event`／`.swatches--leave`；`.swatch--auto` 還有設定頁警示「空心」在用、規則留著；客戶備註與設定頁警示的 `.swatch` 不受影響 |
| 單元測試 | `incomplete-read`、`health-fix-idempotent`、`recount-stale-guard`、`delivery-once`、`event-colour-swatches`、`save-guards`、`fewer-words` 等 9 支 86 個全過 |

### #214 待辦「約二返」那一列

- `home.js` 的 `twoButtons`（`約二返`＋有客戶＋有來訪）跟底下真的畫兩顆鈕的條件一致；`.row--actions`／`.taskrow--actions` 全庫只有這兩處用
- 本機模擬器量的（`repro-followup-row-layout.spec.js` W1）：375 寬時兩顆鈕在名字底下一行、同一行、靠右、不溢出；1024 寬時跟名字同一行
  ```
  W1 375 寬 {"buttons":2,"buttonsBelowLabel":true,"buttonsSameLine":true,"rightAligned":true,"overflow":false}
  W1 1024 寬 {"buttons":2,"buttonsBelowLabel":false,"buttonsSameLine":true,"rightAligned":true,"overflow":false}
  ```

### #215 開機登入、iPad 拍照（最重要的一塊）

**SDK 這一側**（照 firebase-js-sdk 11 的原始碼對）：

- `firebase.js` 的 `initializeAuth()` 存登入的三種跟 `getAuth()` 自己傳的一模一樣、同一個順序 → 既有的登入照樣讀得到，不用重新登入
- 不帶 `popupRedirectResolver` → 開機不叫 `_initialize()`（那正是手機／Safari 上先載 iframe 的地方）
- `getRedirectResult()` 先等登入初始化，再看這一頁 sessionStorage 的 `pendingRedirect`；沒有就回 `null`、不載任何東西
- `signOut()` 不需要那一塊；`signInWithPopup／Redirect` 自己帶就夠
- 桌機彈窗：以前 `getAuth()` 在桌機本來就不先載，按下去才載 —— 行為跟以前一樣（E2E 全部走這一條，CI 綠）

**每一種裝置走哪一條**（`auth.js` 的 `prefersRedirect()`）：

| 裝置 | 登入 | 開機先載 Google 那一塊 |
|---|---|---|
| Android 主畫面那一顆（全螢幕） | 轉頁（跟以前一樣） | 不載（以前載） |
| Android Chrome 分頁 | 轉頁（以前彈窗） | 不載（以前載） |
| iPad 主畫面那一顆 | 轉頁（跟以前一樣） | 不載（以前載） |
| iPad Safari 分頁（自稱 Macintosh） | 轉頁（觸控點認出來；以前彈窗） | 不載 |
| iPhone | 轉頁 | 不載 |
| 桌機 Chrome／Edge／Firefox | 彈窗（跟以前一樣） | 不載（以前也不載） |
| 桌機 Safari | 轉頁（以前彈窗） | 不載 |

- 轉頁走的是 app 自己的網址（ADR-0168 的 `authDomainFor()`），iframe 同網址；workflow 裡沒有預覽頻道，所以「預覽頻道走 firebaseapp.com」那一條碰不到
- ADR-0167：記著的那一位先畫殼、`app.js` 一行沒改；`watchAuth()` 先收轉頁再開始聽，平常（沒有轉頁）只等登入還原，跟以前第一次回答同一個時機

**本機模擬器真的走過**（`repro-login-redirect.spec.js`，Chromium 換 UA）：

| | 情境 | 結果 |
|---|---|---|
| L1 | Android 手機 UA：桌機登入 → 設定 → 登出 → 換 UA 重新打開 → 登入（同一個分頁轉頁，沒有彈窗）→ 選帳號 → 回來 | 登入好的（`#root[data-access="allowed"]`） |
| L2 | iPad（UA 寫 Macintosh、觸控點 5）：轉頁登入 | 登入好的 |
| L3 | 登入到一半（到了選帳號那一頁）按返回 → 再按一次登入 | 0.7 秒回到登入頁、不卡；第二次登得進去 |
| L4 | 轉頁回來那一下 iframe 載不到 | 見「之後再做」第 3 條（不是退步，按重新載入就回來） |

另外本機跑 E2E `81`（開機從手機裡的、P14 iPad 打開不打 Google）＋`93`：17 個全過。`tests/auth-no-proactive-iframe.test.js`、`tests/immersive-display.test.js` 過。

**拍照退回系統相機**：用相機的四個入口（`customers.js` 拍訂購單、`masterList.js`、`schedule.js` 拍 Abovee、`treatmentSheets.js` 療程單）都只叫 `components/camera.js` 的 `openCamera()`，全庫沒有別處叫 `getUserMedia`，所以四個都接到了。每次打開都是新的一層（退回那一句不會留到下一次）；沒影像時快門不拍；關掉時兩次要相機都會停掉；E2E `37` 的 C9 蓋著（CI 綠）。只有實機看得到的（iPad 主畫面那一顆真的有沒有影像）在 PR #215 的清單第 1 條。

### #199、#205（repo 是 public）

| 查了什麼 | 結果 |
|---|---|
| 被追蹤的檔案裡有沒有圖或索引 | `git ls-files graphify-out .codegraph` 是 0；`git check-ignore -v` 擋著 `graphify-out/`、`.local/`、`.codegraph/` |
| 被追蹤的檔案裡寫到的 `.local` 路徑有沒有名單上的字 | `local-paths-in-tracked.mjs`：137 條不同的 `.local/…` 路徑過主資料夾的過濾網，3 條被遮，**三條被遮的都是日期**（字元型態 `9999-9999` 或月份）—— 假警報 |
| 真名掃描 | `tests/no-secrets.test.js` 在這個 worktree 裡 3 條全過、skipped 0（名單從主資料夾找到的） |
| `private-graph-check.mjs` 做到它說的 | 在主資料夾跑（輸出再接過濾網）：會進圖的私人檔 26 份，被遮的行都是日期、帳號裡的數字、session id；它印的是遮過的行。檔名是原樣印的，但放回的只有 README、記憶（英文 slug）這種 |
| `.graphifyignore` | 公開那一份先整個擋 `.local/*`、放回由 `.local/.graphifyignore` 決定；沒有那一份（CI、別人 clone）就一份都不進。`codegraph.json` 照舊整個排除 `.local/` |
| `localDir.js` 三種地方 | CI（沒有 `.local`）：只找自己 → `null` → 跟以前一樣跳過、不失敗；主資料夾：`--git-common-dir` 是 `.git` → 只有自己；worktree：指到主資料夾的 `.git` → 先自己、再主資料夾。`tests/local-dir.test.js` 4 個全過（含真的在 worktree 裡找到主資料夾那一份） |

### 文件（#206、#217、#223、#200）

- `docs/agents/worktree.md`：照它接了這個 worktree —— `codegraph init --yes` 建的是這個 worktree 自己的索引（`codegraph status` 的 Project 是 worktree 路徑）；`.firebaserc`、`codegraph.json`、`.graphifyignore` 有進版控；`lessons.md` 第十六節在；「不要建 `.local` 連結」跟 `localDir.js` 的做法一致
- #223：README 41i1～41i4 跟合進來的 PR 對得上（#215 合在 11/6 08:13 台灣時間，寫 11/6 對）；`code-health-2026-11-04` 的 issue 01～04 `done`、#5 #6 還沒修（跟交代的已知一致）；`abovee-confirm-glance`、`sheet-push-gaps` 的狀態跟 git 對得上。沒找到對錯的
- #200：11/4 健檢紀錄本身；#1～#4 這一輪都真的修了（上面逐條對過），#5 #6 是已知

### 平行合進來的 PR 有沒有互相踩到

`git log --first-parent origin/main..develop` 的先後：#199 → #200 → #201 → #202 → **#203** → #205 → #206 → #204 → #207～#209 → **#210** → #211 → #212 → **#214** → #213 → #216 → **#215** → #217～#220 → **#221** → #223 → #222 → #224。

- **#203 與 #210**（`visitEditor.js`、資料健檢）：#210 晚合。它在 `visitEditor.js` 加的 `readGuestSlot()` 等是畫面與讀表單用的，存檔照樣先過 #203 改過的 `refreshCustomerVisits()`；#203 拿掉的 `isOffline` 在合完的檔案裡沒有任何一處用。資料健檢：#210 動的是 `checkStaleAvailability()`（排除一次性客人），#203 動的是 `checkCounts()` 與 `data/health.js`，不重疊；一次性客人的虛擬額度（`oneTime:` 開頭）不會進 `recount`，`withAdded()` 照 id 去重也碰不到它們
- **#215 與 #221**：#215 沒動 `app.js`、`index.html`、`ui/keyboard.js`（diff stat 只有 `auth.js`、`firebase.js`、`camera.js`）；#221 之後在 `app.js` 加 `watchKeyboard()`、改 viewport，跟登入互不相干
- **#214 與 #210／#221**（`home.js`）：#214 合在 #210 之後；一次性客人把那一顆改寫成「去日曆排」是開機後換字（`labelGuestBookings()`），#214 的 CSS 選擇器不看字；#221 之後沒有動到 `taskRow()`（現在的檔案就是 #214 那一版）

---

## 重現檔怎麼跑

都在這個資料夾，只用 fixtures 的假資料；跑 E2E 類的要先開模擬器（同一個 `E2E_WORKERS`）：

```
E2E_WORKERS=1 npm run emulators                                   # 另一個終端機，等 All emulators ready
E2E_WORKERS=1 HEADLESS=1 npx playwright test --config .scratch/final-check-2026-11-07/pw.config.mjs
```

| 檔案 | 內容 | 這一次的結果 |
|---|---|---|
| `repro-login-redirect.spec.js` | L1～L4 轉頁登入 | L1～L3 過；L4 印出 128 秒＋重新載入 1.2 秒（不是 app 的錯，見上） |
| `repro-followup-note-twice.spec.js` | F1 記一句連按兩下 | **紅：2 筆**（之後再做第 1 條） |
| `repro-followup-row-layout.spec.js` | W1 約二返那一列的版面 | 過 |
| `list-unkeyed-saves.mjs` | 列出沒有 `key` 的 `withSaveState(...)`（只讀原始碼） | `node .scratch/final-check-2026-11-07/list-unkeyed-saves.mjs` |
| `local-paths-in-tracked.mjs` | 被追蹤的檔案寫到的 `.local` 路徑過過濾網，只印遮過的 | `node .scratch/final-check-2026-11-07/local-paths-in-tracked.mjs <主資料夾>/.local/references/redact.mjs \| node <主資料夾>/.local/references/redact.mjs` |

收掉模擬器：`node tests-e2e/emulator-groups.mjs stop`，平常那一組照 port 停（這一次停的是我 13:15 起的 node 與 java 兩個行程）。
