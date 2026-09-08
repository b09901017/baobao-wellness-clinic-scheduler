# 時段才是原子單位

來源：使用者，2026-09-08（需求 5b 的追問）
狀態：待她確認後動工
PR：**第一支**（地基）。十一項需求那一輪接在後面，見
`.scratch/naming-consequences-and-bulk-cancel/`

---

## 她問的四件事，先把事實講清楚

### 一、「現在是不是限制一天一筆來訪？」**不是。**

資料上沒有這條限制。`firestore.rules` 的 `validVisit()` 只擋「至少一個時段、
狀態要合法」，`validateVisit()` 也沒有擋。同一位客戶同一天要有兩筆來訪，
資料庫收得下。

真正發生的是**壓表那一頁的合併**：`domain/visits.js` 的 `withExtraSlot()`
把第二次壓的那一段併進同一天既有的那一筆。SPEC 第 4.4 節那句
「不要做成一格一格分開建立預約」講的是**建立的動線**（她一次填一天），
後來被當成了資料模型的鐵則。

### 二、「每個時段不是都該有那三個狀態嗎？」**已經做了一半。**

2026-08-20 搬過一次（ADR-0025）：

| 狀態 | 現在記在哪 |
|---|---|
| 已完成 / 未到 | **逐段**（`slot.attended`） |
| 待確認 / 已確認 / 已取消 | 整筆 |

ADR-0025 當時的理由是「同一天的時段是一起壓、一起問的」。
**那句話對「確認」成立，對「取消」不成立** —— 確認是客人一次回答一整天，
取消是事後一段一段發生的（機器壞了、治療師請假、只想改那一段）。
那條界線當初沒有分開想，這一輪把它分開。

### 三、「試算表怎麼記的？」**現在有一個既有的 bug。**

`domain/sheetReport.js` 的 `mark()` 讀的是 `markFor(v.status)` —— **整筆的狀態**。
所以一筆標「已完成」、其中一段 `attended: false` 的來訪，試算表上**兩段都印 ✓**。
那一支自己的註解寫著這件事還沒做：

> 之後時段各自帶結果時（見 `.scratch/visit-lifecycle/issues/07`），
> 要改的只有下面那一行 `markFor(v.status)` —— 換成看那一段自己的結果。

這一輪順手修掉它。

### 四、第二個既有的資料損失：確認動線會**刪掉**時段

`ui/views/home.js` 的確認動線裡，客人說「10:30 那一段不行」時，那一段是被
**從陣列裡刪掉**的（`const keep = (v.slots ?? []).filter(...)`）。
沒有紀錄它曾經被壓過，也不會長出「取消 Abovee」——
而她真的在 Abovee 上壓過那一格。

---

## 決定

**時段帶整條生命週期，來訪退化成「那一天的容器」。**

### 一、時段多一格 `slot.status`

五種都在上面：`pending_confirm` / `confirmed` / `cancelled` / `done` / `no_show`
—— 就是 `VISIT_STATUSES` 那一份，不另外開一組。

`slot.attended` **留著不動**：既有資料靠它，而且它是 ADR-0025 的欄位。
新資料兩個都寫，讀的時候一律走同一支存取器。

### 二、`visit.status` 改成**從時段推導**，但照樣寫進文件

不寫的話有三個地方要一起改，而它們都不該為這件事動：

- `firestore.indexes.json` 有 `deletedAt + status + date` 的複合索引
- `firestore.rules` 的 `validVisit()` 檢查 `d.status in [...]`
- 試算表報表與備份／還原讀它

推導規則（`visitStatusFrom(slots)`，由「還沒定案」往「定案」比，第一個對上的算數）：

```
1  全部 cancelled            → cancelled
2  有任何一段 pending_confirm → pending_confirm
3  有任何一段 confirmed       → confirmed
4  有任何一段 done            → done
5  其餘                       → no_show
```

第 4、5 條把 `closeVisit()` 那條「一段都沒做就是整筆未到」原封不動接了過來。

### 三、舊資料**零遷移**

`slotStatusOf(visit, slot)`：`slot.status` 有就用它，沒有就從
`visit.status` + `slot.attended` 推 —— 跟這個 repo 其他每一條退路同一種寫法
（`courseForEquipment()`、`equipmentForCourse()`、`slotName()` 都是）。

所以既有那幾百筆來訪一個字都不用改，也不需要一次沒有人按過的寫入。

### 四、`withExtraSlot()` 的 `reopened` 變成推導出來的

新加的那一段狀態是 `pending_confirm`，整筆一推導自然就退回「待確認」——
現在那段特別寫的 `reopened` 邏輯（含 `confirmedAt: null`）可以收掉一半，
只留「要不要跟她講這件事」那一半。

---

## 為什麼不是別的做法

**每一段拆成獨立的一筆來訪。** 那會推翻 SPEC 第 4.4 節，而「一天一筆來訪」
是狀態、療程單、掛號待辦全部掛著的那一層 —— 掛號是一天去一次，不是一段去一次。
容器留著、原子單位下移，兩件事都成立。

**只加一個 `slot.cancelled` 布林。** 那會變成第三個講同一件事的欄位
（`visit.status`、`slot.attended`、`slot.cancelled`），而三個欄位遲早有一個
跟另外兩個對不起來。一格 `status` 收得下全部五種。

**整筆改成逐段、`visit.status` 不再存。** 索引、Rules、試算表、備份四個地方
要一起改，而它們都不是這一輪的題目。存一份推導出來的值是刻意的重複，
資料健檢有一列盯著它有沒有對不起來。

---

## 受影響的檔案（動工前先看過一遍）

| 檔案 | 要做什麼 |
|---|---|
| `domain/visits.js` | `slot.status`、`visitStatusFrom()`、`slotStatusOf()`、`applyStatus({slotIndex})`、`closeVisit()`、`withExtraSlot()`、`visitActions()` |
| `domain/entitlements.js` | `slotOutcome()` 改讀 `slotStatusOf()`；cancelled 回 `null`（次數退回去） |
| `domain/taskRules.js` | 逐段取消要長「取消 X」；`tasksForVisit()` / `recordTasksForVisit()` 濾掉已取消的段 |
| `domain/todoFlow.js` | `todosForVisit()` 的兩列推導看還活著的段 |
| `domain/consequences.js` | `cancelConsequences({ slotIndex })`；一段 vs 一整天兩種話 |
| `domain/sheetReport.js` | `mark()` 改讀那一段自己的結果（順手修既有 bug） |
| `domain/audit.js` | 「取消了第 N 段」講得出是哪一段 |
| `domain/dayReview.js` | 分段仍然收得下逐段取消 |
| `domain/calendar.js` | `agendaFor()` / `monthBars()` 逐段上色 |
| `domain/health.js` | 新一列：來訪的狀態跟它的時段對不起來 |
| `domain/mergeImport.js` / `legacyImport.js` | 匯入時逐段寫 `status` |
| `ui/views/calendar.js` | 長按選單分「這一段」與「這一天」 |
| `ui/views/home.js` | 確認動線不再刪掉時段，改標 cancelled |
| `ui/views/visitEditor.js` | 狀態卡逐段 |
| `ui/views/customerDetail.js` / `progress.js` | 讀取卡片畫逐段狀態 |

**不動**：`firestore.rules`、`firestore.indexes.json`、`data/backup.js`、
`scripts/restore-backup.mjs` —— `visit.status` 照樣寫，slots 本來就內嵌。
