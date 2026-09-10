# 01 分段切換器把中文壓成兩行

Status: done
動工前先讀：`.scratch/quieter-screens/spec.md`

## 她要的

> 小UI改動，我覺得像是待辦首頁那個"總覽/依客戶"的那個切換的東西不夠長，依客戶這三個字都被迫換行了，然後像是已完成/未完成，發連結/沒發連結，這些也都被迫換行，請加長這個切換的東西，並且適當留白當緩衝可以

## 為什麼會這樣

**不是「不夠長」，是 `.seg` 被定義了兩次。**

- `public/css/app.css:703` —— `.seg { display: flex }`，給 `.seg__item` 那一版（`aria-pressed`，flex:1 等寬）
- `public/css/app.css:6639` —— `.seg { display: inline-flex; margin-bottom: … }`，給 `.seg__btn` 那一版（`aria-selected`，內容寬）

兩條同權重（0,1,0），**後面那一條贏**。於是 `.seg__item` 那一版跟著變成 `inline-flex` ——
寬度縮到內容，而 `.seg__item` 是 `flex: 1 1 0%`（`min-width: auto` ＝ min-content），
**中文的 min-content 是一個字**，所以它樂於被壓到一個字寬然後折行。

實測（390px 視窗、`.seg` 放在 `padding: 0 var(--gutter)` 的區塊裡）：

| 文字 | 高度 |
|---|---|
| 總覽 / **依客戶** | 30px / **36px（兩行）** |
| 未完成 12 / 已完成 34 | 30px / 30px |
| **還沒發連結 18** / 已經發出 25 | **36px（兩行）** / 36px |

`.seg__item` 那一版的呼叫端有八處：`home.js:285/538/1893/2381/3428`、
`customerDetail.js:1024`、`calendar.js:192`、`mergeImport.js:411`。
`.seg__btn` 那一版有兩處：`bulkCancel.js:224`、`playbook.js:294`。

`.kindpick .seg`（app.css:6303）是刻意把 `flex` 關掉的一個例外，**不要動它** ——
註解寫著理由（三顆並排時等寬反而看不出哪一顆被按下去）。

## 怎麼做

1. 兩份 `.seg` 拆成兩個名字。它們本來就是兩種元件（一個等寬填滿、一個內容寬），
   共用一個 class 名只是巧合。既有呼叫端只有十處，改得完。
2. `.seg__item` 補 `white-space: nowrap`，左右留白從 `var(--space-3)` 加寬。
3. 窄到真的塞不下時**整條橫捲**（`overflow-x: auto` + `noscroll-bar`），不要折行 ——
   折行會把底下整片內容往下推，而她掃的是底下那片。

## 判準

- 390px 與 320px 兩個寬度下，`home.js` 那五處與 `customerDetail.js` 那一處的
  每一顆 `.seg__item` 高度都是 30px（單行）
- `.kindpick` 那三顆的寬度一個 px 都沒有變
- `bulkCancel` 與 `playbook` 的 `.seg__btn` 一個 px 都沒有變
- 測試：一支掃 `app.css` 的單元測試，斷言 `.seg` 這個選擇器在整份 CSS 裡
  **只被定義一次**（這一類「同名兩份、後面那份安靜贏」的 bug 掃得出來）
