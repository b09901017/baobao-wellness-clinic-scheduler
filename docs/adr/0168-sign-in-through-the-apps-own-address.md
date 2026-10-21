# ADR-0168：Google 登入走 app 自己的網址

日期：2026-10-21
狀態：已接受

## 背景

她 2026-10-21：iPad 上用 Safari 開，登入正常；**加到主畫面之後就登不進去**，一直跳回登入頁，
畫面上寫 `Firebase: Error (auth/network-request-failed)`。到設定裡關掉「防止跨網站追蹤」也一樣。

主畫面那一顆登入走 `signInWithRedirect()`（`data/auth.js`：iOS 的主畫面 app 關不掉 popup）。
這條路一開始要先載一個 `authDomain` 的 iframe，而 `authDomain` 原本是
`<專案>.firebaseapp.com`，不是 app 所在的 `<專案>.web.app`。也就是說，主畫面那一顆要載的是另一個網域的 iframe。
這個 iframe 在 iOS 的主畫面 app 裡沒有回應，SDK 等到逾時就丟出 `auth/network-request-failed`。
那個開關管的是 Safari 的追蹤防護，管不到主畫面 app 自己那一份。瀏覽器分頁走的是 popup，不需要那個 iframe，所以一直是好的。

## 決定

開在那個專案自己的網址上時，`authDomain` 就用**同一個網址**（`firebase-config.js` 的 `authDomainFor()`）。
Firebase Hosting 在每一個網址底下都會自己提供 `/__/auth/handler`，不用另外架。
這是 Firebase 文件給「瀏覽器擋第三方儲存」那一類問題的第一個建議做法。

- **預覽頻道照舊走 `firebaseapp.com`**：預覽網址每一支 PR 都不一樣，Google 那一側的
  「已授權的重新導向 URI」一個一個登記不完。網址沒登記的話，連瀏覽器分頁都登不進去。
- `sw.js` 本來就不碰 `/__/`（ADR-0167）。現在登入那一頁就在同一個網址底下，這一條就是讓它不被凍在舊版的那一道。

## 後果

- **每一個用得到的網址都要在 Google Cloud 登記一次** `https://<網址>/__/auth/handler`
  （步驟見 `docs/STAGING.md`「1. 開 Google 登入」）。**沒登記就部署，連瀏覽器分頁也登不進去**
  （Google 回 `redirect_uri_mismatch`），所以順序一定是先登記、再部署。哪天加了自訂網域，也要再登記一次。
- 如果這樣主畫面那一顆還是登不進去，下一步是換掉 redirect 這條路，不是再回頭改網域。
