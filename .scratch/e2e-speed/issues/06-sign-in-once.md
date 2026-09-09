# 不要每個測試都重走一次登入彈窗

Status: done（2026-09-09）—— 實驗成功，走的是第 1 條路
來源：2026-09-09，量到每個測試有約 3.5 秒的固定成本，登入佔掉一大半
動工前先讀：`tests-e2e/fixtures/app.js` 的 `signIn()`、`emulator.js` 的 `ensureUser()`

## 現在每個測試都做一次

```
page.goto()                       開頁
waitForSelector('[data-signin]')  等登入鈕
開彈窗 → 點 li.js-reuse-account   走一次 Google 那條路
waitForSelector('.app__nav')      等殼掛上來
waitForSelector('#view')
settled()                         ~360ms
```

估 1.5～2.5 秒 × 193 ＝ **5～8 分鐘**，佔全套 21.5 分鐘的四分之一到三分之一。
**這是四支裡帳面上最值錢的一支。**

## 為什麼可能做不出來

**Playwright 的 `storageState` 抓不到它。** `storageState` 存的是 cookie ＋
localStorage，而 Firebase JS SDK 的登入狀態**存在 IndexedDB**。所以標準那條
「登入一次、存起來、之後每個測試載入」的路走不通。

## 可以試的三條路，照「不碰 app 程式」排序

1. **把 IndexedDB 的內容抄過去。** 第一次登入完之後用 `page.evaluate()` 把
   Firebase 那幾個 object store 讀出來，之後每個測試用 `addInitScript()` 在
   app 開機前寫回去。**最乾淨（一行 app 程式都不用改），但最可能卡在細節上**
   —— SDK 的 key 格式沒有保證，換一版 firebase 就可能壞。
   壞掉的話至少要壞得大聲：`signIn()` 已經有 `sameNamespace()` 那道檢查，
   登入沒生效的話會停在登入頁，而 `waitForSelector('.app__nav')` 會逾時 ——
   那是看得懂的錯，不是靜默。
2. **問 Auth 模擬器要一個 token，直接餵給 SDK。** 模擬器有 REST 介面
   （`ensureUser()` 已經在用了）。要嘛在 app 開機前塞進 IndexedDB（同 1 的問題），
   要嘛呼叫 `signInWithCustomToken` —— 但那要 app 那側露出一個掛鉤。
3. **讓 app 在模擬器模式下改用 localStorage persistence。** 這樣 `storageState`
   就抓得到了。**但這會改到 app 的正式行為**（persistence 是 SDK 的全域設定），
   而 `envOf()` 那一支的判斷是照網址挑環境的。

## 放棄的條件（**寫在前面，不要做到一半才想**）

- **需要動到 `public/js/` 裡任何一行會影響正式環境的程式 → 停。**
  為了測試快五分鐘而讓正式站的登入行為變了，那個交易不划算。
- 三條路都試過還是不穩（時好時壞）→ 停，把量到的東西寫進這支 issue 然後關掉。
  **一個會偶爾登入失敗的 fixture，比慢五分鐘糟得多** —— 那會變成每次紅了
  都要先問「是真的壞了還是登入又抽風」。

## 怎麼知道做對了

- 全量跑一次，時間應該掉 5 分鐘以上（沒掉就是沒省到，回頭量是哪裡）
- **連跑三次全量都全綠。** 這一支的風險是 flaky，而 flaky 跑一次看不出來。
- `00-smoke` 的 S3（白名單以外的人只看得到「還沒有權限」）**一定要照樣紅得起來**
  —— 那一支測的正是「沒有權限的登入」，如果登入被跳過了，它會假綠。
  **這是這支 issue 最容易踩的坑**：把登入變快的作法很容易連「沒登入」那個狀態
  也一起跳過。

---

## 做完了（2026-09-09）：走第 1 條路，成功

**一行 `public/` 的程式都沒有動。** 只改 `tests-e2e/fixtures/app.js` 的 `signIn()`。

### 先確認 issue 的前提對不對 → 對

實際問過一次登入完的頁面：

| 存在哪 | 內容 |
|---|---|
| `localStorage` | **空的**（`[]`） |
| cookie | **空的**（`[]`） |
| IndexedDB `firebaseLocalStorageDb` / `firebaseLocalStorage` | `firebase:authUser:demo-api-key:[DEFAULT]` |

所以 `storageState` 真的抓不到 —— issue 寫的前提成立，走第 1 條路
（把 IndexedDB 那幾筆抄過去）。

### 值多少：量到的是 1 秒／測試，不是估的 1.5~2.5 秒

`signIn()` 拆開來量（5 次，中位數）：

| 階段 | ms | 省得掉嗎 |
|---|---|---|
| `page.goto()` | 490 | ✗ app 本來就要載 |
| 等 `[data-signin]` | 27 | ✓ |
| 開彈窗 | 310 | ✓ |
| 彈窗載入 | 585 | ✓ |
| 點 `li.js-reuse-account` | 77 | ✓ |
| 等 `.app__nav` | 199 | ✗ |
| 等 `#view` | 10 | ✗ |
| `settled()` | 390 | ✗ |
| **合計** | **2,050** | **省得掉約 1,000** |

**issue 估 5~8 分鐘是高估的** —— `goto`／`settled` 那 1 秒省不掉，
真正省得掉的是彈窗那一段。193 支 × 1 秒 ＝ **約 3 分鐘**。

### 做法

`signIn()` 裡分兩條路：這個 worker 的**第一個**測試照樣走一次真的登入，
走完用 `page.evaluate()` 把 IndexedDB 那幾筆讀出來存在 module 層變數；
之後每個測試用 `page.addInitScript()` 在 app 開機前寫回去。

`addInitScript` 是關鍵：它在**頁面自己的任何程式跑之前**執行，所以
Firebase SDK 初始化、去 IndexedDB 找登入狀態的時候那幾筆已經在了。

### 00-smoke 的 S3 沒有假綠 —— 驗過兩件事

這是 issue 自己標的「最容易踩的坑」，所以驗了兩層：

1. **S3 根本不經過 `signIn()`。** 它是自己從 `page.goto()` 開始、
   自己點 `[data-signin]`、自己走彈窗的。所以這次的改動碰不到它。
   而 `primeAuth()` **只掛在 `signIn()` 自己身上，沒有掛在 context 上** ——
   掛 context 的話 S3 會在還沒點之前就已經登入了，那才是假綠的形狀。
2. **它還紅得起來。** 把 `data/auth.js` 的 `accessState()` 改成永遠回
   `'allowed'`（＝白名單形同虛設）之後，S3 立刻紅：
   `expect(locator).toContainText` 失敗、`element(s) not found`
   —— `.gate` 根本沒出現。改回來就綠。
   （那個改動只是本機驗證，已經還原，`public/` 沒有任何 diff。）

全套裡**只有 S3 一支**自己走登入（掃過 `tests-e2e/specs/` 確認），
所以這是唯一要顧的例外。

### 沒有 flaky：全量連跑三次都全綠

照 issue 的標準跑 CI（`workflow_dispatch`），不佔本機：

| run | 結果 | 測試步驟 | job wall clock |
|---|---|---|---|
| [34349011311](https://github.com/b09901017/baobao-wellness-clinic-scheduler/actions/runs/34349011311) | **193 passed** | 18.8m | 20m11s |
| [34349015868](https://github.com/b09901017/baobao-wellness-clinic-scheduler/actions/runs/34349015868) | **193 passed** | 18.4m | 19m28s |
| [34349020184](https://github.com/b09901017/baobao-wellness-clinic-scheduler/actions/runs/34349020184) | **193 passed** | 18.4m | 19m49s |

零 flaky、零 retry。本機全量也跑了一次：**193 passed，16.5m**。

（這三次跑的是**沒有分片**的版本 —— 這支分支是從 `origin/develop` 開的，
而 issue 04 的分片還在 PR #89 沒合。分片合進來之後這個數字會再掉三分之二。）

### 對照組：同樣沒分片的 CI baseline

為了拿到乾淨的前後對照，另外在 `develop`（沒有 06、沒有 07）上跑了一次
同樣沒分片的全量 —— 同一種 runner、同一支 workflow：

| CI 全量（都沒分片） | 測試步驟 | job wall clock |
|---|---|---|
| baseline（`develop`） | **21.7m** | 22m54s |
| 這支（06） | **18.8 / 18.4 / 18.4m** | 20m11s / 19m28s / 19m49s |

**省 3.2 分鐘**，跟前面「1 秒 × 193 支 ＝ 3.2 分鐘」那個推算對得起來。

### 本機的數字不要拿來比

同一份程式在這台機器上跑出過 **16.5m** 也跑出過 **21.3m**（第二次是 `verify`，
前面還跑了單元測試，而且同時在等 CI）。**本機全量的總時間噪音太大**，
要比前後請看上面 CI 那張表，或看單支 spec 的秒數。
