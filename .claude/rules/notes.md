---
paths:
  - "public/js/domain/notes.js"
  - "public/js/data/notes.js"
  - "public/js/ui/components/note.js"
  - "android/**"
  - "tests/fixtures/notes-parity.json"
  - "tests/notes-parity.test.js"
  - "scripts/notes-parity.mjs"
---

# 隨手記、Android 小工具

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 隨手記的 `linkId`（複製到別天、連在一起）

- **每一天一筆真的文件、同一組共用一個 `linkId`**（ADR-0179；Android 小工具照抄這個名字）。
- 連在一起＝同一個 `linkId`、活著的兩筆以上，判斷只有 `domain/notes.js` 的 `linkedPeers()`（刪掉、還原不清 `linkId`）。
- 一起變的照真的變了什麼（`linkedChanges()`：勾／拿回來、字、掛給誰一起；日期、刪掉只這一筆；勾不勾是她明說的值，舊的那一份也照樣對齊整組）。
- **寫的那一刻照 `linkId` 重讀**（`data/notes.js` 的 `update()`／`setDone()`／`removeRow()`／`copyTo()`，一組一個 commit）—— 畫面手上那一份都只是一部分。
- **清單類一組一列**（`groupLinked()`：首頁那張卡、`#/todo/notes`、客戶詳情、刪客戶那一句；數字一組算 1），**日曆與逾期／今天／明天不走它**（每一天各一列）；新增一份列隨手記的清單要想它是哪一種。
- 清單上一列的垃圾桶、「清掉這 N 筆」走 `removeRow()`（整組）；日曆編輯器的「刪掉」走 `remove()`（只這一筆）。
- **長按三個入口共用 `ui/components/note.js` 的 `openMenu()`**（`complete: false` 的入口 —— 日曆、逾期／今天／明天 —— 打開選單之前照 `linkId` 重讀；三份 `noteDeps()` 都要帶 `listLinked`／`copyTo`／`unlink`）。
- 營養品的提醒不能有 `linkId`（網頁擋在 `copyPlan()` 的 `blocked`、選單沒有那一顆、Rules；Android 寫之前另外過 `validateNote()` —— 網頁沒有任何寫入路徑叫它）。
- 勾得不一樣的由資料健檢最後一項列出來（只是提醒）。
- **「會作用在幾天」只問 `linkedReach()`**（選單那一行小字、改文字與掛給誰那兩張卡、日曆編輯器那一行、存完與勾掉的 toast、清單那一顆 `linkedBadge()`；字是 `linkedWords()`）—— 各數一次的話同一組講出 2、3 兩種數字（段三審查 R2）。
- 從已勾掉的那一筆複製：新的那一組用它的 id、它自己不寫 `linkId`（ADR-0179 決定 2）。
- **跟 Android 小工具的約定**（改一邊要改另一邊，Kotlin 照抄）：`linkId` 這個名字與上面這幾條；兩條網址 `#/todo/notes/note/<id>`（營養品的提醒直接問「給了哪幾款」、一般的跳出長按選單）與 `#/todo/notes/new/give`（登記在 `ui/views.js`、畫的是 `home.js` 的 `renderNotesLink()`）；打名字跳出客戶的比法 `domain/customers.js` 的 `nameSuggestions()`（游標前往前到空白標點、最長的是某一位名字**開頭**的尾巴、最多 6 位、全名就是已經掛的那一位不再跳），情境表在共用情境檔 `tests/fixtures/notes-parity.json` 的 `nameSuggestions`（見下一節）

## 隨手記的形狀或規則（Android 小工具那一份）

- **Android 的「隨手記」直接讀寫同一個 Firestore，規則照抄一份 Kotlin 的**（`android/core`，ADR-0180）：`domain/notes.js` 那幾支、`data/notes.js` ＋ `repo.js` 的 `commit()`（欄位與型別、每次帶 `updatedAt`、**同一個 commit 每一筆一則稽核**）、比名字與病歷號、`nameSuggestions()`。
- **兩份一樣只靠共用情境檔** `tests/fixtures/notes-parity.json`：答案由網頁真的那幾支算（`node scripts/notes-parity.mjs --write`），網頁那一側 `tests/notes-parity.test.js`（`writes` 拿真的 `data/notes.js` 跑、Firestore 換成 `tests/helpers/fakeFirestore.js`）、Android 那一側 `ParityTest`（`cd android && ./gradlew :core:test`）讀同一份。
- **改了上面任何一支的行為**：網頁的測試紅 → 確定是要的就 `--write`、看 diff → Kotlin 紅 → 改 Kotlin 到綠（同一支 PR）。
- **新的規則先在情境檔加一題**（`{ name, in }`，不寫 `out`）再改 —— 沒有一題蓋到的規則，Kotlin 那一份不會知道。
- 情境檔多一段，`ParityTest` 要多一個 `"段名" ->` 分支（網頁的測試掃著）。
- 營養品的提醒怎麼勾**不抄**：小工具打開網頁的兩條網址（見上一節）。
- **小工具的背景同步只問 `updatedAt` 大於上次的**（core 的 `NotesSync`，刪掉的也靠這一格被看到）—— 新增一條寫隨手記的路不經過 `repo.commit()`（不帶 `updatedAt`）的話，小工具永遠看不到那一筆；**真刪也一樣**（`staging:reset`、還原的 `--wipe`：那幾筆一直留在小工具上，登出再登入才整份重讀）。
- **網頁沒有、只在小工具的**：清單順序（今天 → 過了 → 沒日期 → 以後的）在 core 的 `WidgetList`（自己的 `WidgetListTest`，分組照樣問 `groupLinked()`）；選單的「看那一包營養品」開 `WebLinks.customer()`、小工具的標題開 `WebLinks.notesPage()`（`#/customers/<id>`、`#/todo/notes`，網頁那兩條路由改了要回來改，`WebLinksTest`）；營養品的提醒點勾要怎麼走三個入口（小工具、選單、主畫面）只問 `android/app` 的 `NoteTaps`；**同步只認伺服器的答案**（`NoteStore` 的查詢回 `Listing.fromCache`，讀到手機的快取不推游標）、讀回來的套在現在那一份上（`NotesSync.apply()`）；顏色照 `tokens.css` 抄一份（`android/app/.../widget/Palette.kt`：綠、茶、逾期紅、字色，淺色深色各一份）。
- Android 那一份的建置在 `.github/workflows/android.yml`（不在 `deploy.yml`、不是必要檢查）；`tests-e2e/related.js` 把 `android/` 列在 `IGNORED`

## 日曆上「待辦」那一類

- 它**就是 `notes` 裡有日期的那幾筆**，不是 `events` 的第三種類別，也不是 `tasks`（ADR-0044、0045）。
- 所以「同步回隨手記」沒有東西要做 —— 沒有第二份資料。任務不上日曆

## 隨手記的欄位或那一列的樣子

- 四個地方共用 `ui/components/note.js`：待辦首頁那張卡、右下角泡泡、`#/todo/notes`、客戶詳情。
- **日曆上的待辦編輯器也是同一支的欄位** —— 長得不一樣會讓她以為是兩種東西。
- **包住它們的那一層（`.notemeta`）也算共用的一部分**：2026-09-01 之前只有兩個入口包了它，另外兩個裸放，於是那兩邊的丸子貼著輸入框、三排之間一點間距都沒有。
- **接線也共用**：三個有「掛給誰」的入口（首頁那張卡、泡泡、日曆待辦編輯器）走 `note.wireCapture()`／`readCapture()`（今天／挑日期／掛給誰／給營養品一排、打名字跳出客戶、客戶名單只讀一次），客戶詳情只有日期；長按三個入口共用 `note.openMenu()` —— 新增一個入口不要自己接一份 `wireWho()`
