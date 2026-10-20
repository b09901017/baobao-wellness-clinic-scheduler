# 手機橫放時拍照那一層有自己的排版

Status: todo
段：一（high）
動工前先讀：`public/css/app.css` 的 `.cam` 那一段（`.cam__stage`、`.cam__frame`、`.cam__frame--wide`、iPad 橫放那一條 `@media (min-width: 900px) and (orientation: landscape)`）；
`camera.js` 的 `LANDSCAPE`（只有 `aboveeList` 是寬框）與 `startStream()`（`getUserMedia` 要 3840×2160）；`manifest.webmanifest`（`orientation: any`、`display: fullscreen`）；
ADR-0147（全螢幕：抬頭要自己讓開前鏡頭 `safe-area-inset-top`；橫放時鏡頭在左或右 —— `safe-area-inset-left`／`right`）；E2E `37-camera.spec.js`、`66-immersive-top-inset.spec.js`；
`CLAUDE.md`「蓋住整頁的一層、殼最上面那一條」那一列；`lessons.md` 一

## 她要的

> 然後我想問，我可以橫的拍照嗎，那我橫了之後，中間那個綠色的對準框也可以變橫嗎 ? 很麻煩的話就不用了沒關係

（我回答：Abovee 那個框本來就是橫的，直拿時只佔中間一條；橫拿可以撐滿、字大一倍以上。不麻煩，放進拍照這一包。手機要開自動旋轉。）

## 為什麼會這樣

- `manifest` 是 `orientation: any`，手機開自動旋轉時 app 會跟著轉
- 拍照那一層只有直式排版與 iPad 橫放（寬度 ≥ 900px）兩種。手機橫放（例如 780×360、915×412）落在直式排版：抬頭、取景、提示、縮圖列、控制鈕直的疊下去 → 取景區被壓扁；
  紙的框寬度 `min(78%, (100dvh - 320px) × 0.707)` 在 360 高時只剩 28px；寬框 `88%` 寬、16:10 會比取景區高 → 被 `overflow: hidden` 切掉
- 915 寬的手機剛好吃到 iPad 那一條（`min-width: 900px`）—— 同一支手機不同型號排版不一樣
- **iPad 橫放那一條自己也有洞**（過目查到）：`app.css:9418` 的 `.cam__frame { width }` 跟 `.cam__frame--wide`（`:9137`）特異度一樣、寫在後面 → iPad 橫放時 Abovee 的寬框被蓋成紙的寬度算式，只剩約 450px。
  這一支順手修掉（同一個形狀：寬框被紙的算式蓋掉）—— 新寫的手機那一條要避開同一個坑

## 做法（方向）

1. 手機橫放（例如 `@media (orientation: landscape) and (max-height: 540px)`）；**iPad 那一條要加 `min-height`**（例如 `min-height: 600px`），915 寬的手機才不會吃到它：
   取景區佔左邊整個高度，快門與兩顆小按鈕、縮圖列、提示收到右邊一欄（跟 iPad 同一種配置，數字照手機的高度算）
2. 框：寬框（Abovee）撐滿取景區（照取景區的高度與寬度取小的那一個、保持 16:10）；紙（訂購單、文宣、療程單）照舊直的 A4，照高度算
3. 前鏡頭：橫放時鏡頭在左或右，右邊那一欄與取景區要讓開 `safe-area-inset-left／right`（全螢幕，ADR-0147）—— 量法照 E2E `66`（CDP 的 `setSafeAreaInsetsOverride`）
4. 不動 JS 的取景邏輯；拍出來的方向在她手機上驗（無頭 Chromium 沒有相機）

## 判準

- E2E（新的 spec 或 `37` 多幾條）：viewport 設成手機橫放（例如 844×390、915×412 各一次），打開 Abovee 那一種：
  框的四個角都在取景區裡（量 `getBoundingClientRect()`，不是掃 CSS 字串）、框寬 ≥ 取景區寬的 80% 或高 ≥ 取景區高的 80%；快門在右邊那一欄、看得到、按得到（`elementFromPoint()`）
- 直式手機（390×844）與 iPad 直放的版面**一個像素都不變**：改之前先量框與快門位置存成期望值，改之後比
- iPad 橫放（1180×820）：快門與控制那一欄的位置不變；紙的框不變；**Abovee 的寬框變寬**（修掉被蓋成 450px 的那個洞）—— 量框寬 ≥ 取景區寬的 80%
- 打開訂購單那一種、手機橫放：紙的框整個看得到
- 這一條會不會讓 915 寬的手機吃到 iPad 那一條、或讓 iPad 吃到手機那一條？
- **她的手機上**（驗收清單）：開自動旋轉 → 壓表 → 拍 Abovee → 手機橫拿 → 框撐滿、按快門 → 縮圖是正的 → 送出 → 確認層讀得出來

## 連動

- `docs/操作手冊.md` 拍 Abovee 那一段：補一句「橫著拍字比較大（手機要開自動旋轉）」—— 只講怎麼操作
- `sw.js` 的 `VERSION`（同一段 01 升過就不用再升）
