# 行事備註的顏色：預設色實心擺第一、不重複、休假每顆斜線

Status: done
Blocked by: 06（同一支 `eventEditor.js`，先做 06 少一次衝突）
動工前先讀：`public/js/ui/views/eventEditor.js` 的 `colourField()` 與 `wire()` 裡 `data-colour` 那一段；`app.css` 的 `.swatch`、`.swatch--auto`、`.kind-*`、`.evcolor-*`、`--stripe-leave`；
`tokens.css` 的 `--event-personal`、`--event-leave`、`--evcolor-*`（淺色與深色兩份）；`public/js/domain/events.js` 的 `EVENT_COLOR_OPTIONS`、`colorClass()`、`paintClass()`、`validateEvent()`；
`docs/adr/0040-a-personal-event-picks-its-own-colour.md`、ADR-0039；`tests/events.test.js` 約 `:369`（「把顏色改回跟著類別」）

## 她要的

「新增行事備註那個表單，的顏色選擇的部分，為什麼第一個都很奇怪，會是一個空心圈圈 ? 能不能一致，像是實心的就都呈現實心，斜線的，所有顏色選擇就都呈現斜線的樣子，不要也是實心的」
「就直接拿掉，讓第一顆就是紫色的實心阿不能嗎 ? … 同理選休假也是每個都一樣如果是預設的顏色那就擺第一個，為甚麼要把他擺的到最後面 再第一個預設有一個空心的同顏色的?? 不理解?」

## 為什麼會這樣

第一顆是「跟著類別」（存 `null`），`app.css` 的 `.swatch--auto` 刻意畫空心，理由寫在 **ADR-0040 約 `:72-74`**（實心的話會跟六色裡同色那一顆一模一樣）。
後面六顆是 `MARK_COLORS`（灰綠茶紅藍紫）的 `--evcolor-*`。
**休假時第一顆身上掛著 `kindClass()` → `.kind-leave`**（`app.css` 約 `:3037`，排在 `.swatch` 後面），斜線畫在 34px 的按鈕底上 ——
她看到「第一顆有斜線、其他實心」就是這個（過目 11/5 校正，原本寫錯成「色票上沒有斜線」）。
類別本來的顏色（`--event-personal`、`--event-leave`）跟六色的紫、藍**接近但不是同一個值**。

## 做法（spec 談定的，過目 11/5 校正）

1. 第一顆＝那一類本來的顏色（`--kind-fg`），**實心**，選它存 `null` —— 跟現在一樣，舊資料不用搬、`validateEvent()` 不用改
2. 六色裡跟那一類重複的那一顆不列：行事備註不列紫（`violet`）、休假不列藍（`blue`）。對照放進 `domain/events.js` 的 `CATEGORIES` 每一列加一格（例 `sameAs: 'violet'`），`events.test.js` 補單元測試；畫面不寫死
3. **這一筆現在存的就是被拿掉的那一色**（以前挑了 `violet` 的行事備註；或挑了藍再把類別切成休假）：那一顆**照樣列出來、是選著的**（主控 11/5 定：同「停用了照樣列」的 `keep`；切類別不把 `color` 清成 null）
4. 選休假時**每一顆**都畫斜線（含第一顆）。**不要每顆掛 `.kind-leave`**：`--stripe-leave` 是 20% 透明的霧藍，疊在實心深色點上幾乎看不到 ——
   色票另做一層淺色斜紋，畫在 `::before`（那個 20px 的點）上，用 `.swatches` 的修飾 class（例 `.swatches--leave`）加；第一顆也拿掉 `kindClass()` 的斜線底
5. **`.swatch` 跟 `marks.js`、`notesEditor.js`、`masterList.js` 共用**：新的規則都要限在行事備註那一組（修飾 class）底下，不碰另外三處
6. 切類別本來就整張重畫（過目確認），`paintClass(null)` 落回 `kindClass` —— 日曆那一側不用改
7. ADR-0040 明寫空心 → **補 ADR-0171**（推翻 0040「不挑那一顆做成空心圈」那一點：第一顆實心的預設色、重複的那一色不列、休假每顆斜線，附她的原話），
   同一個 commit 改 `docs/adr/README.md` 的索引（`tests/adr-index.test.js` 盯著）
8. `.swatch--auto` 那條 CSS 與註解拿掉或改寫；`app.css` 這一組不在 `CSS_SCOPES` 裡，考慮加一組
9. `public/` 有改：`sw.js` 的 `VERSION` 加一、`npm run shell:snapshot`（每一個動到 `public/` 的 commit 都要再加一）

## 判準

- 新增行事備註 → 第一顆是不是實心的紫、後面沒有第二顆紫？選第一顆存下去 `color` 是不是 `null`？
- 切到休假 → 第一顆是不是實心霧藍、沒有藍、**每一顆都有斜線**？
- 打開一筆以前挑了 `violet` 的行事備註 → 有沒有一顆是選著的？存檔之後 `color` 還是 `violet` 嗎？
- 淺色、深色主題各截一張圖看（斜紋在兩邊都看得出來、點的顏色對）
- 客戶備註、設定頁那幾處用 `.swatch` 的地方長相沒變？

## 做完時留下的

- domain：`events.js` 的 `CATEGORIES` 每一類加 `sameAs`（行事備註 `violet`、休假 `blue`）；新的 `colourChoices(category, current)` 回六色扣掉那一色，
  **這一筆存的就是那一色時照樣列**（原本的位置）；不認得的類別照行事備註。`validateEvent()`、`colorClass()`、`paintClass()`、日曆一個字都沒改
- 編輯器：第一顆拿掉 `swatch--auto`，照舊掛 `kindClass()`（`--kind-fg` 就是日曆上那一類的顏色）、`aria-label="預設的顏色"`、選它存 `null`；
  後面六色改問 `colourChoices()`；整排加 `.swatches--event`，休假再加 `.swatches--leave`。切類別本來就整張重畫，`color` 不清
- CSS：`.swatches--event .swatch { background-image: none }`（第一顆的 `.kind-leave` 斜線不再畫在整顆按鈕底）；
  `.swatches--leave .swatch::before` 疊一層 `repeating-linear-gradient(-45deg, transparent 0 3px, var(--surface) 3px 5px)`（同 `.kind-leave .timerow__bar` 挖穿的做法，不用 `--stripe-leave`）。
  **`.swatch--auto` 那一條留著**：設定頁警示選「空心」填法時整排畫空心（`masterList.js`）—— 只改了註解
- ADR-0171（推翻 ADR-0040 Consequences 最後一點），`docs/adr/README.md` 同一個 commit 補兩張表；CLAUDE.md「日曆上任何一種東西的顏色」那一列補一句 `colourChoices()`／`.swatches--event`
- 測試：`tests/event-colour-swatches.test.js`（`sameAs`、`colourChoices()` 四種情形、編輯器不再有 `swatch--auto`）—— 改之前 import 不到、紅；
  E2E `92-event-colour-swatches`（C1 行事備註第一顆實心、沒有第二顆紫、選第一顆存 null；C2 休假沒有藍、每一顆圓點有斜線、第一顆按鈕底 `none`；C3 以前挑紫的照樣列、選著、存完還是紫）——
  拿舊的三支檔案跑：C1、C2 紅在真正的斷言上（「第一顆是實心的」「藍跟第一顆重複，不列」），C3 綠（舊的本來就列全部 —— 它是守「照樣列」的）；改完 3 支全綠
- `related.js`：登記 `92`、`CSS_SCOPES` 加 `swatch`（`classes: ['swatch', 'swatches']`，owners 是 `marks.js`、`notesEditor.js`、`masterList.js`、`eventEditor.js`；這次 `app.css` 的差異 `narrowCss()` 認得是 `['swatch']`）
- 中途撞到：第一顆的 aria-label 本來想寫「行事備註本來的顏色」（叫 `events.js` 的 `describeCategory()`），`tests/course-systems.test.js` 掃同名的課程那一支 → 改成固定的「預設的顏色」
- `sw.js` v238
- verify：`npm test` 5445 全過；E2E 照 `pick()`（`eventEditor.js`、`events.js`、`app.css#swatch`、`sw.js`、spec `92`）挑 11 支、外加 `14`（設定頁警示的色票）直接跑：
  121 個裡 120 過、`74` 的 L6 紅一次（量長備註編輯卡的右緣 426 > 390，`.pbcard` 跟這次的 CSS 無關），單獨重跑 `74` 24 個全過 → 記在 HANDOFF 中途發現 段二
- 截圖自己看過（本機模擬器、414 寬、淺色與深色）：新增行事備註那一頁沒有任何小字；行事備註第一顆實心紫＋五色；休假第一顆實心霧藍＋五色、每一顆斜線（兩個主題都看得出）；
  日曆抽屜裡（embedded）同樣；以前挑紫的那一筆紫列在最後、選著
