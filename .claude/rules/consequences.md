---
paths:
  - "public/js/domain/consequences.js"
  - "public/js/domain/audit.js"
  - "public/js/domain/dayReview.js"
  - "public/js/ui/toast.js"
  - "public/js/ui/toastSwipe.js"
  - "public/js/ui/saveFailure.js"
  - "public/js/ui/components/dialog.js"
  - "public/js/ui/views/audit.js"
  - "public/js/ui/views/health.js"
---

# 確認框與後果說明、寫入的提示、稽核、資料健檢

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 一個要分得出「不要了」與「手滑關掉」的確認框

- 用 `ui/components/dialog.js` 的 `chooseAction()` ——**關掉回 `null`**，兩顆按鈕各回自己的值。
- `confirmAction()` 只答得出是／否，拿它做三態的話「點外面關掉」會被當成其中一顆按下去了（備忘錄編輯點外面那一道就是這個形狀）。
- **「確定」之外再多一條路**（原本兩顆、有時候多一顆）用 `confirmWithOption()`（ADR-0146）：主要那一顆與「先不要，回去」照 `confirmAction()` 的樣子（`data-ok`／`data-cancel`、預設焦點在「先不要，回去」），多的那一顆是 `data-option`；回 `'ok'`、那一顆的 key 或 `null`。
- **三顆以上自動直排**（`ask()` 加 `dialog__actions--stack`）—— 橫排在手機上放不下，E2E `65` 的 L9 量著

## 一句「按下去會發生什麼」

- 只寫在 `domain/consequences.js`。
- **它只能講真的會發生的事**（ADR-0070）——「拿回來」那一道的後果由 `data/visits.js` 的 `previewTaskChange()` 算，跟真的會寫下去的 `followupOpsAfterTaskChange()` **共用同一段身體**，不要照著規則在畫面上再推論一次。
- 拿回一張待辦**從來不會動到任何一筆來訪**，寫一句「會取消已約好的二返」是假話，而嚇錯一次之後真的該停的那次她也不會停。
- **取消那一道的「那一天還剩下什麼」要看同一天的別筆**（`cancelConsequences()` 的 `sameDay`，2026-10-07）：那一天已完成之後再加的段在另一筆來訪裡（ADR-0083），四個呼叫端（日曆長按、批次取消、確認抽屜、編輯器那顆 ×）都要把這位客戶的來訪傳進去 —— 少傳的那一個會說「那一天就整個取消了」而已完成的那一段還在。
- **取消掉的段身上還沒勾的 Examine／耀聖會被收掉**（`syncTasksForVisit()` 的 `remove`／縮小 `slotIndexes`），而 `cancelTasksFor()` 只收勾過的 —— 她掛了只是忘了勾的話沒有人提醒她回去收，所以取消與改期那幾道講出來＋下一步（`registrationDropLines()`，2026-10-15）；`cancelConsequences()` **只拿這一筆自己的任務**（批次取消攤平傳進來的那一份會讓別天的 Examine 漏進來）。
- **確認框的 `consequences` 每一項都是一句話**，不要塞分隔線（`'——'` 會被畫成清單的一項）；不要了的那一顆預設是「先不要，回去」（`dialog.js` 的 `BACK_LABEL`）。
- **簽療程單抽屜那幾句健檢鏈**拿 `syncFollowupTasks()` 試算（`chainAfterClose()`）：這一筆的追蹤健檢報告、任何一次健檢的「約二返」長出來或收起來（ADR-0139、0142）—— 呼叫端要把這位客戶的全部來訪與任務（連清掉的）一起傳，少傳就當成只有這一筆。
- **取消那一道也講健檢那條鏈**（`cancelChainLines()`：「約二返」長出來／收起來的 `followupBookingLines()` ＋ 還接在被取消的健檢後面的二返 `strandedFollowupLines()`，ADR-0142、0145；讀走 `data/visits.js` 的 `chainInputs()`）：單筆的入口傳 `cancelConsequences({ chain, customerVisits })`（以前叫 `sameDay`），**一次取消好幾筆的入口（批次取消、確認抽屜）直接叫 `cancelChainLines()` 一次** —— 逐筆算再合起來，取消兩場二返每一筆只看得到一場；不要在畫面裡自己逐段套 `applyStatus()`。
- **另約一次健檢時講「有一場二返還接在被取消的那一次上」**（`strandedOnNewExamLines()`：壓表、日曆新增經 `bookingConsequences({ customerVisits, entitlements })`，拍 Abovee 經 `aboveeConsequences({ entitlementsBy, visitsBy })`）。
- **存二返時「約二返」會不會收掉拿 `followupBookingLines()` 試算，不寫死**（壓表 2026-10-09 修的；前提是「只接得到做完的健檢」的句子在 ADR-0145 之後都要重問）。
- **「那一天已經結案、這一段會另起一筆」是 `closedDayLine()`**（壓表與 `aboveeConsequences()` 共用），跟 `settledDayLine()` 是兩句。
- **存一段新的健檢那一道要不要多一顆「順便把那一場二返接到這一次」只問 `bookingConsequences()` 回的 `relink`**（ADR-0146）：壓表與日曆新增都只讀那一格、存完都叫 `ui/relinkFollowup.js` 的 `relinkAfterSave()`，兩頁不自己叫 `relinkOffer()`（`tests/followup-relink-on-new-exam.test.js` 掃原始碼）；有那一顆時 `strandedOnNewExamLines({ offer })` 那一句的後半改成把那一顆的字講出來、接過來之後二返會排在健檢之前就多一句；存完那兩句是 `relinkedSay()`／`notRelinkedSay()`（沒接過來要講「健檢記好了」那一半）。
- `aboveeConsequences()` 不帶 `offer` —— 拍 Abovee 那一句一個字都不變。
- **拍 Abovee 的確認框讀一位一天的計畫**（`aboveeConsequences({ plan })`，ADR-0149）：「記成待確認」「會出現在確認時間／簽療程單」只數真的待確認的段、次數的括號讀計畫的 `rows`、照片放掉的段用 `cancelTaskLines(…, { freed })`（已經勾好的那一張不講「會多一張」）與 `registrationDropLines()`、健檢那條鏈整位套完之後算一次（存檔是一筆一筆存的：健檢先存、二返還沒做完的那一下會長「追蹤健檢報告」，**那一位全部存完之後** `data/visits.js` 的 `dropChainLeftovers()` 收掉中途長出來、最後用不到的 —— 規則是 `followups.js` 的 `chainLeftovers()`；存到一半失敗不收）—— 不要在確認框裡照狀態再推一次

## 稽核或回顧上那一句話

- 只寫在 `domain/audit.js` 的 `describeParts()`（拆成「誰」與「做了什麼」兩半，接起來走 `joinParts()`）。
- `ui/views/audit.js`、客戶詳情的變更紀錄、`domain/dayReview.js` 都讀它 —— 兩份寫法遲早有一份會漏掉名字或印出疊字（「勾掉某某的某某」就是這樣來的）。
- **額度與本輪可用性身上沒有名字**，只有路徑上有 id，所以名字由畫面解析後傳 `nameOf` 進來；問不到就不講，不編一個

## 新增一個會寫進稽核的欄位

- `domain/audit.js` 的 `FIELD_LABELS` 要補中文名（她改得到的照設定頁那一格的字）；**系統自己記的**（她沒有改它，例如 `statusAt`、`slotIndexes`、`importedFrom`）另外進 `QUIET_IN_SENTENCE`（句子不講、展開的表照列）。
- **不可以進 `NOISE_FIELDS`** —— 那會把它們從稽核紀錄整個拿掉（ADR-0071）。
- 查不到時 `fieldLabel()` 照舊原樣印英文，那是讓漏掉的看得見。
- `tests/audit-field-words.test.js` 釘著 10/7 量出來的名單

## 「今天做了什麼」要多列一種

- 分段只在 `domain/dayReview.js` 的 `STAGES`，**最後一段永遠收得下剩下的**（一則都不可以被丟掉，而且**照人與照流程兩種分組都要成立**）。
- 它是稽核紀錄的白話版，**不可以為了它多寫任何一筆資料**，見 ADR-0062

## 「今天做了什麼」的分段

- `domain/dayReview.js` 的 `STAGES`，**由上到下比、第一個對上的算數**，而陣列的順序就是她做事的順序。
- 所以要把一種從別段分出來時，改的是**前面那一段的條件**，不是把新的一段插到前面去（④登記掛號排掉「寫紀錄」就是這樣做的）

## 寫入的等待與失敗文案

- 只寫在 `ui/toast.js`（**Android「隨手記」那一份只寫在 `android/app/.../Say.kt`**，同樣不說失敗、不印 SDK 的英文）。
- **停多久、滑多遠算收掉**只寫在 `ui/toastSwipe.js`（純模組：`toast.js` 在 node 裡 import 不起來；停 12 秒，等待中／離線排著／要重試那三種不給滑 —— `swipeable()`，staging-polish 05）。
- **Firestore 的寫入 Promise 離線時既不 resolve 也不 reject**，所以 `catch` 接不到離線 —— 那條路走的是 `PENDING_MS` 的逾時，而它換上的那句話**不可以說「失敗」**（資料已經在本機快取裡，說失敗她會再存一次）。
- 常駐的離線提示是另一件事，在 `ui/net.js` 與殼上的 `.netbar`。
- `tests-e2e/specs/10-offline.spec.js` 盯著。
- **傳照片到 Storage 的寫入要自己給 `slow`**：預設那一句「已經存在這台裝置上了」只對 Firestore 成立，傳到一半的照片不在這台裝置上（`tests/save-guards.test.js` 盯著）。
- **那一句要真的送出過一次寫入才講**（`repo.commitsSent()`、`ui/saveFailure.js` 的 `slowSayNow()`，ADR-0158）：網路不穩時讀取要十秒左右才退回快取，接著可能被擋下來不存 —— 還在讀的那幾秒講它是假話。
- 失敗那一句與給不給重試只問 `failureOf()`：`IncompleteReadError` 與 `StaleWriteError` 不給重試（重試跑同一個閉包，拿的還是同一份）

## 一個會建立新資料的按鈕

- `toast.withSaveState()` 要傳 `key`。
- `tests/save-guards.test.js` 會掃出漏掉的，豁免要寫在它的 `ALLOWED` 裡並附理由

## 資料健檢那一頁的版面

- **只回答「有沒有事、要做什麼」**（ADR-0136）。
- **只是提醒的那幾項**帶 `notice: true`（現在是 `staleAvailability`、`importedLabel`，ADR-0150）：不算「要處理」、收成一行「名字・N 位」、結論照樣寫「沒有要處理的」—— 新增一項先問它是不是只是提醒（有東西、但沒有要她做的事）；她 10/18：「只要提醒就好，但是不要展開這麼多人」。
- 畫面只在 `ui/views/health.js`，檢查邏輯、`fix`、`CHECKS` 的 id 一個都不動。
- 同一位客戶的好幾筆靠 finding 上**選填的 `who`／`whoId`**收成一列（**照 `whoId` 分**，`who` 只是抬頭那個名字 —— 同名的兩位、改過名的那一位照名字會分錯） —— 新增一種講得出是哪一位的檢查就帶著它，沒帶的照舊一筆一列。
- **新的一項接在 `CHECKS` 最後面**（2026-10-09）：註解與文件裡用「第 32 項」這種編號指它們，插在中間會全部錯位；總數有兩支測試寫死（`health.test.js`、`seed-staff.test.js`）。
- **每一項都帶 `data-check`**（有事的卡片、沒事那一行裡的每一項都是；E2E 逐項找它），沒事的那一項裡藏著「沒問題」三個字。
- 收起來的列裡的修正按鈕照樣在 —— 測試要先點開那一列。
- `domain/health.js` 的字（`label`／`hint`／`detail`）會原樣上畫面：不寫 ADR 編號、`**`、反引號、不用「她」講她自己（`tests/no-dev-words.test.js` 盯著）
