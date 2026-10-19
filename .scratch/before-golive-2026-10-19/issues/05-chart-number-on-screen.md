# 病歷號在畫面上：表單一格、備註那一段一顆丸子（icon C）、搜尋、同號提醒

Status: todo
段：二（high）
Blocked by: 04
動工前先讀：`ui/components/customerForm.js`（新增客戶與拍訂購單確認卡共用：電話、LINE 那兩格、`confirmReview()`、同名那個 ⚠）；`ui/views/customerDetail.js` 編輯客戶那張表（約 1461、1510 行的 `lineId`）、備註那一段的接線（約 559–590 行：電話按住複製 `wireLongPress()`、LINE 開對話）；`ui/components/marks.js` 的 `noteChip()`；`ui/components/notesEditor.js`（電話／LINE 那兩列與那一顆 `tip()`）、`noteReorder.js`；`ui/icons.js`；`ui/views/customers.js` 的搜尋（`nameHas()` 一格一格問）；`domain/bulkCustomers.js`／`ui/views/customersBulk.js`（有沒有電話、LINE 那兩欄）；`spec.md` 的 icon 那一段；`CLAUDE.md`「打字找客戶的框」「畫面上一段常駐的說明」「一顆小圖示按鈕的觸控區」三列

## 她要的

見 04。icon：她選 **C（證件・人像）**，path 在 `spec.md`。

## 做法（方向）

1. **icon**：`icons.js` 多一顆（名字例如 `idcard`），path 照 `spec.md`。`ICON_NAMES` 有測試掃的話跟著
2. **表單**：編輯客戶、新增客戶（`customerForm.js`，所以拍訂購單那一層也有）多一格「病歷號」，跟電話、LINE 放在一起，**不必填**。數字鍵盤（`inputmode="numeric"`），但**不用 `type="number"`**（前面的 0、`step` 那個坑 —— CLAUDE.md `type="number"` 那一列）
3. **同號提醒**：另一位（在服務中或停用的都算）已經是這個號碼 → 那一格旁邊一個 ⚠（`tip(…, { kind: 'warn' })`，同同名那一顆），存檔前 `confirmReview()` 再講一次「病歷號 1234 已經是王小明的」—— **不擋**（ADR-0002）。比對走 `normalizeChartNo()`（`00001234` 跟 `1234` 是同一個）
4. **備註那一段**：`noteChip()` 多一種 `chartNo`：icon C（`mark__glyph--chart`，顏色同電話 `--text-dim`）＋號碼（`.mark__num`），**點了不開任何東西，按住複製**（同電話那一顆認不出號碼時的那一條路；`wireLongPress()`）。`aria-label="病歷號 1234（按住複製）"`
5. **調整順序**：`noteReorder.js` 那一份清單多它一列（跟電話、LINE 一樣拖得動）；`notesEditor.js` 電話、LINE 那兩列的「在『編輯』客戶資料裡改」那一顆 `tip()` 照樣給它
6. **搜尋**：客戶清單的搜尋多比病歷號（`nameHas()` 單獨問那一格；打 `1234` 找得到 `00001234` 嗎 —— 用 `normalizeChartNo()` 先正規化再比）。placeholder 那一句加「病歷號」
7. **壓表卡片牆**：不畫（她：「對」）—— 它讀 `marks`，病歷號不在 `marks` 裡了，所以本來就不會畫；E2E 量一次
8. 批次建立：那一頁有電話／LINE 欄位的話一起加；沒有就不加（段二看了寫進「做完時留下的」）

## 過目改的（10/19）

- 同號提醒放進 `domain/customers.js` 的 `fieldWarnings()`（同名那一句的同一支）；**編輯客戶那張表現在只讀 `.name`**（`customerDetail.js:1527` 附近）→ 要多讀病歷號那一格。
- 按住複製用自己的選擇器（`data-notes-chart`），不要借 `data-notes-phone`（那一條會叫 `copyPhone()`）。
- icon 的鍵叫 `chartNo`（`notesEditor.js:46` 用 `icon(it.kind)`）。
- 新的 E2E spec 登記進 `tests-e2e/related.js`；新的檔案加進 `public/sw.js` 的 `SHELL`（CLAUDE.md）。

## 判準

- 編輯客戶 → 病歷號打 `1234` → 存：客戶詳情備註那一段多一顆 icon C 的丸子寫 `1234`；按住 → 複製；點一下 → 什麼都不開
- 調整順序拖得動它，存完重新整理順序照舊
- 另一位已經是 1234 → ⚠ 與存檔前那一句；按「還是存」存得進去
- 客戶清單打 `1234` 找得到那一位
- 壓表卡片牆上沒有病歷號
- 375／390px 量一次那一列不撐寬（`.cardgrid > *` 那個坑，E2E `59` 的量法：捲的是 `.app__main`）
- 觸控區：那一顆的 `::after` 貼在自己身上（`position: relative`），跟隔壁的丸子不疊（E2E `74` N11 的 `elementFromPoint` 量法）

## 連動

- `docs/操作手冊.md` 新增客戶／編輯客戶那一段一句（病歷號在哪裡填）
- `tests/fewer-words.test.js` 的 `KEEP` 不可以變長
- `public/sw.js` VERSION 段二不用再升（段一升過的話）
