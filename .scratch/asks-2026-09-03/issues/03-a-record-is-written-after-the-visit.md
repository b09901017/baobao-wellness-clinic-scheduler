# 客人走了之後要寫紀錄，而系統裡沒有這一種任務

Status: todo
來源：她的三件事，2026-09-03（`../spec.md`）
動工前先讀：ADR-0027（登記任務等客人確認才長）、ADR-0025（那天實際發生什麼記在時段上）、
ADR-0043（待辦中心照流程分段）、`domain/taskRules.js` 的整份檔頭、
`CONTEXT.md` 的「任務」「待辦」「療程單」

## 她要的

> 二返……事後（客人來完後）要寫二返紀錄。然後營養諮詢也是要寫紀錄。

筆記裡的原文：

```
二返    後 → 曜聖寫二返紀錄
營養諮詢   (1) 療程單
           (2) 打諮詢紀錄（曜聖醫美櫃檯）
```

兩件事在系統裡是同一種：**客人走了之後，要去外面那個系統補一份文字紀錄。**

## 為什麼這是一個全新的任務家族

現有的任務全部長在**來訪之前**：

| | 現有的（Examine、耀聖） | 新的（寫紀錄） |
|---|---|---|
| 什麼時候長出來 | 客人**確認**之後（`acceptsNewTasks()` 只認 `confirmed`） | 來訪**做完**之後（`done`） |
| 死線 | 來訪日的**前一天**（`dueDateFor()`） | 來訪**那一天** |
| 取消來訪時 | 要回頭去外部系統收回登記 | 沒有東西要收 —— 那一場沒發生就沒有紀錄要寫 |

所以它不能靠現有的 `RULES`（按類別）長出來：二返是 A 類、營養師諮詢是 `null` 類，
而同樣是 A 類的復健科醫師門診**不用**寫紀錄。**這是逐課程的事，不是類別的事。**

CLAUDE.md 寫著「規則綁在類別上，不逐課程設定」，而這一條有既有的例外前例：
`needsTreatmentForm`、`followupCourseId`、`requiresDoctor`、`requiresEquipment`
四個欄位都是逐課程的。判準是「**這件事同一個類別裡的課程會不會不一樣**」——
會不一樣的就掛課程。

## 決定（2026-09-03 她選的）

**一種任務種類 `寫紀錄`，課程主檔上一個勾 `needsRecord`，死線＝來訪那一天。**

### 為什麼不是逐課程自訂名稱

「寫二返紀錄」「寫營養諮詢紀錄」讀起來更精確，代價是 `domain/todoFlow.js` 的
`FLOW` 認不得自訂的種類，於是它們會**全部落進「來訪前一天」那一段的最後面**
（`stageOf()` 對認不得的一律回 `before`）—— 一張事後才做的紀錄排在掛號中間，
那比名字模糊糟得多。

而且那一列本來就講得出是哪一場：`taskLine()` 給的是**種類・來訪那一天・課程**，
所以她看到的是

```
寫紀錄
9/20(六)・二返                    死線 9/20
```

不是光禿禿的「寫紀錄」。

### 為什麼死線是來訪那一天

她選的。理由站得住：這件事就是當天做的（她的筆記把它排在「療程單」後面
同一段），隔天還沒寫就**真的**是逾期。ADR-0042 那句「一個系統只要製造出一批
紅了但做不了的東西，紅色就不再是訊號」在這裡是反過來的 —— 這一張紅的時候
她真的做得到，紅色是對的。

**不新增設定值。** 沒有一個天數要調。

## 這一支唯一的陷阱：`tasksForVisit()` 不可以跟著狀態變

`domain/taskRules.js` 的註解已經先寫過這件事：

> 「該有」不等於「現在就產生」…… 兩件事分開是刻意的：這一支同時被用來**比對
> 現有的任務**（哪些還該留著），而那個比對不可以跟著狀態變，否則來訪一結案，
> 她還沒做完的登記就會被靜默收掉。

所以**不要**把 `needsRecord` 直接塞進 `tasksForVisit()` 就算了。做法是把「該有
哪些」與「現在長不長得出來」拆成兩層，兩層都認得兩個家族：

```js
// 該有哪些（比對用，不看狀態）
tasksForVisit(visit, coursesById)        // 掛號那一族，一個字不動
recordTasksForVisit(visit, coursesById)  // 紀錄那一族，新的

// 現在長不長得出來（產生用，看狀態）
acceptsNewTasks(status)        // === 'confirmed'
acceptsRecordTasks(status)     // === 'done'          新的
```

`syncTasksForVisit()` 把兩份 `wanted` 併起來比對，**但產生的時候各走各的閘門**。

這樣才會對的四件事，每一件都要有測試：

| 狀況 | 該發生什麼 |
|---|---|
| `confirmed` → `done` | 長出「寫紀錄」；她還沒做完的 Examine **不會**被收掉 |
| `done` → `confirmed`（她按錯了拿回來） | 沒勾的「寫紀錄」收掉，理由「這一筆還沒做完，還沒有東西可以寫」 |
| `no_show` | **不長**。人沒來，沒有紀錄要寫 |
| `cancelled` / 軟刪除 | 沒勾的收掉（`gone` 那一支已經在做了，只要確認紀錄那一族有走進 `auto`） |

第二列的**理由字串要另外寫一句**。現在那一句是「來訪裡已經沒有需要這個任務的課程」，
而這時候課程還在，只是那一場還沒做完 —— 印一句對不上的話，她下次看稽核紀錄
會查錯方向。

## 待辦中心的分段：⑥「來訪之後」的第一列

```js
['close', 'onday'],           // ⑤ 簽療程單
['寫紀錄', 'after'],           // ⑥ ← 新的，排在這一段最前面
[REPORT_TASK_KIND, 'after'],
[SEND_REPORT_KIND, 'after'],
[FOLLOWUP_TASK_KIND, 'after'],
```

- **段是⑥不是⑤**：她自己就把它寫成「後」。⑤「來訪當天」那一段裝的是
  `close`（簽療程單），而簽療程單這個動作本身就是把來訪標成已完成 ——
  「寫紀錄」是那之後才存在的東西。
- **排在⑥的最前面**：ADR-0043 說段裡的順序是她做事的順序，不是死線。
  寫紀錄是當天，追蹤報告是三週後。

## 要改的地方

| 檔案 | 改什麼 |
|---|---|
| `domain/taskRules.js` | `RECORD_TASK_KIND = '寫紀錄'`、`recordTasksForVisit()`、`acceptsRecordTasks()`、`syncTasksForVisit()` 併兩份 wanted |
| `domain/masterData.js` | `courses` 的驗證認得 `needsRecord`（布林） |
| `domain/seed.js` | `course-followup`（二返）與 `course-nutrition-consult`（營養師諮詢）加 `needsRecord: true` |
| `domain/todoFlow.js` | `FLOW` 插一列 |
| `ui/views/masterList.js` | `editors.courses` 多一個勾，擺在 `needsTreatmentForm` 旁邊 —— 兩個問的是同一種問題（「這個課程做完還要做什麼」）。說明字：「做完之後要去曜聖補一份文字紀錄。跟療程單是兩件事，兩個都要就兩個都勾。」 |
| `ui/views/home.js` | `KIND_NOTES` 加一句：「客人走了，去把紀錄補上」 |
| `ui/views/customerDetail.js` | 任務那一段照舊（走 `taskLine()`，不用改） |

### 文案要跟著改的四句

CLAUDE.md 記著：「任務什麼時候產生只寫在 `acceptsNewTasks()`……UI 上講這件事的
四句文案要跟著改」。這一輪多了第二個時機，所以那四句要**加一句話**而不是改掉：

1. 壓表那一頁兩句（「客人確認之後才會長出掛號待辦」）→ 補「做完之後才會長出寫紀錄」
2. 確認動線的提示
3. 客戶詳情沒有任務時那一句

畫面在講一件不會發生的事，比沒講還糟 —— 反過來也一樣：**一件會發生的事，
畫面上一句都沒提，她第一次看到那張待辦時會以為是壞掉了。**

## 測試

- `tests/tasks.test.js` / `tests/domain.test.js`：上面那張表的四列
- `tests/todo-flow.test.js`：`stageOf('寫紀錄') === 'after'` 且排在 `REPORT_TASK_KIND` 前面
- `tests/master-data.test.js`：`needsRecord` 的驗證
- 端對端：`04-journey-a-happy.spec.js` 走到 done 之後多確認一列

## 要補的 ADR

`docs/adr/0066-a-record-is-a-task-that-is-born-after-the-visit.md`
