# 已取消的來訪在抽屜／日／週檢視整個不見

Status: done
來源：使用者，2026-09-01（需求 A.2）
動工前先讀：`public/js/domain/calendar.js` 的 `agendaFor()`、
`public/js/domain/visits.js` 的 `isActive()` 與 `STATUS_VIEW`、ADR-0039、0045

## 原話

> 「已取消」的來訪目前在日曆視圖上會暗掉，但點開該日的抽屜後，
> 裡面卻沒有顯示為暗掉/已取消狀態。我希望抽屜裡的視覺也能同步暗掉。

## 根因：同一份資料，兩種畫法

| 在哪 | 怎麼處理已取消 |
|---|---|
| 月檢視的色條 | `visitAsBar()` **沒有濾** → 畫出來，`status-cancelled` 給它灰色 |
| 抽屜／日檢視／週檢視 | `agendaFor()` 的 `if (visit.date !== date \|\| !isActive(visit)) continue;` → **整筆不見** |
| 週檢視的「N 筆」 | `summaryByDate()` 也用 `isActive()` → 不算 |

所以她在月檢視上看到一條灰色的色條，點下去那一天卻是空的 —— 而空的那一天
還會印出「這天還沒有東西 —— 但同事在 Abovee 壓的看不到」，那句話在說謊。

`domain/visits.js` 的 `STATUS_VIEW` 檔頭寫著「取消是灰的，而且日曆上根本不畫
（`isActive()` 濾掉了）」。**那句話從月檢視加上色條那一天起就不成立了**，
要跟著改掉。

## 決定（使用者 2026-09-01 選的）

**畫出來、整列暗掉、右邊掛一顆「已取消」徽章，但不算進頂端那行「N 筆來訪」。**

理由：計數那一行回答的是「那天有幾件事要做」，而取消的那一筆已經沒事要做了。
把它算進去會讓她以為那天排滿了。但**看得見**是必要的 ——
她要知道「那天本來有人、後來取消了」，那正是她會想再排一個人進去的訊號。

## 要做什麼

### `domain/calendar.js`

`agendaFor()` 多一個選項，**預設維持現在的行為**（`schedule.js` 那幾個呼叫端
問的是「這一天還排得下嗎」，取消的不該進去）：

```js
/**
 * @param {{roomsById, staffById, includeCancelled?: boolean}} [ctx]
 *   includeCancelled：把取消的也攤平出來（日曆的三個檢視要看得見它們，
 *   ADR-0061）。**預設 false** —— 壓表那邊問的是「還排得下嗎」，
 *   而取消的時段已經還回去了。
 */
export function agendaFor(visits, date, { roomsById = {}, staffById = {}, includeCancelled = false } = {})
```

裡面兩件事：

1. 濾的條件改成 `!isActive(visit) && !includeCancelled` 才 `continue`，
   而且**軟刪除的一律照樣濾掉**（`visit.deletedAt` 不是狀態，是不存在）。
   所以判斷要拆開寫，不能只放寬 `isActive()`。
2. **取消的不參加撞期判斷。** `markClashes()` 迴圈裡跳過 `status === 'cancelled'`
   的列 —— 那個時段已經還回去了，標成撞期是假警報。

`summaryByDate()` **不動**：週檢視格子上那個「N 筆」跟頂端那行計數是同一句話。

### `views/calendar.js`

- `dayHtml()` 與 `weekHtml()` 呼叫 `agendaFor()` 時帶 `includeCancelled: true`。
- `visitRow()` 那一列多掛一個 class：狀態是 `cancelled` 時加 `timerow--off`。
  徽章本來就會印 `describeStatus()` → 「已取消」，不必另外寫死字串
  （`STATUS_VIEW` 是唯一的一份，`CLAUDE.md` 的連動表寫著）。
- `dayHtml()` 的空狀態判斷要用**沒被取消的那幾筆**去問，不然一天只剩取消的來訪時
  會同時印出空狀態那句話與那幾列。
- `countLine()` 不動 —— 它現在算的是 `data.visits.filter(inRange).length`，
  **而那一行現在把取消的也算進去了**（它沒有濾 `isActive`）。這是同一個 bug 的
  另一半：要補上濾掉取消與軟刪除。

### `app.css`

一組 `.timerow--off`，跟 `.kind-todo--done` 同一種手法（既有的畫法優先，
不開新的顏色）：

```css
/* 取消的來訪。**畫出來但暗掉** —— 她要知道那天本來有人（ADR-0061）。
   跟 .kind-todo--done 用同一組手法：降透明度 + 刪除線，不吃新的色相。 */
.timerow--off { opacity: 0.55; }
.timerow--off .timerow__title { text-decoration: line-through; }
```

深色模式不必另外寫（`opacity` 與 `text-decoration` 不是顏色，
所以 `tokens.css` 兩份都不用動）。

## 連動

- **`domain/visits.js` 的 `STATUS_VIEW` 檔頭那句「日曆上根本不畫」要改掉。**
  它現在是錯的。
- **`SPEC.md` 第 8.6 節**要補一句：取消的畫出來但暗掉、不算進計數。
- **補一支 ADR-0061**（`docs/adr/0061-a-cancelled-visit-is-drawn-but-dimmed.md`）——
  這是推翻一個既有的（寫在程式碼註解裡的）決定，`CLAUDE.md` 要求補 ADR 不要改舊的。
- `views/progress.js` 與 `views/schedule.js` 也呼叫 `agendaFor()`／`isActive()`，
  **它們一律不帶 `includeCancelled`**：進度追蹤問的是「這個月做了多少」，
  壓表問的是「還排得下嗎」，兩個都不該看到取消的。

## 不做

- 不讓抽屜裡的取消來訪可以「復原」。`TRANSITIONS` 裡 `cancelled: []` 是終點
  （SPEC 第 7 節規則 10：改期是取消後重新排一筆），要復原是更正流程的事。
- 不在月檢視動任何東西 —— 那裡本來就畫得出來，而且畫得對。

## 驗證

- 新測試（`tests/calendar.test.js`）：
  - `agendaFor()` 預設不收取消的；帶 `includeCancelled: true` 才收
  - `includeCancelled: true` 時**軟刪除的照樣不收**
  - 取消的那一列不出現在任何人的 `clashes` 裡，也不讓別人多一筆 clash
- 瀏覽器：某一天有一筆已確認、一筆已取消 → 月檢視兩條色條（一綠一灰）→
  點那一天 → 抽屜裡兩列，取消的那一列灰掉、有刪除線、徽章寫「已取消」→
  頂端那行寫「1 筆來訪」
- 瀏覽器：一天只有一筆取消的 → 抽屜列得出那一筆，**不會**同時印「這天還沒有東西」
- `npm test` 全綠
