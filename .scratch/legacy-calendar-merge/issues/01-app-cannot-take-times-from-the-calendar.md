# 合併出來的時間進不了 app：匯入頁只吃試算表，不吃行事曆

Status: done
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

使用者指定的分工（2026-08-19）：**比對與判斷在對話裡做完，app 只負責吃結果。**

> 我給你 ics+xlsx，你向我確認一些事，我回答完，你確定都理解完後，給我一份 json 檔，
> 讓我可以貼入 app，所以 app 要有的功能是解析你 skill 給我的 json 並寫入 app 的能力

所以 app 這一側**不解析 `.ics`、不做比對**，只做四件事：驗證、對照主檔、給她看、寫進去。
`.ics` 的解析與比對留在 skill 裡（`scripts/merge.mjs`），那裡改一次就好。

1. `domain/mergeImport.js`（純函式，要有測試）
   - 驗證 `format: 'baobao-merge/v1'` 與必填欄位，壞掉的檔要講清楚壞在哪一段
   - 把檔案裡的**名字**對到她自己主檔的 **id**（課程、器材、診間、治療師、營養點滴品項）。
     對不到就進 problems，**不要猜** —— 同一個判準見 `domain/legacyImport.js` 的 `resolveCourse()`
   - 產出跟 `planForSheet()` 一樣形狀的計畫，這樣 `data/legacyImport.js` 的 `importPlan()`
     可以原封不動拿來寫（一位客戶一個 commit、有稽核、不產生任務）
2. 匯入頁多一段「貼上合併檔」：貼上 → 摘要與問題 → 確認 → 寫入。
   低信心的時段要標出來（JSON 裡有 `confidence` 與 `evidence`）。
3. 三份候選清單（未來的預約、行事曆有試算表沒勾、對不到客戶的個人行程）
   一律**預設不勾**，她一筆一筆勾要匯的。個人行程寫進 `events`，不是 `visits`。

格式的完整定義在 `.claude/skills/calendar-sheet-merge/SKILL.md` 的「合併檔」一節。
**改欄位就是改契約，兩邊要一起改。**

## 為什麼要在匯入的同一次寫入就填

匯進來的來訪一律是 `done`，落在唯讀鎖定區（`SPEC.md` 第 6.4 節）。匯完再補時間的話，
每補一筆都要走更正流程填理由 —— 九十幾筆這樣走不切實際。

## 不要順手做的事

- **不要推翻 ADR-0011。** 對不上的時段照樣留 `null`、照樣顯示「時間不詳」。
  多了一份知道時間的資料，不等於可以編一個時間出來。
- **不要自動採用低信心的配對。** 那幾筆長得跟高信心的一模一樣，錯了她看不出來。
- **不要在 app 裡重寫一份比對規則。** 搬過去之後 skill 的腳本改成引用 domain，
  同一件事只能有一份實作（`CLAUDE.md`）。

## Comments

**2026-08-19 — 這一支其實在 PR #16 就做完了**（`domain/mergeImport.js`、
`ui/views/mergeImport.js`、`tests/merge-import.test.js`），只是狀態忘了改。補上。

後續：合併檔補進去時卡住的那 15 筆是另一個問題（客戶身上沒有二返額度），
處理在 `.scratch/followup-visit/issues/01` 與 GitHub issue #15。
