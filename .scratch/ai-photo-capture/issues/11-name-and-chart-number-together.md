# 認人：人名＋病歷號交叉比對

Status: done
來源：`../spec.md`（13、14 共用）
動工前先讀：`CONTEXT.md:75`（病歷號）、`docs/adr/0050`、`domain/legacyImport.js:1358` 的 `CHART_NO_PREFIX`、
`domain/health.js` 的 `checkChartNo`、`domain/customerMarks.js`

## 她要的（原話）

> f 病歷號可以拿來認 Abovee 上的人嗎 ? 可以拿來交叉比對，人名和病歷號

## 為什麼會這樣

`CONTEXT.md:75` 明寫病歷號「**只顯示，不參與任何計算** —— 系統從來不拿它比對、查詢或排序，它只是她認人的另一個線索」。
它存在客戶的**備註**裡（一則 `病歷號 1234` 的彩色小丸，`CHART_NO_PREFIX`），不是一個欄位。

Abovee 列表上是 `00001234`（補零到八位），療程單上的「客戶編號」是同一個號碼。
只用人名認的話：同名的兩位分不開、手寫與打字有落差；只用號碼的話：有的客戶身上沒有那則備註。

**這一支推翻 CONTEXT 那一句** → 補一支 ADR（號碼動工時取），**不改 ADR-0050**。

## 要做什麼

- `domain/identify.js`（純函式）：`identifyCustomer({ name, chartNo }, customers)` →
  `{ customer, how, candidates }`，`how` 是：

  | `how` | 條件 | 畫面上 |
  |---|---|---|
  | `both` | 名字與病歷號都對上同一位 | 認得 |
  | `numberOnly` | 病歷號對上、名字不一樣 | **對不上，請你選**（可能改過名或字打錯） |
  | `nameOnly` | 名字對上、那位身上沒有病歷號 | 認得，但標一個小記號 |
  | `conflict` | 名字對上 A、病歷號對上 B | **對不上，請你選** |
  | `ambiguous` | 同名好幾位、沒有病歷號分得開 | **請你選** |
  | `none` | 都沒有 | app 裡沒有這位 |

- 病歷號比對前去掉前面的 0、去掉空白；名字去掉空白、全形半形一致
- 已刪除、已停用的客戶不參與
- 病歷號從備註讀（`CHART_NO_PREFIX`），**不另開欄位**
- `CONTEXT.md` 病歷號那一條改寫成：「參與認人（照片帶入時跟名字交叉比對），不參與次數、排序、查詢」，指到新 ADR

## 判準

- `tests/identify.test.js` 六種 `how` 各一條，另外：
  - `00001234` 對上備註 `病歷號 1234`
  - 名字前後有空白、全形空白 → 照樣對上
  - 兩位同名、只有一位有病歷號、照片上的病歷號是另一個 → `conflict` 不是 `nameOnly`
- **這一支有沒有任何一條路，在 `numberOnly`、`conflict`、`ambiguous` 時自動挑一位？**（不應該有）
- `CONTEXT.md` 裡沒有一句還說病歷號「不參與任何計算」
