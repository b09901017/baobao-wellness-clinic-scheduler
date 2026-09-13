# 取消類的待辦記得它收的是哪幾段

Status: todo
來源：`../spec.md` 第二 b，以及她補的 c 與第 5 題
動工前先讀：ADR-0081（時段才是原子單位）、ADR-0070（後果只能講真的會發生的事）、
`domain/taskRules.js` 的 `syncTasksForVisit()` 與 `cancelTasksForDeadSlots()`、
`domain/consequences.js` 的 `cancelConsequences()`（只取消幾段那一支）

## 她要的

> 我一天幫A押三個時段，然後我取消了其中一段後，其他兩段的這一項的待辦就多了"取消Aobvee" ?
> 這個待辦只應該出現在被取消的那邊吧，我不知道是取消這邊沒改好，還是這一項的待辦有甚麼其他的漏網之魚
> 會導致這個bug，請全域詳細的檢查並修復

第 5 題（**還沒定，她要想一下，之後要再問她一次**）：

> Examine 上是一段登記一筆，不會是一天一筆，只是為了畫面呈現不要那麼多資訊所以才合在一起，
> 如果只取消一段的話，目前先當作 Examine 和耀聖上的登記也要回去取消，就算只又一段，
> 就是每一段都是可以分別取消的，但是這個問題先保留之後可以再問我

## 查到的（2026-09-13 實跑）

「取消 X」只記到 `visitId`，沒記到第幾段。這一個缺口長出三個症狀：

| 情境 | 結果 |
|---|---|
| 一天三段復能，取消中間那段 | 只長一張「取消 Abovee」✅（不是殘留）—— 但畫面只能猜它屬於誰（issue 03） |
| 取消第 0 段、勾掉「取消 Abovee」，隔天再取消第 2 段 | ❌ **一張都不長**。第 2 段在 Abovee 上永遠沒人去放 |
| 二返＋復能，Examine／耀聖都勾過了，只取消二返那一段 | ❌ 只長「取消 Abovee」。整天取消會長「取消 Examine」「取消 耀聖」 |

## 為什麼

`cancelTasksForDeadSlots()` 的去重是「同一個系統，含已經勾掉的，只准一張」：

```js
const already = new Set(existingTasks.filter((t) => !t.deletedAt && isCancelKind(t.kind)).map((t) => t.kind));
```

它想擋的是「一次取消三段就長三張」，但它分不出「同一次取消的三段」和「上禮拜取消的那一段」。
而它只走壓表登記那一圈（`bookingSystemFor(category)`），**沒有走整天取消那一段的第二圈**
（已經勾完成的 Examine／耀聖要收回來）—— 註解寫「跟整筆取消要做的事一模一樣」，只做了一半。

## 做法

- 取消類的待辦多存一格 **`slotIndexes`**：這一張收的是哪幾段（`visit.slots` 裡的位置）。
  段落的位置是穩的：既有的段不會被移除（× 是取消），新的一律接在尾巴（`hasNewSlots()` 已經靠這個）。
- **去重改成逐段**：一個系統裡，還沒被任何一張「取消 X」的 `slotIndexes` 蓋到的死段，才需要一張新的。
  同一次存檔取消的幾段收成同一張；上次已經收過的段不再長。
- **整天取消**也寫 `slotIndexes`（那一天每一段）。
- **掛號那一族也逐段**（第 5 題的暫定）：取消的那一段自己長得出 Examine／耀聖，而且那一張登記待辦
  已經勾掉了 → 長「取消 Examine／耀聖」，`slotIndexes` 是那一段。登記待辦還沒勾就不用收（沒登記過）。
- **沒有 `slotIndexes` 的舊任務**：當成蓋住那一天的每一段（等於現在的行為），不會多長一張。
  她說之後會全新重匯，這條只是為了不要在 staging 上的舊資料長出重複的待辦。
- 確認框的那一句（`cancelConsequences()` 的只取消幾段）**跟真的會長出來的共用同一段身體**（ADR-0070）——
  現在它自己用 `bookingSystemsForVisit()` 算一次，改完就會跟 `syncTasksForVisit()` 分岔。
- `firestore.rules` 的 tasks：`slotIndexes` 是 list（有就驗形狀）。
- `CLAUDE.md` 連動表補一列；SPEC 第 4.1 節補一句「取消類的待辦逐段」。

## 判準

- 取消第 0 段、勾掉、再取消第 2 段 → **第二張「取消 Abovee」長出來**，`slotIndexes: [2]`
- 一次批次取消同一天兩段 → 一張，`slotIndexes` 兩段都在
- 整天取消 → 每個系統一張，`slotIndexes` 是那一天的每一段
- 二返＋復能，Examine 已勾，只取消二返 → 「取消 Abovee」與「取消 Examine」都長，`slotIndexes: [0]`；
  **只取消復能那一段不會長「取消 Examine」**
- Examine 還沒勾，只取消二返（而且那一天沒有別段 A 類）→ 不長「取消 Examine」，那張沒勾的 Examine 照舊被收掉
- 同一次存檔跑兩次 `syncTasksForVisit()` 不會多長（冪等）
- 舊任務沒有 `slotIndexes` → 不多長
- 確認框說「會多一張『取消 Examine』」的那幾種情境，跟 `syncTasksForVisit()` 真的長出來的一模一樣

## 還沒定的（要再問她）

第 5 題：一天兩段 A 類、Examine 那一張只有一個勾，其中一段是**後來才加的**（勾 Examine 的時候它還不在）
—— 取消那一段時要不要收 Examine？暫定：要（照她「每一段都是可以分別取消的」）。
