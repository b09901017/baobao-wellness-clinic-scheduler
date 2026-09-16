# 種子多一門課程時，既有資料庫沒有任何一條路把它建起來

Status: done
Blocked by: 06
來源：寫手動驗收清單時查到的 —— **issue 10 的前提寫錯了**
動工前先讀：`domain/health.js` 的 `checkSeedEquipment()`（照抄那個形狀）、
`ui/views/settings.js:48`

## issue 10 哪裡寫錯

那一支寫著「新增 `course-eecp-trial` → 再跑一次『載入預設資料』就會建起來 ✅」。
**錯的。** `ui/views/settings.js:48` 是

```js
${empty ? seedCard() : ''}
```

那顆「載入種子資料」**只在整份主檔是空的時候才畫出來**。staging 與正式上都有
資料，所以那顆按鈕她永遠看不到 —— 於是 issue 06 新增的那一門體驗課
**一條路都沒有**，而症狀跟「本來就沒有那一種」長得一模一樣（同
`checkSeedEquipment()` 檔頭講的 ILIB 那一台）。

## 要做什麼

`domain/health.js` 加一列 `seedCourse`，**照 `checkSeedEquipment()` 抄**：

- 比 `SEED.courses` 與 `ctx.coursesById`，缺的列出來
- `fix: { kind: 'addCourse', courseId, label, data }`，`data` 是
  `{ ...withoutId(row), active: true }`（同器材那一列）
- `data/health.js` 加一支 `addCourse` 的 op（`op: 'create'`，
  `path: 'config/app/courses'`，**id 用種子上的那一個** —— 隨機生一個的話
  下一次健檢還是會說少一門，而且會再建出第二門）
- `ui/views/health.js` 的 `FIX_COPY` 與 `KIND_TO_CHECK` 各一列

**護欄跟器材那一列同一個理由**：自己從零建主檔、一個種子 id 都沒有的資料庫
（測試夾具就是）不可以被念 —— 那時候缺的不是一門課，是整份主檔。
判準：`SEED.courses.some((c) => ctx.coursesById[c.id])`。

## 判準

- 一個有 12 門種子課程、缺 `course-eecp-trial` 的資料庫：列得出來，
  按下去建起來，id 是 `course-eecp-trial`
- 按過一次之後再跑一次健檢：那一列消失（**不會建出第二門**）
- 一個一個種子 id 都沒有的主檔：**一列都不報**
- 她自己刪掉的那一門：比的是含已刪除的那一份，所以不報
- 這一行會不會讓她每次開健檢都看到一列關不掉的提醒？
