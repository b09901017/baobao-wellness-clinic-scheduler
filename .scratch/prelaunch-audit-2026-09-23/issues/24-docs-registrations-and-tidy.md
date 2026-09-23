# 文件、`related.js` 登記、審查點到的小整理

Status: todo
Blocked by: 15, 16, 17, 18, 19, 20, 21, 22, 23
來源：`../spec.md`（第二輪）；PR #129 審查的 Standards 軸
動工前先讀：CLAUDE.md「文件分工」與「容易漏掉的連動」、`tests-e2e/related.js`、`CONTEXT.md`

## 她要的

CLAUDE.md：「新長出來的連動關係要回來補進這張表 —— 不補的話它的價值會隨每一輪重構衰減」。

## 要做的

**文件**

- SPEC §4.8 補 06 的分頁命名規則（同名才加尾巴、先用病歷號、其次 id 前幾碼、每次推都一樣）
- `domain/sheetReport.js:291-303`：`sheetNames()` 插在 `syncBundle()` 的 JSDoc 和函式本體中間，兩段 docblock 疊在一起 —— 挪開；
  `ponytail:` 這個標記全 repo 只有這一次，改成一般註解
- issue 03、04、05、07、12 補「做了什麼」（其餘幾支都有）
- 連動表：15（種子也走 `newRegistrations()`）、16（改名換「還掛著沒做完的事」的來訪）、17（刪客戶也擋隨手記）、
  21（一列任務講它掛的那幾段）、23（療程單讀本人、表單邀請刻意不換）各自那一列確認已經補過
- `SPEC.md` 裡 08／09 那兩節跟著 16、17 改
- `customerDetail.js` 刪不掉時的那一句「那幾段在 Abovee 上還佔著」：CONTEXT.md「壓表」那一條把「佔位」列為 _Avoid_ —— 照 CONTEXT 的詞改

**`tests-e2e/related.js` 補登記**

- `46-customer-rename-and-delete` ← `public/js/ui/nav.js`、`public/js/ui/views/bulkCancel.js`（D3 走 `whenSettled()`、`openFor()`）
- `34-confirm-one-slot` ← `public/js/domain/consequences.js`
- `25-visit-editor-one-slot` ← `public/js/domain/taskRules.js`
- 這一輪新改到的檔案對應的 spec 一起補

**小整理（判斷題，順手）**

- `seenTasks()` 讓 `followups.js` ↔ `taskRules.js` 循環 import：搬到不會循環的地方（例如一支只放任務比對的小模組）
- `['pending_confirm', 'confirmed']` 在 `domain/visits.js` 的 `rebookSlot()` 與 `domain/customers.js` 的 `deleteBlockers()` 各寫一次 —— `acceptsMoreSlots()` 已經替這一組取了名字
- `data/customers.js` 的 `updateWithSnapshots()`：註解寫 250、程式碼用 240，對齊
- `cancelSlotsOf()` 現在也拿來算掛號類 —— 改名（例如 `slotsOfTask()`）或檔頭講清楚兩種都用

**測試**

- **`rebookSlot()` 回來的那一筆，整筆 `status` ＝ `visitStatusFrom()`**：一天一段已確認、一段待確認、兩段改第二段、已確認＋已取消四種都釘住。
  而且註解寫清楚**不要改走 `applyStatus()`**（一天只有一段時整筆會先被推成已取消，新那一段跟著死掉，2026-09-23 實跑過）
- E2E 33 的 T1、T2 這一輪被改成「記一句再存」—— 補一條「清掉的待辦 → 改時間（改期）→ 新那一段確認 → 清掉的那兩張不重長、新的那一段長新的」

## 判準

- `npm test` 綠；`tests/e2e-related.test.js` 綠
- `rg "ponytail" public/js` 沒有結果
- 連動表每一條這一輪動到的規則都找得到
