---
paths:
  - "public/js/domain/customers.js"
  - "public/js/domain/customerNotes.js"
  - "public/js/domain/customerMarks.js"
  - "public/js/domain/clinicalFlags.js"
  - "public/js/domain/messages.js"
  - "public/js/domain/messageTemplates.js"
  - "public/js/integrations/**"
  - "public/js/ui/components/flags.js"
  - "public/js/ui/components/marks.js"
  - "public/js/ui/components/message.js"
  - "public/js/ui/components/noteCard.js"
  - "public/js/ui/components/noteReorder.js"
  - "public/js/ui/components/notesEditor.js"
  - "public/js/ui/views/customerDetail.js"
  - "public/js/ui/views/customers.js"
  - "public/js/ui/views/longNotes.js"
  - "public/js/ui/views/templates.js"
  - "docs/MacroDroid設定.md"
---

# 客戶：標記、備註、LINE、要貼給客戶的話、找人、改名、刪除

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 客戶身上的標記

- **永久限制有兩層**（ADR-0074）：警示在 **`config/clinicalFlags`**（每一個字自己挑顏色與填法）、其餘是自由輸入。
- **合作機構是另一個欄位**（`customer.partners`，ADR-0076）—— 它不是限制。
- 三種的畫法只寫在 `ui/components/flags.js`（`alertChips()` 給卡片牆那一排、`detailChips()` 給看得完的那四頁、`partnerChips()` 兩邊都畫），壓表卡片牆與待辦的「壓表登記」共用（ADR-0046）。
- **`partnerChips()` 自己帶包裝**（`<span class="blockchips">`）—— 裸著接在 `alertChips()` 後面就落在包裝外面，掉進 column flex 裡被 `align-items: stretch` 拉滿整行（她 2026-09-10：「那個綠色框框是一直延伸的誒？」）。
- `tests/chips-and-chevrons.test.js` 盯著。
- **她自己打的字（其他限制、備註、警示的名字）可以很長**（issue 16）：客戶清單的卡片截成一行加「…」（`.badge--clip`、`marks.js` 的 `row({ clip })`），看得完的那幾頁換行顯示全文（`detailChips()` 的 `.badge--text`）；`.badge` 本身照舊不斷行（狀態、次數那種短字）。
- `.cardgrid > *` 的 `min-width: 0` 擋的是「任何一個太長的東西把整欄撐寬」—— 量的是 E2E `59` 的 W8／W9（**捲的是 `.app__main` 不是 document**，量 document 永遠是 false）。
- 客戶身上存的是**字串不是 id**，所以主檔改名不會搬既有客戶 —— 那是刻意的（ADR-0002），改名的人要自己去客戶身上重選

## 備註那一段的順序、長備註

- **長備註是備註的長版本**，存在客戶身上（`customer.longNotes`，ADR-0156）—— 不新開集合，備份、稽核、刪客戶、改名全部自動跟著。
- **`marks` 一個字都不改形狀**：二十幾處讀它（`grep -rn "\.marks\b" public/js`：壓表卡片牆、`customer.notes` 鏡像→試算表、拍訂購單的「尾款」、合併檔匯入），它們照舊只看到短備註 —— **長備註不進試算表、不上壓表卡片牆、讀取卡片。**客戶清單卡片例外**（2026-10-19，ADR-0160）：讀 `noteItems()` 的前四個（電話、LINE、病歷號、長備註、短備註都算，照她排的順序），畫法是 `marks.js` 的 `notesPreview()`（全部 `<span>`：卡片本身是 `<a>`）**。
- 順序另外存（`customer.noteOrder`；**沒排過的預設是病歷號 → LINE → 長備註 → 短備註 → 電話**，ADR-0163 —— 合併檔匯進來的每一位都是沒排過的），**短備註只佔位置**：第 n 個 `'mark'` 是 `readMarks()` 的第 n 則（短備註沒有 id，給它 id 就是改形狀）。
- 讀這一串只有 `domain/customerNotes.js` 的 `noteItems()`、存回去只有 `notesFields()`（`marks`、`notes`、`longNotes`、`noteOrder` 同一個 commit；拖過順序之後**短備註本身也照新的先後重排**，卡片牆前幾則跟著變 —— 她 10/19 同意）。
- 別的入口加短備註**只准接在最後或原地改字**（`orderForm.js` 的「尾款」、`health.js` 的病歷號）；**從中間刪一則要連第 n 個 `'mark'` 一起拿掉**（走 `notesFields()` 就對），不然後面的短備註往前錯一格。
- 長備註那一頁只動一則（`withLongNote()`／`withoutLongNote()`，**不碰 `marks`**）。
- 電話、LINE、病歷號只是位置（值在 `phone`／`lineId`／`chartNo`；病歷號 2026-10-19 起是一格，ADR-0160 —— 舊的「病歷號 1234」短備註匯入時與資料健檢最後一項由 `chartNoMove()` 搬進來，位置不變、只搬號碼、兩個不一樣的只列）；撥號只走 `telHref()`，**LINE 那一格是名字、點了走 MacroDroid**（見「客戶的 LINE 那一格」那一節，ADR-0157）。
- 畫法：丸子 `marks.js` 的 `notesRow()`、中間那張卡 `ui/components/noteCard.js`（WAAPI 不吃 reduced-motion 那條 CSS，自己問 `matchMedia()`；推一層、問 `.active`）、調整順序 `noteReorder.js`（**在詳情頁原地拖，不在抽屜裡** —— 抽屜自己有直向拖曳；一列 50＋8px 跟 CSS 的 `.rrow` 兩邊要一樣）、編輯 `notesEditor.js`。
- 上限 20 則在 `firestore.rules` 與 `MAX_LONG_NOTES` 講同一個數字（Rules 測試 R14.3 盯著）；順序 40 格是 `MAX_NOTE_ORDER`（R14.5，`tests/customer-notes.test.js` 比著兩邊）

## 客戶的 LINE 那一格、打開 LINE 對話

- **`customer.lineId` 存的是她 LINE 好友清單上看到的名字**，不是 ID、不是網址（ADR-0157，代號沒換；網址那條路整個拿掉了，不要加回 `lineHref()`）。
- 合併檔 v10 起匯得進來（見「舊表 B2…合併檔」那一節（`import.md`））。
- 打開對話**只有 `integrations/lineMacro.js` 的 `openLineChat()` 一支**：叫她手機上 MacroDroid 的 HTTP Server（`127.0.0.1:<port>/line?name=…&msg=…`），**不走 Webhook**（客戶的名字與訊息不出手機）。
- 兩個入口：客戶詳情的 LINE 丸子（`msg` 空的）、訊息框的「打開 LINE」（`message.box({ line: { name } })`，送那一格**現在的字**；確認時間與問這輪的時間兩張卡有給，**讀不到那位客戶時不給**）。
- 那兩頁是整頁重畫：她改過的字由 `message.editStore()` 跨重畫留著（`renderGroup()` 換新的；**那一則本來的樣子變了就丟、不帶回來**，不然談定的那一段又問一次）—— 新增一頁用訊息框而且會整頁重畫的，照接（重畫走它的 `paint(el, html)`；先換成「載入中…」的另外在換之前 `keep()`）。
- **`msg` 一律帶**（空的也帶 —— 巨集的區域變數會留著上一位的）；巨集**永遠不按送出**。
- 開關記在這一台（`localStorage` 的 `scheduler.lineMacro`，設定頁「打開 LINE 對話」）：沒勾的裝置**一次都不敲門**，走「複製＋打開 `line.me/R/nv/chat`」的退路；叫不到（reject）走同一條退路、**等太久只講一句不開 LINE**（Chrome 的「區域網路」那個框可能正開著）；還在等回應、或叫到之後 `AGAIN_MS`（3 秒）內再按**不再敲**（巨集跑兩次就是訊息貼兩次；打開對話與「試一次」共用那一格，退路不擋）。
- path `line` 與 `name`／`msg` 是跟她手機的約定，**改一邊要改 `docs/MacroDroid設定.md`**。
- `lineMacro.js` 不 import 畫面（提醒走 `notify`），`no-dev-words`／`ui-copy` 兩支掃字的測試也掃 `integrations/`。
- E2E 不可以用 8080（模擬器的 Firestore），`75` 用 18080。
- **新增一個要打開客戶 LINE 的入口走 `openLineChat()`**，不要自己組網址

## 要貼給客戶的那幾句話

- **字**在 `domain/messageTemplates.js`（預設值）與 設定 → LINE 回覆模板（她改過的），**算變數**留在 `domain/messages.js`。
- **問可不可以只講還沒問過的段**（`visits.js` 的 `asPending()`，待辦中心「跟客人確認時間」那一張同一支）、**提醒只算還算數的段**（`liveSlots()`）。
- 條件判斷（一次來訪只講第一段、前一天就說明天、沒有課程名就整段消失）**不要搬進模板** —— 那只有 `{}` 一種語法，寫不出條件。
- 加一則要同時改：`TEMPLATES`、產生它的那一支、觸發它的那一頁

## 打字找客戶的框

- 比法只有 `domain/customers.js` 的 `nameHas()`（去空白、全形半形、不分大小寫）。
- 九個框走它：拍 Abovee 的「換一位」與療程單的「是誰」（經 `searchCustomers()`）、日曆新增的「要幫誰排？」、批次取消、壓表牆上的搜尋、客戶清單的搜尋（後兩個 2026-10-06）、長備註那一頁的「寫給誰？」（2026-10-19，`views/longNotes.js`：停用的也列、標「已停用」）、隨手記「掛給誰」的兩格（2026-11-06：記一筆那一排 `[data-nw-search]`、長按那一張 `[data-who-search]`，名字或病歷號）。
- **「列誰」各管各的、不在那一支裡**：批次取消要找得到停用的客戶（他身上可能還有要取消的來訪），所以它不能直接換成 `searchCustomers()`；隨手記那兩格也各自保留（記一筆那一排不濾停用的、長按那一張濾掉）。
- **比開頭不比包含的例外**：隨手記打名字跳出客戶（`nameSuggestions()`，同一套 `normalizeAlias()`，見「隨手記的 `linkId`」那一節（`notes.md`）的約定）。
- 客戶清單那一格連電話、LINE、購買通路一起比 —— **一格一格問這一支，不要接成一串再比**（空白去掉之後名字的尾巴會跟電話的開頭連在一起）；**病歷號另外問 `chartNoHas()`**（同一支檔案：補零一樣、那一格與還寫成短備註的都認，ADR-0160）。
- 療程單那一頁上面的搜尋走 `identify.js` 的 `normalizeName()`，同一種比法。
- **一次性客人**：日曆新增、批次取消、隨手記「掛給誰」、拍 Abovee 換一位列得到而且標 `.guestmark`，長備註「寫給誰」不列（見「一次性客人」那一節（`one-time-guests.md`））

## 客戶改名

- 來訪、任務、隨手記身上的 `customerName` 是**快照**。
- 改名時跟著換哪幾份只寫在 `domain/customers.js` 的 `renameTargets()`（今天以後的來訪、還沒做的任務、還沒勾的隨手記；她 2026-09-23 選的）。
- **過去的來訪還掛著沒做完的事就一起換**（還沒結案，或身上有一張沒做的任務）—— 不換的話那一筆一結案，`syncTasksForVisit()` 把任務名字對齊來訪身上那一份，待辦就變回舊名字。
- 寫入是 `data/customers.js` 的 `updateWithSnapshots()`（跟客戶本人同一個 commit）。
- 壓表批次的卡片不用換 —— 畫的時候就拿客戶本人的名字蓋掉；療程單那一頁也是讀本人（`compareAll()` 收 `customers`）。
- **表單邀請（`formInvites`）刻意不換**：那一句是客人自己看得到的，而改名常常是為了跟同名的人分開，那個尾巴不該給客人看 —— 看到「漏了一個帶 `customerName` 的集合」不要把它補回來。
- 新增一種帶 `customerName` 的集合要回來補這一支

## 刪掉一位客戶

- **還掛著來訪、待辦或隨手記就刪不掉**（ADR-0109）：判斷只在 `domain/customers.js` 的 `deleteBlockers()`（待確認／已確認的來訪、還沒做的待辦、還沒勾的隨手記 —— 有沒有日期都算）。
- 來訪、任務是頂層集合、讀的時候不問客戶還在不在 —— 新增一種掛著客戶、會出現在日曆或待辦上的東西，要回來想它擋不擋。
- 「去批次取消」那一顆是**確認框按下去之後馬上換頁**：先 `await nav.whenSettled()`，不然確認框收掉時排的那一趟 `history.go()` 會晚到、把換頁退掉（中間有一次寫入的路本來就等到了）。
- **壓表那一批的名單存的是 id**（2026-10-08）：畫的那一份走 `scheduling.js` 的 `presentQueue()`／`batchRows()`（刪掉的不畫、不算進分母、不會被挑成「下一位」），**存回去的不濾**（還原後回原位）；新增一個讀 `batch.queue` 來畫或來數的地方要問它
