# 課程自己勾壓哪幾個系統（取代四選一的任務類別）

Status: todo
來源：`../spec.md` 三（「每個課程都要可以自己選：壓表壓哪幾個系統」）
動工前先讀：`domain/taskRules.js` 第 100–230 行（`CATEGORY_OPTIONS`、`describeCategory()`、`RULES`、`bookingSystemFor()`、
`bookingSystemsForVisit()`、`tasksForCategory()`、`tasksForVisit()`）與第 560–710 行（`newRegistrations()`、`cancelTasksFor()` 一帶）、
`domain/todoFlow.js` 第 565–580 行、`domain/scheduling.js` 第 640–690 行、`domain/consequences.js` 第 110–120、660–670 行、
`domain/masterData.js` 的 `picksDoctor()` 與 `validate()` 第 352 行、SPEC 5.5、`docs/課程與待辦對照表.md`、ADR-0027、0041、0097、0107
Blocked by: 02（表單版面）

## 她要的

> - 每個課程都要可以自己選：壓表壓哪幾個系統、要不要簽療程單、要不要寫紀錄、診間、哪一科的醫師、別稱…。之後都還要能改

> - 功醫門診：…三個系統都要壓…

## 為什麼會這樣

SPEC 5.5：「任務規則綁在**類別**上，不逐課程設定。課程只存 `category`，新增課程時選一個類別即可。」
類別只有四種（A 門診、B 健檢、C 療程、不用掛號），每一種是一組固定的「壓表在哪＋客人確認之後去哪幾個」（`RULES`）：

| 類別 | 壓表在 | 確認之後 |
|---|---|---|
| A | Abovee | Examine、耀聖 |
| B | Examine | —— |
| C、不用掛號 | Abovee | —— |

所以「只壓 Abovee＋耀聖」這種組合做不出來。她要每一門課自己勾。

**讀類別的地方**（全部要改成問同一支）：
- `taskRules.js`：`describeCategory()`、`bookingSystemsForVisit()`（第 177 行）、`tasksForVisit()`（224）、第 569、666、670、703 行（掛號逐段、取消逐段）
- `todoFlow.js` 第 573–574 行（讀取卡片上那一張取消任務屬於哪一段）
- `scheduling.js` 第 648–650 行（那一天壓在哪幾個系統）、第 689 行 `systemCategoryOf()`（待辦中心「壓表登記」那一列講哪個系統）
- `consequences.js` 第 117、666 行（取消時要回哪個系統放掉、改期時「新的時間在 X 壓好了嗎」）
- `masterData.js`：`picksDoctor()`（`category === 'A'`，那一條歸 04）、`validate()` 第 352 行（類別合不合法）
- `masterList.js`：課程摘要那一行、任務類別下拉、醫師那一格的提示
- `scripts/seed-staging.mjs` 透過 `newRegistrations()` 間接讀

## 談定的做法

1. **課程多一格 `systems`**：`['Abovee', 'Examine', '耀聖']` 的子集合。推導：
   - **壓表在哪**（`bookAt`）：勾了 Abovee 就是 Abovee；沒勾 Abovee、勾了 Examine 就是 Examine
   - **客人確認之後長哪幾張**：其餘勾起來的（Examine、耀聖），扣掉 `bookAt`
   - 驗證：Abovee 與 Examine 至少勾一個（壓表一定要有一個地方）
2. **沒有 `systems` 的課程照舊從 `category` 推**（`RULES`），既有資料一筆都不搬。唯一一支：`taskRules.js` 的 `systemsOf(course)`；
   `bookingSystemOf(course)`、`tasksForCourse(course)` 都從它來。**上面列的每一個讀類別的地方都改成傳課程、問這兩支** ——
   沒有任何一處再自己比 `category`
3. **設定頁**：「任務類別」下拉換成三個勾（Abovee、Examine、耀聖），一句提示「Abovee 是壓表那一下；其餘的等客人說可以之後長成待辦」。
   舊課程打開時三個勾照 `systemsOf()` 畫好（存一次不改任何事）。摘要那一行改成講系統（例「Abovee 壓，確認後 Examine、耀聖」）。
   `category` 欄位留在資料上、表單不再改它（存檔時保留原值）
4. **種子**：每一門課加上 `systems`，跟它的 `category` 推出來的一模一樣（測試釘住）。分類預設（02 的 `GROUP_DEFAULTS`）接上 `systems`
5. **ADR-0119**：推翻 SPEC 5.5「任務規則綁在類別上，不逐課程設定」那一句；理由（功醫門診與之後她自己加的課）、為什麼沒有遷移（讀的時候退回）
6. **文件**：SPEC 5.5 那張矩陣改成「預設照類別、每一門課可以自己改」；`docs/課程與待辦對照表.md` 第二、四節；
   `CLAUDE.md` 連動表加一列「課程壓哪幾個系統」

## 牽連

- **取消類的待辦**（`cancelTasksFor()`，ADR-0070、0091）：「壓在哪就收哪」照新的 `bookAt`；那一段勾過的 Examine／耀聖照舊收。改一門課的系統之後，**已經長出來的任務不追溯**（下一次那一筆來訪被存時照新規則比對 —— 跟改類別現在的行為一樣）
- **掛號逐段**（`newRegistrations()`，ADR-0107）、**那一天過了不長**（`registrationClosed()`，ADR-0113）：只換「要長哪幾種」那個來源
- **確認框**（`registrationsWhenSettled()`、取消、改期）：講的系統要跟真的會長的一樣（ADR-0070）
- **讀取卡片的歸屬**（`todoFlow.js` 的 `ownsCancel()`）
- **待辦中心「壓表登記」**那一列講的系統（`systemCategoryOf()`）
- `docs/課程與待辦對照表.md` 每一句後果說明照它寫
- 試算表的 TODO／FINISHED 區走 `taskLine()`，不看類別 —— 不受影響

## 判準

- **舊課程算出來跟以前一模一樣**：每一門種子課程、加上 `category` 是 A／B／C／null／認不得的五種，`bookAt` 與「確認後長哪幾張」都等於 `RULES` 給的？（測試逐一比）
- 一門課只勾 Abovee＋耀聖：客人確認後只長一張耀聖；取消時長「取消 Abovee」，勾過耀聖的話再長「取消 耀聖」？
- 一門課只勾 Examine＋耀聖：壓表在 Examine、確認後長耀聖？
- 三個都不勾、或只勾耀聖：存不下去，講為什麼？
- `grep -n "\.category" public/js/domain public/js/ui` 只剩 `systemsOf()` 的退回、行事備註的 `category`（那是另一件事）、04 的醫師退回？
