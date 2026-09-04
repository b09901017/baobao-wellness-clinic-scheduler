# 說明文字讓出來的那塊空間

Status: done
來源：使用者，2026-09-04（第三階段：乾淨呼吸感、平滑動態、無過度設計）
動工前先讀：`docs/adr/0043`、`docs/adr/0048`

## 拿掉十三句之後那一頁會歪掉

`.grouprow` 現在是 `min-height: 52px` 加 `padding: var(--space-2) var(--space-3)`，
那個高度是**照兩行字調的**（標題 15px + 說明 12px）。剩一行字之後，
每一列上下會各多出七八個像素的空白，而列跟列之間只有一條 1px 的線 ——
結果是「每一列都變矮了，可是整塊看起來更鬆散」。

拿掉東西之後不重新調間距，畫面不會變乾淨，只會變空。

## 要做什麼

### 1. 一列（`.grouprow`）

- `min-height: 52px` → **48px**。**不可以低於 44px**（手指的最小目標，
  全站的規矩）。48 留一點餘裕給兩位數的數字。
- padding 上下由 `--space-2` 收成 `--space-1`；左右不動（跟卡片對齊）。
- 標題 `.grouprow__label` 的 `font-size` 不動 —— 它現在是那一列**唯一**的字，
  再放大會讓七段標題失去層次。

### 2. 段與段之間（`.flowgroup`）

一列從兩行變一行之後，段落標題（`--text-xs`）與列（`--text-md`）之間
原本的 6px 太擠。`.flowgroup__head` 的 `margin-bottom` 6px → 8px，
`.flowgroup` 的 `margin-bottom` 由 `--space-3` → `--space-4`。

**段的呼吸要比列的呼吸大一級**，那是「這七段是七件事」唯一的視覺線索
（段落線只有 3px 寬）。

### 3. 「今天做了什麼」那一塊

- `.reviewrow` 的 `padding: 3px 0` → `4px 0`：issue 03 之後每一列變長
  （多了日期與課程），行與行之間需要多一點分隔。
- 那一行「另外 12 則沒列出來」用既有的 `.reviewsync` 同一種畫法
  （上面一條 `--border-soft`、`--text-xs`、`--text-mute`），**不要新開一種樣式**。

### 4. 過場：只有兩個地方會動

**其餘一律不加。** 這一頁本來就是靜的，而「東西一直在動」跟「畫面很亂」是
同一個毛病的兩種長相。

- **攤開那幾則**（issue 02）：`grid-template-rows: 0fr → 1fr` + `opacity`，
  0.18s `ease`。用 grid 不用 `max-height` —— 猜一個 max-height 在十則跟
  一百則的時候會是兩種速度。
- **換看法／換一天**：`.reviewlist` 已經有 `deck-in` 0.14s 淡入，不動。

`@media (prefers-reduced-motion: reduce)` **不必自己寫** —— `app.css` 底部
那一段對 `*` 生效（同 `.monthnav` 那一段的註解）。

### 5. 不做的事

- 不加 hover 的位移、不加陰影變化、不加逐列延遲的進場。
  一天一百多列的話，逐列延遲會變成一串閃爍（`.reviewlist` 的註解已經寫了）。
- 不換字級階梯、不換顏色、不動 `tokens.css`。

## 驗證

- 瀏覽器（手機寬度）：總覽七段，一列一行，兩指之間的距離看得出段的分界
- 瀏覽器：一列的可點區域仍然 ≥ 44px（開 devtools 量 `.grouprow` 的高度）
- 瀏覽器：系統開「減少動態效果」→ 攤開那一下不會動
- 深色主題看一次（這一支沒有新的色值，但間距改了要確認沒有東西貼在一起）


## Comments

**2026-09-04 —— done。** `.grouprow` 52 → 48px、padding 收一級；
`.flowgroup` 的 margin 放大一級、`.flowgroup__head` 6 → 8px；
`.reviewrow` 的 padding 3 → 4px。

**過場只加了一個**（攤開那幾則）。`prefers-reduced-motion` 沒有自己寫 ——
`app.css` 底部對 `*` 那一段接手，跟 `.monthnav` 同一條註解。

手機尺寸截圖看過：七段的分界看得出來，一列的高度 48px（下限 44px）。
