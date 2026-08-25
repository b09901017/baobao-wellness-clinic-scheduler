# 深色模式她自己切得動，不是只跟著裝置

她問的是「想問要怎麼把系統切成深色模式」。

答案是：**深色早就寫好了**（`css/tokens.css` 底下那七十幾個變數，連日曆那七種
東西的對比度都重算過，ADR-0039、0040、0045），但 app 裡沒有任何開關 ——
它只跟得上裝置的系統設定（Android 在 設定 → 顯示，iPad 在 設定 → 螢幕顯示與亮度）。

那不夠。她的兩台裝置各自設定，而且她要的多半是「**現在這個場合**切一下」：
晚上在家看 iPad 想要深的，白天在院裡同一台想要淺的。

## 決定

設定頁多一段「外觀」：**跟著系統／淺色／深色**，選了當場生效。

記在 `localStorage`（`scheduler.theme`），**不進 Firestore** —— 它是
「這一台裝置現在想要什麼」，不是資料。兩台裝置本來就該各自設定，而且切換
要當場生效，走 Firestore 等於為了一個開關付一次往返。

## 為什麼 CSS 只留一份深色

原本那一段是 `@media (prefers-color-scheme: dark) { :root { … } }`。
要加上「她自己選」通常會變成兩份：

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { …深色… } }
:root[data-theme='dark']                                             { …深色… }
```

**那七十幾個值寫兩遍，遲早會有一遍忘了跟** —— 而 ADR-0039 已經為了六個顏色
付過一次同樣的帳，那次的代價寫在 `tokens.css` 的檔頭裡。這個專案沒有 build step，
所以沒有 mixin 可以救。

改成：**`data-theme` 永遠有值**（`light` 或 `dark`），由兩個 HTML 的 `<head>`
各一段不到十行的行內腳本在第一次繪製之前蓋上去。CSS 只留
`:root[data-theme='dark']` 一份。

- **為什麼是行內、不是 module**：module 是 defer 的，來不及 ——
  晚一步就會閃一下白的。
- **為什麼 `form.html` 也要一段**：客戶那一頁沒有設定，但它一樣讀 `tokens.css`。
  少了那一段，客戶晚上點開連結會拿到一整片白（那一頁本來就跟著他的裝置走）。
- **JS 完全不能跑的時候會是淺色**：兩頁都是 JS 畫出來的（`app.js` 與
  `form/page.js`），JS 不能跑就沒有畫面，所以這不是一個真的會發生的狀態。

`tests/tokens.test.js` 盯著三件事：淺色定義的每一個顏色深色都要有一份、
深色不可以多出淺色沒有的、`tokens.css` 裡不可以再出現
`@media (prefers-color-scheme)`。第二段盯著行內腳本沒有跟 `ui/theme.js` 走散
（key、三個選項、網址列的顏色）。

## Consequences

`<meta name="theme-color">` 跟著換 —— 不換的話 Android 的網址列會留在墨綠色，
而整個畫面已經是深的了。

「跟著系統」時如果她在控制中心切了主題，app 通常還開著，所以
`watchSystemTheme()` 在啟動時掛一次 `matchMedia` 的 change。

`localStorage` 在無痕視窗會直接丟例外，所以讀寫都包在 try 裡：讀不到就當
「跟著系統」，存不進去也照樣換（這一次還是對的，只是下次打開會回到預設）。
