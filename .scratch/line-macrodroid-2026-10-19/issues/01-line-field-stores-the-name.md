# 客戶的 LINE 那一格改存「LINE 上的名字」

Status: todo
Blocked by: —
動工前先讀：`domain/customerNotes.js` 的 `lineHref()`、`LINE_HINT`、`noteItems()`（`lineItem` 那一行）；`ui/components/marks.js` 的 `noteChip()` LINE 那一支；
兩張編輯表單（`ui/components/customerForm.js:143`、`ui/views/customerDetail.js` 的 `paintEdit()` 那一格）；`domain/audit.js` 的 `FIELD_LABELS.lineId`；
ADR-0156 的「電話、LINE 只是位置」；`tests/customer-notes.test.js` 的 `lineHref` 那幾條、E2E `74` 的 N1；`grep -rn "lineId\|lineHref\|LINE_HINT" public/js tests tests-e2e`

## 她要的

> 能不能幫我把原本存的LINE ID 或加好友的網址這個換掉就好，畢竟之前以為可以用LINE ID打開，但是我不想要還要每個客戶問邀請連結或lineid 所以基本上我這個就是改存名字可以嗎 ?

> 1. 都刪掉，並且我之前說過，目前沒有舊資料 … 我目前應該是沒有任何人的網址或id

## 為什麼會這樣

ADR-0156（10/19）讓那一顆 LINE 丸子點了開 `line.me/R/ti/p/~<ID>` 或她貼的網址（`lineHref()`）。那要客人開放 ID 搜尋、或她一位一位去要邀請連結 —— 她不想要。
LINE 沒有「用名字打開對話」的網址，所以那一格改存**她 LINE 好友清單上看到的名字**，打開對話交給手機上的 MacroDroid（02、03）。

## 要做的

- **欄位代號照舊 `lineId`**，意思換成名字（spec 的「策略」）。不搬資料、不加資料健檢
- `lineHref()` **刪掉**（連 `LINE_URL`、`@` 開頭那一條）；`noteItems()` 的 LINE 那一項不再有 `href`（`{ key: 'line', kind: 'line', text }`），註解跟著改
- `LINE_HINT` 換成講名字的一句：打你 LINE 好友清單上看到的名字，一個字都不能差（手機上會拿它去 LINE 搜尋）
- 兩張表單的標籤「LINE」→「LINE 名字」；`FIELD_LABELS.lineId` →「LINE 名字」
- LINE 那一顆丸子**從 `<a href target=_blank>` 改成 `<button type="button" data-notes-line>`**（點了做什麼是 03 的事；這一支先讓它點了什麼都不開 —— 03 接線。**01 與 03 必須在同一個 PR**）。`aria-label` 帶名字（「打開 王小明 的 LINE 對話」）

### 過目補的（10/19）

- **CSS**：改成 `<button class="mark mark--contact">` 之後會吃到 `button.mark::after { inset: -8px 0 }`（app.css:1529），而 -3px 那一條（:1626 `a.mark--contact::after, span.mark--contact::after`）不認 button
  → 多撐的會跨進上一排的下緣，點長備註的下緣變成打開 LINE（E2E 74 N11 量著那個形狀）。**`button.mark--contact::after` 加進 -3px 那一條**；:1612 的註解「電話、LINE 是連結」改掉
- **一定會紅的測試**：`tests/audit.test.js:332`（「改了 客戶A・電話、LINE」→「LINE 名字」）；`tests/customer-notes.test.js:11` 的 `lineHref` import（只刪測試不刪 import 整支載不起來）、:241-263 那幾條改成「沒有 href」；E2E 74 N1（:40-42）、種子 `lineId: 'kehu-a'` 換成像名字的
- 只改字或註解：`customerNotes.js` 檔頭 :20-22 與 `noteItems` 的 JSDoc :123；`marks.js:41`；`ui/views/customers.js:117` 的 placeholder（「LINE」→「LINE 名字」）
- 判準裡的兩支 `customers.js` 是不同的檔：搜尋在 `ui/views/customers.js:275`、提醒在 `domain/customers.js:140` 的 `fieldWarnings()`
- **用字撞名**：課程已經有「LINE 名」（`masterData.js` 的 `lineName`，貼給客人那一句裡的課程名）。客戶這一格叫「LINE 名字」，CONTEXT 那一條要講清楚兩者不同（05）

## 判準

- 那一格打「王小明」存起來，客戶詳情那一顆 LINE 丸子**不是連結**（沒有 `href`、沒有 `target`），`noteItems()` 回的那一項沒有 `href`
- `grep -rn "lineHref\|line.me/R/ti" public/js` 一個都不剩
- 客戶清單打 LINE 名字搜得到（`customers.js:275` 不用改，補一條測試釘著）；「沒電話也沒 LINE」的提醒照舊（`customers.js:140`）
- 稽核那一列寫「LINE 名字」

## 做完時留下的

（做完寫）
