# 跨天的行事曆事件無聲塌成一天：`parseIcs()` 從來沒讀過 `DTEND`

Status: done
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


## Comments

**2026-08-21 — 做完了。** `npm test` 從 722 變成 739 全過。

| 在哪裡 | 做什麼 |
|---|---|
| `merge.mjs` 的 `parseIcs()` | 屬性的參數（`;VALUE=DATE`）現在留得住；新的 `icsMoment()` 同時解 `DTSTART` 與 `DTEND`；每筆事件多回 `endDate` 與 `allDay` |
| 同上 | 回傳從陣列改成 `{ events, unreadable }`。`DTSTART` 讀不出來的那幾筆不再 `continue` 掉，累積起來 |
| 同上 | 新的 `timeOf()` 提到模組層級（本來藏在 `importJson()` 裡）：**整天事件不回頭猜標題**。報告與 JSON 兩邊共用同一支 |
| `reconcile()` | 收下 `unreadable` 往外帶；`span` 的右界改看 `endDate`（跨到月底的休假，涵蓋範圍就到月底） |
| `importJson()` | `eventCandidates` 帶 `endDate`、`allDay`；多一份 `unreadable[]` |
| `reportText()` | 表頭多一句「其中 N 筆跨天」與「另外有 N 筆讀不出來」；⑥ 區的整天標成「整天」、跨天標出「到 X，共 N 天」；新的 ⑦ 區列讀不出來的那幾筆 |
| `SKILL.md` | 契約那一段補上 `allDay`、`unreadable[]`，並寫清楚 `endDate` 是真的結束日 |
| `domain/mergeImport.js` | `eventDocs()` 有明確 `allDay` 就用它，沒有才反推；整天事件的時間一律清掉；`endDate` 比 `startDate` 早的當成單天 |
| 同上 | `validateFile()` 把 `unreadable` 算進 warnings |
| `tests/calendar-merge.test.js` | **新檔**。`merge.mjs` 在這之前一支測試都沒有 |

### 整天事件那一半：確認了，而且是同一個洞

不用等她的原始檔了 —— `parseIcs()` 本來就沒有在判整天，所以
「198 筆全部都有 startTime，一筆整天事件都沒有」是**必然**的結果，不是巧合：
`clock` 是 null 的時候 `timeOf()` 會退回去用 `timeInSummary()` 認標題，
而她的標題幾乎都有數字。有了 `allDay` 這個明確欄位之後就不必猜了。

### 護欄真的有效

把 `parseIcs()` 暫時改回舊行為（不讀 `DTEND`、不判 `allDay`、讀不出來的整筆丟掉），
`tests/calendar-merge.test.js` **14 條裡 7 條當場失敗**。改回來就全綠。
在這之前，同樣的程式碼是**連一支測試都沒有**的。

### 刻意沒有做的

- **`endTime` 還是 `null`。** `DTEND` 的日期拿來用，時間不拿 —— 行事曆的時間欄
  會歪（量到過 3:45 存成 18:00），而 `startTime` 是從標題認的。兩邊拿不同來源
  湊一組起訖，會湊出「結束比開始早」的時段。app 那側照舊用課程時長往後推一小時。
- **跨天事件沒有拆成好幾筆單天的**（issue 裡寫著不要）。
- **`byDate` 只索引開始日**，所以一條跨天的個人行程不會被拿去跟中間那幾天的
  來訪配對。那是對的：療程配對配的是「某人某天做了什麼」。
- **格式版本沒有動，還是 `baobao-merge/v1`。** 新欄位全部可選，
  app 那側有就用、沒有就退回原本的反推。**她手上那份 8/19 產的檔案照樣貼得進去**
  （跨天的事件當然還是缺，那要重跑 skill 才有）。

### 還沒驗證的

**`.gs` 一個字都沒改，不用重新部署。** 但**要重跑一次 skill 才拿得到含 `endDate`
的合併檔**：

```
node .claude/skills/calendar-sheet-merge/scripts/merge.mjs \
  --sheets <tsv 資料夾> --ics <你的 .ics> --year 2026 \
  --aliases .local/aliases.json --out <輸出資料夾>
```

跑完先看報告最上面那一行會不會出現「其中 N 筆跨天」。
另外看一眼有沒有 ⑦ 區：那一段列的是**這次讀不出來的**，
在這之前它們是連提都不會提就消失的。

如果跨天還是 0 筆，那代表她的 `.ics` 用的是第三種寫法（既沒有 `DTEND`
也沒有 `DURATION`，或者 `DURATION` 寫成別的形狀）。把那幾行原文貼回來就補得掉。

### 順手多做的：`DURATION`

有些匯出器不寫 `DTEND`，寫 `DURATION:P5D`。issue 上沒提，但那條路上的症狀
跟這一支要修的完全一樣（跨天的事件無聲塌成一天），而且是同一個 `if` 裡的事，
所以一起補了。只認天（`P5D`）與週（`P1W`）兩種 —— 只有時分的（`PT2H`）跨不跨天
要看 `DTSTART` 的時間，而**那個欄位會歪**，所以一律當同一天：
寧可少算一天，也不要在她的日曆上多畫一天出來。
