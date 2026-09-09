# 左上角那顆「‹ 壓表」是全站唯一的 <button class="backlink">

Status: done
來源：使用者，2026-09-08（需求一 c）

## 她要的

> 壓表點月份進去，左上角的那個返回 壓表 有點太突兀了，請參考其他頁面的那個返回

## 根因

`schedule.js:514` 是全站 29 個 `backlink` 裡**唯一**用 `<button>` 的：

```js
<button class="backlink" type="button" data-leave>
```

而 `app.css:4168` 的 `.backlink` 沒有寫 `background` / `border` / `padding` /
`font-family` —— `<a>` 不需要，`<button>` 需要。所以它頂著瀏覽器預設的
灰底 + 邊框 + 系統字。

## 決定

**改 CSS，不是只改這一個標記。** `.backlink` 補上按鈕的重置
（`padding: 0; background: none; border: 0; font: inherit; cursor: pointer`）。

理由：這一頁**必須**是 `<button>` —— 它退的是 `pushLayer()` 疊的一層，
不是一個網址（`view.batchId` 不在網址裡，`schedule.js` 檔頭寫過為什麼）。
把它改成 `<a href="#/schedule">` 會讓返回鍵與左上角走兩條不同的路，
而 ADR-0048 要的是同一條。

補在 CSS 上之後，之後任何一頁再用 `<button class="backlink">` 都是對的。

## 測試

- 原始碼掃描：`.backlink` 的規則裡有 `background` 與 `border`
- E2E 或視覺：那顆按鈕沒有邊框、字級與其他頁一致
