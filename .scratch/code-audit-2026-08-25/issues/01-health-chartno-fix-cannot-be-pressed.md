# 資料健檢的「病歷號」一鍵修正整個按不動

Status: done
來源：全庫掃描，2026-08-25（`../spec.md`）
動工前先讀：`SPEC.md` 第 6.6 節、`docs/adr/0050`

## 症狀

資料健檢 → 「備註寫著舊的說法」那一段：

- 每一列的修正鈕印的是**「改成重算值」** —— 那是「次數對帳」的文案
- 按下去 **`TypeError: Cannot read properties of undefined (reading 'done')`**，
  什麼都沒發生，畫面上一個字都不說
- 「一次修正這 N 筆」同樣炸

也就是說 ADR-0050 那個一鍵改名，從上線到現在**在畫面上一次都按不動**。

## 原因

`ui/views/health.js`：

```js
const KIND_TO_CHECK = { recount: 'counts', addFollowup: 'followups' };
const copyFor = (fix) => FIX_COPY[KIND_TO_CHECK[fix?.kind]] ?? FIX_COPY.counts;
```

`renameChartNo` 兩張表都沒有，於是 `copyFor()` **安靜地退回 `FIX_COPY.counts`**。
按鈕文案因此是別項的；而 `counts.one(fix)` 要讀 `fix.from.done`，
`renameChartNo` 那一筆根本沒有 `from`。

`domain/health.js` 與 `data/health.js` 兩側都是好的 —— 檢查算得出來、
`opFor()` 也寫得進去，斷點只在畫面那一張對照表。跟 2026-08-24 那個
「她挑的行事備註顏色從來沒被存下去」是同一種：**三邊有兩邊是對的，
而錯的那一邊沒有測試看得到。**

## 為什麼測試沒抓到

- `tests/health.test.js` 只測 domain，測得出 `fix` 給不給得出來，
  但它不知道畫面拿 `fix.kind` 去查了兩張表
- `tests/module-names.test.js` 只問「這個**名字**有沒有宣告過」，
  `KIND_TO_CHECK['renameChartNo']` 是一次**屬性存取**，名字全都在
- 瀏覽器逐顆點按鈕也漏掉：**那顆按鈕要有資料才會出現**（要有一位客戶身上
  掛著「姓名欄的編號：」那種備註），乾淨的種子資料上它不存在

## 做了什麼

1. `KIND_TO_CHECK` 補 `renameChartNo: 'chartNo'`，`FIX_COPY` 補 `chartNo`
   那一組文案（按鈕「改成「病歷號」」、確認框講「號碼一個字都不會動」）
2. `copyFor()` **不再退回別人的文案**：查不到就丟例外，讓它落進 `render()`
   的 catch 寫成「讀取失敗」。一顆長得正常、按下去沒反應的按鈕比一句
   「讀取失敗」更難查
3. `tests/health.test.js` 加一段「畫面認得每一種修正」：跑一份會長出全部三種
   `fix` 的快照，再**讀 `ui/views/health.js` 的原始碼**確認每一種 kind 在
   `KIND_TO_CHECK` 與 `FIX_COPY` 都查得到（同 `module-names.test.js` 的路數，
   不執行 UI 程式碼）

## 驗證

- `npm test`（把 `renameChartNo: 'chartNo'` 那一行拿掉會紅，訊息是
  「KIND_TO_CHECK 少了 renameChartNo —— 按鈕會印成別項的文案，按下去會爆」）
- 瀏覽器：先讓某位客戶身上有一則「姓名欄的編號：1234」的備註 →
  設定 → 資料健檢 → 「備註寫著舊的說法」→ 按鈕寫「改成「病歷號」」，
  按下去跳確認框，按確定之後那則備註變成「病歷號 1234」，
  客戶身上的 `marks` 與 `notes` 兩個欄位一起改（ADR-0050）
