# Cloud Function 地基與五道防護

Status: done
Blocked by: 01
來源：`../spec.md`（「架構」「防護五道」「只有她做得到的事」）
動工前先讀：01 產出的三支 ADR、`firebase.json`、`firestore.rules` 開頭的 `allowed()`、
`.github/workflows/deploy.yml`（firebase-tools 釘在 13 的那一段）、`tests-e2e/start-emulators.sh`、
`public/js/firebase-config.js` 的 `projectIdFor()`／`envOf()`、`tests/layering.test.js`、`docs/STAGING.md`

## 她要的（原話）

> Ai 防護要做好 不能被其他人用莫名奇妙的方式蹭到我的ai
> 然後也要給ai預算限制

> b 目前我都是Blaze，同意升，並並設一個月 US$10 的預算警示，但沒有辦法限制用量嗎 ? 就是怕被惡意陌生人濫用，也想知道有免費額度嗎?

## 為什麼會這樣

這個 repo 到現在沒有任何伺服器端程式：`firebase.json` 只有 hosting 與 firestore，
模擬器只起 `auth,firestore,hosting`（`tests-e2e/start-emulators.sh:31`），前端也沒有 functions SDK。

Google 的預算**只會寄信不會停**。「超過預算就關掉帳單」那一招會連 Firestore 與網站一起關掉，
所以真正的上限要自己數。

## 要做什麼

### Function

- `functions/`（Node 22、ES module、**不 build**）：`firebase-functions`、`firebase-admin`、`@google/genai`
- 一支 callable `extract({ kind, image })`，region `asia-east1`，`maxInstances: 2`、`timeoutSeconds: 60`，
  **以 `ai-extract` 服務帳號執行**（她建好的，只有 Vertex AI User 與 Cloud Datastore User；spec「只有她做得到的事」第 3 條）。
  帳號要寫成跟著專案走的形式（staging 與正式各一個同名帳號），寫法動工時查 firebase-functions 的 `serviceAccount` 選項，**不要寫死 staging 的完整位址**
- 順序（每一道擋下來都**不叫 AI**）：
  1. `enforceAppCheck: true`
  2. `request.auth` 存在、`allowedUsers/{uid}` 存在
  3. `kind` 是 03 定義的四種之一；`image` 是 JPEG、base64 解開後 ≤ 1.5MB；**一次一張**
  4. `config/ai` 的 `paused` 為真 → 拒絕
  5. transaction：讀 `aiUsage/{YYYY-MM}`，這個月估計花費 + 這一次的預留額 > 上限、
     或今天次數 ≥ 每日上限 → 拒絕；否則先預留
- 叫 Gemini（Agent Platform、服務帳號授權、`responseSchema` 用 03 的格式）
- 回來之後照格式再驗一次（模型偶爾會多吐欄位）：多出來的欄位**丟掉**，不是照單全收
- 用 `usageMetadata` 算實際估計花費，transaction 把預留額換成實際值；失敗也要記（token 照樣收錢）
- 回 `{ transcript, usage: { estUsd, monthUsd, capUsd } }`
- **任何 log 都不帶照片與辨識出來的字**，錯誤只記 `kind` 與錯誤碼

### 上限的數字

- 每月上限讀 `config/ai.monthlyCapUsd`（她在 05 調），**程式裡另外寫死一個天花板**（例如 US$30），
  超過天花板一律當天花板
- 每日次數上限寫在程式裡（例如 150 次）
- 單價表寫在 Function 裡，**照 2027-01-01 翻倍後的價格**（ADR 有理由）

### 資料與 Rules

- `aiUsage/{YYYY-MM}`：合計（次數、token、估計美元）、每一種 `kind` 的小計
- `aiUsage/{YYYY-MM}/calls/{id}`：時間、`kind`、成功／失敗／被擋（哪一道）、估計美元。**沒有內容**
- `firestore.rules`：`aiUsage` 讀 `allowed()`、**寫 `false`**（Function 用 Admin SDK 寫；瀏覽器改不小數字）
- `config/ai`：既有的 `config/{docId=**}` 規則已經涵蓋，不用開新洞
- `tests-e2e/rules/` 補「瀏覽器寫不進 `aiUsage`」

### 前端

- `public/js/data/ai.js`：`extract(kind, blob)` 包 `httpsCallable`；錯誤轉成畫面講得出來的幾種
  （沒網路、被暫停、超過上限、辨識失敗）。**只有 `/data` import SDK**（`tests/layering.test.js`）
- `data/firebase.js`：App Check 初始化（模擬器用 debug token）、functions 模擬器連線
- `public/sw.js`：新檔進 `SHELL`、升 `VERSION`

### 模擬器與 E2E

- `firebase.json` 加 functions 模擬器；`start-emulators.sh` 的 `--only` 加 `functions`
- projectId 三邊照 `projectIdFor()`，**不要寫死 `demo-`**
- 在模擬器裡（`FUNCTIONS_EMULATOR === 'true'`）**不叫 Gemini**，照圖片的雜湊回 `tests-e2e/fixtures/ai/` 底下的假抄字
  —— 防護那五道照樣跑，E2E 才測得到「被擋」

### 部署

- **第一次先從這台電腦部署 staging**（這台的 Firebase CLI 是她本人登入，擁有者不會卡權限），先確認 Function 本身跑得動、
  防護五道在真的環境上都擋得住。**部署是對外的動作，按下去之前先問她**
- 跑通之後才讓 `deploy.yml` 多一步 `firebase deploy --only functions`。CI 那把服務帳號部署 2nd gen Functions
  要的角色牽涉好幾個 Google 的系統帳號 —— **照 CI 實際的錯誤訊息一條一條補**，每補一條寫進 `docs/STAGING.md` 讓她去點
- firebase-tools 13 可能不認得新的 Node runtime，或也要 serviceusage 權限 —— 撞到就照 `deploy.yml` 那段註解的做法處理，**不要直接升版**
- `docs/STAGING.md` 把 spec「只有她做得到的事」寫成**正式環境**也照著做得完的版本（她 9/17 只做了 staging ＋ 預算）；
  **不要寫「調低 Gemini 每分鐘配額」**，那一條做不到（spec 有寫為什麼）

### 守衛

- `.gitignore` 補 `.secret.local`、`functions/.runtimeconfig.json`
- `tests/no-secrets.test.js` 補 `sk-ant-` 與 service account JSON 的形狀
  （**不要掃 `AIza`** —— `firebase-config.js` 的前端 apiKey 就長那樣，而且本來就該 commit）

## 判準

- 沒登入呼叫 → `unauthenticated`；登入了但不在 `allowedUsers` → `permission-denied`；**兩種都沒有叫到 AI**
  （模擬器的假 provider 記得被叫了幾次，E2E 斷言是 0）
- `config/ai.paused = true` → 拒絕，理由講得出來
- 上限設 US$0.01、呼叫兩次 → 第二次被擋，`calls` 裡那一筆寫著被第幾道擋下
- 把 `monthlyCapUsd` 寫成 99999 → 實際上限是天花板
- 回傳格式多一個 `courseId` 欄位的假回應 → 送到前端的 `transcript` 裡沒有它
- **這一支 Function 有沒有任何一條路，讓不在白名單裡的人花到一毛錢的 AI？**
- 瀏覽器直接寫 `aiUsage/*` → Rules 擋下
- grep `functions/` 裡的 `console.*`：沒有一行帶 `image`、`transcript` 或 `text`
- staging 部署成功，`docs/STAGING.md` 的步驟她照著做得完
