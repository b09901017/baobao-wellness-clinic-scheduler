# 健檢取消或未到：確認框與抽屜講「後面接著一場二返，不會跟著改」

Status: done
Blocked by: 02
動工前先讀：`01` 的「1. 健檢被取消或未到」「2. 健檢改期」、「prelaunch-fixes 的審查順手記下來的」第二條；ADR-0070、0142「取消那一道也講」

## 她要的

> 1. 健檢被取消或未到：二返不自動取消，取消的確認框要講「後面接著一場二返，不會跟著取消」……
> 2. 健檢改期：……連結要跟著搬到新的那一段，或至少講出來。最容易漏。
>
> 原則：連結只是記錄，任何一邊被取消或改期都只提醒、不連動（ADR-0070）。

## 範圍

- `cancelConsequences()`：取消的段裡有健檢那一段、有一場**活著**的二返（或 n返）接在這一筆上 → 一句
  「M/D 那一場二返接在這一次健檢後面 —— 不會跟著取消；重新約好健檢之後，回到那一場二返換『這是哪一次健檢的』」。
  四個入口（日曆長按、批次取消、確認抽屜 ✗、編輯器 ×）都經過它。
- `closeConsequences()`：健檢那一段按 ✗ 時同一句（「不會跟著改成未到」）。
- 同一天改時間（`rebookSlot()`）不講（連結記的是來訪，自動跟著）；改成別的課程（那一筆沒有活著的健檢段）＝取消，要講。
- 審查記下來的第二條：`cancelConsequences({ sameDay })` 其實是「這位客戶的全部來訪」→ 改名；批次取消與確認抽屜各寫一次的「逐段套上取消 → 問約二返」收成一支。
- 來訪編輯器那一排：原本指著的那一次取消了 → 那一顆標「已取消」、按不下去、**照樣選中**、換得掉。

## 判準

- B 取消（四個入口各一次）：二返那一段一個欄位都沒變；確認框有那一句；A 的「約二返」回來（那一句也講，`followupBookingLines()`）。
- B 簽成未到：抽屜講同一句。
- B 同一天改時間：不講。
- 編輯器打開那一場二返：取消的那一顆是選中的樣子、按不下去、點別顆換得掉。

## 做完時留下的

- `consequences.js` 的 `strandedFollowupLines({ before, after, entitlements, coursesById, verb })`：那一次健檢**本來接得上、之後接不上了**（`PICKABLE_EXAM`），接在它上面還佔著的每一場一句。
  認得健檢靠 `examEntitlementIds()`（所以要 `coursesById`）。
- `cancelChainLines({ customer, visits, cancels, chain, coursesById })`：「約二返」那幾句（`followupBookingLines()`）＋上面那一句，**四個取消入口都走它**；
  批次取消與確認抽屜不再各自逐段 `applyStatus()`。`chain` 是 `null`（沒有配對、讀不到）就一句都不講。
- `cancelConsequences()` 的 `sameDay` 改名 `customerVisits`（它從來都是全部來訪）；四個呼叫端與 `consequences.test.js` 跟著改。
- 確認抽屜有 ✓ 也有 ✗ 的那一條沒有確認框 → 那一句接在存完那張卡片上（`showConfirmed()` 的 `said`）；全部 ✗ 的那一條在確認框上。
- 簽療程單抽屜健檢 ✗：「不會跟著改成未到」。`rebookConsequences()` 多收 `customerVisits`／`entitlements`：健檢那一段改成別的課程時講；只改時間不講。
- 編輯器那一排（原本指著的那一次取消了）：`examChoicesFor()` 本來就列出取消的那一次、`selected` 讓它照樣是選中的樣子（`f.chips` 的 `value`）、按不下去、點別顆換得掉 —— 沒有改程式，E2E 沒有另外量。
- E2E `65` L3（日曆長按）；`20`、`22`、`34`、`05`、`63` 過。
