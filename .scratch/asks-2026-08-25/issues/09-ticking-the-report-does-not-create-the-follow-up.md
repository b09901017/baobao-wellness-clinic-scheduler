# 勾掉「追蹤健檢報告」不會長出「約二返」

Status: todo
來源：她的十二件事，2026-08-25（`../spec.md`）
動工前先讀：`docs/adr/0042`、`docs/adr/0022`、`SPEC.md` 第 7 節規則 8

## 她問的

> 健檢的流程怪怪的？目前的流程是怎樣？
> 我原本期待我在壓表那邊壓了健檢後，應該在待辦的和客人確定時間那邊也要長出這個
> 然後我也發現我把「追蹤健檢報告」勾掉後沒有長出約二返？客戶那邊也沒有更新？

## 目前的流程（規格上）

```
加購健檢 ──成對建出 N 次二返額度（data/customers.js 的 createEntitlement）
   │
壓表壓一筆健檢 ──▶ 來訪 status = pending_confirm
   │                └─▶ 待辦：跟客人確認時間          ← 這一段是對的
   ▼
客人說可以 ──▶ confirmed ──▶ 登記任務長出來（健檢是 B 類，在 Examine 壓，
   │                          確認後沒有後續登記，所以這裡什麼都不長）
   ▼
那天過了 ──▶ 待辦：簽療程單 ──▶ done ──▶ 次數扣掉
   │
   └──▶ 待辦：追蹤健檢報告（死線 = 健檢日 + 21 天）
              │
              勾掉（＝報告拿到了）
              │
              ▼
        待辦：約二返（死線 = 勾掉那天 + 7 天）
              │
              勾掉（＝約好了）──▶ 那一筆健檢從此不再出現
```

**「壓了健檢之後會出現在跟客人確認時間」是對的**，這一段沒有壞：
`visitsToConfirm()` 收的是所有 `pending_confirm` 而且日子還沒過的來訪，
不看課程。如果她沒看到，看一下那一筆的日期是不是已經過去了 ——
過去的那些在「簽療程單」那一列（`visitsToClose()`），兩支是同一個切法的兩半。

## 壞掉的是哪一段

`syncFollowupTasks()`（`domain/followups.js`）算得完全正確 ——
`stationFor()` 第一條就是「報告勾掉了 → 約二返」。問題是**沒有人在勾掉的時候
叫它**。它只有三個呼叫端，全部在 `data/visits.js`：

```js
save()     → taskOps() → followupOps() → syncFollowupTasks()
remove()   → 同上
restore()  → 同上
```

而勾掉一筆任務走的是 `data/tasks.js` 的 `setDone(ids, done)`，它只寫兩個欄位：

```js
export function setDone(ids, done) {
  const doneAt = done ? new Date().toISOString() : null;
  return repo.commit(ids.map((id) => ({ op:'update', path:'tasks', id, changes:{ done, doneAt } })));
}
```

所以「約二返」要等到**這位客戶下一次有來訪被存檔**才會突然冒出來
（而且死線是從 `report.doneAt` 回推的，所以它一出生可能就是紅字）。
「客戶那邊也沒有更新」是同一件事：客戶詳情頁的任務清單讀的就是 `tasks`。

## 為什麼會漏

`followups.js` 的檔頭把三個問題寫在一起，第三個是
「那該有幾張待辦、掛在哪幾筆健檢上、現在走到鏈條的哪一站」——
**那一段的觸發條件是「鏈條的狀態變了」，不是「來訪存檔了」**。
來訪存檔只是其中一種讓它變的方式，勾掉報告是另一種，而只接了第一種。

## 做了什麼

`data/tasks.js` 的 `setDone()` 改成：寫完那幾筆之後，**針對這一批裡屬於健檢鏈
的任務所影響到的客戶，各跑一次 `syncFollowupTasks()`**。

- 一批可能跨好幾位客戶（她在 Examine 一次掛完整批回來勾），所以照 `customerId`
  分組，一位一個 commit。
- **只有這一批裡真的有 `追蹤健檢報告` 或 `約二返` 的時候才多讀資料**
  —— 勾一批 Examine 不該為了這件事多打六次往返（同 `followupOps()` 裡
  `hasPairing` 那道提前結束的判斷）。
- 兩段分開 commit 是刻意的：勾完成本身要能單獨成立。第二段失敗了，
  下一次存來訪或下一次勾任務照樣會把鏈條接上（`syncFollowupTasks()`
  本來就是「算出現在該有什麼」而不是「加一張」），所以不會卡死。
  復原退得回第一段（勾掉那件事），那才是她按復原時想退的東西。

規則一條都不搬 —— 全部留在 `domain/followups.js`。

## 順帶檢查過、沒有壞的

- 加購健檢會成對建出二返額度（`data/customers.js` 的 `createEntitlement()`）
- 健檢取消／改成未到時，兩張還沒做的待辦跟著收（`syncFollowupTasks()` 的
  `remove` 那一段），已完成的不刪
- 客戶詳情健檢卡片底下那一句「健檢做完 N 次，二返還欠 M 次」（`describePair()`）
- 資料健檢的「二返額度」那一項（缺配對會列出來，還給得出一鍵補上）

## 驗證

- `npm test`（`tests/followups.test.js` 已經蓋掉規則本身；
  新增 `tests/tasks.test.js` 一組：`setDone` 之後該產生哪些後續操作）
- 瀏覽器：一位有健檢額度的客戶 → 壓一筆健檢 → 待辦看得到「跟客人確認時間」
  → 確認 → 把日期改成過去（或等那天）→ 簽療程單 → 待辦「來訪之後」出現
  「追蹤健檢報告」→ 勾掉 → **重畫之後同一頁就長出「約二返」** →
  客戶詳情的任務那一段也看得到
