# 方案範本無法新增項目，導致「新增方案」是死路

Status: ready-for-agent
回報者：使用者實測，2026-08-18

## 症狀

設定 → 方案範本 → 新增 → 填好名稱與會籍 → 按儲存，永遠跳出
「方案至少要有一個項目」，而畫面上沒有任何地方可以新增項目。
所以**新的方案範本根本存不進去**。

種子資料的兩個方案（筋骨強身、8萬方案）看得到項目清單，但那是唯讀顯示，
也不能增減或修改。

## 原因

`public/js/ui/views/masterList.js` 的 `editors.plans`：

- `fields()` 只產生名稱、會籍月數、備註三個欄位，沒有項目編輯器
- `blank` 的 `items` 是 `[]`
- `parse()` 用 `prev?.items ?? []` 原樣保留舊項目，等於永遠不會變動
- `note()` 只把項目印出來給人看

而 `public/js/domain/masterData.js` 的 `validate('plans')` 要求
`items.length > 0`。兩邊加起來就是死路。

domain 層是完整的，缺的純粹是 UI。

## 要做什麼

在方案的編輯畫面加上項目編輯器，能新增、修改、刪除、排序項目。
每個項目有兩種型態，欄位不同：

| 型態 | 欄位 |
|---|---|
| `single` | 顯示名稱、次數、時長、**選一個課程**、頻率限制（選填） |
| `pool` | 顯示名稱、次數、時長、**勾選兩種以上器材** |

參考 `public/js/domain/seed.js` 裡 `plans` 的實際結構，那是正確的形狀。

驗證已經寫好了，直接呼叫 `validate('plans', record, { courses, equipment })`
即可，它會檢查：項目非空、次數為正整數、single 的課程存在、pool 至少兩種器材，
而且錯誤訊息會指出是第幾個項目。**不要在 UI 層另外寫一套驗證。**

## 注意

- 項目數量會到 7 個以上（見種子資料），手機單欄要能操作，不能依賴拖拉
  （SPEC 第 8.0 節：無 hover、無拖拉）。排序用上下移動按鈕。
- 方案範本沒有版本，就地改不影響已經買的客戶（見
  `docs/adr/0003-plan-templates-have-no-version.md`）。所以編輯項目
  不需要任何「這會影響 N 位客戶」的警告 —— 它不會影響任何人。
- 展開成客戶額度的邏輯是 `domain/entitlements.js` 的 `expandPlan()`，
  已經寫好也測過，這個 issue 不用動它。

## Comments
