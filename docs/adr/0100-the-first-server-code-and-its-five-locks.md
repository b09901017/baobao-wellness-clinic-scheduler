# ADR-0100：第一支伺服器程式 —— 一支 Cloud Function、五道防護、自己數的上限

日期：2026-09-17
狀態：已接受
推翻：`SPEC.md` 第 10 節技術棧「排程／背景工作」那一列的「**先不用 Functions**」
延伸：[ADR-0099](./0099-ai-only-copies-the-words.md)（AI 只抄字）

## 背景

拍照帶入要叫一個看得懂照片的模型。到今天為止這個 repo 沒有任何伺服器端程式：
前端直接讀寫 Firestore，安全防線全在 Rules。

她 2026-09-17：

> Ai 防護要做好 不能被其他人用莫名奇妙的方式蹭到我的ai
> 然後也要給ai預算限制

> 目前我都是Blaze，同意升，並並設一個月 US$10 的預算警示，但沒有辦法限制用量嗎 ?
> 就是怕被惡意陌生人濫用

模型她指定 **Gemini 3.8 Flash**（「應該很夠用」）。

## 決定

**一支 callable Cloud Function `extract({ kind, image })`**，`asia-east1`、Node 22、
ES module、不 build。它以專用服務帳號 `ai-extract` 執行，那個帳號只有兩個角色：
Vertex AI User（叫 Gemini）與 Cloud Datastore User（讀白名單與設定、寫用量）。
**沒有任何 API key** —— 服務帳號的授權由 Google 在執行環境裡給，repo、瀏覽器、
環境變數裡都沒有可以偷的東西。

### 五道防護

每一道擋下來都**不叫 AI**：

| # | 擋什麼 | 做法 |
|---|---|---|
| 1 | 偷 key | 根本沒有 key |
| 2 | 不是她 | `request.auth.uid` 要在 `allowedUsers`（跟 `firestore.rules` 同一份），不在就 `permission-denied` |
| 3 | 不是從她網站來的程式 | App Check（reCAPTCHA Enterprise），`enforceAppCheck: true` |
| 4 | 額度爆掉 | 我們自己數：每月估計花費上限（她在設定頁調，程式裡另有天花板）、每天次數上限、一次一張、每張大小上限、`maxInstances: 2`、暫停開關 |
| 5 | Google 那一層 | US$10 預算警示，50／90／100% 寄信 |

第 4 道是**先預留再叫**：transaction 裡讀這個月的合計，加上這一次最多可能花多少
（輸入上限 ＋ `maxOutputTokens` 全用完），超過上限就拒絕；沒超過就先記上去，
回來之後換成實際值。所以並發的兩次呼叫不會一起溜過上限。失敗也記 —— token 照樣收錢。

### 數字

| | 值 | 在哪 |
|---|---|---|
| 每月上限 | 她在設定 → AI 用量調，預設 US$10 | `config/ai.monthlyCapUsd` |
| 天花板 | US$30，她填再大也當 US$30 | Function 程式裡 |
| 每天次數 | 150 次 | Function 程式裡 |
| 一張照片 | JPEG、≤ 1.5MB | Function 程式裡（瀏覽器先縮成長邊 ~2000px） |
| 同時幾台 | `maxInstances: 2`、`timeoutSeconds: 60` | Function 程式裡 |

### 估計花費照 2027 年的價格算

3.8 Flash（2026-09-17 查的）：輸入 US$0.75、輸出 US$3.75／百萬 token（thinking 算輸出），
**優惠到 2026-12-31**，2027-01-01 起 US$1.50／US$7.50。

照翻倍後的算。代價是今年底前畫面上的數字比帳單高；換到的是**上限不會在元旦那天
突然只擋得住一半** —— 那一天沒有人會記得回來改單價表。

## 為什麼不是別的做法

- **Firebase AI Logic（瀏覽器直接叫模型）**：免費層（Gemini Developer API）的條款允許
  拿內容改進產品、可能人工審閱；付費層只擋 App Check，**不擋白名單** —— 任何拿到
  網站程式碼的人在自己的瀏覽器裡通過 App Check，就花得到她的錢。防護第 2 道做不到
- **Cloud Vision OCR**：只給一坨字與座標。訂購單是表格加勾選格加手寫，
  那層解析要自己寫，而且每個月換一版訂購單就要改一次
- **在 Function 裡放一把 Gemini API key**：多一個要保管、要輪替、會外洩的東西，
  換到的只是少設定一個服務帳號
- **預算超過就自動關帳單**（Google 文件教的那一招）：會連 Firestore 與網站一起關掉。
  她的客戶資料打不開，比 AI 多花幾百塊糟得多
- **調低 Gemini 每分鐘配額**：新版 Gemini 在 Standard PayGo 是共用額度，
  不能設單一專案的上限（2026-09-17 查的）。所以真正的上限只有第 4 道

## 後果

- **模型只走 global 端點，不保證處理區域**（2026-09-17 查 Agent Platform 的 locations 文件：
  3.8、3.7、3.6 Flash 只在 global region，沒有 data residency）。Function 在 `asia-east1`，
  但照片實際在哪裡被模型處理不知道。照片與隱私另見 ADR-0101
- `firebase.json` 多了 functions 與模擬器；模擬器裡**不叫 Gemini**，照圖片雜湊回
  `tests-e2e/fixtures/ai/` 的假抄字，五道防護照樣跑
- `aiUsage/{YYYY-MM}` 只有 Function 寫得進去（Rules 寫 `false`），瀏覽器改不小數字；
  它不進備份（沒有還原的價值）
- **第一次部署從她的電腦**：CI 那把服務帳號部署 2nd gen Functions 要的角色牽涉好幾個
  Google 的系統帳號，看到實際錯誤訊息再一條一條補進 `docs/STAGING.md`。
  `deploy.yml` 的 firebase-tools 釘在 13 那一條不動
- thinking level 由考試（`scripts/ai-exam.mjs`）決定，結果補在下面

### 考試結果

（04 跑完補）
