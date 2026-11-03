# 審查：拍 Abovee 辨識完一眼看得完（段三，2026-11-03）

範圍：`develop`（cd1d29b7）→ `claude/abovee-confirm-glance`（2b604670），01～05 全部。
做法：`/matt-code-review` 兩軸（Standards、Spec 各一個 subagent，只讀）。回來的每一條我都讀了前後文；會動到行為的那幾條拿 domain 跑過一次（重現腳本在這一組的 scratchpad，不進 repo），確定是錯、而且重要才列進「要修」。

## 要修

照建議的先後排。R1～R3 是行為，R4～R6 是文件，R7、R8 是小的。

### R1 換一位之後才變成「要你看」的列，算不進「發現問題 N」，按鈕灰掉講「沒事」是假的

- **在哪裡**：`aboveeImport.js` 的 `problemsPage()`。`look` 只認打開這一層時定好的 `attention`（`aboveeConfirm.js:199`），`hasRowNote()` 也不收 `kind: 'mismatch'`。抬頭的 `summarizeAbovee()` 每一次都重算 `needsAttention()`，所以兩邊對不上
- **什麼情境會錯**（跑過）：照片上的名字 app 裡沒有（`unknown`，不在 attention）→ 她「換一位」選了客戶甲，客戶甲那一格在 app 上已經完成、照片寫確認前往 → 這一列變成 `mismatch`／`aboveeNotDone`。抬頭寫「要你看 1 段」，按鈕卻是「發現問題 0」、灰掉、按不下去；`mismatchSay()` 那一句只有點開才看得到。跟 ADR-0170「0 件灰掉＝檢查過了、沒事」衝突
- **建議**：`look` 改成「打開時定好的 ∪ 現在 `needsAttention()` 的」—— 打開時那幾列照舊排前面不跳，後來才變成要看的接在後面（`attention` 是「位置不跳」，不是「名單不變」）。`rowsSig()` 跟著就會整頁重畫
- **紅燈測試**：`tests/abovee-problems-page.test.js` 加一條 —— `attention` 是空的 Set、一列 `kind: 'mismatch'`，`problemsPage()` 的 `count` 要 ≥ 1、那一列要在 `look`（或某一塊）裡；同一份 items，`count` 不可以小於 `summarizeAbovee(...).attention`

### R2 「對不上」那一列：拿掉「要改的」那一格的勾，列上印的人跟存進去的不一樣

- **在哪裡**：`aboveeImport.js` 的 `glanceSlot()`／`rowGlance()`。`kind: 'mismatch'` 的列：勾著「改成 Abovee 的」時有 `slotAfter`，印 app 那一段套完之後的樣子；沒勾時退回照片上的課程與人
- **什麼情境會錯**（跑過）：app 那一段的治療師是某甲、照片寫某乙，「要改的」那一行預設勾著 → 列上印某乙（對）；**拿掉勾 → 列上照樣印某乙**，存進去的卻是某甲。課程名也跟著勾換寫法：勾著是 `SIS(60)`（app 那一段），沒勾是 `SIS`（照片上的）
- spec 那一句：「印的是按『記錄』之後會寫進去的那一個」。issue 02 另外寫了「對不上的列照片上的才是她要對的那一份」，所以兩句互相打架 → **印哪一份見「要她決定的」第 1 題**；不管她選哪一份，同一列都不可以因為那一格勾不勾換一種來源
- **紅燈測試**：`tests/abovee-row-glance.test.js` 加一條 —— mismatch 列、`diffs` 只有治療師，`adopt: true` 與 `adopt: false` 各跑一次 `rowGlance()`，課程名要一樣；治療師那一格照她選的那一份（選 app：沒勾＝app 上那一位）

### R3 兩句話叫她去看「要改的」那一塊，那一塊現在在另一頁

- `aboveeConfirm.js:641`（點開一列已經記了、有要改的）：「要不要改，勾在**最上面**「要改的」那一塊。」／「最上面「要改的」那一塊沒勾 …」—— 在辨識結果點開時，最上面沒有那一塊
- `aboveeImport.js:2854` 的 `recordBarSay()`：「勾起來的有 N 段這一次改不成（「要改的」那一塊寫著為什麼）」—— 底下那一條兩頁都在
- **建議**：兩句都講明在「發現問題」那一頁（例：「…勾在「發現問題」那一頁最上面「要改的」那一塊」）。`hintsHtml()` 裡那一句（mismatch＋`offersChange`）只畫在發現問題那一頁或點開的時候，點開在辨識結果時也是同一個問題，一起改
- **測試**：`recordBarSay()` 的單元測試改字；畫面那兩句 grep 不到「最上面「要改的」」

### R4 ADR-0141 那張「印簡寫／印全名」的表被這一輪改了，沒有記

- 02 讓拍 Abovee 收著的那一行印**人員簡寫與診間簡寫**（她要的「像日曆那邊一樣」）。可是 ADR-0141 第二節那張表把「拍 Abovee」寫在**印全名**那一欄；根目錄 `CLAUDE.md`「人員的全名與簡寫」那一列寫「**簡寫只在三處**」、「診間的名字、簡寫或清單」那一列寫「月曆、日／週那一列、讀取卡片印簡寫，其餘印全名」
- 之後的 session 照 CLAUDE.md 會把 `rowGlance()` 的 `nameOf(row, 'short')`「修」回全名
- **要改**：ADR-0170 開頭的「推翻：」加 ADR-0141 第二節那張表的一格（拍 Abovee 收著的那一行印簡寫；點開之後那幾排丸子照舊全名）、「延伸：」加 ADR-0079（診間簡寫）；`docs/adr/README.md` 兩張表（`tests/adr-index.test.js` 會盯著）；CLAUDE.md 那兩列改成「四處」，指到 `rowGlance()`（ADR-0170 是這一輪新的、還沒合，直接改）

### R5 常見問題還有四處講舊的位置

05 grep 過，這四處漏了（都是「收著的列底下就有那一句」或「照片底下那一句」，現在那幾句只在「發現問題」那一頁）：

- `docs/常見問題.md:586`「那一列沒有點開，底下就寫著『Abovee 上寫體驗 …』」→ 現在辨識結果上是紅字「體驗」，整句在發現問題
- `:1369`「底下多一句淡黃色的『差一個字』」（拍 Abovee 那一半；療程單那一半不變）
- `:1397`「『要你看』底下『app 有、這次照片上沒有』那一塊」→ 發現問題那一頁最後一塊
- `:1417`「最上面有一句『左右兩張的列數不一樣…』」→ 發現問題那一頁最上面

### R6 邊界測試清單 C11-7e 講「收著也看得到」

- `docs/邊界測試清單.md:375`：「後者診間空著、**收著也看得到**「沒寫哪一床 —— 點開選一間」」—— 那一句是 `nearSay()`，現在只在發現問題「有提醒的」與點開之後。改成那個位置

### R7 hintsHtml() 與 hasRowNote() 沒有測試把兩邊釘在一起

- `hasRowNote()`（`aboveeImport.js:2615`）一行一行照抄 `hintsHtml()`（`aboveeConfirm.js:546`）的判斷；R1 就是這個形狀（`hintsHtml()` 那幾行之外，列還會因為 `needsAttention()` 變成要看的）。lessons 五這一輪自己寫的那一條：「畫它們的那一支裡每一行，在新的地方都有位置嗎？」
- **建議**：掃原始碼的一支測試 —— `hintsHtml()` 裡每一行用到的 domain 函式（`newRowSay`、`photoRowSays`、`partialSay`、`repeatSay`、`nearSay`、`diffs`／`locked`、`offersChange`），都要出現在 `hasRowNote()`、`rowTag()` 或 `needsAttention()` 裡。下次在 `hintsHtml()` 加一行而沒有替它找位置，就紅

### R8（小）點開那一塊直接讀 `seenCourse.assigns`

- `aboveeConfirm.js:752`：`(seenCourse?.assigns ?? null)`。CLAUDE.md「一段來訪要指派誰／哪裡」：要不要治療師／診間只走 `assignsFor()`，畫面不自己讀 `course.assigns`（`tests/visits.test.js:1393` 只掃 `course.assigns ===`，所以沒擋到）
- 行為差異很小（只差在「復能」寫著、照片沒寫哪一台的那一列），但這一段跟 domain 的 `rowGlance()` 退路是同一件事各寫一份
- **建議**：要畫哪幾排問 domain 一支（`rowGlance()` 已經算出 `cells`，或抽一支 `peopleFieldsFor()` 兩邊共用）；測試把那條掃描放寬到 `\.assigns\b`（設定頁 `masterList.js` 要列例外）

### 順手（段四要做就做）

- **組不出時段的列，課程名少了分鐘**：還沒按的三返印「三返」、對不上的列印「SIS」；日曆那一列與已經記了的列是「三返(30)」「SIS(60)」。`rowGlance()` 的退路那一段沒帶 `startsAt`／`endsAt`（照片上有），補上就一樣
- `absentHtml()` 第三個參數的預設值沒有人用（兩個呼叫端都傳了）

## 不修（理由）

- **`visits.js` 加的 `kind` 會不會波及別頁**：查過。`warningDetails()` 的呼叫端只讀 `text`／`source`／`slots`；`visitWarnings()` 只拿 `text`；沒有任何地方比整個物件或拿去 `JSON.stringify` 比。壓表、來訪編輯器、試算表的提醒不受影響（`visits`、`exam-not-mine-warnings`、`followup-link-before-exam` 三支 340 條都綠）
- **`app.css` 會不會波及別頁**：只動 `.giftfold__lead`（刪掉、全站沒有人再用）與 `.abl-*`、`.abl__*`；`.seg` 只加了 `.abl__seg` 底下的規則
- **375 寬**：我拿 app.css 畫同樣的標記量了 360／375／393／412，Spec 那一軸用 Chromium 量了 375／430 —— 有紅字標記時課程＋人那一格沒有被截、標記不壓到小標、不橫向捲（420 以下課程那一格自己換到第二行）
- **「沒拍到預約狀態那一欄」那一句只在發現問題那一頁**：那一句會改變寫進去的東西（整批記成待確認），以前常駐在照片旁邊。ADR-0170 定了放在發現問題最上面；辨識結果上有「發現問題 1」那一顆（不灰），按「記錄」那一道確認框照樣講「每一段都記成「待確認」」。守得住紅線的理由跟 ADR-0138 第 5 點一樣。段四驗收時講一句
- **在發現問題那一頁點開一列、按了一顆讓它沒事了 → 那一列馬上離開那一頁**：跟 ADR-0170「這一頁是還沒處理的」一致（拿掉勾那一條也是），N 變 0 時回到辨識結果、那一列照樣點開著。段四驗收時看她順不順
- **domain 的 `glanceOf()` 用 `assignsFor() ?? course.assigns` 退路**（擇一池還沒選器材時印「治療師？」）：只拿來畫，不寫入；同 `staffRoleFor()`
- **`notesHtml()` 那兩句（左右列數不一樣、沒有姓名）還寫在畫面裡**：以前就在 `pairingKind()`，不是這一輪長出來的
- **短標記用「禁忌」**：CONTEXT.md 的 _Avoid_ 是拿「醫療禁忌」當警示那一層的名字；這裡講的是器材對警示那一句（CLAUDE.md 也叫它醫療禁忌），而且是她自己指名的字
- **邊界測試清單 S2 看起來像 happy path**：那一節寫明是要送真的 AI 才看得到的（staging、假客戶），E2E `87` 用假模型
- **真名**：這一輪 12 個 commit 訊息與每一行新增，拿 `tests/helpers/realNames.js` 五份名單（121 個字串）掃，0 處；`.local/references/staff-scan.mjs` 只報 `SPEC.md:2138`，那一行是 develop 上本來就有的種子名單，不是這一輪寫的。程式與測試裡的人員都是種子上的名字或「某＋名」
- **其餘問句都沒問題**：`tagBy` 在兩條路上都跟 `mustSeeBy` 一一對上，對照表沒有的退回「提醒」；先後與「+N 算種」對；同一列不會在畫面上出現兩次（look／flagged／later 互斥，要改的那一塊不用 `data-abl-row`）；「別的課當體驗」三個入口都不見了，講概念的註解、CONTEXT.md、ADR-0148 沒動；抬頭、底下那一條、確認框「其中 N 段有提醒」都沒動；`sw.js` 每一個動 `public/` 的 commit 都升了號（v220～v223）、快照跟上；新的 E2E 都登記了、沒有 `waitForTimeout()`；檔案裡沒有控制字元；這一輪的單元測試 576 條都綠

## 要她決定的

1. **「對不上」的那一列（app 上那一段跟照片不一樣），收著時課程＋人印哪一份？**（R2）
   - **建議：印 app 上存完之後那一段**（勾著「要改的」就是改完的人，拿掉勾就是 app 上原本的人）—— 跟「已經記了」的列同一個規則，列上那一行永遠是「按了記錄之後 app 上長什麼樣」；照片上的原字點開看得到（「照片上寫的」）
   - 另一個選法：照片上的（issue 02 原本寫的）。那樣「要改的」勾不勾列上都不變，但她從列上看不出這一段在 app 上記的是誰

## 給段四

- R1～R3 先紅燈再修；R4～R6 是文件；R7、R8 看時間。動到 `public/` 升 `sw.js`（現在 **v223**）、`shell:snapshot`
- 本機 E2E 只跑過拍 Abovee 那 16 支：`visits.js`、`app.css` 挑到的其餘交給 PR 的 CI 全量（照上面「不修」那兩條，我看不出會紅的理由）
