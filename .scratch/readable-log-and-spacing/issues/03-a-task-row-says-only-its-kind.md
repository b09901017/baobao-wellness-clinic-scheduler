# 一列任務只寫得出 Examine

Status: done
來源：使用者，2026-09-01（需求 B，2026-09-01 確認過日期取哪一個）
動工前先讀：`public/js/domain/taskRules.js`、
`public/js/domain/sheetReport.js` 的 `taskBlocks()`、
`public/js/ui/views/customerDetail.js` 的 `taskRow()`、
`public/js/ui/views/home.js` 的 `taskRow()` 與 `loadTaskVisits()`、
`SPEC.md` 第 8.1／8.5 節、ADR-0056

## 原話

> 客戶詳情裡的任務目前只會顯示 `Examine` 或 `耀聖`，資訊量太少。
> 請在 UI 上擴充顯示，例如：`Examine・9/1・二返`
> （包含種類、日期、具體項目名稱），讓使用者一眼就知道這是哪天的什麼任務。

## 為什麼任務身上沒有這些

任務存的是 `{ visitId, customerId, customerName, kind, dueDate, done, doneAt, note }`
（`domain/taskRules.js` 的 `tasksForVisit()`）。**沒有來訪日、沒有課程名，而且
不該有** —— 那會是第二份會對不起來的資料：來訪改期、課程被移出來訪的時候，
任務身上那一份不會跟著動。`data/tasks.js` 的檔頭與 `loadTaskVisits()` 的註解
都已經寫過這個判斷（「N 項」就是為此才等來訪讀回來才填）。

所以答案是**去問那筆來訪**，兩個畫面手上本來就有：

| 畫面 | 來訪從哪來 |
|---|---|
| 客戶詳情 | `ctx.visits` 已經在手上，一次讀取都不用多加 |
| 待辦中心 | `taskVisits` 已經為了「N 項」讀回來了，同一份 |

## 日期取哪一個：**來訪那一天**

跟試算表 TODO 區同一個判斷（`sheetReport.js` 的 `taskBlocks()` 印的就是
來訪日）。理由那一支已經寫了：

> 日期取的是**來訪那一天**，不是死線 —— 她認的是「哪一天那一場」，
> 而死線是它的前一天，兩個差一天最容易看錯人。

**不要從 `dueDate` 反推來訪日**（`dueDate + 1`）：取消類的任務不是那樣算的
（`cancelTask()` 在今天早於死線時直接用今天）。反推出來的日期會有一部分是錯的，
而錯的日期看起來跟對的一模一樣。

來訪讀不到（獨立待辦、來訪被刪了）就退回死線，**並且講明那是死線**。

## 要做什麼

### `domain/taskRules.js` 多一支

```js
/**
 * 一列任務要講的三件事：哪一種、哪一天、哪一場。
 *
 * 三個地方共用（試算表的 TODO／FINISHED 區、客戶詳情、待辦中心）——
 * 三份寫法遲早會有一份用死線當日期，而那一份會差一天。
 *
 * 日期取**來訪那一天**，不是死線；來訪找不到才退回死線並標記 `fromDue`。
 *
 * @param {object} task
 * @param {object|null} visit 那一筆來訪（呼叫端手上本來就有）
 * @returns {{kind: string, date: string|null, fromDue: boolean, what: string}}
 */
export function taskLine(task, visit)
```

`what` 走 `domain/visits.js` 的 `visitCourseLabel()` —— 那一支已經負責
「同一場的課程名去重、認不出來時退回 N 段」，不要在這裡再寫一次。

**檢查過沒有循環**：`visits.js` 不 import `taskRules.js`，
`taskRules.js` 目前只 import `dates.js` 與 `followups.js`。
`tests/layering.test.js` 盯著這件事。

`sheetReport.js` 的 `taskBlocks()` 改成呼叫它 —— 那是「同一份邏輯一起改」
的那一半，不是順手重構：現在那一支自己算了一次同樣的東西。

### 客戶詳情那一列

一行講完，照她給的例子：

```
☐  Examine・9/1(一)・二返                        死線 8/31
```

- `kind` 正常粗細，後面那一串**淡一級**（`.note__sub` 或行內的 `.muted`）——
  種類才是她在掃的東西。
- 取消類的任務（`取消 Examine`）本來就有 `t.note`，那一句照樣印在底下一行。
- 右邊那顆「死線」丸子與「詳情 ›」按鈕**一個字都不動**。
- 來訪讀不到就印 `Examine・死線 8/31`（不要印一個假的來訪日）。

### 待辦中心那一列

那一列上面已經有四樣東西（名字、種類、N 項、死線），再擠一串會爆版。
所以放**第二行**，跟 `t.note` 同一個位置：

```
客戶A  [Examine] [3 項] [明天]
9/14(日)・復能、營養針
```

- 那一行等來訪讀回來才出現（同「N 項」的作法：`fillSlotCounts()` 改名
  `fillVisitInfo()`，一次把兩個都填）。讀回來之前是 `hidden` ——
  空的一行看起來像壞掉的東西。
- **「N 項」留著**：那是她自己點名要的（SPEC 第 8.1 節），不要因為多了
  課程名就把它拿掉。
- 已完成那一格（`doneRow()`）也一起補 —— 兩格長得不一樣會讓她以為勾掉之後
  是另一種東西。

## 連動

- `SPEC.md` 第 8.1／8.5 節各補一句（issue 06）。
- `public/sw.js` 的 `VERSION` 加一。
- **不改任何 Firestore 欄位** ⇒ `firestore.rules`、`firestore.indexes.json` 不動。
- `tests/sheet-report.test.js` 的 TODO／FINISHED 斷言要照樣通過
  （改的是實作位置，不是結果）。

## 不做

- **不把來訪日寫進任務。** 那是第二份會對不起來的資料。
- **不因此多讀一次來訪。** 兩個畫面手上都已經有了。
- 不讓任務那一列變成連到來訪編輯器的連結（ADR-0056：只有日曆改得了來訪）。

## 驗證

`tests/tasks.test.js`（或 `domain.test.js` 裡的 taskRules 那一段）：
- `taskLine()` 拿得到來訪 → `date` 是**來訪日**不是死線，`fromDue` 是 false
- 來訪是 null → `date` 退回死線，`fromDue` 是 true
- 同一場兩段同一個課程 → `what` 只印一次（`visitCourseLabel()` 已經去重）
- 課程名全都認不出來 → `what` 是「N 段」不是空字串

`tests/sheet-report.test.js`：
- TODO／FINISHED 那兩塊的字串跟改之前一模一樣

瀏覽器：
- 客戶詳情 → 任務 → 每一列都看得出是哪一天的什麼
- 待辦中心 → 一列任務 → 第二行等一下才出現，內容是來訪日 ＋ 課程
- 一筆手動加的、沒有來訪的待辦 → 只印種類與死線，**不印假的日期**
