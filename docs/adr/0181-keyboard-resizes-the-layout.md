# ADR-0181：鍵盤跳出來時版面跟著縮（`interactive-widget=resizes-content`），打字時收起底部導覽列

日期：2026-11-06
狀態：已接受
延伸：[ADR-0147](./0147-the-installed-app-runs-fullscreen.md)（裝到主畫面的那一顆是全螢幕的）、
[ADR-0021](./0021-the-sheet-is-dragged-by-transform.md)（抽屜靠 `transform` 拖）

## 背景

她 11/6（`.scratch/notes-widget/spec.md`「五」）：

> 我不論是在首頁還是再隨手記那一頁，點了鉛筆，他就會這樣，跳出鍵盤遮住輸入的地方 並且如果我將抽屜往上拉，整個頁面都會往上拉 輸入的地方也不見???

全站沒有一行在處理鍵盤。HTC U23 Pro 實機（Chrome 156，裝到主畫面的那一顆，`display-mode: fullscreen`）量到：
鍵盤跳出來時 `innerHeight` 停在 800、只有 `visualViewport.height` 縮成 452 —— **版面不縮，鍵盤蓋在上面**。
貼在底部的抽屜（`.drawer-backdrop` 是 `position: fixed; inset: 0`）整張在鍵盤底下；往上拉是在捲 visual viewport，整頁跟著跑。
分頁裡的 Chrome 預設也是只縮 visual viewport（`resizes-visual`），所以 E2E 從來看不出來。

## 決定

1. **`index.html` 的 viewport 加 `interactive-widget=resizes-content`**：鍵盤跳出來時版面（layout viewport）跟著縮。
   同一台實機量：`innerHeight` 800 → 404，抽屜、卡片、整頁表單全部落在鍵盤上面，拖抽屜不再帶著整頁跑。不寫一行 JS 讓開。
2. **打字時收起底部導覽列與右下角那一顆**（`ui/keyboard.js` 寫 `html[data-keyboard]`、`app.css` 在手機寬度收起 `.app__nav` 與 `.fab`）：
   版面縮成一半時導覽列會站到鍵盤上面、吃掉一截（新增客戶那一頁剩不到 170px 看得到表單），而打字時她用不到它；
   右下角那一顆（`position: fixed`）同一個理由，首頁那張卡打字時它蓋在框與底下那兩排上面（段三審查 R1）。
   判斷是「焦點在一格會叫出鍵盤的欄位裡，而且版面比這個寬度量過最高的矮了 120px 以上」。
3. **不用 VirtualKeyboard API**（`navigator.virtualKeyboard.overlaysContent` ＋ `env(keyboard-inset-height)`）：
   它是全站的開關，一開每一頁的表單都要自己讓開（聚焦時自己捲）；`resizes-content` 是瀏覽器替每一頁讓開，而且實機上就夠了。

## 後果

- iPad／iPhone 的 Safari 不認 `interactive-widget`、也不縮版面 → 照舊由 Safari 自己推，`html[data-keyboard]` 永遠不成立。**不會讓開兩次**。桌機沒有螢幕鍵盤，一樣不動
- 鍵盤開著時 `dvh`、`100%`、`inset: 0` 全部是剩下的那一截（`--sheet-peek-max` 的 84dvh 也是），抽屜最多佔多高自然重算，不用另外寫
- `public/form.html`（客人自己填時間的那一頁，在瀏覽器分頁裡開、不裝到主畫面）**沒改**：分頁裡瀏覽器本來就會把聚焦的那一格捲進來
- 「全螢幕裡真的會縮」只有實機驗得到：E2E `100-keyboard-layout` 用 `setViewportSize()` 縮版面量導覽列與抽屜，鍵盤本身列進手動驗收清單
