# 日曆長按、簽療程單、確認抽屜、壓表：拿剛讀回來的那一份去套

Status: done
來源：`../spec.md`（第二輪）、04 的第一層（當時沒做）
動工前先讀：`issues/04`、`data/repo.js` 的 `StaleWriteError`／`commit()` 的 `ifUpdatedAt`、`domain/visits.js` 的 `visitActions()`／`applyStatus()`／
`applyConfirmation()`／`closeVisit()`、E2E `44-stale-copies`
相關：18（同一段迴圈，這一支先做）

## 她要的

04 的判準：「iPad 那一下**不會**把 11:00 那一段蓋掉（要嘛套在最新那一份上，要嘛擋下來講清楚）」。
04 的做法第一層：「上面那三處改用**剛讀回來的那一份**去套狀態；讀回來的那一份裡找不到那一段就停下來講一句，不要猜」。

04 只做了第二層（`ifUpdatedAt`），所以現在是「擋下來」：她看到「儲存失敗：剛剛在別的地方被改過，重新整理再改一次」，
而畫面沒有重讀，要自己離開再回來。

## 現在壞在哪

四個地方手上都**已經讀了**新的那一份，卻拿畫面上那一份去套：

- `ui/views/calendar.js:1193` `runVisitAction()`：讀了 `customerVisits`，套的是 `data.visits` 裡那一份 `visit`
- `ui/views/home.js:3429` `applyClose()`（簽療程單）：讀了 `customerVisits`，套的是 `ctx.rows` 那一份
- `ui/views/home.js:3081` `applyConfirm()`（確認抽屜）：讀了 `customerVisits`，`writes` 從 `ctx.pending` 組
- `ui/views/schedule.js:2137` `addSlot()`（壓表）：`visitWithSlot()` 用的是打開那一頁的 `ctx.queueInput.visitsBy`，下一行（`:2139`）才重讀

## 做法（方向）

- 四處都改成從剛讀回來的那一份找同一筆（`customerVisits.find((v) => v.id === …)`）再套
- **套之前重問一次准不准**：日曆那一顆走 `visitActions(fresh, { today, slotIndex })` 看那個 action 還在不在；
  確認抽屜看抽屜上那幾段在新的那一份裡還是不是待確認；簽療程單看那一筆還能不能結案。
  不准 → 不寫，講一句（「這一段剛剛在別的地方改過了」）並重讀那一頁（日曆走 `refreshAfterAction()`）
- 那一筆在新的那一份裡不見了（被刪了）→ 同上
- 段落位置穩得住（ADR-0091：只接尾巴、不刪段），所以 `slotIndex` 在新的那一份上指的是同一段；別台加的段接在後面，不會被動到
- `ifUpdatedAt` 那一層留著（兩次讀之間的空檔還是可能撞）；撞到時日曆也重讀

## 判準

- E2E 44 的情境（日曆開著那一天 → 另一台把同一筆改成 2 段 → 長按第 0 段 → 客戶說可以）：**存得進去，而且還是 2 段**
- 另一台把那一段取消了 → 長按「客戶說可以」→ 不寫，講一句，抽屜換成新的樣子
- 確認抽屜：另一台在同一天加了一段 → 確認抽屜上那幾段 → 新加的那一段照舊待確認，沒被蓋掉
- 壓表：另一台在同一天加了一段 → 這台再壓一段 → 三段都在

## 做了什麼（2026-09-23）

四處都改成從剛讀回來的 `customerVisits` 找同一筆再套，套之前再問一次准不准：

- 日曆長按（`calendar.js` 的 `runVisitAction()`）：`visitActions(fresh, { slotIndex })` 裡還有那一顆才套；
  沒有 → 「這一段剛剛在別的地方改過了」＋ `refreshAfterAction()`。兩次讀之間被搶先（`StaleWriteError`）也重讀
- 確認抽屜（`home.js` 的 `applyConfirm()`）：抽屜上那幾段在新的那一份裡都還是待確認才套；
  `applyConfirmation()` 多收第 4 個參數 `asked`（抽屜上問過的那幾段）—— 別台接在尾巴的那一段照舊待確認
- 簽療程單（`applyClose()`）：新的那一份還能結案、段數沒變才套（`closeVisit()` 會把沒問到的段當成有做）
- 壓表（`schedule.js` 的 `addSlot()`）：`visitWithSlot()` 併進剛讀回來的那一份

測試：`tests/visits.test.js`（`asked`）、E2E `44` 的 S1（改成存得進去、還是 2 段）、S1b、S3b、S3c。
