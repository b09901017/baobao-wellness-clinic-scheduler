# 第 4 組最後健檢：Android 隨手記桌面小工具（PR #222）

2026-11-07，worktree `final-check-android-d14673`，`git log -1` = `a8081e6b`（develop，#224 合進去之後）。
範圍：PR #222（merge `9036614b`）的 `android/`、`.github/workflows/android.yml`、`scripts/notes-parity.mjs`、`tests/notes-parity.test.js`、`tests/fixtures/notes-parity.json`、`tests/helpers/notesParity.js`、`tests/helpers/fakeFirestore.js`，與它改的 CLAUDE.md、SPEC.md、`docs/STAGING.md`、操作手冊、常見問題；對照 #210、#221、#224。

**只查、只寫報告**：沒改程式、沒 commit、沒 push、沒開 PR。本機**沒跑 Gradle、沒起模擬器**；Kotlin 那一側是讀程式＋看 CI（`android.yml` 在 #222 的三次 PR run 與合進 develop 那一次 run 都綠：`:core:test` 跑了，四個版本〔staging／prod × debug／release〕都建出來，release 有簽到）。

**結論：沒有要在合進 main 之前修的程式問題。** 寫進 Firestore 的每一種文件跟網頁一欄一欄一樣（含稽核）、R1～R9 都真的修好了、public repo 裡沒有金鑰、密碼、email、真名。「可以之後再做」那五條都不會寫錯資料。

---

## 合進 main 之前建議修

**沒有。**

（順序上的提醒，不是要修的：三星的正式版照 HANDOFF 段九 6 的順序 —— #221＋#222 進 main、正式站部署完，**才**從 main 那一個 commit 建正式版、派給三星。下面 L2 只是把那一條寫的「理由」更正，結論不變。）

---

## 可以之後再做

### L1　真刪（不是軟刪除）的隨手記，小工具永遠拿不掉 —— staging 的「清空重來」之後 HTC 上會留著已經不存在的那幾筆

- **在哪裡**：`android/core/src/main/kotlin/tw/baofu/notes/core/NotesSync.kt:44`（`merge()` 只拿掉「這一次讀回來、而且已經勾掉或刪掉」的那幾筆）與 `:60`（`fetch()` 有游標就只問 `updatedAt > 游標`）。真刪的文件沒有新的 `updatedAt`、也不會再被任何查詢讀回來。
  真刪的路：`scripts/reset-staging.mjs:180-183`（`npm run staging:reset` 用 `batch.delete()` 清掉隨手記）、`scripts/restore-backup.mjs` 的 `--wipe`。正式站沒有這種路（ADR-0165：不清空重來），**只影響 staging 與 HTC 上的「隨手記（測試）」**。
- **她會看到什麼**：staging 清空（或清空再匯入合併檔／還原）之後，HTC 小工具上清空之前的那幾筆一直在；點勾那一筆 → 寫入丟「不存在」→ 小工具底下講「讀不到最新的（網路？）」（講錯原因）；點字 → 選單講「這一筆剛剛被刪掉了」、那一筆才離開。登出再登入（整份重讀）就全好。
- **怎麼重現**：讀程式（上面兩處）。Kotlin 的重現題寫好了：`.scratch/final-check-2026-11-07/HardDeleteSync.kt.txt`（貼進 `NotesSyncTest`、`cd android && ./gradlew :core:test --tests "tw.baofu.notes.core.NotesSyncTest"`，斷言的是現在的行為 —— 會綠、x 還在）。本機沒跑 Gradle。
- **為什麼不急**：只在 staging、只在有人跑清空的時候；不會寫錯任何資料。R7 已經在 `docs/STAGING.md:515` 寫了「還原之後登出再登入」，但「二、清空重來」那一節（`docs/STAGING.md:140-160`）沒寫，CLAUDE.md「隨手記的形狀或規則（Android）」那一列也只講「不經過 `repo.commit()` 的寫入」、沒講真刪。
- **建議**：`docs/STAGING.md`「二、清空重來」第 3 步後面加一行「清完之後 HTC 上的『隨手記（測試）』登出再登入一次（真刪的那幾筆小工具問不到）」；CLAUDE.md 那一列同一句補「真刪也是」。**兩行文件**。要從程式上自己好：背景同步一天整份讀一次（`listOpen()`，多花「還沒勾的筆數」次讀取／天），約 10 行＋一題測試 —— 不建議為了 staging 做。

### L2　清單 B 段與 HANDOFF 段九 6 寫的「理由」不對：舊的正式站 Rules **不會**擋 `linkId`

- **在哪裡**：`.scratch/notes-widget/android-checklist.md:68`「不然『複製到別天』在正式站會被擋」、`.scratch/notes-widget/HANDOFF.md:172-173` 同一句。
- **看到什麼**：`git diff origin/main -- firestore.rules`：main 上的 `validNote()` 只驗 `text`／`done`／`date` 的型別，**沒有 `keys().hasOnly()`**，所以帶 `linkId` 的寫入照樣過 —— #221 加的那幾行是**更嚴**（擋太長的 `linkId`、擋營養品的提醒連在一起），不是「放行」。
- **真正要等 main 的理由**：正式站的**網頁**（main）還不認得連在一起：三星上複製出來的那幾天，正式站網頁會列成好幾列、勾一天其他天不跟著勾、資料健檢也沒有那一項。所以「先進 main、再派正式版」的順序是對的，只是理由要換。
- **怎麼重現**：讀 Rules（上面的 diff）。要實測的話 Rules 測試在模擬器上跑（這一批不起模擬器），沒寫。
- **建議**：兩處各改半句（`.scratch`，不影響程式）。

### L3　spec「暴富日常的圖示加一支小筆」沒有做，也沒有記成決定

- **在哪裡**：`.scratch/notes-widget/spec.md:56`；`android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png` 是網頁 app 的圖示原樣縮小（沒有筆），staging 與正式兩支同一張。
- **她會看到什麼**：三星主畫面上「暴富日常」（裝到主畫面的網頁 app）和「隨手記」會是**兩個一模一樣的圖示**，只有底下的名字不同；HTC 上「隨手記（測試）」也一樣。
- **怎麼重現**：看那張 png；`git log` 只有 06 那一個 commit 動過它；HANDOFF、issue 06～09、ADR-0180 都沒有「不加筆」的決定。
- **建議**：問她要不要補（換一張 png，或做 adaptive icon；要不要測試版另一個顏色順便分得出來），或記進她的 backlog。不影響功能。

### L4　（優化）寫入前讀「改之前的樣子」是一筆一筆排隊讀，網頁是同時讀

- **在哪裡**：`android/core/src/main/kotlin/tw/baofu/notes/core/NotesWriter.kt:76`（`ops.mapIndexed { store.read(...) }`，suspend 函式裡依序等）；網頁 `public/js/data/repo.js:198` 是 `Promise.all`。
- **實際的差**：勾掉／改字一組連在一起 N 天＝前面已經重讀過一次（`freshWithPeers`），這裡再**依序**讀 N 筆。網路慢時（每次一兩百毫秒）N 天就多 N 倍；寫入在背景跑、畫面不會卡，但小工具「劃線 3 秒後離開」、選單寫完換清單會跟著晚。寫進去的內容一樣（情境檔 `writes` 盯著）。
- **建議**：`coroutineScope { ops.mapIndexed { … async { store.read(…) } }.awaitAll() }`，約 3 行；情境檔不用改（`FakeStore` 的讀不分先後）。

### L5　（小）網頁那一側沒釘住小工具用的另外兩條網址

- **在哪裡**：`tests/notes-parity.test.js:36-42` 只釘 `/todo/notes/note/:id` 與 `/todo/notes/new/give`；小工具標題（`WebLinks.notesPage()` → `#/todo/notes`）與選單「看那一包」（`WebLinks.customer()` → `#/customers/<id>`）只有 Kotlin 的 `WebLinksTest` 拿 Kotlin 自己的常數比 —— 網頁哪天改了那兩條路由，**兩邊都不會紅**（CLAUDE.md 那一列寫的「網頁那兩條路由改了要回來改，`WebLinksTest`」靠人記得）。
- **怎麼重現**：讀兩支測試；`public/js/ui/views.js:75` 現在有 `'/customers/:id'`，`'/todo/notes'` 也在，所以今天是對的。
- **建議**：`tests/notes-parity.test.js` 那一題多兩行 `assert.match(views, /'\/todo\/notes'/)`、`/'\/customers\/:id'/`。兩條都是用很久的路由，不急。

### 懷疑但沒重現（要實機看）

- **S1　過了午夜、下一次同步之前，小工具的「今天」還是昨天**：`android/app/src/main/kotlin/tw/baofu/notes/widget/NotesWidget.kt:156` 的 `today` 只在重畫時算；`notes_widget_info.xml:17` 是 `updatePeriodMillis="0"`、沒有接日期改變的廣播 —— 重畫只靠同步、自己寫入、放小工具／開機、更新版。午夜之後到 WorkManager 下一次跑之前，昨天的那幾筆留在最上面那一段而且**不畫日期**（`:271` 今天的不畫），今天的那幾筆在「以後的」帶著日期。
  我推測她早上解鎖手機時系統會很快補跑延後的那一次（手機睡著時 WorkManager 延後，醒來補跑），多半看不到；**沒有實機證據**。試了什麼：讀 Glance 的重畫來源與 receiver；本機不能跑。建議在三星的 B 段加一步「早上第一次解鎖看小工具，昨天的那一筆不在最上面」。真的撞到再加一個在午夜觸發的重畫（WorkManager 的一次性工作排到明天 0:00，約 15 行）。

---

## 查過沒事

### 一、她要的（spec「一」、HANDOFF「她已經決定的」）在程式裡找得到、行為對

| 決定 | 程式在哪 |
|---|---|
| 兩支可以同時裝：「隨手記（測試）」接 staging、「隨手記」接正式站 | `android/app/build.gradle.kts:57-68`（`applicationIdSuffix = ".staging"`、兩份 `WEB_ORIGIN`）、`app/src/staging/res/values/strings.xml`（名字）、`app/src/{staging,prod}/google-services.json` |
| App Distribution、不放 GitHub 公開下載 | `android.yml` 不上傳 artifact（合進 develop 那一次 run 的 artifacts＝0）；`docs/STAGING.md`「三之四」只用 `--groups owner` |
| 同一個 Google 帳號登入、問白名單、不在名單上登出一筆不寫 | `SignIn.kt:83-98`（`checkAllowed()`）；`MainActivity.kt` 的 `NotAllowed` 分支講一句、`WidgetSync.forget()` |
| 沒網路也記得下來 | `Backend.kt:51`（`persistentCacheSettings`）；`create()` 不先讀，一按就在快取裡 |
| 安裝檔這一輪筆電建（她 11/6「照建議」，GitHub Actions 派送進 backlog 27） | `docs/STAGING.md`「建一版、派送」寫了「合進去的那一個 commit、乾淨的 checkout」 |
| D 半透明便利貼、三星模糊的條件 | `NotesWidget.kt:163`（`appWidgetBackground()`＋半透明）、`Palette.kt:34/52`（`GLASS_ALPHA`）、`notes_widget_info.xml`（`widgetStyle="colorful"`、`widgetSize`） |
| 麥克風灰的、點了不動 | `NotesWidget.kt:200-203`（沒有 `clickable`） |
| 清單順序：今天（一組有一天是今天也算）→ 過了 → 沒日期 → 以後的；段之間一條淡線 | `core/.../WidgetList.kt`＋`WidgetListTest`（6 題）；`NotesWidget.kt:172-176` |
| 點勾＝劃線 3 秒、3 秒內再點回來 | `WidgetSync.kt` 的 `tick()`／`settle()`、`WidgetStore.LINGER_MS` |
| 點字＝選單（沒有長按）；點標題＝網頁隨手記那一頁 | `NotesWidget.kt:253/260`、`:191`（`WebLinks.notesPage()`） |
| 營養品的提醒點勾＝打開網頁問「給了哪幾款」（三個入口） | `NoteTaps.kt:18`；`NotesWidget.kt:233`、`MenuActivity.kt:153`、`MainActivity.kt:184`；`WidgetSync.kt:136` 萬一走到也不寫 |
| 輸入卡：桌面調暗＋模糊、貼在鍵盤上、2 行起長到 4 行、字大一號 | `Floating.kt`（`DIM`、`BLUR`、`BigField` 的 `minLines = 2`、`maxLines = 4`、19sp）；manifest `adjustResize\|stateAlwaysVisible` |
| 今天／挑日期／掛給誰／給營養品一排；給營養品打開網頁的「記一筆」展開給營養品 | `CaptureActivity.kt` 的 `ChipRow`、`WebLinks.newGive()`（網址不帶任何字 —— 個資不進網址） |
| 打名字跳出客戶、注音選字中不跳、點了換成全名＋掛給他 | `CaptureActivity.kt`：`field.composition == null` 才找、`Names.nameSuggestions()` |
| 複製到別天：小月曆多選、開關預設連在一起、今天以前點不了、拆開在那張卡最上面、營養品不給複製 | `MenuActivity.kt` 的 `CopyCard`／`MonthGrid`（`iso < today` 停用）；`Notes.noteActions()`（情境檔 noteActions 7 題） |
| 選單重排（勾掉／改日期／掛給誰／改文字／複製到別天）、「改日期」一張卡三個選項 | `Notes.noteActions()`、`Notes.dateChoices()`（情境檔 7＋6 題）；選單處理得到每一種 id（`tick`、`untick`、`date`、`who`、`edit`、`copy`、`bag`；`today`、`pick`、`undate`） |
| 深色／淺色長按圖示切換、預設淺色 | `ThemeShortcut.kt`、`WidgetStore.darkFlow()`（預設 `false`） |
| 更新方式：自己寫完馬上換、按 ＋ 抓一次、背景 WorkManager 15 分、不叫醒手機 | `WidgetSync.afterLocalWrite()`、`CaptureActivity.kt:55`、`WidgetSync.schedule()`（`NetworkType.CONNECTED`、沒有 expedited／鬧鐘） |

### 二、REVIEW-android 的 R1～R9：都真的修好了

| | 現在的樣子 |
|---|---|
| R1 主畫面能直接勾掉營養品的提醒 | `MainActivity.kt:184-187` 先問 `NoteTaps.asksWhatWasGiven()`、打開網頁就 return；三個入口同一支 |
| R2 讀到快取時游標往前跳 | `FirestoreNoteStore.kt:45/64/70` 把 `metadata.isFromCache` 交出去；`NotesSync.kt:60-72` 讀到快取游標不動、`fresh=false`；`WidgetSync.pull()` 標 `stale`。我另外推過「快取裡有別台改過的」「pending 的伺服器時間」「整份讀到快取」三種，游標都不會跳。`NotesSyncTest` 有 REVIEW 那一題（照抄）＋「第一次就沒網路」 |
| R3 同步回來蓋掉同步期間自己寫的 | `NotesSync.kt:81-90` 的 `apply()` 套在**現在那一份**上、整份讀時留著 `updatedAt` 還是 null 的；`WidgetSync.kt` 在 `WidgetStore.update()` 那把鎖裡叫；三題測試 |
| R4 選單少「拿回來」 | `MenuActivity.kt:161-164`（`untick`＋`WidgetSync.stopTicking()`）、`:114` 讀到已勾掉就換清單、`:376` 複製卡那一句跟網頁一樣 |
| R5 沒登入時 ＋ 記得下來、登出登入講錯狀態 | `Floating.kt:90-95` `signedInOrLeave()`（`CaptureActivity.kt:53`、`MenuActivity.kt:72`）；`NotesWidget.kt:208` 沒登入 ＋ 打開主畫面；`:92` 在 `provideContent` 裡讀 uid |
| R6 等待、失敗的字 | `Say.kt` 一處：pending 講「存在這台手機上了，連上網路會補傳」、PERMISSION_DENIED／UNAVAILABLE／斷網講白話 |
| R7 還原之後看不到 | `docs/STAGING.md:515`、ADR-0180 後果（真刪的另一條路見 L1） |
| R8 文件 | ADR-0180 不再寫鑰匙路徑、`compileSdk`、worker 數、過時那一條（grep 過）；操作手冊不再講清單順序；`STAGING.md` 補了乾淨的 checkout |
| R9 判斷題 | `WebLinks.notesPage()`＋`WebLinksTest`；receiver 的 scope 掛 `AppScope.guard`（`NotesWidget.kt:102`）、`ThemeShortcut.kt:50` 用 `AppScope`；`FirestoreNoteStore.openQuery()` 三處共用（app 裡再也沒有寫死的 `"notes"`）；`Js.nullish` 拿掉了 |

### 三、public repo 有沒有放了不該放的：沒有

- **真名、email**：`scan-public-text.mjs`（這個資料夾，名單跟 `tests/no-secrets.test.js` 同一份、121 個名字）掃了 #222 整支 diff（10,554 行）、24 個 commit 的訊息、PR 標題與內文：**名字 0 處**；email 只有 commit 結尾的 `noreply@anthropic.com` 與 `SignIn.kt` 模擬器假帳號的 `example.com`。`node --test tests/no-secrets.test.js`：3 過、skipped 0。沒有任何人的 Gmail、App Distribution 測試者的 email（文件寫 `<她的 Gmail>`、派送一律 `--groups owner`）。沒有 Windows 使用者路徑。
- **簽章鑰匙、密碼、服務帳號**：repo 裡只有 Secrets 的**名字**（`BAOFU_NOTES_*`）與筆電上的檔名；沒有 `.jks`／`.keystore`／`local.properties`／APK 被追蹤（`git ls-files`），`git check-ignore -v` 實測 `local.properties`、`*.jks`、`*.keystore`、`android/*/build/`（含 APK）、`android/.gradle/` 都擋著。沒有服務帳號金鑰。
- **`google-services.json`（兩份都進了版控，刻意的）**：內容是 Firebase **用戶端設定**：專案 id／編號、Android app id、OAuth 用戶端 id、簽章憑證的 SHA-1、一支 `AIza…` 開頭的 Android 金鑰（staging、正式各一支，跟網頁那兩支是不同的鑰匙）。這一類本來就會打包進每一個 APK、網頁那一份也早就公開在 `public/js/firebase-config.js`；擋資料的是 Rules（`allowed()` 白名單）。SHA-1 是公開憑證的指紋，拿它簽不了東西。
- **`android.yml`**：只有 `pull_request` 與 `push`（全部 workflow 都沒有 `pull_request_target`／`workflow_run`）；`permissions: contents: read`；release 那一步 `if: github.event_name == 'push'`，fork 來的 PR 拿不到 Secrets、也不會建 release。合進 develop 那一次的 log：四格 Secrets 都印成 `***`，鑰匙檔寫在 `$RUNNER_TEMP`、沒有 echo；artifacts 0 個。`setup-gradle` 只有在預設分支（main）寫快取，PR 與 develop 只讀 —— fork 的 PR 污染不了 main 那一次帶 Secrets 的建置；Gradle 的建置快取存的是輸出、不存密碼的值。
- 順手看到（不是 #222 的）：`HANDOFF.md:104` 有 HTC 的裝置序號（#221 的 `0bd3750f` 寫的）。不是秘密、拿它做不了什麼，只是一個硬體識別碼；要不要拿掉由她決定（拿掉也收不回歷史）。

### 四、寫進 Firestore 的：每一種都跟網頁一樣

對著 `public/js/data/notes.js`＋`data/repo.js` 的 `commit()` 逐欄比（`NotesWriter.kt`、`FirestoreNoteStore.kt`），情境檔 `writes` 15 題拿**真的**網頁程式碼跑、連稽核一個字都比，CI 上 Kotlin 那一側對同一份答案綠：

| 寫入 | 欄位與時間 | 一組的規則 |
|---|---|---|
| 新記（輸入卡、主畫面） | `normalize()` 後的固定那幾格＋`doneAt: null`；`deletedAt: null`、`createdBy`＝uid、`createdAt`／`updatedAt`＝**伺服器時間** | 不帶 `linkId`；Android 不建營養品的提醒（沒有任何一處寫 `entitlementId`） |
| 勾／拿回來 | `done`、`doneAt`＝**手機時間**的 ISO 字串、三位毫秒＋`Z`（網頁也是用戶端時間：`new Date().toISOString()`）；`updatedAt`＝伺服器時間 | 寫之前照 `linkId` 重讀、`linkedChanges()` 一組一個 commit |
| 改字、掛給誰 | `normalizePatch()`；掛給誰兩格一起、`customerName` 是點的那一刻的名字快照 | 一組一起改、已經一樣的不寫 |
| 改日期、拿掉日期、拆開 | 只寫這一筆（`linkId: null`） | 只動代表的那一天（spec 那張表） |
| 複製到別天 | 重讀之後 `copyPlan()`；新的那幾筆 `doneAt: null`；`newLinkId` 用自動 id | 營養品的提醒擋（`copyPlan` 的 `blocked`、`validateNote()`、Rules 三層） |
| 刪掉 | Android 畫面上沒有刪掉這一顆（spec 的選單沒有）；`remove`／`removeRow` 照抄了、情境檔有測，只是沒人叫 | 軟刪除：`deletedAt`＋`updatedAt` 都是伺服器時間 |

- **稽核**：每一筆一則 `audit/<自動 id>`：`at`（伺服器時間）、`actor`（`auth.currentUser.uid`）、`action`（`notes.create|update|softDelete`）、`targetPath`、`before`（先讀、整份、Timestamp 來回不掉奈秒）、`after`、`note: null` —— 跟網頁同一個 batch 形狀。Rules 的 `audit` 只收 `actor == request.auth.uid` 且有那四個鍵（`firestore.rules:41-46`），沒登入的 `"unknown"` 寫不進去（R5 也先擋了）。「今天做了什麼」與稽核頁讀的是同樣的 `action`／`before`／`after`；試算表的 `dataAtOf()` 讀最新一則的 `at`（伺服器時間），小工具寫的那一則照樣算數。
- **網頁讀得懂嗎**：存進去的欄位與型別跟網頁存的一模一樣，沒有網頁不認得的格；資料健檢看隨手記的兩項（掛的客戶／那一包還在不在、一組勾得不一樣）：小工具只從 `deletedAt == null` 的客戶名單挑人、一組一個 commit，不會多報。
- **Rules 與索引**：`validNote()` 的型別、長度都過（Android 先過同一支 `validateNote()`）；`listOpen` 用既有的 (deletedAt, done, createdAt desc) 複合索引，`updatedAt` 的範圍查詢、`linkId`／`customers.deletedAt` 的等號查詢用自動的單欄位索引（`firestore.indexes.json` 沒有 `fieldOverrides` 把它們關掉）。

### 五、環境

- **接哪一個 Firebase 只看 flavor，不看從哪條分支建**：`google-services.json` 放在 `src/prod/` 與 `src/staging/`，Google Services 外掛照 flavor 挑那一份（套件名對不上會建失敗）；`WEB_ORIGIN` 也是 flavor 給的。所以從 main 建的 `assembleProdRelease` 一定接正式站、`assembleStagingRelease` 一定接 staging；release 一律 `USE_EMULATOR = false`，只有 debug 帶 `-Pemulator` 才接模擬器（模擬器的 `demo-` 專案碰不到真的服務、明碼只在 debug 開給 127.0.0.1）。
- 派送指令各自寫死 `--app <那個專案的 app id>`、`--project`，App Distribution 會擋套件名對不上的 APK —— 兩支 APK 換錯了會失敗，不會派錯人。兩支名字也不一樣（「（測試）」）。
- **不在白名單上的帳號**：登入完問 `allowedUsers/<uid>`，沒有就登出、記著的 uid 清掉、主畫面講「這個帳號（…）沒有權限，沒有寫任何東西」、小工具換回「還沒登入」；就算這一步漏了，Rules 照樣擋所有讀寫。
- 正式站的網址：兩份 flavor 的 `WEB_ORIGIN` 是 `*.web.app`，跟文件裡寫的正式站網址一致。

### 六、平行合進來的 PR

- **#224（給營養品選到已經約好的那一包 → 改原本那一筆）**：小工具**沒有自己建營養品提醒的路**（`grep entitlementId android/` 只有「讀」）。輸入卡的「給營養品」打開 `#/todo/notes/new/give` → `home.js` 的 `renderNotesLink()` → `openQuick()` → `wireQuick()`，而那一支 #224 已經改成 `createOrMove()` —— 她 11/7 在 HTC 撞到的「給完變兩筆」走的就是這條，修好了。CLAUDE.md「營養品」那一列也寫了「`NotesWriter` 不抄這一支」。情境檔沒有 `createOrMove` 這一題是對的（Android 不抄）；`node scripts/notes-parity.mjs`：「每一題都跟檔案一樣」—— #224 沒有改到任何一題的答案。
- **#210（一次性客人）**：`Customers.kt:37` 只認 `oneTime == true`（網頁 `isOneTime()` 只認 `=== true`）；輸入卡的名字丸子與兩張名單都列他、標「一次性」（`CaptureActivity.kt`、`Floating.kt` 的 `CustomerChips`），網頁 `note.js` 的 `guestTag()` 同一個意思。停用的：輸入卡不濾、選單的「掛給誰」濾掉（`Customers.live()`）—— 跟網頁 `wireWho()`／`askCustomer()`（`active !== false`）一樣。
- **#221 的約定**：兩條網址（`WebLinks.note()`／`newGive()`）情境檔 `links` 盯著、`tests/notes-parity.test.js` 也確認登記在 `views.js`；打名字跳出客戶的比法情境檔 17 題，**以前 `tests/notes-name-suggestions.test.js` 裡的 14 題 `CASES` 一題不少都搬進去了**（另多 3 題：zh-Hant 筆畫排序、最多 6 位、表情符號的 UTF-16 位置）。
  `tests/notes-parity.test.js` **盯的**：網頁每一段每一題的答案＝檔案；`ParityTest` 每一段都有分支；Gradle 讀的是同一份檔案；兩條網址登記了。**沒盯的**：Kotlin 那一側真的過不過（只有 `android.yml`，刻意不設必要檢查，ADR-0180）、`#/todo/notes` 與 `#/customers/:id`（L5）、查詢的形狀與 Rules、`WidgetList`（網頁沒有）、Android 刻意不抄的（`recordDelivery`、`createOrMove`）。

### 七、同步與狀態

- **游標**：只認伺服器的答案時「大於上次最大的 `updatedAt`」不會漏：同一個 batch 同一個伺服器時間、`orderBy` 不加 limit；別台離線記的是連上那一刻的伺服器時間；本機還沒送出的是 null、不推游標。會漏的只剩真刪（L1）。
- **沒登入按 ＋**：帶去登入（R5）；**離線記**：一按就在快取裡、講「存在這台手機上了」、小工具從快取換清單（R3 不會被蓋掉）；**還原備份**：文件寫了登出再登入（R7）；**刪掉的一組**：網頁 `removeRow()` 每一筆都經 `repo.commit()` 帶新的 `updatedAt` → 下一次同步全部拿掉；還原、復原也都經過 `commit()`。
- `WidgetStore` 的檔案寫入與「讀了再改」同一把鎖；`allowBackup="false"`；只放主畫面（`widgetCategory="home_screen"`，不上鎖定畫面）；三個浮動的 activity 都 `exported="false"`。

### 八、跑了什麼

```bash
node scripts/notes-parity.mjs                     # 每一題都跟檔案一樣
node --test tests/notes-parity.test.js tests/notes-name-suggestions.test.js tests/notes-give-bag-once.test.js   # 145 過、0 失敗
node --test tests/no-secrets.test.js              # 3 過、skipped 0（121 個名字）
gh run list --workflow android.yml                # #222 的 PR run ×3、合進 develop 那一次：全綠
```

這個資料夾的兩個檔：

- `scan-public-text.mjs` —— 掃 commit 訊息／PR 內文／diff 裡的真名與 email（只印行號與數字）。先把三份文字放到 scratchpad：
  `git diff 9036614b^1 9036614b > <暫存>/pr222.diff`、`git log --format='=== %h%n%B' 9036614b^1..9036614b^2 > <暫存>/pr222-commits.txt`、`gh pr view 222 --json title,body --jq '.title + "\n" + .body' > <暫存>/pr222-body.txt`，
  再 `node .scratch/final-check-2026-11-07/scan-public-text.mjs <三個檔> | node <主資料夾>/.local/references/redact.mjs`
- `HardDeleteSync.kt.txt` —— L1 的 Kotlin 重現題（怎麼跑寫在檔頭；本機沒跑）
