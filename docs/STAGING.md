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
npm run emulators   # Auth + Firestore + Hosting，開在 127.0.0.1:5000
npm test            # 純函式測試與靜態守衛，不用模擬器
npm run test:rules  # Security Rules，會自己起一個模擬器（要先關掉別的）
npm run test:e2e    # Playwright，要模擬器在跑
```

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
