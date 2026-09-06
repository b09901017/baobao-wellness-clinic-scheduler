# 試算表註記「這一天用了哪一台」

Status: 已完成
Blocked by: 13

## 她說的

> 如果是選四選一那筆，那他一樣是扣四選一，但是我希望能像二返那些註記一樣，
> 就是在當天的那一列下面，可以註記是ILIB sis indiba等等，如果是直接選ILIB
> 或是直接選sis indiba 那就扣那個，然後不用註記

## 判準

**額度有得選才註記。** 也就是 `type === 'pool'` 而且 `optionEquipmentIds.length >= 2`。

單台的池（`超磁場(60)`）與 `single`（ILIB、健檢）**不註記** —— 那一列的名字
已經講了是哪一台，再寫一次是噪音。

## 現成的機制

二返註記走的路（`domain/sheetReport.js` 的 `followupNotes()`）就是這個形狀：
`{ dateIndex, text }`，寫在矩陣底下、對齊日期欄。`.gs` 那側是
`renderFollowupNotes()`。

**但不可以塞進同一個陣列。** `.gs` 把 `followupNotes` 全部畫在**同一列**，
同一個 `dateIndex` 後面的會蓋掉前面的（`sheetReport.js` 那一段的註解已經寫著）。
一位客戶同一天做了健檢又做了四選一是會發生的，所以兩種註記要分開。

## 形狀

```js
// syncBundle() 的每一張表多這一塊
equipmentNotes: [
  { label: '復能四選一(60)',
    cells: [{ dateIndex: 3, text: 'SIS' }, { dateIndex: 7, text: 'ILIB' }] },
]
```

**一筆額度一列**，畫在那一筆額度那一列的正下方（她的原話：「在當天的那一列下面」）。
帶 `label` 是因為一位客戶可能同時有四選一與三選一，兩列都要註記時得分得出來。

`text` 用**別稱**（`13` 的 `short` 情境）：`SIS`、`INDIBA`、`ILIB`。
她自己在舊表上寫的就是簡寫（`CONTEXT.md`：「她在行事曆與試算表上寫的是簡寫」）。

同一天同一筆額度有兩段時用頓號接（`SIS、INDIBA`），不要蓋掉一個。

## 資料格式升版

`SYNC_FORMAT` 3 → 4，`sheets/readonly-report.gs` 的 `SUPPORTED_FORMAT` 跟著。
**她要回 Google 試算表把 `.gs` 重新貼一次並重新部署**（2026-09-06 確認她會做）。

`tests/sheet-script.test.js` 盯著兩邊對得上。

## 順手：讓版本對不上這件事看得見

CLAUDE.md 記著：對不上的話「app 照樣推、`.gs` 整包拒收，而畫面上看起來跟推好了
一模一樣」。**查過之後那句話已經過期了** —— `data/sheetSync.js` 的
`noteFailure()` 把失敗記下來，`domain/sheetReport.js` 的 `describeSync()` 把它
畫成紅色的一段，`#/settings/report` 上看得到。

所以這一段剩下的是**講出她該做什麼**：`.gs` 那句話講的是原因（「這份指令碼
只認得 3」），而她要的是下一步。錯誤訊息裡提到版本時多一句：

> 到 Google 試算表 → 擴充功能 → Apps Script，把 `sheets/readonly-report.gs`
> 整份重新貼一次，然後重新部署。

CLAUDE.md 那一列要跟著改（`12`）。

## 手動貼上那條路

`sheetRows()`（她複製／下載貼回去的那一份）也要有同樣的註記列，
接在那一筆額度那一列下面。兩條路長得一樣是這一支的既有原則
（`followupNotes` 那一段的註解寫著為什麼一條攤成幾列、一條擠在一格）。

## 不做的

- **不改矩陣裡的符號。** `○ △ ✓ ✗` 四種是 ADR-0024 定的，不要變成 `✓SIS`。
- **不註記治療師或診間。** 她只講了器材。試算表是「還剩幾次」的報表，
  不是排班表。
- **不動 `followupNotes()`。** 二返註記一個字都不改。

## 測試

- `tests/sheet-report.test.js`：多選的池會註記、單台的池與 single 不會；
  同一天兩段用頓號接；`dateIndex` 對得上那一欄。
- `tests/sheet-script.test.js`：兩邊的版本號一致，`.gs` 認得 `equipmentNotes`。
- `tests-e2e/specs/09-sheet-and-import.spec.js`：貼上那條路的產物有那一列。
