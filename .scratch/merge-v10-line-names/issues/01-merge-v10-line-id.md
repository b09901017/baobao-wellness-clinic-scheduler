# 合併檔 v10：客戶可以帶 LINE 名字

Status: done
動工前先讀：`domain/mergeImport.js` 的 `FORMAT`／`FORMATS`、`validateFile()`、`planForCustomer()`（`customer` 那一塊寫死 `lineId: null`）、`summarize()`；
v7 的 `phone` 怎麼加的（同一個形狀）；ADR-0157（`lineId` 存的是 LINE 好友清單上看到的名字）；`ui/components/customerForm.js`（表單只去頭尾空白、沒有長度上限）；
`.claude/skills/calendar-sheet-merge/scripts/merge.mjs` 的 `importJson()`（版本是一行字面值）、`SKILL.md`「合併檔」那一節；`tests/calendar-merge.test.js`；
CLAUDE.md「舊表 B2…合併檔」「客戶的 LINE 那一格」兩列

## 她要的（2026-10-20 晚）

> 對了你可以順便幫我匯入line名稱嗎 ? 我整理好了一些人的了，大部分用三個字全名，少部分用兩個名子 … 你可以先幫我記錄起來，並且合併至合併檔

名單（有真名）只在 `.local/references/line-names.json`；對到哪一位在 `.local/references/cutover-2026-10-14/line-對照-2026-10-20.md`。

## 為什麼要改 app

`planForCustomer()` 建客戶時寫死 `lineId: null` —— 合併檔帶不了 LINE 名字。切換之後要她一位一位打（二十幾位），而那一格就是
「打開 LINE 對話」那顆丸子要的（ADR-0157，MacroDroid 照那個名字找人）。

**合併檔是契約**（CLAUDE.md）：多一格就升版。v9 只在 develop／staging，還沒上 main；照樣升 v10 —— staging 上現在的 app 收到 v10 會整份拒收（看得出來），
不升的話會安靜地把那一格丟掉。

## 做法

- `FORMAT` 升 `baobao-merge/v10`，`FORMATS` 收 v1～v9
- 客戶多一格選填的 `lineId`（字串或 null）：形狀不對整份拒收（同 v7 的 `phone`）
- `planForCustomer()`：去頭尾空白、空的是 `null`（同客戶表單那一格）。**存的是她 LINE 上看到的那個名字**（兩個字的就是兩個字），不是客戶的全名
- 摘要卡「N 位帶 LINE 名字」（同「N 位帶電話」）
- skill 那側 `merge.mjs` 的 `importJson()` 那一行升 v10（內容不變：`merge.mjs` 不產 `lineId`，切換腳本產）

## 判準

- v9 的檔案（沒有 `lineId`）匯出來每一位的 `lineId` 都是 `null`（跟以前一樣）
- v10 一位帶 `lineId: '  小明  '` → `customer.lineId === '小明'`；空字串 → `null`
- `lineId` 是數字或物件 → `validateFile()` 拒收
- 摘要卡數得到幾位帶 LINE 名字；同名跳過的那一位不算
- 匯進來的那一位，備註那一排（`noteItems()`）LINE 排第二（病歷號之後，ADR-0163）
- `tests/calendar-merge.test.js` 兩邊的版本字串一樣；寫死 v9 的測試跟著升

## 做完時留下的（2026-10-20 晚）

- 跟 issue 寫的一樣：`validateFile()` 擋不是字串的 `lineId`、`planForCustomer()` 寫 `textOf(entry.lineId)`、`summarize().lines` → 摘要卡「N 位帶 LINE 名字」。確認框沒有加（同電話）
- 寫死 v9 的六支舊測試升 v10；「認不得的版本」改拿 v11 試。新的 `tests/merge-v10-line.test.js`
- `sw.js` v200
- 產檔那側（`.local`，有真名）：名單 `line-names.json` 27 個；23 個跟客戶名字一模一樣、3 個兩個字的叫法各只對到一位（名字結尾）、1 個對不到要問她
