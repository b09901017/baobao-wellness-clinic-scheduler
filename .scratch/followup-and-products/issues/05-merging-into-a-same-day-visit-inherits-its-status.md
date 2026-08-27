# 同一天再壓一筆，新的時段繼承了舊來訪的狀態

Status: done
回報者：使用者，2026-08-27（「我先壓今天 9 點然後去 todo 勾掉，接著在壓表同一個人的一樣項目、
可能說 10 點，這樣 todo 沒有產生任何東西ㄝ?」）
動工前先讀：`SPEC.md` 第 4.1／4.4 節、`docs/adr/0027-registration-tasks-wait-for-the-customer.md`

## 她做了什麼

1. 壓表：客戶A，今天 9:00，健檢 → 記成「已壓表，等客戶回覆」
2. 待辦中心：勾掉「跟客人確認時間」→ 那一筆轉成 `confirmed`
3. 壓表：同一個人、同一天、同一個項目，10:00
4. **待辦什麼都沒長出來**

## 為什麼

`ui/views/schedule.js` 的 `commitSlot()`：

```js
const sameDay = sameDayVisit(selected, view.day);
const visit = sameDay
  ? { ...sameDay, note, slots: [...(sameDay.slots ?? []), slot] }
  : { …, status: INITIAL_STATUS, … };
```

併進去的時候**整筆來訪的狀態原封不動**。第 2 步已經把它推到 `confirmed` 了，
所以第 3 步加上去的那一段一出生就是「客戶已確認」。

「跟客人確認時間」那一列是從 `visits(status === 'pending_confirm')` 推導的
（ADR-0001），來訪不在那個狀態就不會出現。所以她的判斷完全正確：

> 就是有更新同一個人同一天，是不是只要我有先按客戶確認了，他就會默認當天我排的所有東西都確認了?

**是的。而且不只確認這一種。**

## 還有兩種更糟的，她還沒遇到

`sameDayVisit()` 濾的是 `isActive(v)`，而 `isActive` 只排除「已取消」與「已刪除」。
所以 `done` 與 `no_show` 的來訪**也會被併進去**：

| 併進什麼狀態 | 後果 |
|---|---|
| `confirmed` | 新時段被當成已確認。不長「跟客人確認時間」。（她遇到的） |
| `done` | 新時段**當場算成已完成**：`slotOutcome()` 回 `done`、額度立刻扣一次、不長「簽療程單」那一列。而且 `isLocked('done')` 是真的 —— 她回到來訪編輯器連改都改不動，要走更正流程 |
| `no_show` | 新時段當場算成未到，額度那一次也記成沒來 |

`done` 那一列是最嚴重的：**壓表繞過了「已完成是唯讀鎖定區」這條規則**（SPEC 第 6.4 節）。
來訪編輯器擋得住（`locked = isLocked(draft.status) && !ctx.unlockReason`），壓表沒有這一道。

日期選得到今天，而今天的來訪可能早上就結案了 —— 所以這不是理論上的邊緣狀況。

## 想要的樣子

**新加的那一段永遠是「還沒問過客人」。** 併進同一天是排班單位的事（SPEC 第 4.4 節：
排班的原子單位是「某人某天來一次」），不是「這一段的進度」的事。

三條路，看併進去的是什麼狀態：

| 舊狀態 | 怎麼做 |
|---|---|
| `pending_confirm` | 照舊直接併，什麼都不用問 |
| `confirmed` | 併進去，**整筆退回 `pending_confirm`**，並且在確認對話框寫清楚 |
| `done` / `no_show` | **不併**。那一天已經結案了，新的一段要另開一筆來訪 |

`confirmed` 退回 `pending_confirm` 是刻意的：一筆來訪只有一個狀態，
而她確實還沒跟客人講過這一段。退回去之後那一列會重新出現，她問完再勾一次 ——
**多問一次的代價，遠小於一段沒問過的時間被當成談定了。**

退回去也要把 `confirmedAt` 清掉。已經長出來的登記任務不動（`syncTasksForVisit()`
本來就不會因為狀態往回走而刪掉既有任務，見那一支的檔頭）。

`done` / `no_show` 不併就要有第二筆來訪 —— `sameDayVisit()` 要改成只認
`pending_confirm` 與 `confirmed`。**Firestore 那邊本來就收得下同一人同一天兩筆**
（沒有唯一性限制），日曆也畫得出來。

## 確認對話框要說什麼

併進一筆已確認的來訪時：

> 已經在 Examine 壓好表了嗎？
> 客戶A・8/27(四) 10:00–12:00 健檢
> 這一段會併進同一天已經有的來訪裡
> **那一筆本來是「客戶已確認」，會退回「等客戶回覆」** —— 這一段還沒問過客人
> 待辦會重新出現一張「跟客人確認時間」

## 驗收

- 併進 `confirmed` 的來訪 → 整筆退回待確認，「跟客人確認時間」重新出現
- 併進 `done` 的來訪 → 另開一筆新來訪，額度不會被當場扣掉
- 對話框把「會退回等客戶回覆」講出來
- `tests/visits.test.js` / `tests/tasks.test.js` 補上這三條

## 做了什麼（2026-08-27）

規則放在 `domain/visits.js`，壓表那一頁不自己判斷：

- `acceptsMoreSlots(status)` —— 只有 `pending_confirm` 與 `confirmed` 收得下新時段。
  `sameDayVisit()` 加上這一道，所以已完成／未到的那一天會另開一筆新來訪。
- `withExtraSlot(visit, slot, { note })` —— 併進已確認的那一筆時整筆退回
  `pending_confirm`，`confirmedAt` 一起清掉，回傳 `{ visit, reopened }`。

確認對話框改由 `domain/consequences.js` 產生（見 issue 07）：抬頭不再寫死
Abovee，而且 `reopened` 時一定會講出「會退回等客戶回覆」。

面板上「這天已經記了 N 段」那一句也跟著分開講已結案的那幾筆（`dayTally()`），
底下那一句換成會發生的事（`addNote()`）。

`tests/consequences.test.js` 24 條。
