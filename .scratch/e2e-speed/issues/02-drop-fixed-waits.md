# 把剩下 19 支的固定等待換成 locator 的狀態

Status: todo
來源：使用者，2026-09-09（「是否有不必要的 page.waitForTimeout() 硬等待，請改成以 locator 的狀態為準」）
動工前先讀：`tests-e2e/fixtures/app.js` 的 `saved()` / `layer()` / `settled()`、`tests/e2e-waits.test.js`

## 為什麼

`page.waitForTimeout(N)` 兩邊都錯：模擬器順的時候那 N 毫秒是白等的，
慢一拍的時候 N 不夠 —— 接下來那一句斷言讀到的是還沒重畫的畫面，
於是那一支變成「重跑就過」的 flaky。**兩種症狀都不會指向那一行。**

2026-09-09 量到的：217 個呼叫，加起來純睡 **216 秒**（一次全跑）。
分布是 600ms × 38、400ms × 30、2500ms × 14、2000ms × 15，最長的一顆 8000ms。

## 已經做完的部分

`fixtures/app.js` 加了三支，而且 `settled()` 裡那顆 350ms 也拿掉了：

| 換掉什麼 | 用什麼 |
|---|---|
| 點一下之後的 `600`〜`900` | `await app.layer('那一層裡一定有的東西')` |
| 存檔之後的 `1500`〜`2500` | `await app.saved()` |
| 「等它畫完」的 `300`〜`500` | `await app.settled()`（已經內含「連續兩次沒變」） |
| 丸子按下去之後的 `300` | `await expect(chip).toHaveAttribute('aria-pressed', 'true')` |
| 摺疊打開之後的 `250` | `await expect(fold).toHaveAttribute('open', '')` |
| 長按按住的秒數 | 等選單升起來（`.actionrow` visible）再放手 |

`settled()` 那顆 350ms 特別值得講：它每次 `go()`／`signIn()`／`reload()` 都付一次，
一次全跑幾百次。改成量 `#view` 的內容連續兩次沒變才算穩，順的時候大約
兩個 polling 週期（~240ms），慢的時候它會**真的等**。
**歸零那一行不可以省** —— 上一輪留下來的長度剛好相等時，這一輪第一次量就會
通過，整段「等它穩下來」被靜默跳過。

五支清完了（`01`、`05`、`13`、`19`、`20`），`tests/e2e-waits.test.js` 從此
不准它們加回去，其餘 19 支寫在它的 `PENDING` 上，**數字只准往下調**。

## 剩下的 19 支，照這個順序清

值不值得先清看的是「省下來的秒數 ÷ 改動的風險」，所以先挑那幾支存檔多的：

1. `22-bulk-cancel`（19 個）、`07-chaos`（17）、`17-settings-fields`（11）
2. `04-journey-a-happy`（15）、`08-ux-audit`（12）、`02-examine-chain`（12）
3. `21-pool-assignment`（10）、`10-offline`（7）、`06-time-travel`（6）、`24-layout-reach`（6）
4. 剩下的都在 5 個以下

## 兩種不要換掉的

- **等的是真實時間本身**：長按的 `HOLD_MS`、`ui/toast.js` 的 `PENDING_MS`
  （`10-offline.spec.js` 的 `PAST_PENDING = 11_000` 是刻意要越過那道 8 秒的）。
- **要證明某件事沒有發生**。這種一定要有個「該發生的事」可以等 ——
  `19-untick` 的 U9 就是這樣改的：等 `app.saved()`（沒有確認框就是直接寫下去），
  然後才斷言 `dialog()` 是 0。**找不到可以等的東西就先不要動那一行**，
  換成一段太短的等待比留著固定等待糟。

## 三個踩過的坑

### 一、`settled()` 只認得一種佔位字

拿掉那顆 350ms 之後 `03-health-and-counts` **整支紅了**，訊息是：

```
Expected pattern: /次數對帳/
Received string:  "掃描中…"
```

`settled()` 從第一版就只認得「載入中…」，而資料健檢那一頁用的是
**「掃描中…」**（`ui/views/health.js:26`）。這個洞一直都在，被那 350ms
加上 `retries: 1` 兩層蓋著。**症狀會誤導**：錯誤訊息看起來像 app 壞了，
其實是測試問太早。

現在 `PLACEHOLDERS` 有五個，而且 `tests/e2e-waits.test.js` 掃 `public/js/`
盯著它 —— 那道守衛自己又抓出兩個沒人知道的（`找人中…`、
**`算佇列中…`（`views/schedule.js`，壓表那一頁）**）。

守衛只找**畫進標籤裡**的（`<p class="muted">X中…</p>`）。toast 那一族
（`{ pending: '送出中…' }`）不算：它們在 toast 不在 `#view`，那是
`app.saved()` 在判的，混進來會讓 `settled()` 等錯東西。

### 二、「穩了」的判準太寬鬆會讀到半張畫面

第一版的 `settled()` 是「連續**兩次**量到一樣」＝ ~240ms，**比原本那 350ms 早**。
於是 `16-record-task` 的 R3 讀到課程名還沒補上去的畫面（那一頁是
「先畫出來、名字等資料回來再補」）。

改成**連續 3 次**（~360ms 起跳）：保證不比原本早，而畫面還在動時會一直等。
**換掉固定等待的時候，新的判準必須不比舊的寬鬆** —— 不然你換到的不是
「比較準」，是「比較快而且比較容易錯」。

### 三、同一件事在兩個入口的選擇器不一樣

同一件事在兩個入口的選擇器**不一樣**：壓表那側的品項丸子是
`[data-ivproduct]`，來訪編輯器那側是 `[data-chip="s0-iv"]`。
`app.layer()` 等錯一個不存在的選擇器，症狀是那一支跑滿 15 秒然後紅在
一句看起來無關的斷言上。**每改一支都要真的跑過那一支。**
