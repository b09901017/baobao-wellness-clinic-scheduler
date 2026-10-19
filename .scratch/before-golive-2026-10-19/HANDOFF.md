# 交接：上線前補的那一輪（2026-10-19）

分支：`claude/before-golive-1019`（10/19 從 origin/develop `995e9f1` 開）。**這一輪的基準點是 `995e9f1`**（審查那一段從這裡比）。
全貌與她的原話在 `spec.md`；每一支的細節在 `issues/`。流程照 `/kickoff`（`.claude/skills/kickoff/SKILL.md`）的第三、四段。
**她決定等這一輪做完再上線**（「我今天應該會做完」）—— 每一段都不要拖：做完、交開場、停。

## 進度

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 零 | 談、清查過時的 issue（`11b3893`）、開 issue、subagent 過目、照過目改 issue | — | ✅ 10/19 |
| 一 | 01 讀不完整時不存 → 02 健檢超用也長報告＋補額度重算（Blocked by 01）、03 拿掉客戶詳情那一句 | xhigh | ✅ 10/19：01 `ad7e702`；02 `8fb687a`＋收尾 `f767799`；03 `1f87c01`；全量 E2E（CI）見下 |

### 段一做完（10/19 晚，第二個 session）

- **02 收尾**：E2E `76` 改名 `76-incomplete-read-and-extra-exam.spec.js`、加 I3（換回 `ad7e702` 的 `followups.js` 跑過是紅的）；
  合併檔照 `importPlan()` 的形狀在 node 裡跑新舊兩版 `syncFollowupTasks()`：**34 位、差 0 位**（拿掉 `importedFrom` 再跑也是 0 —— 她的資料裡沒有健檢做的比二返額度多的人）；文件四處
- **03**：`describePair()` 刪了，J-D4 改量「報告勾掉之後約二返只有 1 張」＋那一句不在（先紅）
- **全量 E2E**：CI run `39236608315`（`1f87c01`）—— 結果寫在下面「段一全量」那一行
- 段一全量：**六台全綠**（10/19 18:19–18:29，`1f87c01`）
- **`npm run verify` 在這條分支上一律退回全跑**（`repo.js` 跟 develop 不一樣 → 共用底座）—— 本機 34 分鐘、她的電腦會熱。
  段二、段三的日常驗收改成：`npm test` ＋ `CI=1 npx playwright test <這一支改到的那幾支 spec>`，全量照舊丟 CI

### 段一停在哪（10/19 傍晚，額度到八成五收尾）—— 第二個 session 已經全部做完，留著是紀錄

- **01 做完**（`ad7e702`）：issue 01 的「做完時留下的」寫好了。本機跑過 E2E 76、10、02、19、22、25、34、44、65、03 全綠；
  `repo.js` 在 `related.js` 的 GLOBAL，**全量還沒跑** → 段一做完時 `gh workflow run e2e-full.yml --ref claude/before-golive-1019`
- **02 程式做完、單元測試全綠（4979）**（`8fb687a`，commit 標「進行中」）。設計寫在 `docs/adr/0159-an-extra-exam-still-gets-its-report.md`
  （匯進來的超用健檢用 `importedFrom`＋從來沒有過鏈上待辦判；為什麼不用「死線過了」寫在 ADR 裡）。**還沒做的**：
  1. E2E（建議加進 76，檔名改成涵蓋兩支）：簽療程單結掉一次超用的健檢 → 長「追蹤健檢報告」；勾掉 → 長「寄報告給醫師」、不長「約二返」；
     客戶詳情點二返那一筆（`[data-ent="…"]`）改次數 1 → 2 存 → 「約二返」出現（不存任何來訪）。改次數那一張表的欄位是 `[name="totalQty"]`
  2. 合併檔量一次：`.local/references/import-2026-10-19.json` 匯進模擬器 w5，報告／約二返張數改之前（`ad7e702`）與改之後只印數字比（讀 .local 過 `redact.mjs`）
  3. 文件：`CLAUDE.md`「健檢與二返的關係」（補額度會重算、每一條改額度的路都走 `chainAfterEntitlements()`）與「報告到手之後的那一站」（報告不吃二返額度）、
     `SPEC.md` 健檢鏈那一節、`docs/課程與待辦對照表.md`、`docs/常見問題.md`（「健檢超用那一次為什麼沒有約二返」）
  4. issue 02 的 `Status: done` 與「做完時留下的」（要寫：`chainAfterEntitlements()` 回 `{ ops, plan, visits, tasks }`、`data/customers.js` 的 `previewChain()`、
     `data/health.js` 的 `previewFollowupChains()`、`reasonFor()` 多一種「二返的次數不夠」、`tests/consequences.test.js` 一條翻成「講」、
     `tests/followups.test.js` 的上限那一條翻過來、隨機定點多了匯進來的健檢）
- **03 沒動**。照 issue 03 做（`describePair()` 只剩客戶詳情一個呼叫端；`customerDetail.js` 的 `followupLine()` 還在 import 它）
- `public/` 動過，`sw.js` 已經是 v198（01 升的），02、03 不用再升
- 模擬器是從這個目錄起的（`npm run emulators`），可能還開著；換目錄跑要先依 port 停掉
- `issues/11-tomorrow-counts-tomorrows-close.md` 是另一個對話寫的（段三），10/19 傍晚由那個對話 commit 進來（`她答了點下去不開簽單抽屜`）；**段三的開場以這一份 HANDOFF 底下「段三的開場」為準（含 11）**
| 二 | 04 病歷號一格、05 病歷號在畫面上（icon C）、06 照片認人沒病歷號不先勾、07 客戶清單卡片前四個、08 「客戶」被壓成直的；中途發現 12–17 | high | ✅ 10/19 晚：（她回答之後補）18 批次建立一格病歷號；04 `66d6393`、05 `b3c5f05`、06 `35f7829`、07 `9333c5c`、08 `6d1e889`；12 `3bc0970`、13 `514bde6`、14 `408067b`、15 `3f81721`、16 `7c21d97`、17 `d4dc14c`；全量 E2E 見「段二做完」 |
| 三 | 09 拍 Abovee 沒勾的列看得到「勾起來的話」、10 試算表只重畫有變的（＋整份重畫、抬頭病歷號、`SYNC_FORMAT` 8）、11 待辦首頁「明天」也算明天要簽的療程單（她 10/19 另外提的） | high | todo |
| 四 | `/matt-code-review`（從 `995e9f1` 比）、照建議修 | xhigh | todo |
| 五 | 文件總檢查、全量 E2E（CI）、手動驗收清單、PR、合進 develop | medium | todo |

段一先做：01 是她說「好 修」裡唯一會讓資料錯的；02、03 都在健檢鏈那一塊，同一段的腦子。
段二整段是「客戶這一頁」：04 是資料形狀，05–07 都等它；08 是 CSS 小事，順手。
段三的 10 要 04 的 `chartNo`；09 跟別支不搶檔案。

## 編號（先分好）

| 段 | ADR | E2E spec | `sw.js` VERSION |
|---|---|---|---|
| 一 | 0158 讀不完整時不存（推翻 SPEC 第 1 節「寫入排隊重試」對這一種寫入）、0159 健檢超用也追報告（延伸 0139） | 76 | **v198**（第一個動 `public/` 的那一段升，後面的不用再升） |
| 二 | 0160 病歷號是一格（推翻 ADR-0050 的「是一則備註」）＋客戶清單卡片讀前四個（推翻 0156 那一半；可以寫在同一支） | 77 | |
| 三 | 0161 試算表那一側記指紋（延伸 0013）、0162 明天也算簽療程單（推翻 ADR-0152 那一格） | 78 | |

資料健檢新的一項（04）接在 `CHECKS` 最後面 → `health.test.js`、`seed-staff.test.js` 寫死的總數跟著改。

## 過目（subagent）抓到、已經改進 issue 的

唯讀 subagent 逐支對了程式碼；主控自己對過最重的三條（02 的上限是 ADR-0139 的技術選擇、`tests/followups.test.js:1354` 釘著；01 的陣列旗標會被 `.filter()` 弄丟；04 的匯入在 `mergeImport.js` 的 `marksOf()`）。每一支底下「過目改的」那一段就是結果，**跟原本的「做法」衝突時以那一段為準**。重點：

- **02**：拿掉二返總數那一層之後，切換那天匯進來的超用舊健檢會長一出生就逾期的報告 → 要擋；「補一筆二返額度」那顆按鈕走不到超用的人 → 重算掛在改次數、資料健檢 `addFollowup`、刪除／還原額度、加購每一條路上；Blocked by 01
- **01**：data 層自己記「這位最近一次讀是不是快取」、判斷抽成純函式、在 commit 之前判（`PENDING_MS` 8 秒 vs SDK 10 秒）、不給重試鈕；範圍補四處；三個同形狀的（刪客戶、推試算表、匯入判同名）記中途發現
- **04**：匯入沒有 `noteOrder` → 一律 `noteItems()` → `notesFields()`；沒排過順序時病歷號的預設位置要定（建議電話 → LINE → 病歷號）；兩項資料健檢會撞；`noteReorder.js`、`notesEditor.js` 會報錯
- **06**：原因的例子寫錯（同名兩位是 `conflict`／`ambiguous`）；不先勾改 `recognized` 那一層，不改 `photoWantsChecked()`；`sheetConfirm.js:186`
- **09**：不能只組這一位這一天 → 把那一列當成勾起來整張重跑、只讀那一列
- **10**：`notice`、`.gs` 自己的排版版號、沒變的放進 `keep`、每畫一頁存一次指紋、`force` 會被 `push()` 去重吃掉、`today` 那一條判準改寫
- 共通：新的 E2E spec 登記進 `related.js`、新檔案進 `SHELL`；spec.md 拿掉公司名

## 中途發現

（做的時候發現她沒發現的關聯問題或同一個形狀的另一個 bug：哪裡、什麼情境會錯、建議。**不要當場岔出去修**，一段結束時一次列給她問。）

### 段一（01 讀不完整就不存）

**她 10/19 晚答「照建議」**：7、1、6、4、5、8 **她：修**（段二 04–08 之後，issue 12 起；7 最要緊、先做）；2 **她：修，段三跟 10 一起**；3 **她：不修**。

同一個形狀（拿快取裡剛好有的那幾筆當「全部」），01 刻意沒收、過目時就列好的三件：

1. 【她：修】**刪客戶**（`customerDetail.js` 的 `deleteBlockers()`）：網路不穩時快取裡少一筆待確認的來訪 → 「還掛著什麼」沒看到它 → 放行刪除，留下一筆沒有主人的來訪。建議：刪之前用 `listWhole()` 讀，讀不完整就不刪（同 01，一行的事）
2. 【她：修，段三跟 10 一起】**推試算表**（`sheetSync.js` 的 `buildBundle()`）：讀到快取時推的是快取裡的次數 → 試算表少算，下一次推（有網路時）才對。建議：讀到快取就這一趟不推（等下一次寫入再推）；段三的 10 會動同一支，可以一起
3. 【她：不修】**舊資料匯入判同名**（`mergeImport.js` 那一頁）：拿快取的客戶清單判「已經建過了」→ 漏判就重建一位。切換那天她一定在有網路的地方匯，風險低。建議：匯入那一下讀不完整就不開始

做的時候另外看到的（都是**只畫不寫**，所以不會寫錯資料，只會講錯）：

4. 【她：修】**待辦「約二返」那一列的「約了沒」**（`home.js` 的 `loadFollowupBookings()` 與依客戶抽屜那一段）：讀到快取時二返不在手上 → 那一列講「還沒約」，她照著去多約一場（那一段註解自己就說「斷言還沒約會讓她照著去多約一場」）。建議：讀到快取就不畫那一顆
5. 【她：修】**療程單比對**（`treatmentSheets.js` 的 `renderPerson()`）：讀到快取時「簽了沒記」整排假警報。建議：讀到快取就講「讀不到全部，先不比」
6. 【她：修】**客戶改名順手換快照**（`customerDetail.js` 的 `ownSnapshots()`）：讀到快取時漏換幾筆，那幾筆待辦／來訪留著舊名字。建議：同 1，讀不完整就先不改名、講一句
7. 【她：修，最要緊】**資料健檢那幾顆整包寫 `slots` 的修正**（`clearBeds`、`moveBedToRoom`、`trialSlotsToCourse`）：寫回去的是快照那一刻的整包 `slots`、沒有帶 `ifUpdatedAt` —— 快照是快取（舊的）或按之前別台剛改過那一天，按下去會把那一天新的段蓋掉。01 只擋了 recount。建議：這三種也要 `snapshotWhole`，並帶 `ifUpdatedAt`（`repo.commit()` 已經會擋）

段一第二個 session（02 收尾、03）看到的：

8. 【她：修】**改二返的次數，待辦安靜地多一張／少一張**（02 的重算，`customerDetail.js` 改額度那一張表）：那一張表沒有確認框，存完 toast 只講「已儲存」——
   她把二返從 1 改成 2，待辦上多了一張「約二返」，改回去又收起來，畫面上一個字都沒講（資料是對的，ADR-0159 刻意「沒有確認框的路就不講」）。
   建議：存完的 toast 多半句（「已儲存 —— 待辦多一張約二返」），拿 `chainAfterEntitlements()` 回的 `plan` 數；不加確認框（改次數她常改，多一道框煩）

### 段二（04–08、中途發現 12–17）

段二做完的時候自己看到的（**都不急、沒有一條會寫錯資料**，列給她問要不要修）：

9. **批次建立客戶那一頁沒有病歷號那一格**（05 沒加）：那一頁本來就沒有電話、LINE（她當初說「其他的都不用」，`bulkCustomers.js` 的 `customerFor()`）。
   一次建一批的人身上沒有病歷號 → 拍 Abovee 時那幾位都是「名字對上、沒用號碼核對過」→ 不先勾（06）。建議：**不加**，06 存的時候會順手記上；她想一次填就加一欄
   → **她 10/19 晚：「好啊，加一欄」→ issue 18 做了**
10. **E2E 76 I3 有一次 30 秒 `waitForSelector` 逾時**（本機、第一次跑；接著連跑三次都綠）。看起來是那一刻電腦忙（graphify 在背景重建），先記著；CI 的全量有沒有再出現見下面
11. **`ownWhole()`／`listBetweenWhole()` 看的是全域的「這一趟有沒有讀到快取」計數**（`repo.cacheReads()`，13、16）：同一刻別的畫面剛好從快取讀了一筆，也會被算成「這一趟不完整」→ 多擋一次（講「網路不穩」）。
    方向是保守的（多擋不少擋），她網路吃到飽、碰到的機會很小。建議：先不動
    → **她：只有離線時才會出問題的話就先不動**。查過：計數只在讀回來是本機快取時加（app 沒有即時監聽、只有一次性讀取；網路正常時 Firestore 讀伺服器）＝只在離線或網路差到退回快取時才會多擋 → 不動

### 段二做完（10/19 晚）

- 每一支都是：紅燈 → 綠 → 跑改到的那幾支 E2E → 一支一個 commit → `Status: done`、「做完時留下的」。細節在每一支 issue 底下
- 單元測試 5040 全綠；E2E 本機跑過：77（C1–C13，新的）、74、39、75、41、42、43、46、51、53、57、62、65、67、68、70、72、24、02、03、11、19、76
- **合併檔量過**（04）：34 位、34 位的病歷號都進了那一格、短備註裡剩 0 則、其餘 106 則一則不少、資料健檢新舊兩項都 0 位（`.local/references/before-golive-2026-10-19/chart-no-import.mjs`，node 裡跑匯入頁同一支 `planForCustomer()`）
- **10 要接住的**（04 留下的）：`customer.notes` 鏡像少了「病歷號 1234」那一行 → 試算表抬頭那一行補回來，手動貼上那條路（`sheetReport.js:70` 附近）也要；`sheetReport.js` 每位帶 `chartNo` 還沒做
- ADR-0160 寫了五節（一格、認人、搬家、照片認人、客戶清單卡片前四個）；CLAUDE.md「備註那一段」「照片上的人」「健檢與二返的關係」三列補了
- 全量 E2E（CI）：run `39250204880`（`d4dc14c`）—— 95＋…，**一支紅：30 的卡片「整張不可以有電話」**（07 之後備註那一排照她的順序印得出電話 —— 測試改成只看名字那一行與抬頭，`59c265c`）。
  **漏的原因**：本機那幾支 spec 是我手挑的，30 有登記 `customers.js`、我沒問 `related.js`。段三挑 spec 改用
  `node -e "import('./tests-e2e/related.js').then(m=>console.log(m.pick([<改到的檔案>])))"`
- 全量 E2E 第二次（CI）：run `39251950375`（`59c265c`）—— **六台全綠**（10/19 晚）。76 I3 在 CI 上兩次都沒再出現那個逾時

---

## 段一的開場（xhigh）

```
/kickoff 上線前補的那一輪，段一。

分支 claude/before-golive-1019（已經開了、推了沒有看 git status）。先 git fetch，develop 往前走了就 rebase。
先讀：.scratch/before-golive-2026-10-19/HANDOFF.md、spec.md、issues/01、02、03；docs/agents/lessons.md；
CLAUDE.md 的「算次數、驗證、預選額度要拿哪些來訪」「存一筆來訪時手上那一份是舊的」「寫入的等待與失敗文案」
「健檢與二返的關係」「報告到手之後的那一站」「一句『按下去會發生什麼』」那幾列。

這一段做 01（讀不完整時，會動到次數或健檢鏈的存檔先不存）、02（健檢超用也長報告與寄報告、約二返照二返額度、補額度之後重算）、
03（拿掉客戶詳情那一句）。不做 04 以後。

動手前用 grep 找每一個要改的函式的所有呼叫端與畫面上的字（01 尤其：每一個 listByCustomer( 的呼叫端都要看讀回來是不是拿去存）。
中途發現她沒發現的關聯問題，先記進 HANDOFF 的「中途發現」、繼續做別的。
編號：ADR 0158、0159；E2E spec 76；sw.js v198。

每支：先寫紅燈測試 → 綠 → npm run verify → 一支一個 commit → Status: done、「做完時留下的」。
做完：HANDOFF 進度、中途發現一次列給她問、段二的開場（high）貼給她，停。
```

## 段二的開場（high）

```
/kickoff 上線前補的那一輪，段二。

分支 claude/before-golive-1019。先 git fetch、git pull（段一做完的在上面），develop 往前走了就 rebase。
先讀：.scratch/before-golive-2026-10-19/HANDOFF.md（段一做完了的與中途發現）、spec.md（icon C 的 path、她說「她一樣在備註阿」）、
issues/04、05、06、07、08；docs/agents/lessons.md；CLAUDE.md 的「備註那一段的順序、長備註」「照片上的人是 app 裡的哪一位」
「打字找客戶的框」「新增一個會寫進稽核的欄位」「畫面上一段常駐的說明」「一顆小圖示按鈕的觸控區」「資料健檢那一頁的版面」那幾列。

這一段做 04（病歷號一格：資料、認人、匯入時轉、資料健檢搬家）→ 05（表單、備註丸子 icon C、排序、搜尋、同號提醒）→
06（照片認人：名字對上、app 那一位沒有病歷號 → 不先勾、她勾了存時記上）→ 07（客戶清單卡片照她的順序前四個）→ 08（「客戶」被壓成直的）。
不做 09、10、11。HANDOFF「中途發現」裡標了「她：修」的，在 04–08 之後照一支 issue 的規矩做（issue 編號從 12 起，先 grep 會不會牽連別處）。

04 匯入時轉那一段要拿她的合併檔量一次（.local/references/import-2026-10-19.json，模擬器 w5 命名空間，只印數字；讀 .local 一律過
node .local/references/redact.mjs）。測試與 issue 裡的病歷號一律 1234／4321。
編號：ADR 0160；E2E spec 77；sw.js 段一升過就不用再升（v198）。

npm run verify 在這條分支上一律退回全跑（repo.js 跟 develop 不一樣）—— 不要在本機跑全量：日常是 npm test ＋
CI=1 npx playwright test <改到的那幾支 spec>，段二做完時全量丟 CI（gh workflow run e2e-full.yml --ref claude/before-golive-1019）。
模擬器可能還開著（從這個目錄起的）；換目錄跑要先依 port 停掉。
用 python 改檔要 newline='' 或用 Edit 工具：這台的 python 文字模式會寫成 CRLF，heredoc 會吃反斜線（lessons 十一）。

每支：紅燈 → 綠 → 驗收 → 一支一個 commit → Status: done、「做完時留下的」。
做完：HANDOFF 進度、中途發現一次列給她問、段三的開場（high）貼給她，停。
```

## 段三的開場（high）

```
/kickoff 上線前補的那一輪，段三。

分支 claude/before-golive-1019。先 git fetch、git pull，develop 往前走了就 rebase。
先讀：.scratch/before-golive-2026-10-19/HANDOFF.md、spec.md、issues/09、10、11；.scratch/followup-and-products/issues/08（8/27 的回答，
「手機記指紋」那一支不照做，理由在 issues/10）；docs/agents/lessons.md；CLAUDE.md 的「拍 Abovee 記很多段」「畫面上一段常駐的說明」
「試算表的 SYNC_FORMAT」「試算表要讀哪些來訪」「試算表的註記」那幾列。

這一段做 09（拍 Abovee 點開沒勾的列看得到「勾起來的話」）、10（試算表那一側記指紋、只重畫有變的、沒變的只改產生時間、
設定頁「整份重畫」、抬頭那一行加病歷號、SYNC_FORMAT 8）、11（待辦首頁「明天」也算明天要簽的療程單，點下去不開簽單抽屜；推翻 ADR-0152 那一格）。
HANDOFF「中途發現」第 2 條（推試算表讀到快取就這一趟不推，她：修）跟 10 一起做 —— 動的是同一支 sheetSync.js 的 buildBundle()
（同一個形狀段二做了五次：13–16 的 `ownWhole()`／`listWhole()`／`listBetweenWhole()`，照抄那一套）。
10 也要接住段二 04 留下的：`customer.notes` 鏡像少了「病歷號 1234」那一行 → 抬頭那一行補回來（自動推與手動貼上兩條路都要，lessons 一），
`sheetReport.js` 每位帶 `chartNo`（`chartNosOf(c)[0]`：那一格與還沒搬的短備註都認）。

10 改了 .gs：她要重貼 staging 與正式各一次 —— 寫進手動驗收清單與 docs/STAGING.md。能抽成純函式的 .gs 邏輯在 node 裡測。
編號：ADR 0161、0162；E2E spec 78。

npm run verify 在這條分支上一律退回全跑：日常是 npm test ＋ CI=1 npx playwright test <改到的那幾支 spec>，段三做完時全量丟 CI。
「改到的那幾支」不要手挑（段二手挑漏了 30）：node -e "import('./tests-e2e/related.js').then(m=>console.log(m.pick(['public/js/…'])))" 問一次。

每支：紅燈 → 綠 → 驗收 → 一支一個 commit → Status: done、「做完時留下的」。
做完：HANDOFF 進度、中途發現一次列給她問、段四的開場（xhigh，/matt-code-review 從 995e9f1 比）貼給她，停。
```

## 段四的開場（xhigh）

```
/matt-code-review 995e9f1

這一輪是「上線前補的那一輪」（分支 claude/before-golive-1019）。先 git fetch、git pull。
Spec 軸讀 .scratch/before-golive-2026-10-19/spec.md 與 issues/01–10（每一支的「她要的」與「判準」、「做完時留下的」）。
照建議修（每一條：紅燈 → 綠 → verify → commit），提過沒改的寫理由進 HANDOFF。用量到八成先收尾、寫「段四停在哪」。
做完給她段五的開場（medium）。
```

## 段五的開場（medium）

```
/kickoff 上線前補的那一輪，段五（收尾）。

分支 claude/before-golive-1019。先 git fetch、git pull。讀 HANDOFF.md 全部。
做：文件總檢查（CLAUDE.md 連動表補這一輪新長出來的關係、SPEC、CONTEXT、操作手冊、常見問題、STAGING.md 重貼 .gs、README 開發狀態表）、
全量 E2E 丟 CI（gh workflow run e2e-full.yml --ref claude/before-golive-1019）、手動驗收清單（她照順序點得到的路，自己在模擬器走過）、
PR 開向 develop（推之前看一眼：公開 repo，一個真名、病歷號都不帶）、CI 全綠合進 develop、HANDOFF 記合進去的 commit。
進 main 不在這一段 —— 她說了才做（她要切換：先進 main，再照 .local/references/cutover-2026-10-14/ 的清單切）。
```
