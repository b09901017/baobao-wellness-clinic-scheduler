# 08：拍 Abovee（domain：那一列的形狀、預選、勾不勾）

Status: todo
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
  「照片上是三返，這位客戶沒有接得上的健檢 —— 健檢不是你排的話，在「送的／體驗／其他…」裡按「健檢不是我排的」」（二返那一句講額度；**「點開」那兩個字照 HANDOFF 收合那一題的答案寫** —— 沒有額度的客人收合本來就開著）
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

（做完的人寫）
