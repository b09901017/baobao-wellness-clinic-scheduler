---
paths:
  - "public/css/**"
  - "public/index.html"
  - "public/manifest.webmanifest"
  - "public/js/ui/keyboard.js"
  - "public/js/ui/shell.js"
---

# 版面、CSS、顏色

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 來訪狀態的顏色、標籤或符號

- 只改 `domain/visits.js` 的 `STATUS_VIEW`，日曆、客戶詳情、試算表全部讀它。
- `app.css` 的 `.status-*` 只掛 class，色值全部在 `tokens.css`（淺色與深色兩份都要改，見 ADR-0039）。
- `tests/visits.test.js` 盯著兩邊對得上。
- **這一組是全站共用的，不可能只改一頁**

## 日曆上任何一種東西的顏色

- 要分辨的是**七種**：待確認／已確認／已完成／未到／行事備註／休假／待辦。
- **色相已經用完了** —— 休假走斜線紋、待辦走方框勾勾記號，都是因為數不夠（ADR-0039、0045）。
- 第八種一律先想「有沒有不用顏色的畫法」。
- 行事備註可以自己挑顏色，色票名單與客戶備註共用 `MARK_COLORS`，但值另有一組 `--evcolor-*`（小圓點的顏色當 11px 的字對比度不夠，見 ADR-0040）；待辦不能挑。
- **編輯器的第一顆是那一類本來的顏色、實心、存 `null`**，六色裡跟它重複的那一色不列（除非這一筆存的就是那一色）—— 列哪幾色只問 `domain/events.js` 的 `colourChoices()`（`CATEGORIES` 的 `sameAs`），休假時每一顆圓點畫斜線；新的規則限在 `.swatches--event`，`.swatch` 還有三處共用（ADR-0171）

## 一顆小圖示按鈕的觸控區

- 撐開的那一層（`::after` ＋ `position: absolute` ＋ `inset: -Npx`）要貼在**自己身上**，所以那顆按鈕一定要 `position: relative` —— 少了它會去貼上層某個盒子，而症狀是**按到旁邊那一顆**（`.slothead__x` 蓋住「記一句」那顆夾板，按下去跳「取消這一段」）。
- 兩顆並排時中間至少留 16px，不然兩個 44px 的感應範圍會疊，疊到的那一段由後面那顆贏。
- `app.css` 裡還有十一個一樣貼錯盒子的，見 `.scratch/coverage-gaps/issues/04`

## 蓋住整頁的一層、殼最上面那一條、「是不是裝到主畫面的」

- **裝好的那一顆在 Android 上是全螢幕的**（`manifest.webmanifest` 的 `display: fullscreen`，ADR-0147）：系統的狀態列收起來，畫面畫到螢幕最上緣，前鏡頭那個洞在裡面（`safe-area-inset-top`）。
- **殼由 `.app__body` 讓開**（有橫幅時是橫幅；**不是 `.app__main` 的內距** —— 寫回捲動區的話內容會從鏡頭底下穿過去）；**新增一種蓋住整頁、自己有抬頭的東西**（`position: fixed; inset: 0`，像 `.cam`、`.deck`、`.abl`）**抬頭要自己 `max(…, env(safe-area-inset-top))`**，而且要有畫面上關得掉的那一顆（返回鍵在全螢幕下收起來了）。
- **高度靠 `inset: 0`、不另外寫 `height: 100dvh`；殼（`html`、`body`）是 `100%`**（2026-10-21，after-golive 10）：全螢幕的手機重新整理時 dvh 跟不上，整頁比畫面高一截、底下那一排（導覽列、快門、「記錄」）被擠出去 —— `tests/full-height-units.test.js` 盯著；抽屜的「最多佔幾成」（`78dvh`）不算。
- 桌機瀏覽器那個值永遠是 0，寫對寫錯畫面都一樣 —— 量的是 E2E `66`（用 CDP 把它設成 40px）。
- **鍵盤跳出來時版面跟著縮**（`index.html` viewport 的 `interactive-widget=resizes-content`，ADR-0181；全螢幕的那一顆不加它就是鍵盤蓋住貼底的抽屜）：新的一層不用自己讓開，**不要拿掉那一格**；打字時底部導覽列收起來（`ui/keyboard.js` 的 `html[data-keyboard]`；量過最高的照寬度各記一份，打字時轉方向不會把扣掉鍵盤的那一截當成最高的 —— `nextKeyboard()`）。
- **問「是不是裝到主畫面的」兩種 display-mode 都要問**（`data/auth.js` 的 `INSTALLED`：Android 是 `fullscreen`、iOS 退回 `standalone`），`tests/immersive-display.test.js` 盯著它跟 manifest 寫的是同一種。
- iOS 的 `apple-mobile-web-app-status-bar-style` 刻意留在 `default`：換成 `black-translucent` 時間與電量永遠是白字。
- **iPad 橫放（≥900px）的 `.app` 是三列的格子**（2026-10-21）：最上面那兩條（`.envbar`、`.netbar`）各佔一列、橫跨整個寬度，第三列才是側邊導覽＋內容 —— **`.app` 多一個直接子元素要給它 `grid-area`**，不然它會被自動排進格子裡的空位（以前是橫排的 flex，那兩條變成左邊一整條直欄）。
- E2E `24` 的 G1 量著

## 貼在畫面底部的東西（toast、釘住的那一條、懸浮鈕）

- 三樣都跟導覽列搶同一塊地方，而且**只有量位置看得出來**（批次取消 9/10 那次的測試掃 CSS 字串，綠著、畫面照樣懸空）。
- **釘住的那一條**（`.bulkbar`、`.cform__bar`）是 `sticky; bottom: 0`，那個 0 從捲動區的內容邊算 —— `.app__main` 底下留給導覽列的 44px（iPad 30px）會讓它浮在留白上緣，所以要收進 `.app__main:has(…)` 那一條規則；手機上它坐在導覽列上，**不再讓 Home 指示條**（導覽列讓過了），`--toast-lift` 就是照這個高度算的。
- **toast** 在手機上跟懸浮鈕同一條基準線（66px）、靠左讓開懸浮鈕那一欄，頁面上有釘住的那一條時再往上讓（`--toast-lift`，`body:has(…)`），**面板（`.drawer-backdrop`）開著時到最上面** —— 導覽列被蓋住了，底下是面板自己的那幾列，站在 66px 就擋住她下一下要長按的那一段—— **新增一種釘住的條要加進這兩條規則**。
- 她 2026-09-18 存完客戶去點「壓表」，按到的是蓋在上面的「復原」。
- 量位置的是 `24-layout-reach`（F1–F4）、`22-bulk-cancel`、`39-new-customer-form`（N9）。
- **那一疊卡片開著時**（`.deck`：壓表、拍訂購單的確認卡，2026-10-08）toast 站到抬頭中間名字那一段（`body:has(.deck) > .toast`）—— 底部是「下一位」。
- **新增一種會蓋住整頁、自己有底部按鈕的東西要加進這條規則**。
- 量法是問 toast 底下的 `elementFromPoint()`（`24` 的 F5、F6），不是比外框。
- **打字時**（鍵盤開著，`ui/keyboard.js` 寫 `html[data-keyboard]`，ADR-0181）手機寬度收起導覽列與右下角那一顆（`.fab`）—— 版面跟著鍵盤縮，`position: fixed` 的東西全部站到鍵盤上面；**新增一種貼底的東西要想打字時收不收**（E2E `100` 量著）

## 一段要用綠色的字

- 用 **`--accent`**。
- **`--accent-text` 是「綠底上面的字」**（淺色主題是白的）—— 拿它當字色，淺色主題下就是白字白底，而深色主題看起來完全正常，所以只在深色下看過的人看不出來（新增客戶那三塊的標題 2026-09-17 就是這樣看不到的）

## `tokens.css` 加一個顏色

- 淺色與深色**兩份都要有**（深色只有一份，在 `:root[data-theme='dark']`，沒有 `@media` 的複本，見 ADR-0055）。
- `tests/tokens.test.js` 盯著；改主題的 key 或選項時，`index.html` 與 `form.html` 的行內開機腳本要跟著改
