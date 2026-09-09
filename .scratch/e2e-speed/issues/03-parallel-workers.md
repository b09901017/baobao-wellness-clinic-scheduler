# E2E 平行化：一個 worker 一個模擬器命名空間

Status: todo —— **隔離做完了（PR #84），平行沒開，`workers` 還是 1**
來源：使用者，2026-09-09（「本機全跑 21 分鐘」）
動工前先讀：`playwright.config.js` 的檔頭、`tests-e2e/fixtures/emulator.js` 的 `PROJECT_ID`、`tests/env.test.js`

## 2026-09-09 量到的：不要再重跑一次同樣的實驗

前置的隔離**已經合併了**（一個 worker 一個 projectId，見下面「動工順序」1 與 3）。
所以下一個人要做的**不是**再把 `workers` 調成 3 看看 —— 那已經量過了：

| | 通過 | 紅 | 時間 |
|---|---|---|---|
| `workers: 1` | 193 | 0 | 23.9 分鐘 |
| `workers: 3` | 183 | **10** | 14.2 分鐘 |

快 40%，但十支紅掉的全跑當不了關卡，所以沒開。
**十支沒有一支是資料串台** —— 命名空間是好的，那十支在 `workers: 1` 下
重跑 60 條全過。十支是三種形狀：

| 幾支 | 形狀 | 長什麼樣 |
|---|---|---|
| 6 | **連不上／載不起來** | `page.goto` 30 秒逾時 ×3、等不到 `[data-signin]`／`.app__nav` ×2、Firestore 說 client is offline ×1 |
| 1 | **寫入卡住** | `app.saved()` 撞到 `PENDING_MS`，toast 停在「還沒送出去」（`19-untick` U4） |
| 3 | **畫面沒畫完** | `settled()` 20 秒等不到穩 ×1（`21-pool-assignment`）＋ `settled()` 太早放行 ×2（`11-todo-drawer` D4 等不到「約二返」、`16-record-task` R3 課程名沒補上 —— R3 正是 `settled()` 註解裡寫的那個金絲雀） |

## 真正的瓶頸是這兩個（要下手就從這裡）

1. **那一顆 Firestore 模擬器是單一 Java 行程。** 每個測試開頭都要清空 ＋ 塞種子，
   三個 worker 就是三份工作排隊等同一個行程 —— 上面那 6 支「連不上」與 1 支
   「寫入卡住」都是這樣來的。
2. **app 的 Firebase SDK 每個測試都從 gstatic CDN 重抓一次。**
   每個測試一個新的瀏覽器 context ＝ 一份新的 HTTP 快取，所以 SDK 是真的重抓。
   worker 越多同時打出去的請求越多，抓不到就是整支紅
   （`ERR_SOCKET_NOT_CONNECTED`，症狀是等不到 `[data-signin]`）——
   `workers: 1` 那次全跑也被這個弄紅過一支。

**不要用調 `settled()` 的次數或打開 retries 來讓它變綠。** 那是拿墊子蓋住訊號，
而 CLAUDE.md 說固定等待兩邊都錯：順的時候白等，慢一拍的時候讀到還沒重畫的畫面。
這兩個瓶頸解掉之後，開平行只要改 `playwright.config.js` 一行。

## 現在為什麼只能一個 worker

`workers: 1` **不是設保守，是必要的**：每一個測試在開始前都會把 Firestore
**整個清空**再塞自己那份種子（`fixtures/app.js` 的 `app` fixture）。
兩個 worker 同時跑，就是互相洗掉對方的資料庫。

而模擬器分不分得開，看的是 `projectId` —— 那是模擬器裡的命名空間。
現在三個地方寫死同一個值 `demo-scheduler`：

| 誰 | 在哪 | 做什麼 |
|---|---|---|
| 開模擬器的 | `tests-e2e/start-emulators.sh` 的 `--project` | 開哪個命名空間 |
| 塞種子的 | `tests-e2e/fixtures/emulator.js` 的 `PROJECT_ID` | 往哪裡塞 |
| **app 自己** | `public/js/firebase-config.js` 的模擬器那一段 | 去哪裡讀 |

三個一定要一模一樣。`tests/env.test.js` 現在就在盯這三邊。

## 對不上的症狀特別壞

種子塞進 A、app 去 B 讀 → **每一個 E2E 都是「畫面空的」，而且沒有任何錯誤
訊息**。因為「命名空間裡沒東西」跟「這位客戶本來就沒資料」在畫面上長得一樣。

除錯時看不到線索，就會開始猜；猜著猜著會加一層「先等兩秒再試」之類的東西，
那才是補丁。**所以動工的第一步不是改設定，是先讓對不上這件事會大聲。**

## 動工順序（這個順序本身就是防補丁的設計）

1. **先改測試，再改東西。** `tests/env.test.js` 現在盯的是「三個字串相等」，
   要改成盯**同一支推導**：三邊都從一支共用的 `projectIdFor(workerIndex)`
   算出來，測試斷言三邊呼叫的是同一支、而且同樣的輸入給同樣的輸出。
   有這一支在，對不上會直接紅，不用猜。
2. **`workers: 1` 最後才動。** 前面每一步都在 `workers: 1` 下跑得過，
   才把它調成 3。
3. app 那一側怎麼知道自己是第幾號：最小的作法是 Playwright 開頁面時帶一個
   query 或 `addInitScript`，`firebase-config.js` 的**模擬器那一段**讀它，
   讀不到就退回 `demo-scheduler`（本機手動開 app 時走這條）。
   **正式與 staging 那一段一個字都不要碰**（`envOf()` 是照網址挑環境的）。
4. 模擬器那一側：`emulators:exec` / `start-emulators.sh` 要一次開起 N 個
   命名空間，或者確認同一顆模擬器吃得下多個 projectId（Firestore 模擬器可以，
   Auth 模擬器的帳號也是分 project 的 —— **這一點要先實測，不要假設**）。

## 最壞會怎樣

**壞的是測試，不是線上的 app。** 唯一會碰到 app 的檔案是
`firebase-config.js` 的**模擬器那一段**，而線上走的是另一段（照網址挑）。

所以最嚴重的情況是：全部 E2E 變成空白畫面，或者本機開發連不到模擬器。
分支丟掉就全部回去，線上的網站一個字都不會變。

## 值不值得

| | 現在 | 平行化之後 |
|---|---|---|
| 本機全跑 | 21.5 分鐘 | 估 8~10 分鐘（她的機器核心多） |
| CI 全跑 | 估 20~25 分鐘 | 估 12~15 分鐘（GitHub 免費那台只有 2 核，每個 worker 一顆瀏覽器還要跟 Java 的模擬器搶 CPU） |

**CI 那一欄的效果比想像中小**，所以這件事的價值主要在「她本機想全跑的時候」。
而 `.github/workflows/e2e-full.yml` 已經讓她可以按一下丟給 CI —— 所以這支
issue 的急迫性不高，**優先度低於任何一個真的功能需求**。

## 做完要順手做的

- `playwright.config.js` 檔頭那段「workers: 1 是必要的」要改寫
- `.scratch/e2e-speed/issues/01-tiered-e2e.md` 的「沒做的」那一節要打勾
- CLAUDE.md 的「無頭 20 分鐘」要換成新數字
