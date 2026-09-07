# 日曆點一段，卻把那一天那位客戶的每一段都畫出來

Status: done
來源：使用者，2026-09-08（需求 4）
動工前先讀：`docs/adr/0018`、`0020`、`0056`、`ui/views/calendar.js` 的 `visitReadHtml()`

## 原話

> 我如果同一天建立客戶A INDIBA以及ILIB…我在日曆點開詳情的時候，
> 為甚麼我點的是復能(INDIBA)，但是卻會一次呈現三個復能(INDIBA)、
> 復能(超磁場)、靜脈(IL)？

## 根因：一列是**一段**，但按鈕上帶的是**整筆來訪**的 id

排班的原子單位是**來訪**（SPEC 第 4.4 節）。同一位客戶同一天壓第二筆時，
壓表那一頁會**併進同一筆來訪**：

```js
// ui/views/schedule.js
const sameDay = sameDayVisit(selected, view.day);
const merged  = sameDay ? withExtraSlot(sameDay, slot, { note }) : null;
```

所以她「建立了三筆」，資料庫上是**一筆來訪、三個時段**。

日／週檢視那一份清單是**一段一列**的：

```js
// domain/calendar.js  agendaFor()
(visit.slots ?? []).forEach((slot, index) => {
  rows.push({ visitId: visit.id, slotIndex: index, ... });   // ← 有 slotIndex
});
```

`slotIndex` 一路算出來了，**但畫成按鈕的時候被丟掉**：

```js
// ui/views/calendar.js  visitRow()
open: `visit:${r.visitId}`,          // ← 只有 visitId
```

點下去之後：

```js
const [what, id] = btn.dataset.open.split(':');
openDetail(el, data, what, id, date, repaint);
   ↓
const visit = data.visits.find((v) => v.id === id);
   ↓
visitReadHtml(visit, ...)  →  visit.slots.map(...)   // ← 三段全部畫出來
```

**這不是資料壞掉，是那一下把「我點的是哪一段」丟掉了。**

## 要改什麼

### 一、`data-open` 帶上是哪一段

```diff
- open: `visit:${r.visitId}`,
+ open: `visit:${r.visitId}:${r.slotIndex}`,
```

`openDay()` 裡那兩處 `split(':')` 都只取前兩格，要一起改成取第三格
（點一下的 `wireRows` 與長按的 `wireLongPress`，兩處）。

**不要用 `split(':')` 之後直接 destructure 三個** —— `note:abc` 與
`event:abc` 那兩種只有兩格，第三格會是 `undefined`，而 `undefined` 要當成
「整筆」不是「第 0 段」。

### 二、`visitReadHtml()` 收一個「只畫這一段」的參數

```js
visitReadHtml(visit, { ...data, focusSlot: 2 })
```

**四個畫面共用這一支**（ADR-0018、0056），所以：

- 沒帶 `focusSlot` 的一律照舊全部畫 —— 客戶詳情、待辦中心、進度追蹤
  那三頁列的本來就是**整筆來訪**（一列一筆，不是一列一段），它們是對的
- 帶了就只畫那一段，**但底下要有一行**：「這一天還有另外 2 段 · 看全部」，
  點下去展開整筆

第二點是必要的：她同一天真的排了三段，而「這天他還來做什麼」是她會問的問題。
少了那一行，這個修法會從「看太多」變成「看不到」。

### 三、「這一場的待辦」那一塊不受影響

`mirrorHtml()` 是**整筆來訪**的行政進度（掛號、寫紀錄），不是逐段的。
只畫一段時那一塊照樣整塊畫 —— 抬頭上要講清楚它是「這一天」的。

## 全域掃描：還有沒有一樣的形狀

一列一段、但點下去給整筆的地方，**全站只有日／週檢視這一處**。逐一確認過：

| 畫面 | 一列是什麼 | 點下去 | 判定 |
|---|---|---|---|
| 日曆 日／週 | **一段**（`agendaFor()`） | 整筆 | ❌ **這一支修** |
| 日曆 月 | 一筆（`visitAsBar()`） | 開那一天的抽屜 | ⚠️ 見下 |
| 客戶詳情 來訪紀錄 | 一筆（`visitRow(v)`） | 整筆 | ✅ |
| 待辦中心 「詳情」 | 一張任務（帶 `visitId`） | 整筆 | ✅ |
| 進度追蹤 | 一筆（`progressDayHtml`，段落列在卡片裡） | 整筆 | ✅ |
| 長按快速動作 | 跟點一下同一個 `data-open` | 整筆 | ❌ **一起修** |

### 月檢視也改成一段一條（A11，她主動要的）

```js
const courses = visitNames(visit, master, 'short');
const course = courses[0] ?? '';       // ← 三段只印第一段的名字
```

同一天三段的那一筆，月檢視上現在是**一條色條、一個名字**。改成一段一條：

```
9/10 (三)
  王小明·IN(30)
  王小明·SIS(30)
  王小明·IL(60)
```

三件要一起處理的事：

1. **`id` 要唯一**。`layoutMonth()` 拿 `id` 當 key，三條同 id 會出事。
   用 `${visit.id}:${index}`。
2. **同一天的順序要照時間**。`domain/events.js` 的 `layoutWeek()` 現在的
   排序鍵是「開始日 → 長度 → 標題（zh-TW）」，同一天的三條會照**名字**
   排（`IL` `IN` `SIS`），而她要的是照時間。
   加一個選填的 `sortKey`，排在標題前面 —— 跨天的行事備註不受影響。
3. **`maxLanes` 是 3**。一天三段 + 一件待辦 = 四件，第四件會收進「+1」。
   她知道這個代價（她自己選的）。**不要順手把 lane 加到 4** ——
   那一格的高度是整個月檢視的版面基準，改了整片會擠。

`visitNames()` 的去重（同一天兩段點滴只印一次）在這個改法下**不再適用** ——
兩段點滴就是兩條，那正是她要看到的。改成逐段畫，`visitNames()` 留給
LINE 草稿用（那裡去重仍然是對的）。

## 測試

- `tests/calendar.test.js`
  - `agendaFor()` 三段回三列，`slotIndex` 是 0/1/2（既有測試補這一條）
- 新增 `tests/visit-read.test.js`（或併進既有的）
  - `visitReadHtml(visit, { focusSlot: 1 })` 只畫第二段
  - 沒帶 `focusSlot` 畫全部（四頁共用的相容性）
  - `focusSlot` 指到一個不存在的 index → 退回畫全部，不要畫成空的
- `tests-e2e/`：同一位客戶同一天壓三段 → 日檢視三列 → 點第二列 →
  卡片上只有第二段、底下有「還有另外 2 段」→ 點開變成三段
