# 匯入分不出「已經來過」和「還沒來」，未來的預約被當成已完成

Status: 待動工
回報者：使用者，2026-08-21
動工前先讀：`SPEC.md` 第 4.1、4.2 節、`CONTEXT.md` 的「來訪」與四種狀態、
`domain/mergeImport.js` 的 `visitDoc()`、`docs/adr/0011-imported-visits-are-incomplete-on-purpose.md`、
`docs/adr/0004-counts-are-derived-in-detail-cached-in-lists.md`

## 症狀

她的原話：

> 匯入客人 好像不能分辨要未來和現在，全部都當作已完成？但是未來的，目前只是先預約，
> 是已確認，不是已完成

拿她 2026-08-21 貼的那份合併檔實際數過：**67 筆來訪，`status` 全部是 `"done"`，
其中 11 筆的日期在今天之後**（最遠到 2026-09-30）。

## 為什麼

兩層一起造成的，兩層都要處理。

### 第一層：合併檔那側從來沒跟今天比對過

`.claude/skills/calendar-sheet-merge/scripts/merge.mjs` 把試算表上「有打勾」當成
「做過了」，直接吐 `status: 'done'`。但**她在舊表上也會先把未來的預約寫進去**，
那一格的勾在她的用法裡是「排了」，不是「來了」。

`futureVisits` 那份清單只收「行事曆上有、試算表沒有」的未來事件（這份檔案裡只有 1 筆），
**從試算表來的未來預約完全不走那條路。**

### 第二層：app 原封不動照收

`domain/mergeImport.js` 的 `visitDoc()`：

```js
status: status === 'confirmed' ? 'confirmed' : 'done',
```

只認 `confirmed` 一個字，其他一律 `done`。這是一個**無聲的改寫** ——
檔案裡寫什麼、寫錯什麼，畫面上都看不出來。

## 代價不只是顏色不對

`done` 才扣次數（`SPEC.md` 第 4.2 節）。所以那 11 筆現在：

- 算進**已完成**，而不是**已排未上**
- **剩餘次數少算**
- 試算表上印 `✓` 而不是 `△`（`domain/visits.js` 的 `markFor()`）
- 日曆上是「已完成」的顏色
- 健檢那幾筆會立刻長出「約二返」的待辦（`domain/followups.js`），但人根本還沒來

而這幾件事全部對得起來 —— 它們讀的是同一份 `visits`（`.scratch/visit-lifecycle/spec.md` 第 3 節）。
**所以錯的不是四個畫面，是那一個欄位。**

## 想要的樣子

匯入時依日期判斷：**日期在今天之後的來訪建成 `confirmed`，今天含以前的維持 `done`。**

### 為什麼判斷要在 app 這一側，不是在 skill 那一側

**因為「未來」的界線在匯入的那一刻，不是產檔的那一刻。**
那份檔案是 2026-08-19 產的，她 8/21 才貼；下個月再貼一次，同一批資料的
「未來」會完全不同。把 `today` 寫死進檔案，等於把一個會過期的判斷冷凍起來。

`domain/mergeImport.js` 的 `planForCustomer()` 已經是純函式，
多收一個 `today` 參數就好（`domain/dates.js` 的 `todayISO()` 在 UI 那層取）。

**同一條規則也要套在 `addExtraVisits()` 補進來的那幾筆**，
否則她從 `missingFromSheet` 勾一筆未來的，又變回 `done`。

### 檔案裡的 `status` 還要不要看

要，但**只在它說 `confirmed` 的時候**。也就是：

- 檔案說 `confirmed` → `confirmed`（不管日期）
- 檔案說別的 → 日期在今天之後就 `confirmed`，否則 `done`

理由：`futureVisits` 那條路已經會標 `confirmed`，那是有依據的判斷，不要覆蓋它。

### 摘要卡要講出來

`summarize()` 要多一個數字：「其中 N 筆在今天之後，會建成**已確認**（算進已排未上，次數還不會扣）」。
`runCard()` 底下那句「來訪一律標成已完成（未來的預約是已確認）」現在是**錯的文案** ——
它描述的是設計意圖，不是實際行為。改完之後那句話才會變成真的。

## 不要順手做的事

- **不要順手改 `merge.mjs` 讓它自己判斷未來。** 那會讓同一件事有兩份實作，
  而且是會過期的那一份。skill 那側該做的是**照實回報**（見 `issues/06`）。
- **不要因為日期在未來就跳過不匯。** 那是她已經約好的事，日曆上必須看得到。
