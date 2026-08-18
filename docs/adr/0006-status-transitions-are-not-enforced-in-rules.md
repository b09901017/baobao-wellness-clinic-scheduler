# 狀態轉移的合法性留在前端，Rules 不擋

SPEC 第 6.7 節要求「狀態轉移合法性」在 Firestore Rules 再擋一次，Rules 也做得到（`resource.data.status` 拿得到舊值，而且不像 `get()` 會算一次讀取），但我們決定**不做**：SPEC 第 6.3 節的復原在定義上就是把 `before` 寫回去，而那必然是一次反向轉移——Rules 擋反向轉移就等於擋掉復原本身。兩者相衝時我們選復原，因為誤觸是每天都在發生的事，而客戶端亂寫狀態不是（只有她一個人用，寫入全部經過 `domain/visits.js`）。

## Consequences

Rules 對來訪只驗證形狀（欄位型別、必填、`status` 在合法清單內、禁止硬刪除），狀態機本身由 `domain/visits.js` 的 `TRANSITIONS` 負責，UI 只畫得出合法的按鈕。代價是繞過前端就能寫出 `done → pending_confirm` 這種轉移；發生時稽核紀錄看得到，資料健檢的「狀態異常」也應該把它列進去（SPEC 第 6.6 節）。

第 6.4 節的「已完成是唯讀鎖定區」同樣是前端責任：`isLocked()` 擋住編輯，要改必須填更正理由，理由會跟著寫進稽核。
