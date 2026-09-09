# 日常驗收只跑相關的那幾支 E2E

Status: done
來源：使用者，2026-09-09（「他的 e2e 都跑好久，能不能幫我針對日常開發優化執行速度」）

## 量到的東西

`.artifacts/results.json`（2026-09-08 那次全跑，headed）：

| | |
|---|---|
| 全跑（headed，`retries: 1`） | 25.1 分鐘 / 184 個測試 / 平均 8.2 秒一個 |
| 全跑（無頭，`retries: 0`，改完之後量的） | **19.6 分鐘** / 193 個測試 |
| 最貴的三支 | `07-chaos` 299s、`19-untick` 145s、`08-ux-audit` 86s |
| `page.waitForTimeout()` | 217 個呼叫，加起來純睡 **216 秒**（另見 issue 02） |

時間花在三個地方，順序就是解決的順序：

1. **`headless: false` + `slowMo: 80`**，佔掉大約一半。config 的註解自己寫著
   那是「為了她看得到測試在跑」—— 日常改一行程式付不起。
2. **每次都跑 24 支。**
3. 固定等待（issue 02）。

`workers: 1` **不是設錯的**：每一個測試都清空同一個 Firestore 命名空間，
兩個 worker 就是互相洗掉對方的資料庫。要平行得先讓一個 worker 一個 projectId，
而那個值同時寫在三個地方（`fixtures/emulator.js`、`start-emulators.sh`、
`public/js/firebase-config.js`，`tests/env.test.js` 盯著）。**這次沒動它。**

config 那句「`CI=1` 會自動轉成無頭並開三個 worker」是**過期的註解** ——
`workers` 是寫死的 1，`CI=1` 只關掉 headed。順手改掉了。

## 做了什麼

**預設無頭。** `playwright.config.js` 的 `HEADED` 從「不是 CI 就 headed」
改成「有 `HEADLESS` 或 `CI` 就無頭」，而 npm 那幾條路一律經過
`scripts/e2e.mjs`（它會設 `HEADLESS=1`）。要親眼看：`npm run test:e2e:watch`。

順便兩件跟著 headed 走的：本機無頭時 `retries: 0`（那個 0xC0000142
桌面堆疊的問題是 headed 才有的，而日常驗收要的是「壞了立刻知道」）、
`video: 'off'`（錄影是每一個測試都在錄，trace 查本機的失敗夠用了）。

**分級。** `tests-e2e/related.js` 是「哪些原始碼對應哪一支 spec」的唯一一份
對照表，`scripts/e2e.mjs --related` 拿 git 的差異去查它。

| 指令 | 跑什麼 |
|---|---|
| `npm run verify` | 單元測試 ＋ 相關的 E2E（**日常就用這個**） |
| `npm run test:e2e:related` | 只有相關的那幾支 |
| `npm run test:e2e:smoke` | 只有 `00-smoke` |
| `npm run test:e2e` | 全部，無頭 |
| `npm run test:e2e:watch` | 全部，headed ＋ slowMo |

`--related` 預設跟 `develop` 比（`--base HEAD~1` 換掉），而且**已 commit 的
與工作區還沒 commit 的都算** —— 只看 commit 的話「剛改完還沒 commit」
那個最常見的狀態一支都挑不到。

## 對照表爛掉的方式必須是大聲的

這份表是第二個要記得同步的地方，所以三道守衛：

1. `specs/` 底下每一支都要在表上（新增一支忘了登記 → `tests/e2e-related.test.js` 紅）
2. 每一條路徑都要真的存在（檔案搬走或改名 → 紅）
3. **認不出來的原始碼一律退回全跑**，並印出是因為哪個檔案

少列一條的代價是多跑幾支，不是「那一支沒跑到而且看不出來」。

`firestore.rules` 與 `firestore.indexes.json` 不觸發任何 E2E，但會印一句
「記得跑 `npm run test:rules`」—— 那是另一套測試。

## 一個真的踩到的坑

`git diff --name-only` 預設會把非 ASCII 路徑轉成 `"docs/\345\270\270..."`
那種八進位跳脫，而這個 repo 的 `docs/` 幾乎都是中文檔名 —— 對不上任何一條
規則，於是**每次都退回全跑**，而畫面上只寫「沒有登記在 related.js」，
看起來像對照表漏了。`scripts/e2e.mjs` 一律帶 `-c core.quotepath=false`。

## 量到的結果

| | 之前（headed） | 之後（無頭） |
|---|---|---|
| `00-smoke` | 66.1s | 18.6s |
| `05-journey-b` | 61.4s | 30.4s |
| `20-drawer-one-slot` | 28.0s | 20.0s |

改一支 domain 模組（例如 `domain/naming.js`）現在選出 4 支、約 1 分半，
而不是 25 分鐘。改一個 UI 元件（`components/buy.js`）選 3 支。
改 ADR 或 SPEC 只跑 `00-smoke`。

## 一個要先做、但不在這支 issue 裡的

`.github/workflows/` 底下**只有 `deploy.yml`，沒有跑測試的 workflow**。
所以「全量交給 CI」目前是一句空話 —— 全量只會跑在她的機器上，19.6 分鐘。

先把測試接上 CI（PR 上跑 `npm test` ＋ rules ＋ 全量 E2E），比省下那
144 秒的固定等待、甚至比平行化都重要：它把「全跑」整個搬離她的桌機。

## 沒做的

- **平行化**（一個 worker 一個 projectId）。要動那三個對得上的 projectId，
  而對不上的症狀是「每個 E2E 都畫面空的而且沒有錯誤訊息」。另開一支 issue。
- `08-ux-audit` 宣告它摸得到 `ui/views/` 與 `ui/components/` 整個目錄
  —— 那是實話（它逐頁量對比度與觸控目標），所以任何 UI 改動都會多跑它一支。
