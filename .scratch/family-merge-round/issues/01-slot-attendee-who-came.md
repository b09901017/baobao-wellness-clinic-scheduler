# 一段來訪多一格「誰來的」：家人用被扣那一位的額度

Status: todo
Blocked by: —
動工前先讀：`spec.md`「談定的」、`.claude/rules/visits.md`、`.claude/rules/visit-editing.md`、`.claude/rules/consequences.md`（稽核的句子與欄位）、
`.claude/rules/app-env.md`（備份加欄位）、`public/js/domain/visits.js` 的 `validateVisit()` 與 `overlapWarnings()`、`firestore.rules` 來訪那一段（`d.slots is list`）

## 她要的

> 實際扣課病歷號：是扣誰的就扣誰的，可以標註。如果目前 app 不行分辨，那就幫我記成 issue

kickoff（11/9）她選「記在被扣的人身上＋寫誰來的」，其餘照建議：
> ①那一段多一格「誰來的」（自己打字，例：先生），日曆、客戶頁、讀取卡片那一段後面寫「（先生來）」；同一天太太自己也有一段、時間疊在一起時不報「重疊」。

## 為什麼會這樣

- 額度掛在客戶底下，`validateVisit()` 只拿這位客戶的額度驗 `slot.entitlementId` —— 所以「記在被扣的那一位身上」次數本來就對（8/27 她就是這樣記的），缺的只是**看得出不是她本人**。
- 8/27 那天太太自己 14:30 也有一段、先生 14:30 另一段：同一筆裡兩段時間疊在一起，`overlapWarnings()` 會報「同一筆裡重疊」（進 `MUST_SEE`）。
- 只靠「記一句」寫字：試算表、日曆、客戶頁都讀不出這是別人來的。

## 要做的

1. 一段（`slot`）多一格字串「誰來的」（欄位名自己定，例 `attendee`；空的＝本人。**不新增集合、不改額度的形狀**）。ADR 一支（記在被扣的那一位身上、為什麼不建名字卡）、`SPEC.md` 對應章節、`CONTEXT.md` 加詞（`_Avoid_` 列同義詞）。
2. 來訪編輯器那一段有地方填（**不常用：預設收著**，照 `master-data.md`／`ui-patterns.md` 收起來的欄位那一套），清掉就回到本人。
3. 顯示：日曆那一格、客戶頁的來訪列、讀取卡片那一段，後面「（先生來）」。用 `CONTEXT.md` 的詞。
4. `overlapWarnings()`：兩段的「誰來的」不一樣時不算重疊（空的＝本人也算一種）。**撞期（同診間／同治療師）照舊要講** —— 先生跟太太同時佔同一張床還是撞。
5. 牽連照 `ripple-check` 查完：`firestore.rules` 來訪的 `slots` 有沒有逐格驗（有就開洞）、備份／還原帶得到、`slotDraft.js`／改期 `rebookSlot()`／複製一段／拆開合併會不會把這一格掉了或帶錯、稽核句要不要講、`sw.js` 的 `VERSION`＋`npm run shell:snapshot`。

## 判準

- 一段寫了「誰來的：先生」，存起來讀回來還在；改期、改時間、改狀態之後還在；**`validateVisit()` 照舊拿被扣那一位的額度、次數一次不多不少**。
- 同一筆裡太太 14:30 一段、先生 14:30 一段：不報「同一筆裡重疊」；同一位本人兩段疊在一起照舊報。
- 兩段同一個診間同一時間（一段先生、一段本人）：撞期那一句照舊講嗎？
- 舊資料（沒有這一格）每一個畫面、試算表、驗證的結果一個字都不變嗎？
- 單元測試先紅後綠；E2E 至少一支走過「來訪編輯器填誰來的 → 日曆看得到」（登記進 `tests-e2e/related.js`）。

## 過目補充（2026-11-09，主控對過）

- 存得進去也帶得過去：`firestore.rules` 只驗 `slots is list`、不逐格驗；`validateVisit()` 沒有白名單；編輯器 `...slot`、`rebookSlot()`、`applyPhotoMove()` 的 `...old` 都帶過去；備份是整份文件。**但 `slotDraft.js` 的 `slotFromPicks()` 是解構白名單**（03 要把這一格加進 picks 與 `picksOf()`）。
- **撞期沒有別支接手**：`conflictWarnings()`（`other.id === visit.id` 就跳過）、日曆 `markClashes()`、資料健檢 `checkConflicts()` 都跳過同一筆。同一筆裡同診間／同治療師現在只靠 `overlapWarnings()` 在講 → 放寬之後要**另寫同一筆內「誰來的不一樣」的撞期判斷**（診間照 `roomCapacityOf()` 算人頭、治療師同一時間兩位客人）。判準第三條就是這個。
- 「（先生來）」集中在 `naming.js` 一支（像 `(體驗)` 那樣），不要三處各拼。
- `messages.js` 貼給客戶的話會把先生那段列成太太的 → **她 11/9 答：照樣列、那一段後面加「（先生）」**（例：`11/12（四） 15:00 復健門診（先生）`；括號裡印「誰來的」那一格）。
- 不在這一輪（記進 HANDOFF「中途發現／段一」段末問）：拍療程單認不得先生（`identify.js`），她換一位選太太時「誰來的」不會自動填。

## 做完時留下的

（做完寫：欄位名、畫面上在哪、ADR 號碼、牽連查到哪幾處）
