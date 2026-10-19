# 照片認人：名字對上、app 那一位沒有病歷號、照片上有 → 不先勾、講一句；她勾了就順便記上

Status: todo
段：二（high；動到認人 —— 有疑慮就停下來問）
Blocked by: 04
動工前先讀：`domain/identify.js` 的 `identifyCustomer()`（`nameOnly` 那一格）、`nearNameSay()`；`domain/aboveeImport.js` 的 `readAbovee()` 認人那一段（約 963 行）、`photoWantsChecked()`、`resolveItem()`（換一位）、`asRecorded()`；`domain/abovee.js` 的 `aliasWrites()`（「她選了人之後記住寫法」—— 同一種「存的時候順便寫」的先例）；`ui/components/aboveeConfirm.js` 存檔那一圈（約 875、981、1085 行）；`domain/treatmentSheets.js:252`、`ui/components/sheetConfirm.js`；ADR-0103、0128、0153；`CLAUDE.md`「照片上的人是 app 裡的哪一位」「拍 Abovee 記很多段」兩列

## 她要的

見 04 的第 11 條原話。我 10/12 只查不改時列的那一條：

> 同名、app 那一位沒有病歷號 → `nameOnly` 自動認、預設打勾（現在 29 位都有病歷號；之後新增的客戶沒有任何東西要求填）。

## 為什麼會這樣

`identifyCustomer()`：名字對上剛好一位、**照片上有號碼但那一位身上沒有** → 走到最後 `nameOnly`、回那一位（`conflict` 只在「那一位身上有號碼、跟照片對不上」時才成立）。拍 Abovee 把 `nameOnly` 當成認得、預設打勾。
同名的兩位裡一位剛建、還沒有病歷號 → 照片上明明有號碼，卻安靜地認成沒有號碼的那一位（如果真的是另一位只是剛好同名、另一位還沒建，就記到別人身上）。

**過目更正（10/19）**：上面那一段的例子寫錯。同名兩位、其中一位有另一個號碼 → 已經是 `conflict`（`identify.js:95`）；兩位都沒有 → `ambiguous`。
`nameOnly` 只在 **app 裡同名剛好一位** 時出現 —— 真正的風險是：照片上那一位是**另一個人**（還沒建進 app、或剛好同名），app 裡那一位沒有號碼可以核對，就安靜地記到他身上。

## 做法（方向）

**過目改的（10/19，跟下面衝突時以這裡為準）**：
- 「不預設打勾」**不放在 `photoWantsChecked()`**：那一支的註解寫明認人的條件在 `resolveItem()`，而且它也決定 `adoptMove`（`aboveeImport.js:1809`）；`adoptStatus`／`adopt`／`adoptCharge` 讀的是 `recognized`（`:794`）→ **改 `recognized` 那一層**，一次管到所有「預設勾」。
- 讀 `.how` 的地方（`aboveeImport.js:2087`、`aboveeConfirm.js:456`／`530`、`reconcile.mjs:273`）不會誤判；**`sheetConfirm.js:186` 會把新的那一種當成認得** → 加那一句。
- 照片上的號碼是補零的（`00001234`）→ 寫進 `chartNo` 的要定：存去掉前面 0 的（`normalizeChartNo()` 的結果）比較像她打的；寫進 issue 的「做完時留下的」。
- 該跑的測試是 `identify`、`abovee-recognise-more`、`abovee-absent-who`（353 筆那張表跟認人無關）。

1. `identifyCustomer()` 多分一種（例如 `nameNoChart`：名字對上剛好一位、照片上有號碼、那一位身上一個號碼都沒有）—— `customer` 照舊是那一位（她多半就是他），但**認人的結果講得出「沒有用號碼核對過」**。表格與檔頭的說明跟著改
2. 拍 Abovee：那一種的列**不預設打勾**（`photoWantsChecked()` 多一條，其餘不勾的條件一條都不拿掉）、講一句（句子只寫一份，兩個確認層共用，同 `nearNameSay()`）：「app 上這一位還沒有病歷號，照片上是 1234 —— 是他的話勾起來，存的時候順便記上」
3. **她勾了、按記錄 → 那一位的 `chartNo` 寫成照片上的號碼**（同 `aliasWrites()`：只寫空著的；**她用「換一位」換成別人的列不寫**（`pickedId` 不是認人那一次那一位）；已經寫過的不重複；寫失敗下一次補）。寫入的路要過 01 的規則嗎 —— 寫客戶本人不吃來訪，不用
4. 療程單（`sheetConfirm.js`）：同一個認人結果、同一句；要不要也順便記上 → 同樣做（同一個號碼來源），段二看程式碼量決定，寫進「做完時留下的」
5. 月底對帳 skill：`reconcile.mjs` 有沒有讀 `how`（`tests/month-end-reconciliation.test.js` 跑一次）

## 判準

- 這一行會不會讓照片上有號碼的一列，**沒有用號碼核對過就預設打勾**？
- 這一行會不會把照片上的號碼寫到**另一位**身上？（換一位、`conflict`、`ambiguous` 都不寫）
- app 那一位有號碼、跟照片一樣 → 照舊 `both`、照舊打勾；照片上沒有號碼的那一欄（療程單常常沒有）→ 照舊 `nameOnly`、行為不變
- 存完再拍同一張 → 那一列變成 `both`、預設打勾
- `tests/abovee*.test.js` 那張 353 筆寫法的表照舊全綠
