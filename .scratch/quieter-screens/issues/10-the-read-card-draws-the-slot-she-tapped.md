# 10 另外三頁也改成「點哪一段就看哪一段」

Status: done
Blocked by: 05, 06, 09
動工前先讀：`.scratch/quieter-screens/spec.md`、`docs/adr/0080`、`docs/adr/0085`、`docs/adr/0056`

## 她要的

> d 如果真的像是，看這個月進度或是像是待辦任務例如examine那邊點人名進去，會呈現一整天的時段，那能不能除了先呈現那一天的時段以及那一天的待辦，也要可以個別時段都可以點，知道那個時段的詳情，但是我還是希望大部分都先改成呈現這一段的詳情而不是這一整天的
>
> b 再來 : 日曆新增來訪為什麼會出現這一天整筆的，下面那個狀態應該是這個時段的吧？

談定的方向（2026-09-10）：**每一段自己一列，點了才看細節。**

## 為什麼會這樣

`slotsToShow(visit, focusSlot)`（`domain/visits.js:457`）有一條刻意的退路：
**沒指定就是全部**。而那三頁一個都不傳：

| 入口 | 呼叫端 | 傳 focusSlot？ |
|---|---|---|
| 看這個月進度 | `ui/views/progress.js:296` | ❌ |
| 待辦中心・點人名 | `ui/views/home.js:1189` | ❌ |
| 待辦中心・任務列點詳情 | `ui/views/home.js:2103` | ❌ |
| 客戶詳情 | `ui/views/customerDetail.js:1761` | ❌ |
| 日曆 | `ui/views/calendar.js:854` / `1473`（走 `parseOpen()`） | ✅ |

而且那幾段畫成 `<div class="readslot">`（`calendar.js:1438`）—— **不是按鈕、
沒有 `data-open`、沒有任何 listener**。`parseOpen()` 只在 `calendar.js` 的四處被呼叫。

`slotsToShow()` 已經算好了 `focused` 與 `hidden` 兩個值，現在**沒有人畫它們** ——
2026-09-08 那一行連同「看全部」一起拿掉了（她：「純粹且僅呈現該時段課程的資訊」）。
這一支要用回它們。

### b 的行號跟她猜的不一樣

`visitEditor.js:335` 那個 `<details>「這一天整筆的」`**在新增時整段不會 render**
（`333` 行是 `${isNew ? '' : …}`，而日曆新增走 `mountNew()`，`existing === null`）。

新增路徑上唯一會出現的整筆狀態，是抬頭那顆 badge：`visitEditor.js:277` 印
`describeStatus(draft.status)` —— **整筆推導出來的那一個**。依 ADR-0085
這裡該印那一段的（`statusForCard()`）。她的直覺對，行號不同。

### 順帶要收掉的落差

ADR-0085 白紙黑字寫「帶了 `slotIndex` 就**沒有**整筆的狀態卡與危險區」，
但程式只是把 `<details>` 摺起來（不加 `open`，`visitEditor.js:334`），理由寫在
`325-332` 行的註解裡（ADR-0060：長按不能是唯一的路）。

**談定的：改程式，真的拿掉。**「改這一天的狀態」另外留一條點得到的路
（讀取卡片上一顆「改這一天」，或長按選單那一顆），舊 ADR 一個字不改。

## 怎麼做

1. `visitReadHtml()`（`ui/views/calendar.js:1425`，**四個畫面共用**）：
   `slotsToShow()` 回 `focused: false` 時，每一段畫成**可以點的一列**，
   帶 `data-open="visit:<id>:<第幾段>"`
2. 那三頁接上 `parseOpen()`，點某一段就重開一張只有那一段的讀取卡片。
   **`parseOpen()` 只有一支，四個接線的地方走同一支** —— 沒有人自己 `split`，有測試盯著
3. 那三頁的卡片副標改成 `statusForCard(visit, focus)`（現在讀 `visit.status`：
   `progress.js:299`、`home.js:1202`、`home.js:2115`）。整筆那一個是推導的 ——
   加一段沒問過客人的進去就會退回「待確認」，而她點的可能是早上那段已經談定的（ADR-0085）
4. `visitEditor.js:277` 的抬頭 badge 改成那一段的
5. 帶了 `slotIndex` 時 `visitEditor.js:333` 那個 `<details>` 整塊不 render；
   「改這一天的狀態」留一條別的路
6. `taskMirror` 的抬頭跟著走（`taskMirror.js:70`：`這一項的待辦` / `這一天的待辦`）——
   那兩句本來就都是真的，不用改字，只是現在三頁會走到前面那一句了

## 判準

- **這一列講的範圍，跟點下去會看到的東西，是同一個嗎？**
- 那三頁點某一段 → 只看到那一段（不是整天）
- 那三頁**先看到的**仍然是「那一天有哪幾段」＋ 那一天的待辦（她指名要留這一層）
- 日曆的行為一個 px 都沒有變（它本來就對）
- 客戶詳情那一張跟著一起改（它也是共用 `visitReadHtml()` 的四頁之一）
- 那四頁**還是沒有鉛筆**（ADR-0056：只有日曆改得動來訪）
- 帶了 `slotIndex` 進來訪編輯器時，畫面上找不到整筆的狀態卡與危險區，
  但「改這一天的狀態」還有一條點得到的路（ADR-0060）
- `ui/components/taskMirror.js` 那一塊**只給看不給勾**，一個 `<input type="checkbox">` 都沒有
- 測試：先寫失敗測試 —— 一筆兩段的來訪，在進度追蹤上點第二段，
  斷言浮出來的卡片只含第二段，且副標是第二段的狀態
