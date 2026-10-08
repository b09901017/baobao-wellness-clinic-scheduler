# 日曆點開的那張卡片上看不到客人的警示

Status: todo
來源：`f-card-flags`、`rules/report.md` 第 4 條；截圖 `.local/references/audit-2026-10-08/ux/shots/22-cal-readcard-1.png`（模擬器的假客戶）
動工前先讀：`public/js/ui/views/calendar.js:1591` 的 `visitReadHtml()` 與它的五個呼叫端
（`calendar.js:932`、`customerDetail.js:1842`、`home.js:1248`、`home.js:2220`、`progress.js:357`）、
`public/js/ui/components/flags.js` 的 `alertChips()`（壓表怎麼接：`schedule.js:983`）、`SPEC.md` 4.3、ADR-0074、0046、
`CLAUDE.md` 連動表「客戶身上的標記」「一筆來訪的讀取卡片」
Blocked by: —
重現：本機模擬器 → 替客戶A 加一個警示 → 日曆 → 點他那一段 → 卡片抬頭只有名字（沒有腳本，讀碼＋畫面）

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

報告那一張卡：

> 日曆點開的那張卡片上，看不到客人的警示（體內金屬、血管難打）
>
> 日曆點一段，跳出來的卡片只有客人的名字。同一位客人在編輯畫面上有紅色的「體內金屬」，卡片上沒有。這張卡片是四個畫面共用的（日曆、客戶詳情、待辦、進度追蹤），四處都看不到。

## 為什麼會這樣

`SPEC.md` 4.3：「永久限制（尤其是醫療禁忌）在任何畫面都必須跟著客戶名字顯示」。壓表、來訪編輯器、拍 Abovee 都接了，
`visitReadHtml()` 漏了 —— 而它是四個畫面共用的，所以四處一起漏（lessons 一）。

## 要做的

- **畫在 `visitReadHtml()` 回的那一塊最上面（一處）**，接 `flagsUi.alertChips()`（跟壓表牆同一支，不另外寫）。
  卡片的「抬頭」（名字那一行）不在 `visitReadHtml()` 裡 —— 那是五個呼叫端各自的 `openCard({ title })`
  （`calendar.js:948`、`progress.js:368`、`home.js:1272`／`:2243`、`customerDetail.js:1864`）。**不要去動那五個抬頭**：五份遲早漏一份。
- 只畫**警示**那一排（`config/clinicalFlags` 裡有的字）；其他限制與合作機構不在這一輪。
- 五個呼叫端都要讓 `visitReadHtml()` 拿得到「這位客戶」與警示主檔。日曆、待辦兩處、進度那三個畫面的任務與額度本來就由
  `components/taskMirror.js:155` 的 `fillMirror()` 補讀 —— 客戶與警示主檔走同一趟；`customerDetail.js:1840` 不走它，手上本來就有。
  **少傳的那一頁會安靜地不畫**，所以加一條掃原始碼的測試：每一個 `visitReadHtml(` 的呼叫端都帶著那一格（照既有「每一個組 `master` 的地方」那支測試的寫法）。
- 目錄模式（沒指定哪一段、一段一列）與單段模式都只在最上面畫一次，不要每一列重複。

## 判準

- 四個畫面、五個呼叫端都畫得出來嗎？
- 沒有警示的客人，卡片多不多一個像素？（不可以；`alertChips()` 空的時候回什麼，接的地方就要是什麼）
- 那一排有沒有落在 `.blockchips` 包裝裡？（裸著放進 column flex 會被拉滿整行，`tests/chips-and-chevrons.test.js` 那個坑）
- 這一塊是不是只給看？（卡片上一個 `<input type="checkbox">` 都不可以有）
- 客戶已經刪掉（卡片還打得開）時會不會壞？
- 補讀回來之前先畫的那一版（卡片是「先畫、不等任務讀回來」）有沒有閃一下、或把版面往下推？

## 不做

- 日曆日／週那一列（`visitRow()`）也沒有警示。那一列每天看幾十次、她嫌字多，這一輪不加；寫進 23 的「沒做、留著」。

## 測試

- 掃原始碼那一條（上面）。
- 單元：`visitReadHtml()` 給一位帶警示的假客戶 → HTML 裡有那一顆；沒有警示 → 沒有那一排。
- E2E `61`：客戶A 帶一個警示 → 日曆點那一段看得到；待辦中心「詳情」打開同一張也看得到。
