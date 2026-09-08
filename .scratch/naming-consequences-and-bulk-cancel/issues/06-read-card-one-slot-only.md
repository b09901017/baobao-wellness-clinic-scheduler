# 讀取卡片就只畫那一段，「看全部」拿掉

Status: done
來源：使用者，2026-09-08（需求 5c、5d）
動工前先讀：`docs/adr/0080`（這一支要補一段「後來改了」）

## 她要的

> 徹底修復點擊單一預約項目進詳情時，介面將同一天所有課程串接渲染或顯示
> 「這一天還有另外 n 段 - 看全部」的多餘行為。
> 點擊哪一個時段的課程，詳情視窗就純粹且僅呈現該時段課程的資訊。

## 一、`slotsToShow()` 一個字都不用改

ADR-0080 已經做了 —— 日／週那一列的 `data-open` 帶著第幾段，
四個接線的地方走同一支 `parseOpen()`，有測試盯著。

**要拿掉的只有那顆「看全部」按鈕**（`visitReadHtml()` 裡的 `hidden ?` 那一段）。

ADR-0080 第三點刻意加了它（理由是「這天他還來做什麼」是她會問的問題），
她現在說不要 —— 那一支的「其他做法」那一節寫的正是這個選項。
**不改 ADR-0080，補一段「2026-09-08 之後」**（同 ADR-0078 那一節的做法）。

## 二、「這一天的待辦」改名成「這一項的待辦」，而且內容要真的是那一項

`ui/components/taskMirror.js` 的抬頭現在寫死「這一天的待辦」，
而它的檔頭寫著為什麼：

> `todosForVisit()` 收的是來訪，而掛號、療程單、寫紀錄那幾張本來就綁著一整筆。

**地基那一支合了之後這句話就不成立了** —— 時段自己有狀態，療程單逐段判斷。
所以：

- 抬頭改成 **「這一項的待辦」**（她指名的字）
- `mirrorHtml({ visit, tasks, focusSlot })` 收 `focusSlot`
- 有 `focusSlot` 時只列**跟那一段有關**的：
  - 那一段自己的「跟客人確認時間」「簽療程單」（走 `slotStatusOf()`）
  - 課程綁的任務：寫紀錄（`course.needsRecord`）
  - 掛號那一族（Examine／耀聖）**照那一段的課程類別**，不是整筆的
- **沒帶 `focusSlot` 時一個字都不變** —— 客戶詳情、待辦中心、進度追蹤
  列的本來就是整筆（同 `slotsToShow()` 的退路）

`todosForVisit(visit, { tasks, coursesById, focusSlot })` —— **規則寫在 domain**，
不要在 `taskMirror.js` 裡濾。

## 三、掛號那一族逐段對應

`domain/taskRules.js` 的 `bookingSystemFor(category)` 已經是逐課程的。
一段復能（Abovee）＋ 一段健檢（Examine）的那一天，點復能那一段只該看到
Abovee 那一張。任務身上有 `visitId` 沒有 `slotIndex`，所以配對靠
**那一段的課程類別 → 掛號系統 → 任務種類**。

## 測試

- 三段的來訪，`focusSlot: 1` → 只畫第 1 段，沒有「看全部」
- 抬頭是「這一項的待辦」
- 一段復能一段健檢：點復能那一段看不到 Examine 那一張
- 沒帶 `focusSlot` 的三頁**一個字都沒變**（回歸）
- `tests/calendar.test.js` 那一支盯著 `slotsToShow` 的原始碼比對要跟著改
