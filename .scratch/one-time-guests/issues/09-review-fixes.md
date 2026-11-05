# 09：段五審查的修正（REVIEW.md R1–R13）

Status: in progress
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

（做完補）
