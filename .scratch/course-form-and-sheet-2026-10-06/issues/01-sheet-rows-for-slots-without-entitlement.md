# 試算表：沒有額度的段自己一列（功醫門診、HRV）

Status: done（PR #139 → `develop`，2026-10-06 開的；等她說才合）
來源：她 2026-10-06 第四點（bug）
動工前先讀：`public/js/domain/sheetReport.js`（`syncBundle()`、`customerReport()`、`mark()`）、`sheets/readonly-report.gs` 的 `renderCustomer()`、
`tests/sheet-report.test.js`、`tests/sheet-script.test.js`、`tests/uncounted-courses.test.js`、ADR-0121、**ADR-0063（「兩者在資料上完全不相交」那張表）**、ADR-0013、
`CLAUDE.md` 連動表「試算表的註記」與「試算表的 `SYNC_FORMAT`」兩列
Blocked by: —
分支：`claude/sheet-rows-without-entitlement`（PR A，從 `origin/develop` 開；**不帶任何 `.scratch` 檔**），`sw.js` v163

## 她要的

> 第四 : 有關試算表
> 我發現如果我寫功醫門診，會出現在來訪清單那邊沒錯但是不會出現在表格裡，當天的日期會全是空的 ?
> 能不能如果我有選到功醫門診或是那些不算次數的，可以有標註或是直接表格的療程項目多一個他
> 也要幫我檢查有沒有其他試算表的問題，試算表的正確與否對我來說很重要

## 為什麼會這樣

`syncBundle()`（與手動貼上那條路 `customerReport()`）：

- **日期欄**從這位客戶所有還算數的來訪來：`dates = [...new Set(visits.map((v) => v.date))]`
- **列**只從額度來：`scheduled = alive.filter((e) => !isProduct(e))`，一筆額度一列
- 那一格的符號由 `mark(visits, e.id, date)` 算，只收 `slot.entitlementId === entitlementId` 的段

所以一段**沒有額度**的來訪有日期欄、沒有任何一列可以打符號。來訪紀錄（`log`）是逐段算的，所以那邊有。
這是 ADR-0121（不算次數的課，`entitlementId` 是 null）上線那一刻就有的洞；上一輪的 15 只補了那一段的記一句（格式 7）。

**同一類的洞還有一個，一起補**：額度後來被刪掉的那幾段 —— `alive` 濾掉了那一筆額度，那幾段指著的 id 對不到任何一列。

### n返 **不在這一支裡**（審查查到的）

n返（三返、四返）那一天自己那一欄也是空的，但**那是她定過的**：ADR-0063 那張表寫「`sheetReport` 的矩陣｜不（她要的就是『記在健檢底下』）」，
`tests/sheet-report.test.js` 有一條「n返 不進矩陣」，斷言訊息引她的話「三返不會自己多一列」。
第一段我跟她說會一起補，那時候沒翻到這一條。**這一支不動 n返**；要不要推翻那一條列在 `spec.md`「等她回的」，她說要才另開。

## 談定的做法

矩陣最下面（所有額度列之後）多幾列，**一門課一列**：

- 收哪幾段：還算數的來訪裡，`isLiveSlot(slot)`、**不是 n返**（`nthOf(slot)` 是空的），而且 `slot.entitlementId` 不在這位客戶畫出來的那幾列裡
  （空的 → 不算次數；有值但對不到 → 那一筆額度被刪了或不存在）
- 怎麼分列、叫什麼：
  - 沒有額度的段 → 照 `courseId` 一列，`功醫門診（不算次數）`。**名字讀主檔**（一門課一列，她之後改名也還是一列）；主檔找不到才退回 `slot.courseName` 快照。
    來訪紀錄那一行照舊印快照（既有行為，不動）—— 她改過課名之後同一段在表上會有新舊兩種名字，那是歷史紀錄留著當時的字（`seed.js` 對 `courseName` 的說法）
  - 指著對不到的額度的段 → 照 `courseId` 一列，`復能（額度已刪除）`。**名字只能是課程名**：自動推送那條路讀不到已刪除的額度
    （`data/sheetSync.js` 走 `entitlementsByCustomer()`，`repo.listGroup()` 預設濾掉已刪除），所以同一門課被刪的幾筆收成一列
- 數字：**「應有」「剩餘」寫 `—`**；「已完成」「已排未上」寫實際的次數 —— 一段算 done 還是 booked 跟額度那幾列同一個判斷
  （`domain/entitlements.js` 的 `slotOutcome()`；不另寫一份）
- 符號：把 `mark()` 改成收一個「這一段算不算這一列的」判斷式，額度列與這幾列共用同一支
- **不進合計**：`totals` 現在是 `rows.reduce(...)`，**要在接上新的列之前算**（不然會加出字串）
- `equipmentNotes`／`slotNotes` 的 `rowIndex` 指的是額度列的位置，新的列一律接在後面，所以不受影響
- 那幾段的記一句照舊印在來訪紀錄那一行（格式 7），這裡不印第二次
- 每一列多帶一格 `extra: true`（之後 `.gs` 要畫成不一樣的樣子時用得到；現在那一份 `.gs` 不讀它）
- `customerReport()`（手動貼上）走同一支，兩條路長一樣。它在一筆額度都沒有時印一列「（還沒有額度）」—— 有新的那幾列時那一列照舊印在最上面
  （她看得出這位客戶沒有買東西），還是不印，動工時挑一個寫進「做完時留下的」

### 不升 `SYNC_FORMAT`、她不用重貼 `.gs` —— 但要驗

`rows[]` 每一筆的鍵沒有變，只是這幾列的 `total`／`remaining` 是字串 `—`。審查讀過 `.gs`：`renderCustomer()` 把那兩格原樣塞進 `setValues`，
上色是 `r.done > 0`、`r.booked > 0`、`r.remaining === 0`，字串不會被當成 0 塗紅；`infoLine()` 只讀 `totals`；`ensureSize()`、`banding()`、`finish()` 只看列數。
**動工時在 `tests/sheet-script.test.js` 的假 Apps Script 環境裡真的畫一次**：那一列出現、「剩餘」那一格沒有變紅、合計那一行不變。
驗不過才升成 8 並請她重貼 —— 那時候 PR 內文與交接檔要寫。

### 既有測試會紅的三處（審查讀斷言推的，沒有實跑）

- `tests/uncounted-courses.test.js`「功醫門診那天每一列的數字不變」那一條：它比的是整個 `sheet.rows` —— 改成只比額度那幾列，另外斷言新的那一列
- `tests/sheet-script.test.js` 共用夾具 `bundle()` 裡有一段指著不存在的額度：改完之後每一條渲染測試都會多一列「（額度已刪除）」—— 夾具改掉，或期望值跟著改
- `tests/sheet-report.test.js`「n返 不進矩陣」那一條的 `rows.length === 2`：n返 不動，這一條**應該照舊綠**；它紅了就是把 n返 收進來了

## 判準

- 一位客戶某一天只做功醫門診：那一天那一欄，「功醫門診（不算次數）」那一列有 ✓？上面合計那一行的四個數字一個都沒變？
- **一筆額度都沒有的客戶**（她說的「邀客戶來體驗」：只做 HRV＋功醫門診）：矩陣只有那兩列、合計四個 0、表畫得出來不出錯
- 同一天 SIS（有額度）＋功醫門診：兩個符號各在各的列、各一次？
- **這一行會不會讓一段不算次數的被算進某一筆額度，或反過來？** 她買了營養師諮詢、之後自己勾了不算次數：
  選額度排的那一段在額度那一列（照扣），選「不扣次數」那一顆排的在「營養師諮詢（不算次數）」那一列
- 取消的段不出現；一門課只剩取消的段時整列不長
- 三返：一個字都沒變（那一天自己那一欄照舊是空的、健檢那一欄底下那一行照舊）
- 不變量（寫成測試，夾具要有每一種段：有額度、擇一池、二返、n返、不算次數、取消、未到、額度被刪）：
  1. 每一個日期欄至少有一格有符號 —— **只有 n返 的那一天除外**（等她回）
  2. 每一段還算數、不是 n返 的時段剛好落在一格
  3. 每一列 ✓ 的總數＝那一列的「已完成」
  4. 來訪紀錄的行數＝還算數的段數
- 她說的「也要幫我檢查有沒有其他試算表的問題」：除了這一支，審查讀出一個 —— **試算表只讀今天前後 400 天的來訪**（13，等她說）。
  這一支另外試著拿她機器上 `.local/references/` 最新那一份合併檔走 `domain/mergeImport.js` 組出來訪與額度、餵給 `syncBundle()` 跑一次不變量
  （**終端機只印數字，不印名字**）。組不起來就在「做完時留下的」寫沒做到，不要寫成做了

## 連動

- `CLAUDE.md` 連動表「試算表的註記」那一列補一句：沒有額度的段（n返 除外）在矩陣裡有自己一列、不進合計（12 一起收，或這一支先補）
- `SPEC.md` 試算表那一節、`docs/常見問題.md`（「試算表最下面多了一列」）
- `public/sw.js` 的 VERSION（`public/` 底下動了）
- 03 之後 HRV 也是這一種，不用再改

## 做完時留下的

- 分支 `claude/sheet-rows-without-entitlement`，commit `f8e809c`，PR #139。**這一支分支上沒有任何 `.scratch` 檔**
- `sheetReport.js` 新的一支 `extraRows({ scheduled, visits, dates, coursesById })`（有 export，測試直接叫得到）；`mark()` 第二個參數從額度 id 改成判斷式，額度列傳 `ownedBy(id)`
- 一列的鍵：`label`、`total`（一槓）、`done`、`booked`、`remaining`（一槓）、`marks`、`extra: true`。`rows` 是「額度列＋這幾列」；`totals` 只加額度列
- 分列的鍵：沒有額度的照 `courseId`（沒有 `courseId` 才用 `courseName`），額度被刪的另外一組。**排序**：不算次數的在前、額度被刪的在後，各自照名字
  （`localeCompare(…, 'zh-TW')`：中文排在英文前面，所以功醫門診在 HRV 上面 —— 跟那一天誰先做無關）
- 「算不算一段」問 `slotOutcome()`：取消的回 `null`、不佔任何一列；未到印 ✗、不算已完成也不算已排未上（跟額度列一樣）
- 手動貼上（`customerReport()`）：一筆額度都沒有時「（還沒有額度）」那一列**照舊印**，新的列接在它下面
- **`SYNC_FORMAT` 沒動（7）、`.gs` 沒動、她不用重貼**。在假的 Apps Script 環境裡畫過：那一列出現在額度列底下、「剩餘」那一格沒有被塗成紅的、
  「已完成」照樣有底色、第二列那句合計不變、一筆額度都沒有的客戶畫得出來
- 會紅的既有測試只有一處真的紅：`tests/uncounted-courses.test.js` 那一條（改成只比額度列、另外斷言新的那一列）。
  `tests/sheet-script.test.js` 的共用夾具裡那一段指著不存在的額度，現在多畫一列「二返（額度已刪除）」，既有的斷言沒有一條因此紅；
  `tests/sheet-report.test.js`「n返 不進矩陣」照舊綠
- 新測試 `tests/sheet-rows-without-entitlement.test.js`（26 條，含不變量四條）
- **真檔對過了**：拿她機器上 10/5 那一份合併檔走 `planForCustomer()` → `syncBundle()`（29 位、159 筆額度、129 個日期欄、198 段，只看數字）：
  空白欄 0、每一段剛好落在一格、每一列 ✓ 的數量＝已完成、來訪紀錄行數＝段數。那一份資料裡沒有不算次數的段，所以多的列是 0 —— 新的那幾列只在測試夾具與假的 `.gs` 環境裡驗過，**她的真試算表上還沒有人看過**
  （腳本在這個 session 的暫存區，沒有進 repo；要再跑的話照這一段的描述重寫，十幾行）
- `npm test` 3461 條全綠；相關的 E2E 3 支（`00-smoke`、`09-sheet-and-import`、`10-offline`）16 passed
- `sw.js` v163；`SPEC.md` 4.8 多一段、`docs/常見問題.md` 試算表那一節多一條、`CLAUDE.md` 連動表「試算表的註記」那一列補了
- **沒做的**：n返 那一天自己那一欄照舊是空的（等她回）；400 天的窗（13，等她說）
