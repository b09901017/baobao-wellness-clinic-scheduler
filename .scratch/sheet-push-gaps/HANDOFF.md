# 試算表推送的縫：交接

主控 session：worktree `.claude/worktrees/sheet-push-gaps-112028`（平行的幾輪：主資料夾在做第一輪小修，一次性客人在 `claude/one-time-visit-design` —— 都不碰）。
第一輪（01）在主控 session 做完；第二輪（02～04）分兩段；05～07 主控自己做；**第三輪（版面，08～13）分兩段**，見「第三輪」。

## 狀態

| issue | 狀態 |
|---|---|
| 01 推失敗自己再推、回到 app／網路回來／打開 app 補推 | done（PR #201，develop `2267a8bc`） |
| 02 平常推變快：先讀完再寫 | done（`claude/sheet-speed`，rebase 後 `c1a40e9b`） |
| 03 重畫變快：同一種動作收成一次 | done（`881a5935`） |
| 04 兩台同時推：比較舊的那一包不畫（ADR-0174） | done（`6c6ad420`；段二審查小修 `345bb52a`；PR #204，develop `926e5712`） |
| 05 字級（名字 14、註記 9）＋每一步計時；之二：計時寫進 `_data` 的 B1 | done（PR #207 `f42572f9`、#208 `9b8d4356`） |
| 06 重畫時鎖不拆了重上 | done（PR #209，develop `532c1a4d`） |
| 07 用 Google Sheets API 一次讀完每一頁（沒開就照舊） | done（同上） |
| 08 欄寬、分隔、格線、抬頭 | done（`claude/sheet-layout` `e7d05467`；ADR-0175 在這一支） |
| 09 凍結前五欄 | done（`27e3dede`） |
| 10 療程項目照「做最多的在上面」排 | done（`675a76d1`） |
| 11 器材併進那一格、記一句改成那一格的備註 | done（`7cf8bde4`） |
| 12 營養品一筆一行、備註一則一行上色 | done（`40706bb5`；之後一個 commit 補文件與註解、sw v285） |
| 13 用匯出的 .xlsx 驗真的 Google（工具） | done（第三輪段二） |
| 14 版面第四輪：不凍結欄、號碼跟名字一樣大、四欄全白＋窄空白欄、營養品加日期 | done（PR #213；ADR-0176） |
| 15 記一句也疊在日期底下；之二：折行那幾列照字數加高、顏色照日期錯開（`LAYOUT_VERSION` 8） | done（PR #218 `ca7ab83b`；之二 PR #220 `2552dcb9`；ADR-0177）。**版號 8 還沒貼到 staging 驗**（見「第五輪」） |
| 16 什麼都不凍結 | done（PR #219 `b3305c7a`；ADR-0178） |

常見問題「刪整列、還原版本 → 整份重畫」：PR #202，develop `3dd2ee12`。

## 第二輪（02～04）分段

分支 `claude/sheet-speed`（從 origin/develop `3dd2ee12`），同一個 worktree。

| 段 | 做 | effort | 狀態 |
|---|---|---|---|
| 段一 | 02 → 03 → 04 | high | 做完（11/5，`854bd266`） |
| 段二 | `/matt-code-review` 審 02～04、照建議修、開 PR、CI 綠合進 develop、寫她要照順序做的「貼 .gs 到 staging → 看執行紀錄比秒數」 | xhigh | 審查與小修做完、rebase 到 origin/develop（`f5fb7b0a`）；推到新分支 `claude/sheet-speed-2` 開 PR（見「段二」） |

之後（不在這一輪的段裡）：她把新的 `.gs` 貼到 staging 的試算表、重新部署 → 比 Apps Script 執行紀錄改前改後的秒數 → 夠快就貼正式版；
不夠快再談「Google Sheets API 進階服務」（她說多按一個設定沒關係）。

### 段二（審查、小修、她要照順序做的）

**審查**（`/matt-code-review`，起點 `5050997e`，11/5）：
- Spec：沒有問題。審查的人另外把改前（`5050997e`）的 `.gs` 換進 `tests/sheet-gs-batch.test.js` 跑，雜湊跟釘住的一樣（雜湊確實是改前跑出來的）；
  又寫了一串測試沒涵蓋的五步推送（一開始就空著的同名分頁、第一列清掉但別格還有字、`onEdit` 拿掉指紋、整頁清空、分頁被刪、一位不在這一包、整份重畫），新舊兩份每一步整份一樣。
  比較新的那一包不會被當成舊的：只有嚴格比較小才擋；沒帶、看不懂、沒記過都照畫；`force` 只在真的比較舊時擋；畫到一半不記；`restore-backup` 不寫新的稽核、`--wipe` 是軟刪除（`listRecent` 連刪掉的一起讀），還原之後是「一樣」→ 照畫
- Standards：沒有違反文件規定。判斷題照建議修了三條（`345bb52a`）：`renderCustomer()` 拿掉只為一支測試留的「沒給 book 就自己讀」（測試包裝改成整串轉傳）、
  `emptyOf()` → `lastRowOf()`、`.gs` 的 `dataAtOf(body)` → `requestDataAt()`（跟 domain 那一支同名、吃的不一樣）；`sheets/README.md`「升版之後」補「這一次格式沒升也要重貼」。
  沒修的（判斷題、改了風險比好處大）：`entry` 物件四處各自組、`sheetPushTiming.js` 多了組請求的 `pushBody()`、測試與比對腳本各寫一份「推一串拍一張」、替身裡沒人用的 `setProperties`／`getRanges()`
- **`LAYOUT_VERSION` 留 2**（審查指出畫法沒變、規則是畫法變了才加）：留著的理由 —— 替身驗不到真的 Google（合併格的格式、`getRangeList` 的細節），
  萬一有一點不一樣，全部重畫一次比「有的頁是舊畫法、有的是新畫法」好認；而且重貼後第一次推送正好量得到整份重畫的秒數。代價是那一次慢一點
- 修完：`npm test` 5477 過、1 跳過（worktree 沒有 `.local/` 的那一條）；真名掃描用 junction 接主資料夾的 `.local` 跑，3 過 0 跳過；
  正式站那一包 `sheet-gs-compare.mjs` 四步 0 個不一樣、`sheet-gs-calls.mjs` 數字跟段一一樣（平常推 讀 76／寫 36／寫完又讀 0；整份重畫 讀 246／寫 1,498／寫完又讀 34）
- rebase 到 origin/develop `f5fb7b0a`：`docs/adr/README.md` 兩支 ADR 都留；`sw.js` 兩邊都是 v282 → **v283**、快照重跑

**分支換名**：rebase 之後 `claude/sheet-speed` 要強制推才推得上去，auto mode 擋下（Git Destructive）；她選「推到新分支」——
rebase 過的那一份推到 **`claude/sheet-speed-2`**（一般的 push）、PR 從那裡開；`origin/claude/sheet-speed` 停在段一的 `da588134`，不動、不刪。

**她要照順序做的**（PR 合進 develop、staging 自動部署之後）：
1. 打開 staging 那一份 Google 試算表 → 擴充功能 → Apps Script → 左邊「執行作業」：先記下最近幾次 `doPost` 的「持續時間」（改前的秒數；正式站 11/5 是平常推 25–48 秒、整份重畫約 192 秒）
2. 左邊「編輯器」→ 把 GitHub 上 develop 的 `sheets/readonly-report.gs` 整份貼上蓋掉 → 儲存
3. 部署 → 管理部署作業 → 鉛筆 → 版本選「新版本」→ 部署（網址不變，app 不用改）
4. staging 的 app（手機或 iPad）：最上面「有新版本・點一下更新」→ 點（新版 app 才會附上「這一包的時間」）
5. 設定 → 試算表報表 →「立刻推一次」：**這一次每一頁都會重畫**（正常，`LAYOUT_VERSION` 2）—— 回「執行作業」看秒數，這就是新的整份重畫
6. 在 app 改一筆會進試算表的東西（例如某位客戶的短備註），等十幾秒讓它自己推 → 「執行作業」最新那一次的秒數＝新的平常推
7. 設定 → 試算表報表 →「整份重畫」→ 再看一次秒數
8. 翻幾頁試算表，看起來跟以前一樣（名字、顏色、合併的格子、框線、凍結的列、鎖）
9. 夠快 → 正式那一份試算表照 2、3 再做一次（新的 `.gs` 跟還沒更新的 app 也合得來：沒帶時間照畫）；不夠快 → 再談 Sheets API 進階服務

**只在 staging 驗得到**（替身做不出來）：真的快多少；`getRangeList()` 一次帶幾十塊的實際表現；格式先下、之後才合併，Google 合併後是不是照左上角那一格的格式；
先寫值再合併不會跳確認；`getEditors()`／`canDomainEdit()` 擺在改名單之前的順序；真的兩台同時推；剛寫完那一則稽核 `at` 回 null 的頻率（null → 照畫不記，最壞跟以前一樣）。

**段末要問她**（主控來問）：「中途發現」1 —— 試算表每一頁的字現在全是 11 號（名字本來想 14 號、註記列本來想 9 號小灰字，都被最後那一行蓋掉）。
要不要讓名字變大、註記變小？建議：要（改 `finish()` 那一行、`LAYOUT_VERSION` 3，下一次推送每一頁重畫一次；可以等這一次的秒數量完再做）。

### 量的工具

`node scripts/sheet-gs-calls.mjs <整包.json>`：用測試的替身數一次推送讀幾次、寫幾次、寫完又馬上讀幾次（只印數字）。
正式站 11/5 那一包在主資料夾的 `.local/references/試算表健檢-2026-11-05/bundle-pushed.json`（在這個 worktree 裡是 `../../../.local/...`；**有真名，結果只印數字**）。
改前（develop `3dd2ee12`）：都沒變 讀 143／寫 46／寫完又讀 38；整份重畫 讀 619／寫 6,506／寫完又讀 276。
段一做完（`854bd266`）：都沒變 讀 76／寫 36／寫完又讀 **0**／文件屬性 35 → 1；整份重畫 讀 246／寫 **1,498**／寫完又讀 **34**（數法在 `tests/helpers/countGsCalls.js`）。

`node scripts/sheet-gs-compare.mjs <改前的.gs> <整包.json>`：兩份 `.gs` 跑同一串推送（第一次、都沒變、一頁變了、整份重畫），逐格比值、格式、合併、框線、欄寬、列高、凍結、鎖、指紋，只印數字。
改前那一份：`git show 3dd2ee12:sheets/readonly-report.gs > old.gs`。正式站那一包四步都 0 個不一樣。

`node scripts/sheet-xlsx-verify.mjs <匯出的.xlsx> [--gs <試算表上貼的那一版.gs>]`（issue 13）：拿她匯出的 .xlsx 裡 `_data` 那一包讓替身畫一次，跟匯出檔逐頁逐格比，只印數字；
細節（有真名）寫進 `.local/references/試算表驗證/`。11/5 兩份匯出檔對過：只有待辦那 9／10 格日期被 Google 認成日期，其餘 0 個不一樣。

## 量到的（她在 staging 量的；`_data` 的 B1／Apps Script 執行紀錄）

| | 一開始（版本 1） | #204 | #207（含每一步 flush） | #209（鎖留著＋Sheets API） |
|---|---|---|---|---|
| 平常推 | 25～57 秒 | 12 秒 | 16.5 秒（讀 8.4） | **5.4 秒**（讀 0.9、上鎖 0.05） |
| 整份重畫 | 167～176 秒 | 114 秒 | 175 秒（上鎖 47、清空 44、畫 68、讀 11） | **125.5 秒**（上鎖 3.4、讀 0.9、清空 46.3、畫 69.8） |

staging 那一份 11/5 用匯出檔逐格驗過（#209 之後）：34 頁 4,340 格對、字級 2,818 格對；只有待辦區 9 格日期被 Google 認成日期格（08 處理）。

## 第三輪（版面，08～13）

分支 `claude/sheet-layout`（從 origin/develop `532c1a4d`），同一個 worktree。全貌與「不在這一輪」的事在 `spec.md`「第三輪」。

| 段 | 做 | effort | 狀態 |
|---|---|---|---|
| 段一 | 08 → 09 → 10 → 11 → 12，一支一個 commit | high | 做完（11/5，推到 `origin/claude/sheet-layout`）；`npm test` 5527 過、0 跳過 |
| 段二 | 13（驗的工具）→ `/matt-code-review`（起點 `532c1a4d`）→ 照建議修 → PR 進 develop → CI 綠就合 → 寫她要照順序做的事 | xhigh | 13 做完（`9598ca18`）、審查與修正做完（見「第三輪段二」） |

### 第三輪段二（審查與修正，11/5）

**審查**（`/matt-code-review`，起點 `532c1a4d`，兩個 subagent）：
- Spec：「不在這一輪」那五項都沒碰；替身跑正式站那一包 34 頁 0 個合併跨過 E／F、凍結都是 5×5、凍結列最高 176 像素；空客戶、只有一個日期、沒帶 `noteLines` 的舊包都沒跨；
  排序之後「✓ IN」與附註跟著原本那一筆額度、extras 在最下面；`noteLines`（含顏色）在指紋裡（整頁的 JSON）。沒找到別的跟 spec 不一樣的
- Standards：凍結 vs 合併、排序、舊包、狀態色、附註清乾淨、版號都對
- **修了**：
  1. **一則一格之後，看起來像數字／日期／公式的那一則會被 Google 認掉**（「0912345678」掉前面的 0、「5/20」變日期、「=…」變公式）—— 兩邊都抓到（Spec 更正：只有一則短備註的客戶以前就會中，這一輪是擴大到每一則）。
     `noteBlock()` 每一行文字格式（`'@'`，同待辦的日期）；先寫測試看它紅。正式站那一包跟改之前比：四步都只有數字格式不一樣（3,280 格）；整份重畫的寫入 1,627 → 1,653（沒有待辦的那幾頁多一次 RangeList）。
     `LAYOUT_VERSION` 照舊 4（第三輪還沒部署過），兩支釘雜湊的測試換了
  2. 文件還寫舊的：`SPEC.md`、`docs/操作手冊.md`、`docs/STAGING.md` 的「第三列的產生時間」→「產生時間那一列」；操作手冊「在它底下註記 `SIS`」→「那一格寫 `✓ SIS`」；
     `docs/邊界測試清單.md` C6-3／C6-4 照新的畫法改預期；`sheetReport.js` 兩段註解（sw v286）
  3. **用詞**：Google 的 note 叫「**附註**」（Google 試算表自己的叫法），不叫「那一格的備註」—— 試算表上另有一塊「備註」（客戶身上那幾則），CONTEXT.md 把記一句與備註分成兩回事。
     改了常見問題、ADR-0175、ADR 索引、SPEC、CLAUDE.md、`.gs`／替身／測試的註解；CONTEXT.md「記一句」補一段
  4. 驗的工具：替身的錯誤訊息裡分頁名是 `sheetNameFor()` 換過的（斜線換減號、最多 90 字）→ 原名與換過的都拿掉、「」裡的整段拿掉；python 的錯誤訊息（有檔案路徑）不再直接印到畫面上，只印例外的種類
  5. `docs/agents/worktree.md`：skipped 不是 0 時怎麼看是誰（`sheet-xlsx-verify` 整支工具那兩條在沒有 openpyxl 的機器上會跳過，跟 `.local` 無關）
  6. `MARK_TINT` 加一條測試釘著 `MARK_COLORS` 與 `tokens.css` 淺色主題的 `--mark-*`（15:85 混白）
  7. 名字：`noteBlock()` 沒在用的 `width` 拿掉（三個呼叫端跟著）；`used`／`said` 各有兩種意思 → `equipmentByDate`、`slotNotesByDate`、`doneAndBooked`、`marks`
- **沒修**（判斷題）：`fitRows(canvas)` 搬到 `Canvas.prototype`（只是搬家，`finish()` 本來就只收草稿紙）；`noticeRow()` 的 `width` 永遠是 `FROZEN_COLS`、`renderTasks()` 的 `width` 沒在用（不是這一輪加的）
- **要問她**：營養品那一行要不要加購買日期（示意圖有「0901　營養品A…」，`syncBundle()` 的 `products` 沒有那一格，段一照 issue「那一段不改」沒加）—— 見「要她決定的」

**跟上 develop**：一次性客人那一輪（#210）先合進 develop → 一般的 `git merge origin/develop`（沒有 rebase）：只有 `sw.js` 與快照衝突，`syncBundle()` 兩邊不同幾行、自動合；
sw v286／v292 → **v293**、快照重跑；`npm test` 5777 過、0 跳過。

**她要照順序做的**（PR 合進 develop、staging 自動部署好之後；staging 的 app 是 v293）：
1. 打開 **staging 那一份** Google 試算表 → 上面「擴充功能」→「Apps Script」→ 左邊「編輯器」
2. 把 GitHub 上 develop 的 `sheets/readonly-report.gs` 整份複製、貼上蓋掉原本的 → 儲存（磁碟片圖示）
3. 右上「部署」→「管理部署作業」→ 鉛筆 →「版本」選「新版本」→「部署」（網址不變，app 不用改）
4. staging 的 app（手機或 iPad）：畫面最上面「有新版本・點一下更新」→ 點（新版 app 推過去的備註才有顏色；舊的 app 推過去照樣畫得出來，備註是淡灰）
5. 設定 → 試算表報表 →「立刻推一次」：**這一次每一頁都會重畫**（正常，約兩分鐘；之後只有變了的那幾頁重畫）
6. 回試算表翻幾頁，看：
   - 日期一格放得下「10/29(四)」（不會擠到第二行）
   - 往右捲，左邊「療程項目～剩餘」五欄停著不動；應有～剩餘那四欄淡灰底、剩餘右邊一條粗線
   - 每一位做最多的那一筆在最上面；三返、送的／體驗在最下面
   - 器材寫在那一格裡（「✓ IN」），沒有另外一列「器材」
   - 有記一句的那一格右上角有一個小黑三角，滑過去（手機：點一下）看得到那一句；沒有另外一列「記一句」
   - 格線不見了，只有矩陣有框線
   - 營養品一筆一行（還沒給完的那一行淡黃）；備註一則一行、顏色跟 app 裡那則短備註一樣（淡一點）、「永久限制」那一行淡紅
   - 抬頭只有號碼（沒有「病歷號」三個字），名字大字
   - 手機的 Google 試算表 app 上：最上面凍結的那一塊會不會太高、凍結的五欄會不會太寬
7. 試算表 → 「檔案」→「下載」→「Microsoft Excel (.xlsx)」→ 放進 `.local/references/xlsx/` → 跟主控說一聲，主控跑
   `node scripts/sheet-xlsx-verify.mjs <那一份> --gs <develop 的 .gs>`，逐頁逐格比真的 Google 跟替身畫的一不一樣
8. 看起來都好 → 正式版要另外說（貼正式那一份的 `.gs`、正式站的 app 上 main，都不在這一輪）

**只在 staging 驗得到**（替身做不出來）。第 7 步的工具比得出凍結有沒有套上、附註清乾淨沒、文字格式；好不好看、高度夠不夠、手機上佔多少要用眼睛看：
- 粗線的實際粗細與顏色、18 號名字一行 40 高夠不夠、淡色版六色分不分得出來（08、12）
- 真的凍結得上去（Google 那一側擋不擋）（09）
- 合併的那幾列估的高度夠不夠：「來訪紀錄」很長的那一行、抬頭第 3 列、產生時間那一列 —— 估少了最後一行被切掉（09；匯出檔只有設下去的高度，**要用眼睛看**）
- 最上面凍結的五列變高了（約 170～180 像素）、凍結五欄約 440 像素：手機的 Google 試算表 app 上會不會佔掉太多（中途發現 4）
- `clearNotes()` 真的清掉整頁的附註、`setNotes()` 寫 '' 不會留空的附註；附註裡的換行照顯示；手機點一下看得到附註（11）
- 文字格式下了之後 Google 真的照字顯示（待辦的日期、那一塊的每一行）（08、段二）
- 整份重畫的寫入多了約兩成（1,363 → 1,653）：staging 的整份重畫 125 秒可能多二三十秒，平常推幾乎不變（中途發現 6）

**要她做的（不擋段一）**：6 位健檢那一段的重複記一句在 app 裡清掉（清單 `.local/references/試算表健檢-2026-11-05/二返重複的記一句.md`）。

**跟一次性客人那一輪的交界**：12 是這一輪唯一動 `syncBundle()` 的地方（多送 `noteLines`）。那一輪 issue 04 也改 `syncBundle()`／`customerReport()`／`ui/views/report.js`
（濾掉一次性客人）—— 這一輪不碰後兩支；`syncBundle()` 改的是不同幾行，**誰後合進 develop 誰 rebase**。

**她說等一下再做的四項**（不在這一輪）：見 `spec.md`「第三輪 → 不在這一輪」。
**這一輪收尾時她要清乾淨**（11/5）：暫時的東西 —— `.local/references/試算表健檢-2026-11-05/`（先問她留不留）、用完的分支（`claude/sheet-push-gaps`、`claude/sheet-faq-structural`、
`claude/sheet-speed`、`claude/sheet-speed-2`、`claude/sheet-timing`、`claude/sheet-timing-cell`、`claude/sheet-locks-api`，刪前問）、這個 worktree（刪之前先 `rmdir .local` 拿掉 junction）；
計時那一段（`clock*`、`_data` 的 B1）量完要不要拿掉也問她。

## 規矩

- 不起模擬器、不跑 E2E、不停 port（主資料夾那一輪在用；她的筆電會熱）。單元測試可以；E2E 交給 PR 的 CI
- 動 `public/` 的 commit 升 `sw.js` 的 VERSION（develop 上現在是 v283）＋`npm run shell:snapshot`；**新增檔案先 `git add` 再跑快照**；開 PR 前 rebase 到 origin/develop，那一行留大的再加一
- **開 PR 前不要 rebase 已經推上去的分支**（強制推會被 auto mode 擋，11/5 段二踩過）：要對齊 develop 就 `git merge origin/develop`，或還沒推之前 rebase
- 這個 worktree 照 `docs/agents/worktree.md` 接好了（`.local` junction、自己的 CodeGraph 索引、graphify 查主資料夾那一份）：`npm test` 的 skipped 要是 0
- 一次性客人那一輪 issue 04 改 `sheetReport.js` 的 `syncBundle()`／`customerReport()` 與 `ui/views/report.js`：這一輪不碰；非碰不可寫在這裡
- ADR 號碼用 0174（04 寫）
- `.gs` 不跑在 node 裡：唯一的驗法是 `tests/helpers/appsScriptStub.js` 的替身。替身做不出來的 Google 行為（真的快不快、合併的細節）只有貼到 staging 才知道 —— 交付時要講清楚哪些只在替身裡驗過

## 她已經決定的

- 11/5「照建議修」：①②③⑤＋④被拒那一半（spec.md）
- 11/5「照建議先觀察」：④ 另一半（兩台同時推，舊的那一份蓋掉新的）不修。真的遇到了，下一次推送會補上；要修的話等下次反正要重貼 `.gs` 時一起做（`.gs` 記每一包的新舊、舊的不畫）
- 11/5 下午「我不介意多按一個設定，或做其他重貼甚麼的不用顧慮，不過可以照建議開這一輪」→ ④ 改成一起修（04）；`.gs` 批次化（02、03）；Sheets API 進階服務量完再決定；`.gs` 不拆檔
- ⑥⑦⑧⑨⑩ 不修，記在 `FINDINGS.md`

## 要她決定的

- 試算表的字級（「中途發現」1）—— 05 做了（名字 14、後來 18；註記 9），已經不用問
- ~~營養品那一行前面要不要加購買日期~~ —— 她 11/5 晚說要，第四輪（14）做了
- **手動貼上那條路的營養品要不要也加購買日**（第四輪中途發現 1）：建議**先不加**，見「中途發現 → 第四輪」

## 過目抓到的

### 第三輪段一（自己對 issue 08～12 寫的現況與程式碼，11/5）

- 08：寫的都對（`LAYOUT_VERSION` 那時是 3、名字 14 號真的畫得出來 —— 05 修過 `finish()`）。**issue 08 自己那一行她的原話「直接寫1234就好」讓 `tests/no-secrets.test.js` 在 `bc589737` 就是紅的**
  （「直接寫」後面接數字像姓名＋病歷號）→ 照那支測試的慣例加進 `NOT_A_NAME`、附理由（`e7d05467`）
- 09：issue 給兩種排法，照第二種：第 2 列名字、第 3 列號碼＋購買名稱＋合計、第 4 列產生時間，**拿掉了原本第 4 列的空行**（矩陣表頭照舊第 5 列、凍結 5 列）；產生時間搬到第 4 列，`render()` 改時間那一格一起改（常數 `STAMP_ROW`）
- 10：分「額度列／extras」issue 說用 `total` 是不是數字，有更穩的 —— `extraRows()` 每一列都帶 `extra: true`，用它（`total` 不是數字的也算，手造的包）
- 11：issue 沒寫到的：**`Sheet.clear()` 不清備註**，要另外 `clearNotes()`（不然搬了位置的那一句留在舊的那一格）；替身照 Google 這樣做
- 12：issue 的營養品例子前面有購買日期（`0901　…`），但 `syncBundle()` 的 `products` 沒有那一格、issue 又說那一段不改 → **不印購買日期**（那一天在「買過什麼」看得到）。要的話是 `syncBundle()` 多送一格，下一輪再說

### 第二輪

subagent 過目 01（11/5），主控對過後改了：
- 打開 app 時離線（`confirmed()` 在連不上時也會叫）→ 開機那一次一定讀到快取、留一句「上次沒推」而她什麼都沒寫 → 改成離線時等 `online` 再推
- `app.js` 那一行註解說確認之前「沒有寫入要推」，跟 ③ 相反 → 改註解
- 重試要掛在每一趟跑完（設定頁「立刻推一次」失敗也要排），`setTimeout` 問不出還剩多久 → 記 `dueAt`、一個計時器
- E2E `78` S1／S2、`45` P1 會被開機那一次推干擾 → 先等它推完再數
- `tests/sheet-fingerprint.test.js` 掃 `push()` 的兩行與 `buildBundle()`：保留原樣

## 中途發現

### 第四輪（11/5 晚）

1. **手動貼上那條路（設定 → 試算表報表「手動貼上」，`customerReport()`／`ui/views/report.js`）的營養品沒有購買日** —— issue 14 只動 `syncBundle()`。
   兩條路本來說好長一樣（`productLine()` 的註解），現在自動推送那一側多了日期。建議**先不加**：手動貼上她現在不用（自動推送開著），正式站 0 位買營養品；要加是 `customerReport()` 那一欄多一格
2. （不用她決定）issue 14 她的原話裡「病歷號」後面直接接著號碼，被 `tests/no-secrets.test.js` 當成「姓名黏著病歷編號」—— 補了一個空白。之後抄她講號碼的原話照樣會中
3. （staging 逐格驗時發現，主控建議先不修）**`resetSheet()` 的 `sheet.clear()` 不清數字格式**：以前被 Google 認成日期的待辦日期那幾格，整份重畫之後值沒了、`yyyy-mm-dd` 還在（staging 6 格）。
   現在看不到；會出事的情境是之後在那一格寫進一個**數字**（會印成日期）—— 數字只寫在矩陣的應有～剩餘，而殘留都在下面待辦那幾格，矩陣要長幾十列才碰得到。
   從 08 起待辦日期那一格先下文字格式（`@`），之後的殘留是 `@`（數字寫進去會變成文字）。要清的話 `resetSheet()` 多一步把整頁的數字格式設回預設（只有 staging 驗得出 Google 認不認）—— 跟下一次本來就要貼 `.gs` 的改動一起做最省

### 第三輪段一（都不用她決定；段二審查時看、交付時講）

4. **最上面凍結的五列變高了**：第 3 列（號碼＋購買名稱＋合計）與第 4 列（產生時間）在五欄的寬度（約 440 像素）裡會折成兩三行，凍結區大約 170～180 像素高。
   iPad 上沒問題；手機的 Google 試算表 app 上可能佔掉一半畫面 —— staging 上要看。真的太高的話，可以把產生時間縮成一行（例如符號說明拿掉、只留時間）
5. **列高是估的**（`.gs` 的 `fitRows()`／`rowHeightFor()`）：Google 不會替合併的格子自己長高，只好照字數估幾行。估少了最後一行被切掉、估多了空一點 —— 只有 staging 看得出來。
   段二的 13（拿匯出的 .xlsx 驗）可以順便量列高（`.xlsx` 有 `ht`）
6. **整份重畫的寫入多了約兩成**（`scripts/sheet-gs-calls.mjs` 正式站那一包：develop 1,363 → 1,627；都沒變那一次 36 → 37）：凍結欄、粗線、格線、清備註、寫備註、文字格式、折行的列各自加高。
   staging 上整份重畫 125 秒可能多十幾秒；平常推幾乎不變
7. `public/js/domain/sheetReport.js` 兩段註解還寫「第三列」→ 改成「產生時間那一列」，所以 `sw.js` 在這條分支上動了兩次：v284（12）→ **v285**（文件那一個 commit）。一次性客人那一條分支是 v292 —— 誰後合誰照規則留大的再加一

### 第二輪過目時（段二末一起問她）

1. **試算表每一頁的字其實全是 11 號**：`.gs` 的 `finish()` 最後整頁 `setFontSize(11)`，把名字那一格的 14 號（大字）、註記列（器材、記一句、二返註記）的 9 號小灰字的「9」都蓋掉了 ——
   程式本來想讓名字大一點、註記小一點，畫出來沒有。這一輪批次化照現在的樣子畫（一個像素都不變）。建議：問她要不要讓名字變大、註記變小（改的話 `LAYOUT_VERSION` 再加一，每一頁重畫一次）

### 段一（02～04）做的時候

2. **這個 worktree 裡 `npm test` 有 1 支跳過**：`tests/no-secrets.test.js` 的別名表那一條（worktree 底下沒有 `.local/`）。不是這一輪弄的、CI 上也是跳過。
   段一推之前另外把三個 commit 的 diff 與 commit 訊息整份過一次 `redact.mjs`：被遮的只有數字串與 `.gs` 註解裡本來就有的 `高能/sis`，沒有名字。
   建議：段二開 PR 前在主資料夾（有 `.local/`）跑一次 `node --test tests/no-secrets.test.js`，或照樣過一次過濾網
3. （不用她決定）`LAYOUT_VERSION` 2：新的 `.gs` 部署後第一次推送每一頁都重畫一次（約 1,500 次寫，照比例估一分鐘內）—— 是預期的，她比秒數時要拿**第二次以後**的平常推來比

## 第三輪 段一的開場（已用掉）

這一輪：照她看過的示意圖改試算表的版面（`sheets/readonly-report.gs` 為主）。分支 `claude/sheet-layout`（worktree `.claude/worktrees/sheet-push-gaps-112028`，已經在這條分支上）。
上一段：主控寫好 issue 08～13（這個 commit）。

**做** 08 → 09 → 10 → 11 → 12，照這個順序、一支一個 commit。**不做** 13（段二）、「不在這一輪」那五項、Sheets API 一個請求畫整頁。

先讀：
- `CLAUDE.md`（「試算表的 SYNC_FORMAT」「試算表的註記」那兩列：指紋、`LAYOUT_VERSION`、`onEdit`、註記的 `rowIndex`）、`docs/agents/lessons.md`、`docs/agents/worktree.md`
- `.scratch/sheet-push-gaps/spec.md` 的「第三輪」、`mock-layout-2026-11-05.html`（用瀏覽器打開看；她看過、改了幾點）、這份 HANDOFF 的「第三輪」「量到的」「規矩」
- `.scratch/sheet-push-gaps/issues/08`～`12` 整支
- `docs/adr/0024`（照抄她舊表的樣子）、`0161`、`0174`；版面這一次推翻了 0024 的一部分（凍結欄、器材與記一句不再多一列、備註上色）→ 寫一支新的 ADR（號碼先 `ls docs/adr` 看：0171～0174 已經有主，用下一個沒人用的），登記進 `docs/adr/README.md`

規矩：
- 改已經存在、別處在用的程式碼之前照 `ripple-check` 查牽連（用這個 worktree 自己的 CodeGraph 索引）；修完找同一個形狀的地方
- 中途發現的事不岔出去修：記進 HANDOFF「中途發現」（哪裡、什麼情境會錯、建議），繼續做原本的；段末一次列給主控
- subagent 同時最多兩個
- **不起模擬器、不跑 E2E、不停任何 port**（主資料夾另一輪在用；她的筆電會熱）。驗證：`npm test`（skipped 要 0）＋替身；替身做不出來的寫進「只在 staging 驗得到」
- 畫法改了：`LAYOUT_VERSION` 4（整輪加一次）；`tests/sheet-gs-batch.test.js`、`tests/sheet-fingerprint.test.js` 釘的雜湊照它們註解寫的換（換之前先用 `scripts/sheet-gs-compare.mjs` 跟 develop 的 `.gs` 比，確定變的只有這一輪要變的）
- 讀 `.local` 一律接 `| node .local/references/redact.mjs`；拿正式站那一包（`.local/references/試算表健檢-2026-11-05/bundle-pushed.json`）跑的結果只印數字
- 12 動 `public/`：升 `sw.js` VERSION（v283 → v284）＋`npm run shell:snapshot`（新檔案先 `git add`）
- 公開 repo：commit 訊息、檔案裡不帶真名（她的截圖有真名，不收進來）

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：每支一個 commit、`Status: done`、issue 底下「做完時留下的」、`npm test` 全過（0 跳過）、更新 HANDOFF（狀態、中途發現），把第三輪段二的開場寫進 HANDOFF
（審查要特別看的：「這一行會不會讓凍結線穿過合併」「排序之後註記會不會掛到別一列」「沒拿到 `noteLines` 的舊包畫不畫得出備註」「狀態色會不會被淡灰蓋掉」；要查牽連的：`renderCustomer`、`noteBlock`、`finish`、`paint`、`render`（改時間那一格）、`syncBundle`、`infoLine`）；推到 origin（**一般的 push，不要 rebase 已經推上去的**）。最後回覆簡短說做了什麼、卡在哪。

## 第三輪 段二的開場

這一輪：照她看過的示意圖改試算表的版面（ADR-0175）。分支 `claude/sheet-layout`（worktree `.claude/worktrees/sheet-push-gaps-112028`）；
段一做完 08～12（`e7d05467`～`40706bb5`，加一個文件 commit），**已推到 origin**。這一段：**13（驗的工具）→ 審查 → 照建議修 → PR 進 develop → CI 綠就合 → 寫她要照順序做的事**。建議 effort：**xhigh**。

先讀：
- `CLAUDE.md`（「試算表的 SYNC_FORMAT」「試算表的註記」兩列，段一補了 ADR-0175 那幾句）、`docs/agents/lessons.md`
- `.scratch/sheet-push-gaps/HANDOFF.md`（「第三輪」「過目抓到的 → 第三輪段一」「中途發現 → 第三輪段一」「規矩」「量的工具」）、`spec.md` 的「第三輪」
- `.scratch/sheet-push-gaps/issues/08`～`13` 整支 —— 08～12 每一支的「做完時留下的」寫了做法、跟 issue 不一樣的地方、`sheet-gs-compare.mjs` 的數字、只在 staging 驗得到的
- `docs/adr/0175-sheet-layout-frozen-counts-and-cell-notes.md`（推翻 ADR-0096 一點，索引登記了）、`0161`、`0174`

做：
1. **13**（照 issue 13 寫的做：拿 staging 匯出的 `.xlsx` 驗真的 Google 畫出來的樣子）。段一的「只在 staging 驗得到」可以順便量：列高（`fitRows()` 估的夠不夠）、凍結 5×5、合併沒有跨過 E／F、備註、文字格式
2. `/matt-code-review`，起點 `532c1a4d`。**審查要特別看**：
   - 「這一行會不會讓凍結線穿過合併？」—— `FROZEN_COLS`、`noteBlock()`、`noticeRow()`、名字／抬頭／產生時間、`blockHead()`（TODO A～C、FINISHED K～M）；`paint()` 合併在凍結之前；`resetSheet()` 先把凍結歸 0
   - 「排序之後註記會不會掛到別一列？」—— `rowOrder()` 回原本的位置、迴圈裡 `n` 照舊拿去找 `equipmentNotes`／`slotNotes`；extras 用 `extra: true`
   - 「沒拿到 `noteLines` 的舊包畫不畫得出備註？」—— `noteLinesOf()` 退回 `notes` 拆行、淡灰；正式站那一包就是舊的（沒有 `noteLines`）
   - 「狀態色會不會被淡灰蓋掉？」—— B～E 的淡灰在斑馬紋之後、狀態色之前；矩陣格子底色看原本的符號（`r.marks`），不是併了器材的字
   - 「備註會不會留在舊的那一格？」—— `resetSheet()` 的 `clearNotes()`、`paintNotes()` 框住的那一塊寫 ''
   - 要查牽連的：`renderCustomer`、`noteBlock`（多了選填的 `colours`）、`finish`（多了 `fitRows()`）、`paint`（數字格式先下、備註、格線、凍結欄）、`render`（改時間那一格 `STAMP_ROW`）、`syncBundle`（多 `noteLines`）、`infoLine`、`resetSheet`（`clearNotes()`）
   - 替身改了什麼（`tests/helpers/appsScriptStub.js`）：`setNote(s)`／`clearNotes`／`clear()` 不清備註、`setNumberFormat`、`setHiddenGridlines`、`SOLID_MEDIUM`，快照多 `notes`、`gridlinesHidden` —— 會不會比 Google 寬鬆
3. 照建議修（範圍內、小的順手修；要她決定的段末一次問）。動 `public/` 再升 `sw.js`（現在 v285）＋`npm run shell:snapshot`
4. 開 PR 進 **develop**：先 `git fetch`；**不要 rebase 已經推上去的分支**（強制推會被擋）—— 要對齊 develop 就 `git merge origin/develop`（`sw.js` 那一行留大的再加一、重跑快照；一次性客人那一輪若先合進 develop，`syncBundle()` 兩邊改的是不同幾行）。
   PR 內文與 commit 不帶真名；這個 worktree 的 `.local` 是接好的 junction，`npm test` 0 跳過就代表真名掃描跑過了。CI 綠就合（不用再問）。E2E 交給 CI，**本機不跑 E2E、不起模擬器、不停 port**
5. 寫她要照順序做的事（白話、一步一步、她點得到的）：**把新的 `.gs` 貼到 staging 的試算表 → 部署新版本（同一個網址）→ staging 的 app 點「有新版本」更新（v285：備註才有顏色）→ 推一次（`LAYOUT_VERSION` 4，每一頁重畫一次，正常）→
   翻幾頁看：日期一行放得下、前五欄凍結（往右捲療程名字還在）、做最多的在上面、「✓ IN」、小黑三角點得開、營養品／備註一行一行有顏色、抬頭只有號碼、名字大字** →
   夠好再貼正式版（她說過正式版的 `.gs` 與 app 上 main 要另外說，見 `spec.md`「不在這一輪」）。另外列出「只在 staging 驗得到」的那幾件（08～12 的「做完時留下的」最後一段、上面「中途發現 → 第三輪段一」4、5）
6. 段末交給主控：「中途發現 → 第三輪段一」4～7（都不用她決定，交付時講 4、5）

規矩：讀 `.local` 一律接 `| node .local/references/redact.mjs`、正式站那一包的結果只印數字；subagent 同時最多兩個；中途發現記進 HANDOFF 不岔出去修；不要自己開 session、不要存 limit-guard 的開場 JSON（主控開下一段）。

做完：PR 合進 develop、HANDOFF 狀態更新、她的步驟寫在 HANDOFF 與回覆裡；回覆簡短說做了什麼、卡在哪。

## 段一的開場（第二輪，已用掉）

這一輪：讓試算表推送變快（Apps Script `.gs` 批次讀寫，畫出來一模一樣），並讓兩台同時推時比較舊的那一包不畫。分支 `claude/sheet-speed`（worktree `.claude/worktrees/sheet-push-gaps-112028`），上一段做到 `2d61b660`（issue 02～04 與量的工具）。

**做** 02 → 03 → 04，照這個順序；一支一個 commit。**不做** Sheets API 進階服務、不改 `syncBundle()`／`customerReport()`／`ui/views/report.js`（一次性客人那一輪會動）。

先讀：
- `CLAUDE.md`（「試算表的 SYNC_FORMAT」那一列：指紋、`LAYOUT_VERSION`、`onEdit`）、`docs/agents/lessons.md`
- `.scratch/sheet-push-gaps/spec.md` 的「第二輪」、`HANDOFF.md` 的「第二輪（02～04）分段」「規矩」「中途發現」
- `.scratch/sheet-push-gaps/issues/02`、`03`、`04` 整支（每一支底下有「過目抓到的」）
- `docs/adr/0013`、`0161`；04 要寫 `docs/adr/0174`（並登記進 `docs/adr/README.md` 的索引）

規矩：
- 改已經存在、別處在用的程式碼之前照 `ripple-check` 查牽連；修完找同一個形狀的地方
- 中途發現的事不岔出去修：記進 HANDOFF「中途發現」（哪裡、什麼情境會錯、建議），繼續做原本的；段末一次列給主控
- subagent 同時最多兩個
- **不起模擬器、不跑 E2E、不停任何 port**（主資料夾另一輪在用；她的筆電會熱）。驗證：`npm test`；`.gs` 的行為只能在 `tests/helpers/appsScriptStub.js` 的替身裡驗，替身做不出來的寫進「只在 staging 驗得到」
- 讀 `.local` 一律接 `| node .local/references/redact.mjs`（在這個 worktree 裡 `.local` 是 `../../../.local`）；拿正式站那一包跑的結果只印數字
- 動 `public/` 的 commit 升 `public/sw.js` 的 VERSION（develop 上現在是 v281，從 v282 起）＋`npm run shell:snapshot`；**新增檔案先 `git add` 再跑快照與 `npm test`**
- 公開 repo：commit 訊息、檔案裡不帶真名

主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。

做完要交：每支一個 commit、`Status: done`、issue 底下「做完時留下的」（含 `scripts/sheet-gs-calls.mjs` 改前改後的數字）、`npm test` 全過、更新 HANDOFF（狀態、中途發現），把段二的開場寫進 HANDOFF（審查要特別看的：「這一行會不會讓畫出來的跟改前不一樣」「會不會讓比較新的那一包被當成舊的不畫」，要查牽連的：`render`、`renderCustomer`、`noteBlock`、`finish`、`doPost`、`buildBundle`、`pushedSay`）；推到 origin。最後回覆簡短說做了什麼、卡在哪。

## 段二的開場（第二輪，已用掉）

這一輪：讓試算表推送變快（`.gs` 批次讀寫，畫出來一模一樣）＋兩台同時推時比較舊的那一包不畫（ADR-0174）。分支 `claude/sheet-speed`（worktree `.claude/worktrees/sheet-push-gaps-112028`），
段一做完 02、03、04，最新 `854bd266`、已推到 origin。這一段：**審查 → 照建議修 → 開 PR 進 develop → CI 綠就合 → 寫她要照順序做的事**。建議 effort：**xhigh**。

先讀：
- `CLAUDE.md`（「試算表的 SYNC_FORMAT」那一列，段一補了一段）、`docs/agents/lessons.md`
- `.scratch/sheet-push-gaps/HANDOFF.md`（「量的工具」「規矩」「中途發現」）、`spec.md` 的「第二輪」
- `.scratch/sheet-push-gaps/issues/02`、`03`、`04` 整支 —— 每一支的「做完時留下的」寫了做法、跟 issue 寫的不一樣的地方、只在 staging 驗得到的
- `docs/adr/0174-older-sheet-bundle-is-not-drawn.md`、`0161`、`0013`

做：
1. `/matt-code-review`，起點 `5050997e`（段一開始之前）。**審查要特別看**：
   - 「這一行會不會讓畫出來的跟改前不一樣？」—— `Canvas`／`paint()`／`rectsByValue()`／`mergeAll()`：格式只記最後一次、沒設過的格子不碰、值先寫再合併、凍結最後；
     `getLastRow()` 照 Google 的算法（替身也改成不算 `''`）。比法：`tests/sheet-gs-batch.test.js` 的雜湊（改前的 `.gs` 跑出來的）、`scripts/sheet-gs-compare.mjs` 跑正式站那一包（只印數字）
   - 「會不會讓比較新的那一包被當成舊的不畫？」—— `dataAtOf()`、`isStaleBundle()`、`buildBundle()` 先讀稽核再讀資料、`doPost()` 拿到鎖之後才比、畫完才記、沒帶時間照畫
   - 先讀完再寫那一套（`readBook()`、`sizeOf()`、`protectionsOf()`、`emptyOf()`）：**整頁空著的分頁照舊算我們的**、她自己的同名分頁照舊跳過、畫到一半逾時那一頁的指紋照舊不在、
     `_data` 的鎖對了才不重上、`forgetStale()` 不用 `setProperties(…, true)`（`onEdit` 同時拿掉的指紋會被救回來）
   - 要查牽連的：`render`、`renderCustomer`（測試會單獨包它、少傳 `book`）、`noteBlock`、`finish`、`doPost`、`buildBundle`（只有 `run()` 叫，回傳改成 `{ bundle, dataAt }`）、`pushedSay`（`ui/views/report.js` 一行沒動）
   - 替身改了什麼（`tests/helpers/appsScriptStub.js`）：會不會讓既有的測試變得比 Google 寬鬆（`getLastRow`、`removeEditors` 真的拿掉人、`Protection.remove()` 只拿掉自己）
2. 照建議修（範圍內、小的順手修；要她決定的段末一次問）。動 `public/` 要再升 `sw.js` VERSION（現在 v282）＋`npm run shell:snapshot`
3. 開 PR 進 **develop**（rebase 到 origin/develop，`sw.js` 那一行留大的再加一）。PR 內文與 commit 不帶真名；推之前在主資料夾跑一次 `node --test tests/no-secrets.test.js`
   （這個 worktree 沒有 `.local/`，那一條會跳過 —— HANDOFF「中途發現」2）。CI 綠就合（不用再問）。E2E 交給 CI，**本機不跑 E2E、不起模擬器、不停 port**
4. 寫她要照順序做的事（白話、一步一步）：**貼新的 `.gs` 到 staging 的試算表 → 重新部署（同一個網址）→ 第一次推送會每一頁重畫（`LAYOUT_VERSION` 2，正常）→
   之後在 app 改一筆、看 Apps Script「執行作業」那一頁平常推與「整份重畫」各幾秒，跟改前（平常推 25–48 秒、整份重畫約 192 秒）比** → 夠快再貼正式版；
   不夠快再談 Sheets API 進階服務。另外列出「只在 staging 驗得到」的那幾件（02、03、04 的「做完時留下的」最後一段）
5. 段末一次問她：HANDOFF「中途發現」1（名字大字、註記小字現在都被蓋成 11 號，要不要改）

規矩：讀 `.local` 一律接 `| node ../../../.local/references/redact.mjs`、正式站那一包的結果只印數字；subagent 同時最多兩個；中途發現記進 HANDOFF 不岔出去修。

做完：PR 合進 develop、HANDOFF 狀態更新、她的步驟寫在 HANDOFF 與回覆裡；回覆簡短說做了什麼、卡在哪。

## 第四輪（版面微調，issue 14）

她 11/5 晚看了 staging 第三輪的樣子（第三輪的 `.gs` 已貼到 staging）：分裂感太重、不要凍結欄；號碼跟名字一樣大；灰色太醜（主控畫了三種，她挑 **A 全白＋窄空白欄**，`mock-count-columns-2026-11-05.html`）；營養品加日期。
分支 `claude/sheet-layout-2`（從 develop `7666220b`），同一個 worktree。一段做完（實作＋自己審＋PR＋合進 develop）：小，不另開審查段 —— 段裡做完照 `/matt-code-review` 的兩個方向（Standards、Spec）自己對一次，寫進 issue。

### 第四輪 做完（11/5 晚）

一段做完：分支 `claude/sheet-layout-2`，先 `git merge origin/develop`（#212 用了 sw v294）→ 兩個 commit（`6a181408` 程式與測試、`16f30507` ADR-0176 與文件）→ **PR #213** 進 develop。
做法、數字、自己對的 Standards／Spec、只在 staging 驗得到的：issue 14 的「做完時留下的」。重點：
- 跟 develop 的 `.gs` 比正式站那一包（把空白欄拿掉、日期往左一格再比）：值、附註、矩陣底色 0 格不一樣；整份重畫的寫入 1,653 → 1,543
- `sheet-xlsx-verify` 的比法多一步（`spreadMergeEdges()`）：openpyxl 讀合併區會把左上角的框線抄到整條邊，整頁寬的產生時間那一列因此「多」了底線。**staging 那一次驗的時候要看它猜得對不對**
- `sw.js` **v295**、`LAYOUT_VERSION` **5**

**她要照順序做的**（PR 合進 develop、staging 自動部署好之後；staging 的 app 是 v295）：
1. 打開 **staging 那一份** Google 試算表 → 上面「擴充功能」→「Apps Script」→ 左邊「編輯器」
2. 把 GitHub 上 develop 的 `sheets/readonly-report.gs` 整份複製、貼上蓋掉原本的 → 儲存（磁碟片圖示）
3. 右上「部署」→「管理部署作業」→ 鉛筆 →「版本」選「新版本」→「部署」（網址不變，app 不用改）
4. staging 的 app：畫面最上面「有新版本・點一下更新」→ 點（新版 app 推過去的營養品才有購買日；舊的 app 推過去照樣畫得出來，只是沒日期）
5. 設定 → 試算表報表 →「立刻推一次」：**這一次每一頁都會重畫**（正常，約兩分鐘；之後只有變了的那幾頁重畫）
6. 回試算表翻幾頁，看：
   - 往右捲時左邊不再停住（沒有凍結線）；最上面四列與下面「買過什麼」「營養品」「備註」「來訪紀錄」一行拉到整頁寬，幾乎不折行
   - 名字後面接著號碼、一樣大（「客戶A　1234」）；下一行只有購買名稱、會籍、合計
   - 應有～剩餘四欄是白的（隔列淡淡的斑馬紋照舊）、表頭跟療程項目同色、沒有粗線；剩餘與第一個日期中間一條窄窄的白欄
   - 已完成綠、已排未上黃、剩餘 0 紅照舊；「✓ IN」與小黑三角（附註）還在對的那一天
   - 營養品那一行最前面有購買日（例如 `0901`）—— 正式站現在 0 位買營養品，staging 上有買的那幾位才看得到
7. 試算表 →「檔案」→「下載」→「Microsoft Excel (.xlsx)」→ 放進 `.local/references/xlsx/` → 跟主控說一聲，主控跑
   `node scripts/sheet-xlsx-verify.mjs <那一份> --gs <develop 的 .gs>`
8. 看起來都好 → 正式版要另外說（貼正式那一份的 `.gs`、正式站的 app 上 main，都不在這一輪）

**只在 staging 驗得到**：空白欄 8 像素夠不夠「分開」；產生時間那一列底下、空白欄與矩陣右邊上面會不會也有一條細線（只是好不好看）；名字＋號碼一行在手機上會不會被切掉（那一列 40 高、不折行）。

### 第四輪 staging 逐格驗（11/5 深夜，主控）

她照上面 1～7 做完、匯出（`.local/references/xlsx/staging-1105-round4.xlsx`）。拿 develop `126206a1` 的 `.gs` 跑 `sheet-xlsx-verify`：37 頁、23,699 格。
- **值、底色、字級、粗體、字色、對齊、附註、合併、欄寬、列高 0 格不一樣**。量的（只印數字）：35 頁名字那一格 18 號粗體；空白欄 8 像素、沒字、沒有任何一條框線；表頭同色（3 頁沒有任何來訪、沒有日期表頭）；
  數字四欄只有綠／黃／紅、斑馬紋與白；16 頁有「✓ 器材」與附註；staging 那一包 0 位有營養品（購買日只有替身測試驗到）
- **「產生時間那一列底下會不會有細線」：沒有**（空白欄與矩陣右邊上面都沒有）。工具第四輪加的 `spreadMergeEdges()` 猜錯了 —— Google 只把線寫在畫框線的那一塊裡的格子上（A5 上面有、A4 底下沒有），
  openpyxl 只抄左上角那一格自己的線 → 每一頁假報 1～8 條、共 120 條。拿掉、`dumpLike()` 改成照 Google 那樣寫（合併區裡的格子不寫框線、只照 `setBorder()` 畫的）
- **6 格空的格子留著日期格式**：下午那一份同一格（5 格）是一格被 Google 認成日期的待辦日期、1 格那時就是殘留 —— 整份重畫的 `sheet.clear()` 清了值、沒清數字格式。工具改成已知（`numberFormat.leftover`）；要不要在 `.gs` 清掉見「中途發現」第四輪 3
- **1 頁沒有凍結**（第 14 頁，照試算表的順序；從左數第 13 個看得到的分頁 —— 第 3 頁 `_data` 藏著）：下午那一份那一頁是凍結的；那一頁照整包的先後是第 11 個畫的，後面 24 頁都凍結了，
  而 `.gs` 每一頁沒有自己的 try/catch（一頁出錯整趟就停）—— 所以是畫完之後被拿掉的（多半是試算表上凍結那條灰線被拖到最上面）。指紋不看凍結：要等那位客戶的資料變了、或按「整份重畫」才回來
- 舊的那一份（下午、`532c1a4d` 的 `.gs`）用改過的工具重跑：照舊只有 9 格待辦日期（`value.date` 9＋格式 9），1 格殘留變成已知
- 工具修正：分支 `claude/sheet-xlsx-verify-merge-edges`（從 develop `126206a1`），只動 `scripts/lib/sheetXlsxCompare.mjs` 與 `tests/sheet-xlsx-verify.test.js`（不動 `public/`）

## 第五輪：記一句也疊在日期底下（issue 15，11/6）

她 11/6 拿舊表的截圖：附註（小黑三角）照留，另外像二返註記那樣寫在那一個日期那一欄的表格底下、好幾句往下疊、塗舒服的顏色；器材不用。
主控自己做（小，一支）：分支 `claude/sheet-slot-notes-below`（從 develop `a4315111`）。做法與數字在 issue 15 的「做完時留下的」，決定在 ADR-0177。
`LAYOUT_VERSION` 6、只動 `.gs`（沒有動 `public/`，app 不用更新）。
同一天她又說「就都不要有凍結，太割裂了」→ issue 16（ADR-0178）：列也不凍結，`LAYOUT_VERSION` 7，分支 `claude/sheet-no-freeze`。下面的步驟一次貼就兩件都有。
她貼了版號 7、匯出驗過（issue 15 的「之二」）：折行的記一句只看得到第一行、顏色幾乎都淡紫 → 版號 8（分支 `claude/sheet-stack-row-heights`）：那幾列照字數加高、顏色照日期錯開。要再貼一次

**她要照順序做的**（PR 合進 develop 之後）：
1. 打開 **staging 那一份** Google 試算表 →「擴充功能」→「Apps Script」→「編輯器」→ 貼上 develop 的 `sheets/readonly-report.gs` → 儲存
2. 「部署」→「管理部署作業」→ 鉛筆 →「新版本」→「部署」
3. app 設定 → 試算表報表 →「立刻推一次」（版號變了，每一頁重畫，約兩分鐘）—— 每一頁的凍結都拿掉（第 13 個分頁本來就沒凍結，不用補了）
4. 翻幾頁看：有記一句的那幾天，表格底下那一欄有沒有塗了色的那一句；一天好幾句有沒有往下疊；長的那一句有沒有被切掉
5. 想逐格驗就匯出 .xlsx 放 `.local/references/xlsx/`

### 第四輪的開場

這一輪：試算表版面第四輪微調（issue 14）。分支 `claude/sheet-layout-2`（已經在這條分支上），主控做到這個 commit。

做：`.scratch/sheet-push-gaps/issues/14-layout-round-four.md` 一支（四件事可以分幾個 commit，一件一個最好）→ 自己對一次（Standards：CLAUDE.md 連動表「試算表的 SYNC_FORMAT」「試算表的註記」兩列、`docs/agents/lessons.md`；Spec：issue 的判準一條一條）→ 開 PR 進 develop → CI 綠＋全量 E2E（`gh workflow run e2e-full.yml --ref claude/sheet-layout-2`，GitHub 上的機器）綠就合（不用問）→ 把她要照順序做的事（貼 `.gs` 到 staging、立刻推一次、看、匯出 .xlsx 給主控跑 `scripts/sheet-xlsx-verify.mjs`）寫進 HANDOFF 與回覆。

先讀：`CLAUDE.md`、`docs/agents/lessons.md`、`docs/agents/worktree.md`、這份 HANDOFF 的「第三輪」「第三輪段二」「規矩」與這一節、issue 14、ADR-0175、`mock-count-columns-2026-11-05.html`（A）。

規矩：改既有程式碼前照 `ripple-check` 查牽連（這個 worktree 自己的 CodeGraph 索引）；中途發現記進 HANDOFF 不岔出去修；subagent 同時最多兩個；不起模擬器、不跑本機 E2E、不停 port；`npm test` skipped 要 0；
讀 `.local` 接 `| node .local/references/redact.mjs`、只印數字；公開 repo 不帶真名；**推用一般的 push、不 rebase 已經推上去的分支**（要對齊 develop 用 `git merge origin/develop`）。
主控會接手：不要自己開 session、不要存 limit-guard 的開場 JSON。要問她的寫進 HANDOFF 與回覆，主控來問。

做完：issue 標 done、寫「做完時留下的」、PR 合進 develop、回覆簡短說做了什麼、PR 連結、她的步驟、卡在哪。
