# 待辦分類頁的「已完成」分頁會黏住

Status: done
來源：`../spec.md`
動工前先讀：`ui/views/home.js` 的 `renderGroup()`（`:1730`）與 `paintTasks()`、`let taskTab`（`:1925`）

## 現在壞在哪

待辦 → Examine → 切到「已完成」→ 回待辦 → 點**耀聖** → 那一頁**直接停在「已完成」**，
還沒做的那張耀聖畫面上看不到。她很容易以為「耀聖沒有要做的」。

## 怎麼重現

種子一張已勾的 Examine、一張未勾的耀聖 → `#/todo/Examine` → `[data-task-tab="done"]` → `#/todo` → `#/todo/耀聖` →
`[data-task-tab][aria-pressed="true"]` 是「已完成」，`[data-task="<那張耀聖>"]` 不在畫面上。

## 為什麼

`taskTab` 是整個模組共用的一個變數（`home.js:1925`，註解寫「存在模組裡不進網址 —— 它是看法，不是位置」），
`renderGroup()` 換分類時重設了 `picked`、`drawer`、`taskVisits`，**沒有重設 `taskTab`**。

## 做法（方向）

- 換到**另一個分類**時回到「未完成」
- **同一個分類重畫時要留著**：`untickTask()`、`dropTask()`、`clearDoneTasks()` 做完都會 `renderGroup(ctx.el, ctx.group)`，
  在那裡一律重設的話，她在「已完成」點一列拿回來就會被丟回「未完成」。記住上一次是哪個分類，不一樣才重設
- 「問這輪的時間」那一頁（`askTab`）已經是每次進來重設，可以對照

## 判準

- 上面那個情境：耀聖那一頁停在「未完成」，看得到那一張
- 在「已完成」拿回一張、刪一張、清掉：照樣停在「已完成」
