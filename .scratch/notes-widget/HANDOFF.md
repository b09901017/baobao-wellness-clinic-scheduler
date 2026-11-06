# 隨手記這一輪 —— 交接

分支：`claude/notes-widget`（11/6 從 `origin/develop` `a4315111` 開）。
**Android 那一半：分支 `claude/notes-widget-android`**（11/6 段五從 `origin/develop` `6dda1024`〔PR #221 合進去之後〕開，同一個 worktree）。
checkout：`.claude/worktrees/notes-widget`（段都共用這一個資料夾，一次只有一段在寫）。`node_modules` 已 `npm ci`、CodeGraph 已 `codegraph init`（這條分支自己的索引）。
主控：kickoff 那個 session（2026-11-06）。全貌、她的原話、談定的在 `spec.md`；樣子圖在 `mockups/`。

**分兩支 PR**：網頁那一半（01–05）先合進 develop → staging 部署 → 她在 HTC／三星的主畫面那一顆點（鍵盤那一條只有全螢幕才重現得出來）；
Android 那一半（06–09）在網頁那一支合進去之後，**從新的 `origin/develop` 開 `claude/notes-widget-android`**（同一個 worktree），另一支 PR。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 設計 | grilling 四輪、spec、issue 01–09、subagent 過目 | xhigh | **做完**（11/6） |
| 一 | 04 連在一起（domain／data／Rules／**ADR-0179**）、05 複製到別天的畫面 | xhigh | **做完**（11/6；04 `ebc08555`、05 `c86ed1e8`、合 develop `696826bc`；已推） |
| 二 | 01 鍵盤（HTC 接 `chrome://inspect` 實機重現）、02 一排丸子＋首頁給營養品＋長按提示、03 打名字跳出客戶＋掛給誰搜尋、10 給小工具的兩條網址 | high | **做完**（11/6）：02 `c989c592`、03 `f0ea3b51`、10 `347f95c5`、app.css 換回 LF `b4249786`、01 `0bd3750f`（ADR-0181）；CI 全量到 10 是 6/6 綠，到 01 的那一次推完才跑 |
| 三 | `/matt-code-review` 審網頁那一半（01–05、10） | xhigh | **做完**（11/6）：`REVIEW.md` 六條（R1 打字時泡泡還站在鍵盤上面〔要實機看〕、R2 「作用在幾天」三個數字、R3 從已勾掉的複製、R4 資料健檢日子排序、R5 連動表、R6 小的）；**沒有會寫錯資料的、沒有要她決定的** |
| 四 | 照審查修（10）、手動驗收清單（本機模擬器走過）、PR 進 develop、CI 綠了合併；請她在 staging 主畫面那一顆點 | high | **做完**（11/6）：R2＋R3 `89dd186d`、R1 `9114407e`＋`793de84b`、R4 `58a8ec6d`、R5 `66cc8170`、R6 `8c9bca6a`、R7 `97ecf4e6`、R8 `0408b8fa`（查過是舊行為、加護欄）、related.js 三位數 `d626a699`；sw.js v313；**PR #221**（合併 commit 見 PR）；清單在 PR 內文，A 段模擬器走過、B 段等 staging |
| 五 | 06 Android 工具鏈、骨架、登入、讀寫＋情境檔（**先問她：Firebase 主控台登記**；SDK 條款她同意了） | xhigh | **做完**（11/6）：06 `861fab82`（ADR-0180）；兩支 Android app 登記好了（她答「兩個都由你用指令登記」）；HTC 上模擬器那一支記一筆／勾掉、真的 staging 的 Google 登入都驗過；已推，還沒開 PR |
| 六 | 07 小工具本體、08 輸入卡與選單（**樣子定稿她點頭了才開**） | high | **做完**（11/6）：07 `9a54b1cb`、08 `1a698c08`；HTC 接本機模擬器那一支走過（小工具、勾掉＋3 秒拿回來、輸入卡＋注音跳出客戶、選單、複製到別天、拆開、改日期、改掛給誰）；已推，還沒開 PR |
| 七 | 09 派送、裝好兩支、文件、手動驗收草稿 | medium | |
| 八 | `/matt-code-review` 審 Android 那一半 | xhigh | |
| 九 | 照審查修、HTC 上走驗收、PR、合併；HTC 點過她說可以 → 三星裝正式版 | high | |

## 每一段共同的規矩

- **動工前先 `git fetch`**；這條分支落後 `origin/develop` 就 **`git merge origin/develop`、不要 rebase**（rebase 換掉推上去的 commit、之後要強制推，auto mode 會擋）
- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、`spec.md`、這一段那幾支 issue（含前面幾支的「做完時留下的」）、下面「過目抓到的」與「她已經決定的」
- **改一個已經存在的函式、型別或畫面上的字之前**，照 `ripple-check` 列出所有呼叫端、波及範圍與畫面上出現的地方；修完 bug 找同一個形狀的地方。
  **查牽連用這個 worktree 自己的 CodeGraph**（改了檔之後在這裡 `codegraph sync`），照樣跟 grep 對一次；graphify 查主資料夾那一份（`--graph <主資料夾>/graphify-out/graph.json`），**不要在 worktree 裡 `graphify update`**。
  issue 上的行號是 11/6 的 develop，會位移 —— 照函式名找
- **中途發現的事不岔出去修**：記進下面「中途發現」（哪裡、什麼情境會錯、建議），繼續做原本的；段末一次問她。她說要修的，修之前再照 `ripple-check` 查一次
- **同時最多兩個 subagent**
- 一支 issue 一個 commit：紅燈 → 綠 → `npm run verify` → commit → `Status: done` → 「做完時留下的」。**不要每次全跑 E2E**（`CLAUDE.md`「測試怎麼跑」；`E2E_WORKERS=2`，模擬器與 E2E 帶同一個值）
- `public/` 有動：`git fetch` 之後用 `origin/develop` 上 `sw.js` 的 `VERSION` 再加一（11/6 develop 是 `v299`）、重跑 `npm run shell:snapshot`；同一支 PR 裡第二次動 `public/` 再加一；
  **新檔案要進 `sw.js` 的 `SHELL` 與 `tests-e2e/related.js`**（新的 spec 也要登記）
- **平行的一輪**：試算表（worktree `sheet-push-gaps-112028`、分支 `claude/sheet-slot-notes-below`）正在改 `sheets/readonly-report.gs` 與 `tests/sheet-*.test.js`，**已經佔了 ADR-0177**。不碰它的資料夾與分支。
  這一輪的 ADR：~~0178~~ **被試算表那一輪先拿走了**（`claude/sheet-no-freeze` 的 `0178-sheet-nothing-frozen.md`）→ **0179 連在一起的隨手記（段一寫了）、0180 原生小工具**、0181 留給鍵盤（要寫的話）；
  寫之前看 `docs/adr/` 與其他 worktree 有沒有人先拿走（`ls ../*/docs/adr | grep 018`）。`docs/adr/README.md` 索引最後一列常常撞（每一輪都接在最後）：merge 時兩列都留、照號碼排（段一合 develop 時 0178／0179 就是這樣解的）
- **模擬器同一時間只能一組**（所有 worktree 共用 port）：起之前 `netstat -ano | findstr :5000`（與 `emulatorPortsFor` 那幾組）；有人在跑就不要停掉別人的，先問她
- **公開 repo**：真名一律寫王小明／客戶A；commit 訊息、PR 內文推之前自己看一眼（`CLAUDE.md`「上線」）；推之前 `node --test tests/no-secrets.test.js` 要 skipped 0（這個 worktree 不建 `.local` 連結，`tests/helpers/localDir.js` 自己去主資料夾找）；
  讀 `.local` 的一律接主資料夾的過濾網 `| node <主資料夾>/.local/references/redact.mjs`
- **HTC 接的是 staging，畫面上有真名**：從 HTC 截的圖只放 scratchpad（session 結束就沒了），**不放 `.scratch/`、不進 commit、不進 PR**
- 會寫入的驗收在本機模擬器走（`CLAUDE.md`「上線」）；她的筆電不要跑到全滿又放著（Android 建置也是）
- **主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON**
- 整輪的判準：**這一行會不會讓一筆沒有 `linkId` 的隨手記行為跟現在不一樣，或讓一組連在一起的隨手記被列成好幾列、勾不完整、被複製成兩份，或讓小工具與網頁存出不一樣的資料？**

## 她已經決定的

`spec.md`「談定的」全部（四輪，11/6）。另外：

- 打名字跳出客戶**只做在有「掛給誰」的入口**（首頁那張卡、右下角泡泡、日曆待辦編輯器）：客戶詳情那一格固定掛那一位，在那裡點別人等於把這筆從他身上拿走（主控照她「點了就掛給他」的規則推出來的）
- 首頁那張卡當初刻意不放「給營養品」（`.scratch/quick-actions-and-supplements/issues/12`：那一格要最短）—— 她 11/6 要加；一排放得下就不撐長
- **清單上一列＝一組時**（主控 11/6 定，照「她看到一樣東西、按下去就作用在那一樣東西」；告訴她了）：勾／拿回來、改字、掛給誰、**垃圾桶、清掉這 N 筆 → 整組**；
  改日期、拿掉日期、拆開 → **代表的那一天**（選單最上面那一排把那一天標出來）。日曆與三格上一格就是一天 → 照 spec 那張表「只動這一筆」
- **長按選單重排**（她 11/6：「可以但我希望收成『改日期』比較直觀對吧 ? 改成今天 改成某天 改成拿掉日期」）：
  日期那幾顆收成一顆「**改日期**」（還沒有日期的那一筆也叫「改日期」？—— 照她的字一律「改日期」，卡裡的選項看情況：沒日期的沒有「拿掉日期」），點了一張卡：**改成今天／改成某天／拿掉日期**（日曆上「拿掉日期」照舊講成「從日曆拿掉」那個意思，字由段一定、寫進「做完時留下的」）；
  多一顆「**複製到別天**」；連在一起的「**拆開這一天**」放進「複製到別天」那張卡最上面。結果：勾掉／改日期／掛給誰／改文字／複製到別天 ＋先不要（營養品的提醒照舊分流、不給複製）
- **小工具**（她 11/6 看定稿圖）：麥克風**畫成灰的放著**（定稿圖 1 那樣，這一輪點了不會動 —— 點了講一句「語音下一版」或不反應，段六定）；
  **深色／淺色她要自己切換**：「我希望可以自己切換，也許可以長按那個app圖示，捷徑圖示，可以切換?之類的都可以」→ 長按「隨手記」圖示的捷徑（app shortcuts）切換深色／淺色，預設淺色（段六做；要不要多一個「跟著手機」照做起來順不順再說）
- **Android SDK 授權條款她同意了**（11/6 段二，經主控轉達：「可以，下載」）：段二下載 platform-tools（adb）放使用者資料夾、不進 repo；**段五裝開發工具時不用再問條款**（Firebase 主控台登記 Android app 照舊要問）
- **小工具什麼時候更新**（她 11/6 回「好照建議做」，主控轉達）：在小工具上自己寫的（記下、勾掉、改）**存完馬上更新**；**按 ＋ 打開輸入卡時抓一次最新的**；背景用 **WorkManager 定時檢查（最短 15 分鐘）**，只問上次之後改過的（`updatedAt` 大於上次的游標，**刪掉的、勾掉的也要問得到**，小工具才會拿掉它們），沒變只花 1 次讀取；手機睡著時讓系統延後，**不為了準時叫醒手機**。即時推播（雲端小程式＋FCM）這一輪不做（主控記進她的 backlog）。資料層段五補好了：core 的 `NotesSync.pull()`、`NoteStore.listOpen()`／`listUpdatedSince()`（06 的「做完時留下的」）
- **Firebase 主控台登記 Android app**（她 11/6 段五回「兩個都由你用指令登記」）：staging 與正式站各一支、兩把 SHA-1，app id 在 06 的「做完時留下的」
- **段一那兩件照建議**（她 11/6 段一做完時回「照建議」）：已勾掉的隨手記長按不再有「刪掉」，客戶詳情上要刪去隨手記那一頁按垃圾桶（客戶詳情不加垃圾桶）；「複製到別天」的小月曆今天以前的日子點不了
- **App Distribution 與鑰匙備份**（她 11/6 段六做完時回「照建議」，主控問的）：staging 與正式站兩個 Firebase 專案都開 App Distribution、**只加她一位測試者**（不公開；會寄邀請信給她）；release 簽章鑰匙檔與密碼**備份一份到私人 repo `.local`**（只 commit，push 照 `.local` 的規矩由她那邊的自動同步）

## 過目抓到的（設計段，11/6；一個唯讀 subagent 對著程式碼，1、2 主控自己對過）

1. **真名**：spec 與 03 逐字貼的原話裡有她舉例的那位客戶 → 換成王小明（commit 之前就換了）；自己編的全名（03 判準、樣子圖）換成客戶B。**推之前 `tests/no-secrets.test.js` 照樣要跑**
2. **長按選單已經滿了**：`noteActions()` 每一種情境剛好五顆（`tests/notes.test.js:332` 盯著「最多五顆」、`actions.js:173` 上限六顆含「先不要」）→ 加「複製到別天」與「拆開這一天」放不下 → **問她**（要她決定的 1）。ADR-0060 另要兩顆新的都有不靠長按的路 → 05（日曆那張待辦卡）
3. **清單上一列＝一組時，「只動這一筆」講不清**：垃圾桶、清掉這 N 筆、改日期、拿掉日期、拆開，在一列代表一組的地方作用在誰 → 主控定（她已經決定的）
4. **一組一起寫，手上只有一部分**（lessons 二）：日曆一個月、首頁 `listOpen`、客戶詳情一位、小工具快取 → 寫的那一刻照 `linkId` 重讀（只用等號、不用新索引）；離線讀不全照寫（ADR-0158 隨手記不擋）＋資料健檢一項提醒 → 04
5. **照真的變了什麼一起改**：日曆編輯器每次都帶 text／date／who → 跟存之前比，沒變的不寫；改字、改掛給誰的地方講「另外 N 天會一起改」→ 04、05
6. **稽核**：`linkId` 放 `QUIET_IN_SENTENCE` 會讓「只改 `linkId`」那一則退回「修改隨手記」→ 給 `FIELD_LABELS`＋兩句（連到別天／拆開）；「今天做了什麼」的 `collapse()` 已經會收成 ×N，不另寫一句 → 04
7. 04 寫錯：`notes.setDone(id, done)` 收的是 id（物件那一種是 `tasks.setDone`），形狀被 `prepareToggle`、`runAction`、三份 `noteDeps()` 用著 → 已改
8. 「連在一起」改成「同一個 `linkId`、活著的兩筆以上」，不清 `linkId`（刪掉、還原、復原自動對）；`linkId` 用最初那一筆的 id（冪等）；`validateNote()` 擋 `linkId`＋`entitlementId` → 04
9. 一組算 1 漏列的：客戶詳情「N 未處理」、`#/todo/notes` 兩個數字、清掉這 N 筆、首頁那張卡先分組再取四列；垃圾桶還原可能帶回勾法不一樣的一筆 → 04
10. 03：長按的「掛給誰」（`askCustomer()`）是另一份名單、濾掉停用的 → 也加搜尋；選了一包營養品時跳出客戶那一排不出現 → 03；spec「五個入口」改成「有掛給誰的入口」→ spec 已改
11. 01：`overlaysContent` 是全站開關（整頁表單也會受影響）→ 先試 `interactive-widget=resizes-content`、要開只在裝到主畫面時開、整頁表單列進排查；**HTC 開 USB 偵錯＋桌機 `chrome://inspect` 不用 SDK**，用 port forwarding 開本機模擬器、裝到主畫面就能在段二實機重現 → 01
12. **沒有任何網址指得到某一筆、或打得開記一筆並展開給營養品** → 新開 **10**，跟網頁那一半一起出貨（不然 Android 那一支要再一支網頁 PR）
13. Kotlin 要照抄的（新增那一筆的欄位、每次寫 `updatedAt`、`doneAt` 三位毫秒、稽核那一筆的形狀、比對的細節、每把簽章的 SHA-1、開發寫本機模擬器）、CI 另開 `android.yml`、`related.js` 的 `IGNORED` 加 `android/`、`.gitignore`／`.gitattributes` → 06

## 中途發現

### 段一

1. **ADR 用 0179**（0178 被試算表那一輪先拿走了，已推上去）；這一輪往後挪一號：0180 小工具、0181 鍵盤。上面「平行的一輪」那一條改了
2. **已勾掉那幾筆的長按「刪掉」放不下了**：她的五顆（勾掉／改日期／掛給誰／改文字／複製到別天）裡沒有它。刪掉還有：隨手記那一頁每一列的垃圾桶、「清掉這 N 筆」、日曆待辦編輯器的「刪掉」。
   **少掉的只有客戶詳情**：那一頁已勾掉的那幾列沒有垃圾桶，要刪得去隨手記那一頁 → 問她（要她決定的 3）
3. **小月曆上今天以前的日子點不了**（段一定的：替過去的一天補一則提醒會一建好就過了；要補記昨天那一件用「記一筆」）→ 一起問她（要她決定的 3）
4. 樣子圖的小月曆是週日起算、開關畫成滑桿；app 的月曆是週一起算、開關都是 `.choice--row` 的勾選框 → **照 app 的**（不問，寫在 05 的「做完時留下的」）

### 段二

1. **日曆待辦編輯器的 `noteWhoWired` 旗標是錯的**（範圍內、順手修了，02 的「做完時留下的」）：`sheet.update()` 換掉的正是「掛給誰」那一塊，旗標卻留在 `sheet.el` 上 —— 同一張抽屜第二次 mount 時掛給誰一個監聽都沒有。今天的入口每次都開新的抽屜，所以沒有人踩到
2. **`--related` 在這條分支上幾乎一定全跑**：新增一支 spec 一定要改 `related.js`，而 `related.js` 一改 `e2e.mjs` 就改成跟 develop 比 —— 段一動過的 `icons.js` 是共用底座 → 全跑。工具的行為是對的（不問她）；
   段二改成照 `pick()` 的名單手挑摸得到記一筆那一排的那幾支跑、**全量交給 CI**（`e2e-full.yml`，推完跑一次）
3. **`f0ea3b51`（03）把 `public/css/app.css` 整份寫成 CRLF**（主控抓到；Python 改檔沒帶 `newline='\n'`、接縫兩個單獨的 CR → git 當成 -text 不轉）。
   段二另一個 commit 修回純 LF（內容只差 03 那三段 CSS）、`lessons.md` 十一那一條補了這一次
4. **接 HTC 的路（段五照用）**：USB 偵錯接上之後 Windows 把 ADB 介面配了通用的 `winusb.inf`、沒有 ADB 的介面 GUID → `adb devices` 是空的。
   她 11/6 自己裝了 **Google USB Driver**（`Android Composite ADB Interface`），之後 `adb devices` 認得（`CN3813D02586`）。
   無線偵錯走不通：筆電用 HTC 的熱點上網時 HTC 沒有連 Wi-Fi，無線偵錯開不了（三星不在身邊）。
   adb 在 `%LOCALAPPDATA%\Android\platform-tools`（Claude 的沙盒裡實際路徑在 `…\Packages\Claude_pzs8sxrjxfjjc\LocalCache\Local\Android\platform-tools`，PowerShell 用 `$env:LOCALAPPDATA` 找得到）。
   接模擬器：`adb reverse tcp:<port> tcp:<port>`（5000、8080、9099、5001、9199、9150、4400）＋`adb forward tcp:9222 localabstract:chrome_devtools_remote` 用 Playwright `connectOverCDP` 操作手機上的頁面。
   **模擬器的 Google 登入在手機上走轉頁回來會是沒登入**（handler 在 127.0.0.1:9099、app 在 localhost:5000）→ 在頁面裡 `signInWithCredential(GoogleAuthProvider.credential('{"sub":…}'))` 再 `allowUser(uid)`；
   **跑種子／`allowUser` 要帶 `E2E_WORKERS=1`**（settings 的 `E2E_WORKERS=2` 會寫到別組模擬器）
5. 2 個 worker 下 `01` 的 J-E10、`91` 的 N4 各紅過一次（`signIn` 的 `waitForFunction` 20 秒逾時），單獨重跑都綠 —— 跟這一輪無關，記著

### 段三

審查的結果全部在 `REVIEW.md`（R1～R6、查過不成立的、段四手動驗收清單一定要有的）。範圍外的一件：

1. **沒有日期的隨手記，改文字／掛給誰／改日期／複製到別天只有長按一條路**（ADR-0060 要每一顆另有一條點得到的路）：有日期的走日曆那張待辦卡，沒日期的不上日曆。
   改文字、掛給誰在這一輪之前就是這樣（舊缺口），這一輪多了「複製到別天」。標題旁的 `?` 講了長按做得到什麼。**不在這一輪修**，記進記憶的 backlog（第 24 條）

### 段四

1. **`tests-e2e/related.js` 的 `pick()` 只認兩位數編號的 spec**（`/specs\/(\d\d-…)/`）：段二加的 `100-keyboard-layout` 被當成「沒有登記」→ 改到它就全跑、`tests/e2e-related.test.js` 紅（`npm run verify` 第一步就停）。
   範圍內、順手修了（`d626a699`，改成 `\d+-`；全 repo 只有這一處寫死兩位數）
2. **`npm run verify` 在這條分支上照舊全跑 701 支**（related.js 動過 → 跟 develop 比 → `index.html`／`app.js`／`views.js` 是共用底座）。段四照段二的做法手挑摸得到的那幾支、全量交 CI
3. 本機跑 E2E 第一次載入 gstatic 的 Firebase SDK 偶爾 `ERR_SOCKET_NOT_CONNECTED`（`00-smoke` S1、`01-products` J-E1 各紅一次，重跑綠）—— 網路，不是程式
4. **R7、R8 是主控轉達她在 HTC 上新發現的**（記進 REVIEW、放進同一支 PR）。R8 在 HTC 上量過是 staging 還沒有 01 的舊行為（REVIEW 有表），不改 `sheet.js`
5. **用滑鼠把抽屜拖到抽屜外面放開，抽屜會被關掉**（寫 K5 時撞到）：Chrome 把 click 派給按下與放開兩個元素的共同祖先（backdrop），backdrop 被點到就關。
   手指拖（HTC、iPad）不會有 click，所以她碰不到；只有接滑鼠的桌機會。**範圍外、沒修**，記著（要修是 `sheet.js` 拖過之後吞掉下一個 click）

### 段五

1. **2026 的 AndroidX／Compose 要 `compileSdk` 37**（36 編不過）→ 裝了 `platforms/android-37.2`、`compileSdk` 37.2；`targetSdk` 照舊 36。不用她決定
2. **新的指令列工具（v23）把 `sdkmanager` 換成 `android` CLI**，預設會送使用統計 → 一律 `android --no-metrics …`；套件名用斜線（`platforms/android-37.2`），在 cmd 裡分號會被切開。寫進 06 的「做完時留下的」
3. **Write／Edit 會把「反斜線 u」的跳脫寫成真的字**（U+2028 讓 `notesParity.js` 的正規表示式直接語法錯誤；Kotlin 照樣編得過、看不出來）→ 換回跳脫、`lessons.md` 十一補了一條
4. **經過 USB（`adb reverse`）的寫入要 2～5 秒才回到模擬器** → 開發版幾乎每一筆都講「存在這台手機上了」（`FirestoreNoteStore` 等 4 秒）。資料真的寫進去了；段六做輸入卡時看真的網路下要不要留那一句、等多久
5. **HTC 有螢幕鎖**：每一次接上都要她先解鎖（我不能輸入她的解鎖密碼）。段六開頭就請她解鎖；`uiautomator dump` 讀不到這支 app 的字 → 用截圖看
6. **HTC 上現在裝著接真的 staging、登入著的「隨手記（測試）」**（筆電 debug 鑰匙簽的；她自己選的帳號）。裝 `-Pemulator` 那一支會蓋掉它（同一個套件名）；換成段九派送的 release 那一支之前要先移除（寫進 09 了）
7. **release 鑰匙只在她筆電上一份**（`~/.android/baofu-notes-release.jks`）→ 09 放 GitHub Secrets、備份放哪問她（寫進 09 了）
8. **`android.yml` 還沒在 CI 上跑過**：它只在 PR 與推到 develop／main 時跑，手動 `gh workflow run` 要那一支檔案已經在預設分支（main）上 —— 第一次跑是段九開 PR 的時候。本機 `:core:test`、兩個版本的建置都綠；Linux runner 上沒有 platform 37.2 的話 AGP 會自己下載（授權在 runner 上已接受），紅了先看這一條

### 段六

1. **Glance 一個小工具的點擊是一個一個處理的**：第一版在 callback 裡等 3 秒，3 秒內那一下「拿回來」要等劃線結束才輪到它（HTC 上拿不回來）→ 寫入與 3 秒改在 `AppScope` 跑、callback 馬上回（範圍內、修了；07 的「做完時留下的」）
2. **在背景跳 toast 讓整支程式當掉**（不在主執行緒）—— 程式死了小工具停在舊的，Glance 的 log 只寫「Session is not available」，第一次看起來像 Glance 掉了更新。`say()` 丟回主執行緒、`AppScope` 加 `CoroutineExceptionHandler`（範圍內、修了；08）。**同一個形狀**：全 app 只有 `say()` 與 `ThemeActivity`（在 `onCreate`、主執行緒）跳 toast，查過了
3. **裝了新版之後小工具停在轉圈**（Glance 的那一段跟著程式被換掉）→ receiver 收 `MY_PACKAGE_REPLACED` 自己畫一次（範圍內、修了；App Distribution 更新也走這條）
4. **HTC 的螢幕逾時一到就上鎖**，每一次都要她解鎖（段六中途鎖了一次）。不改她手機的設定；跟她說了可以自己在開發人員選項開「充電時保持螢幕開啟」。段七、段九接 HTC 時開頭照樣先請她解鎖
5. **HTC 現在裝的是接本機模擬器的那一支（`-Pemulator`）**，桌面第 2 頁（往右滑一頁）有一個小工具，畫的是模擬器裡的假資料（王小明、客戶B…）、模擬器關了所以底下會講「讀不到最新的」。段七裝 staging 那一支時直接蓋過去（同一把 debug 鑰匙），小工具不用重放
6. **小工具挑選畫面裡的預覽是空白的**（沒有 `previewLayout`／`previewImage`）。Android 12+ 放一張預覽圖她選的時候看得出是什麼 —— 小事，段七順手做或記著
7. `uiautomator`、`adb input text` 打不出中文：改文字那一條沒在 HTC 上走（跟改掛給誰同一條寫入路）；段九她點的時候注意一下
8. 這個 worktree 的 `public/js/ui/views.js` 與 issue 02 一直顯示「已修改」但 `git diff` 是空的（只是檔案時間）—— 沒動、沒 commit

## 要她決定的

- **段二沒有要問的**（中途發現 1–5 都不用她決定）
- **段三沒有要問的**：`REVIEW.md` 六條都照建議修（R1 收起泡泡是 ADR-0181 收導覽列同一個理由；R3 的冪等是寫法、不是她的選擇）
- **段六沒有要問的**（中途發現 1–8 都不用她決定；麥克風點了不反應、捷徑只有一顆「改成深色／淺色」、今天的日期不畫是段六自己定的，寫在 07 的「做完時留下的」）。**要她知道的**：HTC 桌面上那個小工具是接本機模擬器的測試版（假資料），段七會換成接 staging 的
- **段五沒有要問的**（中途發現 1–8 都不用她決定；7 的「備份放哪」留給段九問）
- **段四沒有要問的**（中途發現 1–5 都不用她決定；5 是範圍外的小事，記著）。**要她做的**：staging 部署之後在 HTC／三星主畫面那一顆照 PR #221 內文清單的 B 段點（鍵盤、注音、泡泡、iPad、深色）

1. ~~長按選單~~ → 她 11/6 回了（她已經決定的）
3. ~~段一的兩件~~ → 她 11/6 回「照建議」（她已經決定的）
2. ~~**段二開頭**：請她把 HTC 開「USB 偵錯」接筆電~~ → 段二接好了（中途發現 → 段二 4）
- ~~樣子定稿~~：主控 11/6 畫好（`mockups/final-1～3.png`、`final-mockups.html`），她回了麥克風與深色（她已經決定的）；選單那一張（final-3 的 6）照重排之後的為準
- ~~**在 app 記的，多久出現在小工具上**（擋段六）~~ → 她 11/6 回「好照建議做」（她已經決定的）
- ~~**段五開頭**：接受 Android SDK 授權條款；在 Firebase 主控台替 staging／正式站登記 Android app~~ → 都回了（她已經決定的）

## 每一段的開場

### 段七（effort：medium）

```
這一輪做隨手記：複製到別天（預設連在一起）、打名字跳出客戶、鍵盤蓋住輸入框、原生 Android 桌面小工具。
網頁那一半是 PR #221（已合進 develop）。Android 那一半在分支 `claude/notes-widget-android`（已推、還沒開 PR）：段五 06（工具鏈、登入、讀寫、情境檔，ADR-0180）、段六 07（小工具 `9a54b1cb`）、08（輸入卡與選單 `1a698c08`）。
你是段七：做 09（App Distribution 派送、HTC／三星裝好兩支、文件、手動驗收清單草稿）。不做審查（段八）。

**那兩件她回了「照建議」**（HANDOFF「她已經決定的」→ App Distribution 與鑰匙備份）：兩個 Firebase 專案都開 App Distribution、只加她一位測試者（能用 CLI 做的用 CLI，做了什麼跟她講；主控台非點不可的一步一步寫給她）；鑰匙檔與密碼備份進私人 repo `.local`（在主資料夾，worktree 裡沒有連結、不要建，照 `docs/agents/worktree.md`；只 commit 不 push；`.local` 裡的東西不進主 repo、不印進 log）。不用再問。
接 HTC 之前先請她解鎖（有螢幕鎖、逾時一到又會鎖）。

在 worktree `.claude/worktrees/notes-widget`（同一個資料夾），分支 `claude/notes-widget-android`。先 `git fetch`，落後 `origin/develop` 就 `git merge origin/develop`（不要 rebase）。
先讀：`.scratch/notes-widget/HANDOFF.md`（「每一段共同的規矩」「她已經決定的」「中途發現」段五與段六）；`.scratch/notes-widget/spec.md`「一」；
issue 09，以及 06、07、08 的「做完時留下的」（工具鏈怎麼叫、簽章與 Secrets 的名字、小工具什麼時候更新、`MY_PACKAGE_REPLACED`、HTC 上接模擬器的七步）；ADR-0180；`CLAUDE.md`「文件分工」與「隨手記的形狀或規則（Android 小工具那一份）」那一列；`docs/agents/lessons.md`。

要注意的：
- HTC 現在裝的是 `-Pemulator` 那一支（debug 鑰匙），桌面第 2 頁有小工具。裝接 staging 的 debug 那一支直接蓋過去；換成 App Distribution 的 release 那一支**之前要先移除**（簽章不一樣），移除之後小工具要重放 —— 寫進手動驗收清單
- 小工具挑選畫面的預覽是空白的（段六中途發現 6）：順手補一張 `previewLayout`／`previewImage` 可以，不要擴大範圍
- 文件只寫怎麼操作（`docs/STAGING.md` 加「桌面小工具」一節、`docs/操作手冊.md`、`docs/常見問題.md`、`SPEC.md`、`README.md`）；不寫鑰匙、密碼、真名、她的 email
- 手動驗收清單草稿：她照順序點的路，**寫的人自己在 HTC 上走過**（會寫入的在本機模擬器那一支走；staging 留給她點）；HTC 的截圖只放 scratchpad（staging 畫面上有真名）

規矩（HANDOFF 有全文）：改既有的函式與畫面上的字之前照 `ripple-check` 查牽連；中途發現的事不岔出去修，記進 HANDOFF「中途發現 → 段七」，段末一次問她；同時最多兩個 subagent。
建置：`cd android && JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot" ./gradlew …`（限 4 個 worker；不要放著連跑；做完 `./gradlew --stop`）。
模擬器同一時間只能一組（起之前看 port；收掉時連那兩個 PID 一起停）。用 python 改檔一律 `newline='\n'`，commit 後 `git ls-files --eol` 看是 `i/lf`。
**鑰匙與密碼絕不進 repo、不印進 log**（GitHub Secrets 用 `gh secret set` 從檔案讀，不經過指令列參數）。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：09 一個 commit 並推上去（推之前 `node --test tests/no-secrets.test.js` skipped 0、看一眼 commit 訊息）、`Status: done` 與「做完時留下的」、HANDOFF 更新（分段表、中途發現、要她決定的）、
段八（`/matt-code-review` 審 Android 那一半，xhigh）的開場；最後回覆簡短說做了什麼、卡在哪。
```

### 段六（effort：high）

```
這一輪做隨手記：複製到別天（預設連在一起）、打名字跳出客戶、鍵盤蓋住輸入框、原生 Android 桌面小工具。
網頁那一半是 PR #221（已合進 develop）。段五做完 06（Android 工具鏈、骨架、登入、讀寫＋共用情境檔，ADR-0180），在分支 `claude/notes-widget-android`（已推、還沒開 PR）。
你是段六：做 07（桌面小工具本體，D 半透明便利貼）、08（浮在桌面上的輸入卡、點字跳出的選單）。不做 09。

「在 app 記的多久出現在小工具上」她回了（照建議：自己寫的馬上、打開輸入卡時抓一次、背景 WorkManager 最短 15 分鐘只問改過的 —— HANDOFF「她已經決定的」），資料層已經有 `NotesSync.pull()`，07 照它做。
**第一件事**：請她把 HTC 解鎖、USB 接著（HTC 有螢幕鎖，我不能替她輸入）。

在 worktree `.claude/worktrees/notes-widget`（同一個資料夾），分支 `claude/notes-widget-android`。先 `git fetch`，落後 `origin/develop` 就 `git merge origin/develop`（不要 rebase）。
先讀：`.scratch/notes-widget/HANDOFF.md`（「每一段共同的規矩」「她已經決定的」〔麥克風畫成灰的、深色淺色用長按「隨手記」圖示的捷徑切換、預設淺色〕「中途發現 → 段五」）；`.scratch/notes-widget/spec.md`「一」；
issue 07、08；**06 的「做完時留下的」**（工具鏈怎麼叫、core 那幾支在哪、接模擬器那一支怎麼建、HTC 上接模擬器的七步、驗過什麼）；ADR-0180、ADR-0179；
`.scratch/notes-widget/mockups/` 的 `final-1～3.png` 與 `final-mockups.html`（選單照重排之後的為準）；`CLAUDE.md`「隨手記的形狀或規則（Android 小工具那一份）」那一列；`docs/agents/lessons.md`（十一多了一條：Write 會把反斜線 u 的跳脫寫成真的字）。

規矩（HANDOFF 有全文）：**畫面裡不另寫一份規則** —— 清單分組用 core 的 `Notes.groupLinked()`、選單用 `noteActions()`／`dateChoices()`、寫入用 `Backend.notes`（`NotesWriter`）、
打名字跳出客戶用 `Names.nameSuggestions()`（collator 給 `android.icu.text.Collator` 的 zh-Hant）；營養品的提醒點勾＝打開 `WebLinks.note()`、給營養品＝`WebLinks.newGive()`（`BuildConfig.WEB_ORIGIN`）。
網頁沒有的（小工具的清單順序：今天 → 過了沒勾的 → 沒日期 → 以後的）寫在 core、自己的單元測試；要動網頁也有的規則照 `CLAUDE.md` 那一列（情境檔先加一題、`node scripts/notes-parity.mjs --write`、兩邊都綠）。
改既有的函式與畫面上的字之前照 `ripple-check` 查牽連；中途發現的事不岔出去修，記進 HANDOFF「中途發現 → 段六」，段末一次問她；同時最多兩個 subagent。
建置：`cd android && JAVA_HOME="/c/Program Files/Microsoft/jdk-21.0.12.101-hotspot" ./gradlew …`（限 4 個 worker；不要放著連跑；做完 `./gradlew --stop`）。
會寫入的驗收用 `-Pemulator` 那一支接本機模擬器（模擬器同一時間只能一組，起之前看 port；收掉時連那兩個 PID 一起停），staging 留給她點；HTC 的截圖只放 scratchpad（staging 畫面上有真名）。
三星的毛玻璃要實機試，三星段九才裝（HTC 點過她說可以）。用 python 改檔一律 `newline='\n'`，commit 後 `git ls-files --eol` 看是 `i/lf`。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：07、08 各一個 commit 並推上去（推之前 `node --test tests/no-secrets.test.js` skipped 0、看一眼 commit 訊息）、`Status: done` 與「做完時留下的」、HANDOFF 更新（分段表、中途發現、要她決定的）、
段七（09 派送、裝好兩支、文件，medium）的開場；最後回覆簡短說做了什麼、卡在哪。
```

### 段五（effort：xhigh）

```
這一輪做隨手記：複製到別天（預設連在一起）、打名字跳出客戶、鍵盤蓋住輸入框、原生 Android 桌面小工具。
網頁那一半（01–05、10＋審查 R1～R6）是 PR #221，已合進 develop。你是段五：做 06（Android 工具鏈、骨架、登入、讀寫＋共用情境檔）。不做 07–09。

**第一件事：問她在 Firebase 主控台替 staging／正式站登記 Android app**（套件名稱、每把簽章的 SHA-1 由你先算好給她；用白話講要做什麼、為什麼、做了會怎樣）。
她回答之前先做不需要登記的部分（工具鏈、骨架、情境檔、本機模擬器那一條）。Android SDK 授權條款她 11/6 同意了，不用再問。

在 worktree `.claude/worktrees/notes-widget`（同一個資料夾）：先 `git fetch`，**從新的 `origin/develop` 開 `claude/notes-widget-android`**（不要在 `claude/notes-widget` 上接著做）。
先讀：`.scratch/notes-widget/HANDOFF.md`（「每一段共同的規矩」「她已經決定的」「過目抓到的」13、「中途發現」段二 4〔接 HTC 的路〕與段四）；`.scratch/notes-widget/spec.md`；
`.scratch/notes-widget/issues/06-android-toolchain-and-data.md`，以及 03、04、10 的「做完時留下的」（Kotlin 照抄：`linkId`、`nameSuggestions()` 的比法與 `CASES`、兩條網址）；
ADR-0179、`CLAUDE.md`「隨手記的 `linkId`」那一列（跟小工具的約定，段四補的）；`docs/agents/lessons.md`。ADR 用 0180（小工具）。

規矩（HANDOFF 有全文）：改既有的函式與畫面上的字之前照 `ripple-check` 查牽連；中途發現的事不岔出去修，記進 HANDOFF「中途發現 → 段五」，段末一次問她；同時最多兩個 subagent。
一支一個 commit。Android 建置不要把她的筆電跑到全滿又放著（Gradle 限 worker、估計超過十分鐘先講）。真名不進版控；HTC 接的是 staging、截圖只放 scratchpad。
CI 另開 `android.yml`、`related.js` 的 `IGNORED` 加 `android/`、`.gitignore`／`.gitattributes`（過目抓到的 13）。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：commit 並推上去（推之前 `node --test tests/no-secrets.test.js` skipped 0、看一眼 commit 訊息）、06 的 `Status: done` 與「做完時留下的」、HANDOFF 更新（分段表、中途發現、要她決定的）、
段六（07 小工具本體、08 輸入卡與選單，high；樣子定稿她點頭了才開）的開場；最後回覆簡短說做了什麼、卡在哪。
```

### 段四（effort：high）

```
這一輪做隨手記：複製到別天（預設連在一起）、打名字跳出客戶、鍵盤蓋住輸入框、原生 Android 桌面小工具（後面幾段）。
你是段四：照 `.scratch/notes-widget/REVIEW.md` 修網頁那一半（R1～R6），寫手動驗收清單（本機模擬器真的走過）、開 PR 進 develop、CI 全綠就合併，請她在 staging 主畫面那一顆點。不做 06–09。

在 worktree `.claude/worktrees/notes-widget`（分支 `claude/notes-widget`，已推；最新的是段三的審查 commit）。
先讀：`.scratch/notes-widget/REVIEW.md` 全部（每一條：在哪裡、什麼情境會錯、建議、紅燈測試；最後一節「段四的手動驗收清單一定要有的」）；
`.scratch/notes-widget/HANDOFF.md` 的「每一段共同的規矩」「她已經決定的」「中途發現」；`.scratch/notes-widget/spec.md`；issue 01–05、10 的「做完時留下的」；
ADR-0179、ADR-0181；`CLAUDE.md`；`docs/agents/lessons.md`（一、五、十一、十三）。
建議的順序：R2、R3（domain 的純函式＋紅燈測試）→ R1（CSS 一行＋E2E `100` 加一支）→ R4 → R5（`CLAUDE.md` 連動表；ADR-0181、ADR-0179 還在這一支 PR 裡、直接改那一句）→ R6。
每一條修完在 REVIEW.md 那一條標題底下寫「**段四：修了** —— <commit>（一句怎麼修的）」（樣子照 `.scratch/abovee-confirm-glance/REVIEW.md`）；不修的寫理由。

規矩（HANDOFF 有全文）：動工前 `git fetch`，落後 `origin/develop` 就 `git merge origin/develop`（不要 rebase）。改既有的函式、畫面上的字之前照 `ripple-check` 查牽連
（這個 worktree 的 CodeGraph，`codegraph sync` 後再查，跟 grep 對一次）；修完找同一個形狀的地方。中途發現的事不岔出去修，記進 HANDOFF「中途發現 → 段四」、段末一次問她。同時最多兩個 subagent。
一條一個 commit：紅燈 → 綠 → `npm run verify` → commit。`public/` 有動照規定升 `sw.js` 的 VERSION（段二停在 v307；先看 `origin/develop` 有沒有更大的，同一支 PR 第二次動再加一）並 `npm run shell:snapshot`；新檔案、新 spec 進 `SHELL` 與 `tests-e2e/related.js`。
模擬器同一時間只能一組（所有 worktree 共用 port），起之前先看 port；`E2E_WORKERS=2`，模擬器與 E2E 帶同一個值。全量 E2E 交 CI（`gh workflow run e2e-full.yml --ref claude/notes-widget`）。
用 python 改檔一律 `newline='\n'`，commit 之後 `git ls-files --eol` 看是 `i/lf`（lessons 十一：03 把 app.css 整份寫成 CRLF 過）。

手動驗收清單：照 `CLAUDE.md`「交付時條列一份她可以照順序點的手動驗收清單」—— 她照順序點的路（`首頁 → 隨手記那張卡 → …`），**寫的人要在本機模擬器真的走過**（會寫入的在模擬器走，不在 staging）；
鍵盤、注音那幾條只有 HTC／三星主畫面那一顆點得出來，標明「staging 部署之後、在主畫面那一顆點」。清單放 PR 內文（一個真名都不帶）。
PR：基底 `develop`；推之前看一眼 commit 訊息與 PR 內文沒有真名、`node --test tests/no-secrets.test.js` skipped 0；`gh pr checks` 每一條都綠才合（lessons 十三：不只全量 E2E 那一條）；合完 staging 自動部署。**進 main 要她另外說。**

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：每一條一個 commit 並推上去、REVIEW.md 每一條的「段四：」、HANDOFF 更新（分段表、中途發現、要她決定的）、PR 連結與合併 commit、
段五的開場與 effort（06，xhigh；**開頭先問她在 Firebase 主控台替 staging／正式站登記 Android app**；段五從新的 `origin/develop` 開 `claude/notes-widget-android`，同一個 worktree）寫進 HANDOFF「每一段的開場」；最後回覆簡短說修了什麼、PR、卡在哪。
```

### 段一（effort：xhigh）

```
這一輪做隨手記：複製到別天（預設連在一起）、打名字跳出客戶、鍵盤蓋住輸入框、原生 Android 桌面小工具（後面幾段）。
你是段一：做 04（連在一起：domain／data／Rules／ADR-0178）、05（複製到別天的畫面），照這個順序。不做 01–03、06–09。

在 worktree `.claude/worktrees/notes-widget`（分支 `claude/notes-widget`，從 develop a4315111 開；設計段的 commit 是這一輪第一個）。
先讀：`.scratch/notes-widget/HANDOFF.md` 的「每一段共同的規矩」「她已經決定的」「過目抓到的」；`.scratch/notes-widget/spec.md`；
`.scratch/notes-widget/issues/04-linked-copies-domain.md`、`05-linked-copies-ui.md`（動工前先讀那一節列的 ADR 與檔案）；`CLAUDE.md`；`docs/agents/lessons.md`。

規矩（HANDOFF 有全文）：改既有的函式、型別、畫面上的字之前照 `ripple-check` 查牽連（用這個 worktree 的 CodeGraph，`codegraph sync` 後再查，跟 grep 對一次）；修完找同一個形狀的地方。
中途發現的事不岔出去修，記進 HANDOFF「中途發現 → 段一」，段末一次問她；她說要修的，修之前再查一次牽連。同時最多兩個 subagent。
一支一個 commit：紅燈 → 綠 → `npm run verify` → commit → `Status: done` → 「做完時留下的」。`public/` 有動照規定升 `sw.js` 的 VERSION（develop 是 v299）並 `npm run shell:snapshot`。
ADR 用 0178（0177 被平行的試算表那一輪拿走了）。`linkId` 這個名字 Kotlin（06）會照抄，定了就寫進 04 的「做完時留下的」。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：兩支各一個 commit 並推上去（`git push -u origin claude/notes-widget`；推之前看一眼 commit 訊息沒有真名、`node --test tests/no-secrets.test.js` skipped 0）、
`Status: done`、「做完時留下的」、HANDOFF 更新（分段表狀態、中途發現、要她決定的）、段二的開場與 effort（high）寫進 HANDOFF「每一段的開場」；最後回覆簡短說做了什麼、卡在哪。
```

### 段三（effort：xhigh）

```
這一輪做隨手記：複製到別天（預設連在一起）、打名字跳出客戶、鍵盤蓋住輸入框、原生 Android 桌面小工具（後面幾段）。
你是段三：用 `/matt-code-review` 審網頁那一半（issue 01、02、03、04、05、10），審的範圍是這條分支從 develop 分出來之後的全部（`git merge-base origin/develop HEAD` 到 HEAD）。只審、記下來，不修（修是段四）。

在 worktree `.claude/worktrees/notes-widget`（分支 `claude/notes-widget`，已推）。段一：04 `ebc08555`、05 `c86ed1e8`；段二：02 `c989c592`、03 `f0ea3b51`、10 `347f95c5`、app.css 換回 LF、01（ADR-0181）。
先讀：`.scratch/notes-widget/HANDOFF.md`（「每一段共同的規矩」「她已經決定的」「過目抓到的」「中途發現」段一與段二）；`.scratch/notes-widget/spec.md`；
issue 01–05、10 各自的「做完時留下的」；ADR-0179、ADR-0181；`CLAUDE.md`；`docs/agents/lessons.md`（一、二、五、十一、十三特別相關）。

要特別看的（段二自己知道比較弱的地方）：
- 02 的 `.notemeta` 用 `display: contents`＋`order` 排一排：四個入口（首頁那張卡、泡泡、日曆待辦編輯器、客戶詳情）在 360 寬、選了日期與人、深色主題下的樣子
- 03 的 `wireSuggest()`：注音組字（`compositionend` 在某些鍵盤之後不再發 `input`）、點丸子不失焦（`pointerdown`／`mousedown` 擋預設）、`maxlength` 被換成全名之後超過時怎麼樣
- 03：打字就讀一次客戶名單（以前只有點開「掛給誰」才讀）
- 10：`renderNotesLink()` 的 `history.replaceState` 與 `ui/nav.js` 記的那幾筆紀錄、返回鍵
- 01：`interactive-widget=resizes-content` 是全站的；`html[data-keyboard]` 收起導覽列時 toast 的位置（`--toast-lift`、66px 那一條）、iPad
- 整輪的判準（HANDOFF「每一段共同的規矩」最後一條）

規矩：同時最多兩個 subagent（skill 寫全部同時開也一樣，兩個一批）；找到的先自己讀前後文、能重現就重現，確定是錯而且重要才記；
記進 `.scratch/notes-widget/REVIEW.md`（每一條：哪裡、什麼情境會錯、建議怎麼修、嚴重程度），要她決定的收成一題附建議寫進 HANDOFF「要她決定的」。
不用起模擬器、不接 HTC（段二在 HTC 上裝的本機模擬器版已經移掉、`adb reverse` 拿掉了）。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：REVIEW.md commit 並推上去、HANDOFF 更新（分段表、要她決定的）、段四（照審查修＋手動驗收清單＋PR，effort high）的開場；最後回覆簡短說找到幾條、哪幾條要她決定。
```

### 段二（effort：high）

```
這一輪做隨手記：複製到別天（預設連在一起）、打名字跳出客戶、鍵盤蓋住輸入框、原生 Android 桌面小工具（後面幾段）。
你是段二：做 01（鍵盤蓋住輸入框，HTC 接 chrome://inspect 實機重現）、02（今天／挑日期／掛給誰／給營養品一排＋首頁那張卡加給營養品＋長按提示）、
03（打名字跳出客戶＋「掛給誰」可以搜尋）、10（給小工具的兩條網址）。不做 04–09。

在 worktree `.claude/worktrees/notes-widget`（分支 `claude/notes-widget`，已推；段一的兩個 commit 是 04、05）。
**第一件事**：請她把 HTC 開「USB 偵錯」接筆電（HANDOFF「要她決定的」2 有步驟）；01 要實機重現，不等她接好就先做 02、03、10。
先讀：`.scratch/notes-widget/HANDOFF.md` 的「每一段共同的規矩」「她已經決定的」「過目抓到的」「中途發現 → 段一」；`.scratch/notes-widget/spec.md`；
`.scratch/notes-widget/issues/01-keyboard-covers-input.md`、`02-one-chip-row-and-hint.md`、`03-name-suggestions-and-who-search.md`、`10-web-links-for-widget.md`，
以及 04、05 的「做完時留下的」（**`note.js` 段一改過：長按三個入口共用 `note.openMenu()`、`askCustomer()` 多了第三個參數 `{ also }`、`runAction()` 的日期那幾支換成「改日期」那張卡**）；`CLAUDE.md`；`docs/agents/lessons.md`。

規矩（HANDOFF 有全文）：改既有的函式、型別、畫面上的字之前照 `ripple-check` 查牽連（這個 worktree 的 CodeGraph，`codegraph sync` 後再查，跟 grep 對一次）；修完找同一個形狀的地方。
中途發現的事不岔出去修，記進 HANDOFF「中途發現 → 段二」，段末一次問她；同時最多兩個 subagent。
一支一個 commit：紅燈 → 綠 → `npm run verify` → commit → `Status: done` → 「做完時留下的」。`public/` 有動照規定升 `sw.js` 的 VERSION（段一停在 v302；先 `git fetch` 看 develop 有沒有更大的）並 `npm run shell:snapshot`；新檔案進 `SHELL` 與 `tests-e2e/related.js`。
ADR：鍵盤要寫的話用 **0181**（0178 被試算表那一輪拿走、0179 是段一的連在一起、0180 留給小工具）；寫之前照樣看別的 worktree。
模擬器同一時間只能一組（所有 worktree 共用 port），起之前先看 port 上有沒有人；HTC 接的是 staging、畫面上有真名，截圖只放 scratchpad。

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：每支一個 commit 並推上去（推之前看一眼 commit 訊息沒有真名、`node --test tests/no-secrets.test.js` skipped 0）、
`Status: done`、「做完時留下的」、HANDOFF 更新（分段表、中途發現、要她決定的）、段三（審查，xhigh）的開場；最後回覆簡短說做了什麼、卡在哪。
```

