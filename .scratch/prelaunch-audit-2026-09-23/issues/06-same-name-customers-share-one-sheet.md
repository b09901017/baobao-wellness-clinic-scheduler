# 同名客戶在試算表上互相蓋掉

Status: done
來源：`../spec.md`
動工前先讀：`docs/adr/0102`（同名只提醒、照樣存得下去）、`domain/sheetReport.js` 的 `syncBundle()`、
`sheets/readonly-report.gs` 的 `sheetNameFor()`／`resetSheet()`／`removeStaleSheets()`、
CLAUDE.md「試算表的 `SYNC_FORMAT`」那一列

## 現在壞在哪

新增兩位同名客戶（新增頁只提醒「已經有 1 位也叫…」，照樣存得下去）→ 推到試算表 → **只剩一張分頁**，
後面那一位把前面那一位整張清掉重畫。app 收到的回報是 `{ sheets: 2, skipped: [] }`，看起來一切正常。

## 怎麼重現

把 `sheets/readonly-report.gs` 用 node 的 `vm` 跑起來，`SpreadsheetApp` 換成一個只記「分頁名字、A1、被清過幾次」的替身
（其餘方法回自己、可以一直串下去），餵 `syncBundle()` 產出的兩位同名客戶 →
`render()` 回 `sheets: 2`，替身裡只有 1 張分頁、被清空重畫 1 次。

## 為什麼

分頁名字就是客戶名字（`sheetReport.js:366` 的 `name: customer.name` → `.gs:557` 的 `sheetNameFor()`）。
第二位的 `resetSheet()` 找到同名那一張，而那一張第一列有「系統自動產生」（剛剛才畫的），所以整張清掉重畫。

## 做法（方向）

- 在 **domain 那側**（`syncBundle()`）把同名的分開 —— `.gs` 那側不算任何東西（它的檔頭）
- 分頁名要**每次推都一樣**（不然 `removeStaleSheets()` 每次都刪掉重建），所以不能用排序位置；
  可以用病歷號（客戶備註裡的 `CHART_NO_PREFIX`，`domain/identify.js` 讀得出來）或 id 的前幾碼
- 只有**真的撞名**的那幾位才加尾巴，其餘名字一個字都不變
- 如果做法是在 bundle 裡多一格（例如 `sheetName`），要升 `SYNC_FORMAT` 並同步改 `.gs` 的 `SUPPORTED_FORMAT`，
  **而她要回 Google 試算表重貼並重新部署**；只改 `name` 的值就不用升版 —— 兩條路讓她選
- 分頁名最長 90 字、斜線那幾個字元會被換掉（`sheetNameFor()`），加了尾巴之後兩位還是要不一樣

## 判準

- 兩位同名：試算表上兩張分頁，各自的額度與來訪對得上
- 只有一位叫那個名字：分頁名跟以前一模一樣
- 推第二次：兩張分頁都還在（沒有被當成過期的刪掉又長回來）

## 做了什麼（2026-09-23）

選了**只改 `name` 的值、不升 `SYNC_FORMAT`** 那一條 —— 她不用回試算表重貼 `.gs`。
`syncBundle()` 裡的 `sheetNames()`：只有撞名的那幾位加尾巴（先病歷號，沒有或也撞了就用 id 前 6 碼），
分頁抬頭也跟著印有尾巴的那一個（剛好讓她分得出是哪一位）。單元測試在 `tests/sheet-script.test.js`（跑真的 `.gs`）。
