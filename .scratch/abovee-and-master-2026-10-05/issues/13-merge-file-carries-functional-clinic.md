# 合併檔：她的客人過去的功醫門診（行事曆寫 HRV 那幾次）要進得來

Status: todo
來源：`../spec.md` 第四題、第一段 f
動工前先讀：`.claude/skills/calendar-sheet-merge/SKILL.md`、`scripts/merge.mjs` 的 `TOKENS`（第 54–80 行）／`SAME`／`coursesOf()`／`endOf()`／合併檔輸出那一段（第 1029 行起）、
`answers.md`、`shorthand.md`（skill 底下）、`public/js/domain/mergeImport.js` 的 `FORMATS`、第 240–280 行（每一段要對到額度那一條）、
`tests/calendar-merge.test.js`（兩邊版本字串一樣）、ADR-0029、0047、0093、0117、
`.local/references/abovee-m5-m10/三方比對/資料/README.md`（HRV 那 7 句怎麼對到功醫門診的）、記憶 `three-way-compare-2026-10-02`
Blocked by: 05、12（不算次數的課與功醫門診那一門課要先存在）

## 她要的

> - HRV 是自律神經檢查，通常直接接門診讓醫師講解報告。它自己不是一段課程，後面那一場門診才是

> 4. 你的客人那幾次要（行事曆才對），體驗客人不要

## 為什麼會這樣

- `merge.mjs` 的 `TOKENS` 把 `HRV` 認成**心臟科評估**（第 71 行）—— 10/5 她答了 HRV 之後一直沒改（記憶 `three-way-compare-2026-10-02` 記著「要改、還沒改」）
- 同一張表把 `功能醫學` 認成**二返**（第 65 行、`SAME` 第 86 行）—— 那是照 `CONTEXT.md`「二返正式名稱為功能醫學門診」寫的，而她 10/5 說功醫門診跟二返不同
- app 那一側（`mergeImport.js` 第 257 行）**每一段都要對到一筆額度**，對不到的整段不匯（「這個時段對不到任何一筆額度，沒有匯入」）—— 功醫門診沒有額度
- 三方比對查到的：行事曆 7 句 HRV 在 Abovee 上都對到同一位、同一天、**晚 30 分**的「功醫門診」，Abovee 一筆叫 HRV 的都沒有
- 體驗客人沒有舊表分頁，合併檔本來就不會建他們 —— 「不要」那一半不用做事，只要確認

## 談定的做法

1. **`merge.mjs`**：`HRV` → **功醫門診**，開始時間是那一句的時間**＋30 分**（7 句在 Abovee 上都是晚 30 分；她說時間以 Abovee 為準）；
   這一條寫進 `answers.md`／`shorthand.md`。`功能醫學` 那一條：先拿她的行事曆與舊表數一次（`.local/`，只印次數不印名字）——
   全部都是二返就留著並在註解講清楚；有任何一句其實是功醫門診 → **停下來問她**，不猜
2. **合併檔的契約**：不算次數的課那一段**沒有 `entitlementKey`**。升 `baobao-merge/v5`；`mergeImport.js` 的 `FORMATS` 收 v4 與 v5（舊版 app 不可以安靜吃掉）；
   `tests/calendar-merge.test.js` 兩邊的版本字串一起改
3. **`mergeImport.js`**：一段沒有 `entitlementKey`、而且課程在她的主檔上是不算次數的 → 照樣匯進來（`entitlementId: null`）；
   不是不算次數的 → 照舊不匯、照舊列進問題。狀態照 `statusFor()`（ADR-0029）、不長任務（ADR-0093）
4. **決定頁**（`--board`）：多出來的那幾段要看得到（照現在的形狀，不另開一種題目）；之前決定檔裡跟 HRV 有關的決定（如果有）要對得上 —— 對不到的要進報告 ⓪d（`CLAUDE.md` 連動表「舊表 B2」那一列）
5. 跑一次她的合併（`.local/`），只看數字：多了幾段功醫門診、心臟科評估少了幾段

## 牽連

- **app 的匯入頁**（`ui/views/mergeImport.js`）預覽的數字與問題清單要跟著對
- **skill 的 `--decisions` 決定檔**（她那一份有真名，在 `.local/`）：格式不變；改 TOKENS 會讓某些題目的鑰匙變嗎？查清楚
- **三方比對的程式**（`.local/`，不在 repo）：它本來就不把 HRV 當課程，不用改
- **CONTEXT.md**「二返」那一條（14 改）
- 這一支同時改 skill 與 app：`CLAUDE.md` 連動表「舊表 B2、合併檔的購買欄位」那一列講的「改欄位就升版」照做

## 判準

- 行事曆一句「2.30 HRV」（假名）、那一位有舊表分頁：合併檔裡那一天有一段功醫門診 15:00、沒有 `entitlementKey`；app 匯進來是那一段、**次數一格都沒動**？
- 同一句以前產出來的心臟科評估那一段不見了？
- v4 的合併檔照樣貼得進去？v5 的貼進只認得 v4 的版本會被拒絕而不是安靜吃掉（看 `FORMATS` 的測試）？
- 一段沒有 `entitlementKey`、課程是要額度的：照舊不匯、列在問題裡？
- 體驗客人那幾句：合併檔裡沒有他們？
