# 03 重畫變快：同一種動作收成一次

Status: done
Blocked by: 02

## 動工前先讀

- `02-gs-batch-normal-push.md`（同一支 `.gs`，順序：02 先）
- `sheets/readonly-report.gs` 從 `renderCustomer()` 到 `finish()` 整段、`resetSheet()`、`ensureSize()`、`protectSheet()`
- `tests/helpers/appsScriptStub.js` —— **字型、粗體、字色、對齊、換行現在是空的（不記）**，要比得出改前改後一樣，替身要先記得住

## 她要的

> 我只想要重畫可能快好幾倍或是推的時候更快

## 為什麼會這樣

34 頁整份重畫（替身數的）：讀 619、寫 6,506、寫完又馬上讀 276；實際約 192 秒。最多的是一格一格下的：
`setVerticalAlignment` 1066、`setValue` 992、`merge` 978、`setBackground` 750、`setWrap` 728、`setFontWeight` 492、`setColumnWidth` 390。
例：`noteBlock()` 每一行各自 `merge().setValue().setWrap().setVerticalAlignment()`；矩陣上色逐格 `setBackground`；`banding()` 逐列；
欄寬逐欄 `setColumnWidth`；`styleHeader()`、`blockHead()` 每次一串鏈。

## 做法（Google 官方的 Apps Script 最佳做法：批次、不交錯讀寫）

- 一頁先在記憶體裡組好「每一格的值」二維陣列（矩陣、註記列、二返註記、買過什麼、營養品、備註、來訪紀錄、TODO／FINISHED），`setValues` 盡量少次
- 底色：整頁一張 `setBackgrounds()` 陣列（矩陣的狀態色、斑馬紋、表頭、區塊抬頭、營養品沒給完的那幾列）
- 字型大小／顏色／粗體：`setFontSizes`／`setFontColors`／`setFontWeights` 陣列，或同一種樣式的格子收成一個 `RangeList`
- 整頁共通的（垂直置中、換行）一開始對整個範圍下一次，不要每一塊各下一次
- 合併：同一段連續的列用 `mergeAcross()` 一次（它把每一列各自合併）
- 欄寬：`setColumnWidths(起, 幾欄, 寬)` 一次
- `resetSheet()`、`ensureSize()`、`protectSheet()` 的讀：能從一開始讀到的那一份拿就不要再讀（`getMaxRows`／`getMaxColumns`、`getEffectiveUser` 一次推送一次）
- **畫出來的長相一個像素都不變**（位置、合併、顏色、字、鎖都一樣）。`LAYOUT_VERSION` 加一（`tests/sheet-fingerprint.test.js` 釘著程式碼雜湊，改了一定要加）：部署後第一次推送每一頁重畫一次

## 判準

- 改前改後同一包畫出來的每一格的值、底色、字型、合併、欄寬、凍結列、鎖，有沒有任何一樣不同？（替身要記得住才比得出來；拿測試的幾包與正式站 11/5 那一包各比一次 ——
  正式站那一包在主資料夾的 `.local/references/試算表健檢-2026-11-05/bundle-pushed.json`，比的結果只印數字）
- 0 筆額度、0 個日期、沒有營養品、沒有買過什麼、沒有待辦、日期很多（矩陣比 FINISHED 那一欄還寬）的那幾種頁還畫得對嗎？（`.gs` 裡每一個 `if (!rows.length)` 的分支）
- 一頁重畫叫 Google 的次數有沒有寫成測試釘住？

## 過目抓到的（主控對過）

- **換行不可以整頁一次下**：第 1–3 列、區塊抬頭、「（沒有）」沒設換行（`.gs` 約 286–295、588、617 行），列高又固定 26 —— 整頁換行長字會被裁
- **字級現在全是 11**：`finish()` 最後整頁 `setFontSize(11)`，把名字的 14、註記列的 9 都蓋掉了（主控對過）。**照現在的樣子畫**（一個像素都不變），
  不要順手「修好」—— 已記進 HANDOFF「中途發現」，段末問她
- 底色是先畫斑馬紋、再用狀態色蓋上去：陣列照這個先後組
- `RangeList` 沒有合併的方法；順序要 `breakApart` → `setValues`（合併區非左上的格子填 ''）→ 合併。寫進已合併的區域 Google 會怎樣，替身驗不出來，交付時要列成「只在 staging 驗得到」
- 日期 0 欄時不可以叫 `setColumnWidths`（寬度 0 欄）；`insertSheet` 之後要更新名字對照
- 替身：`''` 會被算進 `getLastRow`（Google 不算），比對兩份 `.gs` 時要注意；替身要補記字級、粗體、字色、對齊、換行、列高與陣列那幾支 API
- `scripts/sheet-gs-calls.mjs` 還沒數 `PropertiesService` 與 `RangeList` 的呼叫 —— 補上再量「改後」
- `tests/sheet-fingerprint.test.js` 的雜湊只去掉區塊註解與整行 `//`，行尾 `//` 改了也算：03 加一次 `LAYOUT_VERSION` 就好（02 沒改畫法，但雜湊照樣會變 → 02 先暫時更新那一條釘住的雜湊或跟 03 一起加，段自己判斷，寫進「做完時留下的」）

## 做完時留下的

**數字**（`scripts/sheet-gs-calls.mjs`，正式站 11/5 那一包 34 頁；02 之後的數法：替身的 RangeList 轉叫 Range 那幾次不算）：

| | 讀 | 寫 | 寫完又馬上讀 | 文件屬性 |
|---|---|---|---|---|
| 整份重畫 改前（`3dd2ee12`） | 619 | 6,506 | 276 | 103 |
| 整份重畫 02 之後 | 314 | 6,496 | 102 | 69 |
| 整份重畫 03 之後 | 246 | **1,498** | **34** | 69 |
| 第一次（每一頁都是新的）改前 → 改後 | 383 → 139 | 6,405 → 1,404 | 243 → 69 | 103 → 69 |

一頁重畫：寫約 190 次 → 約 44 次；寫完又讀一頁一次（上鎖時問誰能改）。剩下最多的是 `merge`（一頁約 8 個：第 1～3 列、TODO／FINISHED 的抬頭與「（沒有）」—— 欄數不一樣、不相鄰，收不成一次）。
文件屬性 69 ＝ 每一頁畫之前拿掉指紋、畫完記一次（「畫一頁就記一頁」要留著，不能收成一次）＋一開始讀一次。

**做法（跟 issue 寫的不一樣）**：沒有把每一塊改寫成組陣列。畫法的程式碼一行都沒改，`renderCustomer()` 裡的 `sheet` 換成一張草稿紙（`Canvas`：
`getRange()` 回一個記錄器，記每一格最後的值與格式、每一次合併、框線、欄寬、列高、凍結；`getLastRow()` 照 Google 的算法），畫完 `paint()` 一次寫上去：
值一次 `setValues`（合併區除了左上角是 ''）→ 每一種格式照值分組、拼成長方形、一次 `getRangeList(...).setX(值)` → 連續同寬的單列合併一次 `mergeAcross()` → 框線 → `setColumnWidths` → 列高 → 凍結。
好處：「畫出來一樣」幾乎是照著構造來的（畫法沒動），而且以後改畫法的人照舊寫 `sheet.getRange(…)`。
**沒設過的格子不碰**（不是整頁一張陣列帶 null 下去）：換行只下在原本下過的格子、`setFontColors(null)` 之類的「null 等於重設」不用賭。

**替身補記的格式**：字級、粗體、字色、字型、左右對齊、上下對齊、換行、底色（每一格最後一次的值）、欄寬、列高（每一列）、框線（每一次呼叫的範圍與參數）、
鎖的說明／拿掉了誰／網域。陣列那幾支（`setBackgrounds` 等）沒做 —— 沒用到；用到的是 `getRangeList()`（`RangeList` 的格式那幾支、`breakApart`、`setBorder`）。

**驗過的**：`tests/sheet-gs-batch.test.js` 四步雜湊（改前的 `.gs` 跑出來的）照樣對；正式站那一包 `scripts/sheet-gs-compare.mjs` 四步每一樣都 0 個不一樣；
故意拿掉合併、拿掉寫值、列高錯一列 → 比得出來（收成一次與不收成一次的兩種寫法比不出來，那是對的）。
叫幾次釘在同一支測試：10 頁整份重畫 寫 ≤ 500、寫完又讀 ≤ 10、不准出現 `Range.setValue`／`setBackground`／`setWrap`／`setVerticalAlignment`、`Sheet.setColumnWidth`、`getLastRow`。
`LAYOUT_VERSION` 1 → 2：部署後第一次推送每一頁重畫一次（約 1,500 次寫，照比例估 1 分鐘內 —— 要實測）。

**只在 staging 驗得到**：
- 真的快多少（Apps Script 執行紀錄的秒數，改前約 192 秒）
- `getRangeList()` 一次帶幾十塊 A1 的實際表現；格式下在還沒合併的格子、之後才合併，Google 那邊合併後的格子是不是照左上角那一格的格式（照文件是；替身是照每一格記）
- 先 `setValues`（合併區非左上角寫 ''）再合併：Google 不會跳「只保留左上角的值」的確認（指令碼裡不會跳；'' 本來就是空的）
