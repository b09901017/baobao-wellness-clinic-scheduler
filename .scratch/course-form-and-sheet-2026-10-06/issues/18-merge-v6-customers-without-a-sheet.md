# 合併檔 v6：帶得進沒有舊表分頁的人（HRV 那 7 次）

Status: todo
來源：11 第四節拆出來的（她：「11 第四節要升合併檔 baobao-merge/v6（帶得進沒有舊表分頁的人），太大就拆成自己的一段，先跟我說」）
動工前先讀：`issues/11` 第四節與第四節之一（原本的規劃、當時的分析）、上一輪 `.scratch/abovee-and-master-2026-10-05/issues/13` 最下面「拿她的真檔跑過」、
`.claude/skills/calendar-sheet-merge/SKILL.md`（第 4b、5 步、合併檔那一節）、`merge.mjs`（`TOKENS` 的 `/功醫|HRV/i`、`startOf()`、`importJson()`）、
`board.mjs`／`board-page.mjs`／`record.mjs`、`public/js/domain/mergeImport.js`（`FORMATS`、`validateFile()`、`planForCustomer()`、`slotsMissingEntitlement()`）、
`public/js/ui/views/mergeImport.js`、`public/js/data/legacyImport.js` 的 `importPlan()`、ADR-0029、0047、0117、0121、
`CLAUDE.md` 連動表「舊表 B2『購買名稱』、合併檔的購買欄位」那一列
Blocked by: 11（做完了）
**自己一段**：不跟別的 issue 一起出。動到契約（升 v6）、決定頁多一種題目、app 匯入那一側要能建「沒有任何額度的客戶」

## 她要的

問她「那 7 次 HRV 怎麼補？」（三條路），她 2026-10-06 回：

> (b) 改合併檔，讓它帶得進沒有舊表的人。

更早（問題 6）：

> 目前先皆不用壓，不用指派診間或人員，過去行事曆記錄過 HRV 的那 7 次幫我補齊

## 為什麼現在帶不進來

合併檔是**照舊表分頁建客戶**的。行事曆上 9 句 HRV：7 句純 HRV（Abovee 上都對到同一天、晚 30 分的功醫門診）、2 句還寫了 ABI。
那 7 句的人**都沒有舊表分頁**（上一輪拿真檔查過），所以對不到客戶 → 落在 ⑥「對不到客戶的」，而且今天以前的雜事不寫進檔案。

## 11 量過、要先想清楚的

1. **名字從哪裡來**：行事曆那一句只有她的叫法。對得到 Abovee 那 353 筆的話用那邊的全名與病歷號（`.local/references/abovee-m5-m10/擷取/`，**只能留在 `.local/`**）；
   對不到的要她在決定頁確認。**這一步要問她**：她的叫法 → Abovee 上哪一位，是程式猜一個給她點，還是她自己打
2. **範圍**：只收她點名的那 7 次（範圍越小越不會帶進雜事）。走決定檔：她在決定頁上說「這一位要建、這幾句是他的」，不是自動認
3. **一句產兩段**：HRV 在那一句的時間、功醫門診晚 30 分，兩段都沒有 `entitlementKey`。03 之後主檔有 HRV 這門課了，
   `TOKENS` 的 `HRV` → 功醫門診那一條要跟著改成「產兩段」。**同時寫了 ABI 的那 2 句照舊**（`tests/merge-functional-clinic.test.js` 釘著）
4. **契約**：`baobao-merge/v6`，`customers[]` 多一種「沒有舊表分頁」（例：`noSheet: true`、`entitlements: []`）。`FORMATS` 收 v1～v6；
   **v5 的 app 讀到 v6 要整份拒收**（它的 `FORMATS` 本來就不收 —— 寫一條測試釘住「不認得的版本是整份拒收、不是安靜地吃掉那一塊」）
5. **app 那一側**：匯入頁畫得出「這一位是新客戶、沒有舊表分頁」，勾得掉；`planForCustomer()` 沒有額度的客戶照樣組得出來；
   `importPlan()` 建一位沒有任何額度的客戶 ＋ 那幾段（不算次數，`slotsMissingEntitlement()` 放行）；主檔沒有 HRV 的 app：那一段跳過、記一行問題 ——
   那一句現在寫「對不到任何一筆額度」，真正的原因是主檔沒有這門課，要改
6. **決定頁多一種**：`board.mjs` 一種新的項目（`tests/merge-board.test.js` 盯著項數＝報告上印的數字），`record.mjs` 寫得進決定檔
7. 寫進資料健檢會不會報（沒有額度的客戶、功醫門診的段）—— 動工前在模擬器上走一次

## 判準

- 沒有決定的時候：合併檔跟 v5 那一份**除了版本字串**一個位元都不變
- 她在決定頁上點了「這一位要建」的那幾句：檔案裡一位客戶、每一句兩段（HRV、功醫門診晚 30 分），兩段都不指額度
- 同時寫了 ABI 的那兩句照舊（心臟科評估）
- **這一行會不會讓決定檔裡的某一個決定安靜失效？**（⓪d 的條數跟基準一樣，或多出來的每一條都講得出原因）
- v5 的 app 拿到 v6 的檔案：整份拒收、講得出為什麼
- 終端機與任何被追蹤的檔案裡一個真名、一個病歷號都沒有；拿她的真檔照基準比一次（只印數字）

## 連動

- 新 ADR（推翻 ADR-0047「舊資料只有合併檔一條路、照分頁建客戶」那一句的話要寫；沒推翻就只補 SKILL.md）
- `SKILL.md` 合併檔那一節（v6 的形狀）、`references/answers.md`、`CLAUDE.md`「舊表 B2」那一列
- `tests/calendar-merge.test.js`（兩邊的版本字串一樣）、E2E `09`（v6 的檔案真的寫一次）
- `public/sw.js` 的 VERSION
