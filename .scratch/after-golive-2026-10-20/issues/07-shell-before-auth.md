# 這一台上次通過了，就先畫殼，登入在背景確認

Status: done
段：三（high）
動工前先讀：`public/js/app.js`（`watchAuth()` 的四種結果：沒登入、`unreachable`、`denied`、`allowed`；`shellMounted`；`booted()` 與 `index.html` 的保險絲）；
`public/js/data/auth.js`（`watchAuth()`、`accessState()` 的三種答案與它檔頭那段「連不上不是沒有權限」）；`public/js/ui/shell.js` 的 `renderGate()`／`renderShell()`；
`public/js/data/repo.js:25`（**寫入時讀 `currentUser?.uid ?? 'unknown'` 寫進稽核**）；`sheetSync.wire()`；`grep -rn "currentUser\|getAuthInstance" public/js`；
Firestore 的離線快取是跟著登入的人走的（登入還沒確認之前，連快取都讀不到 —— 讀取會排隊等 Auth）；E2E 登入那幾支（`grep -rln "signedOut\|notAllowed\|unreachable" tests-e2e/specs`）；`lessons.md` 五

## 她要的

> 有辦法讓app先呈現畫面嗎，一般大神，資深工程師他們這都怎麼解決?，讓使用者使用起來更直覺順暢 ?

## 為什麼會這樣

`app.js` 等 `watchAuth()` 回來才決定畫什麼：Auth 初始化（手機上先載 iframe、再換 token、查帳號）＋`accessState()`（白名單 `getDoc`，server 優先）全部回來之前，
畫面是 `index.html` 寫死的「載入中…」。這兩段都是網路來回，跟畫面要畫什麼無關 —— 她 99% 的打開都是「同一台、同一個帳號、還在白名單裡」。

## 做法（方向）

1. `accessState()` 回 `allowed` 時，這一台記一筆「這個 uid 上次通過了」（`localStorage`，讀寫包 `try`）。登出、`denied`、沒登入時清掉
2. 開機：記著 → **不等 Auth，直接 `renderShell()`**、`booted()`；各頁照常 `render()`（它們的讀取會排隊等 Auth，畫面上是那一頁自己的「載入中」，殼與底下那一排已經在）
3. Auth 回來之後：
   - 同一個 uid、`allowed` → 什麼都不做（殼已經在）
   - 沒登入、`denied` → 清掉那一筆、換成登入頁／沒有權限那一頁（`shellMounted = false` 那條路）
   - 不同的 uid → 同上（不可以拿上一個人的殼繼續）
   - `unreachable`（新裝置第一次離線才會遇到）→ 段裡決定：記著的情況下留著殼（離線照樣用得了）還是照舊換成「等一下再試」—— 寫進 ADR
4. **寫入要等登入確認**：`repo.js:25` 是唯一讀 `currentUser` 的地方（過目查過），先 `await` Auth 準備好（Firebase v11 的 `auth.authStateReady()`）。
   會記成 `unknown` 的只有**整批都是 create** 的寫入（例如右下角泡泡新增一則隨手記）—— 有 update 的會先 `await getDoc`（`repo.js:170`），而 Firestore 本來就排隊等 Auth
5. **要跟著搬的接線**（過目查到）：
   - `sheetSync.wire()` 要等確認通過才接（不是殼畫出來就接）
   - `router.js:76` 每次 `start()` 都多掛一個 `hashchange` 監聽 —— 殼先畫、被登出換成登入頁、再登入又畫一次殼時會掛兩個；確認 `start()` 只跑一次或會先拆
   - **E2E 的 fixture 拿 `.app__nav` 當「登入成功」**（`tests-e2e/fixtures/app.js:252`／`:273`）—— 殼先畫之後它在登入確認之前就出現，要換一個訊號（例如確認通過之後在根節點掛一個屬性），不然所有 E2E 都在登入還沒好時就開始點
6. 不改 Rules、不改白名單：安全性照舊由雲端擋（沒權限的人連快取都讀不到）

## 判準

- E2E：登入過一次 → 重新整理 → **Auth 回來之前**殼（底下那一排）就在了（攔 Auth 的請求讓它慢 2 秒，量殼出現的時間 < 1 秒）
- 被移出白名單（測試裡刪掉 `allowedUsers/{uid}`）→ 重新整理 → 先看到殼、接著換成「沒有權限」那一頁；再重新整理 → 直接是那一頁（記的那一筆清掉了）
- 登出 → 重新整理 → 直接是登入頁，沒有先閃一下殼
- 登入還在確認時（Auth 被攔住）用右下角泡泡新增一則隨手記（整批都是 create 的那種）→ 稽核記的是她的 uid，不是 `unknown`
- E2E 全量照舊綠（fixture 換了訊號之後）
- 這一行會不會讓**上一個人**的殼、或沒權限的人看到任何一筆資料？
- 保險絲：`main()` 丟例外時照舊 12 秒後講「載入失敗」
- **她的手機上**：05 那一張卡「畫面」那一格改之前／改之後

## 連動

- 新的 ADR（跟 06、08 可以寫同一支「打開 app 先用手機裡的」，或各一支 —— 段裡決定）
- `docs/常見問題.md`：「打開先看到畫面、過一下才跳登入頁」那一題（被登出時會這樣）

## 做完時留下的

- 記的那一筆：`data/auth.js` 的 `lastAllowedUid()`／`forgetAllowed()`（`localStorage` 的 `scheduler.allowedUid`），`watchAuth()` 裡白名單說可以就記、說不行或沒登入就清；
  `signOut()` 先清再登出。08 用的 `confirmedAsRemembered()`（`authStateReady()` 之後，登入的就是記著的那一位）也在這裡
- `app.js` 的 `main()`：記著 → `mountShell()`（`renderShell` ＋ 量「畫面」）＋`booted()`；之後 `watchAuth` 的四種結果走 `gate()`（清 `data-access`、`bootTiming.drop()`、`renderGate`）
  或 `confirmed()`（掛 `#root[data-access="allowed"]`、第一次才 `sheetSync.wire()`）。**不同的一位整個殼重畫**（`shellUid !== user.uid`）
- **`unreachable` 段裡決定：記著的就是這一位 → 留著殼**（寫進 ADR-0167）。不是這一位照舊「連不上」那一頁
- 寫入：`repo.js` 的 `actorId()` 改成 `async`、先 `authStateReady()`。**過目寫的是「會記成 unknown」—— 其實更糟**：Rules 只收 `actor == request.auth.uid`，
  記成 `unknown` 的那一批整批被擋（E2E `81` P8 在改之前會紅）
- 殼畫第二次的接線：`router.start()` 先拆上一個 `hashchange`、`shell.js` 的 `watchOffline` 與「有新版本」那一條的通知先拆、
  **`wireBackLinks()` 只接一次**（過目沒提到：`#root` 換殼時不換，接兩次的話按一下「回上一頁」退兩步 —— 被登出又登入時本來就會發生）
- 量開機（05）跟著改：殼比登入早到之後，`bootTiming` 的**總數改成她等到的那一步**（首頁＝資料、別頁＝畫面），走完之後晚到的「登入」「權限」照樣記
  （09 要看它們）；`drop()` 走完了也拿掉（先畫殼的那一次，登入回來才知道是登入頁）。`tests/boot-timing.test.js`、E2E `79` 的 B1、B2 跟著改
- E2E fixture：「登入好了」從 `.app__nav` 換成 `#root[data-access="allowed"]`（`SIGNED_IN`，三處）；`emulator.js` 多 `revokeUser()`
- E2E `81`：P5 登入被攔慢 2.5 秒 → 殼先出來、那時候還沒確認、確認之後照常；P6 移出白名單 → 換成「沒有權限」、再打開一下都沒畫殼；
  P7 登出 → 另開一頁打開直接是登入頁（**fixture 的 `primeAuth()` 是那一頁的 init script，重新整理就又登入了**，所以另開一頁、舊的那一頁先關 ——
  換到 about:blank 的話那個 init script 開 IndexedDB 會丟錯）；P8 登入還在確認時新增一則隨手記 → 稽核記的是她
- 畫面上每一個新增的入口都要先讀資料（讀取排隊等登入），所以「登入還沒回來就按得到寫入」在畫面上幾乎碰不到；P8 是直接叫 `notes.create()`
- **被移出白名單的那一下**：殼先畫、首頁的讀取被 Rules 擋（「讀取失敗」閃一下）、接著換成「沒有權限」。只有那一次，她碰不到（只有她一個帳號）
- 驗收：`npm test` 全綠；E2E `00`、`10`、`15`、`19`、`24`、`79`、`81` 本機 77 支綠（P7 第一次寫法 flaky，改成關掉舊的那一頁之後連三次綠）。fixture 是 GLOBAL → 全量丟 CI（段三最後）

