# 一門課可以哪個系統都不用壓（ADR-0126）

Status: done
來源：她 2026-10-06 第五點與問題 6 的回答
動工前先讀：ADR-0119、ADR-0041、ADR-0027、`public/js/domain/taskRules.js`（`systemsOf()`、`bookingSystemOf()`、`tasksForCourse()`、`describeSystems()`、
`bookingSystemsForVisit()`、`cancelTasksFor()`）、`public/js/domain/masterData.js` 的 `validators.courses`、`tests/course-systems.test.js`、
`docs/課程與待辦對照表.md`、`CLAUDE.md` 連動表「一門課壓哪幾個系統」那一列
Blocked by: —

## 她要的

> 第五 : 補充一點
> HRV也是不算次數的，通常會是我想邀客戶來體驗送的，就會讓他當天做完HRV後然後接著功醫門診聽報告

問她「HRV 是不是三個系統都不用壓？要不要指派診間或人？」，她回：

> 問題 6：目前先皆不用壓，不用指派診間或人員，過去行事曆記錄過 HRV 的那 7 次幫我補齊

## 為什麼會這樣

現在一門課**一定**壓在某個系統：

- `validators.courses`：`systems` 勾過的話「Abovee 與 Examine 至少要勾一個 —— 壓表一定要有一個地方」
- `systemsOf()`：`ticked.length` 是 0 時**退回類別去推**（空陣列被當成「沒勾過」）
- `bookingSystemOf()`：推不出來就猜 Abovee（`DEFAULT_RULE.bookAt`）—— 那是為了**認不得的課程**（ADR-0041：那筆來訪存在就代表壓過了）

Abovee 上沒有 HRV 這門課（第一段查過她的清單）。硬勾 Abovee 的話：取消一段 HRV 會長一張假的「取消 Abovee」；
待辦中心「壓表登記」把它算成要壓；09 的新檢查每拍一次都喊「HRV 沒拍到」。

## 談定的做法

**`systems: []`（明確的空陣列）＝哪個系統都不用壓。** 沒有那一格（`undefined`／`null`）照舊是「沒勾過」，照類別推。

- `systemsOf(course)`：`Array.isArray(course.systems)` 就回勾起來的那幾個（**可以是空的**）；不是陣列才退回類別。找不到課程照舊回 `null`
- `bookingSystemOf(course)`：課程存在而且 `systemsOf()` 是空陣列 → 回 `null`（不用壓）。**課程是 `undefined`（認不得）照舊猜 Abovee** —— ADR-0041 那一條一個字都不動
- `tasksForCourse()`：空陣列 → `[]`
- `describeSystems()`：`不用壓`
- `validators.courses`：拿掉「至少要勾一個」。「只勾耀聖」照舊擋（耀聖只收確認之後的登記，沒有地方壓表卻有確認後的登記講不通）—— 也就是：
  **要嘛一個都不勾，要嘛 Abovee／Examine 至少一個**
- 每一個 `bookingSystemOf()`／`bookingSystemsForVisit()` 的呼叫端都要走過一次，回 `null` 時那一句話、那一張待辦、那一格不可以出現：

| 在哪 | 現在拿它做什麼 | 回 `null` 時 |
|---|---|---|
| `taskRules.js` 的 `bookingSystemsForVisit()` | 一筆來訪動到哪幾個系統 | 那一段不加任何系統 |
| `taskRules.js` 的 `cancelTasksFor()` | 取消時長「取消 X」 | 那一段不長（它沒有壓過） |
| `consequences.js` 的 `bookingSystemLabel()`、`bookingConsequences()`、`rebookConsequences()`、取消那一族 | **確認框的標題**「已經在 X 壓好表了嗎？」「新的時間在 X 壓好了嗎？」、取消時要回哪幾個系統 | 見下面「確認框的標題」—— 那不是框裡的一句，是抬頭 |
| `scheduling.js` 的 `customersToBook()`、`bookingSystemOfPool()` | 待辦中心「壓表登記」還有誰 | 不算數 |
| `todoFlow.js` 第 574 行附近（`ownsTask()` 那一族） | 哪一張待辦屬於哪一段 | 那一段不擁有任何壓表類的待辦 |
| `visitEditor.js` 第 1235 行附近、`calendar.js` 第 1170 行附近 | 改期、取消的後果說明 | 同 `consequences.js` |
| `masterList.js` 的摘要與「壓哪幾個系統」那一排 | 設定頁 | 寫「不用壓」；三個都沒勾存得下去 |

  以上行號是 2026-10-06 的 `develop`（`0b02c4e`），動工時用 `git grep -n "bookingSystemOf\|bookingSystemsForVisit\|systemsOf("` 重列一次，**多出來的呼叫端也要走過**
- 種子：這一支不加課程（HRV 在 03）。`tests/course-systems.test.js` 那條「種子每一門的 `systems` 跟它的 `category` 推出來的一樣」要認得空陣列這個例外

### 確認框的標題（審查查到的）

`bookingConsequences()` 回的是 `title: 已經在 ${where} 壓好表了嗎？`，`rebookConsequences()` 回 `title: 新的時間在 … 壓好了嗎？`；
壓表（`schedule.js`）與來訪編輯器（`visitEditor.js`）直接拿去當抬頭。框裡一定還有別的行，所以沒有「空的框」這回事 ——
要擋的是抬頭變成「已經在  壓好表了嗎？」或「在 null 壓好了嗎？」。

- `bookingSystemLabel()` 現在看的是**那一天每一段**，不是這一次新加的：她先排了功醫門診、再併一段 HRV（她說的典型用法），抬頭照樣問 Abovee。
  改成只看這一次新加的那幾段，並濾掉不用壓的
- 新加的每一段都不用壓 → 換一個抬頭（例：「記下這一段？」），確認鈕的字跟著換（現在是「已確認，記錄」那一類 —— 沒有東西要她先去壓）。
  `rebookConsequences()` 同樣處理
- 字改了要看 `tests/day-slot-words.test.js`、`tests/fewer-words.test.js` 那幾支掃原始碼的

### 既有資料會不會被誤讀

`systems: []` 以前存不下去（驗證擋）、種子每一門都非空、資料健檢的 `checkSeedBlanks()` 補的是種子的值 —— 所以既有資料庫上不會有一筆空陣列被重新解讀。
動工時確認一次：`git grep -n "systems: \[\]"`（測試夾具可能有）。

### 她手滑三個都取消掉

存得下去，而那門課從此不長取消待辦。不另外跳確認框（同 ADR-0114 的精神）；設定清單那一行灰字寫「不用壓」，編輯表那一排的 `?` 講一句。

## 判準

- **這一行會不會讓一段不用壓的課長出「取消 Abovee」？** 一天兩段：HRV（不用壓）＋功醫門診（三個都壓）整天取消 → 只長功醫門診那幾張
- **這一行會不會讓一門認不得的課（主檔被刪了）從此不長取消待辦？** 那是 ADR-0041 要擋的，照舊猜 Abovee
- 只排了 HRV 的客戶：待辦中心「壓表登記」不把他算成還有要壓的
- 壓表加一段 HRV：存檔前那幾道確認不問「在 Abovee 壓好了嗎」；客人確認之後不長任何掛號待辦
- 設定 → 課程：三個都不勾存得下去，清單那一行寫「不用壓」；只勾耀聖照舊存不下去
- 沒有 `systems` 那一格的舊課程：算出來的一個字都不變。`tests/course-systems.test.js` 裡**只有一條要翻**：
  `systemsOf({ category: 'A', systems: [] })` 現在期望退回三個系統，那正是這一支要改掉的行為（改成 `[]`）；其餘不變
- **已經有功醫門診的那一天再加一段 HRV → 抬頭不問 Abovee**；只加 HRV → 抬頭不是「已經在  壓好表了嗎？」
- 新課程的空白表單預設勾著 Abovee（`masterList.js` 的 `blank`）—— 不會因為沒碰那一排就變成不用壓

## 連動

- 新 ADR `docs/adr/0126-a-course-can-be-booked-nowhere.md`（ADR-0119 一個字都不改）
- `docs/課程與待辦對照表.md`、`SPEC.md` 對應章節、`CONTEXT.md`（「不用壓」這個說法）
- `CLAUDE.md` 連動表「一門課壓哪幾個系統」那一列：空陣列＝不用壓；找不到課程照舊 `null`；兩個呼叫端「往相反的方向倒」那一句要補第三種
- 09 靠 `bookingSystemOf(course) === 'Abovee'` 決定哪幾段該在照片上

## 做完時留下的（2026-10-06）

- **`systemsOf()` 分三種**：沒有那一格 → 照類別推（不變）；`[]` → `[]`（不用壓）；全是認不得的字（`['打電話']`）→ **照舊退回類別**
  （那不是她說「不用壓」；issue 上只寫了「不是陣列才退回」，實作多留了這一條，`course-systems.test.js` 那一條原樣綠著）
- **`bookingSystemOf()` 回 `null`** 的呼叫端逐一走過：`bookingSystemsForVisit()`、`cancelTasksFor()`（跳過）、`cancelsBooking()`／`todoFlow.js` 的 `ownsCancel()`
  （`null === system` 本來就是假，沒改）、`scheduling.js` 的 `customersToBook()`（兩處：這個月壓過哪幾個系統、這筆額度要壓在哪）、
  `consequences.js` 三處。`git grep` 沒有多出來的呼叫端
- **整天取消的那條退路沒動**（`cancelTasksFor()` 最後那一段：勾掉的登記待辦裡沒有任何一段長得出它的，照舊收、算在每一段上）——
  一天只有 HRV、身上卻有一張勾掉的 Examine（課程後來被改成不用壓）時照樣長「取消 Examine」。登記過就是登記過了
- **確認框**：`bookingSystemLabel(visit, coursesById, indexes)` 多一個參數（只看哪幾段；沒給＝每一段）；
  `bookingConsequences()` 多回 `confirmLabel`，壓表與來訪編輯器改讀它（`tests/slot-names-everywhere.test.js` 那個掃原始碼的終點跟著換）。
  都不用壓：抬頭「記錄這一段？」／「記錄這 N 段？」、按鈕「記錄」（跟拍 Abovee 那一道同一句）；改期：「改到新的時間？」
- **順帶變準的一件**（不是 HRV 才有）：那一天本來有健檢（Examine）、再加一段復能，抬頭以前問「Abovee 與 Examine」，現在只問 Abovee ——
  健檢早就壓好了
- 驗證那一句改了字但留著「至少要勾一個」（`47-course-groups` 的 G8 釘著）
- E2E：新的一支 `52-book-nowhere`（N1 設定頁、N2 日曆排＋客戶說可以＋取消、N3 壓表併進已經有復能的那一天）。**自己建一門「體驗檢測」**，
  不借種子的 HRV —— 03 補了種子之後這一支不會跟著變
- `sw.js` v164；ADR-0126；`SPEC.md` 5.5 與資料模型、`CONTEXT.md`「不用壓」、對照表第二節、`CLAUDE.md` 連動表那一列
- **沒做的**：`docs/常見問題.md`「HRV 取消了為什麼沒有『取消 Abovee』」留給 12（那時候種子才有 HRV 這個名字）
