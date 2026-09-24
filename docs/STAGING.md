# 兩個環境：staging 與正式

這一份講的是**怎麼操作**。為什麼這樣設計寫在
`.scratch/PRODUCTION_AUDIT.md` 的 §3.1。

| | 正式 | staging |
|---|---|---|
| Firebase 專案 | `wellness-clinic-scheduler` | `wellness-clinic-staging` |
| 網址 | `wellness-clinic-scheduler.web.app` | `wellness-clinic-staging.web.app` |
| 上線方式 | push 到 `main` | push 到 `develop` |
| 資料 | 真的客戶 | 合成的假資料 |
| 畫面上 | 沒有橫幅 | 頂端一條橘色的「測試環境」 |

**一份原始碼跑兩個環境。** 沒有 build 步驟、沒有環境變數 ——
`public/js/firebase-config.js` 的 `envOf()` 照網址挑，所以兩邊部署的是
位元組相同的同一份程式。

---

## 一、第一次設定（只做一次）

Firebase Console 上建好 `wellness-clinic-staging`、開了 Firestore／
Authentication／Hosting 之後，還有五件事。

### 1. 開 Google 登入

Console → Authentication → Sign-in method → **Google** → 啟用。

同一頁的 **Authorized domains** 要有 `wellness-clinic-staging.web.app`
（建專案時通常自動就有）。少了它，登入彈窗會直接被擋掉。

### 1.5 補一個 IAM 角色（新專案幾乎一定要做這一步）

Console 下載下來的服務帳號金鑰（`firebase-adminsdk-…`），預設只有讀寫
Firestore 資料的權限，**沒有部署時要用到的權限**。

2024 年之後建立的新 Firebase 專案，Google 不再自動把 Editor 角色給那個
預設服務帳號了（舊專案因為是很久以前建的，還留著那個角色，這就是為什麼
正式環境的部署一直是好的，staging 卻不是）。少了它，`firebase deploy`
會在兩個地方 403：

- 測試 `firestore.rules` 編譯得過不過（`firebaserules.googleapis.com`）
- 問 Firestore API 開了沒（`serviceusage.googleapis.com`，firebase-tools
  14 開始才會問）

**症狀**：Hosting 部署成功，Firestore 那一步失敗，錯誤訊息是
`The caller does not have permission` 或
`Permission denied to get service […]`。**重新產生金鑰沒有用** ——
新金鑰還是同一個服務帳號、同一組角色，問題從來不在金鑰本身。

**補法**：Google Cloud Console → IAM 與管理 → IAM →
勾選「Include Google-provided role grants」才看得到那個帳號 →
找到 `firebase-adminsdk-…@<專案>.iam.gserviceaccount.com` → 編輯 →
新增角色 **Editor**（`roles/editor`）。

```bash
gcloud projects add-iam-policy-binding wellness-clinic-staging \
  --member="serviceAccount:firebase-adminsdk-fbsvc@wellness-clinic-staging.iam.gserviceaccount.com" \
  --role="roles/editor"
```

給 `Editor` 而不是逐條加最小權限，是刻意的：這條路以後還會用到哪些 Google
API 沒辦法先猜完，逐條補會變成每次升級 firebase-tools 都要再補一次。
`Editor` 正是舊專案的預設服務帳號本來就有的權限 —— 補到跟舊專案一樣，
不是給多的。

**改完不要用本機測**（見「三之二」那個框：本機只要 `firebase login`
過就測不準，會給出跟 CI 不一樣的假結果）。驗證方式：推一個空 commit 到
`develop`，到 GitHub Actions 看 `deploy` job 是不是綠的
（`git commit --allow-empty -m "驗證 IAM" && git push origin develop`）。

### 2. 推 Rules 與索引上去

**這一步不能跳過。** 新專案的預設規則是「30 天後全部拒絕」，而且一個索引都沒有 ——
沒推的話 app 打得開但每一頁都是「讀取失敗」。

```bash
npx firebase-tools@15 deploy \
  --only firestore:rules,firestore:indexes \
  --project staging
```

`--project staging` 認得出來是因為 `.firebaserc` 有這個別名：

```json
{ "projects": { "default": "…scheduler", "prod": "…scheduler", "staging": "…staging" } }
```

第一次會叫你登入（`npx firebase-tools@15 login`）。

索引要幾分鐘才建好，期間用到它的查詢會失敗。
到 Console → Firestore → 索引 看狀態，全部變成「已啟用」再繼續。

### 3. 部署 app 本身

```bash
npx firebase-tools@15 deploy --only hosting --project staging
```

之後這一步交給 CI（push 到 `develop`），這裡只是為了現在就打得開。

### 4. 把自己加進白名單

白名單是 `allowedUsers/{uid}`，而 `firestore.rules` 寫死了
`allow write: if false` —— **只能從 Console 手動加**。這是刻意的：
程式改不了誰有權限。

1. 打開 `https://wellness-clinic-staging.web.app`
2. 用 Google 登入
3. 畫面會說「這個帳號還沒有權限」並印出你的 uid，旁邊有一顆「複製 uid」
4. Console → Firestore Database → 開始集合
   - 集合 ID：`allowedUsers`
   - 文件 ID：**貼上剛剛那串 uid**
   - 欄位：不用填，空的就好
5. 回到 app 重新整理

> 兩個環境的 uid 是**不一樣的**（uid 綁專案，不是綁 Google 帳號）。
> 正式那邊已經加過了不代表 staging 這邊也有。

---

## 二、放一份假資料進去

```bash
# 需要一把 staging 的服務帳號金鑰，見下面第三節
GOOGLE_APPLICATION_CREDENTIALS=~/keys/staging-sa.json \
  npm run seed:staging -- --project staging --yes
```

- 二十位假客戶（王小明、李小華…），六個月份的來訪、額度、任務、可用性
- **一個真名都沒有**，全部是合成的
- 可重現（同樣的參數跑出同樣的資料），而且會先清掉上一輪種出來的東西
- 種完到 `#/settings/health` 跑資料健檢，**應該一條都不報** ——
  這樣之後任何一條 finding 都一定是你改出來的

不加 `--yes` 就只印出打算做什麼。`--customers 200` 可以拿來壓測。

---

## 三、服務帳號金鑰

寫進真的專案（不是模擬器）需要一把。

Console → 專案設定 → **服務帳戶** → 產生新的私密金鑰 → 下載那個 `.json`。

**那把金鑰繞過所有 Security Rules，等於整個資料庫的萬能鑰匙。**

- 放在 repo **外面**（例如 `~/keys/`）
- 絕對不要 commit —— `.gitignore` 有三條規則擋著，但別去試它
- 用完就用完，不要傳給任何人

CI 需要兩把，放在 GitHub repository secrets
（Settings → Secrets and variables → Actions）：

| Secret 名稱 | 內容 |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT` | 正式專案那把 `.json` 的**全文** |
| `FIREBASE_SERVICE_ACCOUNT_STAGING` | staging 那把 `.json` 的全文 |

貼的是整個檔案的內容，不是路徑。

---

## 三之二、`firebase-tools` 為什麼釘在 13（別隨手升上去）

`.github/workflows/deploy.yml` 的 `FIREBASE_TOOLS` 是 `firebase-tools@13`。
**升上去，正式與 staging 兩邊的部署都會 403。**

原因：firebase-tools **14 開始**，`deploy --only firestore:…` 會先打
`serviceusage.googleapis.com` 問「Firestore API 有沒有開」。那個呼叫要
`serviceusage.services.get` 權限，而 Firebase Console →「服務帳戶」→
「產生新的私密金鑰」給的那個 `firebase-adminsdk` 帳號，**兩個專案上都沒有它**
（新專案的預設服務帳號也不例外）。

症狀特別容易誤判：**Hosting 那一步會成功，只有 Firestore 那一步失敗** ——
看起來像 secret 設錯了，其實不是。而且**重新產生金鑰沒有用**：
新金鑰還是同一個服務帳號、同一組角色。

> ⚠️ **這裡曾經寫錯過一次，記下來提醒自己別再犯。**
> 早先這裡寫著「staging 的服務帳號有這個權限，所以升上去不會壞」——
> 那是在一台**已經用 `firebase login` 登入過專案擁有者帳號**的機器上,
> 用 `GOOGLE_APPLICATION_CREDENTIALS` 指到服務帳號金鑰測出來的「成功」。
> firebase-tools 在有本機登入狀態時,不保證每一條程式路徑都真的只用
> 環境變數指定的那把金鑰 —— 於是那次「測試」量到的其實是**登入帳號**
> 的權限,不是服務帳號的權限,兩者混在一起看起來完全正常,直到 CI
> （沒有登入狀態,只有那把金鑰）跑出跟正式環境一樣的 403。
>
> **教訓：驗證「一把 service account 金鑰單獨夠不夠權限」，只有 CI
> 那種乾淨環境算數。本機只要曾經 `firebase login` 過，測出來的結果就不可信。**

### 想升上去的話，先補權限

Google Cloud Console → IAM 與管理 → IAM → 找到
`firebase-adminsdk-…@<專案>.iam.gserviceaccount.com` → 編輯 → 新增角色
**Service Usage Consumer**（`roles/serviceusage.serviceUsageConsumer`）。

指令版：

```bash
gcloud projects add-iam-policy-binding wellness-clinic-scheduler \
  --member="serviceAccount:firebase-adminsdk-XXXXX@wellness-clinic-scheduler.iam.gserviceaccount.com" \
  --role="roles/serviceusage.serviceUsageConsumer"
```

**兩個專案都要做**，然後才把 `FIREBASE_TOOLS` 改成 `firebase-tools@15`。
改完先推一次 `develop`（上 staging）確認綠了，再進 `main`。

**只信任 CI 的結果，不要信任本機的「測試」**（見上面那個框）——
除非你在一台從沒 `firebase login` 過的機器上、只用
`GOOGLE_APPLICATION_CREDENTIALS` 測，那才算數。

---

## 三之三、拍照辨識（那一支 Cloud Function）

為什麼長這樣：[ADR-0100](./adr/0100-the-first-server-code-and-its-five-locks.md)（防護與上限）、
[ADR-0101](./adr/0101-photos-and-privacy.md)（照片與隱私）。這一節只講怎麼做。

staging 2026-09-17 做過一次。**正式環境在拍照功能要合進 `main` 之前照同樣的步驟再做一次**，
把 `PROJECT` 換成 `wellness-clinic-scheduler`。

### 一次性設定（每個專案一次）

```bash
PROJECT=wellness-clinic-staging

# 1. 登入（第 8 步要用 application-default 那一份）
gcloud auth login
gcloud auth application-default login
gcloud auth application-default set-quota-project $PROJECT

# 2. 開 API —— CI 那把服務帳號沒有權限開 API，一定要本人開
gcloud services enable aiplatform.googleapis.com cloudfunctions.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com run.googleapis.com \
  firebaseappcheck.googleapis.com recaptchaenterprise.googleapis.com --project $PROJECT

# 3. Function 用的服務帳號：只有兩個角色，不用預設那個權限很大的 compute 帳號
gcloud iam service-accounts create ai-extract --display-name="拍照辨識" --project $PROJECT
for ROLE in roles/aiplatform.user roles/datastore.user; do
  gcloud projects add-iam-policy-binding $PROJECT \
    --member="serviceAccount:ai-extract@$PROJECT.iam.gserviceaccount.com" --role=$ROLE
done
```

4. **App Check**：Google Cloud Console → reCAPTCHA → 建一把網站金鑰（類型「分數」），網域填
   `$PROJECT.web.app` 與 `$PROJECT.firebaseapp.com`。然後 Firebase Console → App Check →
   把網頁應用程式註冊成 reCAPTCHA Enterprise，填那把金鑰。
   **API 那一頁一個都不要按「強制執行」** —— Firestore、Storage 按下去，app 會整個讀不到資料
   （拍照那一支 Function 自己在程式裡強制，不靠這一頁）。
   金鑰（`6L` 開頭，不是密鑰）填進 `public/js/firebase-config.js` 的 `APP_CHECK_SITE_KEYS`
5. **預算警示**：帳單 → 預算與快訊 → 兩個專案、全部服務、US$10（帳單帳戶是台幣就填 320）、
   50／90／100% 寄信。**只寄信，不會停** —— 真正的上限是設定 → AI 用量那一格
6. **Storage**（療程單照片）：Firebase Console → Storage → 以正式版模式建預設 bucket，位置
   **US-EAST1**（staging 建在那裡，兩邊一樣；之後改不了）
6b. **第一次推 Storage Rules**（bucket 建好之後馬上做）。正式版模式建出來的 bucket 是「全部拒絕」，
   沒推的話療程單那一頁存照片會一直說沒有權限：

   ```bash
   npx --yes firebase-tools@13 deploy --only storage --project $PROJECT
   ```

   看到 `released rules storage.rules to firebase.storage` 就好了（staging 2026-09-17 推過）。
   之後 `storage.rules` 改了由 CI 推（`deploy.yml` 的「部署 Storage Rules」那一步）。

   **CI 那一步要多一個角色**：firebase-tools 13 推 Storage Rules 之前會先問 serviceusage
   「Storage 的 API 開了沒」（跟「三之二」講的 14 版推 Firestore 那個檢查是同一種）。
   CI 那把服務帳號（`firebase-adminsdk-…`）沒有那個權限的話，那一步 403、整個 deploy job 紅
   （Hosting 與 Firestore Rules 已經推上去了，只有照片的 Rules 沒更新）。
   2026-09-17 查的：**staging 那把有**（`roles/editor`），**正式那把沒有**。
   所以正式環境要補一個角色 —— Google Cloud Console → IAM → 找 `firebase-adminsdk` 那一個 →
   編輯 → 新增角色「Service Usage Consumer」（`roles/serviceusage.serviceUsageConsumer`）
7. **關掉 Gemini 的記憶體快取**（ADR-0101「Google 那一側」）。預設會把照片與抄出來的字在
   記憶體裡留 24 小時，關掉之後不留：

   ```bash
   curl -X PATCH \
     -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
     -H "Content-Type: application/json" \
     "https://us-central1-aiplatform.googleapis.com/v1/projects/$PROJECT/cacheConfig" \
     -d "{\"name\":\"projects/$PROJECT/cacheConfig\",\"disableCache\":true}"
   ```

   查現在的設定：同一個網址改成 `GET`，回來有 `"disableCache": true` 就是關了
8. 驗一次模型叫得到（一句話，不帶任何客戶資料）：

   ```bash
   curl -X POST \
     -H "Authorization: Bearer $(gcloud auth application-default print-access-token)" \
     -H "Content-Type: application/json" \
     "https://aiplatform.googleapis.com/v1/projects/$PROJECT/locations/global/publishers/google/models/gemini-3.8-flash:generateContent" \
     -d '{"contents":[{"role":"user","parts":[{"text":"回一個字：好"}]}]}'
   ```

`config/ai` **不用手動建**：沒有那一份就是每月上限 US$10、沒暫停。

**不做**：調低 Gemini 的每分鐘配額 —— 新版 Gemini 在 Standard PayGo 是共用額度，
不能設單一專案的上限（2026-09-17 查的）。

### 部署那一支 Function

**CI 還不會部署它**（`deploy.yml` 只推 Hosting、Rules、索引）。CI 那把服務帳號部署
2nd gen Functions 要的角色牽涉好幾個 Google 的系統帳號，看到實際錯誤訊息再一條一條補進這裡。
所以現在是從本機、用擁有者帳號部署：

```bash
npm --prefix functions ci
npx firebase deploy --only functions --project staging
```

Function 的程式改了才要重新部署；只改 `public/` 的話推 `develop`／`main` 就好。

第一次部署時 firebase-tools 會**自己再開兩個 API**（`firebaseextensions`、`eventarc`），最後還會說
「沒有清理規則」—— 舊的容器映像會一直累積、每個月多一點點錢。補一次（只保留一天內的）：

```bash
npx firebase functions:artifacts:setpolicy --project staging --location asia-east1 --force
```

部署完驗一次「沒登入的人叫不動」：

```bash
curl -s -X POST -H "Content-Type: application/json" -d '{"data":{}}' \
  https://asia-east1-$PROJECT.cloudfunctions.net/extract
# → {"error":{"message":"Unauthenticated","status":"UNAUTHENTICATED"}}
```

---

## 四、日常怎麼跑

```
從 main 開一個分支
      ↓
寫修法 + 一支會紅的回歸測試
      ↓
PR → CI 跑 npm test 與 npm run test:rules
      ↓
合進 develop → 自動上 staging
      ↓
在 staging 上用假資料實際點過那條路
      ↓
PR develop → main → 自動上正式
```

急件要跳過 staging 的話，直接 PR 進 `main` —— 測試照樣會跑。
但**只在真的急的時候**：staging 存在的理由就是不要在真資料上第一次執行一段新程式。

---

## 五、還原演練（每個月一次）

備份如果沒有被還原過，它只是一個 JSON 檔。

```bash
# 1. app 的設定頁 → 匯出備份（不用勾稽核）
# 2. 先看它打算做什麼
node scripts/restore-backup.mjs 排課系統備份-2026-09-02.json --project staging --dry-run

# 3. 真的還原到 staging
GOOGLE_APPLICATION_CREDENTIALS=~/keys/staging-sa.json \
  node scripts/restore-backup.mjs 排課系統備份-2026-09-02.json --project staging --wipe --yes
```

腳本最後會逐個集合數一次，數字對不上會以非 0 離開碼結束。

**療程單的照片不在備份裡**（ADR-0101）：還原的是抄出來的列，照片檔要是原本那個專案的
Storage 裡還在就看得到，不在的那一張卡會寫「照片不在備份裡」—— 那是預期的，有紙本正本。

想先不碰 staging 的話，對著模擬器演練也一樣算數：

```bash
npm run emulators          # 另一個終端機
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 \
  node scripts/restore-backup.mjs 備份.json --project demo-scheduler --wipe --yes
```

三條寫死的安全規則：

- 沒有 `--yes` 就不寫任何東西
- 沒有 `--allow-prod` 就**拒絕**跑在正式專案上
- `--wipe` 是軟刪除（寫 `deletedAt`），不是真的刪 —— 跟 app 自己的刪除同一條路

---

## 六、本機

```bash
npm run emulators   # Auth + Firestore + Functions + Hosting + Storage，開在 127.0.0.1:5000
npm test            # 純函式測試與靜態守衛，不用模擬器
npm run test:rules  # Firestore 與 Storage 的 Rules，會自己起一組模擬器（要先關掉別的）
npm run test:e2e    # Playwright，要模擬器在跑
```

模擬器裡的拍照辨識**不叫 Gemini**：它照 `tests-e2e/fixtures/ai/` 回假抄字，
防護照樣跑（ADR-0101：CI 與 E2E 永遠不送真照片）。第一次起模擬器時
`start-emulators.sh` 會自己裝 `functions/` 的套件。

本機的 `localhost` 與 `127.0.0.1` 一律連模擬器，
專案 id 是 `demo-scheduler` —— `demo-` 開頭讓 Firebase 進入完全離線模式，
任何沒被模擬到的服務會直接報錯，而不是安靜地打到真的專案上。

那個 id 要跟三個地方一致（`firebase-config.js`、`start-emulators.sh`、
E2E 的 fixture），`tests/env.test.js` 盯著。

---

## 七、上線前檢查表

完整版在 `.scratch/PRODUCTION_AUDIT.md` 的 §3.4。最容易漏的四件：

- [ ] 改了 `public/` 底下任何檔案 → **`sw.js` 的 `VERSION` 加一了嗎**
      （測試只盯 SHELL 清單，不盯版號）
- [ ] 改了 `SYNC_FORMAT` → 回 Google 試算表重新貼一次 `.gs` 並**重新部署**
- [ ] 改了 `firestore.indexes.json` → 部署後到 Console 確認索引真的「已啟用」
- [ ] 部署後在正式環境跑一次 `#/settings/health`，**findings 數量跟部署前一樣**
      （突然多出一堆＝新版寫壞了東西）
- [ ] 改了主檔的形狀（多一個欄位要她自己填）→ **她自己要做一次的那幾步**
      有沒有寫進 [操作手冊](./操作手冊.md) 的最後一節
- [ ] 拍照功能第一次進 `main` → 正式環境照「三之三」做完了嗎：尤其 **6 建 bucket、6b 推一次
      Storage Rules、CI 那把補 Service Usage Consumer** —— 少一樣，`deploy` job 的
      「部署 Storage Rules」那一步會紅，療程單在正式環境存不了照片
- [ ] 同一次還有兩件 CI 不會替你做的：**4 的正式金鑰填進 `firebase-config.js` 的
      `APP_CHECK_SITE_KEYS.prod`**（現在是 `null`）、**從本機部署一次 Function**
      （「部署那一支 Function」，`--project` 換成正式）。少一樣的話正式站的相機按鈕照樣看得到，
      但每一次辨識都被擋 —— 沒有金鑰是「驗證不過」，沒有 Function 是「辨識失敗」

> **2026-09-24 那一輪**：`SYNC_FORMAT` 從 5 跳到 6（來訪紀錄一段一行帶狀態、多一段「買過什麼」），
> staging 與正式各自接的那一份試算表都要**重貼 `.gs` 並重新部署**（步驟在 `sheets/README.md`「升版之後」）。
> 沒重貼的那一份會整包拒收，設定 → 試算表報表那一張卡會講出來。
>
> **2026-09-06 那一輪**：`SYNC_FORMAT` 從 3 跳到 4（試算表多了「這一天用了哪一台」
> 的註記），所以 `.gs` **一定要重貼並重新部署**。另外還有三步要她自己做一次
> （課程改名、器材選課程、資料健檢按兩列），列在
> [操作手冊 §九](./操作手冊.md#九升上去之後要做一次的三件事)。
