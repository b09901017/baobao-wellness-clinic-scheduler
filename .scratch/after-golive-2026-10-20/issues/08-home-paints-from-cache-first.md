# 待辦首頁先用手機裡的資料畫，雲端回來有變再換

Status: done
段：三（high）
Blocked by: 07（殼要先在，這一支才看得出效果；程式上不依賴）
動工前先讀：`ui/views/home.js` 的 `render()`（五份 `Promise.all`：`tasksData.listOpen()`、`visitsData.listByStatus('pending_confirm')`、`visitsData.listUnclosed(today, { tomorrow: true })`、`notesData.listOpen()`、`config.getSettings()` → `paint(ctx)` → `homeLoaders()`）；
`data/repo.js` 的 `list()`／`listFrom()`／`noted()`／`cacheReads()`（**每一份 `fromCache` 的讀取都會加一，ADR-0158 拿它判「這一趟讀到快取 → 不存」**）；`domain/incompleteRead.js` 的 `readsIncomplete()`；
`data/visits.js` 的 `visitsRead`／`listWhole()`；`CLAUDE.md`「算次數、驗證、預選額度要拿哪些來訪」那一列（ADR-0158）；`lessons.md` 二

## 她要的

> 有辦法讓app先呈現畫面嗎…

> 3. 可以

（我問的是：「首頁數字先用手機裡的、可能閃一下（3 → 2）可以嗎？」）

## 為什麼會這樣

`repo.list()` 走 `getDocs()`：連得上就一定等雲端回來（離線才退回快取）。首頁五份全部回來才 `paint()`。手機裡明明有上一次的那一份（`persistentLocalCache`）。

## 做法（方向）

1. `repo` 多一支只讀快取的（`getDocsFromCache()`，SDK 有匯出；`config.getSettings()` 本來就是直接 `getDoc`、不經 `noted()`，`config.js:51`），**不經過 `noted()`、不加 `cacheReads()`**。
   理由（過目更正）：ADR-0158 擋不擋看的是「**這一次存檔開始到寫入之間**」有沒有快取讀取（`data/visits.js:63`／`:244` 拿存檔前後的 `cacheReads()` 比）—— 首頁畫完之後才存檔不會被擋，
   但她在快取那一份畫好、雲端還沒回來的那一兩秒按存檔，快取那一次就落在那一段裡。只拿來畫的讀取一律不算進去
2. 首頁：先讀快取那五份 → 有東西就 `paint()`；接著照舊讀雲端那五份 → 跟畫出來的不一樣才再 `paint()`（比 id＋`updatedAt`，一樣就不重畫 —— 不閃）。`homeLoaders()` 那幾列照舊在雲端那一份回來之後跑。
   **雲端那份回來時改同一個 `ctx` 物件的內容，不要換新的**：已經開著的抽屜握著舊的那一份 `ctx`
   **能省多少**：快取讀取也要等 Auth 初始化完（Firestore 要先拿到第一個 token）—— 08 省的是雲端那一趟，數字不會比登入早出來（那一段要 09）
3. **快取那一份只拿來畫**：首頁上任何一個按下去會寫入或打開抽屜的動作，照舊用雲端那一份（或自己重讀）—— 跟現在一樣。雲端那一份還沒回來時她就點了，點下去的那條路自己讀（現在每一條存檔路本來就重讀）
4. 快取是空的（新裝置、清過資料）→ 不畫快取那一次，照舊等雲端
5. 雲端那一份讀失敗、但快取畫過了 → 不要把畫好的換成「讀取失敗」那一張卡；講一句（例如沿用離線那一條）
6. 只做待辦首頁。別頁（日曆、客戶）要不要照做，量完再說 —— 寫進「做完時留下的」

## 判準

- 單元／E2E：首頁打開一次（快取有了）→ 重新整理、把 Firestore 的網路攔慢 2 秒 → 三顆數字在雲端回來之前就畫出來；雲端回來數字一樣 → 首頁的 DOM 沒有被換掉（同一個節點）
- 先在另一個 context 勾掉一張 → 重新整理 → 先畫舊的數字、雲端回來換成新的
- **ADR-0158 那道擋照舊**：紅燈是「首頁快取那一次畫完之後，在頁面上 import `repo.js` 讀 `cacheReads()` → 還是 0」（「線上存一筆存得下去」改前改後都綠，不是紅燈）；
  離線時照舊擋（E2E `76`、`10` 照舊綠）
- 這一行會不會讓快取那一份流進任何算次數、驗證、存檔的路？（grep 首頁上每一條寫入路拿的是哪一份）
- **她的手機上**：05 那一張卡「資料」那一格改之前／改之後

## 連動

- `CLAUDE.md`「算次數、驗證、預選額度要拿哪些來訪」那一列補一句：只拿來畫的快取讀取走另一支、不算進 `cacheReads()`
- 新的 ADR（同 07 那一支或另一支）

## 做完時留下的

- **先量再寫**：`repo.listCached()`（`getDocsFromCache()`）不經過 `noted()`；E2E `81` P9 在快取先畫那一下之後從頁面上讀 `repo.cacheReads()` → 0
  （走 `noted()` 的話每一份快取讀回來都會加一 —— 這一條沒有實際改成 `noted()` 量過紅燈）。ADR-0158 那幾條路（`listByCustomer()`、`visitsRead`、`listWhole()`）一個字沒動 —— 離線照舊擋
- 五份的 `cacheOnly`：`tasks.listOpen()`、`notes.listOpen()`、`visits.listByStatus()`、`visits.listUnclosed()`、`config.getSettings()`（`getDocFromCache()`，不在手機裡就丟 → 當成快取是空的）
- `home.js` 的 `render()`：雲端那一份一開始就去讀（`homeData()`），快取那一份（`cachedHomeData()`：**先問 `auth.confirmedAsRemembered()`** —— 快取不經過 Rules）
  先回來而且雲端還沒回來才先畫；雲端回來比 `homeStamp()`（每一筆 id＋`updatedAt`、設定的 `updatedAt`），不一樣才重畫，**換同一個 `ctx` 的內容**；
  抽屜（`drawer`／`whoDrawer`）開著時只換內容不重畫。雲端失敗但快取畫過了 → 留著、`toast.info()` 講一句。換頁之後才回來的不畫（`el.isConnected`）
- `#view` 上掛 `data-home-data`（`cache`／`server`／`stale`）：E2E 分得出先畫的是哪一份（屬性換了不算換節點）。**fixture 的 `settled()` 把 `cache` 算成還沒畫完** ——
  測試中途從模擬器改資料、回首頁讀一次數字的寫法才不會讀到這一台上次的
- 首頁上每一條寫入拿的是哪一份（grep 過）：確認／簽療程單抽屜按下去重讀那位客戶的全部來訪（`listWhole()`）；勾待辦（`toggleWhoTask()` → `tasks.setDone()`）、
  勾隨手記（`toggleNote()` → `note.prepareToggle()`）只寫 `done`／`doneAt`，健檢那一串在 `followupOpsAfterTaskChange()` 重讀；泡泡新增隨手記不吃任何一份。
  快取那一份的 id 跟雲端那一份同一筆，只有「別台剛改過」那一兩秒會不一樣 —— 跟頁面開著一小時是同一種舊
- 量開機：「資料」那一步是**第一次畫出數字**（快取那一次）。她手機上的「改之後」量的就是這個
- E2E `81`：P9 雲端被攔慢 2.5 秒 → 先畫快取、`cacheReads()` 是 0、雲端回來一樣的話那一格還是同一個節點；P10 別台勾掉一件（從模擬器改、這一台的快取不知道）→ 先 2、雲端回來 1
- 驗收：`npm test` 全綠；E2E `00`、`03`、`11`、`19`、`79`、`80`、`81` 本機 57 支綠。全量丟 CI
- **只做了待辦首頁**。日曆、客戶清單要不要照做：等她手機上「資料」那一格的數字（段五）。照做的話同一套：`cacheOnly` 讀、先問 `confirmedAsRemembered()`、比了再換

