# 待辦「約二返」那一列的「約了沒」：讀不完整就不畫

Status: done
段：二（中途發現第 4 條，她 10/19 晚：「修」）
動工前先讀：`ui/views/home.js` 的 `loadFollowupBookings()`、`loadWhoDetails()`；`domain/followups.js` 的 `bookingStateForTask()`；`data/visits.js` 的 `listWhole()`；ADR-0158

## 她要的

> 4. 【她：修】待辦「約二返」那一列的「約了沒」（`home.js` 的 `loadFollowupBookings()` 與依客戶抽屜那一段）：讀到快取時二返不在手上 → 那一列講「還沒約」，她照著去多約一場。建議：讀到快取就不畫那一顆

## 判準

- 這一行會不會讓快取裡少了那一場二返時，那一列講「還沒約」？

## 做完時留下的（10/19 段二）

- 兩個入口的 `visitsData.listByCustomer()` 換成 `listWhole()`（讀不完整丟 `IncompleteReadError` → 那一顆不畫；註解本來就寫著「算不出來的不寫進去」）
- `loadFollowupBookings()` 改成**一位一位接住**：以前整包 `Promise.all` 在同一個 try 裡，一位讀不完整就整排都不畫
- 只畫、不寫：沒有確認框、沒有 toast
- 測試：`tests/own-whole-reads.test.js` 第四條（換回來是紅的）；E2E 02、11、19、76 照跑全綠
