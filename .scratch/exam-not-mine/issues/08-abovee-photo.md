# 08：拍 Abovee（domain：那一列的形狀、預選、勾不勾）

Status: done
Blocked by: 04, 05

## 動工前先讀

- `CLAUDE.md` 連動表「拍 Abovee 記很多段」那一列（很長，**全部讀**，尤其「整張一起看才認領的欄位…換一位時要清掉、變成已經記了時也要清」那一句）
- `docs/agents/lessons.md` 第一節（同一個入口的兩個時機也算兩個入口）
- `public/js/domain/aboveeImport.js`：`entitlementChoices()`（297-309）、`resolveItem()`（757-868）、`optionValueOf()`（878-882）、`pickOption()`（899-923）、
  `linkBatchExams()`（1043）、`closeBlockedKeys()`（1066）、`newRowSay()`（686-701）、`chargeChangeOf()`（1413）、`picksOf()`（2486-2506）

## 她要的

> 我現在遇到的問題是，我拍了客戶A的三返，但是app會問這是哪一堂以及沒有n反讓我選也不能選醫生
> 我想要的是我拍照後能認出三返或是二返或是四返，並且可以如果沒有綁健檢或是這個人身上沒有健檢的話只提醒他沒有，而是不是直接不能選 ?

## 為什麼會這樣

- 三返～十返照片認得（`abovee.js` 的 `nthOf()`），`resolveItem()` 預選 `NTH_PICK`（846）；但那一排沒有 n返（沒有健檢）→ 那一列一顆都沒按著、`built.course` 是 null → 沒有醫師那一排
- 二返認得成二返那門課；身上沒有二返額度 → 挑不出額度、那一列空著
- **`picksOf()` 會把返數丟掉、也不帶標記**（過目 M6）：`entitlementId: item.isNth ? null : …`、`nth: item.isNth ? item.nth : null`（`:2486-2506`），
  確認層畫列（`aboveeConfirm.js:421`）與寫入（`aboveeImport.js:2555`）都走它。那一列 `isNth:false` → nth 被清成 null → 擋「先選第幾返」；`isNth:true` → 走 n返、課程從健檢借 → 擋「先選要做什麼」。
  `optionValueOf()` 不認新的值的話那一列一顆都沒按著
- `resolveItem()` 決定勾不勾時，不看按著的那一顆組不組得出來（`:865-866`）

## 要做的

- **那一列的形狀**：`isNth: false` ＋ 自己的旗標（例如 `notMine: true`）＋ `nth`（2～10）—— `closeBlockedKeys()`（`:1066`）、`aboveeConfirm.js:588`、`:593`、`:616` 都看 `item.isNth`，
  讓它們照舊不碰這一列
- `optionValueOf()` 認得那一列（回 05 的新常數）；`picksOf()` 把標記與 `nth` 交給 `slotFromPicks()`（02 的那條路）
- 按那一顆走 `pickOption()`（她自己按與讀照片那一下**同一支**）：返數照照片（`item.course.nth`，二返那門課 → 2；照片不是回訪就不預選）、醫師照照片
- **讀照片那一下不替她按、不替她勾**（寫在 `resolveItem()`，不是畫面）：照片是二返或三返～十返、而這位客戶
  - n返：沒有接得上的健檢；或
  - 二返：**沒有任何一筆二返額度**（`entitlementChoices()` 是空的 —— 身上有一筆用完的，照舊預選那一筆＋超用提醒，過目 S9）
  → `checked: false`＋那一句（字放 domain，`newRowSay()` 或同一類）：
  「照片上是三返，這位客戶沒有接得上的健檢 —— 健檢不是你排的話，在「送的／體驗／其他…」裡點「其他」、按「健檢不是我排的」」（二返那一句講額度。收合那一題她 11/2 回了：收合照舊會自己打開，「健檢不是我排的」收在裡面的「其他 ▸」那一層 —— 所以句子指「其他」，不寫「點開收合」）
- 那一列上的新旗標：`resolveItem()` 的 `next` 清掉、變成「已經記了」時清掉（`asRecorded()` 那一類）、`pickOption()` 的 `base` 清掉 —— 三處都加
- 下一次再拍到同一段（同一個時間、同一門課）→「已經記了」；**不提議改扣法**（`chargeChangeOf()`：沒有額度、`giftKindOf()` 是 null → 不動，測試釘住）、不提議改成接健檢
- `linkBatchExams()`：帶標記的那一列不進「接哪一次健檢」那一圈（`secondEntOf()` 應該本來就認不得 —— 確認、測試釘住）
- 確認框（`aboveeConsequences()`）那一句走 04；寫入走既有的 `planAbovee()` → `slotFromPicks()`

## 判準

- 一般的客人照片上的三返（有健檢）、二返（有額度）：預選、預設勾、接健檢，一個都沒變嗎？
- 「換一位」之後新的那一位身上還留著上一位的標記嗎？
- 讀照片那一下與她自己按一次，同一列結果一樣嗎？
- 下一次拍到同一段，會不會被當成新的一段再記一次（多一段）？
- 勾起來的那一列 `picksOf()` → `slotFromPicks()` 組得出一段嗎？（不要只看畫得出來，lessons 二）

## 做完時留下的

- **列上的旗標**（`aboveeImport.js`）：
  - **`notMine: true`**（她按了那一顆；不叫 `examNotMine` —— 列不是時段，`tests/exam-not-mine.test.js` 掃的是 `.examNotMine`）＋ 既有的 **`nth`**（2～10；`null` ＝ 還沒選）。`isNth` 一律 `false`
  - **`notMineHint: { nth, offered } | null`**：讀照片那一下算的「走不了一般那一條」（`notMineHintFor()`，新的、沒 export）。
    三返～十返：那一排上沒有「＋ n返」（`nthOffered()` 問 `slotOptionsFor()` 同一份 —— 確認層畫的那一排）；二返：`entitlementChoices()` 是空的（刪掉的不算；一筆用完的照舊預選，S9）。
    `offered`：`notMineOption(courses)` 有沒有那一顆（二返那門課不是剛好一門時沒有）。照片上已取消的列不給
- `resolveItem()`：`next` 多清 `notMine`、`notMineHint`；有 hint → **一顆都不按**（以前三返照樣預選 `NTH_PICK`，那一排上卻沒有 n返 → 一顆都沒按著、組不出來、**還先勾了**、卡住整張的「記錄」）、**不勾**；
  hint 寫在 `pickOption()` 之後（`pickOption()` 的 `base` 會清掉它）
- `newRowSay()`：多一句（`notMineSay()`，排在 `noExam` 之後）：
  `照片上是三返，這位客戶沒有接得上的健檢 —— 健檢不是你排的話，在「送的／體驗／其他…」裡點「其他」、按「健檢不是我排的」。`（二返講「身上沒有二返額度」）；
  那一顆不畫時退回原本確認層那一句（「選別的，或先去約健檢」／「選別的，或先去加購」）。「其他」與那一顆的字讀常數（`EXTRA_GROUP`、`EXAM_NOT_MINE_LABEL`）
- `needsAttention`：帶 `notMineHint` 的新列排進「要你看」（同 `noExam`）；`pastStillOpen()` 因為 `newRowSay()` 有字自動不收它
- `optionValueOf()`：`notMine` 排在 `isNth` 前面 → `NOT_MINE_PICK`
- `pickOption()`：`base` 多清 `notMine`、`notMineHint`；`NOT_MINE_PICK` → `{ notMine: true, nth: photoNthOf() }`（照片 `三返`～`十返` 照字、二返那門課 2、**別的課 `null` 不預選**）。醫師、時長、診間照照片（`base` 不動）
- `picksOf()`：多 **`examNotMine: item.notMine === true`**；`entitlementId` 在 `notMine` 時交 `null`；`nth` 在 `isNth || notMine` 時交出去
- `asRecorded()`：多清 `notMine`、`notMineHint`（`claimTimeless()` 那一條：三返的照片對到匯入的沒有時間的舊段時，hint 不跟著變成「已經記了」）
- **還沒選返數的那一列**：不另開草稿旗標（06 的 `pendingNth` 是因為編輯器的「帶標記、沒有返數」就是二返）—— 這裡列上的 `nth: null` 照交，`slotFromPicks()` 擋「先選第幾返」，
  勾著的話確認層照既有的「還差一步：先選第幾返」講、底下那一顆數成 `stuck`；沒勾點開是「勾起來的話：存不下去 —— 先選第幾返」（`whatIfChecked()`）
- **不用改、測試釘住的**：`secondEntOf()`（`entitlementId` null → 不進 `linkBatchExams()`／`refreshNoExam()`／`stuckLinks()`）、`closeBlockedKeys()`（`isNth` false → 不算二返簽不成）、
  `chargeChangeOf()`（帶標記的三返 `followupNth` 有值 → null；二返 `giftKindOf()` null → 不提議改扣法）、`trialSay()`（`entitlementId` null → 不講）、`mergeRows()`（`looksMerged()` 要額度與器材）
- 呼叫端（codegraph `callers` ＋ grep）：`resolveItem()`＝`readAbovee()`、`mergedItem()`、確認層「換一位」（`pickWho()`）；`pickOption()`＝`resolveItem()`、`pickMinutes()`、確認層按丸子；
  `optionValueOf()`＝`pickMinutes()`、確認層 `detailHtml()`；`picksOf()`＝`composeGroups()`、確認層 `slotOf()`；`asRecorded()`＝`claimHalves()`、`claimTimeless()`、`flagMoved()`；
  `newRowSay()`＝`pastStillOpen()`、確認層 `rowHtml()`。一般的列（沒有 hint、沒按那一顆）每一支答案一樣
- 測試 **`tests/exam-not-mine-abovee.test.js`**（23 支）：讀照片那一下（三返／二返／額度刪掉／四返／那一顆不畫）、一般的客人不變（有健檢的三返、有額度的二返、用完的二返、從來不替她按）、
  按了之後（三返與二返組出來的段、照片不是回訪 → 先選第幾返、一般的客人也按得下去、換回別的一顆、「排多久」、換一位、那一排上有那一顆）、整張一起看（不進接健檢那一圈、課程完成記成已完成、確認框那一句）、
  下一次再拍到（三返、二返已經記了不提議改扣法、沒有時間的舊段清掉 hint）
- 確認層那一句（`aboveeConfirm.js:588-590`）、filter 與「第幾返」那一排是 09
- `public/sw.js` v215 → v216、`npm run shell:snapshot`
