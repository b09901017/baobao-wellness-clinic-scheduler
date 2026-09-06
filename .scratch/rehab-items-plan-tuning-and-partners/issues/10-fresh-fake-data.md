# 假資料現代化，順手修一條靜默失效的規則

Status: 已完成
Blocked by: 04, 07

## 她說的

> 我希望測試辦的資料可以更新 不要有abovee 打電話那種舊資料 以及帶健保卡那種小事
> 我希望 就沒有，然後我希望更新測試的資料然後可以取名叫客戶A B C 等等

## 現在 `scripts/seed-staging.mjs` 長出來的東西

| 現在 | 問題 |
|---|---|
| 王小明、李小華…（`SURNAMES × GIVEN`） | 她要「客戶A B C」 |
| `kind: 'Abovee'` 的任務 | **`todoFlow.js` 的 `RETIRED_KINDS` 裡的東西** —— 2026-08-23 就不再產生了 |
| 隨手記「下次來提醒他帶健保卡」 | 她明講不要 |
| 每一位都只有一種來訪（復能・INDIBA） | 點不出這一輪任何一個新東西 |
| `rules: [{ kind: 'weekday', … allowed: false }]` | **不在 `RULE_KINDS` 裡** —— 見下 |

## 那條靜默失效的規則

`domain/availability.js` 的 `RULE_KINDS` 只有
`exclude_weekday` / `exclude_date` / `exclude_range` / `prefer`，
而 `blocks()` 是逐個 `kind` 比對的。種子寫的 `kind: 'weekday'` 四個分支一個都
對不上，所以 staging 上每一位假客戶的「星期三下午不行」**一天都沒有真的擋掉**。

畫面上完全看不出來：可用性那一頁照樣印出「星期三下午不行」（那是 `rawText`），
壓表卡片牆上也照樣有那顆丸子（那是 `describeRule()` 畫的）。
只有「可用日」算出來的答案是錯的 —— 而那個數字沒有人會去核對。

改成 `{ kind: 'exclude_weekday', weekday: 3, partOfDay: 'pm' }`。

**順手加一條測試**，不然它會再壞一次：種子產出的每一條規則的 `kind`
都要在 `RULE_KINDS` 裡。

## 新的假資料要長什麼樣

名字：`客戶A` … `客戶T`（二十位，`String.fromCharCode` 接 A–T）。
`tests/no-secrets.test.js` 已經在盯真名，這一步讓它更好盯。

需要跟名字的字數有關的規則時仍然用「王小明」（CLAUDE.md），
但那是**測試裡**的事，種子不需要。

每一位身上要湊得出這一輪的每一種東西：

| 要點得到的 | 怎麼種 |
|---|---|
| 復能三選一(60) | 方案展開就有（`04` 改過種子的方案項目名） |
| 復能四選一(30) | 幾位加購一筆四選一 |
| 單台（超磁場(60)、INDIBA(30)） | 幾位各加購一筆 |
| ILIB(60) | 方案展開就有 |
| 微調過的方案 | 幾位的 `sourcePlanQty` 跟 `totalQty` 不一樣（`06` 那一頁才看得到東西） |
| 自然美 | 大約四分之一的人掛 `partners: ['自然美']` |
| 警示 | 幾位掛「體內金屬」、幾位掛「血管難打」（`02` 的兩種樣式各看得到一個） |
| 掛自然美的備忘錄 | 種一份，`08` 才點得出東西 |
| 帶 ILIB 的四選一時段 | 幾筆來訪的時段 `courseId: course-iv-laser` + `equipmentId: eq-ilib`，扣四選一那筆額度 |

任務**不要自己編**：走 `domain/taskRules.js` 的 `tasksForVisit()` 產生。
自己寫死一個 `kind` 就是這一次要修的那個 bug 的成因 —— 種子跟規則各寫一次，
規則改了種子不會跟。

隨手記換成她真的會寫的那種：「這次想指定騰崴」「下次要問他要不要續約」。

## 不做的

- **不動 `tests-e2e/fixtures/data.js`。** 那一份已經是「客戶A/B/C」而且
  已經直接借 `domain/seed.js` 的主檔（它的檔頭就寫著為什麼），乾淨的。
  這一輪只有它引用的種子內容跟著 `04`／`07` 變。
- **不做匿名化。** `seed-staging.mjs` 的檔頭已經寫過為什麼是合成不是匿名化。
- **不碰正式專案的守衛。** 那一段（拒絕跑在 prod、別名表）一個字都不改。

## 測試

- `tests/domain.test.js` 或新的 `tests/seed-staging.test.js`：
  - 產出的每一條可用性規則的 `kind` 都在 `RULE_KINDS` 裡
  - 產出的每一種任務的 `kind` 都不在 `RETIRED_KINDS` 裡
  - 每一位客戶的名字都符合 `客戶[A-Z]`
- 跑一次：`FIRESTORE_EMULATOR_HOST=… node scripts/seed-staging.mjs --project demo-scheduler --yes`，
  然後開資料健檢 —— **一打開不可以滿江紅**（那一支檔頭寫著為什麼這件事重要）。
