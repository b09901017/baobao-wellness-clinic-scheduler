# 合併檔一開始就是新的：EECP體驗 → EECP＋20 分＋體驗；沒床位的 .8／VIP7 不給診間；重產她那一份

Status: todo
Blocked by: 09、10（種子先變，產檔那側才知道要對到哪一門、哪一間）
段：五（xhigh，跟 10 一起）
動工前先讀：`.claude/skills/calendar-sheet-merge/SKILL.md`（決定檔、`--board`、`record.mjs`）；`scripts/merge.mjs` 的 `TOKENS`（`:62-72`，`EECP體驗` 與 `EECP` 兩條）、`startOf()`、`endOf()`、`roomOf()`、`applySlotDecisions()`（決定檔「加一段」的 `free: '體驗'|'送的'`）；
`public/js/domain/legacyImport.js` 的 `parsePurchaseCell()`、`resolveCourse()`、`:109` 那一條對照（`'EECP體驗': 'EECP體驗'`）與 `:1215` 那一句；`public/js/domain/mergeImport.js` 的 `FORMATS`、`planForCustomer()`、`addExtraVisits()`、`slotsMissingEntitlement()`；
`tests/calendar-merge*.test.js`、`tests/merge-*.test.js`；CLAUDE.md「舊表 B2、合併檔的購買欄位」「一段來訪要排多久」（`endOf()` 是第二份、順序要一樣）兩列；
她的那一份在 `.local/references/cutover-2026-10-14/`（`run-merge.mjs`、`overlay.mjs`、`overrides.1017.json`、`out-1017/`、`切換那天-清單-2026-10-17.md`）—— **有真名，只在本機跑、終端機只印數字**；
基準比對：`.local/references/merge-baseline-2026-10-06/baseline.mjs`（記憶「改種子之後要另外查的七個地方」）

## 她要的

> 能不能幫我去改合併檔就好，反正現在我也還沒有真的開始使用，隨時都可以清空重來，沒有舊的之分，我要匯入時是新的就好，包含你說的點滴8，vip7還多少，一樣，沒有舊資料的問題，刪掉之後幫我合併檔更新就好
>
> 不要在靠資料健檢處理，一開始匯入時就應該是好的，

> 2. … 要，但我希望如同我最上面說的，除了資料健檢多一列之外我希望下次我再匯入的時候就是最新的了，不需要再有EECP體驗

## 為什麼會這樣

產檔那側照種子的名字寫：`TOKENS` 把行事曆的「EECP體驗」寫成 `courseName: 'EECP體驗'`，舊表的「EECP體驗」那一欄由 `legacyImport.js` 對到同名的課。
09 拿掉那一門之後，app 的匯入會**對不到主檔**（一段都匯不進去，或整位卡住）。

**查過的事實**（10/18，只印數字）：`out-1017/import-final.json` 有 **1 段** `courseName: 'EECP體驗'`（證據寫著 Abovee `EECP20`）、**0 段**沒床位的點滴8／VIP7；
`import.json`（overlay 之前）有 4 處提到 EECP體驗 —— 要看是不是有一筆是**購買**（額度）或**候選**，不是只有段。

**候選那兩種沒有 `giftKind`**（過目查到、主控對過）：`futureVisits`／`missingFromSheet` 只帶 `courseName`（`merge.mjs` 約 `:1458-1466`），
app 這側 `addExtraVisits()` 判「扣不扣」只問 `isUncounted(course)`（`mergeImport.js:594`、`:614`）。EECP體驗 是預設體驗的課，所以今天不扣；
`TOKENS` 改成寫 `EECP` 之後，一筆 EECP 體驗的候選會**扣掉那位客戶身上唯一一筆 EECP 額度**，或因為「沒有這個課程的額度」被丟掉。

## 要做的

1. `TOKENS`：「EECP體驗」→ `courseName: 'EECP'` ＋ `giftKind: 'trial'`（v7 的那一格，一般的段沒有這個鍵）；時長交給 app 的 `slotMinutes()`（09 第 2 點：體驗的 EECP 沒選就是 20）——
   `endOf()` 也要算出 20（它是第二份、順序要一樣：送的／體驗的段＋那門課有「體驗排幾分」→ 那個數字），不然合併檔寫的 `endsAt` 跟 app 一存檔重算的不一樣
2. 舊表「EECP體驗」那一欄（`legacyImport.js`）：如果是**購買**（舊表上的一筆次數），現在沒有那一門課可以掛 —— 先看她的資料有沒有這種；有的話問她（它是當初買的體驗券？要變成 EECP 的額度？）；
   沒有的話把對照改成 EECP＋體驗、`purchaseProblems` 收一句，並在報告 ⓪c 講出來（**安靜失效的決定跟沒有決定長得一模一樣**）
3. 決定檔（`.local` 那一份）裡「加一段」指名 `EECP體驗` 的：改成 EECP＋`free: '體驗'`（她的那一份要一起改 —— CLAUDE.md：改格式要同時改她那一份）。對不到的決定一定進 ⓪d
4. `roomOf()`：10 的那一條（`.8`／`VIP7` 不給診間、報告講一句）
5. **候選也帶 `giftKind`**：`futureVisits`／`missingFromSheet` 每一筆多 `giftKind`（`'trial'`／`'gift'`；一般的沒有這個鍵，同 v7 的段），
   `addExtraVisits()` 讀它：有 `giftKind` → 不扣任何額度、寫實那一格；沒有 → 照舊（`isUncounted()` 那一條留給舊檔案）。
   **這是新欄位，所以升 `baobao-merge/v8`**（CLAUDE.md「舊表 B2、合併檔的購買欄位」：只加欄位不升版的話，舊版 app 會安靜地吃掉那幾格）：產檔那側一律寫 v8、`FORMATS` 收 v8 也照舊收 v7、`tests/calendar-merge.test.js` 盯著兩邊的版本字串。
   `slotsMissingEntitlement()` 認得「EECP＋體驗、沒有 `entitlementKey`」那一段（v5 起就認得送的／體驗，確認一次）
6. **重產她那一份**：照 `.local/references/cutover-2026-10-14/` 那一套（`run-merge.mjs` → `overlay.mjs` → `check-final.mjs`／`validate.mjs`）產新的 `import-final.json`，
   跟 10/17 那一份比：**只差那 1 段**（EECP體驗 → EECP＋體驗＋20 分）與報告多的那幾句；其餘每一格一樣（只印數字與差異的種類）。
   拿模擬器匯一次（`emu-import.mjs`／`emu-verify.mjs`，種子是 09、10 之後的）：整份匯得進去、沒有「對不到主檔」
7. `.local` 的 `切換那天-清單-2026-10-17.md`（或下一份）補一句：用的是哪一份檔、staging 要先 `npm run staging:reset`（舊主檔還有 EECP體驗與點滴8）
8. 文件：skill 的 `references/answers.md`（過目查到 3 處寫著 EECP體驗；SKILL.md 本身沒有）、SKILL.md 的格式那一段（v8、候選的 `giftKind`）、CLAUDE.md「舊表 B2」那一列（`EECP體驗` 那一條、v8 那一句）

## 判準

- 假資料：行事曆一筆「14:45 EECP體驗 治8」→ 合併檔那一段 `courseName: 'EECP'`、`giftKind: 'trial'`、`endsAt` 是 15:05；匯進模擬器後 `slotName(short)` 是 `EECP(20)(體驗)`、不扣任何額度
- 假資料：決定檔「加一段 EECP體驗」→ 寫成 EECP＋體驗；指名一門不存在的課 → 進 ⓪d
- 假資料：行事曆一筆**未來的**「EECP體驗」（成為 `futureVisits` 候選）、那位客戶身上有一筆 EECP 額度 → 她勾起來匯進去：那一段是體驗、**那筆額度的已排沒有多 1**
- v7 的舊檔案照樣匯得進去（`FORMATS` 收著）；v8 檔案給認不得 v8 的舊版 app → 整份拒收（不是安靜吃掉）
- 她那一份：新舊兩份 `import-final.json` 只差上面那 1 段（終端機只印「差 1 段，種類：EECP體驗→EECP體驗」這種數字與種類，不印名字）；模擬器整份匯得進去
- `grep -rn "EECP體驗" .claude/skills/calendar-sheet-merge/scripts` 只剩認舊字的那一條 regex

## 做完時留下的

（做完寫）
