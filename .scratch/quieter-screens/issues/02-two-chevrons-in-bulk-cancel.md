# 02 批次取消的搜尋結果長了兩顆箭頭

Status: todo
動工前先讀：`.scratch/quieter-screens/spec.md`

## 她要的

> 批次取消搜尋完人名後，人名旁邊有兩個重複的">"

## 為什麼會這樣

`public/js/ui/views/bulkCancel.js:194` 手動塞了一顆 `${icon('right', { size: 17 })}`，
而 `.row-link::after`（`public/css/app.css:4214`）本來就會長一顆 `›`。

**這個坑上個月踩過一次。** `app.css:4146` 那段註解就記著她當時的原話：

> 9 10 11 月就好…為什麼會有兩個 > 的箭頭？

那一次的處理是「這一排不重用 `.link-list`，自己一組」（`.monthpick`）。
這一次比較單純：`.row-link` 已經自己會長箭頭，手動那顆是多的。

同一支檔案裡 `icon('right')` 還有兩處是**對的**，不要一起刪：
`bulkCancel.js:220`（換月份那顆 `.calbar__nav`）。

其餘兩個 `.row-link` 呼叫端（`customerDetail.js:808`、`customerDetail.js:978`）
都沒有手動加 icon，所以不受影響。

## 判準

- 搜尋結果每一列右邊**只有一顆** `›`
- 換月份的左右兩顆箭頭還在
- 客戶詳情那兩處一個字都沒動
- 測試：E2E 進批次取消、打名字，斷言那一列裡 `›` 出現的次數是 1
