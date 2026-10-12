# 確認抽屜一次存好幾天，次數快取拿舊清單算

Status: done
來源：`../spec.md`
動工前先讀：`docs/adr/0004`（次數的真相是來訪，額度上的數字是快取）、`data/visits.js` 的 `save()`／`countOps()`、
`ui/views/bulkCancel.js:600-607`（同一件事已經做對的那一份）

## 現在壞在哪

一位客戶同一筆額度有兩天都在「待確認」。待辦 → 跟客人確認時間 → 點他 → **比較早的那一天**點成
「客人說不行」→ 確認 1 段 → 額度上存的「已排」多 1，**客戶清單那張卡的剩餘次數少算 1**。

實跑：額度 10 次、兩天各一段，退掉 10/5、確認 10/12 → 存進去 `bookedCount: 2`，真的應該是 1。

## 怎麼重現

- 畫面：種子兩筆 `pending_confirm`（今天+3、今天+10），同一筆 `course-inbody` 額度 →
  `#/todo/confirm` → `[data-open="<客戶>"]` → 點 `[data-slot="<較早那筆>:0"]` → `[data-apply]` →
  讀 `customers/<id>/entitlements/<id>` 的 `bookedCount`
- 單元：照 `save()` 的 `countOps()` 算法，兩筆都拿**同一份舊的** `customerVisits` 算，最後那一次蓋掉的值是錯的

## 為什麼

`ui/views/home.js:3072`：`for (const v of writes) await visitsData.save(v, customerVisits);`
—— `customerVisits` 是按下去之前讀的那一份，迴圈裡一次都沒更新。存第二天的時候，它眼中的第一天
還是「待確認」（還佔著一次），於是把錯的數字寫回額度上。先存的那天被退掉時才會錯，所以不是每次都中。

批次取消那一頁（`bulkCancel.js:605`）已經知道這件事，每存一筆就把手上那一份換新；這裡沒有。

## 做法（方向）

- 照 `bulkCancel.js` 的寫法：每存一筆就把那一筆換進 `customerVisits` 再存下一筆
- 順手看還有沒有別的「一個迴圈存好幾筆來訪」的地方（`grep "visitsData.save"`）
- 04 如果做了「存之前比對版本」的防線，這裡也要過得去（自己剛存的那一筆不能被當成別人改的）

## 判準

- 上面那個情境：`bookedCount` 是 1，客戶清單剩 9
- 資料健檢的「次數對帳」在這個情境之後是乾淨的
- 退掉比較晚那一天、全部確認、全部退掉：數字都對

## 做了什麼（2026-09-23）

確認抽屜（`home.js` 的 `applyConfirm()`）存完一筆就把它換進 `customerVisits` 再存下一筆（同 `bulkCancel.js`）。
另外兩個迴圈（批次取消、拍 Abovee）本來就是對的。測試：E2E `44` 的 S3。
第二輪的 18 再把這個迴圈抽成 `saveEach()`（重試跳過存好的）。
