# 隨手記這一輪 —— 交接

分支：`claude/notes-widget`（11/6 從 `origin/develop` `a4315111` 開）。
checkout：`.claude/worktrees/notes-widget`（段都共用這一個資料夾，一次只有一段在寫）。`node_modules` 已 `npm ci`、CodeGraph 已 `codegraph init`（這條分支自己的索引）。
主控：kickoff 那個 session（2026-11-06）。全貌、她的原話、談定的在 `spec.md`；樣子圖在 `mockups/`。

**分兩支 PR**：網頁那一半（01–05）先合進 develop → staging 部署 → 她在 HTC／三星的主畫面那一顆點（鍵盤那一條只有全螢幕才重現得出來）；
Android 那一半（06–09）在網頁那一支合進去之後，**從新的 `origin/develop` 開 `claude/notes-widget-android`**（同一個 worktree），另一支 PR。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 設計 | grilling 四輪、spec、issue 01–09、subagent 過目 | xhigh | **做完**（11/6） |
| 一 | 04 連在一起（domain／data／Rules／ADR-0178）、05 複製到別天的畫面 | xhigh | 待開 |
| 二 | 01 鍵盤（HTC 接 `chrome://inspect` 實機重現）、02 一排丸子＋首頁給營養品＋長按提示、03 打名字跳出客戶＋掛給誰搜尋、10 給小工具的兩條網址 | high | |
| 三 | `/matt-code-review` 審網頁那一半（01–05） | xhigh | |
| 四 | 照審查修（10）、手動驗收清單（本機模擬器走過）、PR 進 develop、CI 綠了合併；請她在 staging 主畫面那一顆點 | high | |
| 五 | 06 Android 工具鏈、骨架、登入、讀寫＋情境檔（**先問她：SDK 授權條款、Firebase 主控台登記**） | xhigh | |
| 六 | 07 小工具本體、08 輸入卡與選單（**樣子定稿她點頭了才開**） | high | |
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
  這一輪的 ADR：**0178 連在一起的隨手記、0179 原生小工具**、0180 留給鍵盤（要寫的話）；寫之前看 `docs/adr/` 與其他 worktree 有沒有人先拿走
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

## 要她決定的

1. ~~長按選單~~ → 她 11/6 回了（她已經決定的）
2. **段二開頭**：請她把 HTC 開「USB 偵錯」接筆電（設定 → 關於手機 → 軟體資訊 → 連點「版本號碼」七下 → 開發人員選項 → USB 偵錯；接上時手機問「允許 USB 偵錯嗎」按允許）
- ~~樣子定稿~~：主控 11/6 畫好（`mockups/final-1～3.png`、`final-mockups.html`），她回了麥克風與深色（她已經決定的）；選單那一張（final-3 的 6）照重排之後的為準
- **在 app 記的，多久出現在小工具上**（擋段六）：主控 11/6 問她（建議：自己記的馬上；在 app 記的，打開小工具的輸入卡時、或最多 15 分鐘更新一次；要即時就加一支 Cloud Function 推通知，之後再說）
- **段五開頭**：接受 Android SDK 授權條款；在 Firebase 主控台替 staging／正式站登記 Android app

## 每一段的開場

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
