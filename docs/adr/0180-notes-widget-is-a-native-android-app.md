# ADR-0180：隨手記的桌面小工具是另一支原生 Android app，隨手記的規則寫兩份、用一份共用情境檔盯著

日期：2026-11-06
狀態：已接受
延伸：[ADR-0179](./0179-linked-notes-one-doc-per-day.md)（連在一起的隨手記 —— Kotlin 照抄 `linkId` 與那張表）、
[ADR-0044](./0044-a-dated-note-goes-on-the-calendar.md)（掛了日期就上日曆 —— 小工具記的照樣上）、
[ADR-0059](./0059-a-supplement-purchase-is-one-record-handed-over-once.md)（營養品的提醒 —— 勾它的規則只在網頁）、
[ADR-0071](./0071-today-shows-what-she-did-not-what-was-written.md)（稽核與「今天做了什麼」—— 小工具寫的稽核要跟網頁一樣，那一頁才讀得懂）

## 背景

她 11/6（`.scratch/notes-widget/spec.md`）：

> 我想開始作新功能，手機桌面小工具，直接在桌面記隨手記

> 就是有沒有辦法不離開桌面、不開 App、輸入框或是鍵盤自己設計

網頁 app（PWA）放不了桌面小工具。Android 的小工具本身也放不了打字框 —— 輸入要另外開一張浮在桌面上的卡（透明背景的 activity）。
所以要另寫一支原生 app；問題是它跟網頁 app 怎麼共用「隨手記長什麼樣、怎麼寫」。

## 決定

1. **另寫一支原生 Android app**（`android/`，Kotlin），手機上叫「隨手記」。兩個版本可以同時裝：
   **「隨手記（測試）」**（`tw.baofu.notes.staging`）接 staging、裝 HTC；**「隨手記」**（`tw.baofu.notes`）接正式站、HTC 點過才裝三星。
   各登記成那個 Firebase 專案裡的一支 Android app（2026-11-06 她同意、用指令登記的）。
2. **直接讀寫同一個 Firestore**（Firebase Android SDK），不經過網頁、不經過 Cloud Function。登入用同一個 Google 帳號（Credential Manager → Firebase Auth）＝同一個 uid，白名單不改；
   登入之後問一次 `allowedUsers/{uid}`，**不在上面就登出、講一句、一筆都不寫**（Rules 照樣擋，這一步是讓她看到一句話）。開 Firestore 的本機快取：沒網路照記、連上補傳。
3. **所以隨手記的規則多一份 Kotlin 的**（`android/core`，純 Kotlin、不認得 Android 也不認得 Firestore SDK）：
   - `domain/notes.js` 那幾支（`validateNote()`、`normalize()`、`normalizePatch()`、`linkedPeers()`、`linkedChanges()`、`copyPlan()`、`groupLinked()`、`noteActions()`、`dateChoices()`…）
   - `data/notes.js` ＋ `repo.js` 的 `commit()`：**存進去的欄位與型別、每一次都帶 `updatedAt`、同一個 commit 裡每一筆一則稽核**（`before` 先讀、`after` 的形狀），寫之前照 `linkId` 重讀同一組
   - 比名字與病歷號（`normalizeAlias()`、`chartNosOf()`、`nameHas()`、`chartNoHas()`）、打名字跳出客戶（`nameSuggestions()`，名字照 zh-Hant 排）
   - JS 自己的行為照抄，不換成 Kotlin 的：`trim()` 與 `\s` 的那一組空白、`doneAt` 一定三位毫秒＋`Z`、排序拿 `String()` 比字串、真假值
   - **不抄的**：營養品的提醒怎麼勾（「給了哪幾款」、交付紀錄）—— 小工具點它就打開網頁的 `#/todo/notes/note/<id>`；給營養品打開 `#/todo/notes/new/give`（網頁 notes-widget 10）
4. **兩份一樣靠一份共用情境檔**（`tests/fixtures/notes-parity.json`）：一題一個輸入，答案是**網頁真的那幾支算出來的**（`node scripts/notes-parity.mjs --write`）。
   網頁那一側 `tests/notes-parity.test.js` 比（`writes` 那一段拿真的 `data/notes.js` ＋ `repo.js` 跑，Firestore 換成替身，連稽核一個字都比）；
   Android 那一側 `android/core` 的 `ParityTest` 讀同一份比。網頁改了一條規則 → 網頁的測試紅 → 確定要的就重算 → Kotlin 紅 → 改 Kotlin。
   網頁的測試也掃 `ParityTest`：情境檔每多一段，Kotlin 那一側要多一個分支。
5. **開發時寫本機模擬器，不寫 staging**（`-Pemulator` 建的 debug：`demo-scheduler`，跟網頁的 E2E 同一個命名空間；HTC 用 `adb reverse` 接到筆電）。staging 留給她點。
6. **簽章兩把**：筆電的 debug 鑰匙（`~/.android/debug.keystore`）、release 鑰匙（`~/.android/baofu-notes-release.jks`，密碼在 `~/.gradle/gradle.properties`；CI 從 GitHub Secrets 拿，issue 09 放）。
   兩把的 SHA-1 都登記在兩個 Firebase 專案的 Android app 上（少一把，那一把簽的那一支 Google 登入就失敗）。**鑰匙與密碼不進 repo、不印進 log**；`google-services.json` 進版控（跟 `firebase-config.js` 同一類公開設定）。
7. **CI 另開 `android.yml`**：只在 `android/**`、情境檔、`domain/notes.js` 變了才跑，不放進 `deploy.yml`（那裡的 concurrency 會讓每一次部署等 Gradle）、不設成必要檢查。
8. 工具鏈在她的使用者資料夾（`%LOCALAPPDATA%\Android\Sdk`：指令列工具、platform、build-tools），不裝 Android Studio、不跑 Android 模擬器。
   `compileSdk` 37.2（2026 的 AndroidX／Compose 要）、`targetSdk` 36、`minSdk` 26。Gradle 限 4 個 worker（她的筆電過熱斷電過）。

## 為什麼

- **原生 vs. PWA**：PWA 做不到桌面小工具，這一題沒有別的答案。
- **直接寫 Firestore vs. 經過一支 Cloud Function 的 API**：經過 API 就沒有本機快取（沒網路記不下來，她要的是「三秒記完」）、多一支要部署要付錢的東西、Rules 之外多一道要維護的檢查。直接寫 Firestore，Rules 與白名單一份都不用改。
- **規則寫兩份 vs. 共用一份程式碼**（Kotlin Multiplatform 編成 JS、或小工具裡放網頁）：網頁 app 是不經過建置的 ES module，為了小工具換掉整個網頁的寫法代價太大；小工具與那張卡也放不了網頁。
  兩份的代價是「遲早對不上」—— 所以不靠人記得，靠情境檔：答案只從網頁算出來，Kotlin 只能照著它綠。
- **情境檔裡有寫入與稽核**：Rules 只擋型別與 `actor`，**沒寫稽核、少寫 `updatedAt` 都過得了**（首頁的「快取 vs 雲端」靠 `id@updatedAt` 決定要不要重畫）—— 只比純函式的話，最容易對不上的那一半沒人盯。
- **營養品的勾法不抄**：那一條連著交付紀錄與試算表（ADR-0059），在 Kotlin 再寫一份，交付紀錄遲早少一格；打開網頁問一次比較慢，但只有營養品的提醒要走那一趟。

## 沒有選的

- **Trusted Web Activity／把網頁包成 app**：小工具與桌面上的那張卡還是要原生寫，包起來只多一層。
- **小工具只讀、要寫就打開網頁**：她要的是「不離開桌面」。
- **上 Google Play**：不上（spec：更新走 Firebase App Distribution，不放 GitHub 公開下載 —— repo 是公開的）。

## 後果

- **改隨手記的形狀或規則要兩邊一起改**（`CLAUDE.md` 連動表「隨手記的形狀或規則 → Kotlin 那一份與情境檔」）。情境檔沒涵蓋到的新規則，先在情境檔加一題再改。
- 小工具本體（07）、輸入卡與選單（08）在 `android/app`，都用 `android/core` 的那幾支，不在畫面裡另寫一份規則。
- 筆電 debug 簽的與 CI release 簽的是兩把鑰匙：HTC 上從自己建的那一支換到 App Distribution 派的那一支，要先移除再裝一次（09 的派送寫進手動驗收）。
- release 鑰匙只有她筆電上一份、還沒放進 GitHub Secrets 與備份（09）；弄丟了，已經裝好的那一支要移除重裝、Firebase 上換登記一把 SHA-1。
