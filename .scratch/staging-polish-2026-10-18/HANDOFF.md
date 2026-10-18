# 交接：10/18 staging 上點出來的優化

分支：`claude/staging-polish-1018`（10/18 從 origin/develop `cd71d34` 開）。**這一輪的基準點是 `cd71d34`**（審查那一段從這裡比）。
全貌與她的原話在 `spec.md`；每一支的細節在 `issues/`。流程照 `/kickoff`（`.claude/skills/kickoff/SKILL.md`）的第三、四段。

**兩支 PR**（她選的）：段一的小畫面先單獨一支 PR（PR A）、合進 develop，讓她早點在 staging 點到；其餘（段二～段七）做完、審查完再一支（PR B）。
同一條分支接著用：PR A 合了之後，段二開工前 `git fetch` → `git merge origin/develop`（或 rebase），接著做。

## 進度

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 零 | 談、開 issue、subagent 過目、照過目改 issue | — | ✅ 10/18 |
| 一 | 01 加購按鈕、02 照片上寫的收合、03 送的／體驗收得回去、04 日曆＋拉到全高、05 復原滑掉 12 秒、06 資料健檢的提醒 → **PR A、合進 develop** | high | ✅ 10/18 做完（＋她回中途發現的兩件）；PR A 見下面「段一做完了」 |
| 二 | 07 待辦首頁每一列三種顯示、08 今天／明天／逾期的組成 | high | ⬜ |
| 三 | 12 拍 Abovee「app 有、照片上沒有」只對照片上的人 | high | ⬜ |
| 四 | 09 EECP 一門（「體驗排幾分」、20 ⇔ 體驗、拍 Abovee 認得扣法不一樣、資料健檢保險） | xhigh | ⬜ |
| 五 | 10 沒床位的兩間拿掉、11 合併檔 v8 一開始就對＋**重產她那一份**（本機、真資料） | xhigh | ⬜ |
| 六 | 13 長備註與備註那一段的**原型**（設計 skill、假名字、發 Artifact）→ **停，等她回** | high | ⬜ |
| 七 | 14 備註那一段一起排順序＋聯絡方式＋中間那張卡、15 長備註那一頁 | high | ⬜ |
| 八 | `/matt-code-review`（從 `cd71d34` 比，含已經合進去的段一）、照建議修 | xhigh | ⬜ |
| 九 | 文件總檢查、全量 E2E（CI）、手動驗收清單、**PR B、合進 develop** | medium | ⬜ |

段三（12）不依賴別支，排在 09 前面是因為她每壓完一位就拍一次，這一條天天撞到；09 也動 `aboveeImport.js`，先後做比較不會互相蓋。

## 編號（先分好，平行也不撞）

| 段 | ADR | E2E spec（要新開的話） | `sw.js` VERSION |
|---|---|---|---|
| 一 | 0150 資料健檢的提醒 | 69 | **v194**（PR A） |
| 二 | 0151 首頁畫哪幾列、0152 今天／明天的組成 | 70 | **v195**（PR B；第一個動 `public/` 的那一段升，後面的不用再升） |
| 三 | 0153 拍 Abovee 對誰 | 71 | |
| 四 | 0154 EECP 一門 | 72 | |
| 五 | 0155 沒床位的兩間拿掉（合併檔升 `baobao-merge/v8`） | 73 | |
| 七 | 0156 長備註、備註的順序 | 74 | |

**資料健檢的項數**：09、10 各加一列「保險」的檢查（接在 `CHECKS` 最後面）→ `health.test.js`、`seed-staff.test.js` 寫死的總數跟著改。段一（06）不加項、只改既有兩項，所以 PR A 先合不會撞。

## 過目（10/18，唯讀 subagent）抓到、已經改進 issue 的

主控自己對過程式的四條（全部屬實）：
- **11**：合併檔的候選（`futureVisits`／`missingFromSheet`）只帶 `courseName`，app 的 `addExtraVisits()` 只問 `isUncounted()` 決定扣不扣 —— EECP體驗 改寫成 EECP 之後，候選會扣掉那位唯一一筆 EECP 額度。→ 候選帶 `giftKind`、**升 v8**
- **03**：三個呼叫端每畫一次都傳 `foldOpen()`，而選著體驗時它一律回 true —— 收起來撐不過下一次重畫。→ 開／收存在呼叫端的狀態、`foldOpen()` 只當第一次的預設、每次選擇後同步開關
- **01**：`planTweak.fields()` 只有客戶詳情在用，新增客戶與批次建立的「＋ 加一項」是各自的程式（CLAUDE.md「方案的微調…三個入口共用一張」那一句也不對了 → 段九改）
- **12**：`photoBounds()` 的 `customerId` 同時決定「對誰」與「範圍要不要放寬到整個月」，`flagMoved()` 讀同一份範圍 → 拆成兩件、這一支只改對誰；月底對帳 skill 也叫 `absentFromPhoto()` → 給它「對每一位」的選項

其餘寫進各支：09（拍 Abovee 認「已經記了」只比課程 → 扣法不一樣要算要改的；`slotMinutes()` 不帶 `giftKind` 的呼叫端；`rebookSlot()` 不管扣法 → 待她決定；那門課身上可能有額度 → 資料健檢只列不修；「體驗排幾分」不可以等於預設時長；EECP 在「送的／體驗…」裡排哪一排；`EECP(60)` 會出現在月曆上；漏列的引用）、
10（`roomByText()` 第 3、4 步不能拿、只改註解；`isBedlessOf()` 另外兩個呼叫端；E2E 與單元測試寫死的診間）、08（`nothing` 本來就算了簽療程單；營養品提醒也是有日期的隨手記；簽療程單走 `leaveFor()`）、
07（06 那一句叫她去一列預設藏起來的；loader 量不到網路請求 → 純函式；新的一頁要登記；她手動加的種類）、06（「要你看」是畫面自己數的）、05（`toast.js` 在 node 裡 import 不起來 → 純模組）、02（E2E `41` 也讀原字）、14（佔位照 `readMarks()` 的結果；Rules 的型別檢查；`fewer-words` 的 `KEEP`）、15（第七個找客戶的框）。

## 要問她的（段四開工前要有答案）

- **09 第 9 點**：來訪編輯器把一段已經排好的 EECP 60（扣額度）改成 20（體驗），要**原地改**（確認框講「這一段改成體驗、不扣額度，Abovee 上記得改成 EECP20」），
  還是當成**改課程**（舊的那一段取消、長一張「取消 Abovee」、新的一段重新待確認，ADR-0108 那一條）？建議原地改 —— 她多半是 Abovee 先改好了才來 app 改
  - **她 10/18 回：照建議，原地改**（「照你的建議 : Edit it in place … the confirm dialog says "This slot becomes a trial, no package charge — remember to change it to EECP20 in Abovee too."」）
    → 確認框講「這一段改成體驗、不扣額度，Abovee 上記得改成 EECP20」；不取消、不長「取消 Abovee」、不退回待確認

## 段一做完了（10/18 下午）

中間她臨時關網路一次（中午），接手之後做完。commit：

| issue | commit | verify |
|---|---|---|
| 01 | `af51278` | 01–03 一起：單元 4706、E2E 48 支 340 條全綠 |
| 02 | `e5e2bbb` | 同上 |
| 03 | `3e5940f` | 同上 |
| 04 | `f4b267d` | 04–06 與下兩件一起：單元 4727、E2E 57 支 418 條全綠 |
| 05 | `e219691`（WIP，中斷前）＋`166c344` | 同上 |
| 06 | `e219691`（WIP，中斷前）＋`35e92fc` | 同上 |
| ＋「換一款」「其他醫師」收得回去（她回中途發現） | `1cdc0cd` | 同上 |
| ＋ 一條永遠綠的測試、擋控制字元 | `523ee9d` | 同上 |

WIP 那一個沒有拆，訊息寫得清楚、後面接著收完的兩個 commit。

### 手動驗收清單（段一，她在 staging 上點；我在本機模擬器 390px 用假客戶走過一次、截圖看過）

1. 客戶 → 點一位 → 「額度」那一行右邊的「加購方案」→ 點一個方案 → 捲到最底：「＋ 加一項」是虛線的一小顆，跟底下「加購」「取消」中間空一段
2. 壓表 → 這個月 → 點一位身上有額度的 → 點一天 →「做什麼」最後一顆「送的／體驗…」→ 展開 → 點「功醫門診」→ 再點一次那一顆（現在寫「送的／體驗 ▾ 收起來」）→ 收起來了，那一顆變成綠底、寫「功醫門診 送的／體驗 ▸」→ 點上面一顆額度 → 那一顆變回「送的／體驗…」
3. 同一張卡：點一筆營養點滴的額度 → 品項那一排「換一款」→ 點別的一款 → 再點那一顆（現在寫「收起來」）→ 其他款收起來，選的那一款還看得到
4. 日曆 → 點有排東西的一天（抽屜停在一半）→ 右上角綠色「＋」→ 抽屜先拉到最上面，三顆「新增來訪／新增待辦／新增行事備註」都看得到 → 點空白處收起選單，抽屜留在上面
5. 隨便存一筆（例如客戶詳情的隨手記打一句按「記」）→ 底下出現「已儲存 復原」→ 往左一滑（或往下）→ 收掉了；再存一次，這次從「復原」那顆上面開始往下滑 → 收掉、**沒有**復原
6. 設定 → 資料健檢 → 最上面不再寫「有 2 項要你看」（沒有別的事時寫「沒有要處理的」）→ 底下「提醒」一組：「還沒問這輪方便的時間・N 位」「匯進來的額度還叫舊表的名字・N 筆」，點開才是名字
7. 壓表 → 這個月 → 右下角的相機（拍 Abovee）→ 拍一張 → 點開一列 →「照片上寫的 ›」收著 → 點開是原字 → 點一顆「要做什麼」→ 還開著 → 再點「照片上寫的」收回；同一列的「送的／體驗…」也收得回去

## 段一停在哪（10/18 中午，她臨時有事、要關網路，叫我先收尾）—— 留著當紀錄

| issue | 狀態 |
|---|---|
| 01 | ✅ commit `af51278`；verify 全綠（單元 4706、E2E 48 支 340 條，01–03 一起跑的） |
| 02 | ✅ commit `e5e2bbb`；同上 |
| 03 | ✅ commit `3e5940f`；同上 |
| 04 | ✅ commit `f4b267d`；E2E `69` 的 P4 綠，**整份 verify 還沒跑**（跟 05、06 一起跑） |
| 05 | 🟡 WIP commit（訊息開頭「WIP 05/06」）：`ui/toastSwipe.js`（純的，12 秒、門檻）＋單元測試 `tests/toast-swipe.test.js` 綠；`toast.js` 接好手勢、每一種 toast 帶 `kind`；SPEC 6.3 改好。**E2E `69` 的 P5 紅兩處**，接手先修這兩個：<br>① 拖 20px 彈回：x 差 0.76px —— `steady()` 量的是 boundingBox，`translate` 的 0.18s 過場還在走；改成等 `style.translate === ''` 之後再 steady，或 `toBeCloseTo` 放寬到 1px<br>② 往左拖 120px 之後 `#toast` 還看得到 —— 還沒查。先懷疑：Playwright 滑鼠的 pointermove 在 `setPointerCapture` 之前就離開了 toast（mouse.move 6 步、第一步就超過 8px）、或 `dismiss()` 的 180ms 之後 `hide()` 被下一個 `show()` 蓋掉。在本機模擬器開 P5 `--watch` 看一次 |
| 06 | 🟡 只有測試（同一個 WIP commit）：`tests/health.test.js` 補「只是提醒的那兩項」（紅）、E2E `60` 改 H2、加 H3（紅）；ADR-0150 寫好了；SPEC 的表改好。**`domain/health.js`（`notice: true`、改名、`detail` 的字）與 `ui/views/health.js`（「提醒」那一段、結論只數不是提醒的）還沒動** —— 照 issue 06 與 ADR-0150 做 |

接手的順序：`npm run emulators` → 修 P5 → 做 06 → `npm run verify`（04–06 一起）→ 把 WIP commit 拆回 05、06 兩個 commit（或照舊一支一個 commit 往上疊、WIP 那一個留著也行，PR 是 squash 不是重點）→ 收尾那五步（CI 全量、手動驗收清單、PR、HANDOFF、段二開場）。
**05、06 的 issue 還是 Status: todo**，「做完時留下的」還沒寫。

**她 10/18 下午回中途發現**：「`tests/visit-editor.test.js:244` 那條檢查從來不會失敗，好，修掉」「營養點滴的『換一款』也是收不回去，好，一起修掉」
→ 兩件都併進段一（PR A）：修那一行＋加一條掃全部被追蹤的 .js 不准有 0x08 的測試；「換一款」照 03 的做法收得回去。

## 中途發現

（做的時候發現她沒發現的關聯問題或同一個形狀的另一個 bug：哪裡、什麼情境會錯、建議。**不要當場岔出去修**，一段結束時一次列給她問。）

- ✅ 修了（她：「好，一起修掉」，`1cdc0cd`）—— 03：「換一款」（營養點滴品項，`.chip--more`、`data-tuck`）是同一個「收不回去」的形狀。
  實際做法比 03 簡單：那一排選著的那一顆本來就一直看得到（不會看起來像取消選取），所以不用記開或收，`toggleTuck()` 一支、CSS 一條
- 01：CLAUDE.md「方案的微調」那一列「三個入口共用一張」已經不是真的（段九改文件時處理）
- ✅ 修了（她：「好，修掉」，`523ee9d`；lessons.md 補「十一」）—— **`tests/visit-editor.test.js:244` 那一條擋不住任何東西**（段一做 03 時發現）：`/wholeVisit \|\| isNew<退格字元>/` ——
  當初寫 `\b` 時 Bash 吃掉一個反斜線，留下一個看不見的退格字元（0x08）；原始碼裡永遠不會有那個字元，所以 `doesNotMatch` 永遠綠。
  我自己在 03 也踩到一次（`giftFold.js` 的 `/<button\b/`），單元測試抓到才發現。建議：修那一行，**再加一條測試掃全部被追蹤的 .js 不准有 0x08**
  （一行的事，以後同一個坑會大聲）。這一段沒動，等她說
- 03 的設計（我自己定的）：「送的／體驗」那一顆展開之後**照樣看得到**、寫「送的／體驗 ▾ 收起來」（以前展開就藏起來）；
  收著、選著底下一顆時寫「那一門 送的／體驗 ▸」而且是按下去的樣子；壓表換一顆額度不動她收起來的那一組（開或收只在換一位、記完一段時回預設）

---

## 段一的開場（high）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。
分支 claude/staging-polish-1018（已經開了、spec 與 issue 已經 commit）。這是第一段：六支小畫面，做完單獨開一支 PR、合進 develop。

先讀：
- .scratch/staging-polish-2026-10-18/HANDOFF.md（進度、編號、過目抓到的）
- .scratch/staging-polish-2026-10-18/spec.md
- issues/01～06
- docs/agents/lessons.md（一、五、十）
- CLAUDE.md 跟這一段有關的幾列：「方案的微調」「畫面上一段常駐的說明」「送的／體驗、預設體驗的課」「額度那一排的順序」「壓表那一頁的任何互動」「存起來的 pushLayer() handle」「貼在畫面底部的東西」「寫入的等待與失敗文案」「資料健檢那一頁的版面」「共用元件身上的屬性名字」「public/ 底下任何檔案」

這一段做：01 加購按鈕擠、02 拍 Abovee「照片上寫的是」收合、03「送的／體驗…」收得回去（三個入口，注意過目查到的 foldOpen() 每次重畫都重算）、04 日曆那一天的抽屜按＋先拉到全高、05 復原那一條滑得掉＋12 秒、06 資料健檢的「還沒問這輪方便的時間」「舊表名字」只是提醒。
不做：07 以後的任何一支。

動工前 git fetch；develop 往前走了就 rebase。
每一個要改的函式，先 grep 所有呼叫端與畫面上的字（三個入口那種）。
中途發現她沒發現的關聯問題或同一個形狀的 bug：先記進 HANDOFF 的「中途發現」，繼續做這一段的。

每一支：先寫重現得出來的失敗測試（紅）→ 修到綠 → npm run verify → 一支一個 commit → issue 的 Status: done、底下寫「做完時留下的」。
編號照 HANDOFF：ADR-0150、sw.js v194、E2E spec 要新開就用 69。
public/ 動了就顧 sw.js 的 SHELL 與 VERSION；新檔登記 tests-e2e/related.js。

這一段結束時：
1. 全量 E2E 丟 CI（gh workflow run e2e-full.yml --ref claude/staging-polish-1018），不要在她的機器上全跑
2. 手動驗收清單（她可以照順序點的路，你自己在本機模擬器 390px 走過，截圖遮字）
3. 開 PR 到 develop（標題與內文一個真名都不帶），CI 綠了合進去；staging 會自動部署
4. 更新 HANDOFF 的進度、把「中途發現」一次列給她問要不要修
5. 把段二的開場（high）貼給她，停
```

## 段二的開場（high）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一（01～06，PR A）已經合進 develop。這是第二段：待辦首頁。

先 git fetch，把 origin/develop 合進這條分支（段一的 PR 是從這條開的，合了之後 develop 有那幾個 commit）。

先讀：
- HANDOFF.md（進度、編號、中途發現她回了什麼）、spec.md、issues/07、08
- docs/agents/lessons.md（一、二、五、七）
- CLAUDE.md：「任何『先看誰』的排序或推薦名單」「日曆上『待辦』那一類」「隨手記的欄位或那一列的樣子」「營養品的形狀或交付」「待辦中心的兩張抽屜」「一列任務要顯示什麼」「從一頁帶人到另一頁」「新增一個會寫進稽核的欄位」「public/ 底下任何檔案」
- ADR-0043、0044、0059、0072、0110

這一段做：07 每一列「一直顯示／有才顯示／不顯示」＋設定頁、08 今天／明天／逾期算進簽療程單與有日期的隨手記。
不做：09 以後、12。

動工前每一個要改的函式先 grep 所有呼叫端（三顆數字、renderGroup 的 filters、visitsToClose、note.row、prepareToggle）。
中途發現先記進 HANDOFF 的「中途發現」。
每一支：紅 → 綠 → npm run verify → 一支一個 commit → Status: done ＋「做完時留下的」。編號：ADR-0151、0152；sw.js 這一支 PR 用 v195（這一段是第一個動 public/ 的就升）；新 E2E spec 用 70。

這一段結束時：更新 HANDOFF 進度、把中途發現一次列給她問、把段三的開場（high）貼給她，停。
```

## 段三的開場（high）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一（PR A，已合）、段二（07、08）做完了。這是第三段：拍 Abovee「app 有、這次照片上沒有」只對照片上的那幾位（issue 12）。

先 git fetch；develop 往前走了就 rebase。
先讀：HANDOFF.md、spec.md、issues/12；docs/agents/lessons.md（一、四、五）；ADR-0129（整支）；
CLAUDE.md「拍 Abovee 記很多段」那一列的「app 有、這次照片上沒有」那幾句、「月底對帳 skill 讀的那幾支」那一列。

做：12。重點：「對誰」與「範圍放不放寬」拆成兩件，範圍一個字都不變（flagMoved() 讀同一份）；月底對帳 skill 要有「對每一位」的選項。
不做：09 以後。

紅 → 綠 → npm run verify → commit → Status: done ＋「做完時留下的」。編號：ADR-0153；新 E2E spec 用 71。
結束時：更新 HANDOFF、中途發現一次列給她問、把段四的開場（xhigh）貼給她，停。
```

## 段四的開場（xhigh）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一～段三做完了。這是第四段：EECP 合成一門（issue 09）。這一支碰次數、三個入口與拍 Abovee，慢慢來。

先 git fetch；develop 往前走了就 rebase。
先讀：
- HANDOFF.md（「要問她的」那一題她回了什麼 —— 09 第 9 點照她的答案做）、spec.md、issues/09（過目之後改寫過，每一點都有檔案與行號）
- docs/agents/lessons.md（全部；一、二、四、五、六最相關）
- CLAUDE.md：「一段來訪要排多久」「送的／體驗、預設體驗的課」「新增一個會建立時段的入口」「一筆來訪改得動的地方」「一段來訪在畫面上叫什麼」「試算表的註記」「拍 Abovee 記很多段」「主檔的 aboveeNames」「domain/seed.js（種子）加一筆、改一格」
- ADR-0108、0121、0122、0148、0149
- 記憶「改種子之後要另外查的七個地方」

做：09。判準裡「這一行會不會讓一段體驗被算進 EECP 的額度，或反過來」那幾條，三個入口＋拍 Abovee 對上既有的段＋候選與補登，各一個測試。
不做：10、11（下一段）、13 以後。

紅 → 綠 → npm run verify → commit → Status: done ＋「做完時留下的」（含 slotMinutes() 呼叫端那一張表）。編號：ADR-0154；新 E2E spec 用 72。
結束時：更新 HANDOFF、中途發現一次列給她問、把段五的開場（xhigh）貼給她，停。
```

## 段五的開場（xhigh）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一～段四做完了（09 EECP 一門已經在）。這是第五段：沒床位的兩間拿掉（10）、合併檔一開始就對＋重產她那一份（11）。

先 git fetch；develop 往前走了就 rebase。
先讀：HANDOFF.md、spec.md、issues/09 的「做完時留下的」、issues/10、11；docs/agents/lessons.md（一、三、四、六、八）；
CLAUDE.md：「診間的名字、簡寫或清單」「舊表 B2、合併檔的購買欄位」「一段來訪要排多久」（merge.mjs 的 endOf() 是第二份）「domain/seed.js（種子）加一筆、改一格」；
.claude/skills/calendar-sheet-merge/SKILL.md；記憶「改種子之後要另外查的七個地方」「10/14 切換那天」。

做：10 → 11。11 要升 baobao-merge/v8（候選帶 giftKind），然後照 .local/references/cutover-2026-10-14/ 那一套重產她的合併檔、跑模擬器匯一次。
**.local 那一夾有真名：只在本機跑、終端機只印數字與差異的種類，一個名字都不印、不寫進 repo。**
不做：13 以後。

紅 → 綠 → npm run verify → 一支一個 commit → Status: done ＋「做完時留下的」。編號：ADR-0155；新 E2E spec 用 73。
結束時：更新 HANDOFF、中途發現一次列給她問、告訴她新的合併檔在哪、staging 合進去之後要 npm run staging:reset 再匯，把段六的開場（high）貼給她，停。
```

## 段六的開場（high）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一～段五做完了。這是第六段：**只做設計** —— 長備註與客戶詳情備註那一段的可以點的手機版原型，給她看。這一段不改 app 的程式。

先讀：HANDOFF.md、spec.md（長備註那幾列、我自己定的）、issues/13、14、15；記憶「給她看的東西：一次一題、畫出來」。
看現在的長相：ui/views/customerDetail.js 備註那一段、ui/components/marks.js、ui/views/playbook.js（她指名「像備忘錄那樣」）、public/css/tokens.css、ui/icons.js。

做：照 issue 13。先載入設計 skill（frontend-design 或 impeccable，挑一支照它的流程），方向是延續這個 app 現在的樣子。
單一 HTML、390px、假資料（客戶A、客戶B，一個真名都不要），檔案放 scratchpad 不進 repo，發成 Artifact 給她連結。
要她選的地方做成原型裡可以切換的版本，不要用文字問。

結束時：HANDOFF 記原型的連結與每一個互動在 app 裡要對到哪一支（手勢會不會跟抽屜拖曳、左右滑換卡打架）、要她選的那幾題，停下來等她回。
她回了之後：把她的原話逐字貼進 14、15 的「她要的」，再把段七的開場（high）貼給她。
```

## 段七的開場（high）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一～段六做完了，她看過長備註的原型（她的回覆在 issues/14、15 的「她要的」）。這是第七段：把長備註接進 app。

先 git fetch；develop 往前走了就 rebase。
先讀：HANDOFF.md（原型連結、互動對到哪一支、她選的）、spec.md、issues/13、14、15；docs/agents/lessons.md（一、三、八）；
CLAUDE.md：「客戶身上的標記」「備忘錄編輯那張卡的版面」「共用元件身上的屬性名字」「一顆小圖示按鈕的觸控區」「存起來的 pushLayer() handle」「打字找客戶的框」「新增一個會寫進稽核的欄位」「tokens.css 加一個顏色」「public/ 底下任何檔案」。
動工前 grep `\.marks\b`（21 處讀它）—— marks 的形狀一個字都不改。

這一段做：14 → 15。不做：審查（段八）。
每一支：紅 → 綠 → npm run verify → 一支一個 commit → Status: done ＋「做完時留下的」。編號：ADR-0156；新 E2E spec 用 74；新檔登記 sw.js SHELL 與 tests-e2e/related.js；firestore.rules 補型別檢查、npm run test:rules。

這一段結束時：更新 HANDOFF、中途發現一次列給她問、把段八（審查，xhigh，單獨一段）的開場貼給她，停。
```

## 段八的開場（xhigh）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一～段七做完了。這是第八段：審查，單獨一段。

先 git fetch；develop 往前走了就 rebase。
先讀 HANDOFF.md、spec.md、issues/ 全部的「做完時留下的」。
跑 /matt-code-review，從這一輪的基準點 cd71d34 比（段一已經合進 develop，照樣一起審）。照建議修；提過沒改的寫理由進 HANDOFF。
修的每一條照一支 issue 的規矩：紅 → 綠 → npm run verify → commit。

結束時：更新 HANDOFF、把段九的開場（medium）貼給她，停。
```

## 段九的開場（medium）

```
這一輪在做她 10/18 在 staging 點出來的優化（.scratch/staging-polish-2026-10-18/）。分支 claude/staging-polish-1018。
段一～段八做完了（審查修完）。這是最後一段：文件、全量 E2E、手動驗收清單、PR B、合進 develop。

先讀 HANDOFF.md、spec.md。
1. 文件總檢查：每一個拿掉／改名的字 grep docs/ SPEC.md CONTEXT.md（「資料過期」「EECP體驗」「點滴8」「VIP7」「5–10 秒」「三個入口共用一張」…）；
   CLAUDE.md 連動表補新長出來的連動（待辦首頁的設定、今天／明天的組成、體驗排幾分、拍 Abovee 對誰、合併檔 v8、備註那一段的順序、第七個找客戶的框）、改寫被推翻的（診間那一列、送的／體驗那一列、方案的微調那一列）；lessons.md 有新坑就補
2. 全量 E2E 丟 CI：gh workflow run e2e-full.yml --ref claude/staging-polish-1018
3. 手動驗收清單：她可以照順序點的路，你自己在本機模擬器 390px 走過（截圖遮字）；照「她點得到的入口」寫，不是「我修好了什麼」
4. PR 開向 develop（標題、內文、commit 訊息一個真名都不帶），內文附手動驗收清單與「我自己定的」
5. CI 綠了合進 develop；提醒她 staging 要 npm run staging:reset 再匯段五重產的那一份合併檔；拍照的 Function 這一輪沒動就不用部署
6. HANDOFF 寫「已合進 develop（commit）」、每一支 issue 都是 Status: done
```
