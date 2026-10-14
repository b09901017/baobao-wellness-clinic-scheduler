# 拍 Abovee：多抄「預約來源」，寫「體驗」的那一列自動標體驗、不用額度

Status: done
Blocked by: 04（預選要畫在 04 那一排）、05（判準的心臟門診那兩條靠種子）
動工前先讀：`spec.md`「拍 Abovee 認體驗」；ADR-0099（抄字格式不長 id 與狀態）、ADR-0100（考試結果、重考）、ADR-0101（照片不存）、ADR-0123；
`functions/transcripts/aboveeList.js` 檔頭與 schema（寫死「十欄」「十個」那幾處）；`public/js/domain/transcripts.js`；
`domain/aboveeImport.js` 的欄名對照、`RIGHT_KEYS`、`EDGE_KEYS`（`fullerCell()`）、`resolveItem()`、`pickOption()`、`mergeRows()`；
CLAUDE.md「AI 的抄字格式」與「拍 Abovee 記很多段」兩列；`docs/STAGING.md`「部署那一支 Function」

## 她要的

> 然後abovee拍照也可以辨識出來就不用還要先去新增額度才能辨識或是新增 (因為目前是不是要先有一筆額度可以扣。沒有的話那一段存不下去，要先加一筆送的 ? )

第一段回她的：功醫門診、HRV 已經不用；心臟門診、EECP體驗 05 之後不用；復能、復健門診、ILIB 的體驗要靠這一支。

## 為什麼會這樣

- Abovee 把「體驗」寫在**預約來源**那一欄（其他值是正式課、顧客會、合作機構名），課程那一格寫的是 `IN 30`、`復健門診`。
- 抄字只抄十欄（`ABOVEE_COLUMNS`，兩份），沒有預約來源 —— 檔頭寫著「電話、身份別、性別…一律不抄」，預約來源當時沒有用處。
- 所以一列 IN 30 體驗在確認層照扣額度預選；沒有復能額度的人那一列沒有能按的、存不下去。
- 預約來源在**左右兩半的交界**（左半最後一欄、右半第一欄）—— 跟「診間」同一個位置，10/5 考試時診間被切掉一半抄成「治療」（prelaunch-fixes 13）。

## 要做的

1. 兩份 `ABOVEE_COLUMNS` 加 `預約來源`（`tests/ai-transcripts.test.js` 盯著兩邊一樣）；提示詞那一欄照抄原字，**寫死「十欄」「十個」的地方一起改**（`aboveeList.js:34`、`:61`、`ABOVEE_KEYS` 的註解）。
   **不加任何「是不是體驗」的欄** —— 翻譯是 domain 的事（ADR-0099）
2. `aboveeImport.js`：欄名對照加 `預約來源: 'source'`；**同時加進 `RIGHT_KEYS`**（左半張沒拍到那一欄時從右半補）**與 `EDGE_KEYS`**（兩邊都有字時取比較長的，切到一半的不蓋掉完整的）。
   `tests/abovee-halves-room.test.js:113-114` 釘著那十欄，跟著改
3. 「這一列是體驗」只有一支（`isTrialRow()` 之類：那一格去空白後含「體驗」）。`resolveItem()` 預選：
   - 是體驗、課程認得、`canBeGift()` 是 true → `giftPick(課程)`＋`giftKind: 'trial'`，器材與分鐘照照片（02 的 `pickOption()`），**不看身上有沒有額度**（她選的第一題）
   - 不是體驗 → 照舊（不算次數的課身上還有剩就扣、沒有剩就體驗；其餘挑額度）
   - 是體驗、課程是健檢或二返 → 照舊挑額度，那一列多一句「Abovee 寫體驗，健檢／二返沒有體驗 —— 照扣」，**進 `mustSee()`**（她沒點開就扣了一次）
4. 「換一位」（`resolveItem()` 的 `next`）重算時體驗照樣成立（那是照片上的字，不是認人的結果）
5. 合併扣課：`mergeRows()` 跳過 `giftKind` 有值的列（現在跳過不算次數的）。一列體驗的「合併扣課」寫「是」時會被標成 `mergeOrphan`、不勾（:1046-1048）——
   決定：體驗的列不參與合併扣課，`mergeOrphan` 不標（體驗不扣，沒有「扣兩次」的風險）
6. 舊的 Function（還沒重新部署）抄不到那一欄 → `source` 是空的 → 走「不是體驗」那條，**行為跟今天一模一樣**（寫一支測試釘著）
7. 重考：`scripts/ai-exam.mjs --only aboveeList`（答案與結果只在 `.local/references/ai-exam/`，終端機只印數字）。`scoreAbovee()` 只算答案檔有的欄位（審查確認過），多抄一欄不扣分；
   要量預約來源抄得對不對，答案檔補那一欄（**有真名，只在 `.local/`**）。分數寫回 ADR-0100「考試結果」
8. 部署 staging 的 Function（STAGING.md「部署那一支 Function」）；正式的上 main 那天部署（09 的手動清單寫進去）

## 判準

- 一列 `IN 30`、預約來源「體驗」、這位客戶有一筆 復能-三選一(30) 剩 5：預選 INDIBA 30 分**體驗**、不扣、剩 5 不變；存下去 `equipmentId` 是 INDIBA
- 一列 `心臟門診`、預約來源「顧客會」、沒有心臟科評估額度：預選體驗（05 之後那門課不算次數）
- 一列 `心臟門診`、預約來源「顧客會」、有一筆心臟科評估剩 1：預選那一筆、扣（ADR-0121 不變）
- 一列 `SIS 60`、預約來源「正式課」：照舊扣額度
- 左半張預約來源被切成「體」、右半張完整「體驗」：接起來是「體驗」；左半張沒有那一欄、右半張有：補得進來
- 抄字沒有預約來源那一欄（舊 Function）：每一列的預選跟改之前一模一樣
- 一列健檢、預約來源「體驗」：照扣、那一句收著也看得到
- 重考分數不比 10/9 那一次低（ADR-0100 有數字）

## 做完時留下的

- 抄字：兩份 `ABOVEE_COLUMNS` 多「預約來源」（排在合併扣課與診間之間，照 Abovee 上的順序）；提示詞那一欄「照畫面寫（例：體驗、正式課、顧客會）」，
  寫死「十欄」「十個」的地方都改成十一。**沒有任何翻譯欄**（ADR-0099）。`tests/abovee-halves-room.test.js` 那一條改名（「十一欄、五格」）
- `aboveeImport.js`：`ABOVEE_KEYS` 多 `預約來源: 'source'`，**`RIGHT_KEYS` 與 `EDGE_KEYS` 都加了**（左半沒有從右半補、兩邊都有取比較長的）。
  `isTrialRow(row)` 是唯一的判斷（那一格去空白後含「體驗」）
- `resolveItem()`：n返 → 寫體驗而且 `canBeGift()` → `giftPick(那門課)`（`giftRow()` 給 `trial`、照片上那一台屬於這門課才留）→ 其餘照舊。
  **不看身上有沒有額度**。「換一位」照樣是體驗（`next` 不清 `row`）
- 健檢、二返寫體驗：照舊挑額度，`warningsByRow()` 多一句 `trialSay()`（**進 `mustSee`**，收著也看得到、存檔前那一道也數到）：
  `Abovee 上寫體驗 —— 健檢、二返沒有體驗，這一段照扣一次`；她自己在寫體驗的那一列改按扣額度時是 `Abovee 上寫體驗，這裡選了扣額度 —— 照扣一次`。
  `warningsByRow()` 多收 `courses`（確認層傳 `ctx.master.courses`）；課程那一格認不出來的那一列不知道是不是健檢 → 講「這裡選了扣額度」那一句（09 自己審查時補的）
- 合併扣課：`mergeRows()` 的 pool 本來就跳過 `giftCourseId`；`mergeOrphan` 也跳過送的／體驗的列（不扣，沒有扣兩次的風險）
- 確認層「照片上寫的是」那一排多一顆預約來源（`seenChip(r.source)`）—— 她看得到為什麼被選成體驗
- **重考**（ADR-0100 寫了）：答案卷 2 張沒有退步（服務資源 9/10、其餘照舊），預約來源拿擷取檔對 10/10、10/10；
  她的 7 張手機照片考兩次，預約來源 18/18、15/15，那一列真的體驗兩次都抄到、沒有一列被抄出假的「體驗」。花 US$0.11。
  `.local/references/ai-exam/abovee-photos-exam.mjs` 多考預約來源、輸出檔名照 `EXAM_DAY`
- **staging 的 Function 10/14 部署了**（`--project staging`，沒登入叫不動驗過）。**正式的上 main 那天部署**（09 的清單）
- 新測試：`tests/abovee-trial-source.test.js`（18 條：欄位、`isTrialRow`、判準每一條、左右兩半、舊 Function、合併扣課）；
  E2E `67` 的 G9（假抄字 `aboveeList-trial.json`），`related.js` 把 `aboveeImport.js`、`aboveeConfirm.js`、`transcripts.js`、`functions/transcripts/`、那一份假抄字登記給 `67`
- 相關 E2E（`--related --base 5ca5d7f`，13 支、74 條，無頭）：**全過**（8.9 分）
