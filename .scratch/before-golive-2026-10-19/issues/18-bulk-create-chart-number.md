# 批次建立客戶：每一位一格病歷號

Status: done
段：二（段二中途發現第 9 條，她 10/19 晚：「好啊，加一欄」）
動工前先讀：`domain/bulkCustomers.js` 的 `newRow()`、`customerFor()`、`rosterWarnings()`；`ui/views/customersBulk.js` 的 `rosterRow()`、`wirePage()`（檔頭：名單與摘要各自重畫、打字不重畫）；`domain/customers.js` 的 `fieldWarnings()`（同號那一句）；ADR-0160

## 她要的

> 批次建立客戶那一頁沒有病歷號那一格，好啊，加一欄

## 為什麼會這樣

那一頁當初只收名字（電話、LINE 也沒有，她說「其他的都不用」）。病歷號是 10/19 才變成一格；06 讓沒有病歷號的人拍 Abovee 時不先勾 ——
一批建的人全部會掉進那一格。

## 做法

- 名單上每一位一格「病歷號」（數字鍵盤、不是 `type="number"`、不必填）；打字只改 `state`，不重畫名單（同共用欄位那一塊的理由）
- `customerFor()` 寫 `chartNo`
- 同號提醒不擋：跟既有客戶或名單裡另一位同號 → 那一列一行 ⚠（同 `fieldWarnings()` 那一句），摘要的「提醒」也講

## 判準

- 這一行會不會讓她在批次那一頁填的病歷號沒寫進那一位身上？
- 打字的時候名單會不會被重畫（游標、輸入法被洗掉）？

## 做完時留下的（10/19 段二收尾）

- domain：`newRow()` 多 `chartNo: ''`；`customerFor()` 寫 `chartNo`（空的寫 null）；新的 `chartNoClashes(rows, existing)` → `Map<key, 那一句>`（句子是 `fieldWarnings()` 那一句；名單裡另一位也比）；
  `rosterWarnings()` 收 `ctx.existing`，摘要的「提醒」也講
- 畫面：名單每一列名字右邊一格 `.roster__chart`（`inputmode="numeric"`、5.5em、`placeholder="病歷號"`）；同號 ⚠ 在名字底下（`data-chartwarn`）。
  打字走 `wirePage()` 新掛的 `input` 委派：只改 `state.rows`、換那幾句 ⚠、重畫摘要 —— **名單不重畫**（E2E 量了焦點還在同一個節點）
- 360px 截圖看過：⚠ 那一句在名字底下換行，擠但看得完
- 測試：`tests/bulk-chart-number.test.js`；E2E 77 C14；`pick()` 挑出來的 07、08、24、69 照跑全綠
- `docs/操作手冊.md`「七之一」那一句補了「快速建立一群」那一頁
