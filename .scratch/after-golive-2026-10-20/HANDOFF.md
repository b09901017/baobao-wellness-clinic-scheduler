# 交接：上線第一天回報的三件（2026-10-20）

分支：`claude/after-golive-1020`（10/20 從 origin/develop `86d5800` 開）。**這一輪的基準點是 `86d5800`**。
全貌與她的原話在 `spec.md`；每一支的細節在 `issues/`。流程照 `/kickoff`（`.claude/skills/kickoff/SKILL.md`）的第三、四段。

**這一輪出兩個 PR**：段一（拍照＋量開機）先合進 develop，讓她在 staging 用手機拍照、量開機的數字；段二到段五是第二個 PR。
段一合進去之後，這條分支 `git fetch` ＋ rebase 到新的 develop 再繼續（不要重開分支）。

## 進度

| 段 | issue | effort | 狀態 |
|---|---|---|---|
| 零 | 談、開 issue、subagent 過目、照過目改 issue | — | ✅ 10/20 |
| 一 | 01 大照片用小尺寸解、02 手機橫放的拍照排版、05 量開機 → `/code-review` → PR 合進 develop | high | |
| 二 | 03 逾期／今天／明天的已完成算哪幾件（domain＋讀資料）、04 那三頁的已完成（Blocked by 03） | xhigh | |
| 三 | 06 程式檔快取優先＋「有新版本」、07 先畫殼、08 首頁先用快取畫 | high | |
| 四 | `/matt-code-review`（段二＋段三：從段一合進 develop 的那一點比） | xhigh | |
| 五 | 09（看 05 的數字決定做不做）、文件總檢查、全量 E2E（CI）、手動驗收清單、PR 合進 develop | medium（09 要做就 high） | |

段一先做：拍照她現在就要用（「正式版的鴨表拍照功能不能用」），05 要先在她手機上量出「改之前」的數字，段三才有得比。
段二整段是待辦首頁那三頁；段三整段是開機那條路。兩段不搶檔案（段二動 `home.js` 的 `renderGroup()` 那一帶、段三動 `home.js` 的 `render()` 與 `app.js`／`sw.js`／`repo.js`）——
**同一個 session 不要一起做**，兩段的腦子不一樣。

## 編號（先分好）

| 段 | ADR | E2E spec | `sw.js` VERSION |
|---|---|---|---|
| 一 | （不用：解碼方式是做法、ADR-0101 的隱私規則不變） | 79 | **v201** |
| 二 | 0166 已完成那一側（推翻 ADR-0152 決定 4） | 80 | **v202**（第二個 PR 第一個動 `public/` 的那一段升，後面的不用再升） |
| 三 | 0167 打開 app 先用手機裡的（推翻 8/18 commit `0ae20497` 的網路優先；07、08 可以寫在同一支） | 81 | |
| 五 | 09 要做的話 0168（或併進 0167） | 82 | |

新的 spec 都要登記進 `tests-e2e/related.js`。

## 驗收的方式

- **拍照（01、02）與開機（05～09）只有她的手機量得準**：桌機沒有解碼上限、桌機的 Auth 不先載 iframe。單元測試與 E2E 盯形狀與不退步；「真的修好了」看她在 staging 手機上點的結果
- `npm run verify`：段三動 `repo.js`（`related.js` 的 GLOBAL）之後會退回全跑（本機 34 分鐘、她的電腦會熱）→ 那一段的日常驗收改成 `npm test` ＋ `CI=1 npx playwright test <改到的那幾支>`，全量丟 CI（`gh workflow run e2e-full.yml --ref claude/after-golive-1020`）

## 中途發現

（做的時候看到、沒有當場修的，寫在這裡：哪裡、什麼情境會錯、建議。一段結束時一次列給她問要不要修。）

## 段一的開場

```
這一輪在修上線第一天她回報的三件（拍照讀不出來、今天的已完成、打開要等 5～6 秒）。分支 claude/after-golive-1020，段零（談、開 issue、過目）做完了。
這一段做段一：01 大照片用小尺寸解、02 手機橫放的拍照排版、05 量開機每一段花多久。做完開 PR 合進 develop（這一輪的第一個 PR）。

先讀：.scratch/after-golive-2026-10-20/HANDOFF.md、spec.md、issues/01、02、05；docs/agents/lessons.md；CLAUDE.md 的「上線」那一節與連動表裡「public/ 底下任何檔案」「蓋住整頁的一層」「貼在畫面底部的東西」三列。
不做：03、04、06～09（段二、段三、段五）。

提醒：
- 動工前先 git fetch，develop 往前走了就 rebase。
- 每一個要改的函式先 grep 所有呼叫端與畫面上的字（shrinkPhoto 的呼叫端不只 camera.js）。
- 01 的紅燈在桌機重現不出來（桌機沒有解碼上限）—— 照 issue 01 的判準用 addInitScript 模擬手機的上限。
  她的原檔在 .local/references/abovee拍照測試/（12000×9000），只拿來跑 scratchpad 腳本印尺寸與毫秒，不看圖、不進版控。
- ImageDecoder 吐出來的畫面有沒有照 EXIF 轉要量（E2E 37 第 1 條就是方向 6 的照片）。
- 中途發現她沒發現的關聯問題，先記進 HANDOFF 的「中途發現」、繼續做別的。

做完要交：每支一個 commit、issue 的 Status: done 與「做完時留下的」、npm run verify、/code-review（這一包小，不另開 matt 審查那一段）、
手動驗收清單（她在 staging 用手機照順序點的：拍照三種方式、橫拍、設定頁那張開機時間的卡要怎麼量五次）、PR 開向 develop、CI 綠了合進去、HANDOFF 進度、
把「中途發現」一次列給她問要不要修、段二的開場（xhigh）。進 main 不在這一段：等她在 staging 手機上拍過、她說了才進（進之前請她在正式站匯出備份）。
```
