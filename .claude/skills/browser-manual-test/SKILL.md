---
name: browser-manual-test
description: >
  用 Claude 桌面 app 的內建瀏覽器（mcp__Claude_Browser__*，她叫它 ctrl+shift+b 那一個）代她在 staging 把手動驗收清單
  一條一條點完，記下問題與重現步驟，沒走的列成「要她實機點」。她說「幫我手動測試」「照 PR 清單點一遍」「上 main 前在 staging 點完」
  「用瀏覽器幫我測」「staging 驗收」，或 PR 內文最後有「你可以照順序點的」清單、而她要你代點時，一定要用這個 skill。
  只在 staging；不碰正式站。會寫入的步驟只動假名的測試資料。拍照辨識用自己畫的假單子餵相簿那條路。
  不是 E2E（那是 `tests-e2e/`，`npm run verify`）；不是月底對帳。
---

# 用內建瀏覽器代她手動驗收（staging）

2026-11-07 第一次這樣做（PR #225、#226），做法與踩過的坑都在這裡。

## 什麼時候用、什麼時候不用

| 用 | 不用 |
|---|---|
| PR 內文最後有「你可以照順序點的」清單，她要你代點 | 規則、狀態機、資料算法的對錯 —— 那是單元測試與 `tests-e2e/` 的事 |
| 上 main 前要在 staging 把一批改動都點過 | 要在**正式站**點 —— 一律不碰（網址、資料都不碰） |
| 要看畫面上實際長什麼樣、講什麼字 | 只有手機／iPad 才測得到的（見「一定要實機」） |

## 先講兩條硬規矩（`CLAUDE.md`「上線」那一節）

1. **staging 的畫面上有真名**（它是正式站某天的複本）。畫面只看不存；報告、skill、commit、PR 一個真名都不寫，例子寫「客戶A」。
   讀 `.local/` 一律接過濾網 `| node <主資料夾>/.local/references/redact.mjs`。這個 repo 是 public。
   **別整頁讀客戶清單／壓表牆**（`get_page_text` 在 `#/customers`、`#/schedule` 會把全部真名倒進來）—— 用 JS 只取要的那幾個元素。
2. **會寫入的步驟只動假名的測試資料。** 要客戶就新增「測試客戶甲」之類名字明顯是假的，電話 `09000000xx`、病歷號 `9000000x`。
   不改、不勾、不刪任何真的客戶與他們的資料。每寫一筆都記下來（做了什麼、在哪），測完收掉（軟刪除）並寫進報告。

## 開工順序

1. 讀 PR 內文的清單：`gh pr view <號> --json body --jq .body`（兩支以上就分開讀）。
2. 載入瀏覽器工具（如果是 deferred）並讀 `anthropic-skills:built-in-browser`。
3. `mcp__Claude_Browser__preview_start` 帶 `url: https://wellness-clinic-staging.web.app` 開起來（網址見 `docs/STAGING.md`）。
4. `tabs_context` 看面板是不是「hidden」。**要她按 Ctrl+Shift+B 叫出面板、在面板裡登入 staging，等她說好再動。** 登入是她的，不要代按。
5. 確認 `sw.js` 的版本是 PR 說的那一版：`fetch('/sw.js')` 看 `VERSION`，`caches.keys()` 看 `shell-vNNN`。對不上就 reload（畫面最上面「有新版本・點一下更新」那顆在內建瀏覽器裡常是 0×0，直接 reload）。
6. 開 `.scratch/<這次的名字>/REPORT.md`，**每過一條就寫進去**（context 壓縮時才不會丟）。

## 在內建瀏覽器裡怎麼操作（量過的）

視窗只有約 630×626，面板與抽屜擠，很多按鈕在可視範圍外。所以：

| 做什麼 | 怎麼做 |
|---|---|
| 讀畫面 | 先 `get_page_text`／`read_page`；客戶清單那種含真名的頁面用 `javascript_tool` 取特定元素（`querySelector(...).innerText`） |
| 點可見的東西 | `computer` 的 `left_click`；座標用**最近一張截圖的座標框**（截圖會寫 `coordinate frame`），不是 CSS 像素（差約 1.25 倍） |
| 點被擠到畫面外的 | `javascript_tool` 裡 `button.click()`。先貼這支小幫手：`window.$c=(t,root=document)=>{const b=[...root.querySelectorAll('button,[role=button],a,label')].find(x=>x.innerText.trim()===t&&x.offsetParent!==null); if(!b) return 'nf:'+t; b.click(); return 'ok'}`（頁面一重載就消失，要重貼） |
| 打字 | 先用 JS `el.focus()`（`setSelectionRange` 放游標），再 `computer` 的 `type`。**用 `ref` 點輸入框常點歪**（ref 座標是 CSS 像素）；`form_input` 的 ref 在頁面重畫後會過期。要設值又要觸發畫面更新就 `el.value=…; el.dispatchEvent(new Event('input',{bubbles:true}))` |
| 長按（隨手記、日曆那一列） | JS 派 `PointerEvent('pointerdown')`，等 900 毫秒，再派 `pointerup`（`pointerType:'touch'`） |
| 連按兩下 | JS 連續 `btn.click()` 兩次，中間 60 毫秒 |
| `type="date"` | `el.value='2026-11-12'` ＋ 派 `input`／`change` |
| 滑鼠拖 | `computer` 的 `left_click_drag`，座標用截圖座標框 |
| 等 | `computer` 的 `wait`（上限 10 秒）。**不要在 `javascript_tool` 裡 `return`**，直接寫最後一個運算式 |

誤點的時候（我 11/7 就點到過一次真客戶的排時段編輯器）：**先 reload、不要存**，再繼續；寫進報告「誤開但沒存」。

## 首頁數字的讀法（我 11/7 讀反過一次）

待辦首頁那一排是「**數字在前、名稱在後**」：`36 逾期｜2 今天｜1 明天`。讀 `get_page_text` 時別把數字配給它前面的字。

## 拍照辨識怎麼測（畫假單子餵相簿）

相機在內建瀏覽器裡被擋（`getUserMedia` 不給），所以走拍照層的「相簿」`<input type=file data-cam-album-input>`。
單子**在頁面裡用 canvas 畫**（瀏覽器開不了 `file://` 與你本機的 localhost），畫圖腳本在 `draw/`：

| 單子 | 入口 | 腳本 | 看什麼 |
|---|---|---|---|
| 拍 Abovee | `#/schedule` → 選月份（如「11月」）→ `[data-abovee]` | `draw-abovee.js` | 欄位、課程名、診間、取消原因；全是 app 裡沒有的人時抬頭講「app 裡沒有 N 段」 |
| 拍訂購單 | `#/customers` → 右下「新增」→「拍訂購單」 | `draw-orderform.js` | 姓名、日期、套組、健檢勾、手寫列、尾款、備註 |
| 拍療程單 | `#/settings/treatment-sheets` → `[data-sheet-camera]` | `draw-sheet.js` ＋ `paper()` | 姓名、編號、課程、每列日期與簽名 |
| 拍方案文宣 | `#/settings/plans` → `[data-photo-plan]` | `draw-flyer.js` ＋ `paper()` | 名稱、總價、會籍、每個項目 |

做法（一種單子畫一張就好）：

1. 打開入口，把 `draw/draw-helpers.js` 與那一支 `draw-*.js` 貼進 `javascript_tool`（先貼 helpers 再貼 draw）。
2. `await $feed('[data-cam-album-input]', async () => paper(await drawSheet()))`（Abovee、訂購單不用 `paper`）。
3. **等縮圖完成再按送出**（`[data-cam-send]` 沒出現或文字不是「送出 N 張」就還沒好），按下去等 10～20 秒；`.cam__say` 會顯示進度。
4. 確認層出來之後讀文字、對照你畫的內容，記辨識對不對。
5. **確認層不要按存**：訂購單按「收起」→「離開」、Abovee 按 `.abl__close`、療程單 `[data-tsc-close]` → 「離開」、文宣的編輯頁換網址離開。要存也只存到假客戶。

規矩：

- 每一種單子**幾張就好、不要重複狂試**（每張都叫 staging 的 Gemini，花一點錢，她同意了）。失敗時先讀原因：`const m = await import('/js/data/ai.js'); try { await m.extract('<kind>', file) } catch (e) { console.log(e.reason, e.details) }`。
- 圖用假名、假病歷號（`9000000x`）。**不要從 `.local/references/` 抄任何真名、病歷號**；那邊只看格式。
- **幾乎全白、只有細線的圖會被 app 當成空白**（`photo.js` 的 `looksBlank()`）→ 畫面講「照片讀不出來」。所以都過 `paper()` 疊一層紙張漸層、轉 JPEG。這是真的相機照片不會中的測試假象，不是 app 壞了（報告裡記了一筆小觀察 P1）。
- 辨識是「照抄」，翻成客戶資料是 domain 的事；只看畫面最後長的樣子對不對。

## 一定要實機（不要假裝測過）

列成「要她實機點」，桌機瀏覽器縮視窗只能先看版面：

- 主畫面那一顆登出再登入（iPad、手機、Android）
- 真的鍵盤（打字時底部導覽列收起、轉方向）、轉手機方向
- 注音輸入法
- 真的相機取景與系統相機（內建瀏覽器裡被擋）
- Android 小工具、MacroDroid 打開 LINE
- 真人手寫的單子（自己畫的印刷體比真手寫好讀）

## 怎麼記問題

寫到 `.scratch/<名字>/REPORT.md`（不帶真名）。每一個問題：

- 哪一條清單／哪個畫面
- 看到什麼、期待什麼
- **重現步驟**（一步一步、哪個網址、點哪裡；能用 console 一行重現的附那一行）
- 截圖描述（**不存圖**：staging 畫面有真名）
- 嚴重度與你的猜測（沒驗證的要寫「沒驗證」）

另外三段一定要有：**清單每一條的結果**（過／沒過／要她實機點）、**我在 staging 寫了什麼**、**收尾做了什麼、留下什麼痕跡**。

## 收尾

1. 隨手記：勾掉（待辦 → 隨手記 → 方框）→ 切到「已完成」→「刪掉這一筆」。
2. 客戶：`#/customers/<id>` →「停用與刪除」→「刪除」。**還掛著待確認／已確認的來訪、沒做的待辦、沒勾的隨手記就刪不掉**（確認框會列出來）：來訪走壓表的「批次取消」（`#/schedule/cancel`）、待辦到各自的類別頁（`#/todo/<名稱>`）勾掉、隨手記勾掉再刪。取消後會長出新的「取消 Abovee」「約二返」，也要勾掉。
3. 一次性客人：`#/customers` →「看一次性客人」→ 點進去 →「刪除」。
4. 全部是軟刪除，設定 → 已刪除項目 可還原。稽核紀錄與已完成的來訪（掛在已刪的假客戶底下）會留著，寫進報告。
5. 最後把 `.scratch/<名字>/REPORT.md` 與有改的 skill 開 PR 進 `develop`（基底不是 `main`）；CI 全綠就合（`CLAUDE.md`「合併」）。推之前自己看一眼有沒有真名。

## 建議的模型與 effort

Sonnet、effort low～medium：這件事是照清單點、讀畫面、記下結果，判斷量小。不要在一顆按鈕前想很久；
不確定是不是 bug 時先寫下看到什麼、跑一次重現，再決定要不要記成問題。需要讀程式找原因時才升 effort。
要不要開 subagent 見下一節。

## 分工：哪些一口氣做完、哪些分出去（她 2026-11-07 補的）

**先判斷、再分。** 把清單拆成「鏈」：

- **一條鏈**＝同一位客戶的前後步驟（例：建客戶 → 排健檢 → 簽療程單 → 勾報告 → 排二返）。**一口氣由同一個人做完**，中間不分手。
- 彼此不碰同一份資料的鏈才能分出去。

規矩：

1. **同時最多兩個 subagent**（她的長期規矩：一次開很多幾分鐘就燒光額度；她這次說「可以很多個」，但額度的理由沒變，兩個一批）。簡單的、很短的鏈自己做，不要為了分而分。
2. **一個 subagent 控制一個瀏覽器分頁**：`tabs_create` 拿 `tabId`，之後**每個**瀏覽器工具都帶 `tabId`（不帶就打到「目前那一頁」，兩個人會互相踩）。登入是共用的（同一個 profile），分頁開出來就是登入好的。
3. **每條鏈各用一位新增的測試客人，名字帶鏈的代號**（例「測試甲-營養品」「測試乙-健檢」；假名、電話 `09000000xx`、病歷號 `9000000x`）。兩個 subagent 不要動同一位，免得互相蓋掉。測試客人要「完全符合那個情境」（要測營養品提醒就建一位帶營養品的，要測約二返就建一位買了健檢的），不要拿既有的客人湊。
4. subagent 的 brief 要寫清楚：哪個 `tabId`、哪條鏈、哪位測試客人、**真名與寫入的規矩**（本檔最前面兩條原文貼進去）、做完回報的格式、**收尾要收掉自己建的**。主 session 負責合併報告。
5. 拍照辨識（叫 Gemini）集中給一個人做，不要兩個人同時送。

## 一開始先做的事

- 看 staging 最上面有沒有「有新版本・點一下更新」，有就點。**內建瀏覽器裡那顆常是 0×0 點不到**：直接 reload，再確認跑的是 PR 說的版本（`fetch('/sw.js')` 看 `VERSION`、`caches.keys()` 看 `shell-vNNN`，或設定頁「程式」那一格）。
- **能用文字讀的不截圖**（省額度，也不會把真名存下來）：`get_page_text`、`read_page`、`find`、`javascript_tool`。真的要看版面才截圖，截了只看不存。
- **要對數字用 `find`／`read_page` 或直接讀元素，別信 `get_page_text` 的數字配對**（數字在前、名稱在後，很容易配到前面的字；見上面「首頁數字的讀法」）。

## 更快更準的做法、會遇到的問題

| 問題 | 做法 |
|---|---|
| 日期欄 | 她的經驗是用 `form_input` 填；我這次用 `el.value='2026-11-12'` ＋派 `input`／`change` 也行。**`form_input` 的 ref 在頁面重畫後會過期**，失敗就退回 JS |
| 長按 | JS 派 `pointerdown`、等 900 毫秒、派 `pointerup` |
| 原生對話框（`confirm`／`alert`、檔案選擇器）按不到 | 這個 app 的確認框都是自己畫的（`.dialog`），用 `$c('按鈕字')` 點；檔案選擇不開原生視窗，直接塞 `<input type=file>` 的 `files`（見拍照那節） |
| 登入過期 | 畫面突然變登入頁、或寫入一直轉圈：停下來請她在面板裡重新登入，不要代登 |
| 背景分頁的計時不準 | 面板隱藏（`tabs_context` 說 hidden）或分頁在背景時 `setTimeout` 被拖慢，toast 久久不消、`wait` 不準。要看時間相關的行為先請她把面板叫出來、把那個分頁 `tabs_select` 到前面 |
| 畫面還沒載完就點 | 先 `wait` 3 秒；客戶清單、名單類的頁面是**載入後才重畫**，太早點會點到剛出現的真客戶（我誤開過一次真客戶的編輯器）。點之前用 JS 確認目標元素存在 |
| `ref` 點擊座標偏 | `ref` 給的是 CSS 像素，截圖座標框大約 1.25 倍；點不準就用 JS `click()` |
| 面板／抽屜太矮、按鈕在畫面外 | `javascript_tool` 的 `click()`；或 `scroll_to` |
| 同一個頁面重載後 `window.$c`、`$feed` 消失 | 重貼 |
| 分頁卡住 | `tabs_context` 看狀態、`navigate` 重開；`computer` 截圖逾時就改用文字工具 |

## 這個 skill 的來歷

- 第一次用：2026-11-07，PR #225（日曆待辦編輯器、記一句連按、改日期那行、給營養品那行）、#226（批次建立的一次性客人、日曆新增二返、拍 Abovee 抬頭、滑鼠拖面板）。
  清單全過；找到的小問題在當時的 `.scratch/staging-browser-test/REPORT.md`。
- 她的規矩出處：`CLAUDE.md`「上線」（staging 有真名、會寫入的驗收在本機模擬器走、staging 給她點）。
  這支 skill 是例外：**她明說要你用內建瀏覽器代點**時才在 staging 寫入，而且只寫假資料、測完收掉。
