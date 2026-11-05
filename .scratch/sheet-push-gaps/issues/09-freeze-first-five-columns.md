# 09 凍結前五欄（療程項目～剩餘）

Status: todo
Blocked by: 08

## 動工前先讀

- `sheets/readonly-report.gs` 的 `renderCustomer()`、`noticeRow()`、`noteBlock()`、`renderPurchases()`、`renderProducts()`、`renderNotes()`、`renderTasks()`、`blockHead()`、`finish()`、`paint()`（凍結最後做）、`render()` 沒變的頁只改第 3 列時間那一段（`getRange(3, 1)`）
- 程式裡那一段註解：「只凍結列，不要凍結欄。表頭那三列是橫跨整張表的合併儲存格，而 Google 試算表不讓凍結線穿過合併儲存格」（`.scratch/first-real-import/issues/01-frozen-column-splits-a-merged-cell.md`）

## 她要的

> 第一: 有關 應有～剩餘要跟日期分開 : 我確實蠻希望可以另外前五欄凍結，但是因為下面有合併儲存格，所以理論上應該凍結不了?

主控回她：照現在的樣子凍結不了；做法是**所有合併都停在凍結線左邊（A～E）**，下面那幾塊寬度只到「剩餘」那一欄（約 440 像素），長的一行折成兩行。她：「都照建議」。

## 為什麼現在凍結不了

凍結線（E 與 F 之間）不能穿過合併儲存格。穿過去的有：第 1～3 列（提醒、名字＋抬頭、產生時間）從 A 合併到最右邊；「買過什麼」「營養品」「備註」「來訪紀錄」每一行與區塊抬頭從 A 合併到最右邊（`noteBlock()`）。
TODO 在 A～C、FINISHED 在 K～M（`blockHead()` 合併 3 欄），都沒有穿過那條線。

## 做法

- `setFrozenColumns(5)`（連同 `setFrozenRows(5)`，凍結最後做 —— 合併要先在）
- 每一個合併都不可以跨過 E／F：
  - 第 1～3 列：合併只到 E（或想別的排法：例如名字＋號碼在 A～E，購買名稱與合計在下一列 A～E 折行）。**第 1 列那句提醒要照舊在 A1**（`isOurs()` 靠它認）；**沒變的頁只改第 3 列時間**（`render()` 寫 `getRange(3, 1)`）—— 時間那一格搬了位置就要一起改
  - 下面那幾塊（`noteBlock()`、區塊抬頭）：合併只到 E，長的一行折行；**那幾列不可以再固定 26 高**（現在 `finish()` 整頁 `setRowHeights(…, 26)`），要讓折行的列長高
- 矩陣右邊的空白、FINISHED 那一塊位置照舊

## 判準

- 替身裡有沒有任何一個合併跨過第 5 欄與第 6 欄之間？（寫一支測試掃快照的每一個合併：`col <= 5 && col + cols - 1 >= 6` 一個都不准）
- 凍結是 5 列 5 欄嗎？凍結在合併之後才設嗎？（替身的 `setFrozenColumns` 要擋「凍結線穿過合併」—— 跟 Google 一樣丟錯，才測得出來）
- 沒變的頁改時間，改的還是時間那一格嗎？第 1 列提醒還在 A1 嗎？
- 下面那幾塊折行的列有沒有被固定高度切掉字？

## 做完時留下的

（做完填）
