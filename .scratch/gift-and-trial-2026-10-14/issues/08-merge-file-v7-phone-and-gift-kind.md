# 合併檔 v7：客戶帶電話、每一段帶送的／體驗

Status: done
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

## 做完時留下的

- **契約**：兩側都寫 `baobao-merge/v7`，app 收 v1～v7。`validateFile()`：`phone` 不是字串（或 null）、`giftKind` 不是 trial／gift（或 null）→ 整份拒收。
  釘著 v6 的三支測試（`merge-chart-numbers`、`merge-functional-clinic`、`merge-staff-roster`）改成 v7
- **app 那一側**（`mergeImport.js`）：`planForCustomer()` 的客戶 `phone` 照檔案（去頭尾空白；空字串＝null）。時段：`giftKind` 有值 → 不扣
  （**檔案上就算寫了 `entitlementKey` 也不扣**，跟 01「就算身上有額度也不扣」同一句）、`canBeGift()` 是 false → 那一段不匯、problem 寫「健檢沒有體驗／送的（要加約走 n返）」；
  沒有 `giftKind`、沒有鑰匙、課程不算次數（v5、v6）→ 照舊放行、**寫實成 `trial`**；扣額度的段寫 `giftKind: null`（每一段都寫實，同 `save()`）。
  `addExtraVisits()` 不扣的那一段寫 `trial`、其餘 null。`slotsMissingEntitlement()` 改問 `giftKindOf()`（一段體驗的復能沒有額度是對的）。
  `summarize()` 多 `phones`，摘要卡多一行「N 位帶電話」
- **產檔那一側**（`merge.mjs`）：`applyPhones()`（`--phones`，在 `applyChartNumbers()` 之後跑）：先照病歷號、對不到比名字；只比數字去重、留第一個寫法；
  不只一支、或照名字對而舊表上同名兩位 → 不寫、進 `p.problems`（`where: '電話'`，⓪b，決定頁照舊是 `sheet` 那一種的一項 —— **沒有另外開一種**：
  ⓪b 本來就逐條變成一項，項數測試照樣對）。報告多一行「電話名單：寫了／名單上沒有／不只一支沒寫」。**沒帶 `--phones` 時連 `phone` 這個鍵都沒有**。
  決定頁上那一項只有「照這樣就好」：**決定檔沒有「電話選哪一支」那一格**（她匯完到客戶詳情填）—— 真檔 0 位不只一支，沒做
- 決定檔「加一段」多 `free: '體驗'|'送的'`：任何課、不扣（不找額度）；看不懂的字、健檢、二返 → 進 ⓪d、不加。
  合併檔的段：她決定的 `giftKind`，或沒有鑰匙的不算次數的課 → `trial`；**一般的段沒有這個鍵**（真檔比對才會只差 `format` 一行）
- `endOf()`：送的／體驗的段直接叫 app 的 `slotMinutes()`（`durationChoices` 裡的才算數，IN 30 體驗＋30 → 30、寫 45 → 照課程）；其餘照舊
- 電話名單：新的 `scripts/phones.mjs`（擷取結果的 `rows[]` → `{ 病歷號或名字: 電話|[電話…] }`，只准寫進 `.local/`，只印數字）。
  她那一份建好了：`.local/references/phones.json`（5～10 月 353 列 → 48 位、不只一支 0 位）。**新的 Abovee 截圖擷取完要重建一次**
- **真檔**（`baseline.mjs gt-08 --vs gt-05`）：只差 `importSha` —— 拆開看是 `format` 那一行，**時段一格都沒變**（她的決定裡沒有沒額度的段）。
  帶 `--chart-numbers --phones`（`gt-08-phones`）：32 位裡 **28 位有電話、4 位名單上沒有、0 位不只一支**；跟只帶病歷號的那一次比，只差 `phone` 那一格。
  `baseline.mjs` 多 `--phones`
- **app 那一側的判準**（v6 的切換檔 `import-2026-10-14.json`，改之前／改之後的 `mergeImport.js` 各匯一次、主檔用現在的種子）：314 段、0 個問題兩邊一樣，
  拿掉 `giftKind` 之後逐位元一樣；`giftKind` 寫實成 trial 的 1 段（功醫門診），其餘 313 段 null
- SKILL.md：`--phones`、`phones.mjs`、決定檔的 `free`、格式那一段（v7、`phone`、`giftKind`）。`docs/STAGING.md` 切換那天的第 0 步（灰字 v7）與第 6 步（帶 `--phones`）
- 新測試：`tests/merge-v7-phone-and-gift.test.js`（26 條：兩側、判準每一條、`phoneList()`）；E2E `67` 的 G10（貼一份 v7 → 摘要卡 → 匯入 → 電話、體驗不扣），
  `related.js` 把 `mergeImport.js`（兩支）、`data/legacyImport.js` 登記給 `67`
- 相關 E2E（`--related --base 58056ae`，6 支、48 條，無頭）：47 過、1 跳過（`61` 的 H1：Windows 上模擬器不回 headers，本來就跳過）
