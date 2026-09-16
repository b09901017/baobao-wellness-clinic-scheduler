# 只確認一段時，那一段的掛號任務不會長出來

Status: done
Blocked by: 01
來源：`../spec.md`（她 2026-09-16 拍板：「改成逐段：那一段確認了就長」）
動工前先讀：`docs/adr/0027`（登記任務等客人確認之後才產生 —— **一個字都不改**）、
`docs/adr/0081`、`domain/taskRules.js` 的 `syncTasksForVisit()`／`tasksForVisit()`

## 為什麼要做

issue 01 讓確認變成逐段的，於是冒出一個新的落差：她確認了兩段裡的一段，
整筆停在 `pending_confirm`，而閘門看的是整筆 ——

```js
// domain/taskRules.js:380
if (t.kind === RECORD_TASK_KIND || acceptsNewTasks(visit.status)) create.push(t);
```

→ **那一段的 Examine／耀聖一張都不長**，而她已經可以去 Abovee 壓那一格了。
下午那段一直沒確認的話，早上那段的登記就永遠不長。

她定案：要逐段。

## 這不是推翻 ADR-0027

0027 的規則形狀是「**新的**任務只在確認的那一刻長出來」，而且它明寫
「這一條只管『產生』，不管『留』」。改的只是「誰確認了」從整筆換成逐段 ——
規則本身一個字都沒變。0027 的兩條邊界照樣要成立（見判準）。

## 要做什麼

`syncTasksForVisit()` 裡，把閘門從「整筆的狀態」換成「**哪幾種 kind 有一段
已確認的活著的段撐得起來**」：

```js
const confirmedKinds = new Set();
for (const slot of visit.slots ?? []) {
  if (!isLiveSlot(slot)) continue;
  if (!acceptsNewTasks(slotStatus(visit, slot))) continue;
  for (const kind of tasksForCategory(coursesById[slot.courseId]?.category)) {
    confirmedKinds.add(kind);
  }
}
```

然後 `create.push()` 那一行問 `confirmedKinds.has(t.kind)`。

**`tasksForVisit()` 一個字都不要改。** 它刻意不看狀態，因為同一支同時被拿來
比對「哪些還該留著」——跟著狀態變的話，來訪一結案她還沒做完的 Examine 就會被
靜默收掉（那支自己的檔頭寫著）。閘門只動 `create` 那一圈。
`recordTasksForVisit()` 也不動，它自己的閘門（`acceptsRecordTasks()`）已經在裡面了。

`acceptsNewTasks()` 的簽名不變（它收的本來就是一個狀態字串，不是來訪）。

## 判準

ADR-0027 的兩條邊界要還在：

- **`confirmed → done`**：任務是確認時長出來的，結案時**一個都不能少**
- **`pending_confirm → done`**（她補記一筆已經上完的課）：**一張都不長**。
  逐段之後這條走的是 `acceptsNewTasks('done') === false`，照樣成立

新的：

- 一天兩段（健檢 B 類 ＋ 復能 C 類），只確認健檢那一段
  → 長出健檢那一段該有的那幾張，**復能那一段的不長**
- 兩段同課程、只確認一段 → 那一種**只長一張**（`wanted` 本來就是依 kind 去重的）
- 整天都還沒確認 → 一張都不長（跟 2026-09-16 一樣）
- 這一行會不會讓一張**還沒問過客人**的段的登記任務被無中生有？
