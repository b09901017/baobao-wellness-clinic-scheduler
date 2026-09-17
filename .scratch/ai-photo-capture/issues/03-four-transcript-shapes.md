# 四種單子的抄字格式

Status: todo
Blocked by: 02
來源：`../spec.md`（「抄字格式的三條規矩」）
動工前先讀：01 的「AI 只抄字」ADR、`tests/sheet-script.test.js`（兩邊講同一句話的盯法）、
`.local/references/圖片對照.md`（**有真名，只看不抄**）與那幾張照片

## 她要的（原話）

> AI 只出候選，她確認之後才寫進去。寫入一律走既有的那幾支，AI 不可以自己寫 domain，
> 也不可以自己判斷課程／器材／狀態

> c 訂購單上有身分證字號 可以拍照送到我自己的雲端和 AI，但不要儲存

## 為什麼會這樣

「AI 不可以判斷課程」要是只寫在提示詞裡，那是機率；**格式裡根本沒有那一格**才是保證。
所以四種單子的格式是這一輪唯一一個「AI 做得到什麼」的定義，四個功能與考試（04）都讀它。

照片實際長什麼樣（2026-09-17 看過）：

| 單子 | 上面有什麼 |
|---|---|
| 訂購單 | 一個月一種版本。表頭印「2026年08月」、貴賓姓名、**身分證號、電話、生日**、11 列印好的套組（數量、金額、備註）、功醫健檢 □5萬 □12萬、手寫加的列（`任選(30)` ×10）、尚欠尾款、訂單總計、刷卡分期欄、OB 專員備註；常貼便利貼 |
| 方案文宣 | 方案名、總價、會籍（1 年，限本人）、七個項目（`高能量雷射 或 超磁場 或 INDIBA 共計60min ×12`） |
| Abovee 列表 | 左半：預約狀態、預約日期、預約時段、姓名、病歷號、身份別、性別、**電話**、課程（`SIS 60`、`二返60`）…預約來源。右半：預約來源、診間、交通方式…**服務資源**（治療師全名、`I1點10`、`EECP1`）…**取消原因**…建立日期。一頁 10 筆 |
| 療程單 | 一位客戶一種課程一張。表頭日期（民國年 `115.5.14`）、客戶姓名、**客戶編號**（＝病歷號）、課程名稱；每一列：序號、日期（常常沒寫年）、客戶簽名、治療師章、器材勾選格（Indiba／SIS／高能量雷射，有的還有靜脈雷射）、扣課章 |

## 要做什麼

`functions/transcripts/`：四支，每一支匯出 `schema`（給 Gemini 的 `responseSchema`）與 `prompt`。

**三條規矩**：

1. **沒有任何 id 欄位**
2. **數字與日期照寫成字串**（`"8萬"`、`"80000,-"`、`"7/15"`、`"115/7/8"`）
3. **永遠不抄**：身分證字號、生日、電話、卡號、末四碼、分期、銀行、發票號、章上的人名、簽名的內容（只抄「有沒有簽」）

大致形狀（動工時照照片調）：

- **orderForm**：`customerName`、`formMonth`（印的）、`handwrittenDates[]`、
  `packages[{ printedName, quantity, amount }]`（有寫數量的才列）、`checkupTicked[]`（`"5萬"`／`"12萬"`）、
  `handwrittenRows[{ text, quantity, amount }]`、`unpaid`、`obNote`、`stickyNotes[]`
- **planFlyer**：`title`、`priceText`、`membershipText`、`items[{ category, text, quantityText }]`
- **aboveeList**：`columns[]`（**只抄這九欄**：預約狀態、預約日期、預約時段、姓名、病歷號、課程、診間、服務資源、取消原因；
  照片上沒有的那一欄就不出現在 `columns`）、`rows[][]`（跟 `columns` 同順序）、`pageText`（`75筆・第1/8頁`）
- **treatmentSheet**：`title`、`headerDate`、`customerName`、`customerNumber`、`courseText`、
  `rows[{ seq, date, signed, ticked[] }]`（`ticked` 照印好的選項字寫）

每一種都有共同的兩格：`readable`（這張照片是不是這一種單子）、`unreadable[]`（哪幾格看不清楚，用人話寫）。

**domain 那一側**：`public/js/domain/transcripts.js` 匯出四種的欄位清單，給 07／09／13／14 的翻譯函式讀。
`functions/` 部署時只帶自己的資料夾，所以兩份形狀是**兩份檔案**，由測試對齊。

## 判準

- `tests/ai-transcripts.test.js`：
  - 四份 `schema` 裡，沒有任何一個 key 叫 `id` 或以 `Id` 結尾、`status`、`course`、`equipment`（`courseText` 這種帶 `Text` 的除外）
  - 沒有任何一個 key 或 description 提到身分證、生日、電話、卡號、分期
  - `functions/transcripts/` 的欄位與 `domain/transcripts.js` 的一模一樣
- 02 的「多出來的欄位丟掉」拿這份格式驗
- **這份格式有沒有任何一格，讓 AI 替她決定一段來訪算哪個課程、或一位客戶是誰？**
- 四份 `prompt` 一個真名、病歷號都沒有（例子一律用王小明、1234）
