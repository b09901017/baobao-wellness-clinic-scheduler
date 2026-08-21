# 試算表推送在第一位客戶就當掉：凍結欄切到合併儲存格

Status: done
回報者：使用者，2026-08-21（第一次真的部署 `.gs` 之後）
動工前先讀：`sheets/readonly-report.gs` 的 `renderCustomer()`、
`docs/adr/0013-sheet-sync-is-a-push-not-a-pull.md`、
`docs/adr/0024-the-sheet-mirrors-her-old-one.md`

## 症狀

她按 `#/settings/report` 的「立刻推一次」，收到：

> Exception: 很抱歉，你無法凍結僅包含部分合併儲存格的欄。請取消合併儲存格，或凍結更多欄以納入全部的合併儲存格。

試算表上只有**一張**客戶分頁（21 位裡的第一位），而且那一張看起來沒畫完 ——
沒有框線、沒有統一字體、列高沒調。隱藏分頁 `_data` 裡有**完整的 21 位**，
所以 app 送出去的東西是對的，壞的是渲染。

## 為什麼

`renderCustomer()` 在同一張表上做了兩件互相衝突的事：

| 行 | 做什麼 | 合併範圍 |
|---|---|---|
| `noticeRow()` | 第 1 列那句提醒 | `A1` ～ 整列寬 |
| `renderCustomer()` | 第 2 列名字大字 | `A2:B2` |
| 同上 | 第 2 列右邊的購買名稱與合計 | `C2` ～ 整列寬 |
| 同上 | 第 3 列產生時間與符號說明 | `A3` ～ 整列寬 |
| **`setFrozenColumns(1)`** | 在 A 與 B 之間畫凍結線 | **把上面三個合併範圍全部切成兩半** |

Google 試算表不允許凍結線穿過合併儲存格，所以這一行一定會丟例外。
**它不是偶爾發生，是每一次、每一張表都會發生。**

### 為什麼第一張還是留下來了

`setFrozenColumns(1)` 在 `renderCustomer()` 的**倒數第三行**，
它前面的格子、顏色、欄寬都已經寫進去了，所以第一張表看得到內容；
它後面的 `finish()`（字體、框線、列高）沒跑到，所以那一張沒畫完。

例外往上冒到 `render()` 的迴圈，第 2 位以後一張都沒開始，
`removeStaleSheets()` 與 `protectEverything()` 也沒跑 —— 所以表也沒上鎖。

### 為什麼測試沒抓到

`tests/helpers/appsScriptStub.js` 的 `setFrozenColumns(n)` 只是
`this.frozenCols = n;`，`merge()` 只是往 `sheet.merges` 推一個字串。
**替身記得住兩件事，但從來不檢查它們有沒有打架。**
這正是那 400 行「跑過替身但沒真的部署過」會漏掉的那一類問題
（`.scratch/visit-lifecycle/issues/05` 的最後一段早就寫了這個風險）。

## 想要的樣子

推一次，21 張分頁全部畫完、上好鎖。

### 三條修法，建議第二條

| | 做法 | 代價 |
|---|---|---|
| 1 | 拿掉 `setFrozenColumns(1)` | 日期欄一多，往右捲就看不到療程項目那一欄了 —— 而那正是她要對照的東西 |
| 2 | **表頭三列改成不合併**：值照樣寫進 A 欄，底色用 `setBackground()` 鋪滿整列 | 文字會溢出到右邊的空格子，視覺上和合併幾乎一樣。凍結欄留得住 |
| 3 | 凍結欄數改成跟最寬的合併一樣 | 等於凍結整個表頭寬度，沒有意義 |

**建議第 2 條。** 合併是為了「那一列看起來是一整條」，而底色鋪滿整列就做得到這件事；
凍結第一欄是她真的會用到的功能（矩陣往右可以到十幾欄）。兩個要留的是後者。

第 2 條要動的地方：`noticeRow()`、`renderCustomer()` 第 2、3 列那三段。
`resetSheet()` 裡的 `breakApart()` 可以留著（舊表可能還有合併）。

## 不要順手做的事

- **不要把 `setFrozenColumns` 包在 try/catch 裡吞掉。** 那會讓表默默少一個功能，
  而她永遠不知道為什麼往右捲名字就不見了。這一支要修的是衝突本身。
- **不要改成「有合併就跳過凍結」。** 那等於把 bug 寫成規格。

## 一起補的護欄

`tests/helpers/appsScriptStub.js` 的 `setFrozenColumns()` 要學會拒絕：
凍結線落在任何一個 `merges` 的內部（`col > 起始欄 && col < 結束欄`）就丟例外，
訊息照 Google 的原文。`setFrozenRows()` 同理（雖然目前的合併都是水平的，踩不到）。

沒有這條，下一次有人加回合併儲存格時，測試會再一次全綠。


## Comments

**2026-08-21 — 做完了。** `npm test` 從 698 變成 699 全過。

使用者選了**第 1 條**（拿掉凍結欄、保留合併），不是我建議的第 2 條。
理由是她要的是「和我原本那張一樣」的視覺，表頭那三條橫跨整張的色帶就是那個樣子。
往右捲看不到療程項目那一欄的代價先收下 —— 真的礙事再回來改成第 2 條，
那時候是一個獨立的決定，不要和這支修 bug 的混在一起。

| 在哪裡 | 做什麼 |
|---|---|
| `sheets/readonly-report.gs` | 拿掉 `renderCustomer()` 的 `setFrozenColumns(1)`，留 `setFrozenRows()`。原地留一段註解講為什麼不能加回來 |
| `tests/helpers/appsScriptStub.js` | `merge()` 改走新的 `addMerge()`，多存一份數字邊界 `mergeBounds`；`setFrozenRows()` / `setFrozenColumns()` 學會在凍結線穿過合併範圍時丟例外，訊息照 Google 的原文 |
| `tests/sheet-script.test.js` | 原本斷言 `frozenCols === 1`，改成 `0` 並寫清楚為什麼；多一條測替身本身的護欄 |

`resetSheet()` 裡的 `setFrozenColumns(0)` 留著 —— 0 不會切到任何東西，
而且它防的是「上一版留下來的凍結欄」。

### 護欄真的有效

把 `setFrozenColumns(1)` 暫時加回去重跑，**14 條測試當場失敗**，訊息是：

> Error: 很抱歉，你無法凍結僅包含部分合併儲存格的欄。請取消合併儲存格，或凍結更多欄以納入全部的合併儲存格。（客戶A 凍結 1 欄）

和她在 `#/settings/report` 按「立刻推一次」收到的那句一模一樣。
在這之前，同樣的程式碼是**測試全綠**的。

### 還沒驗證的

一樣只跑過替身。**要她把 `sheets/readonly-report.gs` 重新貼進 Apps Script 並重新部署**
（改的是 `.gs`，app 那側不用動），再按一次「立刻推一次」。
預期看到 21 張分頁全部畫完並上鎖。

如果這次又炸在別的地方，那會是替身抓不到的第二個 Google 行為差異 ——
處理方式一樣：把錯誤訊息貼回來，在替身補一條對應的護欄，再修。
