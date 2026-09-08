# 日曆逐段上色，資料健檢多一列盯著推導對不對得起來

Status: done
PR: 1（地基）
動工前先讀：`docs/adr/0039`（六種顏色）、`docs/adr/0061`（取消的畫出來但暗掉）、`docs/adr/0080`

## 一、日曆逐段上色

`domain/calendar.js` 的 `agendaFor()` 與 `monthBars()` 已經是**一段一列／
一段一條**了（ADR-0080），只是顏色讀的是整筆的狀態。改成讀 `slotStatusOf()`。

**不開第八種顏色**（ADR-0039：色相已經用完了）。取消掉的那一段走既有的
「畫出來但暗掉」（ADR-0061），只是現在是逐段暗掉。

## 二、資料健檢新一列：來訪的狀態跟它的時段對不起來

`visit.status` 是推導出來又寫進文件的，所以它**可能跟時段對不起來**——
手改 Firestore、或某一支忘了重推都會。這一列就是盯著它：

```
id       visitStatusDerived
label    來訪的狀態跟它的時段對不起來
hint     整筆寫著「已確認」，但底下三段有一段還是待確認 ——
         日曆上的顏色與待辦中心那一列會各講各的
fix      重推一次（拿 visitStatusFrom() 的答案寫回去）
```

`checkVisitStatus()` 既有那三種不要動，這是第四種。

## 三、匯入那兩支

`domain/mergeImport.js` 的 `statusFor()` 與 `domain/legacyImport.js`
逐段寫 `status`。`statusFor()` 的規則（依匯入當下的日期，ADR-0029）
**一個字都不改**，只是把答案寫到每一段上。

## 測試要蓋到的

- 逐段顏色：三段裡一段取消 → 日／週那一列只有那一條暗掉
- 資料健檢認得出對不起來的那一筆，修正之後再掃一次是綠的
- 匯入進來的來訪每一段都有 `status`，而且跟 `statusFor()` 一致
