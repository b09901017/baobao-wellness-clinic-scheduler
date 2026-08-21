# 跨天的行事曆事件無聲塌成一天：`parseIcs()` 從來沒讀過 `DTEND`

Status: 待動工
回報者：使用者，2026-08-21
動工前先讀：`.claude/skills/calendar-sheet-merge/scripts/merge.mjs` 的 `parseIcs()`、
`domain/events.js` 的檔頭、`docs/adr/0015-calendar-is-a-first-class-surface.md`

## 症狀

她的原話：

> 我發現行事曆匯入的時候沒辦法匯入跨天的嗎？是解析的問題還是 import.json 的問題？

**是解析的問題。** app 這一側完全沒有錯。

## 三邊各自的狀況

| | 支不支援跨天 |
|---|---|
| `domain/events.js` | ✅ 檔頭第一句就是「這是唯一可以跨天的資料」。月檢視畫橫跨格子的色條、`daysBetween()`、`coversDate()` 全都在 |
| `firestore.rules` | ✅ `validEvent()` 連 `endDate >= startDate` 都擋了 |
| `domain/mergeImport.js` 的 `eventDocs()` | ✅ 照著 `startDate` / `endDate` 建 |
| **`merge.mjs` 的 `parseIcs()`** | ❌ **只讀 `DTSTART`，整支檔案沒有出現過 `DTEND`** |

```js
const m = /^(\d{4})(\d{2})(\d{2})T?(\d{2})?(\d{2})?/.exec(d.DTSTART ?? '');
if (!m) continue;
```

然後輸出時直接寫死：

```js
startDate: e.date, endDate: e.date,
```

實測她 2026-08-19 那份檔案：**198 筆 `eventCandidates`，跨天 0 筆。**
一條「8/10–8/14 出國」進來只剩 8/10 一天，而且**不會出現在任何清單裡說它被砍了**。

## 第二個要一起查的：整天事件的時間是猜的

同一份檔案裡 **198 筆全部都有 `startTime`，一筆整天事件都沒有** —— 這很不尋常。

`parseIcs()` 對整天事件（`DTSTART;VALUE=DATE:20260810`，沒有 `T`）會給 `clock: null`，
但 `timeOf()` 會退回去猜：

```js
const timeOf = (e) => timeInSummary(e.summary)?.start ?? e.clock ?? null;
```

`timeInSummary()` 是從標題文字認時間的（她寫「2.30」「9：15」）。
所以一筆整天事件只要標題裡有數字，就會被安上一個假的時間，
匯進來變成一筆有時有分的行程。

**還沒證實**她的 `.ics` 裡到底有沒有整天事件 —— 要拿原始檔確認。
如果有而且全被安上時間了，那是同一個洞的另一半。

## 想要的樣子

`parseIcs()` 多回兩個欄位：

| 欄位 | 怎麼算 |
|---|---|
| `endDate` | `DTEND` 的日期。**整天事件的 `DTEND` 是不含端點的**（iCalendar 規格：8/10–8/14 會寫成 `DTEND;VALUE=DATE:20260815`），要減一天 |
| `allDay` | `DTSTART` 有沒有 `VALUE=DATE`（或沒有 `T`） |

`eventCandidates` 照著帶出去；`domain/mergeImport.js` 的 `eventDocs()` 已經吃得下了
（它現在是靠 `isValidTime(c.startTime)` 反推 `allDay`，有了明確欄位就不用猜）。

`timeOf()` 對 `allDay` 的事件**不要回退去猜標題**。

## 一起補的護欄

`parseIcs()` 現在有一條 `if (!m) continue;` —— `DTSTART` 解不出來的事件
**整筆消失，而且不會出現在報告裡**。這是同一類問題（東西不見了但沒人說），
順手讓它累積一份「這 N 筆讀不出來」丟進報告與 JSON。

## 動工順序

這一支和 `issues/03`、`issues/05` 不相依，可以先做也可以後做。
但**做完之後她要重跑一次 skill** 才拿得到含 `endDate` 的檔案 ——
所以如果她已經在用現在那份，先做 app 那三支比較划算。

## 不要順手做的事

- **不要順手在 `merge.mjs` 裡判斷「未來」。** 理由見 `issues/03`。
- **不要把跨天事件拆成好幾筆單天的。** `domain/events.js` 就是為了不那樣做才存在的。
