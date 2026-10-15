# 抄字提示詞列出六種預約狀態、重考、部署 staging 的 Function

Status: todo
Blocked by: —（可以跟 01 同時做；09 前要做完）
動工前先讀：ADR-0099（AI 只抄字）、ADR-0100（考試結果、重考的做法、單價；之前的考試預約狀態已經全對，`:119`、`:148`）、ADR-0101；`functions/transcripts/aboveeList.js`（`:69` 那一句；**提示詞只在這一份**，`public/js/domain/transcripts.js` 只有欄位形狀）；`tests/ai-transcripts.test.js`（`:43-60` 只比欄位與 columns）；
`scripts/ai-exam.mjs`；`.local/references/ai-exam/abovee-photos-exam.mjs`（她的手機照片那一套）；CLAUDE.md「AI 的抄字格式」「拍照那一支 Function」兩列；
`docs/STAGING.md`「部署那一支 Function」；`docs/agents/lessons.md` 九

## 她要的

> 我明明之前就有給你 …編輯預約欄位結構.md 以及我有給你 …圖片辨識參考，裡面有所有幫助你辨識的資訊 ?

## 為什麼會這樣

提示詞那一句（`aboveeList.js:69`）：「預約狀態照畫面上的字寫（例：『確認前往』『課程完成』『已取消』）」—— 只舉了三種。
模型照抄原字，少舉例不會讓它認不得，但「待確認」「聯繫中」「客戶失約」字小的時候比較容易被抄成長得像的那三種（尤其「待確認」→「確認前往」）。

## 要做的

1. 那一句改成六種都列（照 `.local/references/圖片辨識參考/編輯預約欄位結構.md` 的順序）：待確認、聯繫中、確認前往、已取消、客戶失約、課程完成。**照抄原字，不加翻譯欄**（ADR-0099）
2. 補一條測試：`promptFor('aboveeList')`（或那一份提示詞實際的出口）裡六種字都在。**不要寫「兩份一模一樣」**—— `public/` 那一份沒有提示詞
3. 改了 `functions/` 之後，跑 E2E 前要重開模擬器（memory：本機跑 E2E 的坑）
4. 重考：`scripts/ai-exam.mjs --only aboveeList` 與她的手機照片那一套。**跑之前先問她**（上一次 10/14 花 US$0.11）。答案與結果只在 `.local/`，終端機只印數字；
   要量狀態抄得對不對，答案檔有那一欄（擷取檔逐像素驗證過的 353 列）。分數寫回 ADR-0100「考試結果」
   353 列的答案裡待確認、聯繫中都是 0 列：這次重考**只能證明沒有退步**，量不到「待確認被抄成確認前往」那一種 —— ADR-0100 照實寫
5. 部署 **staging** 的 Function（`--project staging`，STAGING.md 那一節；沒登入叫不動驗一次）。**正式的不在這一輪**：上 main 那天部署（她還沒說；送的／體驗那一輪的「預約來源」也還沒上正式）

## 判準

- 提示詞裡六種都在（新的那一條測試釘著）
- 重考：狀態那一欄不比 10/14 那一次低；答案裡的「客戶失約」那幾列抄成「客戶失約」
- staging 的 Function 更新時間是這一次（拿 Node＋ADC 查 `cloudfunctions v2` 的 `updateTime`，memory 的 gcloud 那一條）
