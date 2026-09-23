# 同一天取消一段再補排，新那一段不長掛號

Status: todo（動工前問她一句，見「要她確認的」）
來源：`../spec.md`
動工前先讀：`docs/adr/0091`（「Examine 上是一段登記一筆」）、`docs/adr/0097`（確認逐段）、`docs/adr/0083`（一天一筆）、
`domain/taskRules.js` 的 `tasksForVisit()`／`syncTasksForVisit()`／`confirmedKinds()`／`cancelTasksFor()`、
`domain/todoFlow.js` 的 `todosForVisit()`（哪一張屬於哪一段）
相關：01（先做，軟刪除那條規則這裡也要用）、13（改期＝取消＋重新排要靠這一支）

## 現在壞在哪

同一天：早上一段復能、10:00 一段復健科醫師門診，兩段都已確認，Examine 已經勾掉（掛好號了）。

1. 客人說門診改到下午 → 長按 10:00 → 取消這一段 → 長出「取消 Examine」「取消 Abovee」（對的）
2. 同一天補一段 15:00 門診（壓表或日曆＋，ADR-0083 會併進同一筆）
3. 客人說可以 → **15:00 那一段一張 Examine、一張耀聖都沒長**

她被叫去 Examine 取消 10:00 的號，卻沒有人叫她替 15:00 掛新的號。

## 怎麼重現

- 單元：`syncTasksForVisit()` 依序跑「兩段確認 → Examine 勾掉 → `applyStatus(v,'cancelled',{slotIndex:1})`
  → `withExtraSlot(v, 門診 15:00)` → `applyStatus(v,'confirmed',{slotIndex:2})`」，最後一次的 `create` 是空的
- 畫面：種子同上（兩段 confirmed、一張 `Examine` done、一張 `耀聖` 未勾）→ 日曆長按第 2 段取消 →
  用 `data/visits.js` 的 `save()` ＋ `domain/slotDraft.js` 的 `visitWithSlot()` 補一段 → 重新整理 → 長按第 3 段 → 客戶說可以
  → 還沒做的待辦只有「取消 Examine」「取消 Abovee」

## 為什麼

掛號那一族是**一天一種一張**：`syncTasksForVisit()` 用 `kind` 當 key 比對（`wanted` 是 `Map(kind → task)`），
同一筆來訪裡已經有一張 Examine（不管屬於哪一段、有沒有被取消收回）就不再長。
`tasksForVisit()` 的檔頭還寫著「同名任務只產生一次 —— 她不需要為了同一天掛兩次 Examine」。

但 ADR-0091 記了她 2026-09-13 的原話：「**Examine 上是一段登記一筆，不會是一天一筆**，只是為了畫面呈現
不要那麼多資訊所以才合在一起」。取消那一族已經照這句話改成逐段（`slotIndexes`），掛號那一族沒跟上。

連帶的另一個洞：`cancelTasksFor()` 的 `registered` 也是照種類問 —— 同一天兩段 A 類、只掛了其中一段，
取消**沒掛的那一段**也會長一張「取消 Examine」。

## 做法（方向）

- 掛號那一族跟取消那一族一樣帶 `slotIndexes`（它掛的是哪幾段）；一段**活著、談定、還沒被任何一張蓋到**才長新的
- 同一次存檔談定的幾段收成同一張（畫面上照樣是一張，符合「畫面呈現不要那麼多資訊」）
- 沒有 `slotIndexes` 的舊任務：照 `cancelSlotsOf()` 的作法當成蓋住整天，不在舊資料上多長一張
- `cancelTasksFor()` 的 `registered` 改成逐段：那一段自己的那一張勾掉了才收
- `todoFlow.js` 的歸屬、`consequences.js` 的 `confirmConsequences()` 要跟著走同一份
- 「段落位置穩得住」的前提不變（CLAUDE.md 取消類那一列）：新的一律接在尾巴、既有的不移除
- 動到 domain 規則：`SPEC.md` 第 5.5 節、`docs/課程與待辦對照表.md`、CLAUDE.md 的連動表要一起改；
  推翻 `tasksForVisit()` 檔頭那一句就補一支 ADR

## 要她確認的

> 同一天兩段都是 A 類（例如復健科門診＋心臟科評估），Examine 上是掛**兩筆**，對嗎？
> 待辦上要長成一張（寫「Examine・2 段」）還是兩張？

她 9/13 說過「一段登記一筆」，但那句是在講取消。問清楚再動，答案寫回 ADR。

## 判準

- 上面那個情境：15:00 那一段談定之後長**一張 Examine、一張耀聖**，只蓋第 2 段（`slotIndexes: [2]`）
- 同一天同時確認兩段 A 類：長的張數照她的答案
- 取消沒掛號的那一段：**不長**「取消 Examine」
- 舊資料（任務沒有 `slotIndexes`）存一次：一張都不多長
