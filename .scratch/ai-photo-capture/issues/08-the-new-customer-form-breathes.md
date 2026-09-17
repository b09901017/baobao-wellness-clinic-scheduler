# 新增客戶畫面重畫

Status: todo
**跟 09 一起出貨**（她 2026-09-17：「4＋5 一起」）
來源：`../spec.md`
動工前先讀：`ui/views/customers.js`（`paintNew()` 約 452 行起、`previewHtml()`、`warningsHtml()` 約 701 行）、
`ui/components/flags.js`、`ui/components/form.js`、`ui/components/tip.js`、
`tests/tip-red-lines.test.js:45`、`tests/fewer-words.test.js:39`、
`.scratch/quieter-screens/issues/08`（上一輪泡泡的五條紅線）、`docs/adr/0086`（存檔前兩道）、`docs/adr/0038`。
**視覺先用 `/frontend-design` 設計一輪。**

## 她要的（原話）

> 第二' : 突然發現我覺得新增一個客戶的介面UIUX好醜，希望可以重新設計，而且我發現"field__hint" 竟然沒有變成tooltip?難怪版面好擠，資訊太多太雜，以及最下面的card card--flat提醒，我覺得可以變成三角形警示提醒的icon的tooltip

> 第三 : 關於 新增客戶畫面重畫，以及 field__hint 為什麼沒變成泡泡 不管那就寬那支測試的禁令，照我這次說的，底部的「提醒」卡也tooltip掉連那兩句都不要禁，的確要排在訂購單功能前面

> i 同名提醒照上面那樣做（姓名欄旁的 ⚠，存檔前再講一次），可以

## 為什麼會這樣

**`form.js` 的 `hint` 早就是 `?` 了**（`form.js:30`，2026-09-12）。她看到的是**手寫的** `field__hint`：

- `flags.js:131`「**不會擋任何東西**，它只是讓你壓表的時候一眼看得到…」
- `flags.js:140`「用頓號分隔。這一欄只是提醒，**也不會出現在壓表的卡片牆上**…」
- `flags.js:259`「壓完表記得跟他們的專員說一聲。**不會產生任何待辦**…」
- 標籤後面接的一句：「永久限制　跟著這位客戶一輩子的條件」「備註　客戶臨時提的小事，顏色自己分」「加購　方案之外多買的」

它們沒被轉掉，是因為 `tests/tip-red-lines.test.js:45` **整支檔案**禁止 `flags.js` 與 `customers.js`
import 泡泡。上一輪真正的紅線只有兩句（`flags.js` 的禁忌紅框、`customers.js` 的「數量 0 不會展開任何額度」），
整支都禁掉的範圍比那兩句大很多，同一支檔案裡純說明的那幾段就一起被卡住了。
`tests/fewer-words.test.js:39` 的 `FIELD_HINT_KEEP` 還替 `flags.js` 留著 6 段。

底部的「提醒」卡（`warningsHtml()`）只有兩句，都來自 `domain/customers.js:89` 的 `warnings()`：
「已經有 N 位客戶也叫「某某」」「沒有電話也沒有 LINE」。

**這一支推翻了上一輪紅線 5 的一部分**：她 9/17 明講「連那兩句都不要禁」。
所以補一支 ADR（號碼動工時取），寫她的原話與「同名那一句存檔前還會再講一次」這個接住的方式。

## 要做什麼

### 測試的禁令

- `tests/tip-red-lines.test.js`：`customers.js` 與 `flags.js` 從「整支不准 import」名單拿掉
- `tests/fewer-words.test.js`：`FIELD_HINT_KEEP` 的 `flags.js` 降到實際剩下的數量（應該是 0）；只准往下
- `CLAUDE.md`「畫面上一段常駐的說明」那一列補一句：新增客戶那一頁的提醒也收成 ⚠（指到新 ADR）

### 說明全部收成 `?`

- `flags.js` 那幾段 → 標籤旁的 `tip()`；標籤後面接的那一句 → 標籤本身只留名詞，說明進 `tip()`
- **`flags.js` 的禁忌紅框（`noticeBlock`）不動** —— 它在壓表與來訪編輯器，不在這一頁（spec「暫定」）
- `flags.js` 是客戶詳情編輯表單共用的，那一頁會跟著變乾淨：要一起看過

### 提醒卡收成 ⚠，貼在它講的那一格

- **同名** → 姓名欄旁邊 `tip(…, { kind: 'warn' })`，只在真的同名時出現
- **沒電話也沒 LINE** → 電話欄旁邊
- **數量 0 不會展開任何額度** → 購買數量旁邊
- 打字時只換那一顆 ⚠，不重畫整頁（ADR-0038，`RECOMPUTE_ON` 那一段的理由）
- **存檔前再講一次**：`warnings()` 有東西時走 `reviewWarnings()`／`confirmReview()`（ADR-0086 第一道），
  句子照抄 domain 的，畫面不重寫

### 重新排版

- 分成三塊，一塊一個標題：**是誰**（姓名、電話、LINE）、**買了什麼**（購買通路、購買日、方案、數量、加購、會展開的額度）、
  **要記得的**（警示、其他限制、合作機構、備註、喜好程度）
- 「會展開這些額度」那張 `card--flat` 改成貼在方案底下的一排小字或丸子，不是一張卡
- 「建立客戶」固定在底部
- **表單要做成可以掛在別的地方的元件**：09 的小鉛筆會把它開在一層裡面、事先填好。
  `paintNew(el, draft, …)` 已經收 `draft`，抽成 `mountCustomerForm(host, { draft, onSaved, onCancel })`，
  `#/customers/new` 那一頁與 09 的那一層都呼叫它

## 判準

- 新增客戶那一頁：`.field__hint` 0 個、`card--flat` 0 張（`page.locator` 數得到）
- 打一個已經存在的名字 → 姓名欄旁出現 ⚠；點開是那一句；按建立 → 先跳「這 N 件先看一下」，裡面有同名那一句
- 刪掉那個名字的最後一個字 → ⚠ 消失、**頁面沒有捲回最上面**
- 選方案、數量打 0 → 數量旁出現 ⚠，照樣建得起來（ADR-0074：沒有業務規則會擋存檔）
- 客戶詳情 → 編輯 → 永久限制那一塊也沒有常駐說明，而且存得起來
- 既有的新增客戶 E2E 照樣綠（選擇器改了就一起改，**不要刪斷言**）
- `mountCustomerForm()` 掛在一個空的 `<div>` 裡、帶一份 draft → 欄位都是 draft 的值
- **拿掉那兩句之後，有沒有任何一條路讓她建出一位同名客人、而她完全沒看過那句話？**（應該沒有：存檔前那一道一定會出現）
