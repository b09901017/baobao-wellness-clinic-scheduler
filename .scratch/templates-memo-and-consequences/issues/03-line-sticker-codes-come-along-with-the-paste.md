# 從 LINE 貼過來，滿滿的 (emoji) 與 (加1)

Status: done
來源：她的第二項 b（`../spec.md`）
動工前先讀：issue 02（同一個 `paste` handler）、ADR-0069

## 她貼進來的東西長這樣

```
(emoji)今天反思：客訴×顧客會點滴（客戶A）
(emoji)前情提醒
(加1)飯後打針 （通知客人）
(2)預約系統註記（*第一針或*血管難打）
(emoji)當天
(加1)前一天詢問阿長房間負責人
(2)提早10分，來檢查房間（乾淨度），開好冷氣
*休2 萬用卡
(3)檢查療程單在幾樓
(4)結束後，拆止血帶＆詢問車牌號碼＆收回房間鑰匙
(emoji)結束
四樓要清理
```

她在 LINE 裡看到的是熊臉貼圖與彩色數字。複製出來只剩代碼。

## 清洗成什麼（她 2026-09-04 選的）

| 貼進來的 | 換成 | 為什麼 |
|---|---|---|
| `(emoji)` | `🐻` | 她選的。`(emoji)` 不帶任何資訊，系統猜不出原本是哪一顆，所以一律給同一顆；不喜歡就用 issue 04 那一排點掉 |
| `(加1)` … `(加10)` | `1️⃣` … `🔟` | LINE 的「加 N」貼圖，她拿它當每一段的第一項 |
| `(1)` … `(10)` | `1️⃣` … `🔟` | 同一組符號，段落裡才對得齊 |
| `(11)` 以上 | **不動** | 沒有對應的方塊字元。硬拼一個出來會在某些字型上變成豆腐格 |

換完在後面補一個半形空格 —— 但**只在下一個字不是空白的時候**（`1️⃣飯後打針`
→ `1️⃣ 飯後打針`；`1️⃣ 飯後` 不會變成兩個空格）。

### 三件刻意不做的事

1. **只在貼上的時候清，打字不清。** 她自己打 `(2)` 一定是有意的。
2. **只認半形括號。** 她的內文裡到處是全形的 `（乾淨度）`、`（通知客人）`——
   認全形等於把她自己的字改掉，那比留著代碼糟得多。
3. **不重排段落。** 只做兩件版面的事：每行去掉行尾空白、三個以上連續空行
   收成一個空行。縮排一個字都不動（`normalize()` 的註解已經寫過原因：
   她可能刻意用縮排分層）。

## 一支新的純函式

`public/js/domain/lineText.js`

```js
export const EMOJI_PLACEHOLDER = '🐻';
export function sanitizeLinePaste(text)   // 上面那張表 + 兩件版面的事
export function describeCleanup(before, after)  // 「換掉 6 個貼圖代碼」，給 toast 用
```

**不放進 `domain/playbook.js`。** 那一支的職責是「一份備忘錄的規則」
（`validatePlaybook`、`previewOf`、`deckOrder`），而這一支是「一段從 LINE
複製出來的字」——之後隨手記或客戶備註要用得上時，不必把備忘錄整支拖進去。

`sanitizeLinePaste()` 必須是**冪等**的：清過的字再清一次結果一模一樣
（`🐻` 不會被再認成什麼、`1️⃣` 也不會）。這一條有測試。

## 接在哪裡

`ui/views/playbook.js` 的 `mountEditor()`，跟 issue 02 的 `grow()` 同一個 handler：

```js
body.addEventListener('paste', (e) => {
  const raw = e.clipboardData?.getData('text') ?? '';
  const clean = sanitizeLinePaste(raw);
  // 沒有東西要清就讓瀏覽器自己貼（保留原生的復原堆疊）
  if (clean === raw) return;
  e.preventDefault();
  insertAtCursor(body, clean);   // issue 04 那一支，共用
  grow();
  const said = describeCleanup(raw, clean);
  if (said) toast.info(said);
});
```

**清洗完要說一句話。** 靜靜地改掉她貼進來的字是這個 app 最不該做的事
（SPEC 第 6.9 節）；一句「換掉 6 個貼圖代碼」讓她知道畫面上少的那些不是
她貼漏了。沒有東西被換就不說 —— 每次貼上都跳一句她會學會忽略它。

超過 `MAX_BODY`（5000）的部分要**另外講一句**，見 issue 02 那一段。

## `insertAtCursor()` 放哪

`ui/components/form.js`。它是純 DOM 操作、issue 01（模板頁的變數丸子）與
issue 04（emoji 列）都要用，而 `form.js` 已經是這個專案放「表單零件」的地方。

要處理三件事：選取範圍取代、游標留在插入的字後面、`input` 事件手動發出去
（不發的話 `grow()` 與 `maxlength` 的行為會跟打字不一致）。

## 連動

| 會動到 | 為什麼 |
|---|---|
| `public/js/domain/lineText.js` | 新的 |
| `ui/components/form.js` | 多一支 `insertAtCursor()` |
| `ui/views/playbook.js` | 接 `paste` |
| `tests/line-text.test.js` | 新的 |
| `tests/module-names.test.js`、`tests/layering.test.js` | 自動涵蓋，不用改 |
| `CONTEXT.md` | 「貼圖代碼」要不要進詞彙表 —— 動工時判斷，只有一支檔案用到的話就不進 |

## 驗收

- 單元：她那整段原文（把真名換成「客戶A」）進去，出來的每一行都對
- 單元：冪等 —— 清兩次等於清一次
- 單元：全形 `（乾淨度）` 一個字都不動
- 單元：`(11)` 不動、`(0)` 不動
- 單元：`*休2 萬用卡` 那一行完全不動（`休2` 不在括號裡）
- E2E：在備忘錄裡貼那一段 → 畫面上看到 `🐻` 與 `1️⃣`，看不到 `(emoji)`
