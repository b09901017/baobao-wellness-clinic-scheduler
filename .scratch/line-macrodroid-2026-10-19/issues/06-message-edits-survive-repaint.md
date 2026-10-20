# 訊息框裡改過的字，整頁重畫之後還在（確認時間、問這輪的時間）

Status: done（10/19，段一）
Blocked by: 04
動工前先讀：`ui/components/message.js`（`box()`、`wire()`）；`ui/views/home.js` 的 `paintConfirm()`／`renderConfirm()`／`wireConfirm()`（開抽屜、關抽屜、每按一下 ✓✗ 都整頁重畫；存「問過了」那一句與按確認之後 `renderConfirm()` 重讀）、
`renderAsk()`（**先畫「載入中…」再重讀**）／`paintAsk()`（換分段、換月份、產生連結、重發）；CLAUDE.md「壓表那一頁的任何互動」（ADR-0038：不接成整頁重畫 —— 這兩頁本來就是整頁重畫，這一支不改那件事）

## 她要的

段一的中途發現 1（確認時間那一頁開一次抽屜，訊息框裡改過的字就不見了），她 10/19：

> 2. 我覺得可以修

## 為什麼會這樣

訊息框是 `<textarea>`，內容是產生的草稿（`confirmMessage()`／`askAvailabilityMessage()`），她可以改。兩頁的每一次互動都是 `el.innerHTML = …` 整頁換掉，
textarea 跟著換成新的、內容回到產生的那一份，`<details>` 也收回去。04 之後「打開 LINE」送的是那一格**當下**的字 —— 先開過抽屜再按，送出去的是沒改過的那一段。

## 要做的

- `message.js` 兩支：重畫之前 `keepEdits(el)` 記下每一則**改過的**（`value !== defaultValue`）或**展開著的**（`<details open>`）；畫完 `restoreEdits(el, kept)` 帶回去
- **那一則本來的樣子變了就不帶回來**（新畫的 `defaultValue` ≠ 記下的那一份）：她確認了其中一段、訊息少了一段，她改的是舊的那一段 —— 帶回來就是把一段已經談定的時間又問一次
- `paintConfirm()`：畫之前記、畫完帶回；`renderConfirm()` 不先清畫面，所以 `paintConfirm()` 自己記就夠
- `renderAsk()` 先畫「載入中…」：**在那之前記**，交給 `paintAsk()`；`paintAsk()` 被直接叫（換分段）時自己記

## 判準

- 確認時間：展開訊息 → 改字 → 開抽屜 → 關掉 → 那一格還是改過的字、還展開著；按「打開 LINE」送出去的是改過的
- 確認時間：兩段裡確認了一段（訊息跟著變）→ 那一格是**新產生的**那一段，不是她改過的舊的
- 問這輪的時間：A 產生連結、改 A 的訊息 → 再幫 B 產生連結（整頁重讀）→ A 的那一格還是改過的
- 沒改過、沒展開的照舊（不多記、不多畫）

## 做完時留下的

- 跟 issue 原本猜的不一樣：**不是「重畫前拍一張、畫完放回去」**，是 `message.editStore()` 一頁一份、跨好幾次重畫留著。
  問這輪的時間切到另一個分段時，那一張不在畫面上 —— 只看當下畫面的話，下一次重畫就丟了（E2E R3 第一版抓到的）
- `keep(el)`：畫面上改過或展開著的記下、沒改又收著的拿掉、不在畫面上的照舊留；`restore(el)`：那一則本來的樣子（`defaultValue`）變了就丟掉不帶
- home.js：`msgEdits` 模組層一份，`renderGroup()`（從待辦中心點進來）換新的；`paintConfirm()`、`paintAsk()` 畫之前 `keep`、畫完 `restore`；`renderAsk()` 在「載入中…」之前 `keep`
- E2E `75` R1（開抽屜關掉之後還在、打開 LINE 送改過的）、R2（確認了一段、訊息變了 → 新產生的）、R3（A 改過 → 切分段 → 幫 B 產生連結 → A 還在、還展開著）
- 產生連結之後那一則**本來就會自己展開**（`paintAsk()` 的 `focus`）—— 測試裡再點 summary 會把它收起來
