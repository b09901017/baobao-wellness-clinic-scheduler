# 開 worktree 之後先接好的東西

worktree 是另一份 checkout（`.claude/worktrees/<名字>/`）：被追蹤的檔案都在，**`.gitignore` 擋掉的一個都沒有**。
下面這幾樣刻意不進版控，卻是做事要用的。少了的時候有的會大聲壞，有的**安靜地少做一件事** —— 後者最危險（2026-11-05 查的）。

主資料夾＝`git worktree list` 的第一行（家裡是桌面上那一份）。

| 少了什麼 | 少了會怎樣 | 怎麼接 |
|---|---|---|
| `.local/`（真資料、名單、過濾網） | ① 真名掃描（`tests/no-secrets.test.js`）：**現在不會跳過了** —— `tests/helpers/localDir.js` 會自己去主資料夾找名單<br>② `\| node .local/references/redact.mjs` 找不到檔，前面的輸出整個不見（沒外流，但什麼都看不到 —— **不可以拿掉過濾網繞過去**）<br>③ 月底對帳、客戶時間、合併那幾支 skill 與 `scripts/` 讀不到資料 | **不建連結**（為什麼見下一節）。過濾網寫主資料夾的路徑：`\| node <主資料夾>/.local/references/redact.mjs`；讀 `.local` 的 skill／腳本回主資料夾跑。`npm test` 的 skipped 要是 0（不是 0 就看是誰：`npm test 2>&1 \| grep "﹣"` —— `aliases.json 不在這台機器上` 那一條才是名單沒找到；`這台沒有 python ＋ openpyxl` 那兩條是 `tests/sheet-xlsx-verify.test.js` 整支工具那一段，跟 `.local` 無關） |
| `.codegraph/`（CodeGraph 索引） | **安靜地用錯**：往上找到主資料夾的索引，印一行警告照樣回答 —— 回的是主資料夾那條分支的程式碼，這條分支新改的符號查不到、呼叫端少列 | 在 worktree 裡 `codegraph init --yes`（這條分支自己的索引；`codegraph.json` 有進版控，排除照舊。`-i` 是舊的寫法，現在預設就會建索引） |
| `graphify-out/`（程式碼＋文件＋決定的圖） | 大聲壞（`graph file not found`）—— 然後很容易就不查了，ADR、舊 issue、`.local` 目錄的牽連漏看 | 查主資料夾那一份：`graphify query "<問題>" --graph <主資料夾>/graphify-out/graph.json`。圖是快照（`GRAPH_REPORT.md` 寫了哪個 commit），程式碼那一半以 CodeGraph 為準。**不要在 worktree 裡 `graphify update`**（會拿這條分支的程式碼蓋掉主資料夾的圖）；`post-commit` 的 graphify hook 在 worktree 裡本來就不跑，合進 develop 之後在主資料夾更新 |
| `node_modules/` | 大聲壞（找不到模組） | `npm ci` |

## 接法

家裡（PowerShell）：

```powershell
$main = (git worktree list --porcelain | Select-Object -First 1).Substring(9)
npm ci
codegraph init --yes
npm test                     # 摘要的 skipped 要是 0（真名掃描自己會去主資料夾找名單）
# 讀 .local 的一律接主資料夾的過濾網：<指令> | node "$main\.local\references\redact.mjs"
```

雲端 VM（bash）：

```bash
main=$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)
npm ci && codegraph init --yes && npm test
# 讀 .local 的一律接主資料夾的過濾網：<指令> | node "$main/.local/references/redact.mjs"
```

## `.local` 不要建連結一直放著

**有些刪 worktree 的方式會順著連結刪進去**（`docs/agents/lessons.md` 第十六節）—— 刪掉的是主資料夾那一份 `.local`，她唯一的一份真資料。
11/5 一次性客人那個 worktree 照這份文件以前的寫法建了 junction，段六審查時拆掉了。

非在 worktree 裡用不可（例如一支 skill 寫死了相對路徑 `.local/…`），**臨時建、跑完馬上拆**：

```powershell
New-Item -ItemType Junction -Path .local -Target "$main\.local"
# …跑完馬上拆：只拆連結，不碰主資料夾那一份
cmd /c rmdir .local
```

```bash
ln -s "$main/.local" .local
git check-ignore -v .local   # Linux 的 symlink 不算資料夾，/.local/ 擋不住：沒擋住就不要 git add，先拆
# …跑完馬上拆：不加 -r、不加結尾的 /（rm -r .local/ 會刪到裡面的東西）
rm .local
```

拆的時候**不要用 `Remove-Item -Recurse`、檔案總管刪、`rm -r`**：這幾種都可能順著連結刪進去。
**刪一個 worktree 之前先看它有沒有 `.local` 連結**（`Get-Item .local -Force` 的 `LinkType`／`ls -l .local`），有就照上面先拆。

## 不用接的

- **真名掃描**：`tests/helpers/localDir.js` 會先找這個 checkout、再找主資料夾（`git rev-parse --git-common-dir` 的上一層）。新增一支要讀 `.local/` 的測試或腳本也走它
- **記憶**：Claude Code 照主資料夾那個 repo 存，worktree 裡讀寫的是同一份（11/5 查過：一次性客人那個 worktree 的 session 改的記憶就在主資料夾那一份裡）
- `.firebaserc`、`codegraph.json`、`.graphifyignore` 有進版控；Firebase／gcloud 的登入在使用者資料夾，每個 worktree 共用

## 還要記得的

- **E2E 測到的是起模擬器的那個資料夾**（CLAUDE.md「測試怎麼跑」），而**所有 worktree 共用同一組 port**：同一時間只能一個 session 起模擬器。
  起之前看 port 上有沒有人；有的話不要停掉別人的，先問她
- app 開 worktree 時可能從本機那一份落後的分支切：**先 `git fetch`、從 `origin/develop` 開分支**
- 平行的幾輪：`sw.js` 的 VERSION、ADR 號碼各挑不同的號（CLAUDE.md「public/ 底下任何檔案」那一列）；碰同一支檔案的排先後，後合的 rebase
- 做完的 worktree 會一直留在 `.claude/worktrees/`（有的各帶一份 `node_modules`）：要清先問她，清之前先拆 `.local` 連結（上一節）
