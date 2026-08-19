# 介面第三輪：日曆不要一直跳頁，抽屜要能用拖的

Status: done

第二輪（`.scratch/ui-density/`）上線之後的回饋。一句話：
**日曆上不管點什麼都會把「我在看八月」洗掉，而抽屜只能用按的。**

## 使用者提出的六件事與處理方式

| # | 原話重點 | 做了什麼 |
|---|---|---|
| 1 | 體內金屬希望有一個標籤讓我選，它就是客戶的一個屬性 | 新增與編輯表單的「永久限制」拆成兩塊：會擋掉器材的那幾個字變成可點的丸子（選項由器材主檔上的醫療禁忌推出來），其餘維持自由輸入。`domain/customers.js` 的 `splitFlagsForEdit()` / `mergeFlags()`、`domain/contraindications.js` 的 `contraindicationTerms()`、`ui/components/flags.js` |
| 2 | 不要點到人名就跳走；點日期那個框框就看得到那天 | 月檢視每一天變成一整欄的按鈕（`.monthweek__hits` 那一層），色條改成 `pointer-events: none` 的 span |
| 3 | 抽屜裡的東西才可以點，點了不要跳頁，中間顯示資訊卡片 | 新增 `ui/components/card.js`，疊在抽屜上面（z-index 21，低於二次確認的 22） |
| 4 | 所有抽屜都要能拖 —— 抓著橫條往下滑關掉 | `ui/components/sheet.js` 的 `wireDrag()`：往下拖關掉、往上拖到頂、從頂往下拖回原本高度 |
| 5 | 日曆左右滑換上／下個月週日，要絲滑 | 三格 `scroll-snap`（`.swipe`），一次讀三格的範圍，滑完先用手上的資料畫再補讀 |
| 6 | 新增與編輯都不要換頁；先閱讀模式，點鉛筆才能改 | `visitEditor` / `eventEditor` 多一組 `mountNew` / `mountEdit`，吃 `embedded` 與 `onDone` / `onCancel`。表單本身是原本那一份 |

理由都寫在 [`docs/adr/0020-the-calendar-never-changes-pages.md`](../../docs/adr/0020-the-calendar-never-changes-pages.md)。

## 一處與原話不同的地方

**日檢視維持議程清單，沒有做成一格一小時的時間格。** 使用者附的截圖是 Google 日曆
的日檢視（可以點空格直接建立），但那會改掉 SPEC 第 8.6 節對日檢視的定義，
而她真正在抱怨的是「一直換頁」。動線改掉之後（點一天 → 面板 → 直接新增，
時間在編輯器裡用點的選），原本的痛點已經沒了。確認過要維持議程清單。

## 驗證方式

`npm test`（504 支）之外，這一輪同樣用假的 Firebase SDK 把真的畫面跑起來截圖看
（Playwright + 攔截 `firebasejs` 與 `firebase-config.js`），十六個步驟走完六件事。
抓到三個只有在瀏覽器裡才看得到的問題：

- 抽屜換內容時 `note` 沒跟著換，編輯器上面寫著「1 件事。點一筆看細節」
- 那一天的件數漏算有時間的個人行程（只加了整天的）
- 編輯器掛進抽屜之後，抬頭與編輯器自己的第一列都寫著客戶姓名

那份腳本沒有進版控 —— 它依賴一份假資料，不是測試。
