# 另約一次健檢時，講「有一場二返還接在被取消的那一次上」

Status: done
Blocked by: 06
動工前先讀：`01` 的「她 10/9 回的」第 2 點、「2. 健檢改期」

## 她要的

> 2. 要

落成（`01`）：另約一次健檢（壓表、日曆新增、拍 Abovee 存一段健檢）時，這位客戶有活著的二返接在取消／未到的健檢上 →
存檔前那一道多一句「M/D 那一場二返還接在被取消的 M/D 健檢上 —— 要接到這一次的話，去日曆點那一場二返改」。**只講不改。**

## 範圍

- 一支 domain（`followups.js`）：這位客戶「活著的二返接在取消／未到的健檢上」有哪幾場（資料健檢 `10` 也用它）。
- 三個入口存檔前那一道（`consequences.js` 的 `bookingConsequences()`／`aboveeConsequences()` 經手的地方）：這一次新加的段裡有健檢 → 加那一句。
  確認框的句子只寫在 `consequences.js`。

## 判準

- B 取消、二返還接在 B 上：壓表、日曆新增、拍 Abovee 存一段新的健檢 → 確認框有那一句；二返的連結一個字都沒變。
- 沒有這種二返、或這一次沒有新的健檢段：不講。

## 做完時留下的

- `followups.js` 的 `strandedFollowups(entitlements, coursesById, visits)`：還佔著、卻接在接不上（取消、未到）的健檢上的二返與 n返。
  認得健檢靠 `pairsOf()`（這一支不可以 import `nthFollowup.js`）。10 的資料健檢也用它。
- `consequences.js` 的 `strandedOnNewExamLines()`：這一次新加的段裡有一段健檢才講。`bookingConsequences()` 多收 `customerVisits`／`entitlements`、
  `aboveeConsequences()` 多收 `entitlementsBy`／`visitsBy`（同一位好幾天都有新的健檢時只講一次）。三個入口都接上了。
- **順手修的（她沒點名，屬於同一件事）**：壓表存一段二返時那一句「待辦上那一張『約二返』會自己收掉」是寫死的 ——
  只接得到做完的健檢時才成立；接在還沒做完的健檢上時根本沒有那一張。改成拿存檔真的在跑的那一支試算（`followupBookingLines()` ＋ `chainInputs()`，ADR-0070）。
  所以**壓表**存一場沒連結的二返時，那一道現在也會講「另一次健檢的『約二返』會收起來」（ADR-0142 當時說「那幾道確認框照舊不講」）——
  **來訪編輯器與拍 Abovee 存二返那兩道還沒講**，列給她決定要不要補。
- ADR-0145 這一次 commit 補了 03–07 那幾段。
- E2E `65` L4（日曆新增）；`20`、`22`、`34`、`05`、`63` 過（06、07 一起跑的）。
