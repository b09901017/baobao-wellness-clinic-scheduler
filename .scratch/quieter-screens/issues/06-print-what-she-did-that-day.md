# 06 她自己看的地方一律印「那天做了什麼」

Status: todo
動工前先讀：`.scratch/quieter-screens/spec.md`、`docs/adr/0077`、`docs/adr/0078`

## 她要的

> 有關復能名稱的小小修改，我希望在，客戶-看這個月進度那邊以及日曆/壓表壓好表的提醒那邊，以及代辦，像是跟客人確認時間點客人之後浮出的那個抽屜裏面寫得等等
> 就是目前都是寫"09:00-09:30 復能 LuLu" 或是"9/10(四) 09:00-09:30 復能"
> 我希望這個這些都可以像是在月曆寫得那樣，不要只寫復能，而是寫IN(30) IL(60)
> 不知道還有沒有其他地方有類似問題，請幫我全域檢查

## 為什麼會這樣

`domain/naming.js` 的 `slotName()` 本身是對的，貼給客人那一側（`line`）也全部正確。
**破口全在沒有走 `slotName()` 的呼叫端** —— 直接讀 `slot.courseName` 快照或 `course.name` 全名。

界線只有一條，而且要在改之前先講清楚：

| 那串字要去哪 | 印哪一種 |
|---|---|
| **會被複製進 LINE 貼給客人** | `line`（`復能`、`靜脈雷射`）—— 一個器材字都不寫，ADR-0077 |
| **留在 app 畫面上給她掃** | `short`（`SIS(30)`、`IL(60)`） |

## 要改的（13 處）

### 她點名的三個

| 檔案:行號 | 畫面 | 現在 | 該印 |
|---|---|---|---|
| `ui/views/progress.js:235` | 進度追蹤一段一列 **＋ 客戶詳情「看這個月進度」**（`customerDetail.js:484` 共用 `progressDayHtml()`） | `09:00-09:30 復能` | `SIS(30)` |
| `ui/views/schedule.js:1168` | 壓表 →「這個月壓好的」清單 | `9/10(四) 09:00–09:30 復能・LuLu` | `SIS(30)` |
| `ui/views/home.js:2797` | 待辦「跟客人確認時間」點客人之後的抽屜 | `9/10(四) 09:00–09:30 復能` | `SIS(30)` |

`progress.js` 這一支要連資料層一起改：`domain/progress.js:115` 的 `dayFor()`
只搬了 `courseName` 快照，**沒搬 `courseId` / `equipmentId` / `ivProductId`**，
所以 UI 手上根本沒有東西可以算 short。兩個選法：在 `dayFor()` 裡算好，或把三個 id 搬過去。

### 同型的另外十處

| 檔案:行號 | 是什麼 |
|---|---|
| `ui/views/schedule.js:2122` | 壓表存檔前那道確認的第一行（`ctx.all` 三份主檔都在手上） |
| `ui/views/visitEditor.js:1040` | 來訪編輯器存檔前那道確認的 `slotSummary()` |
| `ui/views/home.js:3012` | 「已確認」卡片 |
| `ui/views/home.js:3129` | 「收尾（簽療程單）」卡片那排丸子 —— `renderClose()`（`home.js:3037`）**只讀了 courses**，要補 equipment 與 ivProducts |
| `ui/views/home.js:3176` | 收尾抽屜逐段那幾列 |
| `ui/views/home.js:1798` | 待辦任務列第二行 —— `taskLine({}, visit)` **第三個參數 master 沒傳**，`taskVisits.master` 就在同一支裡（`home.js:1763`） |
| `ui/views/home.js:1149` | 待辦「依客戶」抽屜 —— `d.master` 只有 `{ courses, equipment }`，**少 `ivProducts`**，於是點滴那一段寫「營養點滴」而別頁寫「雪」 |
| `ui/views/backfill.js:192` | 時段反查結果的抬頭（她自己看的） |

### 反向的一個 bug（她沒問，但比較嚴重）

`ui/views/backfill.js:185` 組給客人的邀約訊息時，假時段只填了
`courseName: course.name`、**沒填 `courseId`**，於是 `slotName(…, 'line')` 找不到課程、
退回快照 —— **貼給客人的 LINE 會寫「ILIB」而不是「靜脈雷射」**，直接違反 ADR-0077。
這一處仍然是 `line`，要補的是 `courseId`。

## 刻意不改

| 檔案:行號 | 為什麼 |
|---|---|
| `domain/audit.js:349` | `visitCourseLabel(d)` 不帶 master —— 稽核記的是「當時寫下去的字」（ADR-0078），`tests/visits.test.js` 盯著 |
| `domain/sheetReport.js:398` | 試算表的 `course` 欄按 ADR 屬「當初買了什麼／全名」那一族。要改是另一個決定 |
| `domain/messages.js:94/212/294`、`ui/views/naming.js:292/332/349` | 貼給客人的那一句，`line` 一個字不動 |

## 判準

- **這一行印出來的字，是要貼給客人的嗎？** 是 → `line`；不是 → `short`。
  每改一處都問一次
- 「復能」這兩個字在**她自己看**的畫面上一次都不出現（月曆已經是這樣了）
- 六個組 master 的地方**三份都要帶齊**（courses、equipment、ivProducts）——
  少一份的症狀是「這一頁的點滴寫『營養點滴』，那一頁寫『雪』」，既有測試盯著
- 貼給客人的 LINE 裡一個器材字都沒有（含 backfill 那一條修好之後）
- 測試：先寫一支失敗測試，用同一組假資料跑過 13 個呼叫端各自的組字函式，
  斷言她自己看的那 12 處回 short、backfill 那一處回 `靜脈雷射`
