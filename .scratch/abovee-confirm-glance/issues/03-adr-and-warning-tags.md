# 03：ADR-0170 ＋ 紅字的短標記（domain）

Status: done
Blocked by: —

## 動工前先讀

- `spec.md` 第二件
- `docs/adr/0138-*.md`（收著也要看得到的那幾種）、`docs/adr/README.md` 的索引、`docs/agents/domain.md`（ADR 的寫法）
- `public/js/domain/visits.js` 的 `warningDetails()`、`MUST_SEE`／`mustSee()`（約 1940–1990 行）
- `public/js/domain/aboveeImport.js` 的 `warningsByRow()`（約 3135 行）、`photoDayPlan()` 回的 `mustSeeBy`（約 2855–2875 行）、`trialSay()`、`briefWarnings()`
- `tests/tip-red-lines.test.js`、`tests/abovee-warnings-in-sight.test.js`（釘著現在的行為）

## 她要的

> 2. 你說「全部」裡那一列不寫字，只留一個紅色小點，我覺得一樣可以有提醒，簡短的，像是⚠ 撞期 ⚠ 次數不夠⚠ 禁忌 +1⚠ 過期⚠ 品項⚠ 重疊⚠ 健檢等等 ，一列有好幾個提醒時，只寫最要緊的那一個，後面接「+1」字是紅的、短的，掃過去一眼就看得到，又不會像現在一樣每列底下多一兩行 你覺得呢?

先後（我回她的、她接受）：禁忌 → 次數不夠 → 撞期 → 重疊 → 過期 → 品項 → 健檢。

## 為什麼會這樣

- ADR-0138：會改變寫入結果的那幾種提醒（`mustSee()`：`notice` 器材對警示、`overlap` 同一筆裡重疊、`entitlement` 超用與到期、`ivMismatch` 品項、`conflict` 撞期、`examNotMine`）
  收著也畫在列底下（`briefWarnings()` 最多兩句＋「還有 N 句」）；拍 Abovee 自己另有 `trialSay()`（體驗照扣）也進 mustSee
- `photoDayPlan()` 的 `mustSeeBy` **只留字串**（`mine.filter(mustSee).map((w) => w.text)`）—— 要短字就要知道 `source`，現在拿不到；`trialSay()`、`mergedNotices()`、`photoRowSays()` 那幾句本來就只有字串
- `entitlement` 一種 source 同時是「次數不夠（超用）」與「過期（到期）」—— 她要分兩個字。要嘛 `warningDetails()` 那一圈多帶一格（例 `kind: 'over'|'expired'`），要嘛拆成兩個 source；
  **拆 source 會動到 `MUST_SEE` 與每一個比 `source` 的地方**（grep `source ===`、`source:`），帶一格比較小

## 要做的

- **ADR-0170**（照 `docs/agents/domain.md`）：拍 Abovee 確認層分兩頁「辨識結果」／「發現問題 N」；辨識結果不畫整句、一列一個短標記（最要緊的一個＋`+N`）；
  整句在「發現問題」那一頁與點開那一列；按「記錄」那一道確認框照講「其中 N 段有提醒」。**推翻的寫清楚**（過目 M1）：
  - ADR-0138：拍 Abovee 收著的那一兩行（壓表、來訪編輯器不變）
  - ADR-0129 約 51–52 行：「沒有的時候也講一句（少了它分不出沒有／沒檢查）」→ 沒有就不畫；「發現問題」那一顆 0 件時灰掉就是「檢查過了、沒事」
  - ADR-0153 約 30 行那一句「照片上的 ○○ 還沒認出是誰，先沒對」：放在發現問題、算一件（E2E `41` 約 204 行釘著那一句的字）
  - 「發現問題 N」的 N 怎麼數（見 04）、「還差一步」的列怎麼標（見下）
  - `docs/adr/README.md` 索引加一列；0138、0129 那兩列標「部分被 0170 推翻」
- **`mustSeeBy` 維持字串**（`record()` 的 flagged、consequences、好幾支單元測試讀字串，過目 E7），在 `photoDayPlan()` 兩條路（約 2855–2875 與 `warningsByRow()` 約 3135–3150）**並排產一份 `tagBy[key]`**：每一句帶一個來源
- **來源不只 `warningDetails()`**（過目 E5）：`warningsByRow()` 的 mustSee 另外有 `trialSay()`（體驗照扣）、`mergedNotices()`（合併扣課另一台的器材警示，約 2146–2155）、
  `photoRowSays()`（照片上的狀態記成別的、`closeBlock`，約 3143；那一支有 6 種 code，約 598）—— 都是字串，**每一種都要指定短字**。建議：
  `notice`／`mergedNotices` → 禁忌；`entitlement` 超用 → 次數不夠、到期 → 過期；`conflict` → 撞期；`overlap` → 重疊；`ivMismatch` → 品項；`examNotMine`／`closeBlock` → 健檢；`trialSay` → 體驗；照片狀態那幾種 → 狀態
- **超用與到期**：在 `entitlementWarnings()`（visits.js 約 2115、2120）帶一格 `kind`，**`from()`（約 1964）要一起改**，它重組物件時只留 `text`、`source`、`slots`，不改就被丟掉（過目 E6）。不拆 source（拆的話 `MUST_SEE` 與每一個比 source 的地方都要動）
- domain 一支（例：`warningTag(list)` 收 `{ source, kind }` 的陣列 → `{ text: '撞期', more: 1 } | null`）：短字對照與先後**只寫在這裡**；不在對照表上的排最後、用通用的「提醒」而不是不畫；
  **「還差一步」**（勾著、`problems` 有東西）也給一個標記「還差一步」，排在所有紅字後面 —— 不然拿掉列底下那一行之後她找不到是哪一列（過目 M2）
- 單元測試：每一種來源對到的字、先後、`+N` 的 N（**算種不算句**，寫進 ADR）
- **`tests/tip-red-lines.test.js`（約 69 行）、`tests/abovee-warnings-in-sight.test.js`（約 273–281 行）不在這一支改**：它們掃的是 `aboveeConfirm.js` 的字，畫面那一半在 04 一起改（過目 E7）

## 判準

- 一列同時有撞期與禁忌：標記寫的是「禁忌 +1」嗎？
- 超用與到期分得出來嗎（「次數不夠」與「過期」不會印成同一個字）？
- 一列有 mustSee 的提醒、短字對照表沒有它：會不會一個標記都沒有（＝她看不到）？
- 不是 mustSee 的提醒（例：二返排在健檢之前 `examAfter()`）會不會被畫成紅字標記？

## 做完時留下的（段二，2026-11-03）

- **ADR-0170**（`docs/adr/0170-abovee-confirm-shows-results-first-problems-on-a-tab.md`）：推翻 ADR-0138 第 4 點、ADR-0129「沒有也講一句」；
  ADR-0153 那一句寫在「延伸」（放在發現問題、算一件），不算推翻。N 的數法寫成一張表：照片層級一種一件、要改的照列數、要你看／過了還沒結案／還差一步一列一件、
  app 有照片沒有照段數＋「還沒認出是誰」一件＋「沒有對」一件；**同一列在兩塊只算一件、記好了的不算也不列**、正常配上的那一句不畫。索引兩列＋「全部」改了
- **domain**：
  - `visits.js`：`entitlementWarnings()` 超用帶 `kind: 'over'`、到期帶 `kind: 'expired'`；`warningDetails()` 的 `from()` 有 `kind` 才多帶那一格（別的來源連鍵都沒有）
  - `aboveeImport.js`：`warningsByRow()` 多回 `tags`（跟 `mustSee` 一對一；拍 Abovee 自己那三種的來源是 `mergedNotice`、`trial`、`photoStatus`＋`photoRowReason()` 的 code）；
    `photoDayPlan()` 多回 `tagBy`（兩條路：新的組、改過的那一筆 `onTouched`）；`mustSeeBy` 照舊是字串
  - `warningTag(tags, { stuck })` → `{ text, more, all } | null`：短字與先後只在 `TAG_WORDS`（禁忌、次數不夠、撞期、重疊、過期、品項、健檢、體驗、狀態），對不到的「提醒」、`stuck` 加「還差一步」排最後；N 算種
  - `rowTag(item, plan)`：只有 `wantsWrite()` 的列；`problems` 有東西就是 stuck。**04 的畫面只叫這一支**
- 測試：`tests/abovee-warning-tags.test.js`（15 條：先後、+N 算種、超用／到期兩個字、對不到的「提醒」、還差一步、`tagBy` 跟 `mustSeeBy` 一對一、不是 mustSee 的沒有標記、`rowTag()` 勾不勾）
- 紅線兩支測試沒動（04 一起改）；`briefWarnings()` 留著（發現問題那一頁照舊用）
- `sw.js` v221 → v222
