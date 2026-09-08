# 提醒集中派生：先修好三個漏傳主檔的畫面，再清點全站

Status: todo
來源：使用者，2026-09-08（需求 6）
動工前先讀：`domain/consequences.js` 整支、`docs/adr/0070`

## 她要的

> 我修改課程設定的（例如要不要簽療程單或是寫記錄），這個提醒不會更新誒？
> 這種東西不是應該統一的集中管理，我改一個就會全域同步更新嗎？

## 一、先講一件好消息：**集中派生已經做完了**

`domain/consequences.js` 就是那一份，五支全部是純函式、全部現算：

| 函式 | 用在哪 | 讀什麼 |
|---|---|---|
| `bookingConsequences()` | 壓表、來訪編輯器 | `coursesById` 現算 |
| `confirmConsequences()` | 待辦中心確認動線 | `coursesById` 現算 |
| `closeConsequences()` | 收尾抽屜 | `course.needsRecord`、`needsTreatmentForm` 現算 |
| `untickConsequences()` | 拿回一張待辦 | `previewTaskChange()` 同一台引擎 |
| `cancelConsequences()` | 日曆長按、來訪編輯器 | `bookingSystemsForVisit()` 現算 |

**一句寫死的字串都沒有。** 所以她看到的「不會更新」不是架構問題。

## 二、真正的原因：三個畫面漏傳 `coursesById`

`visitReadHtml()` 四頁共用，但：

| 畫面 | `coursesById` |
|---|---|
| 日曆 `calendar.js:1447` | ✓ |
| 客戶詳情 `customerDetail.js:1764` | ✓ |
| 待辦中心「跟客人確認時間」`home.js:1188` | **✗** |
| 待辦中心 任務詳情 `home.js:2091` | **✗** |
| 進度追蹤 `progress.js:289` | **✗** |

沒傳 → `formSlotIndexes(visit, {})` → 課程全部是 `undefined` →
`needsForm(undefined)` 回 `true`（**沒有欄位就是要簽**，`visits.js:271`）→
那三頁**一律**寫「簽療程單」，就算她把那個課程的開關關掉了。

**修法**：三處補上 `coursesById`。`progress.js` 的 `ctx` 連建都沒建，
要跟著 `roomsById`／`staffById` 一起建（`progress.js:63-70`）。

## 三、防止再發生：一支測試

`tests/` 加一支，掃 `visitReadHtml(` 的每一個呼叫端，
**要求 `coursesById` 與 `master` 兩份都帶了** —— 形狀照抄既有那一支
`會講「那天做了什麼」的畫面都帶著主檔`（它已經在盯 `master` 了，
只是沒盯 `coursesById`）。

漏帶的症狀是「畫面在講一件不會發生的事」，而那比沒講還糟（ADR-0070）。

## 四、「寫紀錄」看不到：那不是漏更新，是還沒發生

她說「我發現沒有寫記錄?」。`todosForVisit()` 列的是**已經存在的任務** ＋
兩列推導（確認時間、簽療程單）。而「寫紀錄」是**第二個時機**的任務
（ADR-0066）：那一場做完（`done` / `no_show`）之後才長出來。

所以在那之前它**真的不存在**，不是沒列。

**要做的**：`todosForVisit()` 多一列推導 —— 課程勾了 `needsRecord` 就先列出來，
標成還沒發生：

```
○ 寫紀錄        做完那一場之後才會長出來
```

判準跟 `recordTasksForVisit()` 同一支（`needsRecord(visit, coursesById)`），
**不要在這裡再判斷一次課程名字**。

同樣的做法要不要套到掛號那一族（Examine／耀聖也是客人確認後才長）——
**要**，理由一樣：她要看的是「這一場的全部」（2026-09-04 她的原話）。

## 五、全站提醒字句的清點

動工時逐一走過，把還在畫面上寫死的搬進 `domain/consequences.js`：

| 位置 | 現況 | 要做的 |
|---|---|---|
| `visitEditor.js` 存檔確認 | 走 `bookingConsequences()` | ✓ 不動 |
| `schedule.js` 存檔確認 | 走 `bookingConsequences()` | ✓ 不動 |
| `home.js` 確認動線 | 走 `confirmConsequences()` | ✓ 不動 |
| `home.js` 收尾抽屜 | 走 `closeConsequences()` | ✓ 不動 |
| `calendar.js` 長按取消 | 走 `cancelConsequences()` | 加 `slotIndex`（地基那一支） |
| `schedule.js` 「結束這一批」 | **寫死三句** | 整顆按鈕拿掉（`issues/12`） |
| 批次取消專區 | 還沒有 | 走 `cancelConsequences()`（`issues/11`） |
| `taskMirror.js` 抬頭 | 寫死「這一天的待辦」 | `issues/06` |

## 測試

- 課程關掉「要不要簽療程單」→ 四個畫面的讀取卡片**同時**不再說要簽
- 課程勾上「做完要不要寫紀錄」→ 四個畫面**同時**多一列「寫紀錄」
- 掃描測試：每一個 `visitReadHtml()` 呼叫端都帶了 `coursesById` 與 `master`
