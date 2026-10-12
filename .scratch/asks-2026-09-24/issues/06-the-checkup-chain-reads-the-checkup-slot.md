# 健檢那條鏈看健檢那一段

Status: done
Blocked by: 04
來源：`../spec.md` 第 06 條（第三點 b、R3、R4、Q4「排查會不會讓流程亂掉」）
動工前先讀：ADR-0042、ADR-0065、`domain/followups.js` 的 `doneVisitsFor()`／`claimedExams()`／`bookingForExam()`／
`syncFollowupTasks()`、`domain/nthFollowup.js` 的 `examVisits()`／`nthsBookedFor()`、`domain/visits.js` 的二返驗證（1428、1572 行附近）

## 她要的

> b我還發現健檢被取消後 二返還可以連結到那次被取消的健檢?

> 4 好 只有已完成按得下去可以，不要讓整個流程亂掉，也可以在幫我排查會不會有其他地方會不小心讓流程亂掉

## 為什麼會這樣

`followups.js` 與 `nthFollowup.js` 問的是**整筆**：

| 在哪 | 問什麼 | 結果 |
|---|---|---|
| `doneVisitsFor()`（267） | 整筆已完成 ＋ 有一段用這一筆額度 | 健檢那段取消／未到、同一天別段做了 → 還是候選（重現）；還會長「追蹤健檢報告」（R4） |
| `claimedExams()`、`bookingForExam()`（311、369） | 整筆沒取消 | 二返那一段取消了、同一天別段還在 → 還「佔著」那一次健檢，顯示「已約」（R3） |
| `syncFollowupTasks()` 的 `stillDone`（629） | 整筆已完成 | 同上 |
| `nthFollowup.js` 135、185 | 同上兩種 | n返 那一排一樣 |

04 之後還有反方向：健檢那段結了、同一天別段還開著 → 整筆已確認 → 追蹤健檢報告不長。

## 談定的做法

- 「這一次健檢做完了」＝ **用這一筆額度的那一段，自己是已完成**
- 「這一場二返（n返）佔著那一次健檢」＝ 那一段是**待確認／已確認／已完成**。取消的不佔；**未到的也不佔** ——
  人沒來，要重約一場接回同一次健檢（不然那一次健檢在那一排上永遠是「已約」、按不下去）
- 那幾支全部走同一個判斷（寫成兩支小的 helper，放在 `followups.js`，`nthFollowup.js` 借）

## 判準

- 健檢那一段取消了、同一天別段做了：「這是哪一次健檢」不列它（11 之後列但按不下去）、不長追蹤健檢報告？
- 二返那一段取消了（同一天別段還在）：那一次健檢**不再**顯示「已約」、約二返那一張寫「還沒約」？
- 二返未到：同上，可以重約一場接回同一次健檢？
- 健檢那一段先結、同一天別段還開著：追蹤健檢報告**現在就長**？
- `owed()`（還欠幾次）一個字都沒改（它本來就逐段）？

## 實作時跟上面不一樣的地方

- 兩支 helper 放在 `followups.js`：`usedAndDone(visit, entitlementId)`、`holdsExam(visit, slot)`，都走
  `slotOutcome()`（不 import `visits.js` —— `visits → nthFollowup → followups` 已經是一條鏈，再接回去就是循環）。
- 多改一處：試算表的二返註記（`sheetReport.js` 的 `bookingsByExam()` 走 `holdsExam()`；照位置猜的 `bookingsOf()`
  只猜**沒連結**的舊資料 —— 不然被取消的那一場會被猜回去）。
