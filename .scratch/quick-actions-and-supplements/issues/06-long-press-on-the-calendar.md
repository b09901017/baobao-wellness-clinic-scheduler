# 日曆的每一列接上長按

Status: done
來源：使用者，2026-09-01（需求 B.5）
Blocked by: 02, 03, 05
動工前先讀：`issues/05`、`public/js/ui/views/calendar.js`、
`public/js/ui/views/visitEditor.js` 的 `wireStatus()`、
`public/js/domain/visits.js` 的 `TRANSITIONS` 與 `closeVisit()`、ADR-0020、0056

## 原話

> 在日曆抽屜的項目…上，加入「長按」功能…長按：彈出快捷操作選單，
> 可以直接編輯、取消、或改變狀態。
> **注意連動**：請嚴格檢查長按修改狀態後，關聯的 Todo、日曆、客戶詳情
> 是否都有正確觸發更新，避免狀態矛盾。

## 接在哪

`views/calendar.js` 的**三個**檢視共用同一支 `agendaRow()`，所以三個地方一起有：

| 在哪 | 那一列 | 長按到什麼 |
|---|---|---|
| 抽屜（點某一天） | `dayHtml()` 畫的那幾列 | 來訪／待辦／行事備註 |
| 日檢視 | 同一支 `dayHtml()` | 同上 |
| 週檢視 | `weekHtml()` 的每一段 | 同上 |

月檢視的色條**不接**：一格 11px 的字上長按等於誤觸，而且那裡點下去是「開那一天」
不是「開那一筆」。

## 選單長什麼樣（三種）

規則寫成純函式放在 domain，畫面不自己判斷 —— 同 `STATUS_VIEW` 的道理。

### 一筆來訪 —— `domain/visits.js` 多一支

```js
/**
 * 長按一筆來訪，快捷選單上有哪幾顆。
 *
 * 狀態那幾顆**直接借 `nextStatuses()`**，不要在畫面上另外列一份 ——
 * 兩份遲早會有一份准了一個 `TRANSITIONS` 不准的轉移，
 * 而 Rules 不擋狀態機（ADR-0006），所以那一下會真的寫進去。
 *
 * 「已完成」與「未到」不放進來：那兩個是**逐段**的結果
 * （`slotOutcome()`，ADR-0025），整筆一起標會把「做了兩段就走」那種
 * 情況記錯，而次數就是跟著它扣的。要標那兩個走「簽療程單」那一頁。
 */
export function visitActions(visit)
```

回的是（順序就是畫面上的順序，最常按的在最上面）：

| id | label | 什麼時候有 |
|---|---|---|
| `confirmed` | 客戶說可以　→ 已確認 | `nextStatuses()` 裡有 `confirmed` |
| `close` | 客人來了，去簽療程單 | 狀態是 `pending_confirm` / `confirmed`，而且 `visit.date <= 今天` |
| `edit` | 改這一筆 | 沒鎖住（`isLocked()`）就有 |
| `cancelled` | 取消這一筆（紅） | `nextStatuses()` 裡有 `cancelled` |

`close` 那一顆不自己收尾，**直接開簽療程單那張逐段的抽屜**（`views/home.js`
的 `closeDrawerHtml()` 那一份判斷）。這一件在 issue 06 只放一顆
「去簽療程單」的連結（`go('/todo/close')`）—— 把那張抽屜抽成共用元件
是另一件事，不塞進這一輪。

### 一件待辦（有日期的隨手記）

跟 issue 07 是同一份清單（四個入口共用），見那一支。日曆這邊只是第五個入口。

### 一筆行事備註

`改這一筆` / `刪掉（紅）`。兩顆，因為它本來就只有這兩件事可做。

## 狀態改完之後：三個畫面怎麼跟上

她點名要嚴格檢查這件事。答案是**一條路都不要另外開** ——

### 寫入一律走 `visitsData.save()`

`data/visits.js` 的 `save()` 把三件事放在**同一個 batch**：來訪本身、
額度的計數（`recount()`）、該產生／該收掉的任務（`syncTasksForVisit()`
與 `syncFollowupTasks()`）。所以：

| 畫面 | 怎麼跟上 | 為什麼不會矛盾 |
|---|---|---|
| 日曆 | 存完 `render(el)` 重讀 | 讀的是 Firestore 的那一筆 |
| 待辦中心 | 下次進那一頁重讀 | 任務是 `save()` 同一個 batch 寫的；「跟客人確認時間」與「簽療程單」是從來訪**推導**的（`visitsToConfirm()` / `visitsToClose()`），沒有第二份資料 |
| 客戶詳情 | 下次進那一頁重讀 | 次數是 `counts()` 現算的（ADR-0004） |
| 試算表 | `repo` 寫入後十秒自動推（`data/sheetSync.js`） | 同上 |

**所以真正要守的只有一條：不可以自己組 `{...visit, status}` 去寫。**

### 把狀態轉換抽成一支純函式

`visitEditor.js` 的 `wireStatus()` 裡那七行（`closeVisit()` 或直接換狀態、
補 `confirmedAt` / `cancelledAt` / `cancelReason` / `released`）現在只有一份，
長按這條路會變成第二份。抽掉：

```js
/**
 * 換一個狀態之後那一筆來訪長什麼樣。**只算，不寫。**
 *
 * 來訪編輯器的狀態卡與日曆的快捷選單共用這一支 —— 兩邊各寫一次的話，
 * 遲早有一邊忘了補 `cancelledAt`，而那一筆從此在稽核紀錄裡看不出何時取消的。
 *
 * @param {object} visit
 * @param {string} to
 * @param {{at?: string, reason?: string|null}} [o]
 * @returns {object} 新的那一筆（沒動到原本那一份）
 */
export function applyStatus(visit, to, { at = new Date().toISOString(), reason = null } = {})
```

`visitEditor.js` 改成呼叫它，行為一個字都不變（測試盯著）。

### 取消照樣要二次確認

`confirmAction()` 那四句後果一字不改（SPEC 第 6.5 節）。長按不是「省掉確認」的
藉口 —— 省掉的是**找到那一筆的四層點擊**，不是那個決定本身。

## 動線的細節

- 選了「改這一筆」→ 走既有的 `openEditor()`／`mountEditor()`，
  跟按鉛筆一模一樣（ADR-0020 的路徑不變）。
- 選了狀態 → `toast.withSaveState()` 包住寫入（復原退得回去，SPEC 第 6.3 節）
  → 選單自己關掉 → `render(el)`。
- **選單關掉的時候底下那一天的抽屜要還在。** 存完之後 `render(el)` 會重畫整頁，
  那一天的抽屜是掛在 `<body>` 上的（`openSheet()`），所以它不會被重畫洗掉 ——
  但它裡面的內容是舊的。**存完要把那一天重開一次**：

```js
// 存完之後那一天的抽屜裡還是舊資料。關掉再用新的資料開一次同一天 ——
// 她的下一個動作八成是看同一天的別筆（ADR-0020）。
closeSheet();
await render(el);
if (backDate) openDay(el, freshData, backDate);
```

  `openDay()` 需要新的 `data`，所以 `render()` 要能把讀回來的那一份交出去 ——
  最小的改法是讓 `paint()` 把 `data` 存進模組層的 `state`，
  長按那條路存完之後從那裡拿。

## 發現得了嗎

長按是隱形的。抽屜底部（`dayHtml()` 那一句「這裡只有你自己排的」旁邊）
多一行淡字：

> 長按一列可以直接改。

一行、只在抽屜裡出現一次。**這句話留得住**，照 ADR-0056 的判準：
它在講一件她從畫面上看不出來的事。

## 連動

- `tests/visits.test.js` 補 `applyStatus()` 與 `visitActions()`。
- `SPEC.md` 第 8.6 節補「長按一列」那一段。
- ADR-0056 **沒有被推翻**：改得動來訪的還是只有日曆，長按選單長在日曆上。
  待辦中心與客戶詳情的列一顆狀態鈕都不會有。

## 不做

- 不在長按選單裡改日期或時段。那是編輯器的事（SPEC 第 7 節規則 10：
  改期是取消後重新排一筆）。
- 不放「已完成」「未到」。理由見上面 `visitActions()` 的註解。
- 月檢視的色條不接長按。

## 驗證

- 新測試（`tests/visits.test.js`）：
  - `applyStatus(v, 'cancelled', { reason })` 會補上 `cancelledAt`、`cancelReason`、
    `released: false`，而且**不動到原本那一份**
  - `applyStatus(v, 'done')` 跟 `closeVisit(v, 全部 true)` 結果一樣
  - `visitActions()` 對 `done` / `cancelled` 的來訪只回 `[]`（終點，沒東西可做）
  - `visitActions()` 不會回任何 `nextStatuses()` 不准的轉移
- 瀏覽器（連動檢查，一條一條走）：
  1. 日曆 → 某天有一筆「待確認」→ 長按 → 「客戶說可以」→ 存
  2. 同一天的抽屜當場變成「已確認」的顏色與徽章
  3. 待辦中心：「跟客人確認時間」那一列的數字**少一**
  4. 待辦中心：Examine／耀聖那幾列**多出**這一筆的登記任務（ADR-0027）
  5. 客戶詳情：那一天的卡片顏色跟著變，「已排未上」次數不變（確認不扣次數）
  6. 長按同一筆 →「取消這一筆」→ 二次確認 → 存
  7. 日曆上那一列**暗掉、有刪除線、徽章寫已取消**（issue 02）
  8. 待辦中心：剛剛長出來的登記任務收掉了，「改時間／取消」那一列多出取消任務
  9. 客戶詳情：次數還回來了
- 瀏覽器：長按一件待辦、一筆行事備註，各自的選單只有它該有的那幾顆
- `npm test` 全綠
