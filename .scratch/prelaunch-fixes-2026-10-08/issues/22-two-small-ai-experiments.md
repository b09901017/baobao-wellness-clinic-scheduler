# 拍照 AI 的兩個小實驗

Status: done
來源：決定 5（`d-ai-test`）、`.local/references/audit-2026-10-08/report/answers-ai.mjs`、`ai/report.md` 第 14 條
動工前先讀：`scripts/ai-exam.mjs`（檔頭的用法、`--thinking`、`--only`）、`functions/lib/geminiModel.js`（`THINKING_LEVEL`、解析度那一格怎麼設）、
`functions/lib/pricing.js`、`functions/transcripts/`、`.local/references/ai-exam/`（`answers.json` 與歷次 `result-*.json`）、ADR-0099、0100（「考試結果」那一節）、0101、
記憶 `gcloud-blocked-by-avast`、`gemini-spend-audit`、`CLAUDE.md` 連動表「AI 的抄字格式」「拍照那一支 Function 的防護、上限或單價」
Blocked by: 13（Abovee 的提示詞先改好，考的才是上線的那一套）
**跑之前要她點頭**（下面「先問她」）

## 她要的

> ・拍照 AI 那兩個小實驗要不要做？ → 做

題目原文：

> 一、Abovee 那一種把照片解析度調到「超高」，專治小字的人名；二、訂購單與療程單試一次「中等思考」，看手寫姓名與日期會不會變準。拿你之前考試的同一批照片考，**兩個加起來不到台幣 30 元**，會花你的錢所以要你點頭。分數比較好才改，不好就不動。

她另外寫的：

> 決定 5 選了「做」的話：考試會花我的錢，跑之前告訴我要考幾張

## 先問她（跑之前）

答案卷 40 張：訂購單 24、療程單 13、Abovee 2、文宣 1。

| 實驗 | 照片 | 實驗的設定 | 拿來比的基準 |
|---|---|---|---|
| 一、Abovee 解析度超高 | 2 張 | 考一次 | 13 改了提示詞 → **要重考一次**（2 張） |
| 二、訂購單＋療程單中等思考 | 37 張 | 考一次 | 9/17 那一份低思考的結果，**提示詞之後沒改過才沿用**；改過就重考（37 張） |

所以是 **39 張照片、41～78 張次**。動工時先看 `git log` 那兩種提示詞 9/17 之後改過沒有，算出實際張次與估價（`pricing.js` 的單價，照漲價後的算），
**把這兩個數字講給她，她說可以才跑。** 健檢報告估的「不到台幣 30 元」是每一張各考一次的價錢。

## 要做的

**先補兩個旋鈕（預設值不變，上線的行為一個字都不動）**：

- 解析度現在**沒有任何設定**：`functions/lib/geminiModel.js:31-58` 的 `makeGeminiModel()` 只收 `thinkingLevel`，`scripts/ai-exam.mjs:34-38` 也沒有那個旗標。
  實驗一要先替 `makeGeminiModel()` 加一個選填的解析度參數（沒給＝現在的行為）與考試腳本的旗標。
- 思考程度是**全域一個常數**（`geminiModel.js:15` 的 `THINKING_LEVEL`），沒有「那一種單子自己的設定」。考試腳本的 `--thinking` 已經能單獨考；
  但實驗二分數好、要採用的話，得讓 Function 照單子種類傳不同的思考程度 —— 那是 `functions/` 的改動，範圍比「改一行」大。**採用之前先把要改什麼寫給她。**

然後：

- 實驗一：Abovee 那一種用超高解析度考；比「服務資源」那一格的治療師全名（上次 7/10）與其餘各欄有沒有退步。
- 實驗二：訂購單、療程單用中等思考考；比手寫姓名（上次 9/16）、手寫日期（上次 54/62），與輸出 token 多了多少。
- 一次一張送（`--concurrency 1`，同時送會被限流）。結果檔有真名，只寫進 `.local/references/ai-exam/`；**終端機與對話只出現數字**。
- **分數比較好才改**上線的設定（`functions/lib/geminiModel.js`／那一種單子自己的設定），不好就不動。改了的話：
  - 單價與上限要不要跟著動（`pricing.js`、ADR-0100 的五道防護）—— 中等思考輸出多三成，每月上限夠不夠
  - `functions/` 改了 → staging 的 Function 要重新部署才生效：**部署前先問她**；正式站等上線那天
- 兩個實驗的分數（前、後、差多少、花了多少）寫回 ADR-0100「考試結果」—— 那一節本來就是往下加的，不算改舊決定。

## 順手（健檢報告同一段提到的，不花錢）

療程單的提示詞叫 AI 抄了四格 app 沒在用的（總堂數、治療師簽了沒、扣課章、備註）。**這一輪不拿掉** ——
拿掉是改格式、要重考療程單 13 張，而且備註那一格有沒有人讀要先查。寫進 23 的「沒做、留著」。

## 判準

- 跑之前她知道要考幾張、大概多少錢嗎？
- 比的是同一批照片、同一份答案、同一套提示詞嗎？（只差那一個設定）
- 「比較好」怎麼算：目標那一格進步，而且其餘各格沒有退步。寫出每一格前後的數字再下結論。
- 結果檔、終端機輸出、commit、ADR 裡有沒有任何一個真名或照片上的字？（ADR 只寫分數）
- 分數沒有比較好的那一個實驗：**上線的行為**是不是一個字都沒動？（旋鈕可以留著，預設值要是原本的）

## 測試

改了設定才有：`functions/` 既有的測試照舊全過；`tests/ai-transcripts.test.js`（兩份格式一樣）。

## 做完時留下的（10/9）

- 她選方案 B（基準也重考），另外加她放的 7 張手機照片（`.local/references/abovee拍照測試/`，11 張裡 4 張重複）。
- 旋鈕：`9b45fca`（`makeGeminiModel({ mediaResolution })`，放在照片那一個 part 上；`ai-exam.mjs --resolution`）。預設＝上線的行為。
- 分數寫在 ADR-0100「考試結果」的 2026-10-09 那一段。**兩個都不採用**：中等思考的姓名沒進步（8 → 7/16）、輸出 11.6 倍；超高解析度服務資源進步但頁數與診間退步（空白抄成「其他」）。
  所以 `pricing.js`、每月上限、Function 都不用動；staging 的 Function 要部署只是為了 13 的提示詞。
- 結果檔（有真名，只在 `.local/references/ai-exam/`）：`result-2026-10-09-{low,medium}-orderForm+treatmentSheet.json`、`result-2026-10-09-low{,-ultra_high}-aboveeList.json`、
  `result-2026-10-09-abovee-photos-{default,ultra_high}.json`；腳本 `abovee-photos-exam.mjs`（新照片）、`rescore-tmp.mjs`（同一批照片重新計分）。終端機只印數字。
- 花了 US$1.18（2027 價格），比估的多：中等思考的輸出比 9/17 那一次量的還多。
- 順手沒做（照 issue）：療程單多抄的四格。

