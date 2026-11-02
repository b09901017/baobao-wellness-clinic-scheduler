---
name: ripple-check
description: 動到已經存在、別處在用的程式碼時「透視關聯」的固定做法：改之前用 CodeGraph 查誰呼叫它、改了會波及誰，改之後挑出要跑的測試；修完 bug 用 ast-grep 找同一個形狀的缺陷；一輪開始或要找相關的文件與決定時查 Graphify 的圖（程式碼＋ADR、plan、issue）；階段結束更新圖。用在要改、重構、修 bug、改函式的行為或參數、改資料形狀、刪東西之前，使用者問「會不會牽一髮動全身」「改這個會影響哪裡」「別的地方是不是也有一樣的問題」，或要設定這幾個工具的時候。只寫新檔、還沒有人用的東西不用走。
---

# 透視關聯：改之前看清楚牽連，修完找同類

## 四層，各管一件事

| 工具 | 回答什麼 | 指令 |
|---|---|---|
| Graphify（宏觀，快照） | 這件事牽涉哪些模組、文件、決定？兩樣東西怎麼連起來？ | `graphify query "<問題>"`、`graphify path "A" "B"`、`graphify explain "X"` |
| CodeGraph（微觀，只認程式碼符號） | 誰呼叫它？改了會波及誰？要跑哪些測試？ | `codegraph impact`、`callers`、`callees`、`explore`、`affected` |
| ast-grep | 別處還有沒有同一個形狀的寫法？ | `ast-grep run -p '<樣式>' -l ts <資料夾>` |
| 型別檢查＋測試 | 真的有沒有壞？ | 專案的驗證指令（最後一道，前三層只是幫你知道要看哪裡） |

## 什麼時候走：看這次動到什麼，不看專案在哪個階段

| 這次動到 | 要做 |
|---|---|
| 全新的檔、還沒有人用的東西 | 不用走，照常跑驗證 |
| 已存在的函式、型別、元件（行為、參數、回傳的形狀） | 「改之前」＋「改之後」 |
| 存進資料庫的欄位、跨套件的介面、規則檔 | 上面全部＋`graphify query` 找相關的 ADR、GLOSSARY、issue＋grep 字串 |
| 修 bug | 上面全部＋「找同類」 |
| 一輪開始、談需求、拆 issue | `graphify query`：牽涉哪些模組、以前決定過什麼 |
| 階段結束 | 「更新圖」 |

## 改之前

1. `codegraph sync`（不開背景程序，所以查之前先同步，約一秒）。
2. 不熟那一區：`codegraph explore "<問題>"`。它回傳的是磁碟上的原始碼原文、呼叫路徑與波及範圍，當作已經讀過，不要再 grep 一遍確認。
3. `codegraph impact <符號>`（預設深度 2，牽連深的加 `--depth 3`）、`codegraph callers <符號>`；同名的用 `--file <路徑>` 指定。
4. **把清單逐條寫下來**：每個呼叫端會怎麼受影響，不受影響的也寫一句為什麼。寫進 issue 的「為什麼會這樣」或回覆裡，不要只放在腦中。
5. **圖看不到的另外 grep**：Firestore 的欄位名與路徑、規則檔、畫面上的文字、設定檔、測試資料、文件裡寫到的名字。CodeGraph 只認程式碼符號，字串對不起來。

## 改之後

1. `git diff --name-only | codegraph affected --stdin --quiet` 列出受影響的測試，先跑這幾支拿快速回饋。
2. 最後照樣跑專案的驗證指令（全部）。`affected` 只是讓你早一點知道，不能取代全部跑一次。

## 找同類（修完 bug 之後）

1. 把缺陷寫成一句「在 X 的時候會 Y」，再找它在程式碼裡的形狀。
2. 寫成 ast-grep 樣式：`$X` 代表一個節點、`$$$` 代表任意多個。例如 `ast-grep run -p 'Math.round($X)' -l ts packages apps`；`.tsx` 要另外跑一次 `-l tsx`。
   **最多寫兩次樣式**：兩次都抓不到原本那一處（連已知有問題的地方都沒找到，代表樣式錯了），就改用第 3 步，不要一直調樣式。
3. 缺陷不在形狀、在邏輯（例如「忘了排除封存的帳戶」）的時候：對同一個被誤用的函式跑 `codegraph callers`，再 grep 關鍵字。
4. 每一處都要有結論：同一個缺陷 → 在這次範圍內的一起修，範圍外的照專案的規矩記下來（`kickoff`：HANDOFF 的「中途發現」）；不是 → 寫一句為什麼。

## Graphify 的圖

- **INFERRED 的邊是推出來的**：動手前回原始碼或原文確認。圖是用來找路的，不是標準答案。
- **查**：中文可以直接問（要裝 `graphifyy[chinese]`）；結果被截斷時照提示加 `--budget N`。整體架構才讀 `graphify-out/GRAPH_REPORT.md`。
- **圖是快照**：`GRAPH_REPORT.md` 寫了建圖時的 commit，跟 `git rev-parse HEAD` 差很多就先更新再查。
- **更新圖**（階段結束時；改了很多程式碼、要用圖之前也可以）：
  1. 程式碼：`GRAPHIFY_BACKEND=none GRAPHIFY_MAX_WORKERS=8 graphify update .`（不用 LLM、不花額度）。不設 `GRAPHIFY_MAX_WORKERS` 會用滿所有核心（使用者的電腦曾經過熱斷電）；小 repo 不到一分鐘，上千個檔的先跟使用者說。
  2. 私人資料夾的檢查網：`node .claude/skills/ripple-check/scripts/private-index-check.mjs`，列出目錄還沒寫到的檔（只印檔名）。每一份歸類後跟使用者說怎麼處理（見下一節）。
  3. 文件有改：`/graphify . --update`。這一步會讓模型讀文件、會花額度，大的時候先跟使用者說。
- **不裝 Graphify 的常駐提醒**（`graphify claude install` 會寫進 CLAUDE.md 和 PreToolUse hook）：日常的程式碼問題交給 CodeGraph，兩個都要當「第一個查的」會互相打架。

## 掃哪些、不掃哪些

- **排除**：別的 repo 的複本（`.claude/skills/`）、上游授權檔、跟這個專案的 app 無關的 `.scratch/` 輪（工具、客廳）。Graphify 寫在 `.graphifyignore`，CodeGraph 寫在 `codegraph.json` 的 `exclude`；`.gitignore` 裡的兩邊本來就不掃。開一輪不是 app 的工作時，順手把它的 `.scratch/<slug>/` 加進 `.graphifyignore`。
- **私人資料夾（`.local/`）預設不進圖**。只放回：
  - 目錄 `README.md`：每個檔一行「是什麼、什麼時候讀」，**不寫任何真實值**。這樣查圖會知道有哪些私人檔、什麼時候該打開。
  - `research/`：設計參考（國王日記怎麼被用、以前的工作流程）。
  - 產生資料的程式。
  - 有真實帳戶、金額的檔只在目錄裡提到，要用時才打開，讀過之後照專案的 lessons 比對，不把值抄進 repo。
- **新增私人檔時順手在目錄補一行**；是設計參考就放進 `research/`，它會自動進圖。忘了補，更新圖之前的檢查網會抓到。
- `graphify-out/`、`.codegraph/` 一律 gitignore：公開 repo 不能帶。

## 第一次在一個專案設定

範本在這支 skill 的 `templates/`：先複製，再照專案改（專案特有的資料夾、私人檔、不是 app 的輪）。

1. 每台電腦裝一次（版本照客廳 `skills/README.md`）：`npm i -g @colbymchenry/codegraph @ast-grep/cli`、`codegraph telemetry off`、`python -m pip install -U "graphifyy[chinese]"`。
2. `templates/codegraph.json` → 專案根目錄 `codegraph.json`；`templates/graphifyignore` → `.graphifyignore`；`templates/local-README.md` → `.local/README.md`（已經有就照它補）；`templates/claude-md-line.md` 裡的那一行貼進專案 `CLAUDE.md`、兩行貼進 `.gitignore`。
3. 驗證掃描範圍：graphify 用 `python -I -c` 呼叫 `graphify.detect.detect(Path('.'))` 看會讀哪些檔（私人資料夾只能有目錄列的、複本與金鑰不能出現）；CodeGraph 建完看 `codegraph files --max-depth 2`。
4. 建索引：`codegraph init --yes`、`GRAPHIFY_BACKEND=none GRAPHIFY_MAX_WORKERS=8 graphify update .`。
5. 第一次完整建圖（含文件）：`/graphify .`。會花額度，先跟使用者說；語意分析的 subagent 同時最多兩個。
6. `.claude/project.json` 的 `skills` 加 `ripple-check`、`graphify`，跑客廳的同步。

雲端 session 沒有裝這些工具，也沒有 `graphify-out/`：CodeGraph 用 `npx -y @colbymchenry/codegraph@<版本> init --yes` 建索引，之後每個指令前面都加 `npx -y @colbymchenry/codegraph@<版本>`；ast-grep 用 `npx -y @ast-grep/cli@<版本>`；Graphify 的圖跳過，用 grep 讀文件。

## 坑

- CodeGraph **沒有** structural search 或 CGQL：找同一個形狀用 ast-grep。`affected` 吃的是檔案，找符號的波及範圍用 `impact`。
- 用 CLI，不接 CodeGraph 的 MCP：Windows 上它的背景程序有閃黑色視窗、吃記憶體的 issue；MCP 還得在每個帳號的設定資料夾各設一次。CLI 在每台電腦上都一樣。
- 同名函式、`this.m()`、`require` 這類動態寫法，CodeGraph 可能連錯：`impact` 的清單是起點，不是保證。
- **沒有型別檢查的專案（純 JS）**：漏改的呼叫端不會在驗證時變紅，最後一道只剩測試。`impact`／`callers` 的清單要再用 grep 函式名對一次，兩邊不一樣的逐一看。
- 檔案用了 tree-sitter 不認得的語法（例如 `export type *`），兩個工具會警告「沒有產生符號」；跨檔的呼叫通常還是找得到，要確認就對那個檔裡的符號跑一次 `callers`。
