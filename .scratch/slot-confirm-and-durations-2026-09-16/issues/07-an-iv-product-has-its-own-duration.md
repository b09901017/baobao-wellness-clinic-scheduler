# 營養點滴的時長跟著品項走，不是跟著課程

Status: todo
來源：`../spec.md`（保留第 3 題）。**這一輪最大的一支。**
動工前先讀：`domain/seed.js` 的 `ivProducts`／`course-iv-drip`、
`domain/masterData.js` 的 `ivChoicesFor()`、`domain/visitTime.js` 的 `endOf()`、
`docs/adr/0002`（品項換得掉，不硬擋）、CLAUDE.md 的「任何 `type="number"`」那一列

## 她的答案（原話）

> 這個要改，一般120分，護心抗老180分，所以可能點滴品項設定那邊要多一個時間，
> 目前都是120，除了護心抗老180分，這個你可以先幫我確認是否和之前的資料
> (像是行事曆等等)有矛盾

## 跟行事曆矛盾嗎（她問的）

**不矛盾，而且行事曆支持她。** `.local/references/ics/timetree.ics` 467 筆事件裡
**436 筆剛好 60 分** —— 那是 TimeTree 建立事件的預設值，沒有資訊量。她**刻意設過
結束時間**的點滴事件有 4 筆，**全部 120 分**（雪顏亮彩 ×3、護肝排毒 ×1）。

**護心抗老 180 分查不到** —— `護心`、`抗老` 兩個字在 467 筆裡零命中。既不矛盾也
無從佐證，照她說的填。

⚠️ **這推翻了 2026-09-16 早上那一條**：上一輪 spec.md 記著「營養點滴先當作 60 分鐘，
兩小時的先當作排了兩段」。**「兩小時排兩段」不成立了** —— 一針 120 分就是一段 120 分。
那一條當時就標著「還沒定案，一針兩段會扣兩次」。

## 現在的時長怎麼算

三個呼叫端各寫一份，全部是 `ent.durationMin ?? course.durationMin ?? 60`：

| 在哪 | 那一行 |
|---|---|
| `ui/views/visitEditor.js:205` | `blankSlot()` |
| `ui/views/visitEditor.js:879` | `readSlot()` |
| `ui/views/schedule.js:1444` | 壓表算 `picked.durationMin` |
| `domain/mergeImport.js:479` | 匯入算 `endsAt` |
| `ui/views/backfill.js:118` | 補登（只有 `course.durationMin`）|

## 要做什麼

### 一、推導只寫一支

新增 `domain/visits.js` 的 `slotMinutes({ entitlement, course, ivProduct })`，
**五個呼叫端全部改走它**。順序：

```
品項.durationMin  ??  額度.durationMin  ??  課程.durationMin  ??  60
```

**品項排在額度前面**是刻意的，理由要寫進 ADR-0098：營養點滴沒有
`durationChoices`，所以額度上那一格**從來不是她挑的** —— 是 `entitlementDoc()`
（`legacyImport.js:1382`）與 `buy.js:245` 建額度時抄課程預設值抄進去的。
她那份產檔裡的點滴額度就全被烙上 60 了。放在額度後面的話，改了主檔既有額度
照樣是 60，而她看不出為什麼。

**只有 `course.requiresIvProduct` 的課程才問品項那一句**，其餘一個字都不變。

### 二、主檔多一格

- `domain/seed.js`：`ivProducts` 的 `iv-heart` 加 `durationMin: 180`，其餘**留空**
  （空＝跟著課程走）。`course-iv-drip` 的 `durationMin` 60 → **120**
- `domain/masterData.js` 的 `ivProducts` 驗證：填了就要是大於 0 的整數分鐘，
  **可以留空**
- `ui/views/masterList.js:227` 的 `ivProducts.fields`：加一個 `f.number`
  ⚠️ **`min: 1, step: 1`** —— CLAUDE.md 那一條，`step` 從 `min` 起算，寫 `step: 30`
  的話 180 存不下去而且 domain 的驗證跑都沒跑到。「通常是 30 的倍數」寫進 `hint`
- `firestore.rules` **不用改**（`config/{docId=**}` 沒有逐欄位驗證）

### 三、牽動（每一項都要親手確認）

| 什麼 | 怎麼受影響 |
|---|---|
| `blankSlot()` 算 `endsAt` | 選了護心抗老的那一段自動變 180 分 |
| `readSlot()` 存檔 | **她在編輯器裡換一款品項，`endsAt` 要跟著變**（`endsAt` 從來不是她填的，一律推導）|
| 撞期 `conflictWarnings()` | 120／180 分的段會蓋到更多人。`roomCapacityOf()` 那一層不變 |
| 月曆那一格的高度 | `domain/calendar.js` 讀 `startsAt`／`endsAt`，不用改 |
| 額度的 `durationMin` | 既有的點滴額度烙著 60 —— **品項排在前面就是為了這個** |
| `ivChoicesFor()` | 不用改（它只管哪幾顆、誰在前面）|
| `assignmentWarnings()` | 換一款照舊只多一句提醒，**不硬擋**（ADR-0002）|
| 產檔那側 | `merge.mjs:1046` 的 `endOf()` 也要問品項，否則匯進來的點滴還是 60 |

## 判準

- 護心抗老那一段：09:00 開始 → `endsAt` 是 **12:00**
- 其餘品項：09:00 開始 → **11:00**（跟著課程的 120）
- 在來訪編輯器裡把護肝排毒換成護心抗老 → 存檔後那一段從 120 變 180
- 一筆烙著 `durationMin: 60` 的舊點滴額度，選護心抗老仍然是 180
- 復能／ILIB／EECP 的時長**一分鐘都沒變**（那三個不是 `requiresIvProduct`）
- `tests/number-fields.test.js` 與 `tests-e2e/specs/17-settings-fields.spec.js` 綠
- 這一行會不會讓一段 180 分的點滴被算成 120 分，於是後面那一段疊上去而沒有人警告？
