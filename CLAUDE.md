# CLAUDE.md

專案的完整需求背景、資料模型、業務規則與名詞表在 `SPEC.md`。動工前先讀。

## 文件分工

同一件事只寫在一個地方，其他地方用一行連結指過去。

| 檔案 | 只放 |
|---|---|
| `SPEC.md` | 需求、資料模型、業務規則、畫面規劃 |
| `CONTEXT.md` | 詞彙表。定義詞是什麼，不放實作 |
| `docs/adr/` | 為什麼這樣決定。一支一個決定，寫理由不寫作法。慣例見 `docs/agents/domain.md` |
| `docs/legacy/` | 舊系統的結構，唯讀參考 |
| `docs/操作手冊.md` | **怎麼操作 app**：核心動線一步一步，給沒看過的人。**一條業務規則都不定義** —— 規則一律用一行連結指回 `SPEC.md` 或 ADR |
| `docs/常見問題.md` | 「我按了 X 為什麼沒有 Y」。每一條三段：看到什麼、為什麼、怎麼辦 |
| `docs/邊界測試清單.md` | 上線前要親手點過的極端情境。**刻意沒有 happy path** —— 那些由 `tests-e2e/` 盯著 |
| `docs/STAGING.md` | **怎麼操作**兩個環境：第一次設定、推 Rules、加白名單、種假資料、還原演練、上線檢查表。為什麼這樣設計不寫這裡（那在 `.scratch/PRODUCTION_AUDIT.md`） |
| `.scratch/<feature-slug>/issues/` | 待辦的 issue，不使用 GitHub Issues。動工前先看有沒有相關的，格式見 `docs/agents/issue-tracker.md` |

寫新文件前先確認這件事還沒被寫過。

## 上線

`main` 上正式，那裡有真客戶資料。`develop` 上 staging，那裡是假資料。

**PR 的基底是 `develop`，不是 `main`。** 直接 PR 進 `main` 等於這段程式沒有在
staging 上被點過 —— 只有急件這樣做。

第一次設定、部署指令、白名單、種假資料、還原演練都在 `docs/STAGING.md`。

**真實客戶姓名與健康資訊一個字都不能進版控** —— 不只 `docs/`，註解、測試、`.scratch/` 的 issue、`.claude/` 的 skill 全都算。例子一律寫「客戶A」，規則跟名字的字數有關時用假名（王小明）。`tests/no-secrets.test.js` 盯著。

她自己的 `.xlsx`／`.ics`／截圖放 **`.local/references/`**（`xlsx/`、`ics/`、`images/` 三格）。`.gitignore` 第 57 行的 `/.local/` 擋著，驗證方式是 `git check-ignore -v <路徑>` —— **擋沒擋住從畫面上看不出來**，所以每次新開一個資料夾都要真的跑一次。不要另外開名字：多一個要記得加進 `.gitignore` 的地方，漏掉一次就是真實客戶健康資訊進了版控。

## 容易漏掉的連動

| 改了這個 | 一定要一起檢查 |
|---|---|
| `/domain` 的業務規則 | `SPEC.md` 對應章節。推翻既有決定就補一支 ADR，不要改掉舊的 |
| `public/` 底下任何檔案 | `public/sw.js` 的 `SHELL` 清單與 `VERSION`（測試只盯清單，不盯版號） |
| 做完一個開發步驟 | `README.md` 開發狀態表打勾 |
| 新增集合、欄位、要排序的查詢 | `firestore.rules` 要開洞（預設全拒），`firestore.indexes.json` 要補索引 |
| 客戶身上的標記 | **永久限制有兩層**（ADR-0074）：警示在 **`config/clinicalFlags`**（每一個字自己挑顏色與填法）、其餘是自由輸入。**合作機構是另一個欄位**（`customer.partners`，ADR-0076）—— 它不是限制。三種的畫法只寫在 `ui/components/flags.js`（`alertChips()` 給卡片牆那一排、`detailChips()` 給看得完的那四頁、`partnerChips()` 兩邊都畫），壓表卡片牆與待辦的「壓表登記」共用（ADR-0046）。客戶身上存的是**字串不是 id**，所以主檔改名不會搬既有客戶 —— 那是刻意的（ADR-0002），改名的人要自己去客戶身上重選 |
| 器材上那一欄「要特別提醒的狀況」 | **它不擋任何東西**（ADR-0074）。它決定「她選了這一台的時候要不要跳一句」，而那一句由 `domain/contraindications.js` 的 `noticeSentence()` 算（建議改用哪一台也是算出來的）。**那幾個字也要在警示主檔裡**才畫得到客戶身上 —— 少了就是「客戶身上打了那個字、卡片牆上什麼都沒有」，資料健檢有一列在盯 |
| 一段來訪要選哪一台復能器材 | 那一段**算哪一個課程由器材決定**（ADR-0075）：`domain/visits.js` 的 `courseForEquipment()` 是唯一的推導，`picksEquipment()` 是「要不要記器材」的閘門（擇一池一律要，不管推出來的是哪個課程）。兩個入口（壓表、來訪編輯器）共用 —— 各寫一次會出現一邊寫「復能」一邊寫「ILIB」的資料 |
| 一段來訪的狀態、或它算不算數 | **時段才是原子單位**（ADR-0081）。五種狀態都在 `slot.status` 上，讀一律走 `domain/visits.js` 的 `slotStatus()`（沒有那一格就退回整筆，舊資料一個字都不用改）。整筆那個 `status` 是**推導出來又存起來的**（`visitStatusFrom()`）—— 索引、Rules、試算表、備份四個地方讀它，所以改了時段一定要重推，資料健檢有一列盯著。次數走 `slotOutcome()`，取消的那一段回 `null`（＝不佔次數）。「哪幾段還算數」只有一支 `isLiveSlot()`，掛號／紀錄／療程單／後果說明全部走它。**`bookingSystemsForVisit()` 刻意不濾** —— 整筆取消時每一段也是 cancelled，濾掉就一張「取消 Abovee」都長不出來，有測試釘著 |
| 一段來訪在畫面上叫什麼 | 只寫在 `domain/naming.js` 的 `slotName()`。**「她自己看」那一種的順序是品項 → 器材 → 課程**（營養點滴印那天打的品項，2026-09-08）—— `master` 是三份（`courses`、`equipment`、`ivProducts`），少帶一份那一頁的點滴就會寫「營養點滴」而別頁寫「雪」，有測試盯著六個組 master 的地方。**全站只有三種名字**（ADR-0078）：額度是「當初買了什麼」（`復能-三選一(30)`，另一支算）、`short` 是「那天做了什麼」（`SIS(30)`，月曆／日週那一列／讀取卡片／來訪編輯器抬頭都是它）、`line` 是貼給客人的那一句（`復能`、`靜脈雷射`），一個器材字都不寫（ADR-0077）。**「一般」那一種（`復能(SIS)`）2026-09-08 拿掉了** —— 認不得的情境退回 `short`，不要吐空字串。器材主檔兩格名字：**全名是她叫它什麼**（額度讀它）、**別稱是月曆那一格的縮寫**（月曆讀它）。`slot.courseName` 是**快照不是顯示名稱**。設定 → 名稱怎麼寫 |
| 一筆額度叫什麼 | `domain/entitlements.js` 的 `poolName()` + `timedLabel()`，格式是 `復能-三選一(60)`／`復能-SIS(60)`（**單買一台也帶著課程，後半是器材的全名**，ADR-0078；半形括號、破折號兩邊不留空格）。它跟 `slotName()` 是**兩件事**。改格式要同時補 `legacyPoolNames()`，不然資料健檢的「復能額度還叫舊名字」認不出既有那幾筆，而她自己打的名字**不可以**被一顆按鈕改掉 |
| 一段來訪要指派誰／哪裡 | 只寫在 `domain/visits.js` 的 `assignsFor()`（ADR-0079）。**擇一池還沒挑器材時它回 `null`** —— 那時候「要治療師還是治療室」沒有答案，兩排都不畫、留一句話；挑一個預設值就是那個 bug 本身。壓表與來訪編輯器兩個入口共用，畫欄位與組時段也走同一支。**畫面不可以自己比 `course.assigns`**，有測試盯著。三條規則：復能三台要治療師、營養點滴／EECP／ILIB 要治療室、A 類一律選得到醫師（`picksDoctor()`），其餘都不用 |
| 診間的名字、簡寫或清單 | **全名與簡寫是兩格**（ADR-0079）：月曆、日／週那一列、讀取卡片印簡寫（`.8`、`vip5`），其餘印全名，判斷跟課程與器材同一支（`nameOf()`）。**沒有床位這一層了** —— `roomSlots()` 一間一個選項，但時段上的 `bed` 欄位留著（既有來訪畫得出來），而 `conflictWarnings()` 的 `sameRoom` 一行都不要動。「常用診間」（`preferredRoomIds`）**是順序不是限制**，跟 `allowedRoomIds`（硬限制）是兩個欄位，排序只寫在 `orderedRoomsForCourse()` |
| 一筆來訪的讀取卡片要畫哪幾段 | `domain/visits.js` 的 `slotsToShow()`（ADR-0080）。**沒指定就是全部** —— 另外三頁列的本來就是整筆來訪；指到一個不存在的段落也退回全部（畫成空的比畫太多糟）。日／週那一列的 `data-open` 是 `visit:<id>:<第幾段>`，四個接線的地方走同一支 `parseOpen()`，有測試盯著沒有人自己 `split` |
| 試算表的註記 | **有兩種，而且不可以塞進同一個陣列**：二返走 `followupNotes`、「這一天用了哪一台」走 `equipmentNotes`（只有得選的擇一池才有）。`.gs` 把 `followupNotes` 全部畫在同一列，同一個 `dateIndex` 後面的會蓋掉前面的，而一位客戶同一天做了健檢又做了四選一是會發生的 |
| 方案的微調 | 只寫在 `ui/components/planTweak.js`（**三個入口共用一張**）。改次數（0 就是不要那一項）＋ 加一項，而「加一項」開的是 `ui/components/buySheet.js`。**範本一個字都不會變**（ADR-0003）。寫入一律走 `data/customers.js` 的 `entitlementWrites()` —— 三條路（加一筆、加一批、建新客戶）同一段身體，另外寫一支的話那幾筆健檢就會少掉二返 |
| 次數的算法 | `domain/entitlements.js` 的 `counts()`（現算）、`summarize()`（讀快取）、`reconcile()`（對帳）要一起改，見 ADR-0004。「這一段算不算」只寫在同一支的 `slotOutcome()`，見 ADR-0025 |
| 營養品的形狀或交付 | 一次購買一筆（金額＋好幾款＋幾個月），規則只在 `domain/products.js`，見 ADR-0059。**提醒是一筆有日期的隨手記**（所以它自動在日曆的「待辦」那一類，不要開第八種顏色），交付記在額度的 `deliveries[]` —— 隨手記會被她清掉，而那份紀錄要進試算表。四個勾隨手記的入口共用 `ui/components/note.js` 的 `prepareToggle()` |
| 試算表的 `SYNC_FORMAT` | `sheets/readonly-report.gs` 的 `SUPPORTED_FORMAT` 要一起改，**而且她要回 Google 試算表重新貼一次並重新部署** —— 對不上的話 app 照樣推、`.gs` 整包拒收，而畫面上看起來跟推好了一模一樣。`tests/sheet-script.test.js` 盯著兩邊 |
| 「她賣了什麼給客戶」的那張表 | 只寫在 `ui/components/buy.js`。**新增一排丸子一定要加進 `DETAIL_CHIPS`** —— 沒加的那一排只有客戶詳情那一張表會跟著改名，另外兩張換了丸子名字不動（「其他…」那一格漏了兩次就是這個形狀）。**三個入口共用一份**：客戶詳情的「加購」、新增客戶的「加一項」、批次建立「微調」面板裡的「加一項」——欄位與**接線**（`wire()`）都是同一份，呼叫端只回答「哪一塊要重畫」。多接一次的代價已經付過了：「其他…」那一格漏了兩次。**營養品是一筆排不進來訪的額度**（ADR-0057），所以它不可以流進任何「還要排幾次」：閘門在 `domain/entitlements.js` 的 `schedulable()`，用在 `customerPools()`、`summarize()`／`lowRemaining()`、資料健檢的「資料過期」、來訪編輯器的額度丸子。試算表報表刻意**有那一列但不進合計** |
| 一筆來訪改得動的地方 | **只有日曆**（ADR-0056），日曆上的長按選單也算在那一個入口裡。待辦中心、客戶詳情、進度追蹤那三張讀取卡片都沒有鉛筆，來訪紀錄那一列也不是連到編輯器的連結 —— 留一條繞過去的路，等於那個決定只做了一半 |
| n返（三返、四返…）的形狀 | 它**不是額度**：時段的 `entitlementId` 是 `null`，靠 `followupNth` 與 `followupForVisitId` 站得住（ADR-0063）。規則只在 `domain/nthFollowup.js`，**不要寫進 `domain/followups.js`** —— 那一支是二返的，而「二返一個字都不動」是這件事唯一站得住的理由。判準：**這一行會不會讓一筆二返的資料被算成 n返，或反過來？** 兩個入口（壓表、來訪編輯器）共用 `nthSlotFields()` 組時段；換掉那顆丸子時 `followupNth` **一定要清乾淨**，不然那一段會同時帶著額度與返數。**名字只在快照上**（它借二返那個課程），所以 `slotName()` 看到 `followupNth` 填過就讀 `courseName` 不讀主檔 —— 讀主檔的話日曆上一段三返會印成「二返」 |
| 健檢與二返的關係 | 只寫在 `domain/followups.js`（配對、還欠幾次、那條鏈上的三種待辦）。不要在 `taskRules.js` 或 UI 裡再判斷一次，見 ADR-0022 |
| 報告到手之後的那一站 | 它是**兩張**不是一張：寄報告給醫師、約二返，死線一樣（ADR-0065）。**「寄報告」走在 `owed()` 那道閘門外面**（`syncFollowupTasks()` 的第二圈）—— 擠進第一圈的話，她一約好二返 `owed` 就掉到 0，還沒寄出去的那一張會被**靜默收掉**。`taskRules.js` 的 `CHAIN_KINDS` 要有它；`data/visits.js` 的 `chainKinds` 刻意沒有 |
| 任務有兩個時機 | `acceptsNewTasks()`（客人確認後，掛號那一族）與 `acceptsRecordTasks()`（那一場做完後，紀錄那一族，ADR-0066）。**`tasksForVisit()` 刻意不看狀態、`recordTasksForVisit()` 刻意看** —— 前者同時被拿來比對「哪些還該留著」，跟著狀態變的話來訪一結案她還沒做完的 Examine 就會被靜默收掉；後者相反，那一場沒做完就沒有東西可以寫。「寫紀錄」逐**課程**不逐類別（`course.needsRecord`） |
| 備忘錄編輯那張卡的版面 | 「掛課程」與「掛機構」收在**同一行**（`hangHtml()` 的分段切換，2026-09-08）—— 兩排各自一個標籤加一排丸子是四行，而那兩行正是把「存起來」擠出畫面的原因。切換**只換 `hidden` 與 `aria-selected`**，兩個 hidden input 都留在 DOM 裡：拿掉節點的話她切一下就把掛好的課程清光了。卡片裡**除了內文那一格，每一項都 `flex: none`**（`.pbcard--edit > *`），內文是唯一的 `flex: 1 1 0`。少一條那一項就會被 flex 壓扁 —— `.emojirow` 被壓成 2px、textarea 被壓回 `min-height` 都發生過，而症狀是「東西在那裡但看不到也捲不到」。高度由 `.pbdeck[data-editing]` 給死，**不要用 JS 撐 textarea 的高度** |
| 要貼給客戶的那幾句話 | **字**在 `domain/messageTemplates.js`（預設值）與 設定 → LINE 回覆模板（她改過的），**算變數**留在 `domain/messages.js`。條件判斷（一次來訪只講第一段、前一天就說明天、沒有課程名就整段消失）**不要搬進模板** —— 那只有 `{}` 一種語法，寫不出條件。加一則要同時改：`TEMPLATES`、產生它的那一支、觸發它的那一頁 |
| 一句「按下去會發生什麼」 | 只寫在 `domain/consequences.js`。**它只能講真的會發生的事**（ADR-0070）——「拿回來」那一道的後果由 `data/visits.js` 的 `previewTaskChange()` 算，跟真的會寫下去的 `followupOpsAfterTaskChange()` **共用同一段身體**，不要照著規則在畫面上再推論一次。拿回一張待辦**從來不會動到任何一筆來訪**，寫一句「會取消已約好的二返」是假話，而嚇錯一次之後真的該停的那次她也不會停 |
| 一種課程會長出哪些待辦 | 對照表在 `docs/課程與待辦對照表.md`。改了 `taskRules.js` 或 `followups.js` 的規則要回去改它 —— 確認框上的每一句話都是照那張表寫的，表沒列全警示就會漏 |
| 一筆來訪的讀取卡片 | `ui/views/calendar.js` 的 `visitReadHtml()`，**四個畫面共用**（日曆、客戶詳情、待辦中心、進度追蹤，ADR-0018、0056）。哪幾段畫得出來走 `slotsToShow()`（ADR-0080）。「這一場的待辦」那一塊在裡面，所以四頁一起長；備忘錄那一塊接在**外面**，只有日曆有。那一塊**只給看不給勾** —— 一個 `<input type="checkbox">` 都不可以有 |
| 勾掉一張待辦 | 走 `data/tasks.js` 的 `setDone(tasks, done)`，**收的是任務本身不是 id**。健檢鏈那兩種（追蹤健檢報告、約二返）會連著把下一站算出來，跟勾選寫在同一個 commit 裡 —— 規則仍然只在 `domain/followups.js` |
| 任務什麼時候產生 | 只寫在 `domain/taskRules.js` 的 `acceptsNewTasks()`（客人確認之後才長，見 ADR-0027）。UI 上講這件事的四句文案要跟著改：壓表那一頁兩句、確認動線的提示、客戶詳情沒有任務時那一句 —— 畫面在講一件不會發生的事，比沒講還糟 |
| 匯入的來訪要建成什麼狀態 | 只寫在 `domain/mergeImport.js` 的 `statusFor()`（依匯入當下的日期，不是產檔的日期，見 ADR-0029）。`domain/legacyImport.js` 寫死的 `done` 是對的：它只餵給 skill，狀態一律在匯入那一刻重判。**舊資料只有合併檔一條路進得來**，貼試算表那條 2026-08-23 拿掉了，見 ADR-0047 |
| 行事曆匯進來的雜事是哪一類 | 產檔那側的 `classifyEvent()` 出**建議**（休假／待辦／行事備註），app 那側 `domain/mergeImport.js` 的 `eventKind()` 讀它、`ui/views/mergeImport.js` 讓她逐列改，**她改的那一個才算數**。待辦寫進 `notes`（就是掛日期的隨手記，ADR-0044），另外兩種寫進 `events`。判錯休假的代價最不對稱 —— 那幾天會整片排不進去 —— 所以寫了同事名字的一律退回行事備註 |
| 匯入時哪些候選預設勾起來 | 只寫在 `domain/mergeImport.js` 的 `defaultPicks()`（還沒發生的勾、已經發生的不勾，見 ADR-0030）。不要在 UI 或產檔的 skill 那側再決定一次 —— 合併檔裡的 `include` 欄位是描述性的，app 從來沒有讀過它 |
| 客戶自己填的時間 | 表單那一頁在 `public/form.html` 與 `public/js/form/`，**不進 `sw.js` 的 SHELL**（排除清單在 `tests/shell-cache.test.js`）。答案 → 規則 → 原文只寫在 `domain/availabilityForm.js`，而且「產生的原文餵回解析器要得到同一組規則」是有測試的不變量。客戶填的不自動生效，一律先進收件匣，見 ADR-0031、0032、0033 |
| 要拿某位客戶的本輪可用性 | 先問「這是哪一段期間的事」。壓表、時段反查那種**綁月份或綁某一天**的畫面用 `domain/availability.js` 的 `collectionFor()`；待辦中心的「問這輪的時間」、資料健檢那種問「現在」的才用 `currentCollection()`。挑錯的後果是假的「可用 0 天」把人推到排序第一位，見 ADR-0036 |
| 「不能的時間」的畫法或動線 | **一份就是一個月**（ADR-0053）。`components/ban.js` 的抬頭一定要印出月份；「記一次」先問哪個月，已經有的月份不出現在「新增」那一排；既有的那一份不給換月份；改完存檔前要把差異講出來（`describeRuleChanges()`）。既有的重複資料由資料健檢的 `duplicateAvailability` 列出來，**不自動合併** |
| 壓表那一頁的任何互動 | 不要接成整頁重畫。事件用委派、選了什麼只改 `aria-pressed`、只換真的變了的那一塊 —— 她一位客戶要點五六下，重畫的代價是閃一下加捲回最上面，見 ADR-0038 |
| 任何「先看誰」的排序或推薦名單 | 用 `domain/scheduling.js` 的同一組計分，不要另寫一套 —— 同一位客戶在兩個畫面排名不同，她不會知道哪個算數。**兩個例外都在待辦中心，而且都是刻意的**：「問這輪的時間」問的是「先**問**誰」、「壓表登記」問的是「還有**誰**」，兩列都不吃計分也不排序（`customersToAsk()` / `customersToBook()`，見 ADR-0028、0041）。它們是提醒，不是佇列 —— 要決定「先壓誰」是壓表那一頁的事 |
| 來訪狀態的顏色、標籤或符號 | 只改 `domain/visits.js` 的 `STATUS_VIEW`，日曆、客戶詳情、試算表全部讀它。`app.css` 的 `.status-*` 只掛 class，色值全部在 `tokens.css`（淺色與深色兩份都要改，見 ADR-0039）。`tests/visits.test.js` 盯著兩邊對得上。**這一組是全站共用的，不可能只改一頁** |
| 日曆上任何一種東西的顏色 | 要分辨的是**七種**：待確認／已確認／已完成／未到／行事備註／休假／待辦。**色相已經用完了** —— 休假走斜線紋、待辦走方框勾勾記號，都是因為數不夠（ADR-0039、0045）。第八種一律先想「有沒有不用顏色的畫法」。行事備註可以自己挑顏色，色票名單與客戶備註共用 `MARK_COLORS`，但值另有一組 `--evcolor-*`（小圓點的顏色當 11px 的字對比度不夠，見 ADR-0040）；待辦不能挑 |
| 日曆上「待辦」那一類 | 它**就是 `notes` 裡有日期的那幾筆**，不是 `events` 的第三種類別，也不是 `tasks`（ADR-0044、0045）。所以「同步回隨手記」沒有東西要做 —— 沒有第二份資料。任務不上日曆 |
| 備忘錄的內容或它掛到哪些課程 | 規則只在 `domain/playbook.js`。它只有**三個欄位**：標題、掛哪些課程、一大塊字（ADR-0069 把章節、分類、釘選、時機全部拿掉了）。自己浮出來的那一小塊是**整份的前幾行**，**兩個入口共用 `ui/components/playbookHint.js`**（日曆的來訪讀取卡片、待辦的「跟客人確認時間」）。它**綁課程不綁人、不上日曆、勾不掉**，也不產生任何任務（ADR-0067）。`visitReadHtml()` 一個字都不要改 —— 那一支是四個畫面共用的 |
| 隨手記的欄位或那一列的樣子 | 四個地方共用 `ui/components/note.js`：待辦首頁那張卡、右下角泡泡、`#/todo/notes`、客戶詳情。**日曆上的待辦編輯器也是同一支的欄位** —— 長得不一樣會讓她以為是兩種東西。**包住它們的那一層（`.notemeta`）也算共用的一部分**：2026-09-01 之前只有兩個入口包了它，另外兩個裸放，於是那兩邊的丸子貼著輸入框、三排之間一點間距都沒有 |
| `tokens.css` 加一個顏色 | 淺色與深色**兩份都要有**（深色只有一份，在 `:root[data-theme='dark']`，沒有 `@media` 的複本，見 ADR-0055）。`tests/tokens.test.js` 盯著；改主題的 key 或選項時，`index.html` 與 `form.html` 的行內開機腳本要跟著改 |
| 任何一列的長按選單 | 有哪幾顆**只寫在 domain**（`domain/visits.js` 的 `visitActions()`、`domain/notes.js` 的 `noteActions()`、`domain/products.js` 的 `productActions()`），畫面不自己判斷 —— 兩份清單遲早有一份會准一個狀態機不准的轉移，而 Rules 不擋狀態機。**每一顆都要另外有一條點得到的路**，長按是捷徑不是唯一的路，見 ADR-0060。最多六顆（含「先不要」）。來訪那一份收 `slotIndex`：帶了而且那一天不只一段時多一顆「取消這一段」，它的第二條路是來訪編輯器每一段右上角那顆 ×（既有來訪上它是**取消**不是刪掉） |
| 營養品的名字或金額 | `components/buy.js` 的 `commitNewProduct()` 是**存檔前唯一補名字的地方**（三個入口都經過它）；讀的那一側 `itemsOf(e, master)` 要能從主檔認回舊資料的空名字。名字沒了會**同時**弄壞三個東西：顯示名稱、提醒那一句（變成「營養品：營養品」）與交付面板（整片空白）。金額那一格不可以有倍數限制（`step` 要是 1），整數那一條由 `firestore.rules` 定 |
| 稽核或回顧上那一句話 | 只寫在 `domain/audit.js` 的 `describeParts()`（拆成「誰」與「做了什麼」兩半，接起來走 `joinParts()`）。`ui/views/audit.js`、客戶詳情的變更紀錄、`domain/dayReview.js` 都讀它 —— 兩份寫法遲早有一份會漏掉名字或印出疊字（「勾掉某某的某某」就是這樣來的）。**額度與本輪可用性身上沒有名字**，只有路徑上有 id，所以名字由畫面解析後傳 `nameOf` 進來；問不到就不講，不編一個 |
| 一列任務要顯示什麼 | 種類、**來訪那一天**、課程，只寫在 `domain/taskRules.js` 的 `taskLine()`。三個地方讀它：客戶詳情、待辦中心、試算表的 TODO／FINISHED 區。**日期不是死線**（死線是它的前一天，兩個差一天最容易看錯人），也**不要拿死線 + 1 反推**（取消類的任務不是那樣算的）|
| 「今天做了什麼」要多列一種 | 分段只在 `domain/dayReview.js` 的 `STAGES`，**最後一段永遠收得下剩下的**（一則都不可以被丟掉，而且**照人與照流程兩種分組都要成立**）。它是稽核紀錄的白話版，**不可以為了它多寫任何一筆資料**，見 ADR-0062 |
| 任何一個 `type="number"` 或 `type="time"` | **欄位的 `min` / `step` 要跟 domain 的驗證講同一句話。** HTML 的 `step` 從 `min` 起算，所以 `min="1" step="5"` 只收 1、6、11…… 30 存不下去，而**瀏覽器擋在 submit 之前，domain 的驗證跑都沒跑到**。這個坑已經踩過三次（金額 `step="100"`、課程時長、方案項目時長）。「通常是 N 的倍數」寫進 `hint` 不要寫進 `step`。`tests/number-fields.test.js` 掃原始碼、`tests-e2e/specs/17-settings-fields.spec.js` 掃瀏覽器真的看到的屬性 |
| 一段來訪要選哪一款營養點滴品項 | 只寫在 `domain/masterData.js` 的 `ivChoicesFor()`（**壓表與來訪編輯器兩個入口共用**）：買的那一款排第一顆而且預設選好，其餘收在「換一款」後面。**不硬擋** —— 換了只多一句提醒（`domain/visits.js` 的 `assignmentWarnings()`），因為「今天 A 剛好用完先打了 B」是真的會發生的事（ADR-0002；醫療禁忌是全站唯一的硬性阻擋）。已經存進去的錯配由資料健檢的 `ivMismatch` 列出來，不自動改 |
| 「今天做了什麼」的分段 | `domain/dayReview.js` 的 `STAGES`，**由上到下比、第一個對上的算數**，而陣列的順序就是她做事的順序。所以要把一種從別段分出來時，改的是**前面那一段的條件**，不是把新的一段插到前面去（④登記掛號排掉「寫紀錄」就是這樣做的）|
| UI 文案、新的詞 | 用 `CONTEXT.md` 的詞，不要用它標 _Avoid_ 的同義詞 |
| 哪個網址算哪個環境 | 只寫在 `public/js/firebase-config.js` 的 `envOf()`。**模擬器那一份的 `projectId` 要跟三個地方一致**：這裡、`tests-e2e/start-emulators.sh` 的 `--project`、`tests-e2e/fixtures/emulator.js` 的 `PROJECT_ID`。對不上的症狀特別壞 —— fixture 塞進 A 命名空間、app 讀 B，每個 E2E 都是「畫面空的」而且**沒有錯誤訊息**。`tests/env.test.js` 盯著三邊。環境設定與部署指令見 `docs/STAGING.md` |
| `data/backup.js` 的 `exportAll()` 加一個集合 | `scripts/restore-backup.mjs` 的 `SECTIONS` 要跟著加一列，否則還原完會**少一整類資料**，而且要等到她去找那一類東西才會發現（`notes` 與 `events` 已經被漏掉過一次，見那支檔案的檔頭；`playbooks` 是 2026-09-03 加的，兩邊同時加）。`tests/restore-backup.test.js` 盯著兩邊 |
| 寫入的等待與失敗文案 | 只寫在 `ui/toast.js`。**Firestore 的寫入 Promise 離線時既不 resolve 也不 reject**，所以 `catch` 接不到離線 —— 那條路走的是 `PENDING_MS` 的逾時，而它換上的那句話**不可以說「失敗」**（資料已經在本機快取裡，說失敗她會再存一次）。常駐的離線提示是另一件事，在 `ui/net.js` 與殼上的 `.netbar`。`tests-e2e/specs/10-offline.spec.js` 盯著 |
| 一個會建立新資料的按鈕 | `toast.withSaveState()` 要傳 `key`。`tests/save-guards.test.js` 會掃出漏掉的，豁免要寫在它的 `ALLOWED` 裡並附理由 |
| `firebase-tools` 的版本 | 部署 Firestore 那一步**釘在 13**。14 開始會先問 serviceusage「API 開了沒」，而正式專案的服務帳號沒有那個權限 —— 升上去正式環境就 403（Hosting 照樣成功，所以看起來不像版本問題）。要升先照 `docs/STAGING.md` 補 IAM 角色 |
