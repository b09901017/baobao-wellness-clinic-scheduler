# 客戶填時間的那一頁是獨立入口，不是 app 的一條路由

她要的東西是「一位客戶一條連結，填完直接進 app」。做法上有兩個選擇：
掛在既有的 hash 路由底下（`#/f/<token>`），或者一個獨立的 HTML 入口
（`/form.html?t=<token>`）。選了後者。

## 為什麼不掛在 app 裡

**客戶會載到整個 app。** `index.html` 進去就是 `app.js`，而它會拉起 Firebase Auth、
登入閘門、殼、路由、所有 view。客戶要的只是一張日曆和一顆送出鈕，
卻要先下載一個排班系統 —— 而他是在 LINE 裡點開的，訊號通常不好。

**登入閘門要為它開後門。** app 的第一件事是「沒登入就只給登入畫面」。
要讓一條路由跳過那件事，就等於在**唯一一道前端的門**上開一個 if。
那個 if 之後每一次改動線都要重新想一次「這條路會不會被那個 if 漏掉」。

**客戶的瀏覽器不該有能力碰到資料層。** 獨立入口只 import 它自己要的兩支
（`data/publicForm.js` 與 `domain/availabilityForm.js`），程式碼上就到不了
`data/customers.js`。這比「有能力但沒用到」強得多。

## Consequences

**Firebase 要初始化第二次，而且是不一樣的初始化。** `data/firebase.js` 多一支
`initPublicFirebase()`：只有 app 與 Firestore，**不要 Auth、不要離線快取**。
客戶沒有帳號，Auth 只是白白多載一包；離線快取會在別人的手機上留下一份
IndexedDB，而那份東西沒有任何人需要。

**客戶那一筆不進稽核紀錄。** `data/repo.js` 每一次寫入都附一筆 audit，
而 audit 的 rules 要求 `actor == request.auth.uid` —— 未登入寫不進去。
所以客戶送出那一筆是 `data/publicForm.js` 直接用 SDK 寫的，繞過 repo。
**稽核從「她收下」那一刻才開始**，而收下走的是 repo，該留的還是留得下來。
這是這支 ADR 唯一真正的取捨：客戶送出的那一下沒有 before/after 可以回溯，
但那一筆本來就是憑空產生的，before 是空的，回溯的價值接近零。

**`/form.html` 不進 service worker 的 SHELL。** 她的裝置永遠不會離線打開客戶的表單，
預先快取它只是浪費；而客戶那一頁本來就不註冊 service worker。
`tests/shell-cache.test.js` 因此多一份排除清單 —— 排除清單本身要有測試盯著，
不然它會慢慢變成「什麼都可以不列」的後門。

**Firebase Hosting 的 rewrite 不用改。** `firebase.json` 把 `**` 導到 `index.html`，
但實體檔案優先於 rewrite，所以 `/form.html` 照樣拿得到。
