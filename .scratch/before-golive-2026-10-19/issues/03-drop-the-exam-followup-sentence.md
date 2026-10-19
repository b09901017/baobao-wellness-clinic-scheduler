# 客戶詳情健檢那一句「健檢做完 N 次：二返做完…」拿掉

Status: todo
段：一（xhigh 那一段順手做；這一支本身是 medium）
動工前先讀：`ui/views/customerDetail.js` 的 `followupLine()`、`nthLine()`；`domain/followups.js` 的 `describePair()`；E2E `02-examine-chain.spec.js:229`；`tests/followup-link-before-exam.test.js` 的「09 客戶詳情」那一組、`tests/followups.test.js` 裡讀 `describePair` 的；`docs/操作手冊.md`、`docs/常見問題.md` 有沒有講到那一句

## 她要的

> 4.  客戶詳情建檢那一句的數字加起來對不上。那要不就不要呈現了，好像也沒必要 ?

我同意，並講好留著的：三返那幾行、「這筆健檢還沒有對應的二返額度 → 補一筆二返額度」那一句與按鈕。

## 為什麼會這樣

`describePair()`（2026-10-09，ADR-0145）三個數字各講各的：「約了」包含接在**還沒做完**的那一次健檢上的二返，「還沒約」是**做完的**那幾次還欠的（`owed()`）—— 但都寫在「健檢做完 N 次：」後面，看起來在拆那 N 次。
例：做完 1 次＋排著 1 次（二返接在排著那一次上）→「健檢做完 1 次：二返做完 0、約了 1、還沒約 1」。帳是對的，句子讓人以為加起來要等於 1。

## 做法

`followupLine()` 不畫那一句；`describePair()` 只剩這一個呼叫端 → 刪掉它與它的測試（`owed()` 還有別人用，不動）。

## 過目改的（10/19）

另外要改：`CLAUDE.md`「健檢與二返的關係」那一列講 `describePair()` 的那一句（「客戶詳情那一句是三個數字」）、`SPEC.md:1540` 附近、`domain/entitlements.js:220` 附近的註解、`customerDetail.js:1041` `followupLine()` 的檔頭註解。
E2E `02` 的 J-D4 改成量「報告勾掉之後『約二返』有 1 張」（那支原本要證明的是鏈走得下去）。

## 判準

- 客戶詳情的健檢額度卡底下沒有「健檢做完」這幾個字；三返那幾行、沒有二返額度那一句照舊在
- E2E `02` 那一條改成量別的（或拿掉那一行斷言），**不是改成 `not.toContain` 就算了** —— 看那支 spec 原本想證明什麼（健檢做完之後次數對），換一個還看得到的地方量
- `grep -rn "describePair\|健檢做完" public/ tests/ tests-e2e/ docs/` 只剩該留的
