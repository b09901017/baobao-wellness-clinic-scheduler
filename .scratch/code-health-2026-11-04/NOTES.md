# 這次怎麼查的、查過沒事的、學到的查法

給之後做健檢或回頭看這一份的 AI。發現本身在 `REPORT.md`。

## 查過、沒事的（不用再查一次，除非那一段後來改過）

- **安全規則**：沒登入只能 get 一份邀請、create 一份答案（`hasOnly` 白名單、`customerId`／`month` 拿邀請比、
  `submittedAt == request.time`、第二次送出是 update 所以被擋）；`formInvites`／`formResponses` 的 list 要白名單；
  `aiUsage` 瀏覽器寫不進去；Storage 只開 `treatmentSheets/{客戶}/{療程單}/{檔名}`、擋覆蓋用 `resource == null`、
  有大小與 JPEG 限制；療程單 `photoPath` 的正規表示式綁同一位客戶
- **拍照 Function**：登入＋白名單 → 暫停 → transaction 裡先預留再叫模型 → 回來換實際值；天花板 `CEILING_USD`
- **次數只有一份算法**：`counts()`／`slotOutcome()`；試算表 `customerReport()` 與 `syncBundle()` 都用它
- **`visitsData.save()` 的每一個呼叫端**都傳這位客戶的全部來訪，連存好幾筆時逐筆換進新的那一份
  （`bulkCancel.js:657`、`home.js:3586`）。只有來訪編輯器會沿用舊的（→ #1）
- **`applyConfirmation()` 每個呼叫端都傳 `asked`**
- **查詢 vs 索引**：每一個帶範圍或排序的查詢在 `firestore.indexes.json` 都有對應的複合索引
- **備份 vs 還原**：`exportAll()` 的集合與 `restore-backup.mjs` 的 `SECTIONS` 一致；還原會把 Timestamp 換回來
  （`reviveValue()`），所以還原後 `ifUpdatedAt` 比得起來
- **危險腳本的護欄**：`seed-staging`、`reset-staging` 拒絕正式站（沒有放行旗標）；`restore-backup` 要 `--allow-prod`；
  月底對帳的 `snapshot.mjs` 把 Admin SDK 的寫入方法換成丟錯
- **XSS**：客戶從公開表單送進來的字在收件匣（`formInbox.js`）與確認框（`dialog.js` 統一 `esc()`）都有跳脫
- **療程單換照片**：先傳新的 → 文件更新 → 才刪舊的；`replace()`／`create()` 呼叫端都 `undoable: false`
  （不然復原會把文件指回已刪掉的舊照片）
- **復原（`undo.js`）**：只還原這一次動到的欄位；多個 commit 的動作不給復原
- **examNotMine（11/2 才加的）**：額度計數、健檢鏈（`placeSeconds()` 照 `entitlementId` 算）、`withGiftKinds()` 都不會誤收它
- **`CLAUDE.md` 提到的 530 個 `xxx()` 函式名**都還在程式裡，只有 `describePair`、`lineHref` 不在 —— 那兩個是表上寫「已刪、不要加回」的
- **SPEC.md** 對 2026-10 之後的改動（`giftKind`、`trialMinutes`、`examNotMine`、`lineId`、`chartNo`、`longNotes`、沒選床位的診間拿掉）都跟上了
- **隨機操作**：寫了一支腳本對一筆來訪亂按 3000 輪（逐段確認／取消、`closeVisit` 三態、`withExtraSlot`、`rebookSlot`、
  `applyConfirmation`），`visit.status === visitStatusFrom(visit)` 一次都沒破

## 沒查到的範圍（下次可以從這裡開始）

- **UI 層大多沒逐支讀**（`public/js/ui/` 很大），只追了寫入路徑、`withSaveState` 的 `key`、幾處 XSS
- **`aboveeImport.js`（3470 行）只看了寫入那一段**（`planToWrite()`、`writePhotoPlan()`、暫時 id），比對與認領的邏輯沒逐條驗
- **`mergeImport.js`／`legacyImport.js`** 沒深查（切換那天之後不會再整份匯入）
- **`sheets/readonly-report.gs`** 只看了收件口與鎖、指紋，畫法沒看
- 4 支因為沒有 `node_modules` 跑不起來的測試（見 `REPORT.md` 開頭）
- 沒開模擬器，**所有重現步驟都是照程式碼推的，沒在畫面上點過**

## 這次學到的查法

- **這個 repo 的單點邏輯很少錯**（測試多、註解把理由寫得很細），錯的幾乎都在「兩個時機之間資料變了」：
  打開畫面 → 按存檔之間、掃描 → 按修正之間、按下去 → 寫完之間再按一次。下次直接從這個角度掃：
  每一個 `withSaveState(...)` 有沒有 `key`、裡面的寫入是不是冪等（id 是先鑄好的還是每次新的）、
  寫入用的那一份是按下去那一刻讀的還是畫面打開時讀的
- **「打開時讀一次就沿用」要問兩件事**：來源是不是伺服器（ADR-0158 管的），**以及是不是現在的**（沒有人管）
- **`tests/save-guards.test.js` 的視野只有 `.create/.take/.save(`**：名字不叫這三個、但會建資料的呼叫（`applyFixes`）它看不到
- **文件過時最快的找法**：用 node 把文件裡 `「…」` 的字抽出來，逐一在 `public/` 找，找不到的再看前後文。
  shell 的 `grep -o` 會把中文切壞（那台機器 locale 不是 UTF-8），要用 node
- **`CLAUDE.md` 的函式名對帳**：抽出所有 `` `xxx()` ``，在程式碼裡找定義，一次就知道表有沒有指到不存在的東西
- **重現腳本**：domain 是純函式，`node -e` 直接 `import('/…/public/js/domain/visits.js')` 就能跑；
  `data/` 那一層 import 了 `https://www.gstatic.com/…` 的 SDK，node 載不起來，只能讀
