# ADR-0097：確認也是逐段的

日期：2026-09-16
狀態：已接受
延伸：[ADR-0081](./0081-the-slot-carries-the-lifecycle.md)（時段才是原子單位 —— 這一支把它做完）、
[ADR-0085](./0085-editing-a-visit-means-editing-that-slot.md)（改一筆來訪就是改她點的那一段）
收窄：[ADR-0027](./0027-registration-tasks-are-born-on-confirmation.md)
的閘門（從「整筆轉 confirmed」改成「那一段轉 confirmed」）。**0027 的規則本身一個字都沒變**

## 背景

她 2026-09-16 一口氣報了兩件事，而它們是同一個 bug 的兩個出口：

> 如果在新增同一個人兩段來訪，然後我只長按其中一段，說客戶已確認，會變成整天的
> 都變成已確認，能不能我那個時段說確認就那個時段確認就好，然後如果我想要一次確認
> 整天，我可以去代辦那邊做，然後我這邊確認了某個時段客戶已確認後 待辦那邊的
> 這個時段就可以收掉

> 我發現這一項代辦，的跟客人確認時間沒有寫的符合事實，也就是如果這天A已經有兩個
> 已確認的時段如果我新增一個來訪 那原本已確認的那兩個的那一項的待辦中的
> 跟客人確認時間 就會被取消打勾？不知道這一項待辦的其他是不是也有相同問題
> 幫我一次修復

ADR-0081（2026-09-08）把整條生命週期搬到時段上。八天之內取消跟完了、顯示
（`statusForCard()`）跟完了、次數（`slotOutcome()`）跟完了、待辦歸屬
（`todosForVisit()`）跟完了 —— **只有「確認」這一族沒有跟上**，五個地方還在讀
`visit.status`：

| 在哪 | 那時怎麼判 |
|---|---|
| `ui/views/calendar.js` 的 `runVisitAction()` | 只有取消帶 `slotIndex`，其餘走 `applyStatus(visit, action)` |
| `domain/visits.js` 的 `visitActions()` | `nextStatuses(visit.status)` |
| `domain/todoFlow.js` 的 `derivedRows()` | `visit.status !== 'pending_confirm'`、`visit.status === 'done'` |
| `ui/views/home.js` 的 `drawerHtml()` | `visits.flatMap((v) => v.slots)`，不問狀態 |
| `domain/taskRules.js` 的 `syncTasksForVisit()` | `acceptsNewTasks(visit.status)` |

第二條的症狀是 `.scratch/prelaunch-fixes-2026-09-16/issues/08` 帶出來的，
**而那一支是對的**：它讓整筆的狀態在併進一段新的之後正確地退回「待確認」。
不退回的話待辦中心不會叫她去問那一段，而 A 類那一段的 Examine／耀聖會當場長出來。
退回之後「跟客人確認時間」跟著退回未打勾 —— 因為那一列讀的是整筆。
**正解是把那一列改成逐段，不是 revert 08。**

## 決定

**「客人說可以了嗎」問的是那一段，不是那一天。**

- 長按選單上狀態那幾顆走**她長按那一段**的 `slotStatus()`，不是整筆的推導值
  （`visitActions()`）。認不出是哪一段時退回整筆
- `applyStatus()` 每一種轉移都帶得動 `slotIndex`（它本來就收，只是沒有人傳）
- 讀取卡片上「跟客人確認時間」與「簽療程單」指名了哪一段時照那一段算
  （`derivedRows()`）
- 待辦中心的確認抽屜只列還沒談定的那幾段
- 掛號任務（Examine、耀聖）**那一段確認了就長**，不等整天

## 「一次確認整天」是待辦中心那條路

她自己指的：「如果我想要一次確認整天，我可以去代辦那邊做」。所以

- `visitsToConfirm()` **一個字都不改** —— 一段還沒問過客人，那一天就還要再問，
  而整筆退回 `pending_confirm` 正是 issue 08 讓它做對的事
- `applyConfirmation()` 照舊把非取消的每一段一次標成確認（冪等）
- `visitsToClose()` 也不改。它問的是「這一天結案了沒」，而收尾本來就是整天走一次
  待辦中心那張逐段抽屜（ADR-0025）。改成逐段的話同一天會在那一列出現兩次

## 掛號那一族為什麼跟著逐段

她 2026-09-16 拍板。不跟的話會出現一個她看不見的洞：兩段裡確認了一段，整筆停在
「待確認」，於是**那一段的 Examine／耀聖一張都不長** —— 而她已經可以去 Abovee
壓那一格了。下午那段一直沒回覆的話，早上那段的登記就永遠不長。

ADR-0027 的形狀是「**新的**任務只在確認的那一刻長出來」，而且它明寫「這一條只管
『產生』，不管『留』」。這裡改的只是「誰確認了」從整筆換成逐段。0027 的兩條邊界
照樣成立：`confirmed → done` 一張都不能少、`pending_confirm → done`（補記一筆已經
上完的課）一張都不長。

**`tasksForVisit()` 不看狀態這件事不能動。** 它同時被拿來比對「哪些還該留著」——
跟著狀態變的話，來訪一結案她還沒做完的 Examine 就會被靜默收掉。閘門只擋 `create`。

## 後果

- `visitActions()` 沒帶 `slotIndex` 時仍然答得出東西（它是匯出的，而另外三頁的
  讀取卡片沒有長按選單）
- 日曆上那一句 toast 從「這一天改成…」變成「這一段改成…」（ADR-0087：
  「筆」一個字都不上畫面）
- 一天兩段各自確認時，`visit.status` 會在 `pending_confirm` 停到最後一段談定，
  而那正是 `visitStatusFrom()` 的既有規則（由「還沒定案」往「定案」比）
- **還沒跟上的一處**：`visitActions()` 的「改這一段」與 `visitEditor.js` 的
  `locked` 都還在問 `isLocked(visit.status)`。一天裡一段已完成、一段已確認時整筆是
  「已確認」，所以那一段已完成的照樣編輯得動。兩處要一起改，這一輪刻意沒碰 ——
  見 `.scratch/slot-confirm-and-durations-2026-09-16/issues/11`
