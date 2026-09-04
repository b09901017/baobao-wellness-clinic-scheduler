# 拿回一張待辦，畫面一個字都不說

Status: todo
來源：她的第三項第 1 點（`../spec.md`）
動工前先讀：issue 06 的那五張表、ADR-0042、0065、0068、`domain/consequences.js` 的檔頭

## 她要的

> 在「取消預約」或「反向取消勾選／拿回 Todo」時，使用者往往不清楚會連帶刪除
> 或復原哪些下游項目。希望你全域幫我盤點。

## 全域盤點：每一個反向操作，現在說了什麼、實際上發生什麼

✅ ＝ 已經有話講　❌ ＝ 一個字都沒有　⚠️ ＝ 有話講但講得不夠

| 反向操作 | 在哪 | 現況 | 實際上會發生 |
|---|---|---|---|
| 拿回「**追蹤健檢報告**」 | `home.js` `untickTask()` / `toggleWhoTask()`、`customerDetail.js` `toggleTask()` | ❌ | 「**寄報告給醫師**」與「**約二返**」還沒勾的那幾張被軟刪除 |
| 拿回「**約二返**」（二返**已經約好**） | 同上 | ❌ | 那一張**直接被收走**，不會回到未完成（理由「二返已經約好了」） |
| 拿回「約二返」（**還沒約**） | 同上 | ❌ | 回到未完成，死線重算。沒有別的事 |
| 拿回「寄報告給醫師」 | 同上 | ❌ | 回到未完成。沒有別的事 |
| 拿回 Examine／耀聖／寫紀錄 | 同上 | ❌ | **什麼都不會發生**（`followupOpsAfterTaskChange()` 只認鏈上那兩種） |
| **取消一筆來訪** | `calendar.js` `runVisitAction()`、`visitEditor.js` `wireStatus()` | ⚠️ | 次數還回去；**未完成的 Examine／耀聖／寫紀錄被收掉**；**多一張「取消 Abovee／Examine／耀聖」**；健檢的話**整條鏈三張一起收** |
| **刪掉一筆來訪** | `visitEditor.js` `wireDangerZone()` | ⚠️ | 同上（`gone` 那一段兩種都走） |
| 拿回一筆隨手記 | 四個入口 | ❌ | 什麼都不會發生。**不加確認** |
| 刪掉一份備忘錄 | `playbook.js` | ✅ | 已經講了 |
| 刪掉行事備註／休假 | `calendar.js` | ✅ | 已經講了（休假那句還特別講「壓表會重新排得進去」） |

### 她只有兩種要問（2026-09-04 她選的）

**只有「追蹤健檢報告」與「約二返」拿回來時會問。** 其餘五種要嘛什麼都不
發生、要嘛只是回到未完成 —— 多問一次她會學會閉著眼睛按，而那會讓真的該停的
那一次也停不下來（`home.js` 批次勾那一段已經寫過同一句話）。

## ⚠️ 需求信裡那句警示的字，在這個系統裡是假的

信裡舉的例子是：

> ⚠️ 注意：該健檢已排定二返（日期：YYYY/MM/DD）。若將追蹤報告拿回未完成，
> **將會取消已約好的二返預約**與後續待辦！

**不會。** 拿回一張待辦不會動到任何一筆來訪 —— `followupOpsAfterTaskChange()`
產生的操作全部在 `tasks` 這個集合裡，一筆 `visits` 都沒碰。而 ADR-0002 的整個
立論就是「app 記錄決定，不做決定」：系統不會替她取消一場已經跟客人約好的來訪。

照著寫等於畫面在嚇她，而嚇錯一次之後，真的該停的那一次她也不會停。所以
**這一輪寫的是真的會發生的那一版**：

```
拿回「追蹤健檢報告」？
・那一次健檢是 9/1
・「寄報告給醫師」還沒勾，這一張會被收走
・「約二返」還沒勾，這一張會被收走
・9/20 那一場二返已經約好了 —— 那一筆來訪不會被動到
・收走的兩張在「設定 → 已刪除項目」還原得回來
                          [ 取消 ]  [ 還是拿回來 ]
```

紅色警示（`danger: true`）只在**真的有東西會被收走**的時候才開。沒有下游的
那一次，這道確認就只是一句「這一張會回到未完成」，不染紅。

## 怎麼算出那幾句話：**用同一台引擎，不寫第二份**

「拿回來會少哪幾張」的答案已經有了 —— `syncFollowupTasks()` 每次勾選都在算。
不可以照著它的規則在畫面上再推論一次（`consequences.js` 的檔頭就是為了同一件事
而存在的：兩邊各寫死一次「Abovee」，而健檢壓的是 Examine）。

所以：

### 1. `data/visits.js` 多一支 **`previewTaskChange(task, done)`**

跟 `followupOpsAfterTaskChange()` **共用同一段身體**（把中間那一段抽成
`chainOpsFor(rows)`），差別只在它 **`return` 不 `commit`**：

```js
export async function previewTaskChange(task, done) {
  // → { remove: [{kind, visitId}], create: [{kind}], examDate, booking }
}
```

`booking` 走 `followups.js` 現成的 `bookingStateForTask()` / `bookingForExam()`
—— 「那一場二返約在哪一天」也不自己算。

### 2. `domain/consequences.js` 多一支 **`untickConsequences()`**（純函式）

收上面那份 preview，回 `{ title, lines, danger }`。這一支是純的，所以測得動
——每一句話都有測試，包含「沒有下游時不染紅」。

### 3. 三個呼叫端共用一支 UI 的 `confirmUntick(task)`

`home.js` 的 `untickTask()`、`toggleWhoTask()`、`customerDetail.js` 的
`toggleTask()`。**寫在 `ui/components/tasklist.js`** —— 那一支已經是「一列任務」
的共用零件，而三個入口各接一次就是這個 repo 已經付過兩次帳的形狀
（`buy.js` 的「其他…」漏了兩次、`note.js` 的 `.notemeta` 有兩個入口裸放）。

只有兩種 kind 會真的問，其餘直接回 `true`，所以那三個呼叫端各多一行：

```js
if (!(await confirmUntick(task))) return;
```

**確認框在 `withSaveState()` 外面**（`note.prepareToggle()` 的檔頭寫過原因：
包進去的話她按了「取消」也會跳一句「拿回來了」）。

## 順手補齊的第二件事：取消／刪掉一筆來訪

現在那兩道確認說的是「如果已經在 Abovee／Examine／耀聖登記過，要回去把舊的
取消掉」—— 三個系統名字並列，而 `bookingSystemsForVisit()` 早就答得出來
**是哪一個**。這正是 `consequences.js` 檔頭抱怨過的同一件事：判斷早就有了，
只是沒有人用它。

`domain/consequences.js` 多一支 `cancelConsequences({ visit, coursesById,
openTasks, chainTasks, sheetSyncOn })`，講四件事（有的才講）：

```
取消 客戶A 這一筆來訪？
・9/1 14:00 健檢（Examine 壓的表）
・2 個時段會退回去，次數也會還回來
・待辦會多一張「取消 Examine」—— 回去把那個時段放掉
・還沒做完的「Examine」「寫紀錄」會被收掉
・這一次健檢的「追蹤健檢報告」也會被收掉（那一場沒發生，沒有東西要追）
・改期不是改日期，是取消後重新排一筆
・取消後不能復原成已確認，但日曆上還看得到它（暗掉的那一列）
```

日曆的長按選單與來訪編輯器的狀態卡**共用這一支**（ADR-0056：改得動一筆來訪的
只有日曆，而那兩個入口都算在裡面）。刪除那一道也走它，多一句「這是標記刪除」。

## 連動

| 會動到 | 為什麼 |
|---|---|
| `domain/consequences.js` | `untickConsequences()`、`cancelConsequences()` |
| `data/visits.js` | `previewTaskChange()`，與 `followupOpsAfterTaskChange()` 共用身體 |
| `ui/components/tasklist.js` | `confirmUntick()` |
| `ui/views/home.js` | 兩個呼叫端各一行 |
| `ui/views/customerDetail.js` | 一行 |
| `ui/views/calendar.js`、`ui/views/visitEditor.js` | 取消／刪除那三道確認改用 `cancelConsequences()` |
| `tests/consequences.test.js` | 兩支新函式 |
| `CONTEXT.md` | 加一條「**拿回來**」（現在只散在註解裡：「勾錯了點回來」「拿回來了」） |
| `docs/adr/` | 補一支：**畫面只講真的會發生的事**（含「不可以嚇她」那一段） |
| `docs/常見問題.md` | 「我把追蹤報告拿回來，寄報告那張不見了」 |

## 驗收

- 單元：報告勾掉 + 二返沒約 → 拿回來要列**兩張**會被收走，`danger: true`
- 單元：報告勾掉 + 二返已約 9/20 → 要列出那個日期，**而且那一句是「不會被動到」**
- 單元：Examine 拿回來 → `untickConsequences()` 回 `null`（不問）
- 單元：`cancelConsequences()` —— 健檢那一筆列得出「Examine」而不是三個並列
- E2E：待辦中心拿回「追蹤健檢報告」→ 跳確認 → 按取消 → **那一張還是已完成**
- E2E：同上按「還是拿回來」→ 報告回到未完成、寄報告那一張真的不見了
