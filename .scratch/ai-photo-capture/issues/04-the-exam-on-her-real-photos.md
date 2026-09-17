# 考卷與第一次考試（真資料）

Status: todo
Blocked by: 01、03
來源：`../spec.md`
動工前先讀：01 的照片與隱私 ADR（**沒合進去不可以跑**）、03 的四種格式、
`.local/references/圖片對照.md`（有真名，**整份留在 `.local/`**）

## 她要的（原話）

> d不用假資料考試，就直接拿真資料考試，目前好像gemini 已經出到flash3.8了 應該很夠用

## 為什麼會這樣

`.local/references/圖片對照.md` 已經把 39 張照片逐張寫了是誰、買了什麼、哪幾天：
**那就是一份現成的考卷**，只是寫成給人看的表格，還不是程式比得了的答案。

考試不是為了挑模型（她定了 3.8 Flash），是為了三件事：

1. 手寫的**數量與金額**讀錯的機率 —— 那一欄錯了會建錯額度
2. 調提示詞與 thinking level（low／medium／high）
3. 留一份基準，之後改提示詞時知道有沒有變差

## 要做什麼

1. **答案**：`.local/references/ai-exam/answers.json`，照 03 的格式手工整理（先從 `圖片對照.md` 抄，看不清楚的回去看照片）。
   Abovee 那兩張的答案從照片逐列抄。**整個資料夾在 `.local/` 底下** —— 新開資料夾要跑一次
   `git check-ignore -v .local/references/ai-exam/answers.json`（CLAUDE.md）
2. **腳本**：`scripts/ai-exam.mjs`
   - 讀 `.local/references/images/`，**用跟 06 一樣的縮法**（長邊 ~2000、JPEG），devDependency 加 `sharp`
   - 直接 import `functions/transcripts/` 的格式與提示詞，用本機 `gcloud auth application-default login` 叫 Agent Platform
     —— **不經過 Function**（考試不該被上限擋住，也不該算進她的用量頁）
   - 結果寫 `.local/references/ai-exam/result-YYYY-MM-DD.json`
   - **終端機只印數字**（每一種單子、每一欄的正確率），不印名字 —— 輸出會進對話紀錄
3. **比對規則**：姓名全對才算對；數字以 domain 讀完之後的值比（`"8萬"` 與 `"80000"` 算同一個）；
   日期照 domain 補完年份之後比
4. 跑一次 low、一次 medium，把結果與選定的 thinking level 寫回 01 那支「伺服器程式」ADR 的 Consequences

## 判準

- `git status` 看不到 `.local/` 底下任何東西
- `scripts/ai-exam.mjs` 裡一個真名、一個病歷號都沒有
- 報告至少分開列：訂購單的**手寫數量**、**尚欠尾款**、療程單的**日期**、**勾選的器材**、Abovee 的**時段**與**病歷號**
- 任何一欄低於 90% 要寫進 ADR，並且在那個功能的 issue 裡加一條「確認層要讓她特別看這一格」
- **這一份考卷有沒有任何一題的答案是從 AI 自己的輸出抄回來的？**（那樣考出來永遠是滿分）
