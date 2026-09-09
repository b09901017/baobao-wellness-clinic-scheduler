# 不要每個測試都重走一次登入彈窗

Status: todo（**這是一次實驗，可能做不出來**）
來源：2026-09-09，量到每個測試有約 3.5 秒的固定成本，登入佔掉一大半
動工前先讀：`tests-e2e/fixtures/app.js` 的 `signIn()`、`emulator.js` 的 `ensureUser()`

## 現在每個測試都做一次

```
page.goto()                       開頁
waitForSelector('[data-signin]')  等登入鈕
開彈窗 → 點 li.js-reuse-account   走一次 Google 那條路
waitForSelector('.app__nav')      等殼掛上來
waitForSelector('#view')
settled()                         ~360ms
```

估 1.5～2.5 秒 × 193 ＝ **5～8 分鐘**，佔全套 21.5 分鐘的四分之一到三分之一。
**這是四支裡帳面上最值錢的一支。**

## 為什麼可能做不出來

**Playwright 的 `storageState` 抓不到它。** `storageState` 存的是 cookie ＋
localStorage，而 Firebase JS SDK 的登入狀態**存在 IndexedDB**。所以標準那條
「登入一次、存起來、之後每個測試載入」的路走不通。

## 可以試的三條路，照「不碰 app 程式」排序

1. **把 IndexedDB 的內容抄過去。** 第一次登入完之後用 `page.evaluate()` 把
   Firebase 那幾個 object store 讀出來，之後每個測試用 `addInitScript()` 在
   app 開機前寫回去。**最乾淨（一行 app 程式都不用改），但最可能卡在細節上**
   —— SDK 的 key 格式沒有保證，換一版 firebase 就可能壞。
   壞掉的話至少要壞得大聲：`signIn()` 已經有 `sameNamespace()` 那道檢查，
   登入沒生效的話會停在登入頁，而 `waitForSelector('.app__nav')` 會逾時 ——
   那是看得懂的錯，不是靜默。
2. **問 Auth 模擬器要一個 token，直接餵給 SDK。** 模擬器有 REST 介面
   （`ensureUser()` 已經在用了）。要嘛在 app 開機前塞進 IndexedDB（同 1 的問題），
   要嘛呼叫 `signInWithCustomToken` —— 但那要 app 那側露出一個掛鉤。
3. **讓 app 在模擬器模式下改用 localStorage persistence。** 這樣 `storageState`
   就抓得到了。**但這會改到 app 的正式行為**（persistence 是 SDK 的全域設定），
   而 `envOf()` 那一支的判斷是照網址挑環境的。

## 放棄的條件（**寫在前面，不要做到一半才想**）

- **需要動到 `public/js/` 裡任何一行會影響正式環境的程式 → 停。**
  為了測試快五分鐘而讓正式站的登入行為變了，那個交易不划算。
- 三條路都試過還是不穩（時好時壞）→ 停，把量到的東西寫進這支 issue 然後關掉。
  **一個會偶爾登入失敗的 fixture，比慢五分鐘糟得多** —— 那會變成每次紅了
  都要先問「是真的壞了還是登入又抽風」。

## 怎麼知道做對了

- 全量跑一次，時間應該掉 5 分鐘以上（沒掉就是沒省到，回頭量是哪裡）
- **連跑三次全量都全綠。** 這一支的風險是 flaky，而 flaky 跑一次看不出來。
- `00-smoke` 的 S3（白名單以外的人只看得到「還沒有權限」）**一定要照樣紅得起來**
  —— 那一支測的正是「沒有權限的登入」，如果登入被跳過了，它會假綠。
  **這是這支 issue 最容易踩的坑**：把登入變快的作法很容易連「沒登入」那個狀態
  也一起跳過。
