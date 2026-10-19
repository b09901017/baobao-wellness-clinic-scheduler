# 讀不完整時，會動到次數或健檢那一串待辦的存檔先不存

Status: todo
段：一（xhigh）
動工前先讀：`data/repo.js` 的 `list()`／`listWithDeleted()`；`data/visits.js` 的 `save()`、`remove()`、`restore()`、`taskOps()`、`followupOps()`、`followupOpsAfterTaskChange()`、`chainPlans()`；`data/tasks.js` 的 `setDone()`；`ui/net.js`（`isOffline()` 的檔頭：它只是單向訊號）；`ui/components/aboveeConfirm.js` 的 `loadHistory()`（已經有「讀不到的不安靜地照算」）；`ui/views/masterList.js` 的 `saveCourse()`（ADR-0140：離線不存的先例）；`ui/toast.js` 的 `withSaveState()`、`StaleWriteError` 那一條；`SPEC.md` 第 1 節「形態」那一格（「讀取用快取，寫入排隊重試」）；ADR-0004、0070、0106、0140、0145；`CLAUDE.md`「算次數、驗證、預選額度要拿哪些來訪」「存一筆來訪時手上那一份是舊的」「寫入的等待與失敗文案」三列；`lessons.md` 全部（尤其「只讀一段期間的那一份」那種形狀）

## 她要的

> 3. 沒網路的時候存檔，會收掉健檢那條鏈的待辦，而且剩幾次會少算。 好 修

> 3. 離線，我手機就有網路吃到飽，所以除非是短暫的網路不好，不然我一直都是有網路的

談定：**擋**，不做「先存、連上再補算」。

## 為什麼會這樣

Firestore 開著本機快取（`data/firebase.js` 的 `persistentLocalCache`）。離線（或網路不穩到 SDK 判定離線）時 `getDocs()` **不會失敗**，回的是快取裡剛好有的那幾筆。
`listByCustomer()` 拿到的就可能只有這位客人的一部分來訪（她只看過那幾個月的日曆時，快取裡只有那幾個月）。

接著 `save()` 拿那一份當「這位客人的全部」：

- `countOps()` → `recount()`：額度身上的快取次數照那一份算 → **少算**，寫下去
- `followupOps()` → `syncFollowupTasks()`：健檢那一筆不在手上 → 當成「不是已完成」→ 開著的「追蹤健檢報告」「約二返」「寄報告給醫師」被**軟刪除**；反過來二返不在手上 → 長一張假的「約二返」
- `taskOps()` 的 `listByVisitForSync()`、`followupOps()` 的 `listEntitlements()`／`listByCustomerForSync()` 也可能是快取的

同一支 `followups.js` 裡 `owed()` 對「不在手上」是「不知道就不改」，收待辦那一圈卻是「不在＝收」。
10/12 只查不改時在 domain 層重現過；瀏覽器離線那一段是照程式自己的註解推的（沒在瀏覽器裡走 —— 這一支要走）。

現在問離線的只有兩處：拍 Abovee 的 `loadHistory()`（讀不到的那一位不預設打勾）與設定 → 課程（ADR-0140）。

## 做法（談定的方向，細節段一定）

1. **判斷看「讀回來的那一份是不是從快取來的」**：`snapshot.metadata.fromCache`。`repo.list()` 把它帶出來（例如陣列上一個不可列舉的旗標，或另一支回 `{ rows, fromCache }` 的函式 —— 選一個不會讓既有幾十個呼叫端改形狀的）。`navigator.onLine === false` 也算（確定離線）。
2. **會動到次數或健檢鏈的寫入**，只要算它的那幾份（呼叫端傳進來的這位客人的來訪、`save()` 自己讀的任務／額度）有一份是快取來的，就**不 commit**、丟一個認得出來的錯（例如 `IncompleteReadError`），toast 講一句：「網路不穩，讀不到 {客人} 的全部紀錄 —— 這一筆先不存，連上之後再按一次」。**不可以說「已經存在這台裝置上了」**（那是真的排進佇列的那一種）。
3. 畫面上打的東西留著不丟（壓表那張卡、來訪編輯器、確認／簽療程單抽屜、拍 Abovee 確認層、長按的確認框）。
4. 範圍：`visits.save()`／`remove()`／`restore()`、`tasks.setDone()` 走健檢鏈那兩種（`followupOpsAfterTaskChange()`）、`relinkAfterSave()`、批次取消、`saveEach()` 那幾條。**隨手記、備註、客戶資料、主檔不擋**（不吃這位客人的全部來訪）。
5. 用 `grep` 把每一個 `listByCustomer(` 的呼叫端（ui 底下 `home.js` 7、`customerDetail.js` 6、`schedule.js`、`calendar.js`、`bulkCancel.js`、`visitEditor.js`、`treatmentSheets.js`、`trash.js`、`relinkFollowup.js`、`aboveeConfirm.js`；data 底下 `notes.js`、`tasks.js`、`visits.js`）逐一看：讀回來是要拿去存的，就要把「是不是快取」一路帶到寫入那一刻。

推翻 SPEC 第 1 節「寫入排隊重試」對這一種寫入的那一半 → **補 ADR-0158**（先例 ADR-0140），SPEC 那一格改寫成「讀取用快取；會動到次數或待辦的寫入要讀得到完整的資料」。

## 過目改的（10/19，主控對過；跟上面「做法」衝突時以這裡為準）

- **旗標不要掛在陣列上**：`.filter()`、spread 都會弄丟（`data/visits.js:166` 的 `[...customerVisits.filter(…), next]`、`bulkCancel.js:649` 的 `[...ctx.visits…]`），弄丟時等於「完整」放行 —— 錯的方向。改成 **data 層自己記「這位客人最近一次讀是不是快取來的」**（例如 `data/visits.js` 一個以 `customerId` 為鍵的表，`listByCustomer()` 寫、寫入那幾支問），`save()` 再問自己讀的那幾份（任務、額度、**`config.listAll('courses')`** 也算）。
- **判斷要抽成純函式**：data 層 import CDN 網址，node 裡跑不起來 —— 「哪幾份讀回來、有沒有一份是快取」→「擋不擋」那一段放 domain（或不 import Firebase 的小模組），單元測試量它。
- **時機**：網路不穩時 SDK 大約 10 秒才退回快取，`toast.js` 的 `PENDING_MS` 是 8 秒 → 會先跳「已經存在這台裝置上了」再報錯。守門要在**送出 commit 之前**判完；判完才進 `withSaveState()` 的等待，或讓那一句等到 commit 真的送出才換。
- **不給重試鈕**（同 `StaleWriteError`）：重試跑同一個閉包，`visitEditor.js:138` 那種打開時讀一次就沿用的呼叫端永遠存不進去。toast 講「連上之後再按一次」；讀過一次就沿用的呼叫端改成每按一次重讀（拿到新的那一份才存）。
- **範圍補列**：客戶詳情的「修正」次數（`customerDetail.js:1158`）、資料健檢的 `recount`（`data/health.js:419`）、`dropChainLeftovers()`（`data/visits.js:317`）、拍 Abovee 的 `loadHistory()`（`aboveeConfirm.js:200` 只問 `isOffline()` → 也要認快取）。`visits.remove()` 沒有任何呼叫端（不用接，但守門照樣放進去）。
- **同一個形狀、這一支不收**（記進 HANDOFF「中途發現」問她）：刪客戶的 `deleteBlockers()`（`customerDetail.js:866`，快取裡少一筆來訪就放行刪除）、`buildBundle()` 推快取裡的次數、舊資料匯入拿快取的客戶清單判同名。
- **E2E 怎麼走**：`context.setOffline(true)` 會讓 `navigator.onLine` 變 false —— 只量得到「確定離線」那一條；「`onLine` 是 true、SDK 自己回快取」要用 `page.route()` 擋模擬器的 8080（Firestore）來走。
- 一支 issue、可以兩個 commit（資料層守門／各呼叫端重讀與 toast），commit 訊息都標 01。

## 判準

- 這一行會不會讓「只讀到一部分來訪」被當成「這位客人的全部」拿去算次數或收待辦？
- 快取來的那一份存檔 → 資料庫一個位元都沒變（來訪、額度快取、任務都沒動），畫面講了那一句、草稿還在
- 線上（`fromCache: false`）照舊存，行為一模一樣（既有 E2E 不紅）
- 網路不穩到 SDK 自己回快取（`navigator.onLine` 還是 true）也擋得到 —— 單元測試拿假的 `fromCache: true` 量
- 隨手記離線照舊存得進去（E2E `10` 的 O1、O2 不變）
- E2E：離線（`context.setOffline(true)`）在壓表記一段 → 那一句、沒寫進去；連上再按 → 寫進去一次、健檢那一串待辦一張都沒被收

## 連動

- `CLAUDE.md` 三列（上面「動工前先讀」那三列）補一句；`docs/常見問題.md` 一條（「我按了記錄為什麼說網路不穩不存」）
- `tests/save-guards.test.js` 會不會要多認一種錯
- `public/sw.js` VERSION（段一第一個動 `public/` 的升 v198）
