# HANDOFF：2026-11-05 第一輪小修

分支 `claude/small-fixes-2026-11-05`（從 `origin/develop` `3bd4611d`）。PR 進 `develop`，CI 綠就合（CLAUDE.md「合併」）。全貌與她的原話在 `spec.md`。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 段一 | 01、02、03、04（存檔與連按） | high | **完成**（11/5）：`796f0527`、`4cd2141a`、`4cd55caf`、`8b7aa9ad` |
| 段二 | 05、06、07（隨手記日期、行事備註的字與顏色） | high | **完成**（11/5）：`b08c8150`、`3d3d2942`、`b68d5a2a`；`sw.js` 到 v238 |
| 段三 | `/matt-code-review` 審全部、修審查意見、手動驗收清單、開 PR、CI 綠合進 develop | xhigh | 等段二 |

## 每一段共同的規矩

- 動工前 `git fetch`；分支落後 `origin/develop` 就 rebase，不重做
- **一支一個 commit**：先寫一支會紅的測試、跑過確認紅 → 修到綠 → `npm run verify` → commit → issue 的 `Status: done`、底下寫「做完時留下的」
- **改已經存在的函式、畫面上的字之前照 `ripple-check`**（`codegraph sync` → `callers`／`impact`，純 JS 再用 grep 對一次）；修完 bug 找同一個形狀的地方
- **中途發現的不岔出去修**：記進下面「中途發現」（哪裡、什麼情境會錯、建議），段末一次問她；她說修的，修之前再查一次牽連
- **subagent 同時最多兩個**
- `public/` 有改：`sw.js` 的 `VERSION` 加一＋`npm run shell:snapshot`。**每一個動到 `public/` 的 commit 都要再加一**（CLAUDE.md：同一個 VERSION 只能對一份內容，同一支 PR 第二次動也要加）
- E2E 只跑相關的（`npm run verify`），**不要全跑**；`E2E_WORKERS` 照設定檔（家裡 2）；換目錄跑之前先停殘留的模擬器
- 公開 repo：commit 訊息、`.scratch`、測試一個真名都不帶（寫客戶A）
- **主控會開下一段：段自己不要開 session，也不要存 limit-guard 的開場 JSON**

## 過目抓到的

11/5 一個唯讀 subagent 對著程式碼過目，主控自己再對了最重的三條（ADR-0040 `:72-74` 寫著空心、`repo.commit()` 的 create 是 `batch.set` 會整份覆蓋、
`tests/incomplete-read.test.js` 釘著提前 return），都成立。已經改進各支 issue：

- 01：`tests/incomplete-read.test.js` 要改成 `doesNotMatch`；`wholeLists` 一起刪；`ctx.sameDayVisits` 順手重讀；判準補「網路不穩等十秒後擋下」的代價
- 02：id 鑄在 `data/health.js` 的 `run()`（domain 是純函式）；`addAlert` 不用詞算 id；**create 會覆蓋 → 寫之前先讀、已存在就跳過**；重試時鏈要照 id 去重；`save-guards` 認 `applyFixes`
- 03：`failureOf()` 那一句夠用
- 04：`key` 不夠 → `recordDelivery()` 寫之前重讀額度（四個入口一次補好）
- 05：`field()` 只有四處；`<button>` 不能包 `<input>` → `<label>`；`.chip::after` 蓋住 input；三條要蓋掉的 input 樣式；`set()` 的 `hidden = true` 要拿掉；桌機撐滿 picker indicator；新 spec 登記 `related.js`
- 06：壓表小日曆休假真的會劃掉（只是點得下去），不是 bug
- 07：色票上其實有斜線（第一顆掛 `.kind-leave`）；`--stripe-leave` 疊在深色點上看不到 → 另做淺色斜紋；`.swatch` 有三處共用要限範圍；補 ADR-0171＋索引；被拿掉的那一色照樣列（主控定）
- 公開 repo：spec 原本寫了一家真的公司名，已改掉

## 中途發現

### 主控（過目時）

- 範圍外、同一個形狀：`ui/views/customerDetail.js` 的 `fixCounts`（`listWhole` 之後過確認框才寫，沒有 `ifUpdatedAt`）—— 跟 03 同一種洞，段一做 03 時順便看要不要一起修；不修就留在這裡段末問
  → **段一在 03 一起修了**（改法一樣小：按下去連額度一起重讀、寫的時候帶那一份的 `updatedAt`；`updateEntitlement()` 多一個選填的 `ifUpdatedAt`）。E2E `90` 的 R2 量它

### 段一

1. **04 的舊寫法比「多一筆」更糟**：「寫完、畫面還沒重讀」再記一次時，`withDelivery()` 拿手上那一份接一筆、整份寫回 `deliveries` ——
   別處（或上一下）記的那一筆**被蓋掉**，筆數剛好還是 1。04 已經修好（寫之前重讀）。**正式站上以前有沒有被蓋過**：交付沒有歷史，
   但稽核每一筆都有 before／after —— 可以唯讀掃一次「`deliveries` 變少」的那幾筆。建議：段三之後另外查一次（只讀 Firebase、只印數字），有的話再問她要不要補
2. **資料健檢「種子 id」那幾種建立**（`addCourse`、`addEquipment`、`addIvProduct`、`addStaff`、診間「建起來」）：寫完、還沒重新掃描就再按一次 →
   第二次 `batch.set` 把第一次那一筆整份蓋掉（createdAt 晚幾秒、稽核多一筆「建立」；內容是同一份種子，畫面上看不出差別）。02 的 `key` 已經擋住寫入還在飛的那幾秒。
   02 沒有一起套「已經在了就不寫」：那幾種她軟刪除過的話，健檢會不會再提議建、要不要救回來，是另一個問題。建議：**不修**（影響只有稽核多一筆）
3. **E2E `19` 的 U9b 在 02 的 verify 裡紅過一次**（`.taskmirror` 預期 0 個、收到 1 個），單獨重跑 20 支全過；02 沒動讀取卡片那一支。建議：先記著，再紅一次就照 lessons 十五（靠快慢才綠）查
4. 01 讓來訪編輯器按儲存之後多一次讀取才開確認框：`65` 有兩支一按完就問 `dialog().isVisible()`，問在讀取回來之前、一道都沒按到。已改成先等第一道出來（掃過 `tests-e2e/`，沒有別支是這個寫法）

### 段二

1. **「挑日期」亮不亮讀螢幕的人聽不到**（05）：那一顆換成 `<label>` 之後亮不亮寫在 `data-on`（label 不能用 `aria-pressed`）。日期框本身的名字是「挑日期」、值是選的那一天，
   所以聽得到選了哪一天，只是「這一顆是亮的」沒有講。她不用讀螢幕，影響是零。建議：**不修**
2. **`npm run shell:snapshot` 同一個號不能重記**（07）：同一個 commit 裡改完 `public/`、記了 v238 又改一次，它拒絕（「VERSION 還是 v238」）—— 還沒 commit 的號照理可以重記。
   繞法：把快照檔換回 HEAD 那一份再跑。建議：**不修**（擋的是對的情況多：別支 PR 已經用掉那個號）；記一筆在 lessons 也不值得
3. **E2E `74` 的 L6 在 07 的 verify 裡紅過一次**（長備註編輯卡按一下刪掉之後量右緣：426 > 390），單獨重跑 `74` 24 個全過。07 的 CSS 全部限在 `.swatches--event` 底下、碰不到 `.pbcard`。
   那一條 10/19 修過一半（先等進場動畫播完再按）—— 這次量的是按完之後，可能還有一段動畫或捲動。建議：**先記著**，跟段一 3（`19` U9b）一樣，再紅一次就照 lessons 十五查

## 要她決定的

（段一那三題 11/5 她回了「照建議」，移到下面「她已經決定的」）

段二沒有要她決定的：中途發現段二那三條都很小（兩條不修、一條先記著），不用問她（段三順手看一眼就好）。

## 她已經決定的

- 11/5：先修 bug；挑日期「按一下就選好」；行事備註第三句小字「要」刪；顏色「空心那顆直接拿掉、第一顆就是預設色實心」；隨手記要的是搜尋（不在這一輪）
- 11/5 段一的三件「照建議」：
  - 中途發現段一 1（營養品交付以前被蓋掉過沒有）→ **查**：這一輪合進 develop 之後另開一個只讀的 session（只讀 Firebase 稽核、只印數字），有的話再問她要不要補。**不在這一輪做**，記在主控的待辦清單（記憶 backlog）
  - 中途發現段一 2（資料健檢「種子 id」那幾種連按蓋掉一次）→ **不修**
  - 中途發現段一 3（E2E `19` U9b 偶發紅一次）→ **先記著**：段三或之後再紅一次就照 lessons 十五查

## 段一的開場

```
這一輪是 2026-11-05 第一輪小修（只修已經查證過的 bug 與畫面小改），分支 claude/small-fixes-2026-11-05（從 origin/develop 3bd4611d 開，.scratch/small-fixes-2026-11-05/ 已 commit）。你是段一。

這一段做 issue 01、02、03、04，照這個順序；不做 05、06、07（段二）。

先讀：
- CLAUDE.md（尤其「測試怎麼跑」、「存一筆來訪時手上那一份是舊的」「算次數、驗證、預選額度要拿哪些來訪」「一個會建立新資料的按鈕」「營養品的形狀或交付」那幾列）
- docs/agents/lessons.md
- .scratch/small-fixes-2026-11-05/spec.md
- .scratch/small-fixes-2026-11-05/HANDOFF.md 的「每一段共同的規矩」「過目抓到的」「中途發現 → 主控」
- .scratch/small-fixes-2026-11-05/issues/01～04（每支的「動工前先讀」照讀；細節與重現步驟在 .scratch/code-health-2026-11-04/issues/01～04）
- ADR-0158、ADR-0083

規矩：
- 一支一個 commit：先寫一支會紅的測試、跑過確認紅 → 修到綠 → npm run verify（不要全跑 E2E）→ commit → issue 的 Status: done、底下寫「做完時留下的」
- 改已經存在的函式之前照 ripple-check skill：codegraph sync → callers／impact，純 JS 再用 grep 對一次；修完找同一個形狀的地方
- 中途發現的（沒人提過的關聯問題、同一個形狀的類似問題）不岔出去修，記進 HANDOFF「中途發現 → 段一」（哪裡、什麼情境會錯、建議），段末一次問；她說修的，修之前再查一次牽連
- HANDOFF「中途發現 → 主控」那一條（customerDetail 的 fixCounts）做 03 時判斷：同一個形狀、改法一樣小就一起修並寫進 03 的「做完時留下的」；不然留著段末問
- subagent 同時最多兩個
- public/ 有改：sw.js 的 VERSION 加一＋npm run shell:snapshot —— 每一個動到 public/ 的 commit 都要再加一（CLAUDE.md「public/ 底下任何檔案」那一列）
- 公開 repo：commit 訊息、測試、.scratch 一個真名都不帶（寫客戶A）
- 主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON

這一段沒有要先問她的題目。

做完要交：四支各一個 commit、Status: done、「做完時留下的」、npm run verify 通過、更新 HANDOFF（分段表段一→完成、中途發現、要她決定的），並把「段二的開場」寫進 HANDOFF（格式照段一這一份：做 05→06→07、先讀哪些、規矩、sw.js 要再加一、做完交什麼；段二結束要寫段三的開場，段三是 xhigh 的 /matt-code-review 審全部＋修審查意見＋手動驗收清單＋開 PR 進 develop＋CI 綠合併）。最後回覆簡短說做了什麼、卡在哪。
```

## 段二的開場

```
這一輪是 2026-11-05 第一輪小修（只修已經查證過的 bug 與畫面小改），分支 claude/small-fixes-2026-11-05。段一做完了（01～04，四個 commit，sw.js 到 v235）。你是段二。

這一段做 issue 05、06、07，照這個順序（07 被 06 擋著：同一支 eventEditor.js）；不做審查與 PR（段三）。

先讀：
- CLAUDE.md（尤其「測試怎麼跑」、「public/ 底下任何檔案」「隨手記的欄位或那一列的樣子」「日曆上任何一種東西的顏色」「tokens.css 加一個顏色」「畫面上一段常駐的說明」「一顆小圖示按鈕的觸控區」那幾列）
- docs/agents/lessons.md
- .scratch/small-fixes-2026-11-05/spec.md（她的原話與談定的做法）
- .scratch/small-fixes-2026-11-05/HANDOFF.md 的「每一段共同的規矩」「過目抓到的」（05、06、07 那幾條）「中途發現」
- .scratch/small-fixes-2026-11-05/issues/05～07（每支的「動工前先讀」照讀）
- ADR-0039、ADR-0040、ADR-0045、ADR-0055（07 要補 ADR-0171＋docs/adr/README.md 索引）

規矩：
- 動工前 git fetch；分支落後 origin/develop 就 rebase，不重做
- 一支一個 commit：先寫一支會紅的測試、跑過確認紅 → 修到綠 → npm run verify（不要全跑 E2E）→ commit → issue 的 Status: done、底下寫「做完時留下的」
- 改已經存在的函式、畫面上的字之前照 ripple-check skill：codegraph sync → callers／impact，純 JS 再用 grep 對一次；修完找同一個形狀的地方
- 中途發現的不岔出去修，記進 HANDOFF「中途發現 → 段二」（哪裡、什麼情境會錯、建議），段末一次問；她說修的，修之前再查一次牽連
- subagent 同時最多兩個
- public/ 有改：sw.js 的 VERSION 加一＋npm run shell:snapshot —— 每一個動到 public/ 的 commit 都要再加一（段一停在 v235，段二從 v236 起）
- 新的 E2E spec 要登記 tests-e2e/related.js。注意：related.js 一改，下一次 verify 會退回整條分支比（段一碰到過，55 支約 18 分鐘）——
  不想整條重跑時，用 node -e 叫 related.js 的 pick() 拿這一支動到的檔案挑，再 node scripts/e2e.mjs <那幾支> 直接跑，並寫進「做完時留下的」
- E2E 一按完就問 dialog().isVisible() 會問太早（lessons 十五）：先 await expect(...).toBeVisible()
- 畫面類的（05 日期、07 色票）交付前自己開模擬器截圖看過（淺色與深色、手機寬度）；截圖不帶真名（本機模擬器的種子是假資料）
- 公開 repo：commit 訊息、測試、.scratch 一個真名都不帶（寫客戶A）
- 主控會開下一段：不要自己開 session，也不要存 limit-guard 的開場 JSON
- 不要 push、不要開 PR（段三做）

這一段沒有要先問她的題目（她 11/5 都回了，見 spec.md「她的原話」與 HANDOFF「她已經決定的」）。

做完要交：三支各一個 commit、Status: done、「做完時留下的」、npm run verify 通過、更新 HANDOFF（分段表段二→完成、中途發現 → 段二、要她決定的），
並把「段三的開場」寫進 HANDOFF：段三是 xhigh，做 /matt-code-review 審這一輪全部（從 origin/develop 3bd4611d 起）→ 修審查意見（一條一個 commit、先紅再綠）→
條列她可以照順序點的手動驗收清單（寫的人要真的在本機模擬器走過；段一那幾條要排：來訪編輯器打開後在另一個分頁替同一位排一段再存、資料健檢慢網路連按「補上二返額度」、
客戶詳情「修正」次數時另一個分頁存一段、營養品「已經給了」連按）→ 推之前看一眼沒有真名 → 開 PR 進 develop（不是 main）→ CI 全綠（gh pr checks 每一條）就合併（CLAUDE.md「合併」）。
建議 effort：high。最後回覆簡短說做了什麼、卡在哪。
```

## 段三的開場

```
這一輪是 2026-11-05 第一輪小修（只修已經查證過的 bug 與畫面小改），分支 claude/small-fixes-2026-11-05（從 origin/develop 3bd4611d 開）。
段一（01～04 存檔與連按）、段二（05 隨手記挑日期、06 行事備註小字、07 行事備註顏色＋ADR-0171）都做完了，七個 commit，sw.js 到 v238。你是段三，effort 用 xhigh。

這一段：審查 → 修審查意見 → 手動驗收清單 → 開 PR 進 develop → CI 全綠就合併。

先讀：
- CLAUDE.md（「上線」「合併」「測試怎麼跑」，與七支 issue 碰到的那幾列：存一筆來訪時手上那一份是舊的、算次數要拿哪些來訪、一個會建立新資料的按鈕、營養品的形狀或交付、
  隨手記的欄位、日曆上任何一種東西的顏色、畫面上一段常駐的說明、public/ 底下任何檔案）
- docs/agents/lessons.md
- .scratch/small-fixes-2026-11-05/spec.md、HANDOFF.md（全部，尤其「過目抓到的」「中途發現」「她已經決定的」）
- .scratch/small-fixes-2026-11-05/issues/01～07（每支底下的「做完時留下的」）
- docs/adr/0171-event-colour-first-swatch-is-the-default-solid.md

要做的：
1. 動工前 git fetch；分支落後 origin/develop 就 rebase（sw.js 的 VERSION 撞號照 CLAUDE.md：留大的再加一、重跑 shell:snapshot）
2. /matt-code-review 審這一輪全部：從 origin/develop 3bd4611d 起（git diff 3bd4611d...HEAD）。Spec 那一軸對 spec.md 與七支 issue 的判準
3. 審查意見：先確定是真的（讀完前後文、能重現就重現）；成立的一條一個 commit，先寫會紅的測試、跑過確認紅 → 修到綠 → npm run verify。
   不成立的寫進 HANDOFF 一行理由。範圍外的記 HANDOFF「中途發現 → 段三」、不岔出去修。public/ 每一個 commit 都要 VERSION 再加一＋shell:snapshot
4. 本機只跑審查修正相關的那幾支（related.js 這一輪改過，npm run verify 會退回整條分支約 60 支 —— 不要整條跑：用 node -e 叫 related.js 的 pick() 拿修正動到的檔案挑，再 node scripts/e2e.mjs <那幾支>，E2E_WORKERS=2）。
   **整條分支的全量交給 PR 的 CI**（e2e-full.yml 在 pull_request 上跑、六台）—— 主控 11/5 改的：本機再跑 60 支是重複的，筆電會熱 20 分鐘以上。
   另外兩個平行的 session（iPad、試算表，各在自己的 worktree）說好了不起模擬器，port 是你的；起之前照樣先看 port 上有沒有殘留的
5. 手動驗收清單：條列她可以照順序點的（「日曆 → 點那一格 → …」，不是「我修好了什麼」）。**寫的人要真的在本機模擬器走過**（npm run emulators ＋ seed:staging 對模擬器）。要排：
   - 段一：來訪編輯器打開後，在另一個分頁替同一位排一段再回來按儲存（要講出讀到的新那一段／不會同一天兩筆）；資料健檢慢網路（DevTools 節流）連按「補上二返額度」只建一筆；
     客戶詳情「修正」次數時另一個分頁存一段（不會寫回舊的數字）；營養品「已經給了」連按只記一次
   - 段二：**手機上**（只有她做得到：Playwright 打不開原生日期選擇）首頁隨手記按「挑日期」→ 選一天 → 不用再點別的就出現那一天 ✕；小鉛筆泡泡同一條；按過今天、按過 ✕ 之後再按挑日期；
     日曆 → 新增行事備註：沒有任何小字、第一顆是實心紫、沒有第二顆紫；切休假：第一顆實心霧藍、沒有藍、每一顆都有斜線；打開一筆以前挑紫的行事備註那一顆是選著的；
     客戶備註、設定 → 警示的色票長相沒變
   清單寫進 PR 內文
6. 推之前看一眼：commit 訊息、PR 標題與內文、.scratch 沒有真實客戶的名字、病歷號、健康資訊（repo 是 public）
7. 開 PR，base 是 develop（不是 main）。CI 每一條都要綠（gh pr checks 每一條，不只全量 E2E 那一條）→ 綠了就合併進 develop（CLAUDE.md「合併」：不用再問）。
   合完 staging 會自動部署；這一輪沒動 functions/，不用部署 Function。**不要進 main**
8. 收尾：HANDOFF 分段表段三→完成；issue 都 done；記憶 backlog 那一條「營養品交付以前被蓋掉過沒有（只讀查）」還在
- subagent 同時最多兩個；不要開 session、不要存 limit-guard 的開場 JSON（主控在管）

做完回覆簡短：PR 連結、合了沒、審查改了幾條、她要點的清單在哪。
```
