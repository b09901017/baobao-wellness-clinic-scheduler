# 合併出來的時間進不了 app：匯入頁只吃試算表，不吃行事曆

Status: todo
回報者：使用者，2026-08-19
動工前先讀：`.claude/skills/calendar-sheet-merge/SKILL.md` 與它的兩份 references、
`docs/adr/0011-imported-visits-are-incomplete-on-purpose.md`、
`docs/adr/0012-legacy-import-is-a-paste-not-an-integration.md`、`SPEC.md` 第 6.10 節

## 症狀

`calendar-sheet-merge` 這支 skill 已經可以把 TimeTree 的 `.ics` 跟舊試算表對起來，
實測 107 個時段裡有 93 個補得到時間（86 高信心 ＋ 7 要她確認），
順便補到 33 個診間與 24 個器材。

但那些東西**進不了 app**。匯入頁（`ui/views/legacyImport.js`）吃的是貼上的試算表文字，
`domain/legacyImport.js` 產生的時段一律 `startsAt: null`。合併結果現在只能停在報告上。

## 想要的樣子

1. `domain/icsImport.js`：`.ics` → 事件；比對規則從 skill 的 `scripts/merge.mjs` 搬過來，
   **要有測試**（那支腳本沒有）。三個護欄一個都不能少，理由見
   `references/findings.md` 的「比對規則上踩過的坑」。
2. `planForSheet()` 多吃一個選填的行事曆索引，對得上就把時段的 `startsAt` / `roomId` /
   `equipmentId` / `therapistId` 填起來，對不上照舊 `null`。
3. 匯入頁多一個選檔案的入口（`.ics` 有四千多行，在 iPad 上貼上是災難），
   比對報告上一段一段列出補到什麼、哪幾筆要她確認。
4. 別名表要有地方存 —— 目前在 `.local/aliases.json`，容器一收就沒了。

## 為什麼要在匯入的同一次寫入就填

匯進來的來訪一律是 `done`，落在唯讀鎖定區（`SPEC.md` 第 6.4 節）。匯完再補時間的話，
每補一筆都要走更正流程填理由 —— 九十幾筆這樣走不切實際。

## 不要順手做的事

- **不要推翻 ADR-0011。** 對不上的時段照樣留 `null`、照樣顯示「時間不詳」。
  多了一份知道時間的資料，不等於可以編一個時間出來。
- **不要自動採用低信心的配對。** 那幾筆長得跟高信心的一模一樣，錯了她看不出來。
- **不要在 app 裡重寫一份比對規則。** 搬過去之後 skill 的腳本改成引用 domain，
  同一件事只能有一份實作（`CLAUDE.md`）。
