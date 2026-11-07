# 12 營養品一筆一行、備註一則一行上色

Status: done
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

- **營養品**：`renderProducts()` 改成 `noteBlock()` 一筆一行（`productLine()`：`品名　12,000 元・3 個月・魚油、益生菌　——　9/1　還差 益生菌`，沒有的那幾段不印；金額的千分位自己加 `thousands()`，不靠語系），
  沒給完的那一行琥珀色（同以前）。**跟 issue 寫的不一樣**：issue 的例子前面有購買日期（`0901　…`），但 `syncBundle()` 的 `products` 沒有那一格（只有 `label`、`amount`、`months`、`items`、`deliveredAt`、`delivery`、`done`），
  issue 又說不改那一段 —— 就不印購買日期（那一天在上面「買過什麼」裡看得到）。「給了沒」那一段（日期＋`delivery`）跟手動貼上那條路那一格一字不差，`sheet-script` 那一條改成比結尾
- **備註**：`syncBundle()` 每一頁多 `noteLines: readMarks(customer).map(({text, color}))`（**這一輪唯一動 `syncBundle()` 的一行**，在 `notes` 後面；一次性客人那一輪 issue 04 改的是別幾行，誰後合誰 rebase）。
  `.gs` 的 `noteLinesOf()`：永久限制一行（`COLOR.flag` `#FDE7E7`）＋每一則一行、底色 `MARK_TINT[color]`（`--mark-*` 跟白色 15:85 混，認不得的灰）；沒有 `noteLines` 照 `notes` 拆行、淡灰。`noteBlock()` 多一個選填的 `colours`
- `noteLines` 自動進指紋（`sheetFingerprint()` 雜湊整頁）；長備註本來就不在 `readMarks()` 裡
- 動了 `public/`：`sw.js` v283 → **v284**（一次性客人那一支分支上是 v292，號不撞；合併時照規則留大的再加一）＋ `npm run shell:snapshot`
- CLAUDE.md 連動表「試算表的 SYNC_FORMAT」「試算表的註記」兩列補了 ADR-0175（合併只到 `FROZEN_COLS`、`rowOrder()`、`MARK_TINT` 跟 `MARK_COLORS` 兩份）
- 正式站那一包（只印數字；那一包是舊的 app 推的，沒有 `noteLines` → 走淡灰那一條）：29 位有短備註、共 79 則，4 位有永久限制，0 位有營養品；
  `scripts/sheet-gs-compare.mjs` 跟 11 的 `.gs` 比：只有備註那一塊拆成一則一列、下面整塊往下搬；`scripts/sheet-gs-calls.mjs` 都沒變 讀 76／寫 37／寫完又讀 0、整份重畫 讀 178／寫 1,627／寫完又讀 0
- **只在 staging 驗得到**：淡色版的六色在 Google 上分不分得出來、黑字看不看得清楚；新的 app（v284）推過去之後備註才有顏色（舊的 app 推的是淡灰）
