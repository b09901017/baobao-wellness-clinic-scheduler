# 上線前總體檢：架構、靜默錯誤與維運策略

盤點日期：2026-09-01　·　基準 commit：`d56bcaa`　·　分支：`claude/readable-log-and-spacing`

> ## 2026-09-02 更新：報告裡的哪幾條已經做掉了
>
> 底下**整份報告的內容一個字都沒有改**，它是 2026-09-01 那一天看到的樣子。
> 這一段只記錄後來動了什麼，以及**沒有動的那幾條為什麼沒動**。
>
> | 報告的哪一條 | 狀態 | 做了什麼 |
> |---|---|---|
> | §3.1 沒有 staging | ✅ | `firebase-config.js` 照網址挑環境（`envOf()`），`.firebaserc` 兩個別名，非正式環境畫一條橘色橫幅、分頁標題也帶著。`tests/env.test.js` 盯著三個 projectId 不會走散 |
> | §3.2 備份只出不進 | ✅ | `scripts/restore-backup.mjs`。已經對著模擬器完整演練過「dry run → 寫入 → 逐集合對帳」，Timestamp 還原得回真的時間戳。`tests/restore-backup.test.js` 盯著它跟 `data/backup.js` 的 `exportAll()` 對得上 |
> | §3.2 假資料 | ✅ | `scripts/seed-staging.mjs`。二十位假客戶，**跑完資料健檢是 0 findings**（已驗證），可重複執行 |
> | §2.7 盲區二 Rules 不在 CI | ✅ | `npm run test:rules`（82 支，已跑過）進 CI，用 `emulators:exec` 自己起自己關 |
> | §2.1 離線寫入靜默 | ✅ | `withSaveState()` 8 秒逾時 → 換一句**不說失敗**的話；`ui/net.js` + 殼上常駐的離線橫幅；`tests-e2e/specs/10-offline.spec.js` 三支盯著 |
> | §2.2 連點產生重複資料 | ✅ | 報告點名 3 條 + 寫守衛時**又抓到 3 條**（客戶詳情的隨手記、確認動線、來訪編輯器）。`tests/save-guards.test.js` 從此掃全站 |
> | §2.3 錯誤訊息未逃脫 | ✅ | `toast.js` 四條路與 `shell.js` 補 `esc()` |
> | §2.4 `listAll()` 無上界 | ✅ | 換成 `listForReport()`：沒做完的全部拿、做完的只拿最近 500 筆 |
> | §2.5 離線顯示「沒有權限」 | ✅ | `accessState()` 改成三態，多一頁「連不上」 |
> | §2.6 保險絲提早解除 | ✅ | `window.__appBooted` 移到真的畫出東西之後 |
> | §1.3 SPOF-3 健檢看不到 notes | ✅ | 快照加 `notes`，孤兒檢查涵蓋 `customerId` 與 `entitlementId`（後者是營養品交付寫不進去的那條路） |
> | §2.7 盲區三 `sw.js` 從沒被測過 | ✅ | O3 那一支開回 service worker，所以它現在真的被執行了 |
> | §2.7 盲區六 模擬器用正式 id | ✅ | 三個地方一起換成 `demo-scheduler` |
> | **§2.8 git 歷史裡的真名** | ⬜ **沒動** | 洗歷史是破壞性操作，而且是**她的決定**。維持原判斷：repo 保持 private |
> | §2.7 盲區一 `/data` 沒有單元測試 | ⬜ **沒動** | `/data` 的檔案 import 的是 `https://www.gstatic.com/...`，Node 載不動 —— 要補得先改掉那個 import 方式，而那是 `tests/layering.test.js` 在守的架構決定。E2E 已經涵蓋 `save()`，不值得為了測試改架構 |
> | §2.9 其他 P2 七條 | ⬜ **沒動** | 都是觀察項，沒有一條會擋上線 |
>
> 操作手冊在 [`docs/STAGING.md`](../docs/STAGING.md)。

盤點方法：讀 `public/js/data`、`public/js/domain`、`firestore.rules`、
`firestore.indexes.json`、`.github/workflows`、`graphify-out/GRAPH_REPORT.md`，
並實際跑一次 `npm test`（1278 過、0 失敗、1 跳過）。

**這份報告只讀不改。** 沒有動到任何一行程式、沒有新增功能。
底下每一條發現都附檔案與行號，可以自己去看。

---

## 摘要：先看這一段

這個 codebase 的品質比一般 AI 生成的專案高出很多。分層是被測試守住的
（`tests/layering.test.js` 讓「只有 /data 能碰 SDK」變成會紅的東西）、
每一個決定都有 ADR、每一次寫入都有稽核與軟刪除、Security Rules 是真的防線而不是裝飾。
**上線的阻礙不在程式寫得好不好，在它周圍還缺三樣東西。**

| 等級 | 件數 | 一句話 |
|---|---|---|
| P0 上線前必須處理 | 4 | 離線寫入會靜默、備份沒有還原路徑、沒有 staging、git 歷史有真名 |
| P1 上線後兩週內 | 8 | 三條連點會產生重複資料的路、錯誤訊息未逃脫、無上界的高頻讀取 |
| P2 觀察 | 7 | 讀取量成長、多分頁、健檢覆蓋不到的集合 |

**最重要的一句話**：Firestore 的寫入 Promise 在離線時**既不 resolve 也不 reject**，
而這個 app 的整套錯誤處理都建立在「失敗會丟例外」這個假設上。
她在公司大樓裡用行動網路（SPEC 6.9 反覆提到的情境）就是這條路。詳見 §2.1。

---

# 階段一：資料結構與架構掃描

## 1.1 資料模型現況

### 集合一覽（11 個頂層 + 2 個子集合 + 7 個主檔子集合）

| 路徑 | 內容 | 誰寫 | 備註 |
|---|---|---|---|
| `customers/{id}` | 客戶本人 | `data/customers.js` | 軟刪除，`name` 必填 |
| `customers/{id}/entitlements/{id}` | 額度（single / pool / product） | 同上 | 帶 `doneCount`／`bookedCount` **快取欄位** |
| `customers/{id}/availability/{id}` | 一個月一份的可用性收集 | 同上 + `formResponses.take()` | 一份就是一個月（ADR-0053） |
| `visits/{id}` | 某人某天到院一次 | `data/visits.js` | `slots[]` 內嵌，不是子集合 |
| `tasks/{id}` | 待辦 | `data/visits.js`（連帶）＋ `data/tasks.js` | 幾乎都不是手動建的 |
| `notes/{id}` | 隨手記（有日期的就是日曆上的「待辦」） | `data/notes.js` | 也扛營養品交付的觸發 |
| `events/{id}` | 行事備註／休假 | `data/events.js` | 唯一可以跨天的資料 |
| `batches/{id}` | 壓表批次 | `data/batches.js` | `queue[]` 建立時凍結 |
| `audit/{id}` | 稽核 | `data/repo.js`（唯一來源） | append-only，沒有 `deletedAt` |
| `config/app` + `config/app/{type}/{id}` | 設定值 + 7 種主檔 | `data/config.js` | rooms / staff / equipment / ivProducts / products / courses / plans |
| `formInvites/{token}` | 發給客戶的連結 | `data/formInvites.js` | **文件 id 就是 token** |
| `formResponses/{token}` | 客戶填回來的 | `data/publicForm.js`（未登入） | id 也是 token，一條連結一份答案 |
| `allowedUsers/{uid}` | 白名單 | **只能 Console 手動改** | Rules 寫死 `allow write: if false` |

### 關聯圖（沒有外鍵，全部是字串 id）

```
customers ──┬─ entitlements ──┬── followupForEntitlementId ──► 同層的另一筆（二返↔健檢）
            │                 ├── productId / items[].productId ──► config/app/products
            │                 └── ivProductId ──► config/app/ivProducts
            └─ availability

visits ─── customerId ────────────────────────────────────────► customers
       └── slots[] ─┬─ entitlementId ────────────────────────► customers/{c}/entitlements
                    └─ courseId / roomId / staffId /
                       equipmentId / ivProductId ────────────► config/app/*

tasks ──┬─ customerId ──► customers
        └─ visitId ────► visits（可為 null＝手動待辦）

notes ──┬─ customerId ─────► customers（可為 null）
        └─ entitlementId ──► 那一包營養品（交付要寫回它的 deliveries[]）

formInvites{token} ──customerId──► customers
formResponses{token} ──take()──► 新增一筆 customers/{c}/availability

batches.queue[] ──► customerId[]
audit.targetPath ──► 任意文件路徑（純字串，沒有反向索引）
events ──► 誰都不指（刻意的，ADR-0015）
```

### 優點

1. **真相只有一份，其餘都是可重算的快取。** `doneCount`／`bookedCount` 存在
   entitlement 上只是為了客戶總覽的快路徑，而 `domain/entitlements.js` 的
   `counts()` 永遠可以從 visits 重算，`reconcile()` 拿它去對帳，資料健檢頁
   把差異顯示出來**但不偷改**（ADR-0004、0007）。
   這是我看過最乾淨的 denormalization 處理方式。
2. **軟刪除是做不到的例外，不是要記得的規矩。** `firestore.rules` 全部集合
   `allow delete: if false`，`repo.list()` 一律補 `where('deletedAt','==',null)`。
   想繞過去就得自己 import SDK，而 `tests/layering.test.js` 會抓到。
3. **稽核不可能漏。** 它跟本體資料在同一個 `writeBatch` 裡
   （`data/repo.js:129-166`），不是事後補的。Rules 那邊 `update, delete: if false`。
4. **快照而非連結。** `visit.slots[].courseName`、`entitlement.sourcePlanName`
   都是文字快照 —— 主檔改名不會回頭改寫歷史（ADR-0003）。這是對的。
5. **未登入寫入只開一個洞，而且守得很緊。** `formResponses` 的
   `validNewResponse()` 逐欄驗型別與長度、`submittedAt == request.time`
   不接受客戶端指定時間、`hasOnly()` 擋掉夾帶欄位、`get` 與 `list` 分開
   （寫成 `read` 的話任何人都能撈出全部客戶姓名）。

### 缺點與風險

1. **`audit` 無上界成長，而且沒有生命週期策略。** 每一次寫入都追加一筆，
   內含完整的 `before` 與 `after`。以她的用量估算一年會累積到數萬筆，
   而且**永遠不會被清掉**（Rules 禁止 delete，這是刻意的）。
   目前沒有任何 TTL 或封存機制。
2. **`audit.before` 沒有大小上限。** 它抄的是整份舊文件。一筆 `visits` 帶十幾個
   slot、或 entitlement 的 `deliveries[]` 累積很多筆之後，稽核文件跟著變大。
   Firestore 單筆上限 1 MiB，撞到的話是**整個 batch 失敗**，連本體資料都寫不進去。
   目前離上限還很遠，但沒有守衛也沒有測試。
3. **`repo.commit()` 不是 transaction。** 它先 `getDoc()` 讀 before
   （`data/repo.js:120-123`），再 `writeBatch()` 寫（第 168 行），
   兩者之間沒有版本檢查。單人使用時風險低，但**兩台裝置同時開著**就會
   last-write-wins，而且稽核上的 `before` 可能已經不是真的 before。
4. **`config` 用了一個 Firestore 不太自然的路徑。** `config/app/{type}/{id}`
   —— 檔案裡老實寫了原因（SPEC 的 `config/courses/{id}` 在 Firestore 不合法）。
   代價是 Rules 只能用 `match /config/{docId=**}` 一條萬用規則涵蓋，
   **主檔完全沒有形狀驗證**（對比 `validCustomer()`／`validVisit()` 那些）。
   任何白名單內的人都可以往 `config` 寫入任意形狀的文件。
5. **`events` 是孤島。** 它不指任何人，也沒有任何檢查會看它。見 §1.3 SPOF-3。
6. **沒有任何欄位級的 PII 標記或加密。** 客戶姓名、病歷號、健康資訊全部是明文欄位。
   這對這個規模是合理的取捨（防線是 Rules + 白名單），但要知道：
   **拿到白名單 uid 的人可以讀全部資料**，沒有第二層。

---

## 1.2 模組依賴熱點：改了哪裡最容易連坐

實測扇入數（有幾個檔案 import 它）：

```
22  domain/dates.js          ← 幾乎全站
 9  domain/visits.js         ← 最危險的那一支
 8  domain/masterData.js
 7  domain/visitTime.js
 7  domain/products.js
 7  domain/followups.js
 6  domain/taskRules.js
 5  domain/scheduling.js / notes.js / entitlements.js
--- UI 元件 ---
20  components/form.js
13  components/dialog.js
```

`graphify-out/GRAPH_REPORT.md` 的 god nodes 指向同一組：
`esc()` 207 條邊、`icon()` 88、`shortDate()` 80、`isValidDate()` 71、`todayISO()` 68。
**沒有偵測到任何 import 循環**，這在三萬行的專案裡很少見。

### 一級雷區 A：`domain/visits.js` 的 `STATUS_VIEW`（第 66-84 行）

改一個狀態的顏色、標籤或符號，會同時動到：

- 日曆的月／週／日三個檢視（`ui/views/calendar.js`，1482 行）
- 客戶詳情的來訪列（`ui/views/customerDetail.js`）
- 進度追蹤（`ui/views/progress.js`）
- 待辦中心（`ui/views/home.js`，2847 行）
- 試算表報表的勾選格（`domain/sheetReport.js` → `sheets/readonly-report.gs`）
- `app.css` 的 `.status-*` 與 `tokens.css` 的色值（淺色 + 深色**兩份**）

好消息是這是**刻意集中**的，而且 `tests/visits.test.js` 與 `tests/tokens.test.js`
兩邊盯著。壞消息是**日曆的七種顏色已經用完色相了**（ADR-0039、0045：
休假走斜線紋、待辦走方框勾勾，都是因為顏色不夠）。
**下一次要在日曆上多畫一種東西，就是一次跨六個檔案的改動。**

### 一級雷區 B：`data/visits.js` 的 `save()`（第 128-147 行）

這是整個系統寫入面最集中的一點。一次呼叫會在**同一個 batch** 裡寫：

```
1. 來訪本身（create 或 update）
2. countOps()    → 動到的每一筆額度的 doneCount / bookedCount
3. taskOps()     → syncTasksForVisit() 算出的任務增/改/刪
4. followupOps() → syncFollowupTasks() 算出的「約二返」鏈條
```

原子性是對的（半套資料比整個失敗更糟）。但代價是：

- **一次寫入前要先讀 5 份資料**（既有任務、課程主檔、客戶額度、客戶任務、設定值），
  離線或訊號差時這一串都要等。
- `countOps()` 產生的是 `{op:'update', path: customers/{c}/entitlements, id}`，
  而 `repo.commit()` 第 132 行對不存在的文件會 `throw`。
  **一筆 slot 指向已經不存在的 entitlement，會讓整筆來訪存不進去**，
  訊息是 `customers/x/entitlements/y 不存在` —— 她看不懂，也不知道要去修哪裡。
  （資料健檢的「孤兒資料」找得到這種，但那是事後。）
- 呼叫端要傳 `customerVisits` 進來，這份快照可能是舊的。重算基於舊快照 →
  計數欄位歪掉 → 要靠資料健檢事後對帳。

### 二級：`ui/views/home.js`（2847 行）與 `ui/views/schedule.js`（1765 行）

這兩支是全專案最大的檔案，各自扛整個待辦中心與壓表流程。
`home.js` 一支裡有：待辦首頁七段、問時間、壓表登記、確認動線、簽療程單、
隨手記泡泡、看今天做了什麼。**它們沒有循環依賴，但任何一段的改動都要重讀
2800 行才敢確定沒踩到別人。**

ADR-0038 要求「壓表那一頁的任何互動不要接成整頁重畫」，所以裡面有大量
事件委派與局部重繪 —— 那是正確的決定，但也讓控制流變得難追。

### 已經被守住的耦合

`CLAUDE.md` 的「容易漏掉的連動」表是這個專案最有價值的資產之一，
而且大部分連動**都有自動化守衛**：

| 連動 | 守衛 |
|---|---|
| `public/` 改檔案 → `sw.js` 的 SHELL | `tests/shell-cache.test.js` |
| `SYNC_FORMAT` ↔ `.gs` 的 `SUPPORTED_FORMAT` | `tests/sheet-script.test.js:512` |
| `tokens.css` 加顏色 → 淺色/深色兩份 | `tests/tokens.test.js` |
| 新增集合 → `firestore.rules` 開洞 | `tests/rules.test.js:27` |
| 額度型態白名單 ↔ Rules | `tests/rules.test.js:60` |
| 改函式名漏改 import | `tests/layering.test.js`「每個具名 import 都對得上」 |
| 委派監聽掛錯層 | `tests/layering.test.js` 最後一支 |

**這些靜態守衛是這個專案抵抗「AI 改壞一半」的主要機制，價值很高。**

---

## 1.3 狀態流轉地圖與單點故障

### 來訪狀態機（`domain/visits.js:127-133`）

```
        ┌──────────────────► cancelled（終點）
        │              ┌───► done（終點・唯讀鎖定區）
pending_confirm ──► confirmed
        │              └───► no_show ──► confirmed
        └──────────────────► done / no_show
```

- 起點固定 `pending_confirm`（app 裡不存在還沒壓表的來訪）
- `done` 與 `cancelled` 是終點，改期＝取消 + 重排（SPEC 第 7 節規則 10）
- **Rules 刻意不擋狀態機**（ADR-0006）：擋了反向轉移就等於擋掉「復原」

### 三條連鎖鏈

```
【壓表鏈】壓一筆 → pending_confirm（不長任務）
            └─ 客人確認 → confirmed → acceptsNewTasks() 放行 → 長出登記任務
                                       （ADR-0027：任務等客人確認之後才長）

【健檢鏈】examine 結案 → 追蹤健檢報告（死線 +21 天）
            └─ 勾掉報告 → 同一個 commit 內長出「約二返」（死線從勾掉那天算）
                          規則全部在 domain/followups.js，ADR-0042

【交付鏈】買營養品 → 同一個 commit 建 entitlement + 一張有日期的隨手記
            └─ 勾掉隨手記 → 先問「給了哪些」→ 寫進 entitlement.deliveries[]
                            沒給完就不勾掉、只換文字（ADR-0059）
```

### SPOF-1（高）：`repo.commit()` 是所有寫入的唯一咽喉

`data/repo.js:113` 是全站**唯一**真正寫 Firestore 的地方
（`data/publicForm.js` 是刻意的例外，因為客戶沒有登入寫不了稽核）。

這個設計是對的 —— 它讓稽核與軟刪除變成做不到的例外。但要清楚知道：
**它壞掉的時候，全部都壞掉，而且是同一種壞法。** 目前它的行為完全依賴
`await batch.commit()` 會 resolve 或 reject 這個假設，而 §2.1 會說明那個假設不成立。

### SPOF-2（高）：任務只有一個生成點，而且沒有補償機制

`domain/taskRules.js` 的 `syncTasksForVisit()` 只在 `data/visits.js` 的
`save()` / `remove()` / `restore()` 三個入口被呼叫。如果一筆來訪的存檔因為
任何理由沒有跑完（見 §2.1 的離線情境、或 §1.2 的「額度不存在」例外），
**任務就不會存在，而且沒有任何東西會回頭補它。**

資料健檢有「逾期任務」但**沒有「應該有卻沒有的任務」這一項** ——
它檢查的是既有任務的死線，不是任務的完整性。
`domain/followups.js` 的「二返額度」是唯一補得回來的一種。

> 這是使用者最主要的痛點（`data/visits.js` 檔頭原話：「任務漏產生更糟」），
> 而目前的保障只有「跟來訪寫在同一個 batch 裡」。batch 沒送出去就什麼都沒有。

### SPOF-3（中）：資料健檢看不到一半的集合

`data/health.js` 的 `loadSnapshot()`（第 22-40 行）只讀：
`customers`、`entitlements`、`availability`、`visits`、`tasks`、`master`。

**沒有讀 `notes`、`events`、`batches`、`formInvites`、`formResponses`。**

所以以下狀況目前**沒有任何東西看得見**：

- 隨手記指向已刪除的客戶（`notes.customerId` 是孤兒）
- 隨手記指向已刪除的營養品額度（`notes.entitlementId` 是孤兒 →
  勾掉時交付紀錄寫不進去）
- 合併匯入一次寫進兩百多筆 `notes`，一筆都不在健檢範圍內
- `formResponses` 卡在收件匣沒被處理
- `batches` 永遠停在 `active`

### SPOF-4（中）：試算表同步的三段耦合，中間那段在版控之外

```
app 的 SYNC_FORMAT=3 ──POST──► 她 Google 帳號裡「已部署的那一份 .gs」
                                        ▲
                    repo 裡的 readonly-report.gs（SUPPORTED_FORMAT=3）
```

`tests/sheet-script.test.js:512` 只驗證 **repo 裡兩份對得上**。
它驗不到「她的試算表上實際跑的是哪一版」。
CLAUDE.md 已經寫明這個陷阱：對不上的話 app 照樣推、`.gs` 整包拒收，
**而畫面上看起來跟推好了一模一樣**。

好消息：`data/sheetSync.js` 把失敗痕跡留在 localStorage
（`ERROR_KEY` / `SKIPPED_KEY`），設定頁那張卡會講出來。
這一段做得比大多數專案好。

### SPOF-5（低）：白名單是單一 uid 集合，沒有降級路徑

`allowedUsers` 只能在 Firebase Console 手動改（Rules 寫死 `allow write: if false`）。
這是對的。但代價是：**她自己被鎖在外面的時候，app 裡沒有任何一條路救得回來。**
上線前應該確認至少有兩個可用的 uid 在白名單裡（她的手機與 iPad 若用同一個
Google 帳號則 uid 相同，這一點要實際驗證）。

---

# 階段二：邊緣情境與靜默錯誤盤點

## 2.1 P0：離線寫入永遠不會失敗，也永遠不會成功

**這是整份報告最重要的一條。**

### 事實

Firebase SDK 的寫入（`setDoc`、`updateDoc`、`WriteBatch.commit()`）回傳的 Promise
**只在伺服器確認之後才 resolve**。離線時：

- 寫入**立刻套用到本機快取**（畫面上讀得到）
- Promise **保持 pending**，不 resolve 也不 reject
- Firestore **沒有寫入逾時**，它會一直等到網路回來

它只在 `permission-denied`、`invalid-argument`、或 SDK 被 terminate 時 reject。

### 這個 codebase 的假設

`ui/toast.js:110-140` 的 `withSaveState()`：

```js
saving(pending);                            // ← 顯示「儲存中…」
try {
  const { result, undo } = await withUndo(fn);
  saved(success, ...);                      // ← 永遠不會執行
} catch (err) {
  failed(`儲存失敗：${err.message}`, retry); // ← 也永遠不會執行
}
```

整個 app 有 **62 個 `withSaveState()` 呼叫點**，全部走這一條。

### 實際會發生什麼

| 路徑 | 離線時的症狀 |
|---|---|
| 有傳 `key` 的（19 處） | 「儲存中…」不會消失。第二次按**接到同一個 pending Promise**，按鈕像是死了。資料其實在本機快取裡，網路回來會送出 |
| **沒傳 `key` 的（約 43 處）** | 「儲存中…」不會消失。她再按一次 → **本機再排一筆寫入**。網路回來時**兩筆都送出去** |
| 客戶表單 `form/page.js:285` | `state.busy` 擋住了重複送出（做得對），但按鈕永遠 disabled、永遠沒有訊息。客戶只看到卡住的畫面 |

### 佐證

```
$ grep -rn "onLine|'offline'|disableNetwork|waitForPendingWrites" public/js
（沒有任何結果）

$ grep -rn "unhandledrejection|window.onerror" public/
（沒有任何結果）
```

**整個專案沒有任何一處偵測離線狀態，也沒有全域的未捕獲例外處理器。**
`tests-e2e/` 也沒有任何離線情境（`grep offline tests-e2e/` 無結果），
而 `playwright.config.js` 還設了 `serviceWorkers: 'block'`，
註解寫著「離線那幾支要測 SW 時再自己開回來」—— 那幾支從來沒有被寫出來。

### 這違反了專案自己訂的規矩

`ui/toast.js` 檔頭寫著：

> 寫入狀態要誠實：未確認前不顯示成功，失敗要看得見並且能重試。
> 她在公司大樓裡用行動網路，訊號不穩是常態，不能靜默失敗。—— SPEC 6.9

前半句成立（它確實不會謊報成功）。**後半句不成立：失敗看不見。**

### 建議的修法方向（不在本次改動範圍，僅供規劃）

1. 在 `withSaveState()` 裡對 `fn()` 加一個 race 逾時（例如 8 秒），
   逾時後把 toast 換成「還沒送出去，會在連上網路後自動補送」而**不是**「失敗」——
   因為它真的不是失敗，資料在本機是安全的。
2. 開機時掛 `window.addEventListener('online' / 'offline')`，
   離線時在殼上顯示一條常駐橫幅。
3. 把 §2.2 那三條沒有 `key` 的建立路補上 `key`。
4. 加一支 E2E：`context.setOffline(true)` → 存一筆 → 斷言 UI 有講話 →
   `setOffline(false)` → 斷言只有一筆進去。

---

## 2.2 P1：三條連點會產生重複資料的路

`ui/toast.js` 的 `key` 機制（第 100-108 行的註解自己承認了這件事）：

> **沒有確認框的那幾條路完全沒有保護**：「儲存中…」只是一條 toast，
> 既不遮蔽也不鎖表單……雙擊「建立」＝ 兩位同名客戶。

實測：62 個呼叫點裡只有 **19 個**傳了 `key`。
其餘多數是冪等的（勾選、還原、狀態切換）或有二次確認框保護
——`confirmAction()` 一按下去就把節點移除，`openActions()` 也是
（`close({instant:true})` 在 `onPick` 之前就 `root.remove()`），
後面幾下落在不存在的元素上。這是 `07-chaos.spec.js` 的 C12／C13 會過的原因。

**但有三條既沒有 `key`、也沒有確認框、而且每次呼叫都建立新文件：**

### ① 收件匣「收下」→ 同一個月會有兩份可用性

`ui/views/formInbox.js:126`

```js
await toast.withSaveState(
  () => responsesData.take(row, invite, { today }),
  { pending: '收下中…', success: '收下了，可以拿來排班了' },
);   // ← 沒有 key
```

`data/formResponses.js` 的 `take()` 每次呼叫都
`{op:'create', path: customers/{c}/availability}`（自動 id，不是固定 id）。
連點兩下 → **同一個月兩份收集**。

而 ADR-0053 明訂「既有的重複資料由資料健檢的 `duplicateAvailability` 列出來，
**不自動合併**」—— 也就是說這一下誤觸會留下一筆需要她手動清理的資料，
而且要到壓表的時候才看得出來（壓表只挑得到其中一份，另一份是隱形的）。

### ② 待辦中心「產生連結」→ 客戶手上會有兩條連結

`ui/views/home.js:1893`

```js
await toast.withSaveState(
  () => invitesData.create({ customerId, customerName: nameOf(customerId), month, sentAt: today }),
  { pending: '產生中…', success: '連結好了，複製訊息貼到 LINE' },
);   // ← 沒有 key
```

對照：**客戶詳情那個入口有守住**（`ui/views/customerDetail.js:574`
`key: invite:create:${ctx.customer.id}:${month}`）。
兩個入口同一件事，只有一個有保護 —— 而**沒保護的那個是她會連續按十二次的那個**
（一輪問十幾位客戶）。

### ③ 右下角快速記事泡泡 → 兩筆一模一樣的隨手記

`ui/views/home.js:927`

```js
await toast.withSaveState(
  () => notesData.create({ text, date: note.read(drawer), ... }),
  { success: '記下來了' },
);   // ← 沒有 key
```

對照：`#/todo/notes` 那一頁的 `addNote()`（`home.js:1105`）**有**
`key: note:create:${text}`。同樣是兩個入口一件事，只有一個守住。
而泡泡那個是 CLAUDE.md 列的四個共用入口之一，也是最順手、最容易連按的那個
（它刻意不重畫面板、焦點留在輸入框，所以按下去畫面幾乎沒有變化）。

> 這三條的共同形狀：**同一件事有兩個入口，其中一個補了 `key`、另一個沒有。**
> 這正是 CLAUDE.md 一直在警告的「多接一次的代價」，只是這次漏的是防護不是欄位。

### ④ 較低風險：日曆的來訪狀態切換

`ui/views/calendar.js:896` 也沒有 `key`（對比 `home.js:2564`、`schedule.js:1683`、
`visitEditor.js:611` **都有**）。實際上 `openActions()` 在回呼前就 `root.remove()`，
所以快速連點被擋住了。但**長按 → 選 → 等待中 → 再長按 → 再選**這條慢速路徑
仍然開著，而 ADR-0056 說「一筆來訪改得動的地方只有日曆」——
這是唯一的入口，卻是唯一沒補 `key` 的那個。

---

## 2.3 P1：錯誤訊息未逃脫，而且其中一條會帶進客戶姓名

專案的 XSS 紀律很嚴格 —— `esc()` 有 207 條邊，`07-chaos.spec.js` 的
C1 / C3 / C3b / C3c 專門測「髒字串顯示回來時是文字，不是標籤」。
**但錯誤路徑漏掉了。**

各個 view 都做對了（共 12 處）：

```js
ui/views/customers.js:71    `讀取失敗：${esc(err.message)}`   ✓
ui/views/home.js:127        `讀取失敗：${esc(err.message)}`   ✓
ui/views/calendar.js:1356   `讀取失敗：${esc(err.message)}`   ✓
```

**但這幾處沒有：**

```js
ui/shell.js:93       view.innerHTML = `<div class="card"><p>這一頁出錯了：${err.message}</p></div>`
ui/toast.js:126      failed(`儲存失敗：${err.message}`, ...)
ui/toast.js:57       failed(`復原失敗：${err.message}`)
app.js:20            toast.failed(`登入失敗：${err.message}`, ...)
ui/views/home.js:1733 / 2828   toast.failed(`刪到第 N 筆時失敗了…：${err.message}`)
```

而 `ui/toast.js:20` 的 `show()` 是 `node.innerHTML = html`。

**可利用的來源**：`data/legacyImport.js:67` 與 `:85`

```js
throw new Error(`「${plan.sheetName}」被跳過，沒有東西可以寫`);
throw new Error(`「${plan.sheetName}」有 ${missing.length} 個時段對不到額度`);
```

`plan.sheetName` 來自她舊 Google 試算表的分頁名，而**那些分頁名就是客戶姓名**
（`docs/legacy/README.md` 與合併 skill 的整套別名表都是為了處理這件事）。

實務風險等級：**低**（輸入來自她自己的試算表，不是外人）。
但它是真的路徑，而且會讓帶 `&`、`<` 的名字在錯誤訊息裡顯示成壞掉的樣子。
修法很小：`toast.js` 的 `show()` 收 text 而不是 html，或在四個呼叫端補 `esc()`。

---

## 2.4 P1：`tasksData.listAll()` 是唯一無上界又高頻的讀取

`data/sheetSync.js` 的 `buildBundle()`（第 108-123 行）：

```js
visitsData.listBetween(addDays(today, -400), addDays(today, 400)),  // ← 有界 ✓
tasksData.listAll(),                                                // ← 無界 ✗
```

`data/tasks.js` 的 `listAll()` 是 `repo.list('tasks', {})` ——
**全部未刪除的任務，從開站第一天到今天，沒有 limit、沒有日期條件。**

而 sheet sync 的觸發是 `repo.onCommitted(schedule)` → 任何一次寫入之後
10 秒推一次（`QUIET_MS = 10_000`）。

粗估：20 位客戶、每人每月數次來訪 → 每月約 200 筆任務 → 一年約 2400 筆。
若她一天分散有 6 次寫入叢集，就是每天約 **14,400 次讀取只為了推試算表**，
且逐年線性成長。Spark 免費方案是每天 50,000 次讀取。

**這不會突然壞掉，它會慢慢變慢、變貴，然後某一天配額用完。**
同一支檔案的 `listDone()` 已經有 `limit = 200` 並在註解裡解釋了同一個道理
（「一年之後這個集合有好幾千筆」）—— `listAll()` 漏掉了那個判斷。

其他無上界讀取（風險較低，因為頻率低）：

- `data/health.js` 的 `loadSnapshot()`：`repo.list('visits')` + `repo.list('tasks')`
  全量。資料健檢頁 + 每日一次的開機背景掃描（ADR-0008）。
- `data/backup.js` 的 `exportAll({includeAudit:true})`：把整個 audit 拉到手機
  記憶體裡再 `JSON.stringify(data, null, 2)`。一年後這會在手機上失敗，
  而且**檔案大小是下載完才告訴她的**（`countsOf()` 在抓完之後才跑）。

---

## 2.5 P1：離線開機會顯示「這個帳號還沒有權限」

`data/auth.js:33-40`

```js
export async function isAllowed(uid) {
  try {
    const snap = await getDoc(doc(getDb(), 'allowedUsers', uid));
    return snap.exists();
  } catch {
    return false;      // ← 讀不到 = 沒權限
  }
}
```

`app.js` 拿到 `allowed: false` 就 `renderGate(root, { state: 'notAllowed' })`，
畫面上寫著「這個帳號還沒有權限……到 Firebase Console 建一個 allowedUsers 集合」。

有離線快取時 `getDoc` 會從快取回答，所以日常不會遇到。
但在**新裝置第一次離線開啟**、或快取被清掉之後，她會看到一段完全誤導的指示，
而且照著做會去改 Firebase Console。

「讀不到」與「不在白名單」是兩件事，應該講不同的話。

---

## 2.6 P2：`index.html` 的保險絲在 app 真的畫出東西之前就被解除

`public/js/app.js:11`

```js
window.__appBooted = true;   // ← module 頂層，main() 之前
...
main();                      // ← 檔案最後一行
```

`index.html` 的 12 秒保險絲檢查的正是 `window.__appBooted`。
所以如果 `main()` 本身丟例外（例如 `initializeApp()` 拿到壞掉的 config），
**保險絲已經被解除，畫面會永遠停在「載入中…」**。

目前 `isConfigured()` 擋掉了 `REPLACE_ME` 的情況，所以觸發條件很窄。
但這個保險絲存在的理由就是「最壞情況下還能講話」，
而它現在有一個講不出話的最壞情況。

---

## 2.7 測試盲區清單

### 覆蓋得非常好的（不用擔心）

- **`/domain` 31 支全部有單元測試。** 這是這個專案最強的一段。
  1278 個測試、213 個 suite、全綠。
- **靜態守衛 7 支**（分層、import 完整性、SHELL 清單、tokens 雙份、
  Rules 開洞、`.gs` 版本、委派監聽位置）。
- **E2E 58 支**，涵蓋七條旅程 + 混沌 + UX 量測（對比度、觸控目標、橫向捲動）。
- **Rules 有真的跑在模擬器上的測試**（`tests-e2e/rules/firestore-rules.test.js`，
  R1–R10 十組），這比多數專案認真得多。

### 盲區一（高）：`/data` 幾乎沒有單元測試

18 支 `data/*.js` 裡，只有 `publicForm.js` 與 `tasks.js` 被 `tests/` import。

**`data/visits.js` 的 `save()`（§1.2 的一級雷區）沒有任何單元測試。**
它只被 E2E 間接覆蓋，而 E2E **不在 CI 裡跑**（見下）。

同樣沒有單元測試的還有：`repo.js`（`withUndo` 的巢狀行為、`commit()` 的
500 上限、`announceCommitted` 吞例外）、`health.js` 的 `applyFixes` 分批邏輯、
`sheetSync.js` 的失敗痕跡狀態機。

### 盲區二（高）：E2E 與 Rules 測試都不在 CI

`.github/workflows/deploy.yml` 的 `test` job 只跑 `npm test`，
而 `package.json` 的 `test` 是 `node --test "tests/*.test.js"` —— **只有 `tests/`**。

- `tests-e2e/specs/`（58 支 E2E）→ 只能手動跑，而且 `headless: false`、`workers: 1`
- `tests-e2e/rules/firestore-rules.test.js`（Rules 的真實測試）→
  **`package.json` 裡連一個 npm script 都沒有**，只能手動 `node --test` 配模擬器

所以：**每次 push 到 main，Rules 都會被直接部署到正式環境，
而它的測試從來沒有在那條路上跑過。** Rules 是這個系統唯一真正的安全防線。

workflow 的註解誠實寫了原因（要 Java、要模擬器、workers 必須是 1）。
這是可以解決的，見 §3.3。

順帶一提：CI 用 `npx firebase-tools@13` 部署 Rules 與索引，
但 `package.json` 的 devDependency 是 `firebase-tools@^15`。
**本機驗過的東西和 CI 部署的東西不是同一個版本。**

### 盲區三（中）：離線／網路失敗完全沒有測試

`grep offline tests-e2e/` 無結果。`serviceWorkers: 'block'`。
Service worker（`sw.js`，包含 3 秒逾時退回快取的邏輯）
**從來沒有被任何測試執行過**。

### 盲區四（中）：`/ui` 只有 5 支被 import 測試

`ui/views/home.js`（2847 行）與 `ui/views/customerDetail.js`（1656 行）
沒有單元測試，只有 E2E。它們也是改動最頻繁的檔案。

### 盲區五（中）：資料健檢看不到 4 個集合

見 §1.3 的 SPOF-3。`notes` 現在扛著營養品交付與日曆待辦兩個重要職責，
卻不在任何完整性檢查的範圍內。

### 盲區六（低）：`start-emulators.sh` 用的是正式專案 id

```sh
exec npx firebase emulators:start \
  --only auth,firestore,hosting \
  --project wellness-clinic-scheduler     # ← 正式專案 id
```

模擬器本身是本機的，資料不會外流。但 Firebase 建議測試用 `demo-` 前綴的
專案 id 才會進入完全離線模式 —— 用真實 id 的話，任何沒被模擬的服務會
**穿透到正式專案**。`tests-e2e/rules/` 那支已經正確地用了 `demo-rules-test`。

同一支腳本還寫死了
`JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot"`
—— 換一台機器或進 CI 就壞。

---

## 2.8 P0：git 歷史裡有七處真實客戶姓名（已知，待決定）

這不是我新發現的，是專案自己的追蹤紀錄：
`.scratch/pii-in-repo/issues/01-real-customer-names-are-committed.md`
**Status: open**。

- 工作區已經清乾淨了（換成「客戶A」、「王小明」等假名），並補了兩支測試
  （`tests/no-secrets.test.js` 的形狀檢查 + `.local/aliases.json` 交叉比對）
- **但那七處真名仍然留在 git 歷史裡**，橫跨 6 個檔案
- 洗歷史（`git filter-repo` + force push）是**使用者的決定**，還沒做

上線前必須確認的三件事：

1. **repo 現在是 private，而且要一直是。** 這是目前唯一的緩解措施。
2. 如果任何時候要把 repo 分享給同事、外包、或轉公開，
   **洗歷史從「知道有這回事」變成「必須先做」**。
3. GitHub Actions 的 log 也是一個外流面 —— 目前 `npm test` 不會印真名
   （那支測試刻意「只印檔名與命中幾個，不印是哪個名字」），這一點做得對。

---

## 2.9 其他觀察（P2）

| # | 觀察 | 位置 |
|---|---|---|
| 1 | `applyFixes()` 超過 200 筆會分成多次 commit，中途失敗會留下半套修正，而且復原變成 null | `data/health.js:69-75` |
| 2 | `persistentSingleTabManager` —— 開第二個分頁時持久化會失敗。多裝置／多分頁的行為上線前要實際驗一次 | `data/firebase.js:36-38` |
| 3 | `sheetSync` 的 dirty 旗標存在 localStorage，是**每台裝置各一份**。在 A 裝置寫入後改用 B 裝置，A 的待推永遠不會補 | `data/sheetSync.js:38` |
| 4 | `config` 集合完全沒有 Rules 形狀驗證（萬用 `match /config/{docId=**}`） | `firestore.rules:52-56` |
| 5 | `formResponses` 的 `allow update: if allowed() && keepsExistingId()` 不重驗形狀 —— 白名單內的人可以把回覆改成任意內容 | `firestore.rules` |
| 6 | `audit` 沒有任何保留策略，也沒有大小守衛 | 見 §1.1 |
| 7 | 沒有全域 `unhandledrejection` 處理器 —— view 之外丟出的例外靜默消失 | 全站 |

---

# 階段三：正式上線與未來維護策略

## 3.1 多環境隔離：Staging 與 Production

### 現況

```
.firebaserc:   { "projects": { "default": "wellness-clinic-scheduler" } }   ← 只有一個
firebase.json: hosting 沒有 target，firestore 沒有多資料庫
deploy.yml:    push main → channelId: live                                  ← 直接上正式
firebase.js:   usingEmulator() 判斷 location.hostname ∈ {localhost, 127.0.0.1}
```

**目前只有兩種環境：本機模擬器，與正式。中間沒有東西。**
而且 `usingEmulator()` 是靠 hostname 判斷的，所以**任何部署出去的網址
（包括 Firebase 的 preview channel）都會連到正式資料庫**。

### 建議做法：兩個 Firebase 專案 + 執行期切換（不需要 build step）

#### 第 1 步：開第二個 Firebase 專案

在 Firebase Console 建 `wellness-clinic-staging`（Spark 方案即可）。
Firestore、Auth（Google 登入）、Hosting 都開。

`.firebaserc` 改成：

```json
{
  "projects": {
    "default": "wellness-clinic-scheduler",
    "prod": "wellness-clinic-scheduler",
    "staging": "wellness-clinic-staging"
  }
}
```

#### 第 2 步：config 改成「照網址挑」，不是照 build 挑

這是純原生架構最優雅的做法 —— **不需要任何 build step、不需要環境變數注入、
兩個環境部署的是同一份原始碼**。

`public/js/firebase-config.js` 改成類似這個形狀（示意，本次不改）：

```js
const CONFIGS = {
  prod:    { apiKey: '…', projectId: 'wellness-clinic-scheduler', … },
  staging: { apiKey: '…', projectId: 'wellness-clinic-staging',   … },
};

// 前端 config 兩份都不是密鑰，兩份都可以 commit。
// 真正的防線是各自的 firestore.rules 與各自的 allowedUsers。
function envOf(host) {
  if (['localhost', '127.0.0.1'].includes(host)) return 'emulator';
  if (host.includes('staging')) return 'staging';
  return 'prod';
}

export const ENV = envOf(location.hostname);
export const firebaseConfig = CONFIGS[ENV === 'emulator' ? 'staging' : ENV];
```

`data/firebase.js` 的 `usingEmulator()` 改成讀 `ENV === 'emulator'`，
不要再自己判斷一次 hostname —— **一件事只判斷一個地方**
（這符合專案自己的規矩）。

#### 第 3 步：讓 staging 一眼認得出來

這一步比它看起來重要。她會兩邊都開著，**在 staging 上刪掉一筆資料然後以為
自己刪掉了正式的那一筆**（或反過來）是最容易發生的事故。

建議在 `ui/shell.js` 加一條只有非 prod 才畫的橫幅（橘底、寫
「測試環境・這裡的資料是假的」），並且把 `index.html` 的 `<title>` 加上前綴。
CLAUDE.md 的精神是「畫面在講一件不會發生的事，比沒講還糟」—— 反過來也成立。

#### 第 4 步：部署指令

```bash
# staging（手動，或由 develop 分支的 workflow 觸發）
npx firebase deploy --project staging --only hosting,firestore:rules,firestore:indexes

# production
npx firebase deploy --project prod --only hosting,firestore:rules,firestore:indexes
```

#### 第 5 步：CI 改成兩段

```
push 到 develop  → npm test → 部署 staging
push 到 main     → npm test → E2E（打 staging）→ 部署 prod
```

修 bug 的動線變成：

```
1. 從 main 開分支 → 寫修法 + 一支會紅的回歸測試
2. PR → CI 跑 npm test（現在也應該跑 Rules 測試，見 §3.3）
3. 合進 develop → 自動上 staging
4. 在 staging 上用匿名種子資料實際點過那條路
5. PR develop → main → 上正式
```

#### 順帶要修的兩件事

- CI 用 `npx firebase-tools@13`，devDependency 是 `firebase-tools@^15`。
  兩邊釘同一版。
- `tests-e2e/start-emulators.sh` 的 `--project` 改成 `demo-scheduler`，
  並拿掉寫死的 `JAVA_HOME`（改成「找不到才提示」）。

---

## 3.2 資料庫複製與匿名測試資料

### 原則：永遠不要把正式資料倒進 staging

即使匿名化過。理由有兩個：一是匿名化腳本本身會出錯（漏一個欄位就是真名進了
另一個資料庫）；二是這個專案已經有一個現成的、更好的東西。

### 你已經有一個種子資料產生器了

`public/js/domain/seed.js` + `data/config.js` 的 `loadSeed()` 產生主檔，
`tests-e2e/fixtures/data.js` 產生完整情境（`scenarioProducts()` 這一類）。
**這條路產出的資料一個真名都沒有，而且是可重現的。**

#### 方案 A（推薦）：合成資料，不是匿名化的正式資料

寫一支 `scripts/seed-staging.mjs`：

```
1. 讀 domain/seed.js 的主檔（診間、課程、器材、方案）—— 已經是假的
2. 產生 20 位假客戶（王小明、李小華…，用專案已經在用的那組假名）
3. 每位隨機展開 1-2 個方案 → 額度
4. 過去 6 個月隨機產生來訪，狀態依日期分布
5. 全部走 data/repo.js 的 commit()，這樣稽核與計數欄位都是對的
6. 用 --project staging 跑
```

好處：可重現、規模可調（要測效能就產 2000 筆來訪）、
**完全不需要碰正式資料庫**，而且它順便驗證了 `repo.commit()` 這條路。

#### 方案 B（需要真實形狀時）：匿名化匯出

只有在「合成資料重現不了那個 bug」時才用。步驟：

```
1. 在 app 裡按「匯出備份」（不勾稽核）→ 拿到 JSON
2. 跑一支 scripts/anonymize.mjs：
   - customers.name          → 「客戶A」「客戶B」…（固定映射表存在 .local/，gitignore）
   - customers.chartNo       → 隨機四位數
   - notes.text / visits.note / freeText → 整段換成「（已匿名）」
   - marks[].text            → 同上
   - customerName 的所有快照 → 依映射表換
   - formInvites/formResponses → 整個丟掉（token 也是識別資訊）
   - audit                   → 整個丟掉（before/after 裡有全部原文）
3. 加一道驗證：拿 .local/aliases.json 的名單去掃輸出檔，命中就中止
   （tests/no-secrets.test.js 已經有這個模式，可以直接借）
4. 匯入 staging
```

**注意 `audit` 一定要丟掉。** 它的 `before` / `after` 是完整文件副本，
匿名化腳本漏掉它等於什麼都沒做。

### 而這件事暴露了一個 P0 缺口

`data/backup.js` **只有 `exportAll()`，沒有 `importAll()`。**

```
$ grep -rn "importBackup|restoreBackup" public/js scripts
（沒有任何結果）
```

也就是說：那份「最後一道防線」的備份檔，**目前沒有任何程式讀得回去。**
它從來沒有被還原過，所以嚴格說起來它還不算備份，只是一個 JSON 檔。

`data/backup.js` 的檔頭自己寫著：

> Firestore 的 PITR 要 Blaze 方案，在那之前「每個月手動匯出一份存到雲端硬碟」
> 就是唯一的離線副本。

**上線前必須做的兩件事：**

1. 寫一支還原腳本（`scripts/restore-backup.mjs`），並且**在 staging 上真的跑一次
   完整的「匯出 → 清空 → 還原 → 比對」**。沒有演練過的備份不是備份。
2. 確認 Firebase 方案。如果還在 Spark，就是**完全沒有自動備份、沒有 PITR**，
   一次誤操作 + 一個月沒匯出 = 一個月的資料沒了。
   升 Blaze 開每日備份 + PITR 的成本以這個資料量來說很低，
   而且順便解掉 §2.4 的配額成長問題。**這是我在整份報告裡最強烈的一個建議。**

---

## 3.3 防退化防護網：優先級

**結論先講：先補 CI，再補 `/data` 的單元測試，E2E 放第三。**

理由是：`/domain` 的單元測試已經接近完備（31/31），再往那邊加是報酬遞減；
而 E2E 已經寫了 58 支、品質很高 —— **它們的問題不是不夠多，是沒有在跑。**

### 第 1 優先（本週）：讓已經寫好的測試真的跑

投報率最高，因為程式碼已經存在。

#### 1a. 把 Rules 測試接進 CI

這是唯一真正的安全防線，目前每次 push 都是未經驗證就部署。

```json
// package.json
"test:rules": "firebase emulators:exec --project demo-rules-test --only firestore \"node --test tests-e2e/rules/*.test.js\""
```

```yaml
# deploy.yml 的 test job 加上
- uses: actions/setup-java@v4
  with: { distribution: 'temurin', java-version: '21' }
- run: npm ci
- run: npm run test:rules
```

`emulators:exec` 會自己起、自己關模擬器，不需要背景程序。
用 `demo-` 前綴的 project id 就完全離線，不需要任何憑證。

#### 1b. 把 E2E 接進 CI（分階段）

`playwright.config.js` 已經寫好了 `CI=1` 的分支（自動轉無頭）。
擋路的是「workers 必須是 1，因為每支測試都清空 Firestore」。

最小可行做法：**先讓它以 `workers: 1` 在 CI 上跑**。
58 支 × 單 worker 大概 15-25 分鐘，對一天推幾次的專案完全可以接受。
先跑起來，之後真的嫌慢再做「一個 worker 一個 projectId」。

也可以先只跑 smoke + chaos 兩支（`00-smoke`、`07-chaos`），
那兩支加起來大約 3 分鐘，就能擋掉「整頁白屏」這一類的災難。

### 第 2 優先（兩週內）：`/data` 的單元測試 + 三個 P1 修補的回歸測試

**不要用 Playwright 測這些**，太慢。用 `@firebase/rules-unit-testing` 的
`initializeTestEnvironment()` 拿一個乾淨的 Firestore，直接呼叫 `data/*.js`。
Rules 測試已經證明這條路在這個專案上跑得通。

按價值排序：

| # | 測什麼 | 為什麼 |
|---|---|---|
| 1 | `data/visits.js` 的 `save()` —— 來訪 + 計數 + 任務三者同進同出 | §1.2 的一級雷區，目前只有 E2E 間接覆蓋 |
| 2 | `save()` 撞到不存在的 entitlement 時的行為 | 目前會丟一句她看不懂的話，而且整筆存不進去 |
| 3 | `data/repo.js` 的 `withUndo()` 巢狀與多批行為 | 復原給錯東西比沒有復原更危險（檔頭自己寫的） |
| 4 | 三條連點路徑（§2.2）各一支 | 補完 `key` 之後要有東西守著它 |
| 5 | `data/health.js` 的 `applyFixes()` 超過 200 筆的分批 | 半套修正目前沒有任何守衛 |
| 6 | `data/formResponses.js` 的 `take()` 冪等性 | 直接對應 §2.2 ① |

### 第 3 優先（一個月內）：關鍵路徑的離線 E2E

只需要三支，但它們補的是目前最大的洞（§2.1）：

```js
// O1 離線存一筆來訪 → UI 必須講話（不可以停在「儲存中…」）
// O2 離線連按三次「記下來」→ 恢復連線後只能有一筆
// O3 離線開 app → 不可以顯示「這個帳號還沒有權限」
await context.setOffline(true);
```

Playwright 的 `context.setOffline()` 對 Firestore 的 WebChannel 有效。
**這三支會紅** —— 那正是重點，它們是規格，不是回歸測試。

### 不建議做的

- **不要為了覆蓋率去補 `/ui/views` 的單元測試。** 那幾支是 DOM 組裝，
  單元測試會變成把 innerHTML 抄一遍，改版就全紅，然後就被關掉。
  E2E + `08-ux-audit.spec.js` 的量測（對比度、觸控目標、橫向捲動）
  已經是對的做法。
- **不要引入 TypeScript 或 build step。** `package.json` 明寫
  「刻意沒有執行期相依套件，也沒有 build 步驟」，而 `tests/layering.test.js`
  的「每個具名 import 都對得上真的匯出」已經抓到了 TS 會抓的那一類錯誤裡
  最要命的那一種。

---

## 3.4 日常上線檢查表

### A. 每次發布前（自動 —— 應該由 CI 擋，不靠記得）

- [ ] `npm test` 全綠（1278 支）
- [ ] `npm run test:rules` 全綠 ← **待建立，§3.3 第 1 優先**
- [ ] E2E smoke + chaos 全綠 ← **待建立**
- [ ] 沒有新增的 `console.error`（`00-smoke.spec.js` 的 S1 已經在測）

### B. 每次發布前（手動 —— 這些機器驗不到）

- [ ] **改了 `public/` 底下任何檔案 → `sw.js` 的 `VERSION` 有沒有加一？**
      （`tests/shell-cache.test.js` 只盯 SHELL 清單，**不盯版號**。
      漏了就是她開 app 看到舊版，而且不知道為什麼）
- [ ] 改了 `SYNC_FORMAT` → **她有沒有回 Google 試算表重新貼一次 `.gs` 並重新部署？**
      （對不上的話畫面看起來完全正常，但試算表停止更新）
- [ ] 改了 `firestore.indexes.json` → 部署後到 Console 確認索引**建好了**
      （索引在建立中的期間，用到它的查詢會直接失敗）
- [ ] 改了 `tokens.css` → 深色模式實際看過一次
- [ ] `README.md` 的開發狀態表打勾
- [ ] 新增集合 → `firestore.rules` 開洞 + `data/backup.js` 的 `exportAll()` 加一行
      （檔頭那條「新增集合時要回來加」在 `notes`／`events` 上被漏過一次）

### C. 部署後 5 分鐘的煙霧測試（在正式環境，只讀）

- [ ] 開 app → 登入 → 五個分頁都打得開
- [ ] 日曆這個月畫得出來，七種東西都在
- [ ] 隨便一位客戶的詳情頁 → 額度數字正常
- [ ] `#/health` 資料健檢 → **findings 數量跟部署前一樣**
      （突然多出一堆＝新版寫壞了東西）
- [ ] 設定頁的試算表同步卡 → 「上次成功」的時間是最近的
- [ ] **不要在正式環境按任何寫入按鈕來測試。** 要驗寫入就回 staging。

### D. 每月

- [ ] 手動匯出一份備份（不勾稽核）→ 存到雲端硬碟
- [ ] **在 staging 上實際還原一次那份備份**（§3.2 —— 沒還原過的備份不算備份）
- [ ] Firebase Console → 用量：讀取次數的成長趨勢（§2.4 的 `listAll()`）
- [ ] `audit` 集合的文件數（成長速度是否符合預期）

### E. 每季 / 觸發式

- [ ] repo 仍然是 private？（§2.8 —— 這是真名還在歷史裡的唯一緩解措施）
- [ ] 要分享 repo 給任何人之前 → **先洗歷史**
- [ ] `allowedUsers` 裡的 uid 還是預期的那幾個
- [ ] Firebase 方案：還在 Spark 就代表沒有自動備份

---

# 建議的行動順序

| 順位 | 做什麼 | 為什麼是這個順序 | 預估 |
|---|---|---|---|
| 1 | **確認 Firebase 方案，升 Blaze 開每日備份 + PITR** | 這一件事同時解掉「沒有備份」與「配額成長」兩個風險。買的是時間 | 30 分鐘 |
| 2 | **寫還原腳本並在 staging 演練一次** | 沒有還原路徑的備份不是備份（§3.2） | 半天 |
| 3 | **`npm run test:rules` 接進 CI** | Rules 是唯一的安全防線，目前未經驗證就部署 | 1 小時 |
| 4 | **補三處 `key`（§2.2 ①②③）+ 三支回歸測試** | 改動極小，擋掉的是會產生髒資料的路 | 2 小時 |
| 5 | **`withSaveState` 加逾時 + 全站離線橫幅** | §2.1，最大的靜默錯誤來源 | 半天 |
| 6 | **建 staging 專案 + hostname 切換 + 橘色橫幅** | 有了它之後，後面每一件事都可以先在安全的地方做 | 半天 |
| 7 | `tasksData.listAll()` 加時間界（比照 `listBetween`） | 一行的改動，擋掉逐年成長的讀取量 | 30 分鐘 |
| 8 | `toast.js` / `shell.js` 補 `esc()` | 小，但符合專案自己的紀律 | 30 分鐘 |
| 9 | E2E 接進 CI（先只跑 smoke + chaos） | 已經寫好的資產，只是沒在跑 | 半天 |
| 10 | 離線的三支 E2E（會紅，那是重點） | 把 §2.1 變成會紅的東西 | 半天 |
| 11 | `data/visits.js` 的 `save()` 單元測試 | 最集中的寫入點，目前只有 E2E 間接覆蓋 | 半天 |
| 12 | 資料健檢加上 `notes` / `events` 的孤兒檢查 | `notes` 現在扛著交付與日曆待辦兩個職責 | 半天 |
| — | 洗 git 歷史 | **只在要分享 repo 之前做**，否則維持現狀 | 她決定 |

---

## 附錄一：這次沒有動到任何東西

本次盤點是唯讀的。執行過的指令只有 `npm test`（讀取性質）與檔案讀取。
沒有修改、新增、刪除任何原始碼、設定檔或測試。
唯一新增的檔案是這一份報告。

## 附錄二：可以直接複製的驗證指令

```bash
# 目前的測試狀態
npm test

# 沒有傳 key 的 withSaveState 呼叫點
grep -rn "withSaveState(" public/js --include=*.js | grep -v ui/toast.js

# 有傳 key 的
grep -rn "key:" public/js/ui --include=*.js | grep -v "monthKey\|dayKey"

# 確認沒有離線偵測
grep -rn "onLine\|disableNetwork\|unhandledrejection" public/

# 未逃脫的錯誤訊息
grep -rn 'err\.message' public/js --include=*.js | grep -v "esc(err"

# 模組扇入（改哪裡最容易連坐）
for m in visits entitlements dates taskRules followups; do
  echo "$(grep -rl "domain/$m.js'" public/js --include=*.js | wc -l)  domain/$m.js"
done

# 架構圖（重跑不用花錢）
# graphify update .
```
