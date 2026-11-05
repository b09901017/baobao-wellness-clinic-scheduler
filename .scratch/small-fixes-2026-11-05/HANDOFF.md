# HANDOFF：2026-11-05 第一輪小修

分支 `claude/small-fixes-2026-11-05`（從 `origin/develop` `3bd4611d`）。PR 進 `develop`，CI 綠就合（CLAUDE.md「合併」）。全貌與她的原話在 `spec.md`。

## 分段

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 段一 | 01、02、03、04（存檔與連按） | high | **完成**（11/5）：`796f0527`、`4cd2141a`、`4cd55caf`、04 那一個 commit（見下面） |
| 段二 | 05、06、07（隨手記日期、行事備註的字與顏色） | high | 等段一 |
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

## 要她決定的

段一沒有擋住段二的題目。收成一題「照建議」（主控方便時問，段二可以先開）：

- 中途發現段一 1：查不查正式站稽核裡營養品交付被蓋掉過的那幾筆？**建議：查**（另開一個只讀的 session，段三之後）
- 中途發現段一 2：資料健檢「種子 id」那幾種連按蓋掉一次？**建議：不修**
- 中途發現段一 3：E2E `19` U9b 偶發紅一次？**建議：先記著**

## 她已經決定的

- 11/5：先修 bug；挑日期「按一下就選好」；行事備註第三句小字「要」刪；顏色「空心那顆直接拿掉、第一顆就是預設色實心」；隨手記要的是搜尋（不在這一輪）

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

（段二做完由段二寫）
