# 壓表的小日曆用了一個已經被刪掉的名字

Status: done
來源：使用者，2026-08-25（spec.md）
動工前先讀：`SPEC.md` 第 8.2 節、`docs/adr/0035`、`0046`

## 症狀

- 壓表 → 卡片牆 → 點一位客戶 → **卡片組是空白的**
- 待辦 → 壓表登記 → 點一位客戶 → **讀取失敗：WD is not defined**

## 原因

`ui/views/schedule.js` 的 `miniCal()` 用 `WD` 畫星期那一排，而 `WD` 在
4eeba3f（把「不能的時間」抽進 `ui/components/ban.js`）那一輪跟著
`describeShort()` 一起被刪掉了 —— 那一支才是它另一個使用者。

兩種症狀是同一個例外落在不同地方，見 `spec.md` 的表。

## 要做什麼

星期那一排改用現成的那一份。`domain/dates.js` 的檔頭已經寫了
「**這一份是唯一的一份**」，而 `domain/calendar.js` 的 `WEEKDAY_HEADERS`
就是照它算出來的七格表頭，日曆的月檢視用的也是它。

不要在 `schedule.js` 裡再寫一次 `['日','一',…]` —— 那正是這個 bug 的來源。

## 驗證

- `npm test`
- 瀏覽器：壓表 → 卡片牆 → 點一位，記錄面板整份畫得出來，小日曆有星期表頭
- 瀏覽器：待辦 → 壓表登記 → 點一位，直接停在那一位身上，沒有「讀取失敗」

## Comments

**2026-08-25 —— done。** 改用 `WEEKDAY_HEADERS`（`domain/calendar.js`），
`schedule.js` 多一行 import，`sw.js` 的 SHELL 不用動（那一支早就在清單裡）。

順手加了 `esc()`：那一排現在是別人算出來的資料，不是這一支寫死的字面值。
