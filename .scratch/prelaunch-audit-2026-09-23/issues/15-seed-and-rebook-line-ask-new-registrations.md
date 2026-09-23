# 種子資料與改期確認框都問 `newRegistrations()`

Status: todo
來源：`../spec.md`（第二輪）
動工前先讀：`docs/adr/0107`、`domain/taskRules.js` 的 `newRegistrations()`／`cancelSlotsOf()`、
`domain/consequences.js` 的 `rebookConsequences()`、`scripts/seed-staging.mjs` 的登記任務那一段、`tests/seed-staging.test.js`
相關：22（共用「這幾段談定了會長什麼」那一支，先做這一支）

## 她要的

> 第一點:這個 PR 之前長出來的 Examine／耀聖待辦，身上全部沒有 slotIndexes，好像沒關係，畢竟現在都沒有真實資料上線，
> 之後還會重新用skill merge一次，所以只要合併的skill有顧慮到這點就好

查過：合併檔不帶任務，任務是 app 匯入時由 `importedTasksFor()` 長的 → `syncTasksForVisit(visit, [])` → `newRegistrations()`，
**每一張都帶 `slotIndexes`**，merge skill 不用改。沒有 `slotIndexes` 的舊任務只剩兩個地方會生出來或被講錯：

## 現在壞在哪

1. **staging 的種子**：`scripts/seed-staging.mjs:278-281` 自己用 `acceptsNewTasks(status)` ＋ `tasksForVisit()` 種掛號待辦，
   種出來的**沒有 `slotIndexes`**。`cancelSlotsOf()`（`taskRules.js:486`）把它當成蓋住「現在」整天，連之後接上的段也算 ——
   她在 staging 上點「改這一段 → 改時間」，新那一段談定之後 **Examine、耀聖一張都不長**，她會以為 13 壞了。
   那一段上面的註解自己寫著「種子跟規則各寫一次，規則改了種子不會跟」。
2. **改期確認框那一句**：`consequences.js:539` 的 `later = tasksForCategory(…)` 是同一條規則的第二份寫法
   （ADR-0070：畫面上的後果要跟真的寫入共用同一段身體）。全部是新任務時它今天講的是真的，但規則一改就會分岔。

## 怎麼重現

- 種子：`buildPlan()`（或 seed 匯出的那一支）產出的 `tasks` 裡，掛號那幾種沒有一張帶 `slotIndexes`
- 確認框：舊任務（`done: true`、沒有 `slotIndexes`）→ `rebookSlot()` → `rebookConsequences()` 寫「等客人說可以之後，待辦會再多一張「Examine」、
  一張「耀聖」」→ `syncTasksForVisit()` 存下去 → 新那一段 `applyStatus(…,'confirmed',{slotIndex:1})` → 再 sync，`create` 是空的

## 做法（方向）

- 種子：改走 `newRegistrations({ ...data, id: vid }, [], coursesById)`（閘門逐段在它裡面，`acceptsNewTasks` 那一層拿掉）。
  任務 id 的寫法（`${vid}-task-${k}`）照舊
- 確認框：一支「**這幾段談定了會多哪幾張**」—— 把那幾段假設成 `confirmed` 去問 `newRegistrations()`，
  只留 `slotIndexes` 碰到那幾段的。`rebookConsequences()` 問新接在尾巴那一段；22 的 `bookingConsequences()` 問這次新加的那幾段。
  放在 `consequences.js` 或 `taskRules.js` 都可以，**只能有一份**
- 舊任務的退路（`cancelSlotsOf()` 當成整天）**不動**

## 判準

- 種子產出的每一張掛號待辦都帶 `slotIndexes`，而且跟「那一段談定了」對得上（`tests/seed-staging.test.js` 補一條）
- 改期確認框講的「會再多一張 X」＝ 真的走一次「改期 → 存 → 新那一段確認 → 存」長出來的那幾種（單元測試直接比兩邊）
- 換成不長掛號的課程（C 類）時，那一句不出現
- `rg "tasksForCategory" public/js/domain/consequences.js` 不再被拿來講「會多哪幾張」
