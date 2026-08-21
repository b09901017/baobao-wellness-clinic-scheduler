# 貼舊試算表那條路還是假設「勾起來就是做過了」

Status: 待動工
回報者：使用者，2026-08-21（`issues/03`～`06` 合併前的檢查）
動工前先讀：`domain/legacyImport.js` 的 `planForSheet()`（寫死 `status: 'done'` 那一段）、
`domain/mergeImport.js` 的 `statusFor()`、`docs/adr/0029-imported-visits-take-their-status-from-the-date.md`、
`ui/views/legacyImport.js` 的 `runCard()` 與 `run()`、`SPEC.md` 第 6.10 節

## 症狀

`issues/03` 修好的是**合併檔**那條路（`#/settings/merge`）。
**貼舊試算表那條路（`#/settings/import`）沒有動**，`domain/legacyImport.js` 還是：

```js
visits.push({
  customerName: parsed.customerName,
  date,
  // 勾起來就是做過了。舊表沒有「排了但還沒上」這種狀態。
  status: 'done',
```

所以同一張舊試算表，**從哪一條路進來會得到不一樣的結果**：
合併檔那條路上未來的預約是「已確認」，貼工作表那條路上是「已完成」。

## 為什麼這是同一個洞

那句註解裡的假設 —— 「勾起來就是做過了」—— 正是 ADR-0029 推翻掉的那一個。
推翻它的理由對兩條路一樣成立，因為**兩條路吃的是同一張舊試算表**：

> 她在舊表上也會先把未來的預約寫進去，那一格的勾在她的用法裡是「排了」，不是「來了」。

代價也一樣：`done` 才扣次數（`SPEC.md` 第 4.2 節），所以未來那幾筆會算進已完成、
剩餘次數少算、試算表上印 `✓` 而不是 `△`。

**寫入端不用動。** `data/legacyImport.js` 的 `importPlan()` 是共用的，
`issues/04` 之後它逐筆問 `acceptsNewTasks()`，所以那一條在兩條路上都已經生效 ——
只是這條路目前產不出任何 `confirmed`，所以它永遠問到 false。

## 想要的樣子

`domain/legacyImport.js` 也吃 `statusFor()`：日期在今天之後的建成 `confirmed`，
今天含以前的維持 `done`。同一支函式，不要在那邊再寫一次判斷。

`statusFor()` 現在是 `domain/mergeImport.js` 的模組內函式，要共用就得先搬 ——
搬去哪裡是這一支要先決定的事。`domain/visits.js` 是狀態的家（`STATUS_VIEW`、
`canTransition()`、`isLocked()` 都在那裡），但那一支不知道「匯入」這回事。
另一個選項是新開一支 `domain/importStatus.js`。**先決定再動手，
不要用「兩邊各一份、長得一樣」收掉這一支** —— 那正是這支票要修的東西。

### 一起要改的（範圍比它看起來大，這是它單獨一支的原因）

| 在哪裡 | 改什麼 |
|---|---|
| `domain/legacyImport.js` | `status` 改成算出來的；`slot.attended` 跟著（`confirmed` → `false`） |
| 同上 | `summarize()` 要多一個 `future`，跟 `domain/mergeImport.js` 那支對得起來 |
| `ui/views/legacyImport.js` `runCard()` | 「來訪一律標成已完成」變成錯的文案 |
| 同上 `run()` 的確認框 | 「來訪一律是已完成」與**「不會產生任何待辦任務 —— 那些掛號在舊系統早就做完了」**兩句都會變成謊話 —— 那條路一旦產得出 `confirmed`，共用的 `importPlan()` 當場就會長出登記待辦 |
| `tests/legacy-import.test.js` | 那一條「這一頁的文案靠 `planForSheet()` 只吐 done 撐著」的護欄會紅，那是它的用途 |
| `SPEC.md` 第 6.10 節 | 那一條的「貼舊試算表那條路還沒吃這條規則」拿掉 |
| `CLAUDE.md` 連動表 | 「匯入的來訪要建成什麼狀態」那一列的但書拿掉 |

## 有多急

**不急。** 她 2026-08-21 之後用的是合併檔那條路（時間補得進來，那才是她要的），
貼工作表那條路現在是備用。所以這一支是「兩條路要講同一件事」的收尾，
不是擋著她用的東西。

**但文件不可以先講。** `SPEC.md` 第 6.10 節與 `CLAUDE.md` 的連動表現在都明寫著
「貼舊試算表那條路還沒吃這條規則」並指回這一支 —— 做完要記得把那兩處的但書拿掉，
否則就換成文件在騙人。

## 不要順手做的事

- **不要把 `statusFor()` 複製一份到 `domain/legacyImport.js`。** 兩份長得一樣的判斷
  就是下一次「同一位客戶在兩個畫面不一樣」的來源。
- **不要只改 `status` 不改文案。** 那一頁會變成在講一件不會發生的事，
  而 `CLAUDE.md` 那張連動表對這件事寫得很清楚：比沒講還糟。
- **不要回頭改已經匯進去的資料。** 分不出哪幾筆是匯錯的、哪幾筆是她後來自己
  改成已完成的（同一個判斷見 `issues/03` 的 Comments）。
