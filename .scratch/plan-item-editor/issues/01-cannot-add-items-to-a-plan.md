# 方案範本無法新增項目，導致「新增方案」是死路

Status: done
回報者：使用者實測，2026-08-18
動工前先讀：`SPEC.md` 第 4.5、6.5、6.7、8.0 節與 `docs/adr/0003-plan-templates-have-no-version.md`

## 症狀

1. 設定 → 方案範本 → 新增
2. 填名稱、會籍月數、備註（畫面上就只有這三個欄位）
3. 按儲存 → 表單上方跳出「方案至少要有一個項目」

沒有任何地方可以新增項目，所以**新的方案範本永遠存不進去**，不是漏填而是這條路走不通。

種子資料的兩個方案（筋骨強身、8萬方案）在清單卡片上看得到項目清單，
但那是唯讀顯示，點進編輯畫面不會出現，因此**既有方案的項目也只能看不能改**。

這是設定頁做到一半留下的缺口，不是藏在別處的功能 —— 不用再去找有沒有第二個入口。

## 根因

**`public/js/ui/views/masterList.js:126` `editors.plans`**

- `fields()` 只產生名稱、會籍月數、備註三個欄位，沒有項目編輯器
- `blank.items` 是 `[]`
- `parse(v, prev)` 寫 `items: prev?.items ?? []` —— 原樣保留舊值，
  所以新增時永遠是空陣列，編輯時永遠不變動
- `note()` 只把項目印在清單卡片上（`paintList` 用），表單裡完全沒有它

**`public/js/domain/masterData.js:118` `validators.plans`**

`if (!items.length) errors.push('方案至少要有一個項目')`。

驗證是對的，domain 層完整而且有測試（`tests/master-data.test.js`）。
缺的純粹是 UI，兩邊加起來就是死路。

### 表單機制擋路的兩個地方（動工前一定要先知道）

1. **沒有重畫機制。** `masterList.js:212` 的 `paintForm()` 把整個表單一次 render
   成字串就結束。新增／刪除／上下移動／切換項目型態都需要重畫表單，
   而重畫時**其他還沒儲存的欄位（名稱、會籍、備註、其他項目）不能被清掉**。
   另外 `masterList.js:214` 的 `isNew = !record` 也要改成看有沒有 `record.id`，
   否則「帶著草稿重畫」會被誤判成編輯既有紀錄。
2. **`readForm()` 是扁平的。** `public/js/ui/components/form.js:85` 依 `name` 讀成
   一層物件，所以每個項目的欄位必須各自有唯一 name（例如 `item-0-label`），
   再於 `parse()` 裡依 index 重組回陣列。
   更要注意第 90 行：它用「同名元素超過一個」判斷 checkbox 是群組還是單一開關，
   **器材主檔只剩一筆時，擇一池的勾選群組會被當成開關回傳 boolean**。
   這是現存地雷，順手修掉：`f.checkboxes()` 產生的 input 帶上標記屬性
   （例如 `data-many`），`readForm()` 依標記判斷，不要再靠數量猜。

## 要做什麼

在方案的**編輯表單裡**加項目編輯器：新增、修改、刪除、上下移動排序。

### 項目的形狀

以 `public/js/domain/seed.js` 的 `plans` 為準，那是正確的形狀：

```js
{ type: 'single', courseId: 'course-rehab', label: '復健科醫師門診', qty: 6, durationMin: 30 }
{ type: 'single', courseId: 'course-inbody', label: '身體組成分析', qty: 4, durationMin: 20, frequencyRule: '每季一次' }
{ type: 'pool',   label: '復能', qty: 12, durationMin: 60, optionEquipmentIds: ['eq-laser', 'eq-sis', 'eq-indiba'] }
```

| 欄位 | single | pool |
|---|---|---|
| `label` 顯示名稱 | ✓ | ✓ |
| `qty` 次數 | ✓ | ✓ |
| `durationMin` 時長 | ✓ 選課程時預設帶入該課程的時長，可改 | ✓ 手動填，沒有課程可帶 |
| `courseId` 課程 | ✓ 單選一個 | ✗ 不要塞 |
| `optionEquipmentIds` 器材 | ✗ 不要塞 | ✓ 複選，至少兩種 |
| `frequencyRule` 頻率限制 | 選填，選課程時預設帶入該課程的值 | 選填 |

pool 沒有 `courseId`，single 沒有 `optionEquipmentIds`。
`expandPlan()` 會把缺的補成 `null`，不要為了欄位對齊互相塞空值。

### 驗證：呼叫既有的，不要另寫

`masterList.js:245` 已經在呼叫
`validate(type, candidate, { existing, courses, equipment })`，不用改它。
它會檢查：項目非空、每項名稱非空、`qty` 為正整數、single 的課程存在且未刪除、
pool 至少兩種器材且都存在，而且錯誤訊息會指出「第 N 個項目」。

**不要在 UI 層另外寫一套驗證。** SPEC 第 6.7 節的雙層是「前端一次、Firestore Rules
一次」，不是「UI 一次、domain 一次」。

### 下拉選單怎麼列

- 課程與器材用 `all.courses` / `all.equipment`（`config.loadAll()` 已排除軟刪除的）。
- 已停用（`active === false`）的仍要能選，只在文字後標「已停用」——
  validate 只擋已刪除、不擋停用，UI 不要比 domain 嚴。
- 編輯舊資料時若某個 `courseId` 或器材 id 已不在清單裡，**保留原值並顯示「（已刪除）」**，
  讓 validate 去報錯。**絕對不要在 render 時把它改成第一個選項** —— 那是無聲改資料，
  違反第 6 節的整個精神。

### 手機優先的操作方式

- 種子資料就有 7 個項目，實際會更多。每個項目一張小卡，單欄堆疊。
- 排序用上下移動按鈕，**不做拖拉**（SPEC 第 8.0 節：無 hover、無拖拉、
  最小點擊區 44px、input 字級 16px 起跳）。
- 新增項目後捲到新項目；上下移動後停留在被移動的那一項。
- 型態（single / pool）切換要重畫該項目的欄位，切換不能把 `label`、`qty` 清掉。

## 不能違反的既有決定

- **`docs/adr/0003-plan-templates-have-no-version.md`：方案範本沒有版本，
  就地改不影響已經買的客戶。** 額度在展開當下就整份複製到客戶身上了。
  所以編輯項目**不需要任何「這會影響 N 位客戶」的警告，也不能因此阻擋儲存** ——
  它真的不影響任何人。也不要順手加 `version` 欄位。
- **`domain/entitlements.js` 的 `expandPlan()` 已經寫好也測過，這個 issue 不動它。**
  它讀 `type / label / courseId / optionEquipmentIds / qty / durationMin / frequencyRule`，
  那正是項目編輯器要能產出的全部欄位。
- **分層守衛**（`tests/layering.test.js`）：規則留在 `/domain`，UI 只負責蒐集與顯示，
  `/domain` 不碰 DOM。寫入一律走 `data/config.js` → `data/repo.js`，
  才會自動有稽核與軟刪除。項目是 map 陣列，Firestore 存得下，不需要改 data 層。
- **沒有框架、沒有 build**（SPEC 第 10 節）：不要為了這個編輯器引入 Alpine 或任何相依套件，
  維持「產生 HTML 字串再讀回值」的作法。
- **破壞性操作的動線**（SPEC 第 6.5 節）：刪掉單一項目是表單內的編輯，不必走 `confirmAction`；
  整個方案的停用與刪除仍留在表單最下方的危險區，不要動它。
- 其他 editors（rooms / staff / equipment / ivProducts / products / courses）的行為
  不可以因為這次改動而改變。

## 驗收

1. 新增一個方案，加一個 single 與一個 pool 項目，儲存成功，重新整理後項目還在。
2. 用 UI 從零重建「筋骨強身」，存下來的 `items` 與 `seed.js` 那份逐欄相同
   （含 `frequencyRule` 只出現在該出現的兩項）。
3. 編輯種子方案：改次數、刪一個項目、把某項上移，三種都存得進去。
4. 把項目全刪光後儲存，仍然出現「方案至少要有一個項目」，
   且**已填的名稱與備註沒有被清掉**。
5. pool 只勾一種器材時，錯誤訊息指名是第幾個項目。
6. 器材主檔只剩一筆時不會爆掉（上面那個 `readForm` 地雷）。
7. `npm test` 全綠；`readForm` / `checkboxes` 若改了行為要補測試。
8. 375px 寬度下 7 個項目都能操作，沒有橫向捲動。

## 不在範圍內

- 客戶的額度編輯（第 3 步）
- 方案「複製一份改名成新範本」（ADR-0003 提到的作法，值得做，另開一張）
- 課程主檔本身的欄位

## Comments

**2026-08-18** —— 做第 3 步（客戶 + 額度池）時順手把上面「根因」列的第 2 個地雷修掉了：

- `f.checkboxes()` 產生的 input 現在帶 `data-many`，`readForm()` 依標記判斷是不是群組，
  不再數同名元素有幾個。器材只剩一筆時不會再回傳 boolean。
- 同時多了三個欄位可以用：`f.date()`、`f.textarea()`、`f.readonly()`（唯讀的算出來的值）。

**第 1 個地雷（`paintForm()` 沒有重畫機制）還在**，那才是這張 issue 的主要工作。
不過客戶詳情頁的額度編輯器（`public/js/ui/views/customerDetail.js` 的 `paintEntitlement()`）
已經用「讀回表單 → 合併成草稿 → 重畫」處理了同一個問題，可以直接照抄那個作法 ——
它處理的正是 single/pool 換型態要換欄位、而且不能把填到一半的值清掉。

**2026-08-18** —— 做完了。

- `domain/masterData.js` 多了 `planItem()`：依型態組出乾淨的項目。
  pool 不塞 `courseId`、single 不塞 `optionEquipmentIds`、`frequencyRule` 留空就整個欄位不出現。
  項目的形狀是規則不是畫面，所以放 domain，也才測得到 —— 驗收第 2 項現在是一支測試：
  種子的兩個方案逐項餵過 `planItem()` 之後與原本逐欄相同。
- `masterList.js` 的 `paintForm()` 補上重畫機制：多收 `draft` 與 `focusItem` 兩個參數，
  重畫前先「讀回表單 → 合併成草稿」，所以新增／刪除／上下移動／換型態都不會清掉
  其他還沒儲存的欄位。`isNew` 也照這張 issue 說的改成看 `record?.id`。
- 重畫只有方案需要，所以是編輯器自己宣告的 `wireForm` 掛鉤，
  其他 editors（rooms / staff / equipment / ivProducts / products / courses）一行沒動。
- 項目編輯器：一項一張卡單欄堆疊、上下移動按鈕（不做拖拉）、新增後捲到新項目、
  移動後停留在被移動的那一項。
- 選了課程會帶入該課程的時長、頻率與名稱，但**只在還沒填、或填的正好是上一個課程的
  預設值時才覆蓋** —— 她自己打過的數字不能被無聲蓋掉。
- 已停用的課程與器材仍然選得到，只標「已停用」；指向已刪除的 id 原樣保留並顯示
  「（已刪除）」，交給 `validate()` 報錯，不在 render 時改成第一個選項。
- 驗證全部走既有的 `validate(type, candidate, { existing, courses, equipment })`，
  UI 層沒有另寫一套。錯誤發生時不重畫表單，所以已填的名稱與備註不會被清掉（驗收第 4 項）。

第 1 個地雷（`paintForm()` 沒有重畫機制）解決了；第 2 個地雷（`readForm` 的 checkbox
群組判斷）在第 3 步就修掉了，所以驗收第 6 項本來就已經成立。

不在範圍內的兩項仍然沒做：客戶的額度編輯（第 3 步已有）、方案「複製一份改名」（ADR-0003
提到的作法，值得另開一張）。
