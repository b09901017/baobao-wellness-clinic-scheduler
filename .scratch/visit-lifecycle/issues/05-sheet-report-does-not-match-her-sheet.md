# 試算表報表和她原本那張對不起來：多了總表、少了備註與 TODO 區、二返沒有備註

Status: done
回報者：使用者，2026-08-20（並提供完整 `.xlsx`）
動工前先讀：`.scratch/visit-lifecycle/spec.md` 第 5 節（那張表的真實結構）、
`SPEC.md` 第 3 節、第 4.8 節、`docs/legacy/README.md`、
`docs/adr/0010-sheet-sync-is-an-export-not-a-service.md`、
`docs/adr/0013-sheet-sync-is-a-push-not-a-pull.md`

## 症狀

她要「和我原本那個一樣」的試算表。拿到真檔（22 張分頁）比對之後，
現在 `domain/sheetReport.js` 與 `sheets/readonly-report.gs` 差在五個地方：

| # | 她要的 | 現在 | 決定 |
|---|---|---|---|
| 1 | 不要多一個總表 | `overviewReport()` 與 `.gs` 的 `renderOverview()` 各做一張「總表」 | **拿掉，也不搬到 app**（2026-08-20 使用者決定） |
| 2 | 日期欄是打勾的框框 | `✓` / `✓2`，而且**只要不是取消就打勾**，分不出待確認與已完成 | **改成三種符號**：`✓` 已完成、`△` 已確認、`○` 待確認。同一天兩次沿用現在的 `✓2` 寫法 |
| 3 | 應有次數、實際次數 | 應有／已完成／已排未上／剩餘 | **保留四欄不動**（2026-08-20 使用者決定）。`SPEC.md` 第 4.2 節不用改 |
| 4 | 要有備註區、TODO / FINISHED 區 | `.gs` 的 `renderNotes()` 只有「這位客戶」與「來訪紀錄」 | 補上，全部唯讀 |
| 5 | 有預約二返要備註在健檢那一欄最下面 | 沒有 | 補上，格式照她原本的寫法 |

「每個人只呈現他有買的課程」那一項**已經是這樣了** —— 只印還在的額度，
次數 0 的那幾列本來就不存在。舊表是 11 列固定寫死才會有一堆 0。

## 要做的五件事

### 1. 拿掉總表

`domain/sheetReport.js` 的 `overviewReport()`、`syncBundle()` 裡的 `overview`、
`.gs` 的 `renderOverview()`、`#/settings/report` 那個下拉的「總表」選項，一起收掉。
`tests/sheet-report.test.js` 與 `tests/sheet-script.test.js` 有對應的測試要跟著改。

### 2. 三種符號的勾

`mark()` 現在只回 `''` / `✓` / `✓N`，因為它只數「有幾個時段掛到這筆額度」，
不看來訪狀態。要改成依狀態分：

| 狀態 | 符號 |
|---|---|
| `done` | `✓` |
| `confirmed` | `△` |
| `pending_confirm` | `○` |
| `no_show` | 要決定 —— 現在完全看不出來，但「這個人常放鴿子」是她想看見的（`SPEC.md` 第 4.2 節） |
| `cancelled` | 空白（時段已經還回去了） |

同一天同一筆額度有兩段時，狀態可能不一樣（一段做了、一段沒到）。
沿用現在 `✓2` 的寫法，但要決定混合時印什麼 —— **不要無聲地挑一個**。

**這三個符號和進度追蹤頁（`issues/07`）、日曆（`issues/03`）講的是同一組狀態。**
`status → 符號 / 標籤 / 顏色` 只能有一份實作。

### 3. 備註區

資料：`customer.flags`（永久限制）與 `customer.marks` / `customer.notes`（備註，ADR-0019）。
舊表那一段手寫的東西混了五種內容（永久限制、偏好、健康資訊、家人交通、閒聊），
匯入時全進了 `notes` —— 報表要把它放回去，否則她會覺得表變空了。
`syncBundle()` 已經有 `flags` 與 `notes`，`.gs` 的 `renderNotes()` 也已經印了，
確認一下位置與標題就好。

### 4. TODO / FINISHED 區

- 資料要從 `syncBundle()` 帶過去（`tasks` 依 `done` 分兩組），
  **`.gs` 一個判斷都不要自己做**（ADR-0013）。
- 位置照舊表：`TODO` 在 A 欄、`FINISH` 在 K 欄，同一列，隔一個空行才列項目。
- 列的寫法照舊表的 `{M/D}{療程名}` + 任務名，但**日期和療程名中間要加一個空白** ——
  舊表黏成 `7/60.75萬健檢`，很難讀。
- **唯讀**。舊表那些框是可以勾的，新的不要 —— 理由見下面那條觀察。

> **舊表的 FINISH 區幾乎永遠是空的**：22 張分頁裡只有 1 筆搬過去，
> TODO 區的框幾乎全是 `FALSE`，包含日期早就過了的。
> 她從來不回試算表勾那些框。所以這兩塊做成 **app 任務狀態的鏡子**是對的，
> 不要做成一個要她去勾的地方。

### 5. 二返的備註

**位置**：矩陣的**下一列**（不是寫死第 13 列 —— 沒有營養點滴那兩列的客戶會往上移），
**欄位 = 那次健檢被勾起來的那一欄**。

**格式**（照她原本的寫法，三種都出現過）：

| 寫法 | 意思 |
|---|---|
| `7/13 二返(夏)` | 約好了，括號裡是醫師 |
| `二返(8/5)` | 約好了，括號裡是日期 |
| `二返()` | **還沒約**，先擺一個空位 |

產生時挑一種一致的就好（建議 `M/D 二返` + 有醫師才加括號；還沒約就印 `二返()`），
但**解析舊表時三種都要吃得下**（括號有全形也有半形）。
醫師是「夏／許／李」，他們不在 `config/staff` 裡（`SPEC.md` 第 12 節），
所以 app 現在**記不住是哪位醫師** —— 這是一個缺口，見下面「要問她的」。

資料已經拿得到：`domain/followups.js` 的 `pairsOf()` 知道哪一筆二返配哪一筆健檢，
二返的來訪日期在 `visits` 上。

**那一格不是二返專用。** 舊表同一列還放過營養點滴當次的品項簡寫（`護肝`、`雪`）
與不在療程列裡的課程（`心臟科評估`、`EECP體驗`）。做成「日期欄底下的自由註記列」
比做成「二返列」更貼近她的用法，而品項簡寫 app 本來就有（`slot.ivProductId`）。

## 動工順序：`.gs` 不能單獨先寫

她 2026-08-20 說新試算表是**專門開給這個 app 的，全空的，還沒有任何 `.gs`**，
要一支完整的、符合上面五件事的指令碼。

但 `.gs` **不能先寫**，因為 ADR-0013 的結論是**它一個數字都不重算** ——
排版與次數只有 `domain/sheetReport.js` 一份實作，`.gs` 只負責把送過來的東西擺好。
上面那五件事（三種符號、拿掉總表、備註區、TODO/FINISHED、二返註記）
全部都要先改 `syncBundle()` 送出去的內容，`.gs` 才有東西可以擺。

所以順序是：

1. `domain/sheetReport.js` 的 `syncBundle()` —— 加 `tasks`（依 `done` 分兩組）、
   加二返註記、`mark()` 改成三種符號、拿掉 `overview`
2. `tests/sheet-report.test.js` 跟著改
3. `sheets/readonly-report.gs` 照新的 bundle 重寫版面
4. `tests/sheet-script.test.js`（它用替身把 Apps Script 的 API 做出來，
   讓那 400 多行真的跑一遍）跟著改
5. `SYNC_FORMAT` 從 `1` 升到 `2` —— `.gs` 收到看不懂的版本要整包拒絕，不要半套渲染

**符號、狀態名稱、顏色不可以在這裡自己定義一份**，和日曆（`issues/03`）、
進度追蹤頁（`issues/07`）共用同一組。

## 同名分頁被清空的防呆（降級成「順手做」）

`renderCustomer()` → `resetSheet()` 只用**分頁名字**比對，找到就 `sheet.clear()`
整張清空重畫，沒有任何「這張是不是我做的」的檢查。

**她的情況踩不到** —— 新試算表是空的，裡面不會有同名分頁。
（`removeStaleSheets()` 本來就不危險，它只刪 A1 含「系統自動產生」的分頁。）

還是值得補，因為它很便宜而且防的是「哪天她把網址填錯、指到舊表」：
`resetSheet()` 補上和 `removeStaleSheets()` 同一條檢查 —— 分頁已經存在、
但 A1 不含「系統自動產生」時**不要清空**，改成建一張新的並在 `doPost` 的回傳裡講出來。

## 二返的醫師（2026-08-20 已回答）

她要記進 app：**夏、許、李**三位，約二返時用選的。見 `issues/08`。
所以報表那句 `7/13 二返(夏)` 的括號**印得出來**，不用她打字。


## Comments

**2026-08-20 — 做完了。** `npm test` 從 579 變成 586 全過。

五件事都做了，加上兩件順手的：

| 在哪裡 | 做什麼 |
|---|---|
| `domain/visits.js` | `MARKS` / `MARK_ORDER` / `markFor()` / `MARK_LEGEND` —— 符號只有這一份，日曆與進度追蹤頁之後照這裡分 |
| `domain/sheetReport.js` | `mark()` 改成四種符號帶數量；拿掉 `overviewReport()`；`syncBundle()` 多 `tasks` 與 `followupNotes`，少 `overview`；`SYNC_FORMAT` 1 → 2 |
| `data/tasks.js` | 多一支 `listAll()`（整包讀，不逐位客戶查） |
| `data/sheetSync.js`、`ui/views/report.js` | 把任務與課程餵進去 |
| `sheets/readonly-report.gs` | 拿掉總表；二返註記列；TODO / FINISHED 兩塊；符號各自的底色；`resetSheet()` 的守衛 |

**兩件當初沒寫進這一支、但做了的：**

1. **手動貼上那條路也一起改了。** 原本只打算改自動推的，但那會讓同一份報表因為走哪條路
   而長得不一樣，她會以為其中一條壞了。`customerReport()` 現在也吐二返註記與
   TODO / FINISHED，和 `syncBundle()` 共用同一組 helper。
2. **`resetSheet()` 的守衛做了**（原本降級成「順手做的保險」）。它很便宜，
   而且防的是「網址填錯指到舊表」那一次就會吃掉她手寫幾年的東西。
   認不出來的分頁跳過並在回傳的 `skipped` 裡講出來。

補了 [ADR-0024](../../../docs/adr/0024-the-sheet-mirrors-her-old-one.md)：
沒有總表、四種符號、TODO/FINISHED 由 app 填。ADR-0010 與 ADR-0013 都沒有被推翻。

**她要做的一件事**：`sheets/readonly-report.gs` 貼進那份新試算表的 Apps Script，
設好 `SYNC_TOKEN`，部署成網頁應用程式，網址與密鑰填進 `#/settings/report`。
步驟在 `.gs` 的檔頭與 `sheets/README.md`。

**還沒驗證的**：`.gs` 只跑過替身（`tests/helpers/appsScriptStub.js`），
沒有真的部署過。第一次部署如果炸了是預期內的 —— 替身抓得到邏輯錯，
抓不到 Google 那一側的行為差異。
