# 審查：隨手記這一輪的 Android 那一半（段八，2026-11-06）

範圍：`origin/develop`（merge-base `6dda1024`）→ `claude/notes-widget-android`（`ebd8e046`），issue 06、07、08、09。
做法：`/matt-code-review` 兩軸（Standards、Spec 各一個 subagent，只讀），加上我自己逐支讀 `NotesWriter`（對著 `data/notes.js`＋`repo.js` 的 `commit()` 一欄一欄比）、`NotesSync`、`FirestoreNoteStore`、`WidgetSync`、`WidgetStore`、`NotesWidget`、`MenuActivity`、`CaptureActivity`、`MainActivity`、`SignIn`、`Backend`、`android.yml`、`app/build.gradle.kts`、文件。
回來的每一條都讀了前後文；R2 在 core 加了一題暫時的紅燈跑過（紅了；跑完刪掉、沒 commit —— 測試寫在 R2 底下，段九照抄）。
本機：`./gradlew :core:test` 綠（14 題，含 `ParityTest` 137 題情境）；`node --test tests/notes-parity.test.js tests/notes-name-suggestions.test.js tests/e2e-related.test.js tests/no-secrets.test.js` 157 支全綠、skipped 0。

**寫進 Firestore 的形狀跟網頁一樣**：`NotesWriter` 對 `repo.commit()` 逐欄比過（新增那一筆的欄位、每一次帶 `updatedAt`、`doneAt` 三位毫秒＋`Z`、稽核 `at`／`actor`／`action`／`targetPath`／`before`（先讀、整份含 Timestamp）／`after`／`note`、寫之前照 `linkId` 重讀、一組一個 commit），情境檔 `writes` 15 題也盯著。
**會錯的在兩個地方**：一條繞過「給了哪幾款」的勾法（R1），與小工具手上那一份跟雲端對不齊（R2、R3）—— 後者不會寫錯資料，但小工具會一直畫著已經勾掉／刪掉的、或看不到別台新記的。

## 要修

照建議的先後排。R1～R3 是資料與同步，R4、R5 是畫面上的路，R6～R8 是字、文件與小的，R9 是判斷題（順手整理）。

### R1 「隨手記」app 主畫面的清單，營養品的提醒點勾就直接勾掉了

**段九：修了** —— `f520974a`（三個入口共用 `NoteTaps.asksWhatWasGiven()`／`givePage()`；主畫面那一列點勾＝打開網頁，`setDone()` 不擋）

- **在哪裡**：`android/app/src/main/kotlin/tw/baofu/notes/MainActivity.kt:178-186`。主畫面那份清單（`listOpen` 同一個查詢，營養品的提醒也在裡面）每一列的勾選框都直接 `Backend.notes.setDone(row.note["id"], true)`，沒有問 `entitlementId`
- **什麼情境會錯**：她打開「隨手記（測試）」（小工具上「還沒登入：點這裡…」、或從 app 抽屜）→ 清單上有一列「營養品：客戶A…」→ 點勾 → 那一筆提醒 `done: true`，**額度上的 `deliveries` 一筆都沒有**。網頁那條路（`recordDelivery()`）是提醒與交付紀錄同一個 commit，這裡只寫了一半：客戶詳情那一包看起來沒給、提醒卻勾掉了，試算表少一筆交付。
  07 的判準「營養品的提醒能不能在小工具上不經過『給了哪幾款』就被勾掉？（不行）」、ADR-0180 決定 3「不抄的」。小工具本體（`TickAction`／`WidgetSync.tick()`）與選單都有分流，只有這一頁漏了（主畫面是段五的骨架，段六沒換掉，release 版登入之後就是這一頁）
- **建議**：主畫面那一列照小工具的分流：營養品的提醒點勾＝打開 `WebLinks.note()`。「是不是營養品的提醒、點勾要怎麼走」收成一支給三個入口叫（現在三處各判一次、寫法還不一樣：`NotesWidget.kt:227`、`MenuActivity.kt:145` 用 `Js.truthy`，`WidgetSync.kt:123` 用 `!= null` —— Standards 軸）。
  `NotesWriter.setDone()` **不要**另外加擋（網頁 `data/notes.js` 的 `setDone()` 也不擋，加了情境檔就對不上；擋在畫面那一層，跟網頁的 `prepareToggle()` 同一層）
- **嚴重程度**：高（寫出網頁不會寫的資料：勾掉了、交付紀錄沒有；她最可能在第一次登入時就看到這一頁）

### R2 同步讀到這台手機的快取時游標往前跳：別台勾掉、刪掉、新記的，小工具之後一直問不到

**段九：修了** —— `a904793e`（`NoteStore` 的兩支查詢回 `Listing`、帶 `isFromCache`；`NotesSync.fetch()` 讀到快取不推游標、不算同步成功 → 小工具講「讀不到最新的」；整份讀那一次照樣先畫快取裡的、游標留空。紅燈照上面那一題，另補「第一次就沒網路」一題）

- **在哪裡**：`core/.../NotesSync.kt:49-56` 的 `pull()` 把查詢回來的最大 `updatedAt` 當游標；`app/.../FirestoreNoteStore.kt:39-62` 的 `listOpen()`／`listUpdatedSince()` 用 SDK 的預設來源 —— **連不上伺服器時回這台手機的快取、不丟錯**（`Source.DEFAULT`：「try to retrieve an up-to-date snapshot, but fall back to returning cached data if the server can't be reached」）。`WidgetSync.pull()`（`WidgetSync.kt:58-70`）只有丟錯才標 `stale`
- **什麼情境會錯**（一步一步）：
  1. 10:00 背景同步（有網路），游標 = 100
  2. 10:05 她在 iPad 的網頁勾掉 X（X 的 `updatedAt` = 10:05）
  3. 10:10 她在小工具上勾掉 Y（伺服器回來之後，這台手機的快取裡 Y 的 `updatedAt` 是 10:10）
  4. 10:12 走進電梯沒網路，點 ＋（`CaptureActivity` 一打開就 `pull()`）→ 預設來源回快取 → 快取裡 `updatedAt > 100` 的只有 Y → **游標跳到 10:10**、`stale = false`、`syncedAt` 記成現在
  5. 10:20 連上了，背景同步問「`updatedAt > 10:10`」→ **X（10:05）永遠不會回來**：小工具一直畫著 X 是還沒勾的，直到 X 再被改一次或登出重登（整份重讀）
  
  快取裡比游標新的還有別的來源：選單打開時讀的那一筆與那一組（`getOne()`／`listLinked()`）、主畫面開著時的即時清單。網頁新記的一筆、網頁刪掉的一筆也是同一個形狀（新的不出現、刪掉的不離開）。
  同一個原因的另一個症狀（Spec 軸）：**沒網路時底下那一行「讀不到最新的」不會出現**，第一次讀就沒網路時會畫「沒有還沒做的事」
- **重現**：core 加這一題是紅的（現在的 `NotesSync.pull()`；`a()`、`x()`、`y()` 是 `NotesSyncTest` 的 `note(id, updatedAt)` 簡寫）——

  ```kotlin
  // NotesSyncTest：照 SDK 預設來源的行為，連得上問伺服器、連不上回快取
  private class Sdk(var server: List<Doc>, var cache: List<Doc>, var online: Boolean) : NoteStore { /* listOpen／listUpdatedSince 讀 if (online) server else cache */ }

  @Test fun anOfflinePullFromTheCacheMustNotSkipChangesMadeElsewhere() = runBlocking {
      val sdk = Sdk(listOf(a(100), x(100), y(100)), listOf(a(100), x(100), y(100)), online = true)
      var s = NotesSync.pull(sdk, null)
      sdk.server = listOf(a(100), x(200, done), y(300, done)); sdk.cache = listOf(a(100), x(100), y(300, done))
      sdk.online = false; s = NotesSync.pull(sdk, s)   // 沒網路時按 ＋
      sdk.online = true;  s = NotesSync.pull(sdk, s)   // 連上了
      assertFalse(s.notes.any { it["id"] == "x" })      // 紅：x 還在
  }
  ```
- **建議**：同步那兩支查詢**只認伺服器的答案**：`get(Source.SERVER)`（連不上就丟錯 → `stale = true`、游標不動、清單照舊），或回傳 `metadata.isFromCache` 讓 `NotesSync.pull()` 讀到快取時不推游標、不算同步成功（core 的介面多一格，上面那一題改成用它）。
  `afterLocalWrite()` 讀快取是對的（它不碰游標），不用改。網頁沒有這一支，不在情境檔
- **嚴重程度**：高（背景同步是這一輪談定的更新方式；一次短暫斷線就讓小工具長期畫錯，她會照著勾一件早就做完的事、或以為網頁記的沒存進去）

### R3 同步回來時蓋掉同步期間自己寫的：按 ＋ 剛記的那一筆從小工具上消失

**段九：修了** —— `a904793e`（跟 R2 同一個 commit：`NotesSync.apply(現在那一份, 讀回來的)` 在 `WidgetStore.update()` 那把鎖裡套；整份讀時留著 `updatedAt` 還是 null 的；三題單元測試）

- **在哪裡**：`WidgetSync.pull()`（`WidgetSync.kt:58-70`）一開始拿 `before`、等網路回來之後 `change { it.copy(notes = next.notes, …) }` —— `next.notes` 是用 `before` 那一份算的，**等網路那段時間裡別人換進去的清單被整份蓋掉**
- **什麼情境會錯**：點 ＋ → `CaptureActivity.onCreate` 開始 `pull()` → 網路慢（或剛斷線，SDK 要等十秒左右才改讀快取）→ 她打完字按「記下來」→ `localWrite()` 之後 `afterLocalWrite()` 把新的那一筆放進清單 → `pull()` 回來，用舊的 `before` 算的那一份蓋上去。
  新的那一筆不在 `changed` 裡（伺服器讀的那一刻它還沒到；本機那一份的 `updatedAt` 是還沒回來的伺服器時間，SDK 在本機比 `updatedAt >` 時不算它）→ **剛記的一筆從小工具上不見**，要等下一次同步（最多 15 分）才回來。她看到沒記到，很可能再記一次 → 兩筆一樣的。
  背景同步與勾掉撞在一起也一樣：劃線結束 `settle()` 換好之後才回來的同步，把剛勾掉的那一筆放回清單（下一次同步才拿掉）。游標不受影響（只從伺服器讀的推）
- **建議**：同步回來時**把改過的那幾筆套在現在那一份上**（在 `WidgetStore.update()` 那把鎖裡）：`change { cur -> cur.copy(notes = NotesSync.merge(cur.notes, changed), cursor = later(cur.cursor, 新的游標)) }`；整份重讀（沒有游標）時，留著現在那一份裡 `updatedAt` 還是 null 的（本機還沒送到伺服器的）。
  core 給一支（例 `NotesSync.apply(current, result)`）＋一題單元測試：「同步開始之後本機記的一筆（`updatedAt` null），套上同步結果之後還在」
- **嚴重程度**：中（要網路慢到她打完字還沒回來才撞到；撞到的後果是重複記一筆）

### R4 選單少接「拿回來」：劃線那 3 秒裡點字，第一顆按了沒反應

**段九：修了** —— `c30fbd24`（選單接 `untick`：「拿回來了」＋連在一起那半句，小工具上還在劃線的一起停掉〔`WidgetSync.stopTicking()`〕；讀到的已經勾了就順手換清單；複製卡照網頁那一句）

- **在哪裡**：`MenuActivity.kt:143-168` 的 `onAction()` 沒有 `"untick"` 那一支。選單打開時重讀那一筆（`getOne()`），已經勾掉的話 `Notes.noteActions()` 第一顆是「拿回來，還沒做」—— 按下去不寫、不關、不講話
- **什麼情境會錯**：她在小工具上勾掉一筆 → 劃線 → 想拿回來，點到的是**字**不是勾選框 → 選單第一顆「拿回來，還沒做」→ 按了沒反應（劃線 3 秒後那一筆照樣離開）。小工具還停在舊的那一份（別台勾掉了、還沒同步）時點字也是。
  網頁 `runAction()` 有這一支（`note.js:740` 的 `tick`／`untick` 同一條，toast「拿回來了」＋`linkedWords(reach).toast`）。同一個情況下「複製到別天」那張卡的開關也少了網頁那一句「（這一筆已經勾了，不算在裡面）」（`note.js:1167`）
- **建議**：`"untick"` → `write({ "拿回來了${Notes.linkedWords(reach).toast}" }) { Backend.notes.setDone(id, false) }`；複製卡照網頁補那一句（`Js.truthy(n["done"])` 時）。選單打開時讀到的跟小工具手上那一份不一樣（已經勾了／刪了）就順手 `afterLocalWrite()` 換一次清單（刪掉的那一條已經這樣做了）
- **嚴重程度**：中（一顆按了沒反應的按鈕，而且是在她勾錯、想救回來的那一刻）

### R5 沒登入時 ＋ 照樣記得下來；登出、登入之後小工具講錯狀態

**段九：修了** —— `7c4f41e6`（輸入卡與選單打開時 `signedInOrLeave()`：沒登入打開主畫面、自己收掉；小工具沒登入時 ＋ 指到主畫面；`allowedUid()` 改在 `provideContent` 裡讀；不在白名單上被登出時小工具也跟著換）

- **在哪裡**：`NotesWidget.kt:201-206`（＋ 不管登入沒都畫、都打得開 `CaptureActivity`）、`CaptureActivity`／`MenuActivity` 的 `onCreate`（不問 `WidgetSync.allowedUid()`）；`NotesWidget.provideGlance()`（`NotesWidget.kt:83-92`）**在 `provideContent` 外面讀一次 `uid`**
- **什麼情境會錯**：
  - 剛裝好、或登出之後，小工具寫「還沒登入：點這裡…」，但右上角 ＋ 照樣打得開 → 打字 → 記下來 → 有網路：toast「存不進去：PERMISSION_DENIED: Missing or insufficient permissions.」（英文）；**沒網路：一句都不講**，等連上網路 Rules 擋下來、本機那一筆被 SDK 收回 —— 她打的字安安靜靜地沒了
  - Glance 一個 session 裡 `provideGlance()` 只跑一次，之後的 `updateAll()` 只重畫 `provideContent` 裡面那一段：登出之後如果 session 還活著，`uid` 還是舊的、手上那一份已經清掉 → 畫「讀取中…」而不是「還沒登入」，要等下一次背景同步（最多 15 分）才對。登出後馬上又登入（段九驗收會這樣點）反過來：可能一直寫「還沒登入」
- **建議**：`CaptureActivity`／`MenuActivity` 打開時 `allowedUid()` 是 null → 打開 `MainActivity`（登入）、自己收掉；小工具沒登入時 ＋ 也指到 `MainActivity`。`allowedUid()` 改在 `provideContent { }` 裡面讀（便宜：一個 prefs＋`currentUser`），手上那一份一換就跟著重算
- **嚴重程度**：中低（要先沒登入才撞到；撞到時沒網路會丟一筆她以為記好的）

### R6 輸入卡與選單的等待、失敗的字

**段九：修了** —— `7ba7bf85`（`Say.kt`：`saved()`〔還沒回到伺服器講「存在這台手機上了，連上網路會補傳」；輸入卡有網路時不講〕、`failed()`〔PERMISSION_DENIED／UNAVAILABLE／連不上網路講白話〕；主畫面、輸入卡、選單、登入都讀它）

- **在哪裡**：`MenuActivity.write()`（`MenuActivity.kt:80-91`）不看 `Backend.store.pending`，沒網路時照樣講「改好了」；`CaptureActivity` 記好了一句都不講（沒網路也是）。失敗的那一句三處都是「存不進去：${e.message}」（`CaptureActivity.kt:120`、`MenuActivity.kt:87`、`MainActivity.kt:169/184`），`SignIn` 三處「登入沒有成功：${e.message}」—— 把 SDK 的英文原樣給她看
- **什麼情境會錯**：沒網路改了一筆 → 「改好了」—— 不算假話（在手機裡了），但跟主畫面「存在這台手機上了，連上網路會補傳」、網頁的「已經存在這台裝置上了」對不上；被 Rules 擋（R5 那一種）看到一串英文。`CLAUDE.md`「寫入的等待與失敗文案」：等待那一句不可以說失敗、失敗那一句集中一處
- **建議**：app 裡收一支（例 `capture/Say.kt` 的 `savedSay(pending)`、`failedSay(e)`）：`pending` → 「存在這台手機上了，連上網路會補傳」；`FirebaseFirestoreException` 的 `PERMISSION_DENIED` → 「這個帳號沒有權限（要先登入）」、`UNAVAILABLE` → 「連不上，等一下再試」；其餘才印原文
- **嚴重程度**：低

### R7 還原備份之後，小工具看不到還原回來的內容

**段九：修了** —— `0adef9d2`（`STAGING.md` 還原演練補一行、ADR-0180 後果補同一件事；腳本不改）

- **在哪裡**：`scripts/restore-backup.mjs:226-227` 用備份裡的值整份 `set()` —— `updatedAt` 是備份那一刻的舊時間。小工具的背景同步只問「`updatedAt` 大於游標的」（ADR-0180 決定 9），還原回來的那幾筆比游標舊
- **什麼情境會錯**：正式站出事、照 `docs/STAGING.md` 的還原演練把備份還原回去 → 隨手記回到備份那一刻的樣子，但手機上的小工具照舊畫還原之前的（還原時被軟刪除的那幾筆有新的 `updatedAt` 會離開；被改回舊樣子的不會變）。`CLAUDE.md` 那一列寫了「不經過 `repo.commit()` 的路小工具看不到」，這一條是既有的那一條路
- **建議**：`docs/STAGING.md` 還原那一節加一行「還原之後，手機上的『隨手記』登出再登入一次（整份重讀）」。改還原腳本去蓋 `updatedAt` 不建議（備份要原樣）
- **嚴重程度**：低（還原很少做）

### R8 文件

**段九：修了** —— `0adef9d2`（ADR-0180 只留理由、鑰匙在哪指到 `STAGING.md`、過時那一條換掉、決定 9 補「只認伺服器的答案」；操作手冊不再講順序；`STAGING.md`「建一版、派送」補乾淨的 checkout）

- **ADR-0180**（這一支 PR 新增的，可以直接改）：「後果」最後一條「release 鑰匙只有她筆電上一份、還沒放進 GitHub Secrets 與備份（09）」已經過時（09 做完了）。決定 6、8 寫了作法（鑰匙檔與密碼檔的路徑、SDK 目錄、`compileSdk`、worker 數），鑰匙在哪也跟 `STAGING.md`「簽章鑰匙在哪」重複 —— `CLAUDE.md`「文件分工」：ADR 寫理由不寫作法、同一件事只寫一處 → 留「兩把鑰匙、兩把的 SHA-1 都要登記、不進 repo」，路徑指到 `STAGING.md`（Standards 軸）
- **`docs/操作手冊.md`「桌面小工具」最後一段**把清單順序（今天 → 過了 → 沒日期 → 以後的、一組一列）又講了一次 —— 操作手冊「一條業務規則都不定義」，留連結那一半就好
- **`docs/STAGING.md`「建一版、派送」**：派送的 APK 是筆電建的（見 HANDOFF「要她決定的」那一題）→ 照建議留著的話，加一行「從合進 develop／main 的那一個 commit、`git status` 乾淨的 checkout 建」—— 不然筆電上還沒 commit 的改動會跟著派出去
- **嚴重程度**：低

### R9 判斷題（Standards 軸的氣味，挑值得順手做的）

**段九：做了四件** —— `a99dbafb`（`WebLinks.notesPage()`＋`WebLinksTest`；receiver 的 scope 掛 `AppScope.guard`、`ThemeActivity` 改用 `AppScope`；`FirestoreNoteStore.openQuery()` 三處共用、主畫面那份清單留著〔登入之後她看到的就是它，R1 修好了〕；拿掉 `Js.nullish`）。`Notes.isLinked` 留著（網頁 `domain/notes.js` 有匯出、照抄的一份）；`Floating.kt`、`openWeb`／`openUrl`、`remember0()`／`c()` 不動

- **網址寫死在畫面**：`NotesWidget.kt:187` 的 `#/todo/notes` 沒有進 `WebLinks`（另外兩條有，而且 `WebLinksTest`／網頁的 `notes-parity` 盯著它們真的登記在網頁上）→ 加 `WebLinks.notesPage()` 進同一套盯法
- **自己開的 CoroutineScope 沒有那層保護**：`ThemeShortcut.kt:53`（`ThemeActivity`）、`NotesWidget.kt:98`（receiver）各自 `CoroutineScope(SupervisorJob() + Dispatchers.Default)`，沒有 `AppScope` 那個 `CoroutineExceptionHandler` —— 段六中途發現 2 修過同一個形狀（背景出錯帶走整支程式、小工具停在舊的）。receiver 那一支要配 `goAsync()` 的 `finish()`，可以留自己的 scope，但加同一個 handler
- **主畫面另寫一份還沒勾的查詢**：`MainActivity.kt:137-146` 的即時清單把集合名寫死成 `"notes"`、自己換值 —— 跟 `FirestoreNoteStore.listOpen()` 同一個查詢。R1 修的時候一起看要不要留這一份清單（主畫面本來只是登入與放小工具）
- **沒人用的**：`Js.nullish`、`Notes.isLinked`
- 其餘（`Floating.kt` 什麼都放、`openWeb`／`openUrl` 組同一個 Intent、`remember0()`／`c()` 名字）不擋，段九有空再說

## 要她決定的

收成一題寫進 HANDOFF「要她決定的」：**派送的安裝檔要不要改成 GitHub Actions 建**（spec「一」寫「安裝檔由 GitHub Actions 建」；段七改成筆電建、CI 只確認鑰匙建得出來，沒問過她）。

## 查過、不成立或不用改的

- **寫入的形狀**：`NotesWriter.commit()` 對 `repo.commit()`：自動 id 的順序、`befores` 先讀（`SoftDelete` 也讀、讀到已刪除的照寫）、`actor` 在讀之後、新增那一筆 `deletedAt: null`／`createdBy`／兩個伺服器時間、修改帶 `updatedAt`、軟刪除 `after: { deletedAt: 'server', reason }`、稽核 `before` 是整份（Timestamp 經 `toCore`／`toFirestore` 來回，奈秒沒掉）、`note: null` —— 一樣。`batch.update()` 的鍵 Android 與網頁都當欄位路徑，隨手記的鍵沒有點，一樣
- **兩個 fake 的差別**：`ParityTest` 的 `FakeStore.commit()` 只記不套、網頁的替身會套 —— 每一題只有一次 commit，不影響答案
- **游標本身**：只要讀的是伺服器，「大於上次最大的 `updatedAt`」不會漏：同一個 batch 同一個伺服器時間、讀是強一致（讀到 T 的那一刻 T 以前 commit 的都看得到，之後 commit 的時間一定比讀的那一刻晚）。別台離線記的，伺服器時間是連上那一刻，也問得到。會漏的只有 R2 那一種（讀的不是伺服器）
- **刪掉、勾掉的拿得掉嗎**：軟刪除與勾掉都經 `commit()` 帶 `updatedAt`，`merge()` 照 `isOpen()` 拿掉；硬刪除 Rules 擋。除了 R7 那一條既有的路，`legacyImport`、`customers.js`（刪客戶連隨手記）都走 `repo.commit()`
- **離線記的那一筆會不會被游標跳過**：不會 —— 還沒回到伺服器的 `updatedAt` 是 null，不推游標；連上之後它的伺服器時間一定比任何已經讀到的晚。小工具上自己剛記的靠 `afterLocalWrite()` 讀快取畫出來（除了 R3 那一種被蓋掉）
- **勾掉的 3 秒**：寫入排同一個 `writes` Mutex，拿回來一定寫在勾掉後面；Glance 的 callback 馬上回（段六修過）。程式在 3 秒裡被收掉：Firestore 已經勾了的，小工具劃線最多 63 秒之後畫回沒勾的樣子，下一次同步拿掉（自己會好）；留在檔案裡的 `ticking` 那一格下一次 `settle()` 會清掉。不記
- **`MY_PACKAGE_REPLACED`**：只重畫、不讀網路（手上那一份在檔案裡，畫得出來；`onUpdate` 手上沒有才讀）。WorkManager 的排程存在它自己的資料庫裡，跨更新、跨開機都留著
- **白名單不過時有沒有寫入**：`checkAllowed()` 之前沒有任何寫入路徑；不在名單上就 `signOut()`，`allowedUid()` 是 null、小工具與主畫面都不寫（R5 是「根本沒登入」那一種，Rules 照樣擋，問題在她看到什麼）。登出清手上那一份（`forget()`）；換帳號經過登出。Firestore 的本機快取登出不清 —— 是她自己的手機、`allowBackup=false`、解除安裝會清，不記
- **連在一起的一組**：小工具一列＝`groupLinked()` 代表的那一筆；勾、改字、掛給誰由 `NotesWriter` 重讀同一組一起寫，改日期、拆開只動代表那一天（Spec 軸逐顆對過）。小工具清單只有還沒勾的（同網頁首頁那張卡），「共 N 天」數的是還沒勾的那幾天 —— 跟首頁那張卡一樣
- **選單的那幾顆、字、營養品的分流**：顆數、順序、底下那行小字只問 `noteActions()`；營養品的提醒是「勾掉（開網頁）／改日期／看那一包」，沒有複製；跳出來的字跟 `runAction()` 一樣（R4 那一顆除外）
- **簽章與 CI**：鑰匙只走 `env`、不 echo；release 那一步只在 `push`（PR 上跳過，fork 的 PR 沒有 Secrets 也是跳過）；APK 不上傳成 artifact；鑰匙檔在 `$RUNNER_TEMP`（gradlew 失敗時 `rm` 不會跑到，但 GitHub 的 runner 用完就丟，不記）；沒開 configuration cache（`gradle.properties` 只開 build cache，存的是輸出、不含鑰匙與密碼）、`setup-gradle` 沒設發 build scan。
  `.gitignore`（`local.properties`、`*.jks`、`*.keystore`、`*.apk`、各層 `build/`）與 `.gitattributes`（`gradlew.bat` 是 `w/crlf`、jar／png 是 `-text`）`check-ignore` 實測過。被追蹤的檔案、文件裡沒有 email（只有 `example.com` 的假帳號）、沒有 Windows 使用者路徑、沒有真名
- **`android.yml` 的 `paths`** 沒列 `domain/customers.js`、`data/notes.js` 等照抄的那幾支：那幾支的行為一改，網頁那一側的 `notes-parity` 先紅、`--write` 之後情境檔變了 → `android.yml` 照樣會跑。不用改
- **小工具的清單順序不在情境檔**（07 判準寫要放）：網頁沒有這一支，答案沒有「網頁算的」可以比；放在 `WidgetListTest`、ADR-0180 與 `CLAUDE.md` 那一列都寫了理由。不用改
- **畫面寫完先收、寫入在背景跑**：寫之前的重讀在網路很差時要等 SDK 判定離線（十秒左右），這段時間程式被系統收掉就沒寫 —— 理論上有，但程式剛收掉畫面的那幾秒不會被收（要記憶體很緊），而且 `create()` 不先讀、一按就在快取裡。不記

## 段九的手動驗收清單一定要有的

（加進 `android-checklist.md` 的 A 段；HTC 接 staging，**截圖只放 scratchpad**）

- **R1**：主畫面清單上一筆營養品的提醒 → 點勾 → 打開排課系統那一筆問「給了哪幾款」（不是直接勾掉）
- **R2**：小工具上勾掉一筆 → 開飛航模式 → 點 ＋ 再關掉 → 底下寫「讀不到最新的」→ 網頁（筆電）勾掉另一筆 → 關飛航模式 → 點 ＋ 再關掉 → 網頁勾掉的那一筆離開小工具
- **R3**：飛航模式下點 ＋ → 馬上打幾個字記下來 → 那一筆留在小工具上（沒有閃一下又不見）→ 關飛航模式 → 網頁看得到那一筆、只有一筆
- **R4**：勾掉一筆 → 3 秒內點那一列的**字** → 選單第一顆「拿回來，還沒做」→ 按 → 拿回來了
- **R5**：登出 → 小工具寫「還沒登入」→ 點 ＋ → 打開的是登入那一頁、不是輸入卡 → 登入 → 小工具換回清單
