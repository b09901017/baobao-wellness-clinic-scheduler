# 08 欄寬、分隔、格線、抬頭

Status: done
Blocked by: —（第三輪的第一支；分支 `claude/sheet-layout`，從 develop `532c1a4d`）

## 動工前先讀

- `.scratch/sheet-push-gaps/spec.md`「第三輪：版面」、`mock-layout-2026-11-05.html`（她看過、說「照示意圖做」再改了幾點的那一張）
- `sheets/readonly-report.gs` 的 `renderCustomer()`、`infoLine()`、`finish()`、`STYLE`、`COLOR`；ADR-0024（照抄她舊表的樣子）

## 她要的

> 第二 : 如圖2 第5行這邊，感覺日期的地方都可以再寬一點，不然都會被擠到第二行

> 第五 : 如圖4 我覺得應有到剩餘的這幾個格子是不是可以和旁邊的日期的那些有區別 ? 這樣比較淺淺易懂

> 第四 : 我覺得不用病歷號 1234，直接寫1234就好，不用病歷號
> 第五 : 我覺得客戶A 可以字在大一點

> 都照建議（示意圖的 6c：格線藏起來）

## 做法

- 日期欄 58 → 78（`STYLE.dateWidth`），「10/29(四)」一行放得下
- 應有、已完成、已排未上、剩餘（B～E）：格子淡灰底、表頭比療程項目那一格淺一階（示意圖 `#546E7A`）、「剩餘」右邊一條粗線（框線 `SOLID_MEDIUM` 或 `SOLID_THICK`，選看得出來但不搶眼的）
  —— 狀態色（已完成綠、已排未上黃、剩餘 ≤0 紅）照舊蓋在淡灰上面
- 格線藏起來（`sheet.setHiddenGridlines(true)`），只留矩陣的框線
- 名字 14 → 18 號，那一列加高（目前全部列固定 26，`finish()` 的 `setRowHeights`）
- 抬頭的病歷號只寫號碼（`infoLine()`：`'病歷號 ' + chartNo` → `chartNo`）。手動貼上那條路（`customerReport()`）**不動**（一次性客人那一輪會改那一支）
- 待辦區的日期（TODO 的死線、FINISHED 的完成日）寫成文字（例如 `setNumberFormat('@')` 再寫值），不讓 Google 自己認成日期格（11/5 兩次匯出都看到）
- `LAYOUT_VERSION` 加一（4）；`tests/sheet-gs-batch.test.js` 的雜湊照「換之前先用 `scripts/sheet-gs-compare.mjs` 看清楚哪幾格變了」換（第三輪做完一次換，不用每支換）

## 判準

- 日期欄的寬度、B～E 的底色與表頭色、剩餘右邊的粗線、格線藏起來、名字 18 號、抬頭只有號碼，替身的快照看得到嗎？
- 狀態色有沒有被淡灰蓋掉？（已完成 > 0 綠、已排未上 > 0 黃、剩餘 ≤ 0 紅，照舊）
- 待辦區的日期是文字不是日期格嗎？

## 做完時留下的

- 做法照 issue：`STYLE.dateWidth` 78、`STYLE.titleSize` 18、名字那一列 `STYLE.titleHeight` 40（`finish()` 之後另外 `setRowHeights(2, 1, 40)`）；
  B～E 表頭 `COLOR.countHeader` `#546E7A`、格子 `COLOR.count` `#EEF2F5`（斑馬紋之後、狀態色之前下，所以狀態色照舊蓋在上面）；
  剩餘右邊 `SOLID_MEDIUM`（`finish()` 裡、矩陣格線之後：後畫的蓋掉先畫的）；`setHiddenGridlines(true)`；`infoLine()` 只寫號碼
- 待辦區的日期：`taskLines()` 對日期那一格 `setNumberFormat('@')`。草稿紙多記一種格式 `numberFormat`，**`paint()` 先下它再寫值**
  （寫進去的那一刻 Google 就照格式認值；先寫再下，「2026-09-15」已經被認成日期了）。其餘格式照舊在寫值之後
- `LAYOUT_VERSION` 3 → 4（整輪就這一次）。ADR-0175 在這個 commit 寫好（整輪的決定都是她 11/5 一次定的），推翻 ADR-0096 的「記在當天那一列的下面」
- 替身（`tests/helpers/appsScriptStub.js`）：`setNumberFormat`、`setHiddenGridlines`、`BorderStyle.SOLID_MEDIUM`、快照多 `gridlinesHidden`
- 測試：`tests/sheet-layout.test.js`（新，判準一條一條）；`sheet-fingerprint` 抬頭那一條改成只有號碼；`sheet-gs-fonts-timing` 名字 18 號；
  `sheet-gs-batch` 的雜湊換了（每一支換一次，`sheet-gs-batch.test.js` 的註解）
- `scripts/sheet-gs-compare.mjs` 跟 develop 那一份比正式站那一包（只印數字），四步都一樣：值 68（34 頁抬頭那一格新舊各一）、字級 68（名字那一格）、
  列高 68（名字那一列）、欄寬 440（日期欄）、底色 1,438（數字四欄與表頭）、框線 34（每頁一條粗線）、格線 34、數字格式 10（待辦區的日期）—— 沒有別的
- **只在 staging 驗得到**：粗線的實際粗細與顏色好不好看；18 號名字一行 40 高夠不夠；文字格式下了之後 Google 真的照文字顯示（替身只記格式）
