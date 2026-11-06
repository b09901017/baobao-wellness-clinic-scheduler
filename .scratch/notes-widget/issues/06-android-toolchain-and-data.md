# 06：Android 工具鏈、專案骨架、登入、隨手記的讀寫（跟網頁那一份對得上）

Status: done
Blocked by: 04（連在一起的資料形狀要先定案，Kotlin 才照抄）

## 動工前先讀

- `spec.md`「一、原生 Android 桌面小工具」「查過的事實」
- ADR-0178（04 寫的：連在一起的隨手記）、ADR-0044（掛了日期就上日曆）、ADR-0059（營養品的提醒）、ADR-0071（稽核）
- 這一支要寫的 ADR-0179（為什麼另寫原生 app、為什麼規則寫兩份、怎麼盯著兩份一樣）
- `public/js/domain/notes.js`（`validateNote()`、`normalize()`、`normalizePatch()`、04 加的連在一起那幾支）、`public/js/data/notes.js`（`create`／`update`／`setDone`）
- `public/js/data/repo.js` 的 `commit()`：**稽核那一筆的形狀**（`actor`、伺服器時間、`before`／`after`…）與 `firestore.rules` 對稽核的要求（`actor == 她的 uid`）
- `firestore.rules` 的 `allowed()`（白名單照 uid）、`validNote()`、`keepsExistingId()`
- `docs/STAGING.md`（兩個專案的 id、白名單）、`public/js/firebase-config.js`（兩組 web 設定）
- `.github/workflows/deploy.yml`（不可以弄壞既有的測試與部署）

## 她要的

> 就是有沒有辦法不離開桌面、不開 App、輸入框或是鍵盤自己設計

（第四輪後）她同意：另寫一支 Android app；兩個版本（測試接 staging 裝 HTC、正式接正式站裝三星）；Firebase App Distribution 更新、不放 GitHub 公開下載；
筆電裝 Android 指令列工具＋SDK（不裝 Android Studio、不跑模擬器），HTC 走 USB 偵錯。

## 為什麼會這樣

網頁 app 不能放桌面小工具（ADR-0179 要寫的理由）。原生 app 直接用 Firebase Android SDK 讀寫同一個 Firestore —— 所以**隨手記的規則多一份 Kotlin 的**：
`validateNote()`（200 字、掛了客戶要有名字、日期看得懂）、`normalize()`（空字串一律 null）、連在一起那一組的寫法、稽核那一筆。兩份不一樣的代價是資料長得不一樣、稽核紀錄壞掉、Rules 擋下來（她看到「存不進去」）。

## 要做的

1. **動手前先問她兩件（一次一題、白話、附建議）**：
   - 接受 Android SDK 的授權條款（`sdkmanager --licenses`）—— 她 11/6 同意了「下載」，**接受條款要另外問**
   - 在 Firebase 主控台替 staging 與正式站各登記一支 Android app（套件名、SHA-1）、開 Google 登入的 Android 用戶端 —— 正式站的設定，先問；能用 CLI 做的講清楚做了什麼
2. **工具鏈**：指令列工具裝到 `%LOCALAPPDATA%\Android\Sdk`（只裝 platform-tools、一個 platform、build-tools）；**不裝模擬器**。Gradle wrapper 進版控。
   建置是 CPU 重活：一次跑完、不要放著連跑（她的筆電 10/2 過熱斷電過）
3. **專案**：`android/`（Kotlin、Jetpack Glance 給小工具）。兩個 flavor：`staging`（「隨手記（測試）」、套件名後綴 `.staging`）、`prod`（「隨手記」），可以同時裝。
   `google-services.json` 兩份（它是公開的設定、跟 `firebase-config.js` 同一類，可以進版控；**再確認一次裡面沒有任何不該公開的**）
4. **登入**：Google 登入（Credential Manager）→ Firebase Auth；登入的 uid 跟網頁 app 一樣（同專案同帳號），白名單不改。沒在白名單上 → 講一句、不寫
5. **隨手記的讀寫（Kotlin）**：新增、勾／拿回來（連在一起的一組一起）、改字、改日期、掛給誰、拿掉日期、複製到別天（連在一起／不連）、拆開這一天 ——
   **每一次寫入跟網頁那一份同一個形狀、同一個 commit 裡帶稽核**；開 Firestore 本機快取（沒網路照記）
6. **兩份對得上的盯法**：一份共用的情境檔（建議 `tests/fixtures/notes-parity.json`：輸入 → `normalize()`／`validateNote()`／連在一起的寫入計畫／小工具的排序 的預期輸出），
   **node 的測試與 Kotlin 的單元測試讀同一份**。網頁那一份改了規則、情境檔跟著改，Kotlin 那邊就紅
7. **CI**：另開 `android.yml`（見下面「過目抓到的」），建置兩個 flavor ＋ Kotlin 單元測試；**不可以讓既有的測試／部署變慢或多一個會紅的必要檢查**。
   簽章鑰匙（release keystore）放 GitHub Secrets，**鑰匙與密碼絕不進 repo、不印進 log**；debug 版本機自己簽
8. HTC 接上之後裝得上一支「隨手記（測試）」、登入、能新增一筆、網頁 app 的 staging 上看得到那一筆（稽核頁也有那一則）
9. ADR-0179、`CLAUDE.md` 連動表加一列「隨手記的形狀或規則 → Kotlin 那一份與情境檔」、`tests-e2e/related.js` 照規定登記新的被追蹤檔案（`android/**` 可能要整個目錄的規則；`tests/e2e-related.test.js` 盯著）

## 過目抓到的：Kotlin 要照抄、上面沒寫到的（11/6）

- **新增的那一筆**：`{ ...normalize(data), doneAt: null, deletedAt: null, createdBy: uid, createdAt: 伺服器時間, updatedAt: 伺服器時間 }`
- **每一次修改都要寫 `updatedAt`**（Rules 不擋 —— `keepsExistingId()` 只問有沒有那個鍵，合併後一定有 —— 但首頁「快取 vs 雲端」靠 `id@updatedAt` 決定要不要重畫，`home.js:274`）
- **`doneAt` 是用戶端的 ISO 字串**（JS `new Date().toISOString()`：一定三位毫秒＋`Z`）。Kotlin 的 `Instant.toString()` 會把 `.000` 拿掉 → `sortNotes()` 比字串會排錯。用固定格式
- **稽核那一筆**：`audit` 集合裡另一筆自動 id 的文件 `{ at: 伺服器時間, actor: uid, action: 'notes.create'|'notes.update'|'notes.softDelete', targetPath: 'notes/<id>', before: <改之前整份（含 Timestamp）、新增是 null>, after: <新增：不含伺服器欄位的資料；修改：變了的那幾欄、不含 updatedAt；刪除：{ deletedAt: 'server', reason }>, note: null }`。
  Rules 只要求 `actor == uid` 與那四個鍵 —— **沒寫稽核也過得了**，所以稽核的形狀放進情境檔盯著；`before` 要真的先讀（沒有它句子講不出是哪一筆）
- **比對**：名字是 `normalizeAlias`（NFKC、`\s` 是 Unicode 空白、小寫）；病歷號走 `chartNosOf()`／`normalizeChartNo()`（含舊的「病歷號 1234」短備註）；JS 的 `trim()` 也去 U+3000／U+00A0／U+FEFF —— 情境檔都要有，加上 `noteActions()` 的順序
- **查詢**：照現有的索引形狀（`deletedAt, done, createdAt desc` 等）；新的查詢要先經網頁那一條部署索引
- **網址**：10 做的那兩條（開某一筆、開記一筆並展開給營養品）
- **簽章**：每一把簽章鑰匙（筆電的 debug、CI 建的 staging、release）的 SHA-1 都要登記到 Firebase，不然 CI 建出來的那一支 Google 登入會失敗
- **開發時寫本機模擬器，不寫 staging**（`CLAUDE.md`「會寫入的驗收在本機模擬器走」）：`adb reverse` 把模擬器的 port 接到 HTC、Android SDK 的 `useEmulator`；staging 留給她點
- **CI**：另開 `.github/workflows/android.yml`，`on.paths` 只在 `android/**`、`public/js/domain/notes.js`、情境檔有變時跑；**不要放進 `deploy.yml`**（workflow 那一層的 concurrency 會讓每次部署等 Gradle）、不設成必要檢查
- `tests-e2e/related.js` 的 `IGNORED` 加 `android/`（不然 `pick()` 認不出、每改一次 Android 就全跑 E2E）
- `.gitignore`：`local.properties`（裡面有 Windows 使用者路徑）、`*.jks`、`*.keystore`、`build/`、`.gradle/` —— 每一條 `git check-ignore -v` 真的跑過；
  `.gitattributes` 全部強制 LF → `gradlew.bat` 要 `eol=crlf`
- 「一個字都一樣」的基準：網頁幾條建立路本來就不一樣（`deliveryNoteFor` 不走 `normalize()`）→ 基準寫明是 `data/notes.js` 的 `create()`／`update()`；在模擬器裡兩邊各寫一筆、連稽核一起比

## 判準

- 同一筆隨手記從小工具記與從網頁記，存進 Firestore 的欄位、型別、稽核那一則**一個字都一樣**嗎？（情境檔＋在 staging 實際各記一筆比對）
- 網頁那一份的 `validateNote()`／`normalize()` 改了一條，Kotlin 那邊的測試會不會紅？
- 一個不在白名單上的帳號登入小工具，能不能寫進任何一筆？
- `npm run verify` 照舊綠、`deploy.yml` 對沒動 `android/` 的 PR 行為一樣嗎？
- repo 裡、commit 裡、Actions log 裡有沒有任何鑰匙、密碼、真名？

## 做完時留下的

段五（2026-11-06）。**ADR 是 0180**（issue 上寫 0179 的地方都是 0180；0179 是連在一起的隨手記）。

**Firebase 登記（她 11/6 答「兩個都由你用指令登記」，`firebase apps:create` ＋ `apps:android:sha:create`）**

| | 套件名 | Firebase app id | 專案 |
|---|---|---|---|
| 隨手記（測試） | `tw.baofu.notes.staging` | `1:306220040308:android:dc49687824b0a172501121` | wellness-clinic-staging |
| 隨手記 | `tw.baofu.notes` | `1:4875686059:android:80eb09363f4d1a8007a7ee` | wellness-clinic-scheduler |

兩支都登記了兩把 SHA-1：筆電 debug `69:68:9F:3C:…:8B:3B`（`~/.android/debug.keystore`）、release `D4:CC:CE:44:…:AF:01`（`~/.android/baofu-notes-release.jks`，密碼在 `~/.gradle/gradle.properties` 的 `baofuNotes*`，我產生的、沒印出來過）。
Google 自動替每一把建了 Android 的 OAuth 用戶端；`google-services.json` 兩份在 `android/app/src/{staging,prod}/`（只有公開設定，進版控）。
**release 鑰匙只有筆電這一份**：09 要放進 GitHub Secrets（`BAOFU_NOTES_STORE_FILE` 之類，`app/build.gradle.kts` 的 `secret()` 認環境變數）與備份（私人 repo `.local`？—— 09 問她）。

**工具鏈**（`%LOCALAPPDATA%\Android\Sdk`；Claude 的沙盒裡是 `…\Packages\Claude_…\LocalCache\Local\Android\Sdk`，從 Bash／PowerShell 用 `$LOCALAPPDATA` 找得到）：
- 指令列工具 v23（`commandlinetools-win-16111833`）—— **`sdkmanager` 已經換成 `android` CLI**：`android --no-metrics --sdk=<Sdk> sdk install platforms/android-37.2`（斜線、不是分號；**一律帶 `--no-metrics`**，不帶會送使用統計）
- `platforms/android-36`、`platforms/android-37.2`、`build-tools/36.1.0`；JDK 21（`C:\Program Files\Microsoft\jdk-21…`，Gradle 要 `JAVA_HOME`）
- Gradle 9.8.2（wrapper 進版控）、AGP 9.5.1（內建 Kotlin，不套 `kotlin-android`）、Kotlin 2.4.21、Firebase BoM 35.1.0、Compose BOM 2026.09.00、Credential Manager 1.6.0
- **`compileSdk` 37.2**（2026 的 AndroidX／Compose 要 37 以上，36 編不過）、`targetSdk` 36、`minSdk` 26；`gradle.properties` 限 4 個 worker、Kotlin 在 Gradle 裡編
- 建置：`cd android && JAVA_HOME=… ./gradlew :core:test :app:assembleStagingDebug`（第一次 4–5 分鐘在下載，之後一兩分鐘）；**接模擬器那一支加 `-Pemulator`**。做完 `./gradlew --stop`

**程式在哪**

| | 檔案 | 是什麼 |
|---|---|---|
| core | `android/core/.../Notes.kt` | `domain/notes.js` 的照抄（`validateNote`、`normalize`、`normalizePatch`、`sortNotes`、`groupLinked`、`linkedPeers`、`linkedChanges`、`copyPlan`、`linkedReach`／`linkedWords`／`linkedBadge`、`noteActions`、`dateChoices`、`copiedSay`、`openCount`） |
| | `Names.kt` | `normalizeAlias`、`normalizeChartNo`、`chartNosOf`、`nameHas`、`chartNoHas`、`nameSuggestions(text, caret, customers, collator, currentId, limit)`（**collator 由呼叫端給**：app 用 `android.icu.text.Collator.getInstance(ULocale("zh-Hant"))`）；`WebLinks.note(origin, id)`、`WebLinks.newGive(origin)` |
| | `NotesWriter.kt` | `data/notes.js` ＋ `repo.commit()`：`create`、`update`、`setDone`、`remove`、`removeRow`、`copyTo`、`unlink`，每一筆一則稽核；讀寫經 `NoteStore` 介面 |
| | `Js.kt`、`Dates.kt` | JS 的 `trim()`／`\s`、`String()`、真假值；`isValidDate`、`shortDate`、`isoInstant`（三位毫秒）、`todayIso` |
| app | `Backend.kt` | 接哪一個 Firebase（`-Pemulator` → `demo-scheduler`＋127.0.0.1）、開本機快取、`Backend.notes`（寫入）、`Backend.store` |
| | `FirestoreNoteStore.kt` | `NoteStore` 接 Firestore SDK；值在這裡換；**寫入 4 秒沒回到伺服器就不等了**（`pending`，畫面講「存在這台手機上了」） |
| | `SignIn.kt` | Credential Manager → Firebase Auth；問 `allowedUsers/{uid}`，不在上面就登出；記住通過的 uid（`rememberedAllowed()`，小工具離線時用）；模擬器那一支多一個假帳號 |
| | `MainActivity.kt` | **骨架**：登入、記一筆、還沒勾的清單（`groupLinked`）、勾掉、登出 —— 段六可以整個換掉 |

**共用情境檔**：`tests/fixtures/notes-parity.json`（137 題、22 段）。網頁那一側 `tests/notes-parity.test.js`、Android 那一側 `ParityTest`（`./gradlew :core:test`）。
答案由網頁算：`node scripts/notes-parity.mjs`（只比）／`--write`（重算寫回）；新的一題加 `{ name, in }`（不寫 `out`）再 `--write`。
`writes` 那一段拿真的 `data/notes.js` 跑（`tests/helpers/fakeFirestore.js` 替 gstatic 的 SDK，`registerHooks()` 接過去），自動 id 照出現的順序寫成 `$1`…。
`nameSuggestions` 的情境從 `tests/notes-name-suggestions.test.js` 的 `CASES` 搬過來了（那一支只留「換字的範圍」一題），多了 zh-Hant 排序（口 3 畫在中 4 畫前面）與表情符號的位置兩題。
**刻意沒放進情境檔的**：小工具自己的清單順序（spec：今天 → 過了沒勾的 → 沒日期 → 以後的）—— 網頁沒有這一支，07 寫在 Kotlin、自己的單元測試。

**驗過的**（11/6，HTC U23 Pro）
- 模擬器那一支（`-Pemulator`，`adb reverse` 8080／9099／5000）：不在白名單 →「這個帳號（…）沒有權限，沒有寫任何東西」、模擬器裡一筆都沒有；加進白名單之後記一筆、勾掉。
  模擬器裡那一筆與它的兩則稽核，跟**網頁那一側在同一個模擬器裡記的一筆**比：欄位、型別、`createdBy`、稽核的鍵與 `after` 一樣（只差 Android 那一筆勾掉了）；`doneAt` 是 `2026-…T…:16.454Z`、`before` 是整份含 Timestamp
- 網頁用同一個假帳號登入拿到**同一個 uid**；網頁的隨手記那一頁看得到 Android 記的那一筆
- 真的 staging（不加 `-Pemulator`）：她自己在 HTC 上選了帳號 → Google 登入、白名單都過、清單讀得到（**沒有寫任何東西**；截圖有真名，只在 scratchpad）。**HTC 上現在裝著這一支、登入著 staging**

**在 HTC 上接模擬器的步驟**（段六照做）：
1. 先看 port 沒人用（`netstat -ano | grep LISTENING | grep -E ":(5000|8080|9099) "`），`E2E_WORKERS=1 npm run emulators`（背景跑，等「All emulators ready」）
2. `cd android && ./gradlew :app:assembleStagingDebug -Pemulator`、`adb install -r app/build/outputs/apk/staging/debug/app-staging-debug.apk`（會蓋掉 HTC 上接 staging 的那一支 —— 同一個套件名）
3. `adb reverse tcp:8080 tcp:8080`（9099、5000 同樣）；app 裡按「用模擬器的測試帳號登入」→ 第一次一定是「沒有權限」
4. 拿 uid：`curl -s -X POST -H "Authorization: Bearer owner" -H "Content-Type: application/json" -d '{}' "http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/projects/demo-scheduler/accounts:query"`（`notes-widget-dev@example.com` 那一位）
5. 加白名單：`curl -s -X PATCH -H "Authorization: Bearer owner" -H "Content-Type: application/json" -d '{"fields":{}}' "http://127.0.0.1:8080/v1/projects/demo-scheduler/databases/(default)/documents/allowedUsers/<uid>"`，再按一次登入
6. 網頁那一側：瀏覽器開 `http://127.0.0.1:5000`，在頁面裡 `import()` gstatic 的 firebase-app／firebase-auth，`signInWithCredential(getAuth(getApp()), GoogleAuthProvider.credential('{"sub":"notes-widget-dev",…}'))` —— 同一個 sub ＝同一個 uid
7. 收掉：停背景那一支之後**照 port 找到的那兩個 PID 也要停**（node 與 java，停 task 不會帶走它們）、`adb reverse --remove-all`

**經過 USB 的寫入要 2～5 秒才回到模擬器** → 開發版幾乎每一筆都講「存在這台手機上了」。不是錯（資料在快取裡、也真的寫進去了）；真的網路下多快、那一句要不要留，段六做輸入卡時看。
`uiautomator dump` 在這支 app 上讀不到字（空的）—— 在 HTC 上檢查畫面用截圖（`adb exec-out screencap -p`）。
