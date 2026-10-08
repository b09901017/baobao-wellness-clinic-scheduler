# 上線前修正（接 10/8 的上線前健檢）

2026-10-08。分支 `claude/prelaunch-fixes-2026-10-08`（從 `claude/prelaunch-audit-2026-10-08` 開，＝ develop `a84820d` ＋ lessons 那一個 commit）。
**一支 PR 進 `develop`**（她選的：全部一起修完、一起上 staging）。

## 從哪裡來

10/8 的全域健檢只查不改，產出都在 `.local/references/audit-2026-10-08/`（不進版控，裡面的腳本會讀真資料、只印數字）：

- `report/data.mjs`：18 張「上線前要先修」（`mustFix`）、8 題決定（`decisions`）、13 步上線順序（`goLive`）、上線後再修（`later`）
- 七區報告 `{ai,merge,sheet,rules,master,ops,ux}/report.md`，重現腳本是同一個資料夾的 `r*.mjs`（從 repo 根目錄 `node` 跑）
- `docs/agents/lessons.md`：十種一再犯的坑。**每一支動工前掃一遍**

**18 張有腳本的，10/8 開這一輪時整批重跑過一次，全部還重現得出來。** 每一支動工前還是照它自己的「重現」那一行再跑一次（前面幾支可能已經動到同一支檔案）。

## 她的回答（逐字，報告的「複製回報」）

> 上線前健檢 10/8 回報
> ・人員的全名要怎麼放？ → 人員多一格「簡寫」，顯示改成全名、簡寫照你設定｜我最希望的是顯示名是全名，人員多一格簡寫，並且要有一支小工具可以幫我先預設好所有人的簡寫(就是現在的顯示名)以及把 21 位全名一次填進 staging 和正式站的「Abovee 上的寫法」，但是可以匯入合併檔或是載入種子資料的時候一並更新上去，就是不知道能不能不要寫進公開的程式碼，但是可以放入資料庫之類的，或是放在合併檔一起匯入也可以
> ・健檢和二返一起排好時，「追蹤健檢報告」「寄報告給醫師」要不要照樣長？ → 照樣長（報告那一張也不受「約好二返」影響）
> ・你在 staging 上調好的主檔，要不要帶到正式站？ → 不帶：正式站從種子開始，我自己重新調｜所以種子資料要幫我檢查好寫好喔，要確定有符合目前的所有更新優化內容
> ・「剩幾次」那幾行，要不要改成「有在用的排前面」？ → 改：有做過或排過的排前面，同一組裡再照剩得少的排
> ・拍照 AI 那兩個小實驗要不要做？ → 做
> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單
> ・這樣的順序可以嗎？ → 可以
> ・哪幾件要先給你看做法、再動手？ → 全部一次做完，不用先問我｜不用給我看但能不能請你自己開一個subagent去過目，可以後直接實作
> 不過你寫完Issue自己subagent過目完後，你可以分段實作，可以分幾段實作以及單獨一段matt-code-review(或是你自己判斷怎麼分)，主要是我怕這個session的上下文太多會讓你的實作被上下文汙染，也希望可以用不同effort的session去完成(像是matt-code-review我可能就希望用xhigh單獨完成，或是你有其他建議像是matt-code-review可以和那些一起都可以)，所以你可以自己分任務
> 並且必須在每次任務完成後後給我一段給新session的開場讓他繼續接手

她另外寫的「不要做」：

> - 「上線那天的順序」裡的事：部署正式站、部署 Function、在正式站匯入、改正式站的主檔 —— 我說了才做
> - 我在決定 1 或決定 3 選了要你寫小工具的話：工具放 `.local/`、不進 repo，先寫好、先跑一次只看不寫的模式給我看，我點頭才真的寫
> - 決定 5 選了「做」的話：考試會花我的錢，跑之前告訴我要考幾張
> - 人員全名不進 repo；不連正式站

## 23 支 issue

| # | 是什麼 | 來源 | 段 |
|---|---|---|---|
| 01 | 匯入進行中再按一次，全部客戶多建一份 | `f-import-twice` 🔴 | 一 |
| 02 | 匯入失敗重試雜事多一份；確認框不講對不到主檔與跳過幾位 | `f-import-retry` | 一 |
| 03 | 備份檔與金鑰檔在 repo 最外層不被擋；真名掃描少 27 位 | `f-backup-ignore` | 一 |
| 04 | 程式檔快取一小時；部署沒排隊；本機預設指向正式站 | `f-deploy-cache` | 一 |
| 05 | 讀取卡片看不到客人的警示 | `f-card-flags` | 一 |
| 06 | 壓表「記好了 [復原]」蓋住「下一位」 | `f-undo-toast` | 一 |
| 07 | 刪掉的客戶還留在壓表牆上、排得進新來訪 | `f-deleted-on-wall` | 一 |
| 08 | 「剩幾次」有在用的排前面 | 決定 4 | 一 |
| 09 | 拍 Abovee 只拿 180 天的來訪算剩幾次 | `f-abovee-180` 🔴 | 二 |
| 10 | 兩張照片去重：少記一段或記兩次 | `f-abovee-pages` 🔴 | 二 |
| 11 | 已經記過的兩種形狀再拍一次被當成新的 | `f-abovee-again` | 二 |
| 12 | 醫療禁忌／超用／撞時間的提醒收在列裡 | `f-abovee-warn` | 二 |
| 13 | 左半張切到一半的診間蓋掉右半張的 | `f-abovee-room` | 二 |
| 14 | 同一張訂購單拍兩次建出兩套方案 | `f-order-twice` | 二 |
| 15 | 健檢＋二返先約好，報告那兩張整條不長 | `f-report-task` ＋ 決定 2 | 三 |
| 16 | 改課程「壓哪幾個系統／寫紀錄」，談定的來訪不跟著變 | `f-course-systems` | 三 |
| 17 | 試算表「取消 Abovee」那一行日期寫成今天 | `f-sheet-cancel` | 三 |
| 18 | 試算表剩 −1 不變紅 | `f-sheet-overuse` | 三 |
| 19 | 人員多一格「簡寫」，顯示名是全名 | 決定 1 | 四 |
| 20 | 合併檔 v6：全名跟著合併檔進來，不進 repo | 決定 1 | 四 |
| 21 | 種子檢查好、寫好（正式站從種子開始） | 決定 3 | 四 |
| 22 | 拍照 AI 兩個小實驗 | 決定 5 | 五 |
| 23 | 上線文件三處錯 ＋ 這一輪的收尾 | `f-docs-golive` | 五 |

分段與每一段給新 session 的開場在 `HANDOFF.md`。

## 我替她做的選擇（她說不用先問；審查的 subagent 看過）

### 決定 1：全名怎麼進資料庫 —— 走合併檔，不寫直接打資料庫的工具

她的原話兩條路都接受（「可以放入資料庫之類的，或是放在合併檔一起匯入也可以」）。選合併檔：

- 全名只活在 `.local/references/staff-names.json`（`{ "<現在的顯示名>": "<全名>" }`），`merge.mjs --staff-names` 把它帶進合併檔的 `staff` 那一段；合併檔本來就只在 `.local/`、本來就有真名
- 匯入頁用 app 自己的寫入路改主檔（有驗證、有稽核），**staging 與正式站是同一個動作**（ADR-0118：staging 是預演）
- 不需要正式站的金鑰，也不多一個「漏打 `--project` 就上正式」的指令（lessons 九）
- 她要的「先看不寫」＝匯入頁的摘要卡在按「開始匯入」之前就列出「N 位會改成全名、原本的名字變成簡寫」
- 代價：合併檔升 `baobao-merge/v6`。原本留給「HRV 那 7 次」的那一支（`.scratch/course-form-and-sheet-2026-10-06/issues/18`，還沒開工、她說了才開）順延成 v7，20 做完時要去那一支補一句

**匯入不再怕改名**：`resolveAssignments()` 對人員多比一格簡寫，所以「先改名還是先匯」哪個順序都對得到（健檢量到的 58 段留空就是這個）。

顯示：照診間那一套（ADR-0079）—— 日／週那一列、讀取卡片、試算表的 `二返(…)` 印簡寫，其餘印全名；沒填簡寫就退回全名。種子一個字都不用改（種子的 `name` 就是她口述的叫法，改名之後它變成簡寫）。

### 決定 2：報告那一張的條件

兩件事分開問：

- **要不要追報告** ＝ 健檢那一段做完了，而且這一次健檢的二返**還沒做完**（沒約、或約了還沒做）
- **要不要約二返** ＝ 照舊問 `owed()`（還欠幾次）

「二返已經做完」的舊健檢不可以因此長出報告那一張 —— 切換那天匯進來的全是這種。

### 決定 3：種子

正式站的主檔不是空的（多半是 9/16 那一代的種子），她那天走的路是「資料健檢由上往下按完」。所以要檢查的是兩件：
今天的種子本身逐格對得上現在的程式；「舊一代主檔＋按完資料健檢」收斂到今天的種子。
她在 staging 調過的東西如果是**不帶人名的設定**（某門課的系統、時長、診間…），值得寫回種子 —— 那要先唯讀比一次 staging 的主檔，工具放 `.local/`。

### 決定 4：排序

`有做過或排過（done ＋ booked > 0）的排前面 → 同一組裡剩得少的排前面`。二返一律最後不變；客戶詳情那一份「還有剩的排前面」「健檢與二返相鄰」兩層不變。

### 決定 5：要考幾張

答案卷 40 張：訂購單 24、療程單 13、Abovee 2、文宣 1。

- 實驗一（Abovee 解析度超高）：2 張
- 實驗二（訂購單＋療程單中等思考）：37 張

合計 **39 張照片**。要拿來比的「現在的設定」那一份分數如果不能沿用舊的（13 會改 Abovee 的提示詞；訂購單與療程單的提示詞 9/17 之後改過的話也是），同一批要再考一次，**最多 78 張次**。健檢報告估的「兩個加起來不到台幣 30 元」是各考一次的價錢，兩次就是不到 60 元。**跑之前把實際張數與估價再跟她講一次，她點頭才跑。**

## 連動清查（從 `CLAUDE.md` 那張表出發，再 grep 實際依賴的模組）

| 要動的 | 實際依賴它的地方 | 會怎麼受影響 |
|---|---|---|
| 匯入頁 `run()`（01、02、20） | `ui/views/mergeImport.js`、`data/legacyImport.js` 的 `importPlan()`、`domain/mergeImport.js`、`tests/save-guards.test.js`（只掃 `withSaveState`，看不到這一頁） | 三支都改同一個 `run()` 與同一個確認框：照 01 → 02 → 20 的順序做，後面的建在前面的上面 |
| `.gitignore`、真名掃描（03、20） | `tests/no-secrets.test.js` 的 `realNames()`、`docs/STAGING.md` 還原那一節的範例路徑、`CLAUDE.md` 寫的 `.gitignore` 行號 | 20 加的人員名單也要進掃描名單 |
| `firebase.json`、`.firebaserc`、`deploy.yml`（04） | 每一條沒帶 `--project` 的 `firebase` 指令（`package.json`、`scripts/`、`docs/STAGING.md`、`.github/workflows/`）、`sw.js` 的抓檔方式 | 預設專案改成 staging 之後，靠預設值上正式的指令會改上 staging —— 要逐條確認正式那幾條自己帶著 `--project` |
| `visitReadHtml()`（05） | 四個畫面五個呼叫端：`calendar.js:932`、`customerDetail.js:1842`、`home.js:1248`／`:2220`、`progress.js:357` | 少傳客戶的那一頁會**安靜地不畫**。`flagsUi.alertChips()` 現在只有壓表與待辦用 |
| toast 讓位（06） | `app.css:4429-4437`、`--toast-lift`、壓表的 `[data-deck]`、E2E `24-layout-reach`（F1–F4）、`22-bulk-cancel`、`39-new-customer-form` | 只有量位置看得出來（9/10 那次掃 CSS 字串的測試綠著、畫面照樣蓋住） |
| 壓表那一批的名單（07） | `scheduling.js` 的 `mergeIntoQueue()`、`schedule.js:433` 退回只有名字的一列、`:2114` 的 `addSlot()`、牆上的三個數字（抬頭、篩選、卡片） | 濾掉之後分母要一起少；還原那位客戶之後要回得來 |
| `customerPools()` 的順序（08） | 吃順序的：客戶清單卡片的前 4 行（`customers.js:344`）、`customers.js:301`（`.find()` 取同名第一筆）、壓表牆的泡泡（`schedule.js:1044`）、待辦中心「壓表登記」那一列（`scheduling.js:635-665` → `home.js:3697`）、`scheduling.js:245-254` 的 `lead`（`?? pools[0]` 那個退路）。不吃順序的：`slotOptions.js:70`（之後由 `arrangeSlotOptions()` 重排）、`scheduling.js:491/580`（只讀合計）。客戶詳情走另一支 `sortPools()`。營養品在 `scheduling.js:159` 就跳過了 | 兩支排序要講同一句話（共用一個比較）；`lead` 換了一筆的話客戶之間的排名不可以跟著動；`CLAUDE.md`「額度那一排的順序」那一列寫著「快用完的排前面」要跟著改 |
| 拍 Abovee 讀哪些來訪（09） | `aboveeConfirm.js:118-132`（`listBetween`）、`:834`（存檔前才 `listByCustomer`）、`schedule.js:370/379/683`、`aboveeImport.js` 的 `readAbovee()`／`pickOption()`、`visits.js` 的超用提醒 | 兩種需求不一樣：**算次數**要這位客戶的全部來訪、**撞期**要那幾天全部客戶的來訪。只換其中一份 |
| 拍 Abovee 去重與「已經記了」（10、11） | `aboveeImport.js` 的 `mergeAboveePhotos()`、`existingAt()`、`crossCheck()`、`mergeRows()`、`flagMoved()`、`absentFromPhoto()`、`summarizeAbovee()`；`consequences.js` 的 `aboveeConsequences()` | 列的身分一改，「app 有、這次照片上沒有」與抬頭的數字都跟著動；每一支都拿同一份列 |
| 拍 Abovee 的提醒（12） | `aboveeConfirm.js:337-371`、`:521`、`aboveeConsequences()`、`tests/tip-red-lines.test.js`、ADR-0104 | 要先有 09（次數對了提醒才對） |
| 抄字的合併規則與提示詞（13） | `aboveeImport.js:47/134`、`functions/transcripts/` 與 `public/js/domain/transcripts.js`（兩份要一模一樣）、`functions/lib/fakeModel.js` | 提示詞改了要重考（併進 22）；staging 的 Function 要重新部署才吃得到（部署前先問她） |
| 訂購單同一位的兩張（14） | `orderForm.js:357-405`、`blockersOf()`、`ui/components/orderConfirm.js` | 同一個月真的買兩次的那條路不可以多一道 |
| 報告鏈（15） | `followups.js` 的 `syncFollowupTasks()`／`stationFor()`／`owed()`／`claimedExams()`／`keepsOpen()`、`data/visits.js` 的 `followupOps()`／`previewTaskChange()`／`followupOpsAfterTaskChange()`（都直接叫 `syncFollowupTasks()`，規則改了自動跟上）、`consequences.js:499` 與抽屜補讀的東西（`home.js:3326-3335`）、`docs/課程與待辦對照表.md:95`、ADR-0022／0042／0065／0068／0106／0112、`CLAUDE.md`「報告到手之後的那一站」 | 第一圈現在同時決定「追報告」與「約二返」：**只拆「長出來」那一側**；「留著」那一側 ADR-0068 已經做完，不動。抽屜那一句要多讀這位客戶的來訪與任務才算得出來 |
| 改課程回頭重算待辦（16） | `masterList.js:1431`、`taskRules.js` 的 `syncTasksForVisit()`／`newRegistrations()`／`registrationClosed()`／`cancelTasksFor()`／`recordSlots()`、`data/visits.js` 的 `taskOps()`（私有）、`listByStatus()`、`data/tasks.js` | **只寫任務、不存來訪**（`save()` 會換 `updatedAt`、重算次數、多一則稽核）；長的那一側從還開著的來訪出發、收的那一側從還沒勾的任務出發；取消類不可以因此多長；過了那一天的不長（ADR-0113）；勾過的不動（ADR-0106）；一次寫很多筆（lessons 三） |
| 試算表待辦那一行（17） | `sheetReport.js:155/520/615/921`、`todoFlow.js` 的 `taskLine()`、兩條路（`sheetSync.js` 自動、`report.js` 手動） | 只有 `taskBlocks()` 拿沒濾過的來訪；次數矩陣照舊只吃濾過的 |
| `.gs` 的上色（18） | `sheets/readonly-report.gs:262`、沒有額度的列「應有／剩餘」是一槓（字串）、`tests/sheet-script.test.js` | `'' <= 0` 與 `null <= 0` 在 JS 是 true —— 一定要先問是不是數字 |
| 人員的名字（19、20） | 印人名：`calendar.js:584`（日／週列，名字在 `domain/calendar.js` 那一側組）、`:1613`（讀取卡片）、`visits.js:1658/1947`（錯誤與撞期）、`visitEditor.js:1386-1388`、`schedule.js:1225`、`aboveeConfirm.js:512`、三個入口的治療師／醫師丸子、`bulkCancel.js`、`sheetReport.js:642/645/821`。比名字：`abovee.js` 的 `staffFrom()`／`aliasWrites()`、`mergeImport.js` 的 `byName()`／`resolveAssignments()`、`health.js` 的 `checkSeedStaff()`、`masterData.js` 的 `validators.staff()`、`audit.js` 的 `FIELD_LABELS`、產檔那側 `merge.mjs` 的 `therapistOf()`／`residualNames()`（讀的是種子的名字，不受影響） | 改名之後：資料健檢不可以又叫她建一位、拍 Abovee 全名要直接認得（現在全名只在 `aboveeNames` 裡比）、撞期與確認框講的名字要是她認得的那一個 |
| 種子（21） | `CLAUDE.md`「`domain/seed.js` 加一筆、改一格」那一列列的全部；記憶 `seed-change-fallout-checklist` 的七個地方 | 每一個改動配一列資料健檢；改了人員／課程名／診間寫法要拿真檔照基準比一次 |

## 這一輪用到的編號

- ADR 從 **0137** 起，**照做的順序拿號**（會補 ADR 的有 08、12、15、16、19＋20；08 在段一，所以它先拿）
- E2E spec 從 **61** 起；**一段一支新的 spec**（少開幾次模擬器），登記進 `tests-e2e/related.js`
- `sw.js`：`v186`。一支 PR 一個號 —— 第一個動到 `public/` 的 commit 升，之後不再升；加了新檔案要進 `SHELL`
- 合併檔 `baobao-merge/v6`（20）
- `SYNC_FORMAT` 不動（17、18 都不改 app 送出去的形狀）

## 這一輪不做

- 報告的 `later` 那一區（畫面減負、試算表小地方、療程單年份、文件其餘過時處），除了跟某一支 issue **同一行**的順手修（各支裡有標）
- 上線那天的 13 步：部署正式站、部署 Function、在正式站匯入、改正式站主檔
- 直接連正式站的任何工具
