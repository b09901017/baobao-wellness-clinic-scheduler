# 進度追蹤與客戶詳情「這個月」：取消的段不畫、不算

Status: done
來源：`findings.md` 第 5 條
動工前先讀：`public/js/domain/progress.js`（整支 173 行：`buildProgress()`、`rowFor()`、`dayFor()`）、
`public/js/ui/views/progress.js`（`progressDayHtml()`、`tallyHtml()`、`:164` 那一句提示、`:193`「N 天・N 段」）、
`public/js/ui/views/customerDetail.js:472-485`（「這個月」）、`public/js/domain/visits.js` 的 `slotStatus()`／`isLiveSlot()`、
ADR-0081、0089、0061、`tests/progress.test.js`（有的話）、`CLAUDE.md` 連動表「進度追蹤或客戶詳情的『這個月』那一列」
Blocked by: —

## 她要的

> 5. 照你的建議 採 (A)。這個頁面的核心目的是回答「這個人這個月實際上做了多少」，而取消的段實際上並未發生

## 為什麼會這樣

`progress.js` 的檔頭與 `PROGRESS_STATUSES` 的註解都寫「取消不在裡面」，進度追蹤的 `?` 也寫「取消掉的時段不畫」。
但 `buildProgress()` 只用 `isActive(v)` 濾**整筆**取消的 —— 那是逐段取消（ADR-0081）之前全部的取消。
之後一天裡只取消一段時，`dayFor()` 照樣把它收進 `slots`，`rowFor()` 把它數進 `slotCount`，而 `tally` 沒有 `cancelled` 這一格
→「3 段」但 ○1 ✓1。程式沒跟上，不是決定。

## 要做的

只改 `domain/progress.js`：

- `dayFor()`：`slotStatus(visit, slot) === 'cancelled'` 的那一段不收。**`index` 照舊是它在 `visit.slots` 裡的位置**（先 map 再 filter）——
  `data-slot` 印的是它，拿錯會開到別段（`CLAUDE.md` 那一列）。**未到（`no_show`）照畫**：那一段發生過（人沒來），而且 `PROGRESS_STATUSES` 有它。
- 濾完一段都不剩的那一天不要了；一天都不剩的那一位歸到 `idle`（「這個月沒有排」）。
  正常情況下每一段都取消時整筆會被推成 cancelled、`isActive()` 已經濾掉 —— 這一條擋的是整筆那個推導值過期的舊資料，不可以畫出一個空的日期抬頭。
- 「N 天・N 段」跟著對：兩個數字都從濾完的結果數。

畫面那一支（`progressDayHtml()`）不用改 —— 它畫收到的。提示那一句本來就寫「取消掉的時段不畫」，現在變成真的。
客戶詳情「這個月」共用同一份，一起好。日曆照樣看得到灰的（ADR-0061 不動）。

## 判準

- 「N 段」等於 ○△✓✗ 四個數字加起來嗎？
- 點那一列開的是對的那一段嗎？（取消的是第 1 段時，畫出來的第 1 列的 `data-slot` 要是 1 不是 0）
- 未到的段還在嗎？
- 一位客戶這個月唯一的一段取消了，他在「這個月沒有排」那一區嗎？

## 測試

- 單元：`buildProgress()` 一天兩段取消一段 → `slotCount` 1、`days[0].slots` 一筆而且 `index` 對；全部取消 → 進 `idle`；`no_show` 照算。
- E2E：既有進度追蹤那一支加一條，或新 spec —— 兩段取消一段 → 進度追蹤那一列「1 天・1 段」、點那一段開的是沒取消的那一段；客戶詳情「這個月」同樣。

## 文件

ADR-0134（她的原話）。`SPEC.md` 進度追蹤那一節一句。`CLAUDE.md` 連動表那一列補「取消的段在 `dayFor()` 濾掉，`index` 照舊是原本的位置」。

## 做完時留下的

- 濾在 `dayFor()`（先 map 再 filter）、空的一天在 `rowFor()` 濾掉、一天都不剩的那一位在 `buildProgress()` 歸到 `idle`。
  孤兒那一圈（指到不存在的客戶）同樣：一天都不剩就不列。
- 畫面兩支（`progress.js`、`customerDetail.js`）一行都沒改。
- 單元 5 條（`tests/progress.test.js` 最後一組）、E2E `58-verified-rules` 的 P1、P2。
