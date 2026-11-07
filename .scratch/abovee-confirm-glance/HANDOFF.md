# HANDOFF：拍 Abovee 辨識完一眼看得完

分支 `claude/abovee-confirm-glance`（從 `develop` cd1d29b7 開；第一個 commit 是上一輪那筆只在分支上的交接紀錄）。全貌與她的原話在 `spec.md`。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 一 | 01 拿掉「別的課當體驗」、02 列上印人與診間 | high | done（caaca04c、66e610dc；`sw.js` 現在 **v221**） |
| 二 | 03 ADR-0170＋紅字短標記、04 「辨識結果／發現問題 N」切換、05 文件 | xhigh | done（03 adc3e59d、04 4306dfb3、05 8b3518ff；`sw.js` 現在 **v223**） |
| 三 | `/matt-code-review` 審這一輪全部 | xhigh | done（`REVIEW.md`：要修 R1～R8、要她決定 1 題） |
| 四 | 照審查修、手動驗收（模擬器）、開 PR 進 `develop`、照 CLAUDE.md 合併 | medium | done（R1～R8＋順手，`sw.js` **v228**）；PR #190 合進 develop（`11ac42e1`），11/3 晚 PR #192 上 main（`19427dfa`） |

## 每一段共同的規矩

- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、`spec.md`、這份 HANDOFF 的「使用者已經決定的」「過目抓到的」「中途發現」
- **改一個已經存在的函式、型別或畫面上的字之前，照 `ripple-check` skill**：`codegraph sync` → `codegraph callers`／`impact` 列出呼叫端、逐條寫下會怎麼受影響；
  純 JS，**再用 grep 函式名對一次**；畫面上的字另外 grep（`tests/`、`tests-e2e/`、`docs/`）。修完 bug 照它找同一個形狀的地方
- 一支 issue 一個 commit：先寫一支會紅的測試、跑過確認紅 → 修到綠 → `npm run verify` → commit → issue 的 `Status: done`、底下寫「做完時留下的」
- **`npm run verify` 之前先 `npm run emulators`（背景）**：verify 不幫你起模擬器，沒起的話 E2E 全是 `fetch failed` 而指令照樣 exit 0（上一輪踩過）
- 動到 `public/` 的每一個 commit 升 `sw.js` 的 `VERSION`（**現在 v223**）、跑 `npm run shell:snapshot`；同一支 commit 裡再改 `public/` 不用多升
- 新的 E2E 登記進 `tests-e2e/related.js`；E2E 不用 `waitForTimeout()`
- **中途發現的事不岔出去修**：記進下面「中途發現」（哪裡、什麼情境會錯、建議），段末一次問
- subagent 同時最多兩個
- **真名一個字都不進版控**：她的截圖上有真名。例子寫「客戶A」、種子假名（夏、許、李）；人員假名寫「某＋名」
- **主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON**

## 使用者已經決定的

- 四件都照我的建議（11/3「可以照建議，開kickoff」）；切換的名字是「辨識結果」／「發現問題 N」
- 紅字不是紅點，是短字標記：最要緊的一個＋`+N`；先後 禁忌 → 次數不夠 → 撞期 → 重疊 → 過期 → 品項 → 健檢
- 三返認醫師不另外改（讀照片時認得到，第一件做完列上就看得到）
- 拆法：段一＝01、02；段二＝03、04、05
- （`REVIEW.md` R2）「對不上」的那一列收著時印 **app 上存完之後那一段**（勾著「要改的」＝改完的人、拿掉勾＝app 上原本的人），跟已經記了的列同一個規則：她 11/3 主控那邊回「照你的建議」
- 照片上「認不得」的列（名字跟病歷號對到不同人、同名好幾位：`needsAttention()` 的 `unknown`）**照舊算進「發現問題 N」**（「app 裡沒有這個名字」那一種照舊不算）：她 11/3「照建議，照舊算」

## 要使用者決定的

（沒有）

## 過目抓到的

subagent 11/3 唯讀過目；主控自己對過 E1、E4、M9（版面）、真名那幾條，都成立。全部已經改進 issue：

- E1（02）：`afterPhoto()` 沒套 `adoptAbovee()`、沒 export → 已經記了的列改讀 `photoDayPlan()` 的 `writes[].touch`（建議回傳多一份 `slotAfter[key]`）
- E3（02）：`item.existing` 不一定有 `slotIndex`（合併扣課後一半、沒時間的舊段、對不上的；改期那一列要讀 `moved.at`）→ 每一種寫退路
- M8（02）：新的列組得出時段就讀 slot 上的人與診間，組不出才讀 `item.*Id`
- M9（02／04）：`.abl-row__what` 是 nowrap＋ellipsis → 紅字標記自己一格，02 先留好
- E4（04）：首頁切換其實是整頁重畫；兩頁同時在 DOM 會讓 `data-abl-row` 重複 → 只畫目前那一頁（閉包 `view` ＋ `paintBody()`）
- E5、E6、E7（03）：mustSee 的來源還有 `trialSay()`、`mergedNotices()`、`photoRowSays()`；加 `kind` 要連 `from()` 一起改；`mustSeeBy` 維持字串、並排 `tagBy`；紅線兩支測試移到 04
- M1（03）：ADR-0170 也推翻 ADR-0129 那一句「沒有也講一句」，並定 ADR-0153 那一句放哪
- M2（03／04）：「還差一步」的列拿掉提示行之後找不到 → 給一個標記、也收進發現問題
- M3、M4（04）：N 怎麼數在 domain 定；`pairingNote()` 有四種，各自定放哪
- M6（04）：E2E 要跟著改的清單補齊
- M10（01、05）：`CONTEXT.md:247` 那一句講的是畫面位置 → 一起改；常見問題約 1498 行那一條改寫
- 真名：spec 與 02 引的原話裡一位治療師的名字（本來就在種子上）→ 換成「某璇」
- 分段：沒問題；段二可以先做 03（不吃 02）

## 中途發現

### 段一

- **二返／三返列上只印醫師、不印診間**（種子上）：spec 寫「二返／三返：診間＋醫師」，但種子的二返 `assigns: 'none'`＋`doctorPick` 某一科，
  而設定 → 課程 那一排是四選一（診間／物理治療師／醫師／都不用，ADR-0130）—— 一門課選了醫師就不會同時要診間。`rowGlance()` 照課程設定印（同日曆），
  所以模擬器上是 `三返 夏`。她正式站上的二返如果是舊資料「兩個都有」（ADR-0130 那一句），會印 `三返 VIP5 夏`。**沒改**；
  段四手動驗收時跟她講一句：要診間也印出來，是「二返要不要同時指派診間」這件事（四選一那一排要變），不在這一輪
- 段二接手要知道的：紅字標記接在 `.abl-row__glance` 後面（`.abl-row__what` 已經是 flex、`min-width: 0`）—— 標記本身要 `flex: none`；
  E2E `86` 的 W1 量了 375 寬沒有橫向捲動，加了標記之後照它再量一次
- 01 與 02 在工作目錄裡疊在一起（同一支 `app.css`、`sw.js`）：拆 commit 時是把 02 的檔先搬到 scratchpad、做完 01 再搬回來，沒有用 `git checkout`／`stash`

### 段二

- **「有提醒的」那一塊是我加的**（ADR-0170 已寫進去）：spec 列的「發現問題」只有要改的、要你看、還沒結案、app 有照片沒有、配對那幾句 ——
  照那樣做的話，**只有紅字標記、又不在要你看裡的列**（例：勾著的新的一列撞期）整句只在點開那一列才看得到，「整句在發現問題」不成立。
  所以「發現問題」多一塊「有提醒的」＝辨識結果上有短標記、不在要你看裡的列（連「還差一步」），標記與整句一對一。段四驗收時跟她講一句
- **「要你看」的列在辨識結果上沒有任何標記**（例：照片上三返而沒有健檢、沒先勾）：照 spec（她要「切換之後才看到」），只靠「發現問題 N」那一顆。
  沒改；段四驗收時看她覺得夠不夠
- **記好了的列離開「發現問題」那一頁**（以前在「要你看」裡會留著、標「記好了」）：那一頁是還沒處理的；寫進 ADR-0170
- 03 的 verify：單元測試全綠（5368 條）；E2E 那一半挑了 259 支（`visits.js` 算核心），跑到第 75 支都綠時額度快用完、我停掉的（76 之後那幾支是停掉模擬器造成的假紅）。
  **04 做完跑 verify 時會一起重跑**（`e2e-changes.mjs` 從上一次全綠比）
- **本機只跑了拍 Abovee 那 16 支（她要的）**：她 11/3 說 63 支要半小時太久、「停掉，只跑 16 支」。`aboveeImport.js`／`aboveeConfirm.js` 挑到的 16 支 94 條全綠；
  停掉之前 verify 跑的那 87 條也都綠（停的那一下的 `Target crashed`／`worker process exited (code=3221225794)` 是停掉造成的）。
  **`visits.js`（03）／`app.css`（04）挑到的其餘交給段四開 PR 時的 CI 全量**；單元測試 5388 條全綠
- **04 草稿漏了一種列，這一段修了**（`hasRowNote()`，ADR-0170 那一段與表跟著改）：只有一句「為什麼沒先勾」（讀不到全部來訪、看起來是同一段、app 上同一格取消過而課程不一樣）
  或「名字／課程差一個字」、不在要你看、也沒有紅字的列，照草稿兩頁都不在 —— 那一句只剩點開才看得到，「發現問題 0」灰掉講的「沒事」是假的。
  現在那幾列也在「有提醒的」、算進 N。段四驗收時跟她講一句（「有提醒的」底下不只是有紅字的）
- **抬頭的「要你看 N 段」跟那一顆的「發現問題 N」數的不一樣**：抬頭數要你看＋沒拍到的段（`summarizeAbovee()`，沒動），那一顆再加要改的、有提醒的、照片層級。
  兩個都對，但並排可能讓她以為對不上 —— 段四驗收時看她的反應；要改的話是抬頭那一行的事（她說過抬頭留著）
- **合併扣課那一行（「拆開成兩段」那一顆）兩頁都畫**：那是這一列是什麼、有一顆按鈕，不是說明句；沒收進「發現問題」
- 「app 有、這次照片上沒有」只有「還沒認出是誰」或「沒有對」那一句時也包成一塊、帶抬頭（以前是裸的一行）—— 在發現問題那一頁沒有抬頭會不知道在講什麼
- 段三審查可以多看一眼的：`repaintRow()` 在發現問題那一頁只在「列的那幾列換了」（`rowsSig()` 比要你看／有提醒的／過了還沒結案）或 N 變 0 時整頁重畫，
  其餘照舊只換那幾列＋要改的、app 有照片沒有兩塊＋那一顆的數字；`pickWho()`、`flip()`、拆開、記錄都走 `paintBody()`

### 段三

- 審查結果全部在 `REVIEW.md`。行為要修的三條（R1 換一位之後才變成要你看的列不算進 N、R2 對不上的列勾不勾印的人不一樣、R3 兩句話指向另一頁的「要改的」）都拿 domain 跑過
- 文件要修的三條（R4 ADR-0141 那張表與 CLAUDE.md「簡寫只在三處」、R5 常見問題四處、R6 邊界測試清單 C11-7e）
- 審查時額度到 95%，沒有再多跑 E2E；`visits.js`／`app.css` 的波及是讀程式＋單元測試判的（`REVIEW.md`「不修」）

### 段四

- R1～R8＋順手都修了（每條一個 commit，文件三條併一個；`REVIEW.md` 每條標了 commit）。單元測試 5393 條全綠；本機只跑她說的 16 支 E2E：94 條全綠（9.3 分）
- 手動驗收在本機模擬器走過（`seed:staging` 的假客戶＋一張暫時的假照片，驗完刪了）：剛辨識完只有列、沒有說明句、375 寬不橫捲；
  列上 `三返(30) 夏`、`IL(60) .2`、`SIS(60) 騰崴` ＋紅字「禁忌」；發現問題 4（要改的 1、要你看 2、有提醒的 1、還沒認出是誰 1 —— 同一列只算一件）；
  「要改的」拿掉勾 → 辨識結果那一列印 app 上原本那一位、勾回去印照片上的；拍 Abovee 點開一列展開「送的／體驗／其他…」沒有「別的課當體驗」
- 手動驗收看到的（不是這一輪的、沒改）：照片上寫「雷射 60」認不出課程 → 那一列只印原字「雷射 60」、對不上（`courseFrom()` 的寫法表沒有這個字；真的 Abovee 上不是這樣寫就不是問題）

## 每一段的開場

### 段一（effort high）

這一輪在做「拍 Abovee 辨識完一眼看得完」：她 11/3 驗收完「健檢不是我排的」之後提的四件（列上印診間／醫師、照片下面切換「辨識結果／發現問題 N」、紅字改短標記、拿掉「別的課當體驗」那一行字）。
分支 `claude/abovee-confirm-glance`（已經開好、在上面；`git fetch` 之後落後 `develop` 就 rebase）。

**這一段做 01 → 02，照這個順序。不做 03～05**（段二）。

先讀：`CLAUDE.md`、`docs/agents/lessons.md`、`.scratch/abovee-confirm-glance/spec.md`、這份 HANDOFF 的「每一段共同的規矩」「使用者已經決定的」「過目抓到的」、issue 01、02 全文。

- 01：`giftFold.js` 那一行小標拿掉、CSS、`masterList.js:746` 那一句、操作手冊與 SPEC 講那一行字的地方；比畫面上那幾個字的測試改成釘「沒有那一行」，註解與 CONTEXT.md 的詞與 ADR 不動
- 02：domain 一支回「這一列要印的課程名＋人／診間」（新的列照照片、已經記了的列照存完之後那一段 —— 先看 `afterPhoto()`／`photoDayPlan()` 有沒有現成的），`rowHtml()` 只畫；
  還沒按任何一顆的列（照片上三返）也印得出醫師；人員只准走 `nameOf(row, 'short')`
- 02 會改到 `rowHtml()` 列上那一行；**段二會把列底下那幾行提示搬到「發現問題」那一頁**，所以這一段不要動列底下那幾行

照「每一段共同的規矩」：改前 `ripple-check`、一支一個 commit、先紅燈、`npm run emulators` 起好再 `npm run verify`、升 `VERSION`（現在 v219）、中途發現記進 HANDOFF 段一。

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。**

做完要交：01、02 各一個 commit、`Status: done`、「做完時留下的」；HANDOFF 分段表的狀態、中途發現、要使用者決定的（有才寫）；commit HANDOFF。
最後回覆簡短說做了什麼、卡在哪。

### 段二（effort xhigh）

這一輪在做「拍 Abovee 辨識完一眼看得完」：她 11/3 提的四件（列上印診間／醫師、照片下面切換「辨識結果／發現問題 N」、紅字改短標記、拿掉「別的課當體驗」那一行字）。
分支 `claude/abovee-confirm-glance`（checkout 在上面；`git fetch` 之後落後 `develop` 就 rebase）。**段一做完了**：01（caaca04c）、02（66e610dc：domain 的 `rowGlance()`、`photoDayPlan()` 多回 `slotAfter`、
`.abl-row__what` 改成 flex、E2E `86`）、HANDOFF（939d20ca）。

**這一段做 03 → 04 → 05，照這個順序。** 03 只做 ADR-0170 與 domain（`tagBy`、短字與先後）；04 是畫面（兩頁切換、短標記畫上去、紅線兩支測試、E2E）；05 是文件。

先讀：`CLAUDE.md`、`docs/agents/lessons.md`、`.scratch/abovee-confirm-glance/spec.md`、這份 HANDOFF 的「每一段共同的規矩」「使用者已經決定的」「過目抓到的」「中途發現 → 段一」、
issue 03、04、05 全文、issue 02 的「做完時留下的」、ADR-0138、ADR-0129、ADR-0153。

- 03：ADR-0170 推翻 ADR-0138（拍 Abovee 收著的那一兩行）與 ADR-0129「沒有也講一句」、定 ADR-0153 那一句放哪、N 怎麼數、「還差一步」的標記；
  `mustSeeBy` 維持字串、並排 `tagBy[key]`；來源不只 `warningDetails()`（`trialSay()`、`mergedNotices()`、`photoRowSays()` 都要給短字）；超用／到期在 `entitlementWarnings()` 帶 `kind`，`from()` 一起改；
  先後：禁忌 → 次數不夠 → 撞期 → 重疊 → 過期 → 品項 → 健檢 → 其他 → 還差一步；`+N` 算種不算句
- 04：**只畫目前那一頁**（閉包 `view` ＋ `paintBody()`，同首頁；兩頁同時在 DOM 會讓 `data-abl-row` 重複）；N 在 domain 算；`pairingNote()` 四種各自放；
  紅字標記接在 `.abl-row__glance` 後面、自己 `flex: none`，加了之後照 E2E `86` 的 W1 再量 375 寬沒有橫向捲動；
  `tests/tip-red-lines.test.js`、`tests/abovee-warnings-in-sight.test.js` 改成釘新的保證（不是刪掉）；issue 04 列的那幾支 E2E 跟著改
- 05：操作手冊、常見問題（約 1498 行那一條改寫＋「三返點開沒有醫師」）、SPEC、根目錄 CLAUDE.md 連動表「拍 Abovee 記很多段」「畫面上一段常駐的說明」兩列裡講收著那一兩行的句子（只改那幾句）、邊界測試清單

照「每一段共同的規矩」：改之前照 `ripple-check` 查牽連（`mustSeeBy`、`briefWarnings`、`warningDetails`、`from(`、`abl-row__hint`、`要你看`、`abl__absentsay` 都 grep）；一支一個 commit；先寫紅燈；
`npm run emulators` 起好再跑 `npm run verify`；動到 `public/` 升 `sw.js` 的 `VERSION`（**現在 v221**）並跑 `npm run shell:snapshot`；中途發現記進 HANDOFF「中途發現 → 段二」，不岔出去修；
subagent 同時最多兩個；真名一個字都不進版控。

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。不要推、不要開 PR**（段四做）。

做完要交：03、04、05 各一個 commit、issue `Status: done`、底下寫「做完時留下的」；HANDOFF 分段表的狀態、中途發現、要使用者決定的（有才寫）；commit HANDOFF。
最後回覆簡短說做了什麼、卡在哪。

### 段二（續）：04、05（effort xhigh）

這一輪在做「拍 Abovee 辨識完一眼看得完」（`spec.md`）。分支 `claude/abovee-confirm-glance`（checkout 在上面）。
**段二做了一半**：03 做完（adc3e59d：ADR-0170、`warningTag()`／`rowTag()`／`photoDayPlan()` 的 `tagBy`、`visits.js` 超用／到期帶 `kind`、`sw.js` v222）。
**這一段做 04 → 05**，規矩、先讀的同上面「段二」的開場；另外先讀 issue 03 的「做完時留下的」、ADR-0170 全文、上面「中途發現 → 段二」。

**04 的草稿已經寫好、還沒套**（在這一組 session 的筆記資料夾，repo 外面：`C:/Users/DELL/AppData/Local/Claude-Data/claude_pzs8sxrjxfjjc/side-session-notes/local_28103527-e922-42c0-ab6f-15abed420369/abovee-confirm-glance-04-drafts/`）：
- `edit04domain.py`：`absentShown()`（都在照片上不畫、0 件；還沒認出是誰、沒有對各算一件）、`problemsPage()`（notes／changes／look／later／flagged／absent／count，同一列只算一件）、`notYetOf()`；從 repo 根目錄 `python <路徑>` 跑
- `edit04ui.py`：`aboveeConfirm.js` —— 閉包 `view`／`shownRows`、`pageOf()`、`rowsSig()`、`paintBody()` 只畫目前那一頁、`segHtml()`／`paintSeg()`、`resultHtml()`、`problemsHtml()`（照片層級 → 要改的 → 要你看 → 有提醒的 → 還沒結案 → app 有照片沒有）、
  `notesHtml()`（取代 `pairingNote()`；正常配上那一句拿掉）、`absentHtml(gone, p, shown)`、`repaintRow()` 在發現問題那一頁列的那幾列換了就整頁重畫、`rowHtml()` 的 `say = view === 'problems' || open` ＋ `hintsHtml()` ＋ `flagHtml(rowTag(item, p))`、切換的 click
- `edit04css.py`：`.abl-row__flag`、`.abl__seg`（0 件灰掉）、`.abl__notes`、`.abl__group--flag`、幾段註解
- `abovee-problems-page.test.js`（放回 `tests/`）、`redline-tests.diff`（`tests/tip-red-lines.test.js`、`tests/abovee-warnings-in-sight.test.js` 改成釘新保證；`git apply`）
- 三支腳本都是「字串剛好出現一次才換」，對不上會 assert 失敗、不會寫一半。**套之前先跑紅燈**：放回那支測試與 diff → `node --test` 那三支確認紅 → 套三支腳本 → 綠

套完還要做的：`node --check`；E2E 照 issue 04 那張清單改（`41`、`51`、`57`、`62`、`67`、`68`、`77`、`78`、`85`；找 `.abl-row__hint`、`.abl__group--look`／`--change`／`--gone`、`.abl__absentsay`、`.abl__pairing`、`.abl__later`、`[data-abl-change]` 的，先點 `[data-abl-view="problems"]`；
要點的列不在那一頁時切回 `[data-abl-view="result"]`）—— 我讀過但還沒改：`62` P2／P4 是紅線那一支（改成：辨識結果上 `.abl-row__flag` 寫「禁忌 +1」、沒有 `.abl-row__hint`；切到發現問題「有提醒的」底下兩句；拿掉勾那一列離開那一頁）、
`57` G2 要在兩頁之間切（勾在辨識結果、按鈕在發現問題）、`41` A1 的「照列的順序」那一句已經拿掉（改成斷言沒有 `.abl__pairing`）、A3 的 absentsay 改成只有「照片上的 王曉名 還沒認出是誰，先沒對。」、選了人之後那一塊整個不見、`51` N5 的 a1 不在發現問題那一頁（「已經記了」那一列只在辨識結果）；
新的一支 E2E（剛打開沒有任何說明句、切換、0 件灰掉、短標記收著看得到、375 寬不橫向捲 —— 照 `86` 的 W1 量）登記 `related.js`；`sw.js` v222 → v223、`shell:snapshot`；`npm run emulators` 起好再 `npm run verify`（會連 03 一起重跑，約 259 支、半小時以上，先講）。
05 照 issue 05（操作手冊約 1139–1185 行、常見問題約 1481、1498 行與 495 行那一條、SPEC 約 1997 行、根目錄 CLAUDE.md 兩列、邊界測試清單 N5–N7 與新的兩條）。

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。不要推、不要開 PR。**
做完要交：04、05 各一個 commit、`Status: done`、「做完時留下的」；HANDOFF 分段表、中途發現；commit HANDOFF。

（2026-11-03 做完：04 4306dfb3、05 8b3518ff；E2E 照她要的只跑 16 支，見「中途發現 → 段二」）

### 段三：審查（effort xhigh）

這一輪在做「拍 Abovee 辨識完一眼看得完」（`spec.md`）。分支 `claude/abovee-confirm-glance`（checkout 在上面，最新 89ad64e3）。
**01～05 都做完了**：01 caaca04c、02 66e610dc、03 adc3e59d、04 4306dfb3、05 8b3518ff。

**這一段只審查、不修**：用 Skill 叫 `matt-code-review`，審 `develop`（cd1d29b7）到 HEAD 這一輪全部的改動（Standards ＋ Spec 兩軸，它會開兩個 subagent —— 那就是上限，不要再多開）。
結果寫進 `.scratch/abovee-confirm-glance/REVIEW.md`，分「要修」（每條：哪裡、什麼情境會錯、建議的紅燈測試）、「不修」（理由）、「要她決定的」三塊。主控自己再對最重的幾條會在段四之前做。

先讀：`CLAUDE.md`、`docs/agents/lessons.md`、`spec.md`、這份 HANDOFF 的「使用者已經決定的」「過目抓到的」「中途發現」（段一、段二全部）、issue 01～05 的「做完時留下的」、ADR-0170。

要特別看的（問句；先照 `ripple-check` 查這幾個符號的呼叫端，再 grep 字串）：
- 列上印的人／診間會不會跟按「記錄」存進去的不一樣？（`rowGlance()`、`slotAfter`、`composeGroups()`、`slotOf()`；已經記了的列「要改的」那一格勾／沒勾；改期、合併扣課後一半、沒有時間的舊段那幾條退路）
- 一列有會改變寫入結果的提醒（`mustSee`），會不會在辨識結果上一個標記都沒有？（`mustSeeBy` 與 `tagBy` 是不是兩條路都產、一一對得上；`warningTag()`／`rowTag()` 不在對照表上的退路；`trialSay()`、`mergedNotices()`、`photoRowSays()`）
- 「發現問題 N」的 N 等不等於那一頁列出來的件數？0 件灰掉時是不是真的沒有任何一句只在點開才看得到？（`problemsPage()`、`absentShown()`、`hasRowNote()`、`notYetOf()`）
- 同一列會不會在 DOM 裡出現兩次？在發現問題那一頁勾一列、換一位、拆開、按一顆，回到辨識結果是同一個狀態嗎？N 變 0 會退回辨識結果嗎？（`view`、`pageOf()`、`rowsSig()`、`paintBody()`、`repaintRow()`、`rowEl()`）
- 超用與到期分得出來嗎？`visits.js` 的 `from()` 帶 `kind` 之後，有沒有別的地方比整個 warning 物件、或拿 `from()` 的結果去 `JSON` 比對而被多出來的那一格弄壞？（grep `from(`、`entitlementWarnings`、`source ===`）
- **本機只跑了拍 Abovee 那 16 支 E2E**（她說的）：`visits.js`、`app.css` 挑到的其餘沒跑 —— 看 `app.css` 的改動是不是只動 `.abl-*` 與 `.giftfold*`、`visits.js` 的改動會不會影響壓表／來訪編輯器／試算表的提醒；有疑慮寫進 REVIEW，段四的 CI 全量會再跑
- 375 寬：短標記、課程＋人那一格會不會被截掉或撐出橫向捲動（E2E `86` W1、`87`）
- 「別的課當體驗」：三個入口都不見了？講概念的註解還在？
- 公開 repo：這一輪每一個 commit 訊息、測試、fixture 有沒有真名（人員只准種子上的名字與「某＋名」）

**主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON。不要改程式、不要推、不要開 PR。**

做完要交：`REVIEW.md`（commit）、HANDOFF 分段表段三的狀態、要使用者決定的（有才寫）；最後回覆簡短說找到幾條要修、有沒有要她決定的。

### 段四：照審查修、驗收、PR（effort medium）

這一輪在做「拍 Abovee 辨識完一眼看得完」（`spec.md`）。分支 `claude/abovee-confirm-glance`（checkout 在上面）。**01～05 做完、段三審查做完**（`REVIEW.md`，ca0e4365）；她回答了審查的兩題（見「使用者已經決定的」最後兩條）。

先讀：`CLAUDE.md`、`docs/agents/lessons.md`、`spec.md`、`REVIEW.md` 全文、這份 HANDOFF 的「使用者已經決定的」「中途發現」（段一～段三）、ADR-0170。

**1. 照 `REVIEW.md` 修**（順序 R1 → R8，再看「順手」）：
- R1～R3、R7、R8 每一條先寫紅燈（`REVIEW.md` 每一條都寫了建議的測試）→ 修到綠；R4～R6 是文件
- **R2 照她選的**：「對不上」的列收著時印 app 上存完之後那一段（拿掉「要改的」的勾＝app 上原本的人），勾不勾課程名都不換寫法
- **R1**：認不得的列（名字跟病歷號對到不同人、同名好幾位）照舊算進 N（她選的）；換一位之後才變成要你看的列也要算進去
- 沒改的寫理由進 `REVIEW.md`「不修」；改之前照 `ripple-check`；一條一個 commit（文件三條可以併一個）
- 動到 `public/` 升 `sw.js` 的 `VERSION`（現在 **v223**）＋ `npm run shell:snapshot`
- 本機 E2E **只跑拍 Abovee 那 16 支**（她說 63 支半小時太久）：`node scripts/e2e.mjs 00-smoke 08-ux-audit 41-abovee 51-abovee-picks 53-bed-rooms 57-abovee-absent 62-prelaunch-photos 65-followup-link-before-exam 67-gift-and-trial 68-abovee-status-follows-photo 69-staging-polish-small 77-chart-number 78-before-golive-seg3 85-exam-not-mine-abovee 86-abovee-row-glance 87-abovee-result-and-problems`（`npm run emulators` 先起；單元測試照跑 `node --test "tests/*.test.js"`）

**2. 手動驗收清單：自己在本機模擬器走過**（`npm run emulators` 背景 ＋ `seed:staging` 對模擬器；**不要碰 staging／正式**），走得通才寫進 PR，照「你可以怎麼點」寫、一個真名都不帶：
拍 Abovee 用模擬器的假模型（fixture `aboveeList-glance.json` 等）—— 剛辨識完只看到辨識結果、沒有說明句；列上印課程＋人／診間（三返印醫師、沒認到印灰色「醫師？」）；紅字短標記；切到發現問題 N、0 件灰掉；
「要改的」那一格勾／拿掉、列上印的人跟著變（R2）；「送的／體驗／其他…」展開沒有「別的課當體驗」那一行（壓表、日曆新增、拍 Abovee 各看一眼）。真照片那一條交給她在 staging 點

**3. 全量 E2E 交給 CI**：本機只跑了 16 支，所以推上去之後 `gh workflow run e2e-full.yml --ref claude/abovee-confirm-glance`（六台），跟 PR 的 CI 一起等

**4. 開 PR 進 `develop`**（不是 `main`）：內文寫這一輪做了什麼（連 ADR-0170）、審查修了哪幾條（連 `REVIEW.md`）、手動驗收清單、她在 staging 要點的；**推之前與開 PR 之前自己看一眼 commit 訊息與內文有沒有真名**（repo 是 public）。
開完照 ccd_pr：`get_status`／`bind_pr`；**PR 的 CI 與 e2e-full 都綠就合進 `develop`**（CLAUDE.md：她 10/15 說過不用再問）；合完 staging 自動部署。這一輪沒動 `functions/`、沒動 `.gs`，不用另外部署。**不進 `main`**

**5. 最後回覆給她**（白話）：修了什麼、PR 與 CI 結果、她在 staging 照順序點的清單，以及這幾件要跟她講一句（HANDOFF 中途發現）：
二返／三返那一列只印醫師不印診間（二返在設定上是「醫師」那一種，四選一；要兩個都印是另一件事）；「發現問題」多一塊「有提醒的」（不只有紅字的列，連只有一句「為什麼沒先勾」的也在）；
「要你看」的列在辨識結果上沒有標記、只靠那一顆的數字；抬頭的「要你看 N 段」跟「發現問題 N」數的不一樣

**這是最後一段：不要開 session、不要存 limit-guard 的開場 JSON。** 額度快用完時：收到一致的狀態、HANDOFF 寫「段四（續）」的開場、commit，跟主控說停在哪。

做完要交：每條一個 commit、`REVIEW.md` 每條標修了沒（哪個 commit）、HANDOFF 分段表段四的狀態與 PR 連結、合進 `develop` 的 commit。
