---
paths:
  - "public/js/domain/scheduling.js"
  - "public/js/domain/availability.js"
  - "public/js/domain/availabilityForm.js"
  - "public/js/ui/views/schedule.js"
  - "public/js/ui/views/availability.js"
  - "public/js/ui/views/formInbox.js"
  - "public/js/ui/components/ban.js"
  - "public/js/form/**"
  - "public/form.html"
---

# 壓表、本輪可用性、客戶自己填的時間

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 客戶自己填的時間

- 表單那一頁在 `public/form.html` 與 `public/js/form/`，**不進 `sw.js` 的 SHELL**（排除清單在 `tests/shell-cache.test.js`）。
- 答案 → 規則 → 原文只寫在 `domain/availabilityForm.js`，而且「產生的原文餵回解析器要得到同一組規則」是有測試的不變量。
- 客戶填的不自動生效，一律先進收件匣，見 ADR-0031、0032、0033

## 要拿某位客戶的本輪可用性

- 先問「這是哪一段期間的事」。
- 壓表、時段反查那種**綁月份或綁某一天**的畫面用 `domain/availability.js` 的 `collectionFor()`；待辦中心的「問這輪的時間」、資料健檢那種問「現在」的才用 `currentCollection()`。
- 挑錯的後果是假的「可用 0 天」把人推到排序第一位，見 ADR-0036

## 「不能的時間」的畫法或動線

- **一份就是一個月**（ADR-0053）。
- `components/ban.js` 的抬頭一定要印出月份；「記一次」先問哪個月，已經有的月份不出現在「新增」那一排；既有的那一份不給換月份；改完存檔前要把差異講出來（`describeRuleChanges()`）。
- 既有的重複資料由資料健檢的 `duplicateAvailability` 列出來，**不自動合併**

## 壓表那一頁的任何互動

- 不要接成整頁重畫。
- 事件用委派、選了什麼只改 `aria-pressed`、只換真的變了的那一塊 —— 她一位客戶要點五六下，重畫的代價是閃一下加捲回最上面，見 ADR-0038

## 任何「先看誰」的排序或推薦名單

- 用 `domain/scheduling.js` 的同一組計分，不要另寫一套 —— 同一位客戶在兩個畫面排名不同，她不會知道哪個算數。
- **兩個例外都在待辦中心，而且都是刻意的**：「問這輪的時間」問的是「先**問**誰」、「壓表登記」問的是「還有**誰**」，兩列都不吃計分也不排序（`customersToAsk()` / `customersToBook()`，見 ADR-0028、0041）。
- 它們是提醒，不是佇列 —— 要決定「先壓誰」是壓表那一頁的事。
- **一次性客人每一處明寫排除**（見「一次性客人」那一節（`one-time-guests.md`））
