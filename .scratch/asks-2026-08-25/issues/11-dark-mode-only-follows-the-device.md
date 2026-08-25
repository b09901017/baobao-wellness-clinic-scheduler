# 深色模式只跟系統走，切不動

Status: done
來源：她的十二件事，2026-08-25（`../spec.md`）
動工前先讀：`docs/adr/0039`、`public/css/tokens.css` 的檔頭

## 她問的

> 想問要怎麼把系統切成深色模式

## 現況（先回答她的問題）

**深色模式早就寫好了，而且寫得很完整** —— `tokens.css` 底下那一段
`@media (prefers-color-scheme: dark)` 把七十幾個變數各自寫了一份深色的值，
連日曆那七種東西的顏色與對比度都重算過（ADR-0039、0040、0045）。

問題是**它只跟著裝置的系統設定走**，app 裡沒有任何開關：

- Android：設定 → 顯示 → 深色主題
- iPad：設定 → 螢幕顯示與亮度 → 深色

她的兩台裝置各自設定，而且她要的多半是「現在這個場合切一下」——
晚上在家看 iPad 想要深的，白天在院裡同一台想要淺的。

## 要做成什麼

設定頁多一段「外觀」，三選一：

```
外觀
  [ 跟著系統 ]✓  [ 淺色 ]  [ 深色 ]
  跟著系統：Android 在 設定→顯示，iPad 在 設定→螢幕顯示與亮度
```

- 選了就當場換，不用重新整理。
- 記在 `localStorage`（`scheduler.theme`），**不進 Firestore**：
  它是「這一台裝置現在想要什麼」，不是資料。兩台裝置本來就該各自設定。
- 「跟著系統」是預設值，也就是今天的行為。

## 怎麼實作

`tokens.css` 現在把深色寫在 `@media` 裡，那個寫法只聽得懂系統。改成三段：

```css
:root { /* 淺色，照舊 */ }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) { /* 深色 */ }
}
:root[data-theme="dark"] { /* 深色，同一份 */ }
```

深色那一份值只寫一次（CSS 自訂屬性沒有 mixin，所以用一支
`@media` + 一支屬性選擇器各自列出來 —— 這是這個專案沒有 build step 的代價，
`tokens.css` 的檔頭已經為了 ADR-0039 付過同一筆帳）。

`<html data-theme>` 由 `ui/shell.js` 在開機時就設好（**在畫第一個畫面之前**
—— 晚一步就會閃一下白的），設定頁那一排丸子改它。
`<meta name="theme-color">` 跟著換，不然 Android 的網址列會留在另一個顏色。

決定寫成 ADR-0055。

## 驗證

- `npm test`（`tests/shell-cache.test.js` 會因為 `sw.js` 的 VERSION 提醒；
  新增一支：`tokens.css` 裡深色那兩段定義的變數名稱要一模一樣 ——
  漏一個的症狀是「切到深色之後某一塊還是淺的」）
- 瀏覽器：設定 → 外觀 → 深色 → 整個 app 立刻變深 → 重新整理仍然是深的 →
  切回「跟著系統」→ 跟裝置一致
