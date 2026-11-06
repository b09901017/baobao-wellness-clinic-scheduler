# 02：今天／挑日期／掛給誰／給營養品排一排、首頁那張卡加給營養品、長按提示

Status: done
Blocked by: 05（同一批檔案：`note.js`、`home.js`；05 先改完再排版）

## 動工前先讀

- `spec.md`「四、小的」
- `public/js/ui/components/note.js`：`field()`（`:87`）、`who()`（`:179`）、`give()`（`:753`）、`row()`；`public/css/app.css` 的 `.notemeta`（`:7607`，column flex、每一塊自己一排）、`.notedate`、`.notewho`、`.notewho__list`、`.notegive`
- 入口：首頁那張卡 `home.js` 的 `notesCard()`（`:1554`，**只有 field()＋who()**）、右下角泡泡 `quickBody()`／`wireQuick()`（`:1646`／`:1661`，三塊都有；選了一包會把 who 那一排藏起來 `:1675-1682`）、
  日曆待辦編輯器 `calendar.js` 的 `mountNoteEditor()`（`:1392`；三塊各在自己的 `.field`、give 只在新增時有）、客戶詳情 `customerDetail.js` 的 `notesBlock()`（只有 field()）
- **為什麼首頁那張卡當初沒有給營養品**：`.scratch/quick-actions-and-supplements/issues/12-*.md:109-111、134`（那一格要是最短的一行路，多一排會撐長）—— 她 11/6 改主意要加，**一排放得下**就不撐長了
- 過時的註解：`note.js:172-174`（說首頁那一格與泡泡「長一模一樣」）、`app.css:7599`（說四個入口都有給營養品）—— 做完照實際改
- `ui/components/tip.js`（`tip(text, { kind, label })`）、`tests/fewer-words.test.js`（`tip()` 不算常駐說明；確認一下）

## 她要的

> 1. 如圖一圖二 : 能不能今天挑日期掛給誰，給營養品是同一排? 以及我發現首頁的那個既一筆沒有給營養品?

> 確實我不知道，那沒關係不用做⋯，現在我知道了，但這邊也許可以加一個小tooltip說長按可以修改

## 要做的

- **四顆排一排**（有幾顆排幾顆：客戶詳情只有今天／挑日期）：`.notemeta` 那一層改成一排、放不下才換行（選了日期、選了人之後字變長）。
  **點開之後才出現的東西**（`.notewho__list` 的名單、`give()` 展開的客戶與那一包、選了日期後的「✕」）**換到那一排底下自己一行**，不要擠在丸子中間 —— 想清楚 DOM 順序：丸子在一排、展開的面板在下面
- 首頁那張卡加 `give()`，接法跟泡泡一樣（選了一包時 who 那一顆收起來、文字自動填、存的時候帶 `entitlementId`）—— **不要讓她自己打那一行字**（`CLAUDE.md`「日曆上的待辦」那一段的理由）。
  `wireWho`／`give` 的接線五個入口共用，不要再寫一份
- 長按提示：首頁「隨手記」那張卡的標題、`#/todo/notes` 的標題旁邊各一顆 `tip()`：「點一下勾掉；長按可以改日期、改字、掛給誰、複製到別天」（05 做完之後「複製到別天」才存在 —— 所以排在 05 後面）
- 手機寬度（360、412）量：四顆一排放得下嗎？選了日期（`11/6(五)`）之後換行的樣子好看嗎？（截圖自己看過）

## 判準

- 首頁那張卡選了一包營養品存下去，那一筆有沒有 `entitlementId`？勾掉時會不會問「給了哪幾款」？（跟泡泡存的一模一樣）
- 打開「掛給誰」的名單、展開「給營養品」時，名單有沒有跑進丸子那一排中間？
- 客戶詳情那一格（只有日期）沒有因為改了 `.notemeta` 而跑版嗎？日曆編輯器那三個 `.field` 呢？
- 長按提示收在 `?` 裡、沒點不佔版面嗎？

## 做完時留下的

段二（2026-11-06）。E2E `98-note-capture-row` 的 C1–C4（登記進 `related.js`）。sw.js v303。

- **一排怎麼做的**：`.notemeta` 改成橫的 flex、會換行；裡面那幾塊（`.notedate`、`.notewho`、`.notegive`、包住掛給誰的 `[data-quickwho]`）
  **`display: contents`**（子孫選擇器 —— 首頁那一格與泡泡的掛給誰包在 `[data-quickwho]` 裡，寫成子代選擇器的那一版名單就擠回丸子中間，C2 抓到的），
  丸子直接是那一層的 flex 項目；點開才長的名單（`.notewho__list`，給營養品的兩層也是它）`order: 1` 落在那一排底下。**markup 一個字都沒改**，JS 照舊在那幾塊身上接監聽。
  選了日期與人之後（`9/1(二) ✕`、`王小明`、`✕ 不掛了`）360 與 412 寬都會把「✕ 不掛了」「給營養品」擠到第二行 —— 照 spec「放不下才換」，截圖看過
- **三個有「掛給誰」的入口共用一支 `note.wireCapture(root, { input, whoBox, loadCustomers, loadBags })`** ＋ 讀值 `note.readCapture(root)`（日期、掛給誰；選了一包時掛的人與 `entitlementId` 由那一包決定）。
  首頁那張卡、泡泡、日曆待辦編輯器以前各自接 `wire()`／`wireWho()`／`wireGive()` 與「選了一包就收掉掛給誰、填字」—— 現在只剩這一支（03 的打名字跳出客戶也接在裡面）。客戶詳情那一格只有日期，照舊 `note.wire()`
- 首頁那張卡加了 `give()`，掛給誰包進 `<span data-quickwho>`（跟泡泡同一個屬性，選了一包時收起來）；存檔走 `readCapture(form)`
- **日曆待辦編輯器拿掉了 `noteWhoWired` 旗標**：`sheet.update()` 換掉的正是那幾塊，旗標留在 `sheet.el` 上時同一張抽屜第二次 mount 的「掛給誰」一個監聽都沒有（今天的入口每次都是新的抽屜，所以沒有人踩到）。現在每次 mount 都接
- 長按提示：`note.LONGPRESS_TIP`（「點一下勾掉；長按可以改日期、改字、掛給誰、複製到別天」），首頁那張卡標題、`#/todo/notes` 標題旁邊各一顆 `tip()`。**長按的選項改了要改這一句**
- `related.js` 的 `CSS_SCOPES` 多一組 `notemeta`（`notemeta`、`notewho`、`notegive`；owners 四個入口）。`playbookHint.js`／`tasklist.js` 兩行註解提到 `.notemeta` 被 `e2e-css-scopes` 當成用到，改了字
- 過時的註解照實改了（`note.js` 的 `who()` 檔頭、`app.css` 那一段）

E2E 只跑了手挑的 11 支（01、07、08、10、24、28、70、80、91、97、98：摸得到記一筆那一排的選擇器）全綠 —— `pick()` 對這幾個檔案挑出 57 支（`home.js`、`calendar.js` 太大），**全量交給 CI**（段二推完之後跑一次 `e2e-full.yml`）。
01 的 J-E10、91 的 N4 在 2 個 worker 下各紅過一次（`signIn` 的 `waitForFunction` 20 秒逾時），單獨重跑都綠。

**驗收時要點的**：首頁那張卡與泡泡各選一包營養品存下去，勾掉時都會問「給了哪幾款」；日曆「＋ → 待辦」的編輯器「哪一天／掛給誰」照舊是兩個有標籤的欄位（每一欄一顆、沒有變一排）。
