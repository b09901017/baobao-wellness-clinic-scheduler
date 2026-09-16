# 從空的那一天新增、把日期改到他已經有一段的那一天 → 同一天兩筆

Status: todo
Blocked by: 06
來源：`../spec.md`（報告 §1.2b）
動工前先讀：`docs/adr/0083`（一天就是一筆）、`domain/visits.js` 的 `sameDayState()`／`editorTarget()`

## 現在壞在哪

併不併是 `boot()` **開表單那一刻**決定的（`ui/views/visitEditor.js:137`）。
之後她改日期時，`change` 那一段只重讀了撞期用的 `sameDayVisits`（`:376-383`），
**沒有重問 `sameDayState()`** —— 於是同一位客戶同一天兩筆，ADR-0083 破功。

E2E 實際走過（`99-prelaunch-repro.spec.js` P3）：資料庫裡真的兩筆，兩筆都是 `pending_confirm`。

資料健檢的「同一天有兩筆來訪」會列出來，但那一列的說明寫著
「現在只會有一筆（ADR-0083），**這是舊資料**」（`domain/health.js:66`）—— 而它是新的。

## 做法

- 日期換掉時重問一次 `sameDayState(customerVisits, customer.id, next.date)`：
  - 那一天有收得下的 → **接著編輯那一筆**（`editorTarget()` 已經是唯一那一份判斷），
    畫面上要講出來（她從一個空的日子排過去，畫面不說的話她會以為是新的一筆）
  - 那一天已經結案 → 照 ADR-0083 決定三開新的一筆，而且講出「9/15 那一天已經結案了」
- **不要在這裡重寫一份判斷。** `sameDayVisitFor()` / `sameDayState()` / `editorTarget()`
  是兩個入口共用的那一份，這一支只是在第二個時機再問它一次
- 已經填好的那幾段要留著（她改的是日期，不是重來一次）

## 判準

- **這一行會不會讓她改個日期就把已經填好的那幾段清掉？**
- 從空的那一天新增 → 改日期到他已經有一段的那一天 → 存下去之後**那一天只有一筆**
- 改到一個他那天已經結案的日子 → 開新的一筆，而且畫面講出來
- 改到一個他什麼都沒有的日子 → 跟以前一樣
- `99-prelaunch-repro.spec.js` 的 P3 轉綠
