# 09：段五審查的修正（REVIEW.md R1–R13）

Status: done
Blocked by: 01–08、段五審查

編號照 `REVIEW.md`。每一條先紅燈；R1、R2 動到 domain 與存檔驗證。

| # | 要改的 | 測試 |
|---|---|---|
| R1 | 拍訂購單的同名比對不收一次性客人（`orderForm.js` 的 `sameNameCustomers()` 一處濾）；照片上的名字跟一位一次性客人同名時，卡上名字旁邊 ⚠ 講 `GUEST_SAME_NAME`；SPEC 規則 13、CLAUDE.md 那一列補「拍訂購單」 | `tests/one-time-review-fixes.test.js` |
| R2 | `validateVisit()`：一次性客人身上任何一段沒標一次性就擋；來訪編輯器對一次性客人永遠不拿額度當預設 | 同上 |
| R3 | 「約二返」那一張接的那一次是一次性的健檢 → 也走「去日曆排」（`bookFollowup()` 與 `labelGuestBookings()` 共用一個判斷）；操作手冊補一句 | 同上（判斷那一支） |
| R4、R7 | 日曆新增名字卡、轉成我的客戶：`undoable: false` | 原始碼掃描 |
| R5 | `oneTimeErrors()` 兩句換成講怎麼辦 | 同上 |
| R6 | `toMyCustomerConsequences()` 前兩句合成一句、不講過頭 | 同上 |
| R8 | 日曆「要幫誰排？」沒有一位名字一模一樣就照樣畫「＋ 新增一次性客人」 | 同上（判斷那一支） |
| R9 | 「妳」→「你」 | 同上 |
| R10 | 確認框 n返 那一句跳過一次性的段 | 同上 |
| R11 | 資料健檢 `moved()` 對一次性的段 `giftKind` 寫 `null` | 同上 |
| R12 | CLAUDE.md 那一列、`slotDraft.js` 註解改成兩處 | — |
| R13 | 有餘力再做 | — |

## 做完時留下的

- 段六（11/5）：R1–R12 修完，R13 沒做（不修也不會錯；以後改「做什麼」那一排的字要改 `visitEditor.js` 的 `secondOptionsFor()` 與 `slotOptions.js` 兩處）。
  commit：`d5e0eb21`（R1–R12）、`d533ee8c`（E2E）、`b134c353`（手動驗收抓到的那一條）
- 新的 domain 函式：`orderForm.js` 的 `guestSameNameSay()`、`customers.js` 的 `offersNewGuest()`、`nthFollowup.js` 的 `followupGoesToCalendar()`
- R1 擋在 `sameNameCustomers()` 一處（`blockersOf()`、`addOnTarget()`、卡上那兩顆都問它）。拍訂購單那一層**沒有**存檔前那一道確認框（本來就沒有），所以「⚠ 與存檔前那一道」只有 ⚠
- R2 驗證那一道拿掉 `&& !slot.entitlementId`；編輯器 `blankVisit()`／`withNewSlot()` 對一次性客人 `first` 是 `undefined`
- 測試：`tests/one-time-review-fixes.test.js`（23 條，一條一個審查編號）、`tests/eecp-one-course.test.js` 多一條（R11）、`tests/one-time-guest.test.js`／`one-time-guest-booking.test.js` 換成新的句子與寫法；
  E2E `40` 多 O3b（R1）、`95` 多 B5b（R3）、B1 改成 R8 的新規則並多一行「還沒選課沒有那一塊」
- **手動驗收抓到的**：一次性客人剛開的那一段（還沒選課）就畫「這是哪一次健檢的 / app 裡沒有接得上的健檢」—— `isFollowupCourse(null)` 是 true（不是健檢的課 `followupCourseId` 都是 null）。
  這一輪的那一處修了（`guestExamField()` 先問 `slot.courseId`）；develop 上原本就有的同一個形狀（`sheetReport.js` 的 `rowNthOf()` 等）記進待辦，不在這一支 PR 改
- 單元 5736 全過、skipped 0
