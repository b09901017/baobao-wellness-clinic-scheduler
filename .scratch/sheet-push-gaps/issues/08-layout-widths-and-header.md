# 08 欄寬、分隔、格線、抬頭

Status: todo
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

（做完填）
