# 拍照帶入：訂購單、方案文宣、Abovee 畫面、療程單（2026-09-17）

來源：她 2026-09-17 的 `/kickoff` 與之後兩輪回答（原話全部貼在底下）。

基底：`develop`（PR #119 之後，`f7ad675`）。分支 `claude/ai-photo-capture-2026-09-17`。
`public/sw.js` 現在是 `v128`，**每一支 PR 挑不同的號**（CLAUDE.md）。

## 一句話

**AI 只抄字，domain 翻譯，她確認，寫入走既有的那幾支。**
AI 回傳的格式裡根本沒有課程／器材／狀態／客戶的 id —— 它做不到判斷，不是被叮嚀不要判斷。

## 這一輪要做什麼

| | 題目 | Blocked by | PR |
|---|---|---|---|
| 01 | 三支 ADR：AI 只抄字、第一支伺服器程式與防護、照片與隱私 | — | A |
| 02 | Cloud Function 地基與五道防護 | 01 | A |
| 03 | 四種單子的抄字格式 | 02 | A |
| 04 | 考卷與第一次考試（真資料） | 01、03 | A |
| 05 | 設定 → AI 用量 | 02 | A |
| 06 | 拍照元件 | 02 | B |
| 07 | 拍方案文宣 → 方案範本 | 03、06 | B |
| 08 | 新增客戶畫面重畫 | — | **C（跟 09 一起出貨）** |
| 09 | 拍訂購單 → 新增客戶／加購 | 03、06、08 | **C** |
| 10 | 組一段時段只有一支 | — | D |
| 11 | 認人：人名＋病歷號 | — | E |
| 12 | 治療師主檔「Abovee 上的寫法」與服務資源的認法 | 11 | E |
| 13 | 拍 Abovee → 一次新增很多來訪 | 03、06、10、11、12 | E |
| 14 | 療程單的存放與搜尋 | 03、06、11 | F |
| 15 | 療程單比對 | 14 | F |
| 16 | 收尾：連動表與文件 | 全部 | 最後一支 PR |

**PR 分組跟她 9/17 看到的那一版差一點**：拍照元件（06）本身沒有入口，staging 上點不到，
所以跟第一個用它的 07 併成一支。她要一起出貨的是「新增客戶重畫＋訂購單」＝ 08＋09，沒變。
其餘各自上 staging。

## 她定的（逐條，2026-09-17）

**不要再提議推翻這幾條。**

| 題目 | 她的決定 | 落在哪 |
|---|---|---|
| 方案 | 兩個專案本來就是 Blaze；設 US$10 預算警示 | 02 |
| 防護 | 「Ai 防護要做好 不能被其他人用莫名奇妙的方式蹭到我的ai」、要預算限制 | 02 |
| 用量 | 「可以在設定那邊看到目前用了多少ai錢」 | 05 |
| 模型 | Gemini 3.8 Flash（「應該很夠用」） | 01、02 |
| 考試 | **不用假資料，直接拿真資料考試** | 04 |
| 訂購單 | 有身分證字號也可以送 AI，**但照片不要儲存** | 01、09 |
| 療程單 | 照片存；**被新版取代時真的刪掉**（「反正有紙本正本」） | 01、14 |
| 病歷號 | 「可以拿來交叉比對，人名和病歷號」 | 11 |
| 尾款 | 紅色備註就夠，不開追蹤欄位，**各項金額不用記** | 09 |
| Abovee 欄位 | 藏不藏得了欄位「不知道，先當作不行好了，讓我一次上傳兩張圖片，也接受上傳一張」；已經篩出自己的預約 | 13 |
| 治療師 | 「可以記住就讓治療師主檔要多一格「Abovee 上的寫法」」 | 12、13 |
| 壓完 | 「不需要放一個「這幾位標成壓完」的開關，直接標成壓完」 | 13 |
| 草稿 | 「辨識出來的字不存草稿，確認到一半離開就重拍一張」 | 06 |
| 提醒卡 | tip-red-lines 對 `customers.js`／`flags.js` 的禁令拿掉，**提醒卡也收成 ⚠，那兩句也不禁**；同名 ⚠ 貼姓名欄＋存檔前再講一次 | 08 |
| 出貨 | 08＋09 一起，其餘各自上 staging；**issue 不用逐支給她看**（「我相信你」） | — |

## 暫定（她沒回答到、這裡先定的）

她隨時可以推翻，推翻時回來改這一節。

- **一次選好幾張訂購單照片怎麼分人**（第一輪第 7 題她跳過了）：認得出名字的每張一位；
  兩張名字一樣的併成一位；認不出名字的那張（便利貼特寫）掛在前一張上，卡片上講出來，
  她點一下拆開。→ 09
- **訂購單上的電話不抄**：她 9/17 看過的「完全不抄」清單有電話，她沒反對。新客戶因此會帶
  「沒電話也沒 LINE」的 ⚠（08 之後是小泡泡，不佔版面）。→ 03、09
- **`flags.js` 裡的禁忌紅框（`noticeBlock`）不動**：它在壓表與來訪編輯器，不在新增客戶那一頁。→ 08
- **確認卡按「建立」不再跳「沒電話也沒 LINE」那一道**（09 實作時定的）：訂購單一律不抄電話，
  跳的話每一張卡都要多按一次。那一句在姓名旁的 ⚠；同名那一句由卡上兩顆問（都不預選）。
  小鉛筆那一層的表單也不問（它只改草稿，不寫資料庫）。→ 09
- **加購到既有客戶時，單子上的備註接在那一位的備註後面、警示與合作機構併進去**，跟額度同一個 commit；
  既有的一個都不拿掉。→ 09
- **一張單子上印了兩個不同的方案**：先建第一個，第二個列在「認不出來」讓她選或拿掉（建好之後到客戶詳情加購）。
  同一個方案出現兩次（兩張照片）就是兩套。→ 09
- **建好一位就滑到下一位，全部建好整層收起來回客戶清單**；建立**不給「復原」**（復原會讓卡上的章與資料庫對不上，
  建錯了到客戶詳情處理）。還有沒建的就離開 → 先問一句「照片不會留著」。→ 09

## 架構

```
手機／iPad
  拍照（app 內取景 / 系統相機 / 相簿）
  → 縮成長邊 ~2000px、重新編碼成 JPEG（EXIF 與 GPS 一起丟掉）
  → httpsCallable('extract', { kind, image })          ← data/ai.js，只有 /data 碰 SDK
Cloud Function（asia-east1，Node，JS 不 build）
  ① App Check  ② 登入 + allowedUsers  ③ 暫停？上限？（transaction 先預留）
  → Gemini 3.8 Flash on Agent Platform（Function 以 `ai-extract` 服務帳號執行，**沒有任何 key**）
  → 照抄字格式驗一次 → 記用量（不記內容）
  ← { transcript, usage }
手機
  domain 把字翻成主檔（認不出就空著）→ 她確認 → 既有寫入
```

### 防護五道（她：「不能被其他人用莫名奇妙的方式蹭到我的ai」）

| # | 擋什麼 | 做法 |
|---|---|---|
| 1 | 偷 key | 根本沒有 key |
| 2 | 不是她 | `request.auth.uid` 要在 `allowedUsers`（跟 Firestore Rules 同一份），不在就拒絕，AI 沒被叫 |
| 3 | 不是從她網站來的程式 | App Check（reCAPTCHA Enterprise），`enforceAppCheck: true` |
| 4 | 額度爆掉 | 我們自己數：每月估計花費上限（她在設定頁調，程式裡另有天花板）、每天次數上限、一次一張、每張大小上限、`maxInstances: 2`、暫停開關 |
| 5 | Google 那一層 | US$10 預算警示（**只寄信，不會停** —— 用「超過就關帳單」會連 Firestore 與網站一起關掉，不做）。Gemini 每分鐘配額**調不了**（共用額度），所以真正的上限只有第 4 道 |

**估計花費照 2027 年的價格算**：3.8 Flash 優惠價到 2026-12-31（輸入 US$0.75、輸出 US$3.75／百萬 token），
2027-01-01 起翻倍。照翻倍後的算，優惠期間畫面上的數字會比帳單高，但上限不會在元旦那天突然只擋得住一半。

### 照片

| | 送 AI | 存 | 理由 |
|---|---|---|---|
| 訂購單 | ✓ | **不存** | 身分證字號、生日、刷卡欄。她：「但不要儲存」 |
| 方案文宣 | ✓ | 不存 | 沒有保存價值 |
| Abovee 畫面 | ✓ | 不存 | 電話、同事的名字 |
| 療程單 | ✓ | **存**（Cloud Storage，縮圖後約 300KB） | 扣課的憑據（CONTEXT「療程單」），她要搜得到 |

**辨識出來的字也不存草稿**（她 9/17）。確認到一半離開就重拍一張（一張不到台幣 1 元）。
所以這一輪**沒有**「進行中的辨識」那一種集合。

### 抄字格式的三條規矩（03）

1. **沒有任何 id 欄位**：課程、器材、客戶、診間、治療師、狀態一律是「照片上寫的字」
2. **數字照寫成字串**：`"8萬"`、`"80000,-"`、`"10"` —— 怎麼讀由 domain 決定，有測試
3. **永遠不抄**：身分證字號、生日、電話、卡號、末四碼、分期、銀行、發票號、簽名的內容（只抄「有沒有簽」）

格式定義在 `functions/` 裡（Function 部署時只帶那個資料夾），domain 那一側讀同一份形狀 ——
**兩邊講同一句話由測試盯著**，照 `tests/sheet-script.test.js` 盯 `SYNC_FORMAT` 的做法。

## 只有她做得到的事

2026-09-17 晚上由上一個 session 一步一步教她做。這一輪只做 **staging ＋ 一份涵蓋兩個專案的預算**；
正式環境等 A 組要合進 `main` 之前，照 02 寫進 `docs/STAGING.md` 的版本再做一次。

| # | 做什麼 | 為什麼 |
|---|---|---|
| 1 | 裝 Google Cloud CLI；`gcloud auth login`、`gcloud auth application-default login`、`gcloud auth application-default set-quota-project wellness-clinic-staging` | 下面幾步用指令做比點畫面準；04 考試用她本人的授權叫 Gemini |
| 2 | staging 開 API：`aiplatform`、`cloudfunctions`、`cloudbuild`、`artifactregistry`、`run`、`firebaseappcheck`、`recaptchaenterprise` | CI 那把服務帳號沒有 serviceusage 權限，開不了 API（`deploy.yml` 那段註解） |
| 3 | 建服務帳號 `ai-extract`，給 **Vertex AI User**（`roles/aiplatform.user`）與 **Cloud Datastore User**（`roles/datastore.user`） | Function 以它執行：叫 Gemini、讀 `allowedUsers`／`config/ai`、寫 `aiUsage`。**只有這兩個角色**，不用預設那個權限很大的 compute 帳號 |
| 4 | reCAPTCHA 建一把網站金鑰（網域 `wellness-clinic-staging.web.app`、`wellness-clinic-staging.firebaseapp.com`），到 Firebase App Check 把網頁應用程式註冊成 reCAPTCHA Enterprise。**API 分頁一個都不按「強制執行」** | 防護第 3 道。按了強制執行，app 在 02 送出 App Check 憑證之前會整個讀不到 Firestore |
| 5 | 帳單 → 預算：兩個專案、全部服務、US$10（帳單帳戶是台幣就填 320）、50／90／100% 寄信 | 防護第 5 道。只寄信不會停 |
| 6 | Firebase → Storage → 以正式版模式（全部拒絕）建預設 bucket，位置 `asia-east1` | 14 要用。位置之後改不了 |

**不做**：

- **Gemini 每分鐘配額調低** —— 新版 Gemini 在 Standard PayGo 是共用額度，不能設單一專案的上限（2026-09-17 查的）。上一版 spec 寫錯了
- **CI 那把服務帳號部署 2nd gen Functions 要的角色** —— 牽涉好幾個 Google 的系統帳號。第一次部署由她本人從這台電腦部署
  （這台的 Firebase CLI 已登入她的帳號），CI 那邊看到實際錯誤訊息再一條一條補

### 怎麼檢查（實作的 session 開工前跑一次）

**只讀，不要替她改 Google Cloud 的設定**；驗不過的列出來問她。
Git Bash 找不到 `gcloud` 就改用 PowerShell 工具（裝完要重開 VS Code 才吃得到新的 PATH）。

1. `gcloud auth list` —— 有她的帳號而且是 active
2. `gcloud auth application-default print-access-token` —— 印得出一長串（內容不要貼進對話）
3. `gcloud services list --enabled --project wellness-clinic-staging` —— 第 2 步那七個都在
4. `gcloud iam service-accounts describe ai-extract@wellness-clinic-staging.iam.gserviceaccount.com --project wellness-clinic-staging` —— 存在
5. `gcloud projects get-iam-policy wellness-clinic-staging --flatten="bindings[].members" --filter="bindings.members:ai-extract@" --format="value(bindings.role)"` —— **恰好** `roles/aiplatform.user` 與 `roles/datastore.user`
6. `gcloud storage buckets list --project wellness-clinic-staging --format="value(name,location)"` —— 有一個、位置 `ASIA-EAST1`
7. App Check，用 `gcloud auth print-access-token` 當 Bearer、header 加 `x-goog-user-project: wellness-clinic-staging`：
   - `GET https://firebaseappcheck.googleapis.com/v1/projects/wellness-clinic-staging/apps/1:306220040308:web:4fd377d8b6186afb501121/recaptchaEnterpriseConfig` → 有 `siteKey`
   - `GET https://firebaseappcheck.googleapis.com/v1/projects/wellness-clinic-staging/services` → Firestore、Storage、Auth **都不是 `ENFORCED`**。是的話**立刻告訴她**，staging 會讀不到資料
8. 叫一次 Gemini（一句話，不帶任何客戶資料）：
   `POST https://aiplatform.googleapis.com/v1/projects/wellness-clinic-staging/locations/global/publishers/google/models/gemini-3.8-flash:generateContent`，
   內容 `{"contents":[{"role":"user","parts":[{"text":"回一個字：好"}]}]}` → 有回答。404 就是模型名稱或端點不對，查清楚寫進 01 的 ADR
9. 預算查不到（要帳單帳戶權限）→ 直接問她做了沒

## 怎麼動工（給實作的 session）

第一段、第二段 2026-09-17 談完了。**「她定的」那張表不要重新討論，「暫定」那三條她沒反對，照做。**
流程照 `.claude/skills/kickoff/SKILL.md` 的第三段、「交付」與「這一輪結束前」。

**開工前**

0. **A 組開工前**：照「只有她做得到的事」→「怎麼檢查」驗一次。之後的組不用再驗，除非撞到權限錯誤
1. `git status`、`git log --oneline -5` 看做到哪；每一支 issue 的 `Status:` 是真相
2. `git fetch origin`。這一組的分支已經在 → origin/develop 動過就 **rebase，不要重開**；
   這一組還沒有分支 → 上一組合進 develop 之後才從 `origin/develop` 開（`claude/ai-photo-capture-<組>-<日期>`）。
   上一組還沒合就要接著做的話，先讀 memory 那則「疊 PR 要先合上層那支」再決定
3. A 組的第一個 commit 是「開 issue」：這個資料夾 ＋ `tests/no-secrets.test.js`（`NOT_A_NAME` 加了「二返」「共計」），`npm test` 綠了才提交

**每一支**

- 照那支 issue 的「判準」做；有程式行為的先寫會紅的測試、跑過確認真的紅
- `npm run verify`，**不要全跑 E2E**；新的 E2E spec 登記進 `tests-e2e/related.js`
- `Status:` 改 `done` 跟程式放同一個 commit；**一支一個 commit**，不 amend
- **repo 是 public**：commit 訊息、測試、fixture、ADR 一個真名、病歷號、健康資訊都不可以有。
  `.local/references/` 的照片與 `圖片對照.md` 只看不抄，例子一律王小明、1234。04 的考試終端機只印數字
- 06、08、13 的畫面先走 `/frontend-design`；ADR 與 `CONTEXT.md` 照 `docs/agents/domain.md`
- `public/` 動到就升 `public/sw.js` 的 `VERSION`（開工時 v128），**一組一個號**
- 動到 domain 規則或狀態機的（10～15）做完一支，跟她說「可以 `/clear` 了，下一支是 NN」

**一組做完就停**（A＝01～05、B＝06～07、C＝08～09、D＝10、E＝11～13、F＝14～15，16 跟最後一組）

回報三樣：這一組做了什麼、`npm run verify` 的結果、**一份她可以照順序點的手動驗收清單（自己真的走過）**。
**不要推、不要開 PR** —— 她會另外開一個 session 跑 `/matt-code-review`，審完才推。

**容易踩的**

- 01 是純文件，沒有會紅的測試。01 commit 在這條分支上就算「她的同意有紀錄了」，04 不用等合進 develop
- 02 改了 `tests-e2e/start-emulators.sh`：跑 E2E 前先依 port 停掉殘留的模擬器（memory 有一則）
- `deploy.yml` 的 firebase-tools 釘在 13，不要直接升版（02 寫了怎麼處理）
- Windows CRLF 會讓掃原始碼的測試假紅（memory 有一則）
- 實作與審查的 session **不要同時開**：同一個工作目錄、同一組模擬器 port

## 審查要特別看的（給 `/matt-code-review` 的 session）

固定點：`git merge-base HEAD origin/develop`。Spec 軸讀這一份 ＋ 這一組那幾支 issue 的「她要的」「判準」；
Standards 軸讀 `CLAUDE.md`（尤其連動表）、`docs/adr/`、`CONTEXT.md`。另外逐條問：

1. 抄字格式裡有沒有長出任何 id、狀態、課程、器材的欄位？Function 回傳前有沒有把多出來的欄位丟掉？
2. 有沒有任何一條路，讓不在 `allowedUsers` 的人花到 AI 的錢？上限與天花板是不是在叫 AI **之前**擋？
3. `functions/` 的 log、錯誤訊息、`aiUsage` 裡有沒有照片或辨識出來的字？
4. 訂購單、Abovee、文宣的照片有沒有任何一條路被存起來？辨識出來的字有沒有被存成草稿？
5. 對不上的人（`numberOnly`／`conflict`／`ambiguous`）有沒有被自動挑一位？
6. 建立時段是不是全部走 `slotFromPicks()`？新段是不是都帶 `INITIAL_STATUS`？Abovee 的「確認前往」有沒有變成「已確認」？
7. 療程單舊照片是不是**新的傳上去之後**才刪？比對區間有沒有超過最後一次簽名？
8. 畫面上有沒有「筆」；說明是不是都進了 `?`（新增客戶那一頁的 ⚠ 是她要的）；觸控區、input 16px、深色 token
9. 新集合有沒有 Rules 測試、進不進備份（`aiUsage` 刻意不進、`treatmentSheets` 要進）
10. commit 訊息、測試、fixture 有沒有真名、病歷號（`no-secrets` 掃不到 commit 訊息與只寫名的叫法）

審完：確定是問題的照建議修，**一件一個 commit**，修完 `npm run verify`；拿不準的列出來問她。
修完問她要不要推：推之前自己再看一次 commit 訊息，PR 開向 `develop`，內文不帶真名。

## 風險

| 風險 | 怎麼接住 |
|---|---|
| firebase-tools 釘在 13（`deploy.yml`）；部署 Functions 可能也要 serviceusage 權限，或 13 不認得新的 Node runtime | 02 第一次先由她本人從本機部署 staging；CI 那把帳號的角色看到實際錯誤訊息再一條一條補進 `docs/STAGING.md` |
| 原始照片 1 億像素，iOS Safari 的 canvas 上限約 1677 萬像素 | 06 用 `.local/references/images/` 那幾張 9000×12000 的在 iPad 上實測 |
| iPad 加到主畫面的 PWA 可能每次都重新問相機權限 | 06 實測；被拒時退回系統相機／相簿 |
| 手寫數字讀錯（10 堂看成 1 堂）會建錯額度 | 確認層每一列都看得到照片上的原字（07、09、13）；04 單獨算數量與金額那一欄的正確率 |
| Abovee 左右兩張只能照「第幾列」對起來 | 13：列數不一樣就不對，右半邊那幾格留空讓她選，而且畫面上講出來 |
| 3.8 Flash 查到的資料說只走 global 端點，不保證處理區域 | 01 的 ADR 記下來，02 動工時到 Agent Platform 文件確認 |
| Blaze 沒有花費上限 | 防護第 4 道是我們自己的硬上限 |

## 刻意不做

- **Firebase AI Logic**（瀏覽器直接叫）：免費層會拿內容改進產品、可能人工審閱；付費層也只擋 App Check、不擋白名單。
  另外 2026-11-02 起它強制 App Check。
- **Cloud Vision OCR**：只給一坨字，表格與勾選格要自己寫解析
- **錄影上傳 Abovee**：送給模型時大約一秒一格而且降畫質，小字讀不到，捲動時還糊
- **辨識草稿跨裝置續作**：她 9/17 說不用
- **尾款追蹤欄位、各項金額**：她 9/17 說不用
- **療程單定時自動比對**：她兩三個月拍一次，比對是她打開那一頁才跑

## 她要的（原話）

### 2026-09-17 第一則

> 我想在 app 裡加三個用 AI 的功能。這一輪先規劃，先不要動任何 code。
>
> 三件事：
> 1. 拍顧客會的單子 → 新增客戶；拍方案 → 新增方案範本
> 2. 拍壓表的電腦畫面（Abovee）→ 一口氣新增很多來訪
> 3. 定期拍診療單 → 確認「已到」「沒排錯」
>
> AI 只出候選，她確認之後才寫進去。寫入一律走既有的那幾支，AI 不可以自己寫 domain，
> 也不可以自己判斷課程／器材／狀態
>
> 這輪可以先協助我完成地基，像是API key 不能進瀏覽器，也不能進版控，照片存放，隱私 ADR，以及推薦的AI(像是不知道firebase有沒有提供免費的圖片辨識的AI)
>
> 一些想法 :
> 第一 我希望UIUX 是精心設計過的，要簡潔直觀並且排版舒服有呼吸感，動畫流暢精緻，可以參考一些網路大神的介面
> 第二 : 有關拍顧客會的單子 → 新增客戶，我希望可以在客戶那頁，長按右下角的那個加號(或是加點下去多新增一個選項是拍顧客會單子)然後可以進入派照或是選照片(可以多選照片)，如果可以不要調出去遍整面拍照就好了，可以沉浸式的在APP內拍，但也是可以切換成整面都是拍照的。然後拍完後，然後可以先辨識出是誰，甚麼時候的顧客會，買了什麼方案，加購什麼，欠尾款多少，然後點擊小鉛筆的icon可以微調，新增備註等等，限制
> 第二' : 突然發現我覺得新增一個客戶的介面UIUX好醜，希望可以重新設計，而且我發現"field__hint" 竟然沒有變成tooltip?難怪版面好擠，資訊太多太雜，以及最下面的card card--flat提醒，我覺得可以變成三角形警示提醒的icon的tooltip
> 第三 : 拍方案 → 新增方案範本，可以再設定方案範本新增旁邊多一個相機的icon，然後一樣是可以拍照選照片，然後說辯是到了什麼內容，然後可以微調，然後介面一樣不要太複雜
> 第四 : 拍壓表的電腦畫面（Abovee）→ 一口氣新增很多來訪，希望可以在壓表那頁，右下角多一個相機的懸浮泡泡，點了之後就可以拍照，選照片，然後可以說辯識到什麼，然後希望版面可以好好用心的設計，畢竟這可能一次會新增很多，有很多資訊，必須要能夠主次分明一目瞭然，要有層次感呼吸感，閱讀起來才舒服，然後一樣可以微調，然後我也會希望為調適有沉浸感的不要有種分割敢跳到另一個地方的感覺，不知道你懂不懂
> 第四 : 定期拍診療單 → 確認「已到」「沒排錯」，這個可以放在設定資料那個區塊，多一個拍診療單之類的，這個是可以存起來的 ? 就是我可以在這邊搜尋人名然後看到這個人的診療單，就是我拍照或是上傳照片，可以先辨識這是誰，然後和之前的比如果是新增的話那就替換掉那張照片，如果是不同的，那就新增照片，但是其實我也不會一直更新診療單，所以其實大部分的時候診療單的內容都是落後的，可能兩三個月一次吧 ? 這個診療單主要就是幫忙比對，客人確定有來有簽的時間段我有沒有漏壓到

她說的「診療單」在 `CONTEXT.md` 叫**療程單**（「診療單」在 _Avoid_ 名單上），畫面一律寫療程單。

### 2026-09-17 第二則

> 第一: Ai 防護要做好 不能被其他人用莫名奇妙的方式蹭到我的ai
> 然後也要給ai預算限制
> 如果可以的話可以在設定那邊看到目前用了多少ai錢
> 第二 : 關於 拍訂購單 → 新增客戶 ，想問你說的app 內取景拿到的是影片畫面，解析度比系統相機低，為什麼是影片?什麼叫內取景 ? 我說的是用相機拍顧客會的手寫的單子不是Abovee 螢幕上的小字?
> 第三 : 關於 新增客戶畫面重畫，以及 field__hint 為什麼沒變成泡泡 不管那就寬那支測試的禁令，照我這次說的，底部的「提醒」卡也tooltip掉連那兩句都不要禁，的確要排在訂購單功能前面
> 第四 : 回答你問的 :
> a ABC 策略都同意，出貨也照你的建議 4＋5 一起，其餘可以各自上 staging， issue我不用逐支看過，我相信你
> b 目前我都是Blaze，同意升，並並設一個月 US$10 的預算警示，但沒有辦法限制用量嗎 ? 就是怕被惡意陌生人濫用，也想知道有免費額度嗎?
> c 訂購單上有身分證字號 可以拍照送到我自己的雲端和 AI，但不要儲存
> d不用假資料考試，就直接拿真資料考試，目前好像gemini 已經出到flash3.8了 應該很夠用
> e 療程單被新版取代時真的刪掉，反正有紙本正本
> f 病歷號可以拿來認 Abovee 上的人嗎 ? 可以拿來交叉比對，人名和病歷號
> g 尾款寫成紅色備註就夠，目前暫時不需要一個會一直追到付清的欄位，各項金額不用記
> h Abovee 列表右邊被切掉的是哪幾欄，可以參考壓表壓完的照片-2，也想問如果會被切掉的話會建議我一次上傳兩張照片還是用錄影的 ? 目前是已經篩出自己的預約的了
> h' 想問在這個月的壓表清單上標成壓完會有甚麼效果嗎 ? 因為其實我壓完之後如果客戶在取消我有可能還是會新增來訪，但是也可能在日曆那邊新增來訪，想知道如果被標記成壓完會有什麼限制嗎?
> i 同名提醒照上面那樣做（姓名欄旁的 ⚠，存檔前再講一次），可以

（h' 的答案：「壓完」只影響進度條、卡片牆上的小標、「下一位」跳不跳過他，**不擋任何事**。
`domain/scheduling.js` 的 `markInQueue()`／`nextPending()`／`progressOf()`，與 `ui/views/schedule.js:519` 那個篩選。）

### 2026-09-17 第三則

> 1. 不知道，先當作不行好了，讓我一次上傳兩張圖片，也接受上傳一張
> 2. 可以記住就讓治療師主檔要多一格「Abovee 上的寫法」
> 3. 不需要放一個「這幾位標成壓完」的開關，直接標成壓完
> 4. 可以，辨識出來的字不存草稿，確認到一半離開就重拍一張

## 參考資料

她的照片在 `.local/references/images/`（`.gitignore` 擋著），逐張說明在 `.local/references/圖片對照.md`。
**這兩份有真名，一個字都不可以抄進 `.scratch/`、測試或 commit 訊息。**

- 訂購單 24 張：`訂購單-2026MM-NN-*.jpg`
- 療程單 13 張：`療程單-*.jpg`
- Abovee：`壓表壓完的照片.png`（左半）、`壓表壓完的照片-2.png`（右半）
- 方案文宣：`方案-筋骨強身-價目表.jpg`

價格與條款（2026-09-17 查的）：
[Gemini API 價格](https://ai.google.dev/gemini-api/docs/pricing)、
[Gemini API 條款](https://ai.google.dev/gemini-api/terms_preview)、
[Firebase AI Logic 價格](https://firebase.google.com/docs/ai-logic/pricing)、
[Storage 要 Blaze](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)、
[Cloud Run 價格](https://cloud.google.com/run/pricing)
