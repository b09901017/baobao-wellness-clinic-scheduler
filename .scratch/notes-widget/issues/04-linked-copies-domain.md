# 04：複製到別天、連在一起（domain ＋ data ＋ Rules）

Status: done
Blocked by: —（長按選單怎麼重排：HANDOFF「她已經決定的」—— 主控 11/6 問她）

## 動工前先讀

- `spec.md`「二、複製到別天」（那張表與「怎麼列」）
- HANDOFF「過目抓到的」1–9（**這一支的大半**）與「她已經決定的」（長按選單重排、清單上一列＝一組時哪些動作作用在整組）
- ADR-0044（掛了日期就上日曆；**日曆那一類就是隨手記本人**）、ADR-0045、ADR-0059（營養品的提醒）、ADR-0060（長按的每一顆都要另有一條路）、ADR-0106、ADR-0152／0166（三格與已完成）、ADR-0158（讀不完整就不存 —— **隨手記不擋**）
- `CLAUDE.md` 連動表：「隨手記的欄位或那一列的樣子」「日曆上『待辦』那一類」「待辦首頁的『逾期／今天／明天』」「營養品的形狀或交付」「客戶改名」「刪掉一位客戶」「新增一個會寫進稽核的欄位」「稽核或回顧上那一句話」「`data/backup.js` 的 `exportAll()`」「任何一列的長按選單」
- `public/js/domain/notes.js` 全部（`normalize()`／`normalizePatch()` 的檔頭：完整文件 vs 只有變了的那幾欄 —— 2026-08-25 的坑）；`noteActions()` 與 `tests/notes.test.js:332`（**最多五顆＋先不要＝六**，`ui/components/actions.js:173` 的上限）
- `public/js/data/notes.js`（`create`／`update`／`setDone(id, done)`／`remove`、`recordDelivery`）、`public/js/data/repo.js` 的 `commit()`（一個 commit 寫好幾筆、每筆一則稽核）
- `public/js/domain/audit.js` 隨手記那幾句（`:570-604`）與通用的修改句（`:787` 要至少一個欄位）、`tests/audit-field-words.test.js`；`domain/dayReview.js` 的 `collapse()`（`:263`，連續一樣的收成 ×N）
- `docs/agents/lessons.md` 一、二（拿部分資料去算／去寫）、三、五

## 她要的

> 我想要連起來誒，不然就是可以複製的時候決定，但預設是連起來的，然後複製這個功能也可以放入長按裡面? 長按就可以選複製

> （連在一起的每一列旁邊多一顆「共 3 天」）應該只會有一列吧 ? 不會有三列 ? 還是你建議有三列 ? 還是甚麼呈現方式 ? 聽你的

（主控回答、她沒有異議：清單類一組一列；日曆與逾期／今天／明天每天各一列；數字一組算 1。）

## 為什麼會這樣

隨手記現在一筆就是一件事：`done` 一格、`date` 一格。「同一件事綁很多天提醒，其中一天勾掉其他天也勾掉」（backlog 第 14 條）要的是**好幾筆共用一個勾**。
日曆那一類用 `date` 查（ADR-0044），所以最省的做法是**每一天一筆真的文件**（日曆、三格、查詢一行都不用改），再用一格把它們連起來。

## 要做的

### 形狀

- 每一筆多一格選填的 **`linkId`**：連在一起的那一組共用一個字串，**用最初那一筆的 id**（重試、重按都還是同一個 → 冪等）；複製一筆已經連著的 → 沿用它的 `linkId`。
  名字定了 Kotlin（06）照抄 —— 改名要兩邊一起改
- **「連在一起」＝同一個 `linkId`、還活著（沒軟刪除）的有兩筆以上**。只剩一筆時不必清 `linkId`（刪掉、還原、復原都自動對）；判斷只有一支（例 `linkedPeers(note, notes)`）
- `normalize()` 帶它；`normalizePatch()` **只在有帶到時碰它**；`validateNote()`：`linkId` 與 `entitlementId` 不能同時有
- `firestore.rules` 的 `validNote()`：`linkId` 沒有、null、或不太長的字串（Rules 測試補一條）
- **不經過 `normalize()` 的建立路**（`deliveryNoteFor`、`data/customers.js:154` 買營養品長的提醒、`legacyImport`／`mergeImport`、`home.js` 的 `saveFollowupNote`）：確認它們不會帶出 `linkId`、也不需要
- 稽核：`linkId` 給 **`FIELD_LABELS`**（不是 `QUIET_IN_SENTENCE`：複製時原本那一筆是一個只改 `linkId` 的修改，放進 QUIET 之後一個欄位都不剩，`describeParts` 退回「修改隨手記」），
  再加兩句：連到別天（例「把待辦「x」連到另外 N 天」）、拆開（「把待辦「x」的 11/8 拆開」）。`tests/audit-field-words.test.js` 跟著改。**不可以進 `NOISE_FIELDS`**

### 規則（純函式，`domain/notes.js`）

- **一起變的照「真的變了什麼」，不是照帶了哪些鍵**：日曆編輯器每次存都帶 `text`、`date`、`customerId/Name`（`calendar.js:1497-1513`）。跟這一筆存之前比：
  字或掛給誰變了 → 同一組每一筆；日期變了 → 只這一筆；勾／拿回來 → 每一筆。沒變的不寫（不然每存一次另外 N 天各多一則什麼都沒變的稽核）。一支寫（例 `linkedChanges(before, after, peers)` → 每一筆要寫什麼）
- 複製：`copyPlan(note, dates, { linked })` → 要新建的幾筆（文字、掛給誰；`done: false`；`date` 照選的；`entitlementId` 不帶）＋原本那一筆要不要補 `linkId`。
  **營養品的提醒不給複製**（plan 拒絕）。連在一起時：同一組那一天已經有一筆 → 不再建
- 清單類的分組：`groupLinked(notes, today)` → 一組一列：那一列代表的那一天＝今天或之後最早的；全部過了＝最後一天；**沒有日期的成員**（被拿掉日期的）不當代表、但算在「共 N 天」裡嗎？—— 定一個、寫進 ADR（建議：「共 N 天」數**不同的日子**，沒日期的不算一天）；
  **同一天兩筆**（改日期改到撞）照一天算。順序照 `sortNotes()`，一組用代表那一筆排。沒有 `linkId`（或只剩一筆）的照舊一筆一列
- 數字一組算 1：`openCount()`、首頁 `notesCard()` **先分組再 `slice(0,4)`**（`home.js:1555`）、`#/todo/notes` 的未完成／已完成（`:4289-4293`）、客戶詳情的「N 未處理」（`customerDetail.js:229、305`）、「清掉這 N 筆」（`:4374`）
- `noteActions()`：照她決定的重排（HANDOFF「她已經決定的」）；**上限照舊五顆＋先不要**（`tests/notes.test.js:332` 那一條照舊要綠，加連在一起的情境）
- 清單上一列＝一組時，哪些動作作用在整組、哪些只作用在代表那一天：照 HANDOFF「她已經決定的」

### 寫入（`data/notes.js`）

- **寫的那一刻照 `linkId` 重讀同一組**（只用等號查、不加排序 → 不用新索引；加了就要補 `firestore.indexes.json`）：畫面手上那一份都只是一部分（日曆一個月、首頁 `listOpen`、客戶詳情一位、小工具的快取）—— lessons 二
- 一組一起變的同一個 commit（每一筆一則稽核照舊）。`notes.setDone(id, done)` 的形狀被 `prepareToggle`（`note.js:316`）、`runAction`、三份 `noteDeps()`（`home.js:1832`、`calendar.js:1297`、`customerDetail.js` 約 `:1567`）用著 —— 改形狀就三份一起改；**營養品的提醒那一條路（`recordDelivery`）不碰**
- 複製一個 commit 建好幾筆；按鈕帶 `key`（`CLAUDE.md`「一個會建立新資料的按鈕」）
- **離線**：重讀只拿得到快取裡的那幾筆（ADR-0158 說隨手記不擋）→ 照寫，**資料健檢加一項提醒**「連在一起的一組勾得不一樣」（只列不修，`notice`；接在 `CHECKS` 最後面，兩支寫死總數的測試跟著改）。
  垃圾桶還原（`trash.js:165`）、復原也可能帶回一筆跟同組勾法不一樣的 —— 同一項會列出來

### 讀的那幾處

- 清單類（首頁那張卡、`#/todo/notes`、客戶詳情）走 `groupLinked()`；日曆、三格（`todoBuckets()`／`doneBuckets()`）**照舊每一天一筆**
- 客戶改名（`renameTargets()`：還沒勾的才換 → 同一組一起換，確認）、刪客戶（`deleteBlockers()` 那一句一組算 1）、資料健檢的孤兒檢查（`health.js:580`，一組一行）
- 「今天做了什麼」：`collapse()` 已經把連續一樣的收成 ×N（勾一組會讀成「勾掉待辦「x」×3」）—— 確認讀起來對、**不另寫一句**
- 備份還原：`linkId` 是一般欄位，確認 `restore-backup.mjs` 不用改

### 文件

- **ADR-0178**：為什麼每天一筆＋`linkId`（不是一筆帶好幾個日期）；哪幾種一起變、哪幾種只動一筆；「連在一起」＝活著兩筆以上（不清 `linkId`）；`linkId` 用最初那一筆的 id；離線可能勾不完整、資料健檢列出來
- `CONTEXT.md`：「連在一起的隨手記」；`SPEC.md` 隨手記那一節；`docs/課程與待辦對照表.md` 不相干（不用改）

## 判準

- 勾一組裡過去的那一天，**還沒到、而且不在畫面上的**那幾天有沒有一起勾掉？（日曆只讀了這個月時也要對 —— 重讀）
- 在日曆編輯器只改日期按存，另外那幾天有沒有被寫一筆什麼都沒變的稽核？（不可以）
- 一筆沒有 `linkId` 的舊隨手記，勾、改字、改日期、刪掉的行為跟現在**一模一樣**嗎？（`tests/notes*.test.js` 既有情境各跑一次）
- 複製按兩次、或失敗重按，同一天會不會多出兩筆同組的？
- 營養品的提醒能不能被複製、能不能被連進一組？`validateNote()` 擋不擋 `linkId`＋`entitlementId`？
- 首頁「隨手記 N」、首頁那張卡的四列、`#/todo/notes` 的兩個數字、客戶詳情「N 未處理」：一組三天算 1 嗎？日曆與今天那一格：三天各一筆嗎？
- 只剩一筆（其他刪了）→ 那一筆還顯示「共 1 天」嗎？（不顯示）還原刪掉的那一筆 → 又連回來嗎？
- 稽核頁、「今天做了什麼」講複製與拆開時，講得出是哪一筆待辦嗎？（不是「修改隨手記」）
- `normalizePatch({ text })` 會不會把 `linkId` 清掉？（不會）
- 長按選單在任何情境都不超過五顆（＋先不要）嗎？

## 做完時留下的

段一（2026-11-06）。**ADR 是 0179，不是 0178**：0178 被平行的試算表那一輪先拿走了（`claude/sheet-no-freeze` 的 `0178-sheet-nothing-frozen.md`，已推上去）。
所以這一輪往後挪一號：**0179 連在一起的隨手記、0180 原生小工具、0181 鍵盤**（要寫的話）。

**名字定了（Kotlin 06 照抄）**：欄位 **`linkId`**（字串，選填；一般的隨手記是 `null`）。Rules 收：沒有、null、1～64 字的字串；跟 `entitlementId` 不能同時有。

`domain/notes.js` 新的（都是純函式，`tests/notes-linked.test.js`）：

| 函式 | 回什麼 |
|---|---|
| `linkedPeers(note, notes)` | 同一組其他**還活著**的那幾筆（不含自己）。判斷「連在一起」只有這一支；`isLinked()` ＝ 它不是空的 |
| `linkedChanges(before, patch, peers)` | `[{ id, changes }]`：這一筆在第一個、只寫真的變了的；字、掛給誰（兩格一起）同一組一起；日期、`linkId` 只這一筆；**`done` 是她明說的值** —— 這一筆其實已經勾了時另外那幾天照樣對齊 |
| `copyPlan(note, dates, { linked, group, newLinkId })` | `{ blocked, linkId, link, creates, skipped }`。`group` 是照 `linkId`（沒有就照它的 id）重讀的、**含已刪除的**。營養品的提醒 `blocked`；同一組那一天已經有活著的一筆進 `skipped`；拆開過的（id 被舊組當 `linkId`）與已勾掉的用 `newLinkId`（已勾掉的那一筆自己不拉進來） |
| `groupLinked(notes, today)` | `[{ note, members, days }]`。鑰匙是 `linkId`＋勾了沒（勾得不一樣分兩列）。`note` 是代表的那一筆（今天或之後最早的；全部過了最後一天；沒日期的不當代表）；`members` 照日期；`days` 不同的日子 |
| `linkedBadge(row)` | 「共 N 天」（兩天以上）／「共 N 筆」（兩筆以上但只有一天）／null |
| `dateChoices(note, { today, onCalendar })` | 「改日期」那張卡：`today`（已經是今天、已勾掉的不給）、`pick`、`undate`（有日期才給、營養品不給；日曆上 label「從日曆拿掉」） |
| `noteActions(note)` | 一般：`tick`/`untick`、`date`（「改日期」）、`who`、`edit`、`copy`（「複製到別天」，icon `copy` —— **icons.js 還沒有，05 補**）。營養品：`tick`、`date`、`bag`。第二個參數照傳、用不到了 |

`openCount()` 改成數列（一組算 1）。`normalize()` 每一筆都寫 `linkId: null`；`normalizePatch()` 只在有帶到時碰它。

`data/notes.js`：
- `listLinked(linkId)`：`listWithDeleted` ＋ `where('linkId','==',…)`，不加排序（不用新索引）
- `update(id, changes)`、`setDone(id, done)`：先 `getOne` 重讀這一筆；有 `linkId` 再 `listLinked` 重讀那一組；**沒有連在一起的跟以前一模一樣**（整份 patch 寫下去）；連在一起的走 `linkedChanges()`、一個 commit。`setDone` 回的形狀沒變（`{ done, doneAt }`）
- `removeRow(note, reason)`：清單上的一列 —— 同一組跟它勾法一樣的整組一起軟刪除（一個 commit）。`remove()` 照舊只刪一筆（日曆編輯器用它）
- `copyTo(note, dates, { linked = true })` → `{ created, skipped, linkId }`：重讀之後 `copyPlan()`、一個 commit（補 `linkId` ＋ 新的那幾筆）；這一筆被刪了、營養品的提醒會丟錯（訊息就是要講給她的那一句）
- `unlink(id)`：`{ linkId: null }`

畫面這一支先做了的（05 接著做樣子）：首頁那張卡**先分組再取四列**、`#/todo/notes` 兩個數字與「清掉這 N 筆」數列、垃圾桶與清掉走 `removeRow()`、客戶詳情「N 未處理」與那一塊一組一列、刪客戶那一句一組一行（帶「共 N 天」）。
**還沒做（05）**：`runAction()` 還不認得 `copy`（按了沒反應）、`date` 還是直接開舊的挑日期卡（沒有「改成今天／拿掉日期」）—— 這兩個 commit 之間長按少了改成今天與拿掉日期，05 補回來。

資料健檢：最後一項 `linkedNotes`「連在一起的隨手記勾得不一樣」（`notice: true`、不修，總數 37 → 38，`chart-no-field`／`eecp-one-course` 釘位置的兩條跟著改）；孤兒資料一組只列一行。
稽核：`FIELD_LABELS.linkId = '連在一起'`；「待辦「x」・連到別天」「待辦「x」・11/8(日) 拆開」。「今天做了什麼」勾一組連續一樣的照舊收成 ×N（沒另寫）。

確認過不用改的：`deliveryNoteFor`／`data/customers.js` 買營養品長的提醒、`legacyImport`／`mergeImport`、`home.js` 的 `saveFollowupNote` 都不經過 `normalize()`、不帶 `linkId`（文件上沒有那一格＝沒有連在一起，讀的那一側都用 `trimmed()` 認）；
`renameTargets()` 換的是這位客戶全部還沒勾的隨手記 → 同一組還沒勾的一起換；`restore-backup.mjs` 照欄位原樣寫回，`linkId` 是一般欄位不用改；`trash.js` 還原一筆就自動連回去（`linkId` 沒清）。

**已勾掉那幾筆的長按「刪掉」放不下了**（她的五顆裡沒有它）—— 段末問她（HANDOFF「中途發現 → 段一」）。
