# 隨手記「挑日期」按一下就選好

Status: todo
Blocked by: —
動工前先讀：`public/js/ui/components/note.js` 的 `field()`、`read()`、`wire()`、`wireOne()` 與檔頭「為什麼是兩顆丸子」；
`app.css` 的 `.notedate`、`.chip`、全域 `input`；`field()` 只有四處：`ui/views/home.js` 約 `:1533`（首頁隨手記那張卡）、`:1609`（小鉛筆 `quickBody()`，`#/todo/notes` 用的也是這個泡泡）、
`ui/views/customerDetail.js` 約 `:1307`、`ui/views/calendar.js` 約 `:1407`（日曆上的待辦編輯器）；CLAUDE.md「隨手記的欄位或那一列的樣子」那一列

## 她要的

「我是用手機手也不論我是點首頁中最下面的那個隨手記中的"挑日期"這個按鈕，還是點了首頁的小鉛筆，在點"挑日期"這個按鈕都會跳出日曆讓我選，但是我選完之後沒有記錄任何日期，我要點下面的那個長框框，跳出日曆我選完後才會紀錄上去」
選法：「按一下就選好」（其餘原話見 `../spec.md`）

## 為什麼會這樣

`wireOne()`：按「挑日期」→ 拿掉 `<input type="date">` 的 `hidden` → 同一下叫 `input.showPicker()`。
她的描述排除了「監聽掛兩次」（框只打開一次）、證實原生點框選得上 → 壞的是 `showPicker()` 那條路
（推測：Android Chrome 在剛從 `display:none` 拿出來的同一下叫 `showPicker()`，選的值沒回填；主控沒有 Android 可以重現）。
全站只有這一處叫 `showPicker()`（grep 過）。

## 做法

「挑日期」那一顆**本身就是日期框**：丸子的外觀，裡面疊一個透明、蓋滿整顆的 `<input type="date">`（`opacity: 0`、`position: absolute; inset: 0`），
點下去是瀏覽器原生的日期選擇，選了 `change` → 照舊 `paint()`。**不叫 `showPicker()`、不再有底下那個長框**。
選好之後照舊顯示「11/7 ✕」那一格；「今天」那一顆照舊。`read()` 讀的還是那一個 input（`[data-nd-input]`），四個呼叫端不用改。

過目 11/5 抓到的地雷（都要處理）：
- **`<button>` 裡不能放 `<input>`** → 那一顆改成 `<label class="chip chip--sm">`（`aria-pressed` 換成適合 label 的寫法，例如 `data-on` 或 `aria-checked` 的等價；樣式照丸子）
- `.chip::after`（`inset: -5px 0` 撐觸控區）會畫在 input 上面、點到的是 label 不是 input → 給 input `z-index` 或那一顆不要 `::after`，**觸控區要撐在 input 本身**
- 要蓋掉的樣式：全域 `input { min-height: 42px; padding; border }`、`.field input[type=date] { width: 100% }`、`.notedate input[type=date] { flex: 1 0 100% }`
- `set()` 裡的 `input.hidden = true` 要拿掉，不然按過「今天」或 ✕ 之後「挑日期」整顆失效
- 桌機 Chromium 點日期框的字不會開選擇器：把 `::-webkit-calendar-picker-indicator` 撐滿整顆（桌機才看得到效果，手機照原生）
- `app.css` 的 `.notedate` 不在 `tests-e2e/related.js` 的 `CSS_SCOPES` 裡：考慮加一組（`owners` 照四個入口），不然 verify 會把看 CSS 的整份 E2E 都跑

## 判準

- 按「挑日期」、選一天 → 不用再點任何東西，那一天就記上了嗎？（四處都要）
- 按過「今天」、或按過 ✕ 之後，「挑日期」還按得動嗎？
- 選了今天 → 「今天」那顆亮、「挑日期」不亮（跟現在一樣）
- `✕` 清掉之後再按「挑日期」還選得到？
- 程式裡還有沒有 `showPicker(`？（不可以有；可以加一條掃原始碼的斷言）
- 現在沒有任何測試用到 `data-nd-*`／`showPicker` → 新寫一支 E2E spec、登記 `related.js`。Playwright 把 `opacity: 0` 算可見、`fill()` 會觸發 `change`；
  量的是「值有沒有記上、標籤有沒有出現」，外加量「點那一顆的中心點，`elementFromPoint()` 是不是那個 input」（點得到才算數）；
  **手機上的實際行為只能請她在 staging 用手機點**，寫進手動驗收清單

## 做完時留下的
