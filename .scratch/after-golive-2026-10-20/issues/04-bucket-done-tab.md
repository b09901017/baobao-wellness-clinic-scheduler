# 逾期／今天／明天那三頁的「已完成」畫三塊、只給看與拿回來

Status: done
段：二（xhigh）
Blocked by: 03
動工前先讀：`ui/views/home.js` 的 `renderGroup()`、`paintTasks()`（「未完成 N」＝三塊加起來）、`openList()` 與那三塊（`wireBucketBlocks()`、`[data-notes] [data-note]` → `note.prepareToggle()`、簽療程單那一列 `leaveFor('todo/close', id)`、明天那一塊 `comingBlock()` → `openTaskVisit()`）、
`doneList()`、`doneRow()`、`untickTask()`、`dropTask()`、`clearDoneTasks()`；`ui/components/note.js` 的 `prepareToggle()`（營養品勾回來要不要問）；
`taskTab`／`taskTabGroup`（換分類回到未完成）；E2E `78-before-golive-seg3.spec.js`（T1、T2 量首頁數字＝點進去的件數）；`docs/常見問題.md` 開頭那一題（「首頁那一列不見了，我要怎麼把勾錯的勾回來」）；
`CLAUDE.md`「待辦首頁的『逾期／今天／明天』」「隨手記的欄位或那一列的樣子」「一筆來訪的讀取卡片」三列；`lessons.md` 一、五

## 她要的

> …就是我想要今天份的點進去後可以看到已完成和未完成，包含重其他地方點的完成也是放已完成

> …到了明天後，未完成就會到逾期，已完成就會清空，但只是這邊呈現清空，再隨手記那邊或月曆其他地方不會被清掉

（03 的表她說「可以照表」。拿掉清掉／垃圾桶、療程單點了開讀取卡片，是我回答時寫在表底下的，她沒有反對。）

## 為什麼會這樣

- `doneList()` 只畫任務、照 `groupByDoneDay()` 分段，底下一顆「清掉這 N 筆」（`clearDoneTasks()` → `tasksData.remove()`）、每一列一個垃圾桶（`dropTask()`）
- 那兩顆在分類頁（Examine、耀聖…）是對的：那裡的已完成就是「勾錯了點得回來、做完的可以清掉」。在逾期／今天／明天那三頁要是照樣畫，隨手記那一塊按下去就是**真的刪掉隨手記** —— 跟她說的「只是這邊呈現清空」相反

## 做法（方向）

1. 三頁（`BUCKETS`）的已完成讀 03 的那一支，分三塊、順序同未完成那一側：待辦／簽療程單／隨手記，空的不畫；「已完成 N」＝三塊加起來
2. **三頁的已完成不畫「清掉這 N 筆」也不畫垃圾桶**；分類頁照舊（`doneList()` 那一條路不動）
3. 點一列：
   - 任務 → 照舊 `untickTask()`（鏈上那兩種先問一句的 `confirmUntick()` 照舊）
   - 隨手記 → 拿回來，**走 `note.prepareToggle()`**（過目查過：已勾的直接 `setDone(false)`、不問營養品，`note.js:314-319`）—— 不要在這裡另寫一份。
     **接線那一段現在會提早 return**：`home.js:2140` 沒有開著的隨手記就 `return`，已完成那一塊的隨手記根本沒接到
   - 療程單 → 開讀取卡片（`openTaskVisit(visitId)`，`taskId` 可以不給；**不開簽單抽屜、不給退回**：簽好的段鎖著）。
     **但它只在 `taskVisits.visits` 裡找**（`home.js:2367`），而 `loadTaskVisits()`（`:1883`）不收已簽的那幾天 → 不補的話點下去只會跳「找不到這一天的來訪」。已完成那一塊的來訪要放進 `taskVisits`
   - **長按**：`wireNoteLongPress()` 對已勾的隨手記會給「刪掉」（`domain/notes.js:245`）—— 三頁拿掉垃圾桶，長按照樣刪得掉，而 grep `remove(` 抓不到這一條。
     決定：**三頁已完成那一側不接長按**（只給看與拿回來；要刪去隨手記那一頁）。SPEC:1378 寫「五個入口長按同一份」→ 那一句補「逾期／今天／明天的已完成那一側除外」
4. 那一塊的列長得跟未完成那一側同一種東西勾掉的樣子（隨手記勾掉的樣子照 `note.js`）—— 長得不一樣她會以為是另一種東西
5. 首頁三顆數字不動

## 判準

- E2E（新的 spec，登記進 `related.js`）：
  - 今天：勾掉一張死線今天的任務、在**日曆**勾掉一則掛今天的隨手記、在**簽療程單那一頁**把今天那一位簽掉 → 回今天那一頁 → 已完成三塊各一件、「已完成 3」；未完成少那三件
  - 把模擬的今天換成明天（測試中途換日子用 `page.clock.setFixedTime`，`fixtures/app.js:198`；不是 `test.use`）同一份資料 → 今天的已完成是空的；那三件在隨手記頁、日曆、客戶詳情照舊在
  - 逾期：死線昨天的任務今天勾 → 在逾期的已完成；死線上週、昨天勾的（種資料）→ 不在
  - 三頁的已完成裡**沒有** `[data-clear-done]`、沒有 `[data-drop]`；Examine 那一頁的已完成照舊有
  - 已完成點隨手記那一列 → 回到未完成；點療程單那一列 → 開讀取卡片、畫面上沒有任何勾選框、**沒有跳「找不到這一天的來訪」**
  - 長按已完成那一側的隨手記 → 沒有選單（沒有「刪掉」）
  - 「已完成 N」（現在是 `ctx.done.length`，`home.js:2063`）＝三塊加起來
- 這一行會不會讓三頁裡任何一個按鈕刪掉資料？（grep 三頁那條路上的 `remove(`）
- E2E `78` 的 T1、T2 照舊綠（首頁數字＝點進去未完成的件數）

## 連動

- `docs/常見問題.md`：**`:29`「我勾掉的待辦不見了」**那一題寫著垃圾桶與「清掉這 N 筆」—— 三頁沒有了，要改；`:42` 那一題（首頁那一列不見了、怎麼勾回來）看一次還對不對；
  補一題「今天的已完成，昨天的怎麼不見了」（看到什麼、為什麼、怎麼辦）
- `SPEC.md:1378`（長按「五個入口同一份」那一句）
- `docs/操作手冊.md` 待辦首頁那一段
- `sw.js` 的 `VERSION`（這個 PR 第一個動 `public/` 的那一支升；段一已經用了 v201 → 這裡 v202）

## 做完時留下的

- `home.js`：三頁的已完成走 **`bucketDoneList(ctx)`**（讀 03 的 `ctx.finished`），分類頁照舊 `doneList()`。三塊順序同未完成那一側、空的不畫、只有任務時不印小標（同 `openList()`）；
  「已完成 N」＝`bucketCount(ctx.finished)`。讀不到（`finished` 是 `null`）講一句「現在讀不到已完成的那幾件」＋一顆「再讀一次」（重跑 `renderGroup()`），未完成照畫
- **刪得掉的東西一個都沒有**：任務那一列 `doneRow(t, { trash: false })`、不畫「清掉這 N 筆」；隨手記那一塊的容器是 **`[data-done-notes]`**（不是 `[data-notes]`）——
  `wireNoteLongPress()` 只接 `[data-notes]`，所以長按沒接上（對勾掉的那幾筆，長按選單有「刪掉」）。點一下走同一支 `prepareToggle()`（`wireNoteToggles()`，未完成與已完成兩塊共用；
  以前 `wireBucketBlocks()` 沒有開著的隨手記就提早 return，已完成那一塊根本接不到）
- 簽好的那一天：`signedRow()`，長得跟勾掉的任務、隨手記同一種（`note note--done`），底下一行「8/29(六)・1 段做了、1 段沒來」；
  點下去走 `data-visit` → `openTaskVisit()`（同明天來的那一列）。**`loadTaskVisits()` 多收 `ctx.finished.close` 的 id** —— 不收的話只會跳「找不到這一天的來訪」
- E2E **`80-bucket-done`**（登記進 `related.js`）：D1 今天那一頁勾任務、日曆勾隨手記、簽療程單那一頁簽 → 已完成 3、三塊各一件、沒有會刪東西的按鈕；`travelTo(明天)` → 空了、
  隨手記頁／Examine 頁／資料照舊在。D2 逾期只收今天才做完的（含一出生就結案的那一天不收）。D3 長按已完成的隨手記沒有按壓回饋（對照：未完成那一則有、而且開得出選單）、
  點一下拿回來、簽好的那一天開讀取卡片（沒有勾選框、沒有「找不到」）、Examine 那一頁的垃圾桶與「清掉」照舊。D4 明天提早做完 → 明天的已完成；`travelTo(明天)` → 今天的已完成
- **種子的坑**（寫進 spec 的檔頭）：`seedDocs()` 補的 `createdAt`／`updatedAt` 是兩次 `new Date()`，常常同一毫秒 —— 在 app 眼裡就是「一出生就做完的」。種做完的資料一律自己給兩格（`touched()`／`born()`）
- 文件：`docs/常見問題.md`「我勾掉的待辦不見了」分成分類頁與三頁、新的兩題（昨天勾的怎麼不見了、有一件我沒做過）、「首頁的今天比底下多」補一句已完成不算；
  `docs/操作手冊.md` 第四節多「首頁上那三顆」；SPEC 8.1 分類頁那一條與長按「五個入口」補例外；`docs/邊界測試清單.md` F6 限定分類頁、多 F8（半夜勾）、F9（開著過午夜）
- `tests/todo-bucket-done.test.js` 多兩條掃原始碼：`bucketDoneList()` 沒有 `data-clear-done`／`data-drop`／`[data-notes]`；`loadBucketDone()` 接住例外回 `null`
