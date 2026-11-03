# HANDOFF：拍 Abovee 辨識完一眼看得完

分支 `claude/abovee-confirm-glance`（從 `develop` cd1d29b7 開；第一個 commit 是上一輪那筆只在分支上的交接紀錄）。全貌與她的原話在 `spec.md`。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 一 | 01 拿掉「別的課當體驗」、02 列上印人與診間 | high | done（caaca04c、66e610dc；`sw.js` 現在 **v221**） |
| 二 | 03 ADR-0170＋紅字短標記、04 「辨識結果／發現問題 N」切換、05 文件 | xhigh | todo |
| 三 | `/matt-code-review` 審這一輪全部 | xhigh | todo |
| 四 | 照審查修、手動驗收（模擬器）、開 PR 進 `develop`、照 CLAUDE.md 合併 | medium | todo |

## 每一段共同的規矩

- 先讀 `CLAUDE.md`、`docs/agents/lessons.md`、`spec.md`、這份 HANDOFF 的「使用者已經決定的」「過目抓到的」「中途發現」
- **改一個已經存在的函式、型別或畫面上的字之前，照 `ripple-check` skill**：`codegraph sync` → `codegraph callers`／`impact` 列出呼叫端、逐條寫下會怎麼受影響；
  純 JS，**再用 grep 函式名對一次**；畫面上的字另外 grep（`tests/`、`tests-e2e/`、`docs/`）。修完 bug 照它找同一個形狀的地方
- 一支 issue 一個 commit：先寫一支會紅的測試、跑過確認紅 → 修到綠 → `npm run verify` → commit → issue 的 `Status: done`、底下寫「做完時留下的」
- **`npm run verify` 之前先 `npm run emulators`（背景）**：verify 不幫你起模擬器，沒起的話 E2E 全是 `fetch failed` 而指令照樣 exit 0（上一輪踩過）
- 動到 `public/` 的每一個 commit 升 `sw.js` 的 `VERSION`（**現在 v219**）、跑 `npm run shell:snapshot`；同一支 commit 裡再改 `public/` 不用多升
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

### 段三

### 段四

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

（段一做完時主控補）

### 段三：審查（effort xhigh）

（段二做完時主控補）

### 段四：照審查修、驗收、PR（effort medium）

（段三做完時主控補）
