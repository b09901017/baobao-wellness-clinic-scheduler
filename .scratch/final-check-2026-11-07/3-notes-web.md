# 上 main 前最後健檢・第 3 組：隨手記的網頁那一半

2026-11-07。只查、只寫報告：沒改 app 的程式、沒 commit、沒推。查的是 develop `a8081e6b`。

| 範圍 | merge commit | 內容 |
|---|---|---|
| PR #221 | `6dda1024` | 複製到別天＝連在一起（ADR-0179）、打名字跳出客戶、掛給誰的搜尋、鍵盤不蓋住輸入框（ADR-0181）、給小工具的兩條網址 |
| PR #224 | `a8081e6b` | 給營養品選到已經約了的那一包：改原本那一筆提醒、不長第二筆 |
| PR #203 的 issue 05 | `f5fb7b0a` | 隨手記「挑日期」按一下就選好 |

對照基準：`.scratch/notes-widget/` 的 spec、HANDOFF（段一～段五）、REVIEW（R1～R8）、issue 01～05、10；ADR-0179、ADR-0181；
`.scratch/small-fixes-2026-11-05/issues/05`；`.scratch/give-bag-once/issues/01` 與兩支 PR 的內文；CLAUDE.md 六列（`linkId`、欄位、貼底、整頁的一層、找客戶的框、營養品）。

## 結論

- **沒有一定要在合進 main 之前修的程式問題。** 她最擔心的「平行合進來的互相踩到」也沒有：#221 與 #224 合併的那一刻都已經把 develop 最新的那一份合進去了（見「查過沒事」第 13 條），#203 的「挑日期」在 #221 之後照樣按一下就選好。
- 找到一條**會寫錯資料**的，但它是**正式站上本來就有的舊缺口**（日曆的待辦編輯器可以把營養品的提醒改掛給別人 → 勾掉時不問給了哪幾款、交付紀錄沒記）；#221 多給了它一條更容易碰到的路（打名字跳出客戶）。修法約 5 行，放在「可以之後再做」第 1 條，要順手修也可以。
- 上 main 之前**不是程式、要她做的一件**：PR #221 內文清單的 **B 段（15～22，鍵盤、注音、iPad、深色）** 我在 HANDOFF 與記憶裡都沒看到她點過的紀錄 —— 鍵盤那一條改的是全站的版面，只有手機／iPad 主畫面那一顆驗得到（桌機的 E2E 只能用縮視窗模擬）。

---

## 合進 main 之前建議修

**沒有。**

（唯一會寫錯資料的那一條不是這三支 PR 造成的、正式站上已經有，所以不擋合併；見下一段第 1 條。）

---

## 可以之後再做

### 1. 日曆的待辦編輯器可以把「營養品的提醒」改掛給別人 → 勾掉時不問給了哪幾款、交付紀錄沒記（舊缺口，#221 多一條路）

- **PR／檔案**：正式站上就有（`origin/main` 的 `calendar.js:1409` 起，既有的隨手記照樣畫「掛給誰」）；#221 之後在 `public/js/ui/views/calendar.js:1423-1431`（`note.who()` 不看 `existing.entitlementId`）與 `:1453-1458`（`wireCapture()` 連打名字跳出客戶一起接上）
- **看到什麼**：長按營養品的提醒，選單刻意沒有「掛給誰」（`domain/notes.js:537-542`：「它已經是一包了」）；但日曆 → 點那一筆 → 鉛筆打開的編輯器照樣有「掛給誰」，而且 #221 起在「記什麼」裡打別人名字的開頭，跳出來那一排點一下也會改掛給他。
  改掛之後那一筆是「客戶B 身上、`entitlementId` 是客戶C 那一包」。之後點它勾掉：`prepareToggle()` 讀**客戶B** 的額度找不到那一包（`note.js:541-551`）→ 退回普通的勾掉，**「給了什麼？」不問、交付不記**
- **怎麼重現**（本機模擬器，假資料客戶B／客戶C）：
  ```
  npm run emulators
  HEADLESS=1 npx playwright test --config .scratch/final-check-2026-11-07/pw.config.mjs --project phone -g "X1|X2"
  ```
  實際輸出：
  ```
  改完： {"customerId":"cust-b","entitlementId":"ent-c-prod"}
  勾掉： {"askedGiven":false,"done":true,"deliveries":[]}        ← X1：用「掛給誰」那一顆改
  打名字之後： {"customerId":"cust-b","entitlementId":"ent-c-prod"}  ← X1b：#221 的打名字跳出客戶
  長按選單： ["做完了，勾掉","改日期","看那一包營養品"]               ← X2：對照，長按沒有「掛給誰」
  ```
- **為什麼重要**：交付紀錄是要進試算表的那一份（ADR-0059），少記的時候畫面上看起來就只是勾掉了，要到她對帳才發現（`note.js` 檔頭自己寫的那一個坑）。
  機率低：要在日曆編輯一筆營養品的提醒、又去點「掛給誰」或在字裡打別人的名字開頭
- **建議怎麼修、多大**：`mountNoteEditor()` 裡 `existing?.entitlementId` 時不畫「掛給誰」（跟長按選單同一條：客戶由那一包決定），`readCapture()` 那一下照舊帶原本的客戶；打名字跳出客戶跟著不接（`wireSuggest()` 本來就在「選了一包」時不出現，這裡多一個「它本來就是一包」）。
  約 5 行＋一支 E2E（上面的 X1 改成斷言「看不到掛給誰」）。要不要把已經被改掛的找出來：資料健檢「掛的客戶」那一項（`checkOrphans()`）可以多比一句「提醒的客戶跟那一包的主人不一樣」—— 先問她要不要

### 2. 打字時轉方向，鍵盤還開著 → `html[data-keyboard]` 掉了，底部導覽列站回鍵盤上面

- **PR／檔案**：#221，`public/js/ui/keyboard.js:48-53`：寬度一變就把「量過最高的」換成**現在的**高度 —— 鍵盤還開著時，現在的高度就是扣掉鍵盤的那一截，於是判成鍵盤沒開
- **怎麼重現**（不用模擬器，頁面只有一格輸入框＋真的 `keyboard.js`，用縮視窗模擬鍵盤，同 E2E `100`）：
  ```
  node .scratch/final-check-2026-11-07/keyboard-rotate.mjs
  ```
  實際輸出：
  ```
  直的、鍵盤開著（版面 832 → 452）       data-keyboard=true
  轉成橫的、鍵盤還開著（832×180）         data-keyboard=false   ← 這裡
  橫的、鍵盤收起來（832×384）             data-keyboard=false
  橫的、鍵盤再打開一次（832×180）         data-keyboard=true    ← 收一次再開才回來
  ```
- **為什麼重要**：手機寬度（三星直的 384、橫的 832，都小於 900）橫著打字時剩一百多 px，導覽列再吃掉約 58px；鍵盤收一次就好了。manifest 是 `orientation: any`，轉得過去。HTC 橫的是 914 寬（走 iPad 的側邊導覽），碰不到
- **建議怎麼修、多大**：「量過最高的」照寬度各記一份（`Map` 以 `innerWidth` 為鑰匙，轉回來沿用那一個方向量過的），約 5 行；`tests/keyboard.test.js` 現在只測純函式，可以順便把 `check()` 抽成吃 `{width, height, focused}` 的純函式一起測

### 3. 「改日期」那張卡寫死「只改這一天」，選單同一件事講「只改這一筆」（R2 沒收乾淨的一個字）

- **檔案**：#221，`public/js/ui/components/note.js:1001`（`linked ? '只改這一天' : null`）；選單那一行走 `linkedWords().date`
- **重現**：一組兩筆、一筆 11/8、一筆沒日期（拿掉日期之後就是這樣）—— `linkedReach()` 回 `{"days":1,"count":2,"unit":"筆"}`，選單「改日期」底下是「只改這一筆」，點進去卡片寫「只改這一天」（指令見最後一節）
- **重要性**：很低，兩句都不是假話；R2 要的是「一種算法」，這一處沒接
- **修法**：`askDateChange()` 收 `reach`、用 `linkedWords(reach).date`，一行

### 4.（順手）「給營養品」名單上的「已經約了」印 ISO 日期、沒日期的提醒不講「已經有提醒」

- **檔案**：舊的（`public/js/domain/products.js:386`），跟 #224 有關所以記一筆
- **重現**：`givableBags()` 那一包的提醒有日期 → `還沒給：夜態美・2026-11-10 已經約了`；提醒沒日期 → `還沒給：夜態美`（指令見最後一節）
- **重要性**：低。買營養品時自動長的那一筆提醒常常沒有日期，她選那一包之前看不出「本來就有一筆」；#224 之後選了是改那一筆，存完 toast 會講「這一包本來就有提醒，改好了」，所以不會多一筆，只是事先看不出來
- **修法**：`shortDate(note.date)`；有提醒就講（有日期「11/10(二) 已經約了」、沒日期「已經有一筆提醒」），兩行

---

## 查過沒事的

| # | 查了什麼 | 怎麼查 | 結果 |
|---|---|---|---|
| 1 | 連在一起的判斷只有 `linkedPeers()`（同一個 `linkId`、活著的、不含自己） | 讀 `domain/notes.js:200-204`，grep 全站沒有別處比 `linkId` 判連在一起（健檢、Rules、稽核只讀不判） | ✓ |
| 2 | 哪幾種一起變：勾／拿回來、字、掛給誰一起；日期、`linkId` 只這一筆；照真的變了什麼（只改日期那一下另外那幾天不寫）；勾不勾是她按的那個值（舊的那一份也對齊整組） | 讀 `linkedChanges()` `:222-269`；單元 `tests/notes-linked.test.js` 全綠；E2E `97` 的 L4（只改日期稽核不多一則）本機綠 | ✓ |
| 3 | 寫的那一刻照 `linkId` 重讀、一組一個 commit | `data/notes.js` 的 `update()`／`setDone()`／`removeRow()`／`copyTo()` 都先 `getOne()`＋`listLinked()`、`writeAll()`／`repo.commit()` 一次寫；`withUndo()` 一批 → 復原整組一起退 | ✓ |
| 4 | 沒有 `linkId` 的隨手記行為不變 | `freshWithPeers()` 沒 `linkId` 不多讀那一組、`update()` 照舊整份 patch、`setDone()`／`remove()` 一樣；`removeRow()` 沒連在一起退回 `remove()` | ✓ |
| 5 | 清單類一組一列、日曆與三格每天一列 | `groupLinked()` 的呼叫端：首頁那張卡（先分組再取四列）、`#/todo/notes`（兩個數字、清掉這 N 筆）、客戶詳情（「N 未處理」、列表）、刪客戶那一句；`todoFlow.js` 只 import `isOpen`／`isLive`／`sortNotes`（三格不分組）；日曆照 `datedIn()` | ✓ |
| 6 | 「會作用在幾天」只問 `linkedReach()` | grep `peers.length`／`linkedDays`／「另外 ${」：選單、兩張卡、日曆那一行、兩種 toast、清單那一顆都走它；只剩上面第 3 條那一個字 | ✓（一個字除外） |
| 7 | 從已勾掉的那一筆複製（ADR-0179 決定 2） | 讀 `copyPlan()` `:299-361`，自己推過：勾掉的不拉進來、新的那一組用它的 id、它自己不寫 `linkId`；拆開過、或它的 id 那一組有勾掉的 → 新的 id；先勾掉複製、再拿回來、再複製 → 不會連回舊的那一組；刪掉的成員不擋同一天、還原回來自然連回去 | ✓ |
| 8 | 打名字跳出客戶：游標前往前到空白標點、最長的是名字**開頭**的尾巴、最多 6 位、全名就是已經掛的那一位不跳、注音選字中不找、點了換全名＋掛給他＋框不失焦、選了一包不出現 | 讀 `nameSuggestions()`（`from`／`to` 是 UTF-16 位置、跟 `tail.length` 一致）與 `wireSuggest()`；E2E `98` 的 S1～S8 本機綠 | ✓ |
| 9 | 「掛給誰」兩份名單的搜尋（名字或病歷號，一格一格問）；一次性客人列出來、標「一次性」 | 讀 `whoMatches()`、`wireWho()`、`askCustomer()`（濾停用的，照 03 刻意各自保留）；`guestTag()` 三處都畫；首頁那一格與日曆的 `<form>` 裡 Enter 不送出 | ✓ |
| 10 | 鍵盤：`interactive-widget=resizes-content`、`html[data-keyboard]` 收導覽列與 `.fab`、只在 ≤899 | 讀 `index.html`、`keyboard.js`、`app.css:247-255`；E2E `100` K1～K5 本機綠。導覽列在 flex 流裡（`order: 2`），收起來高度還給內容；toast（66px 基準）、`.bulkbar`／`.cform__bar`（sticky、`--toast-lift`）、`.deck`／`.abl`／`.cam`／抽屜（`inset: 0`、`dvh`）跟著縮小的版面走，沒有一個寫死高度；`tests/full-height-units.test.js` 綠。iPad 橫放 ≥900 不套；Safari 不縮版面 → 永遠不成立、不會讓開兩次（只有實機能確認，見結論第 3 點） | ✓（實機另驗） |
| 11 | 鍵盤跟 #215（開機、登入不先載 Google）的接線 | `watchKeyboard()` 在 `app.js` 最上層叫一次、自己有 `started` 旗標、掛在 `window`／`document`，殼畫第二次、換成登入頁都不受影響；#215 沒動 `app.js`／`index.html` | ✓ |
| 12 | 兩條網址：`#/todo/notes/note/<id>`（營養品的提醒先問給了哪幾款、一般的跳長按選單）、`#/todo/notes/new/give` | `views.js:53-60`、router 照格數比（`router.js:23-26`，不會撞 `/todo/:group`）；`renderNotesLink()` 處理完 `replaceState` 換回 `#/todo/notes`；E2E `99` W1～W5 本機綠；`tests/notes-parity.test.js` 盯著網址登記與格式 | ✓ |
| 13 | **平行合進來的有沒有互相踩到**（first-parent 順序 #203 → … → #210 → #214 → #215 → … → #221 → #222 → #224） | `git merge-base`：#221 合併時的基底就是當下 develop 的頂（#220），#224 的基底是 #222 合進去之後的頂 → 兩支都已經把 #203、#210、#214、#215 合進自己的分支再合回來，不是「沒看過彼此」；#221 的 `app.css` 差異只有五塊（鍵盤收導覽列那一條＋隨手記四塊，沒有把 #212／#214 的規則合掉）、`home.js` 差異只有隨手記；#214 只動任務列、#215 只動相機／登入 | ✓ |
| 14 | #203 的「挑日期」在 #221 之後還是一下就開 | `field()`／`read()`／`wire()`／`wireOne()` #221 一行都沒動；`.notemeta` 裡 `.notedate` 是 `display: contents`，但「挑日期」那一顆本身是 `.chip`（`position: relative`），透明的日期框照舊蓋滿它；全站沒有 `showPicker(`；E2E `91`（量中間與兩頭 `elementFromPoint()` 是日期框）本機綠 | ✓（手機上原生選擇器只有實機） |
| 15 | #224：三個入口（泡泡、首頁那張卡、日曆新增）都改叫 `createOrMove()`；寫之前照 `entitlementId` 重讀；選了日期才改日期；勾掉／刪掉的不算；沒掛一包的跟 `create()` 一樣 | 讀 `data/notes.js:92-101`；單元 `notes-give-bag-once` 5 題綠；E2E `98` C3、`99` W1 本機綠；**日曆新增那一個入口原本沒有 E2E**，我加的 X3 走了一次：改本來那一筆、日期換成那一天 | ✓ |
| 16 | #224 只用 `entitlementId` 查、不比客戶 | 額度的 id 全部是 Firestore 自動 id（`repo.newId()`：建客戶、加購、合併檔匯入 `legacyImport.js:79` 都是），不同客戶不會撞 | ✓ |
| 17 | #224 跟 `linkId` 的規則 | 營養品的提醒不能連在一起，`createOrMove()` 改的那一筆不會有 `linkId`、也不寫它；它走 `update()`（沒連在一起就是原本那一條） | ✓ |
| 18 | 同一個形狀（「一包只有一筆還沒勾的提醒」被另一個入口直接新增） | grep 全站 `notesData.create(`：客戶詳情「約時間」有提醒就改那一筆（讀這一位的隨手記、每次寫完重讀）；加購時自動長的是新的那一包自己的；跟客人確認時間那一句不是營養品 | ✓ |
| 19 | 營養品的提醒不能連 | 實際擋的是 `copyPlan()` 的 `blocked`、選單沒有那一顆、`copyAction()` 一進來就退、Rules；`validateNote()` 在 app 裡**沒有任何寫入路徑呼叫**（只有測試用）—— CLAUDE.md 那一句「`validateNote()` 與 Rules 一起擋」講得比實際多一點，不影響資料 | ✓（文件小差） |
| 20 | `firestore.rules` | `linkId` 沒有／null／1～64 字的字串、不能跟 `entitlementId` 同時有。**給整合那一段**：`origin/main` 的 `validNote()` 沒有 `hasOnly`，所以正式站現在的 Rules **不會**擋 `linkId`（HANDOFF 段九中途發現 6 說「會被 Rules 擋」不對）—— 三星正式版要等 #221 進 main 的結論照樣對，但理由是「舊的網頁看不懂連在一起，會列成三列、勾一列只勾一筆」，不是被擋 | ✓（順序對、理由更正） |
| 21 | 備份與還原 | `exportAll()` 整份讀 `notes`（含 `linkId`）、`restore-backup.mjs` 的 `SECTIONS` 有 `notes` 一列、照原 id 寫回 → 一組還原回來照樣連著 | ✓ |
| 22 | 稽核 | `FIELD_LABELS.linkId`＝「連在一起」、兩句（連到別天／拆開）；`audit`、`audit-field-words` 測試綠 | ✓ |
| 23 | 改名 `renameTargets()`、刪客戶 `deleteBlockers()` | 兩支都是一筆一筆看隨手記，`linkId` 不影響；刪客戶那一句一組講一行 | ✓ |
| 24 | 資料健檢 | 最後一項「連在一起的隨手記勾得不一樣」（R4 修好：照 ISO 排、有連結）、讀的是不含已刪除的；「掛的客戶」那一項一組只講一次 | ✓ |
| 25 | `sw.js`、快照、`related.js` | `SHELL` 收了 `/js/ui/keyboard.js`（#221 唯一的新檔）；VERSION v314 與快照對得上（`shell-version` 綠）；`97`～`100` 登記、`CSS_SCOPES` 有 `notemeta`／`notecount`／`datechoice`／`copydays`／`actionstags`（`e2e-related`、`e2e-css-scopes` 綠） | ✓ |
| 26 | 跟 Android 的約定（網頁這一側） | `linkId` 這個名字、兩條網址、`nameSuggestions()` 的比法；`tests/fixtures/notes-parity.json` 有 `nameSuggestions` 17 題、`links`、`writes` 15 題，`notes-parity` 測試綠（它也掃 `ParityTest.kt` 每一段有分支、網址真的登記）。#224 的 `createOrMove()` 是網頁才有的（Android 不建營養品的提醒、給營養品打開網頁）→ 不用進情境檔，CLAUDE.md 那一列寫了 | ✓ |
| 27 | R1～R8「說修了」有沒有真的修 | R1 `.fab` 收（`app.css:252`、K4）；R2 見第 6 條；R3 見第 7 條；R4 見第 24 條；R5 連動表四列都在；R6 抽查 ISO 日期換成 `shortDate()`、沒用的 import 拿掉；R7 日曆四顆一排、沒有兩個標籤（S8）；R8 K5 | ✓（R2 一個字除外） |
| 28 | 窄一點的手機 | 我加的 X4：360、384 寬時長按選單、「複製到別天」那張卡與外面每一層都沒有橫的捲軸 | ✓ |

單元測試（只跑相關的）：`notes-linked`、`notes`、`keyboard`、`notes-name-suggestions`、`notes-give-bag-once`、`note-date-field`、`notes-parity`、`audit`、`audit-field-words`、`health`、`shell-version`、`shell-cache`、`restore-backup` 共 523 支、
`e2e-related`、`e2e-css-scopes`、`customers`、`one-time-guest`、`save-guards`、`tip-red-lines`、`fewer-words`、`ui-copy`、`no-dev-words`、`full-height-units`、`immersive-display` 共 186 支，全綠。
E2E（本機模擬器，`E2E_WORKERS=2`）：`91`、`97`、`98`、`99`、`100` 共 34 支全綠（1.5 分）；我加的 X1、X1b、X2、X3、X4×2 照預期。模擬器用完已停（`node tests-e2e/emulator-groups.mjs stop`，port 都空了）。

## 懷疑但沒重現

- **真的鍵盤、注音、三星鍵盤的組字**：桌機只能縮視窗；`compositionstart`／`compositionend` 的順序與三星鍵盤會不會一直停在組字中（那一排名字就一直不出來）只有實機看得到 → 就是 B 段 16
- **首頁那張卡打字時 toast 站在 66px**：導覽列與 `.fab` 收了之後 toast 離鍵盤上緣 66px，可能蓋到那張卡底下那兩排。查了：按「記」之後整頁重畫、框被換掉、鍵盤會收，打字中跳 toast 的情境找不到 → 不報
- **殼畫第二次時小工具網址跑兩次**（ADR-0167）：只在登入回來的結果跟記著的不一樣時才重畫；那時 `renderNotesLink()` 可能開兩次「給了什麼？」。沒有重現（要造登入結果不一樣的冷開機），機率很低

## 怎麼跑重現（都在這個資料夾）

```
# 第 2 條：轉方向（不用模擬器）
node .scratch/final-check-2026-11-07/keyboard-rotate.mjs

# 第 1 條與「查過沒事」15、28：要模擬器
npm run emulators
HEADLESS=1 npx playwright test --config .scratch/final-check-2026-11-07/pw.config.mjs --project phone
node tests-e2e/emulator-groups.mjs stop

# 第 3 條：選單那一行（一組兩筆、只有一天）
node --input-type=module -e "import { linkedReach, noteActions } from './public/js/domain/notes.js'; const a={id:'a',text:'x',date:'2026-11-08',linkId:'a'}, b={id:'b',text:'x',date:null,linkId:'a'}; const reach=linkedReach(a,[b]); console.log(reach, noteActions(a,{reach}).find(x=>x.id==='date').note)"
grep -n "只改這一天" public/js/ui/components/note.js

# 第 4 條：「已經約了」那一句
node --input-type=module -e "import { givableBags } from './public/js/domain/products.js'; const e={id:'e1',type:'product',totalQty:1,items:[{productId:'p1',name:'夜態美'}],deliveries:[]}; for (const date of ['2026-11-10', null]) console.log(givableBags({customers:[{id:'c1',name:'客戶A'}],entitlementsBy:{c1:[e]},notes:[{id:'r1',entitlementId:'e1',done:false,date}]})[0].bags[0].hint)"
```

檔案：`keyboard-rotate.mjs`（第 2 條）、`pw.config.mjs`＋`repro-notes-web.spec.js`（X1、X1b、X2、X3、X4；沿用 repo 的 Playwright 設定與 fixture，只換 testDir，不在 `tests-e2e/specs` 放臨時檔）。全部是假資料（客戶B／客戶C），只寫本機模擬器。
