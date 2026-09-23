# 拿畫面上的舊來訪去改，會蓋掉別台剛存的

Status: done
來源：`../spec.md`
動工前先讀：`data/visits.js` 的 `save()`（整筆 `update` 寫回去）、`data/repo.js` 的 `commit()`
相關：03、10

## 現在壞在哪

她手機和 iPad 都開著 app：

1. iPad 開著日曆某一天（沒重新整理）
2. 手機在壓表替同一位客戶**同一天**加一段 11:00
3. iPad 長按原本那一段 → 客戶說可以
4. **手機加的那一段不見了**（實跑：資料庫從 2 段變回 1 段，額度的已排也跟著少算）

不需要兩台裝置也會中：只要日曆那一天的抽屜開著、同一筆來訪在別的地方被改過（例如 10 的「復原」）。

## 怎麼重現

種子一筆 1 段待確認 → 日曆打開那一天 → 用 `tests-e2e/fixtures/emulator.js` 的 `seedDocs()`
直接把同一份文件寫成 2 段（模擬另一台）→ 長按第 0 段 → 客戶說可以 → 讀回來只剩 1 段。

## 為什麼

`ui/views/calendar.js:1165` 其實**有**重新讀一次最新的 `customerVisits`，但 `:1173` 拿去 `applyStatus()`
的是畫面上那一份舊的 `visit`（`data.visits` 裡的），而 `save()` 是整筆 `update` 寫回去 ——
舊那一份裡沒有的段就被蓋掉了。

同一種寫法還有：

- `ui/views/home.js:3379` 簽療程單：`closeVisit(visit)` 的 `visit` 來自 `ctx.rows`（打開那一頁時讀的）
- `ui/views/home.js:3044` 確認抽屜：`applyConfirmation(v)` 的 `v` 來自 `ctx.pending`
- 來訪編輯器：`draft` 是打開編輯器那一刻讀的，存檔前沒有再看一次

## 做法（方向）

兩層，第一層最便宜：

1. 上面那三處改用**剛讀回來的那一份**（`customerVisits.find((v) => v.id === visit.id)`）去套狀態；
   讀回來的那一份裡找不到那一段（`slotIndex` 對不上）就停下來講一句，不要猜
2. **一道共用的防線**放在 `data/visits.js` 的 `save()`：存之前讀一次那份文件，`updatedAt` 跟呼叫端手上那一份
   不一樣就不寫，丟一句她看得懂的話（「這一天剛剛在別的地方被改過，重新整理再改一次」）。
   `payloadOf()` 已經把 `updatedAt` 拿掉了，比對要在拿掉之前做；新增（沒有 id）不用比

第二層會連 03 那個迴圈一起擋 —— 迴圈裡自己剛存的那一筆要換新，不然第二筆會被自己擋下來。

## 判準

- 上面那個情境：iPad 那一下**不會**把 11:00 那一段蓋掉（要嘛套在最新那一份上，要嘛擋下來講清楚）
- 一般單機的每一條存檔路（長按、簽療程單、確認抽屜、編輯器、壓表、批次取消、拍 Abovee）照常存得進去
- 擋下來的時候 toast 講人話，不是一串 Firestore 錯誤

## 做了什麼（2026-09-23）

只做了第二層：`data/visits.js` 的 `save()` 帶著手上那一份的 `updatedAt`（`ifUpdatedAt`），`repo.commit()` 拿本來就讀了的
`before` 比，對不上就丟 `StaleWriteError`（toast 講人話、不給重試鈕）。CLAUDE.md 補「存一筆來訪時手上那一份是舊的」那一列。
測試：E2E `44` 的 S1、S2。第一層（拿剛讀回來的那一份去套）在第二輪的 19 做完。
