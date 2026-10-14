# 合併檔 v7：客戶帶電話、每一段帶送的／體驗

Status: todo
Blocked by: 01、05、07（真檔基準照 07 → 05 → 08 的順序比）
動工前先讀：`spec.md`「合併檔 v7」；CLAUDE.md「舊表 B2『購買名稱』、合併檔的購買欄位」那一列（**合併檔是契約**那一段）；
`.claude/skills/calendar-sheet-merge/SKILL.md`（`--chart-numbers`、`--staff-names` 兩段是這一支的樣板；格式說明；決定檔格式）；
`domain/mergeImport.js` 的 `FORMAT`／`FORMATS`、`validateFile()`、`planForCustomer()`（客戶那一份 `phone: null`、時段那一段 `free`）、`addExtraVisits()`（:578 那一個 `free`）、`slotsMissingEntitlement()`；
`data/legacyImport.js` 的 `importPlan()`（匯入不走 `save()`，01 的「存檔時寫實」接不到這條路）；
`merge.mjs` 的 `applyChartNumbers()`、`applySlotDecisions()`（「加一段」）、`endOf()`、候選（`futureVisits`、`missingFromSheet`）

## 她要的

> 我先還沒匯，等全部調整修正優化完後我在匯，像是能夠讀取電話號碼

切換那天的交付清單上寫著「沒有進 app：……客人的電話（合併檔沒有這一格）」，她這句就是回那一條。

## 為什麼會這樣

- 合併檔的客戶那一份沒有電話（`mergeImport.js` 寫死 `phone: null`）。**舊表沒有電話**（`docs/legacy/` 的樣本只有名字與病歷號）；
  電話在 Abovee 截圖上（她的擷取結果 10 月 151 列有 147 列有電話）。
- v5 起不算次數的課那一段沒有 `entitlementKey`，app 那側靠「她的主檔勾了不算次數」推導放行 —— 01 之後那一段要帶 `giftKind`，
  而**任何課**的體驗（切換那天的四段）也要匯得進來，推導接不住。

## 要做的

### 契約（升 `baobao-merge/v7`）

- `customers[].phone`：字串或 null（選填）
- `visits[].slots[].giftKind`：`'trial'`／`'gift'`／null（選填）
- **候選（補的那幾段）不帶這一格**：`addExtraVisits()` 那一條照舊推導（沒有額度、課程勾了不算次數 → 寫 `giftKind: 'trial'`）—— 行事曆上的雜事分不出體驗
- 形狀不對（`phone` 不是字串、`giftKind` 不是那三個值）→ `validateFile()` 整份拒收，同 `staff`
- `FORMATS` 收 v1～v7；`tests/calendar-merge.test.js` 盯著兩邊版本字串一樣；SKILL.md 的格式說明補兩格

### 產檔那側（`merge.mjs`）

1. `--phones <檔>`（選填，**有真名與電話、只放 `.local/`**）：`{ "<病歷號或名字>": "<電話>" }`。先照病歷號對（舊表的、`--chart-numbers` 補上的），對不到再比名字（`renames` 之後）。
   同一位對到兩支不一樣的 → 不寫、進報告（⓪b 那一段的做法；`board.mjs` 跟著多一種，`tests/merge-board.test.js` 盯著項數）。
   **沒帶這個參數時合併檔除了 `format` 那一行一個位元都不變**（同 `--staff-names`，有測試釘著）
2. 不算次數的課那一段（`isUncounted(seedCourse(…))`、沒有額度的）寫 `giftKind: 'trial'`
3. 決定檔「加一段」（`applySlotDecisions()` 的 `add`）可以帶 `free: '體驗'|'送的'` → `entitlementKey: null`、`giftKind` 照寫，**任何課**；健檢、二返擋下來進 ⓪d
4. `endOf()` 跟 01 的 `slotMinutes()` 同一個順序（送的／體驗的段認 `durationChoices`）
5. 電話名單從哪裡來寫進 SKILL.md：她的 Abovee 擷取結果（`pixel-exact-screenshot-extraction` 產的 JSON 有 `phone` 那一格），建一份 `.local/references/phones.json`

### app 那側（`mergeImport.js`）

6. 客戶那一份 `phone: entry.phone ?? null`
7. 時段：`giftKind` 有值 → 不要 `entitlementKey`、寫進那一段；`canBeGift()` 是 false → problem（不匯那一段）。
   沒有 `giftKind`、沒有 `entitlementKey`、課程勾了不算次數（v5、v6 的檔）→ 照舊放行、**寫 `giftKind: 'trial'`**（跟 01 的退路同一個答案；匯入不走 `save()`，不寫就永遠是推導的）
8. `addExtraVisits()` 與 `slotsMissingEntitlement()` 一起認得 —— **三個地方少一個就是整位匯不進去，或一段扣不到額度的課安靜地寫進去**
9. 匯入頁的摘要卡：多一行「N 位帶電話」（只數字）

## 判準

- v6 的檔（切換那天那一份）在**主檔沒改**的情況下用改完的 app 匯：結果跟改之前一模一樣，只多了功醫門診那幾段的 `giftKind: 'trial'`
  （05 之後主檔多兩門不算次數 → 沒有額度的心臟科評估那幾段變成匯得進去，那是預期的差別）
- v7 的檔：帶電話的那幾位客戶詳情看得到電話；一段 IN 30 `giftKind: 'trial'` 匯進去是體驗、那位客戶的復能額度剩的不變、`endsAt` 30 分後
- 一段健檢帶 `giftKind`：那一段不匯、problem 講得出為什麼
- `giftKind: 'free'`（不合法）：整份拒收
- `--phones` 名單上同一個病歷號兩支電話：那一位沒有電話、報告列一項、決定頁多一項
- 沒帶 `--phones`：合併檔除了 `format` 一個位元都不變
- 她的真檔產一次（`.local`，只印數字）：幾位帶電話、幾位對不到、幾位兩支不一樣；跟 05 之後那一次基準比
