# 字體改用網路字體，離線退回系統內建

`tokens.css` 原本刻意不用 Google Fonts，理由是「這是離線可用的 PWA，多一個外部請求就多一個訊號差時打不開的理由」。使用者要求整體介面要好看，並補了一句實情：**大部分時間都不會離線**。原本那個理由把「離線時會很醜」與「離線時打不開」當成同一件事，而它們可以分開處理。

我們載入 Noto Serif TC（標題與人名）、Noto Sans TC（內文）與 Inter（拉丁字母與數字），但**用 `media="print"` + `onload` 換成 `all` 的方式載入**：那條 `<link>` 從頭到尾不會擋住第一次繪製。訊號差或完全離線時畫面照樣立刻出來，只是先用 `--font-sans` / `--font-serif` 堆疊裡的系統字（PingFang TC、Noto Sans CJK TC、Songti TC）。**字體永遠不會是「app 打不開」的理由**，這正是原本那條規則真正想保護的東西。

Inter 排在 `--font-sans` 最前面只吃得到拉丁字母與數字（它沒有中文字），中文自然落到 Noto Sans TC —— 混排的字體堆疊本來就是這樣運作的，不需要為數字另外包一層 span。

## Consequences

`public/sw.js` 把 `fonts.googleapis.com` 與 `fonts.gstatic.com` 加進快取優先那一條：第一次上線抓到之後，離線也還是同一套字。這兩個網域回來的樣式表是 opaque 回應（`status` 永遠是 0），所以 `fetchAndCache()` 的條件從 `response.ok` 放寬成「ok 或 opaque」——只用 `response.ok` 判斷會把字體全部漏掉。

代價是站上多了兩個外部網域的請求。它們不帶任何客戶資料，也拿不到 Firestore；最壞的情況是那兩個網域掛掉，而那時畫面只是回到以前的長相。

字級同時整體縮了一級（`--font-base` 從 16px 降到 15px），但 **input 仍然 16px 起跳** —— iOS 上小於 16px 的 input 會觸發自動放大。SPEC 第 8.0 節的「字級 16px 起跳」因此改寫成「input 16px 起跳，關鍵資料不縮小」：縮小的是包裝（外框、標籤、按鈕、說明文字），姓名、剩餘次數、日期時間這些她真正在掃的東西維持大字。
