# 病歷號變成一格（`customer.chartNo`）：資料、認人、搬家

Status: done
段：二（high）
Blocked by: —（05、06、07、10 等它）
動工前先讀：`domain/identify.js`（檔頭那一段「病歷號不是一個欄位」、`chartNosOf()`、`identifyCustomer()`）；`domain/legacyImport.js` 的 `CHART_NO_PREFIX`／`OLD_CHART_NO_PREFIX`；`domain/customerNotes.js` 的 `noteItems()`、`notesFields()`、`MAX_NOTE_ORDER`（電話、LINE 怎麼當「只是位置」的 token）；`domain/customerMarks.js` 的 `readMarks()`；`domain/health.js` 的 `checkChartNo`（第 `chartNo` 項，舊說法「姓名欄的編號：」改名）與 `data/health.js` 的 `renameChartNo`；`domain/mergeImport.js`／`data/legacyImport.js` 的 `importPlan()`（客戶的 `marks` 從檔案寫進去的那一段）；`domain/sheetReport.js:515` 的 `firstNo`（同名分頁的尾巴）；`domain/audit.js` 的 `FIELD_LABELS`；`firestore.rules` 客戶那一段；`.claude/skills/calendar-sheet-merge/scripts/merge.mjs:982-1027`、`.claude/skills/month-end-reconciliation/scripts/vocab.mjs:26`（都 import `chartNosOf()`）；ADR-0050、0103、0128、0156、0157；`CLAUDE.md`「備註那一段的順序、長備註」「照片上的人是 app 裡的哪一位」「新增一個會寫進稽核的欄位」「`data/backup.js` 的 `exportAll()`」四列

## 她要的

> 11. 同名的客人、app 那一位沒填病歷號時，會自動認成他而且預設打勾。現在每位都有病歷號，但之後新增的客人沒有任何地方要求填。
> 好，修，我想要之後的客人也有地方可以填病歷號，也許可以像是電話和line一樣，在客戶編輯那邊有，也幫我設計一個符合app風格的icon，專門在備註那邊呈現病歷號

> 5. 病歷號：對，但是她也不算是搬出備註吧? 她一樣在備註阿，只是多了個icon ? 試算表每一頁的抬頭那一行要加「病歷號 1234」。icon 選  C

對她來說它**在備註那一段裡**（一顆帶 icon 的丸子，跟電話、LINE 一樣）。資料上是一格。畫面與文件的說法照她的：「在備註那一段」，不要寫「搬出備註」。

## 為什麼會這樣

病歷號從舊表匯進來時寫成一則短備註「病歷號 1234」（ADR-0050），`identify.js` 從備註讀（`chartNosOf()`）。所以：
- 沒有一個地方叫她填 —— 新增客戶、拍訂購單建的人身上沒有那一則，除非她自己記得打「病歷號 」開頭的備註
- 它佔一則短備註：壓表卡片牆、客戶清單卡片、試算表的備註都畫它

## 做法（方向）

1. **資料**：`customer.chartNo`（字串或 null，存她打的原字；比對一律 `normalizeChartNo()`）。備註那一段的順序多一種 token `'chartNo'`（同 `'phone'`／`'line'`：只是位置，值在 `chartNo`；沒填不畫、不佔位）。`noteItems()` 多一種 `{ key: 'chartNo', kind: 'chartNo', text }`
2. **認人**：`chartNosOf()` 先讀 `chartNo`，**舊的「病歷號 1234」短備註照樣認**（保險：還沒搬的資料庫、合併檔那一側）。回傳的形狀不變 → `identify`、`sheetReport`、`merge.mjs`、月底對帳 `vocab.mjs` 都不用改
3. **搬家**（兩條路，都走同一支 domain 函式，例如 `customerNotes.js` 的 `chartNoFromMarks(customer)` → `{ chartNo, ...notesFields(...) }`）：
   - **匯入**（合併檔 v8 照舊寫短備註；她今天切換貼的就是那一份）：`importPlan()` 建客戶時就轉 —— 那一則短備註拿掉、`noteOrder` 裡**對應的第 n 個 `'mark'` 換成 `'chartNo'`**（同一個位置；CLAUDE.md：從中間刪一則要連第 n 個 `'mark'` 一起拿掉，走 `notesFields()` 就對）。合併檔格式不升版
   - **既有資料庫**（staging、或切換後才上這一輪的正式站）：資料健檢接在 `CHECKS` **最後面**一項「病歷號還寫成一則備註」→ 一位一顆「放進病歷號那一格」（她按了才寫）。**一位身上兩則不一樣的號碼、或那一格已經有另一個號碼 → 只列不修**。舊說法「姓名欄的編號：」那一項（`chartNo`）要不要併進來：段二看 —— `CHECKS` 的 id 不動
4. **Rules**：客戶身上的欄位 Rules 沒有逐欄驗 `phone`／`lineId`（先確認一次）；`chartNo` 照同樣的寫法，要驗的話跟 domain 講同一個上限
5. **稽核**：`FIELD_LABELS.chartNo = '病歷號'`（`tests/audit-field-words.test.js` 的名單）
6. **試算表**：`sheetReport.js` 每位多帶 `chartNo`（給 10 的抬頭那一行；`.gs` 那一半在 10）。同名分頁的尾巴照舊 `chartNosOf()`

**不做**：拍訂購單辨識病歷號（照片上沒有那一格）；`merge.mjs` 改成寫 `chartNo`（一次性的切換，app 那一側轉就好）。

## 過目改的（10/19，主控對過；跟上面衝突時以這裡為準）

- **匯入時轉的地方是 `domain/mergeImport.js` 的 `marksOf()`／`planForCustomer()`**（約 437、546 行），不是 `importPlan()`。
- **匯入的客人身上沒有 `noteOrder`** → 「把第 n 個 `'mark'` 換成 `'chartNo'`」用不上。搬家一律走：`noteItems(customer)` → 拿掉那一則短備註、放進一項 `chartNo` → `notesFields()`（`marks`、`notes`、`noteOrder` 同一份算出來）。
- **要定：沒排過順序（沒有 `noteOrder`）、或順序裡沒有 `'chartNo'` 這個 token 時，病歷號在哪**（`customerNotes.js:139` 那一段的 `front`：現在是電話、LINE 在最前面）。建議：跟電話、LINE 一起在最前面（電話 → LINE → 病歷號）。
- **資料健檢兩項會撞**：舊的 `chartNo` 項（「姓名欄的編號：」改名）跟新的這一項同一批按，寫同一位的 `marks`，後寫的蓋掉先寫的 → **新的這一項兩種舊說法都收**、舊的那一項跳過這幾位（`CHECKS` 的 id 不動）。`ui/views/health.js:681`、`:705` 也讀那一項。
- **漏列的畫面**：`noteReorder.js:44` 遇到 `chartNo` 會掉進最後一支、讀 `it.mark` 報錯；`notesEditor.js:46` 的 `icon(it.kind)` → icon 的鍵就叫 `chartNo` 最省事（05）；`sectionCount` 會少 1；`MAX_NOTE_ORDER` 的註解（34 → 35）。Rules 不用改（`noteOrder` 的 token 本來就不驗）。
- **`customer.notes` 鏡像會少「病歷號 1234」那一行** → 手動貼上那條路（`sheetReport.js:70` 附近）就看不到病歷號 —— 由 10 的抬頭那一行補回來（10 要接住這一件）。
- ADR 編號是 **0160**（HANDOFF 那一張表），上面「連動」寫的 0158 是錯的。

## 判準

- 這一行會不會讓一位客人「有病歷號卻認不出來」？（新的一格、舊的短備註、兩個都有 —— 三種都認得）
- 這一行會不會讓搬家之後短備註往前錯一格？（中間那一則是病歷號時，後面每一則的顏色、順序、`noteOrder` 位置都不變）
- 合併檔 `import-2026-10-19.json` 匯進模擬器（只印數字）：34 位裡有病歷號的每一位都是那一格有值、短備註裡 0 則「病歷號 」開頭；資料健檢新那一項 0 位
- 匯入之前就存在的 staging 資料：資料健檢列得出來、按完 0 位、`identify` 照舊認得
- 備份 → 還原（`scripts/restore-backup.mjs`）帶得回 `chartNo`（客戶身上的一格，應該自動 —— 量一次）
- `tests/no-secrets.test.js`：測試與 issue 裡的號碼一律 1234／4321（CLAUDE.md）

## 連動

- ADR-0158 或之後的號碼：**病歷號是一格**（推翻 ADR-0050 的「病歷號是一則備註」、`identify.js` 檔頭那一句；舊的那一支不改）
- `SPEC.md` 客戶資料那一節、`CONTEXT.md`（病歷號）、`CLAUDE.md`「備註那一段的順序」那一列（token 多一種）、「照片上的人」那一列
- `tests/customer-notes.test.js`、`tests/identify*.test.js`、`tests/health.test.js` 與 `tests/seed-staff.test.js` 寫死的總數

## 做完時留下的（10/19 段二）

- **資料**：`customer.chartNo`（原字或 null）。`customerNotes.js` 的 `noteItems()` 多一種 `{ key: 'chartNo', kind: 'chartNo', text }`、順序 token `'chartNo'`；
  沒排過／順序裡沒有它 → 電話 → LINE → **病歷號** → 長備註 → 短備註（`front` 也收它）。`notesFields()` 只寫位置
- **認人**：`identify.js` 多 `chartNoInMark(text)`（前綴後面的原字、去頭尾空白）；`chartNosOf()` 先讀那一格、再讀短備註，一樣的不重複，形狀不變
- **搬家只有 `customerNotes.js` 的 `chartNoMove(customer)`** → `null`｜`{ blocked: true, nos }`｜`{ chartNo, changes }`：
  - **只搬號碼**（正規化之後全是數字）—— 「病歷號要再問」那種留著
  - 那一格空著放第一則的原字；已經是同一個號碼留她打的；同號兩則一起拿掉
  - **位置**：排過順序的走 `notesFields()`（第一則的位置換成 `'chartNo'`）；**沒排過的不寫 `noteOrder`**、照預設排到 LINE 後面（合併檔的病歷號本來是最後一則短備註 → 現在在前面那一組；她排得動）
- **匯入**：`mergeImport.js` 的 `planForCustomer()` 建客戶時 `...chartNoFieldOf(entry)`（拿不準的照舊留在短備註、`chartNo: null`）。v1（只有 `notes`）的也搬，`marks` 會寫成陣列
- **資料健檢**：`CHECKS` 最後一項 `chartNoField`「病歷號還寫成一則短備註」→ fix `chartNoToField`（`data/health.js`：寫客戶本人、`changes` 就是 `chartNoMove().changes`）；
  拿不準的只列。舊的 `chartNo` 項**跳過 `chartNoMove()` 給得出 changes 的人**（不然同一批兩筆寫同一位的 `marks`）—— 那一項現在只剩「那一格是另一個號碼」那種
  總數 36 → 37（`health.test.js`、`seed-staff.test.js`；`eecp-one-course.test.js` 的「接在最後面」改成最後兩項）
- **稽核**：`FIELD_LABELS.chartNo = '病歷號'`（`audit-field-words.test.js` 只釘舊名單，不用改）
- **Rules 不用改**（客戶身上的欄位不逐欄驗）；備份是客戶整份，`chartNo` 自動跟著
- **量過**：`.local/references/before-golive-2026-10-19/chart-no-import.mjs`（node 裡跑 `planForCustomer()` ＋ `runHealthCheck()`，跟匯入頁同一支；沒進模擬器 —— 匯入頁寫的就是 `plan.customer`）：
  34 位、34 位有病歷號 → 那一格 34、短備註裡剩 0 則、其餘短備註 106 → 106、資料健檢兩項 0、`chartNosOf()` 認得 34
- **沒做、留給 10**：`sheetReport.js` 每位帶 `chartNo`（抬頭那一行）—— `customer.notes` 鏡像少了「病歷號 1234」那一行，手動貼上那條路也要靠 10 補
- 文件：ADR-0160（07 那一半之後補進同一支）、SPEC 客戶資料與資料健檢兩處、CONTEXT「病歷號」、CLAUDE.md 兩列
- 新測試：`tests/chart-no-field.test.js`
