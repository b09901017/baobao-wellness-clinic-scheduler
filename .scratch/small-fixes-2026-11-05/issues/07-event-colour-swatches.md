# 行事備註的顏色：預設色實心擺第一、不重複、休假每顆斜線

Status: todo
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
