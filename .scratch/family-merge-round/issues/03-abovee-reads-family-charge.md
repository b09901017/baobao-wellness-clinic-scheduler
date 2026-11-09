# 拍 Abovee：讀「實際扣課病歷號／關係」，扣被扣的那一位、自動填誰來的

Status: todo
Blocked by: 01
動工前先讀：`.claude/rules/abovee.md`（整份，尤其「拍 Abovee 記很多段」「照片上的人是 app 裡的哪一位」「整張一起看才認領的欄位…要清掉」）、`.claude/rules/photos.md`（抄字格式、Function 部署）、
`functions/transcripts/aboveeList.js`、`public/js/domain/aboveeImport.js` 的 `readAbovee()`／`resolveItem()`／`asRecorded()`／`warningsByRow()`、`identify.js` 的 `identifyCustomer()`、
`.claude/skills/month-end-reconciliation/scripts/reconcile.mjs` 的 `paidByOf()`、`familyBucket()`（已經讀這兩欄，抄字欄名對齊它）

## 她要的

> 實際扣課病歷號：是扣誰的就扣誰的，可以標註。

kickoff（11/9）照建議：
> ③拍 Abovee：多抄「實際扣課病歷號／關係」，跟病歷號不一樣時認被扣的那一位、預選她的額度、「誰來的」自動填照片上的名字＋關係，那一列講一句「扣客戶A 的（夫妻）」。

## 為什麼會這樣

- `aboveeList.js` 只抄 11 欄，沒有那兩欄 → 那一列照名字認人；來的人不在名單上就是「認不得」（10/29 那一件就是這樣沒記進去）。
- 5～10 月這種 6 列（`.local/references/月底對帳/全部重對-2026-11-09/家人扣課.json`，讀要接 `redact.mjs`）：全是夫妻、來的人都不在名單上；2 列已取消。

## 要做的

1. 抄字多兩欄（實際扣課病歷號、關係）。**Function 沒重新部署之前抄不到** → 那兩欄是空的，行為跟現在一模一樣。部署 staging 的 Function 照 `docs/STAGING.md`（正式的跟著上 main）。
2. 實際扣課病歷號有字、而且跟這一列的病歷號不一樣：用那個號碼走 `identifyCustomer()` 認**被扣的那一位**，這一列記在她身上、額度照她的挑（`pickOption()` 那一套，不另寫），「誰來的」填照片上這一列的名字＋關係（例 `王小明（夫妻）`）。
   講一句（例「扣客戶A 的（夫妻）」，**要不要進 `mustSee` 自己判斷、寫理由**）。
3. 認不得被扣的那一位（號碼對不上、對到好幾位）→ 不猜、不預設打勾、講一句。
4. 「已經記了」：app 上被扣的那一位那一格已經有那一段（8/27 那種）→ 算已經記了；「誰來的」空著的話要不要補成「已經記了＋要改的」一行，自己判斷（預設勾，照 ADR-0149 那一套），寫進「做完時留下的」。
5. 「換一位」之後清掉這一列的被扣者與誰來的（`resolveItem()` 的 `next`、`asRecorded()` 兩處，照 `abovee.md` 那一條）。
6. 寫進 `.claude/rules/abovee.md` 對應的一條。

## 判準

- 10/29 那種照片（來的人不在名單上、實際扣課病歷號是客戶A 的）：那一列認成客戶A、預選她的復健門診、記下去「誰來的」有字、次數少一次、講一句。
- 被扣的那一位自己同一天也來了：兩段都記得進去、不報同一筆裡重疊（靠 01）。
- 舊照片／Function 沒部署（兩欄空）：`tests/abovee*.test.js` 全部照舊綠，一列的結果都不變。
- 換一位之後那一列不再帶著被扣者。
- 已取消的家人列：照現在取消列的規則，不扣。

## 過目補充（2026-11-09，主控對過）

- **`identifyCustomer({ chartNo })` 只給號碼回 `numberOnly`、`customer` 刻意是 null（ADR-0103）** → 照「要做的」第 2 條寫法永遠認不到。照月底對帳 `paidByOf()` 的做法：候選剛好一位才算，ADR 寫明這是 ADR-0103 的例外（理由：那一欄是 Abovee 系統帶出來的號碼、不是手打的名字）。
- `resolveItem()` 用 `who.customer.id !== customerId` 判「人是她自己選的」→ 家人列會一律不預設勾，要改；也要測 `photoChartNos()`／`chartNoWrites()` 不會把先生的號碼寫到太太身上。
- **改認被扣的那一位之後，比對只看「客戶＋時間＋課程」會搶錯段**：`existingAt()`／`crossCheck()`（`sameCourse.find() ?? [0]`）會讓先生那一列認領太太自己 14:30 那一段（變「已經記了」→ 漏記一次）；`mergeRows()`、`claimHalves()`、`flagMoved()`、`looksRepeated()` 一樣。→ **這幾支都加「誰來的要一樣」**（空的＝本人），判準加一條：8/27 那種（太太 14:30＋先生 14:30 同課程）兩列各記各的。
- 抄字要一起動：`ABOVEE_KEYS`；`RIGHT_KEYS`／`EDGE_KEYS`（這兩欄在「合併扣課」與「預約來源」之間、靠近左右兩張的交界 —— 照 `fullerCell()` 那一套）；提示詞的「十一欄」；寫死欄數的三支測試 `ai-transcripts`、`abovee-halves-room`、`abovee-trial-source`。欄名對齊 `assemble.mjs`：`actualChartNo`／`relation`。
- `pickOption()` 照 `item.customerId` 挑額度，沿用即可；換一位要清的兩處（`resolveItem()` 的 `next`、`asRecorded()`）對。

## 做完時留下的

（做完寫：抄字欄名、哪幾支函式改了、staging Function 部署了沒）
