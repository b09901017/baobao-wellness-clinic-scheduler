# 客戶清單左上角「客戶」被壓成直的

Status: done
段：二（high）
動工前先讀：`ui/views/customers.js:102-111`（`.page__row` 裡一個 `h1.page__title` ＋ `span.footlinks.footlinks--inline` 三個連結）；`public/css/app.css` 的 `.page__row`（345 行）、`.page__title`（330 行）、`.footlinks--inline`（3572 行：`flex-wrap: nowrap; flex: 0 0 auto`）；另外三個用 `.page__row` 的畫面：`bulkCancel.js:238`、`home.js:326`、`schedule.js:270`

## 她要的

> 然後客戶那面我發現，最左上角的"客戶"這兩個字被壓成直的了，我猜是因為多了長備註

她猜得對：段七（10/19）在右邊加了第三個連結「長備註」。

## 為什麼會這樣

`.footlinks--inline` 是 `flex: 0 0 auto` 而且不換行 → 三個連結加起來多寬就佔多寬；`h1` 是預設的 `flex-shrink: 1`，被擠到只剩一個字寬 → 「客」「戶」一字一行。

## 做法（方向）

標題不縮（`flex: none` 或 `white-space: nowrap`）；右邊那一排放不下就**換行、靠右**（或整排換到標題底下）—— 選一個在 360px 上看起來不怪的。**四個畫面一起量**，不要只修客戶清單、把另外三頁弄壞。

**過目（10/19）**：換成兩排之後，上下兩排連結的觸控區會疊（`.footlink::after` 上下各撐 8px，排距只有 8px）→ 排距至少 16px，或那一排不換行、整排移到標題底下。`tests-e2e` 用 `elementFromPoint()` 量兩排交界那一點是誰。

## 判準

- 360px、390px、iPad 直式：「客戶」兩個字在同一行（E2E 量 `h1` 的高度 ≈ 一行的 line-height，不是兩行）
- 三個連結都看得到、點得到（44px 觸控區照舊）
- `home.js`、`schedule.js`、`bulkCancel.js` 那一列的樣子沒變（截圖比一次，或量同樣的東西）

## 做完時留下的（10/19 段二）

- CSS 兩條：`.page__row > .page__title { flex: none; white-space: nowrap }`；`.footlinks--inline` 改成 `flex-wrap: wrap; justify-content: flex-end; row-gap: 16px; flex: 0 1 auto; min-width: 0`
  （16px＝兩顆 `.footlink::after` 上下各撐 8px，排距再小就疊）
- 360px 上客戶清單那一排變兩排（看這個月的進度、看已停用的 ／ 長備註），靠右；390px 以上一排（截圖看過）
- E2E 77 C11（360／390／768：h1 高度 < 1.5 倍 line-height、三顆都在畫面裡、兩排交界 `elementFromPoint`）—— 換回舊 CSS 跑過 360 是紅的；
  C12（待辦首頁、壓表 360px 標題一行）。`bulkCancel.js` 那一列沒有 `.footlinks--inline`，同一條 `.page__title` 規則管到它
