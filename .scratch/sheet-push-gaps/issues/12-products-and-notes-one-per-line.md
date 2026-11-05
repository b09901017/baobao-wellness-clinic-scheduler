# 12 營養品一筆一行、備註一則一行上色

Status: todo
Blocked by: 09（下面那幾塊的寬度只到 E）

## 動工前先讀

- `sheets/readonly-report.gs` 的 `renderProducts()`、`renderNotes()`（備註那一塊）
- `public/js/domain/sheetReport.js` 的 `syncBundle()`（`notes: customer.notes`、`flags`、`products`）、`public/js/domain/customerMarks.js`（短備註、`MARK_COLORS`、`readMarks()`）、`public/css/tokens.css` 的 `--mark-*`
- CLAUDE.md「備註那一段的順序、長備註」那一列（`customer.notes` 是短備註的鏡像、長備註不進試算表）

## 她要的

> 第四 : 有關營養品，我不知道要怎麼呈現在試算表中比較好誒

> 第三 : 有關備註 : 能不能也像你建議營養品的那樣，分行，以及每一行塗不同舒服的顏色

主控建議：營養品一筆一行（像「買過什麼」）、沒給完的那一行塗黃；備註**每一行用她在 app 裡替那則短備註挑的顏色（淡色版）**、「永久限制」那一行淡紅。她：「都照建議」。

## 做法

- **營養品**：拿掉那張五欄的表，改成一筆一行：`日期　品名　12,000 元・3 個月・魚油、益生菌　——　給了 1／3（9/1）`，沒給完（`done: false`）那一行淡黃。日期與字的組法在 `.gs`（現有欄位：`label`、`amount`、`months`、`items`、`deliveredAt`、`delivery`、`done`）—— 不改 `syncBundle()`。11/5 正式站 34 位沒有人有營養品，這一段平常不出現
- **備註**：一則一列（合併只到 E，見 09）。顏色要知道每一則短備註的顏色 —— `syncBundle()` 現在只送 `notes`（字串）：
  - 每一頁多送一份 `noteLines: [{ text, color }]`（照 `readMarks()` 的順序、`color` 是 `MARK_COLORS` 的 id；`notes` 照舊送，給舊版 `.gs`）。**`.gs` 沒拿到 `noteLines`（還沒更新的 app）就照 `notes` 一行一列、統一淡灰** —— 新舊兩邊都合得來，不升 `SYNC_FORMAT`
  - **這是這一輪唯一動 `syncBundle()` 的地方**：一次性客人那一輪 issue 04 也改 `syncBundle()`（濾掉一次性客人）—— 改的是不同的幾行，誰後合進 develop 誰 rebase，寫進 HANDOFF
  - 顏色：`--mark-*` 是字／圓點的深色，試算表要底色 —— 每一種取跟白色混出來的淡色（約 85% 白），淺到黑字看得清楚。對照表寫在 `.gs` 一份（`.gs` 讀不到 `tokens.css`），旁邊註明對應哪一個 id
  - 「永久限制：…」那一行淡紅
- 動 `public/` → 升 `public/sw.js` VERSION ＋ `npm run shell:snapshot`（新檔案先 `git add`）；`noteLines` 進 `sheetFingerprint()`（它雜湊整頁的資料，自動就進）

## 判準

- 營養品一筆一行、沒給完的那一行淡黃、表格那五欄不見了嗎？
- 備註一則一列、每一列是那則短備註在 app 裡的顏色（淡色版）嗎？沒挑顏色的是灰的淡色嗎？永久限制那一行淡紅嗎？
- `.gs` 拿到舊的包（沒有 `noteLines`）照樣畫得出備註（一行一列、淡灰）嗎？
- 長備註沒有跑進試算表嗎？（`noteLines` 只讀短備註）

## 做完時留下的

（做完填）
