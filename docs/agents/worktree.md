# 開 worktree 之後先接好的東西

worktree 是另一份 checkout（`.claude/worktrees/<名字>/`）：被追蹤的檔案都在，**`.gitignore` 擋掉的一個都沒有**。
下面這幾樣刻意不進版控，卻是做事要用的。少了的時候有的會大聲壞，有的**安靜地少做一件事** —— 後者最危險（2026-11-05 查的）。

主資料夾＝`git worktree list` 的第一行（家裡是桌面上那一份）。

| 少了什麼 | 少了會怎樣 | 怎麼接 |
|---|---|---|
| `.local/`（真資料、名單、過濾網） | ① `tests/no-secrets.test.js` **跳過**真名掃描：`npm test` 照樣綠，只多一個 skipped<br>② `\| node .local/references/redact.mjs` 找不到檔，前面的輸出整個不見（沒外流，但什麼都看不到 —— **不可以拿掉過濾網繞過去**）<br>③ 月底對帳、客戶時間、合併那幾支 skill 與 `scripts/` 讀不到資料 | junction／symlink 到主資料夾那一份（下面的指令）。接好之後 `npm test` 的 skipped 要是 0 |
| `.codegraph/`（CodeGraph 索引） | **安靜地用錯**：往上找到主資料夾的索引，印一行警告照樣回答 —— 回的是主資料夾那條分支的程式碼，這條分支新改的符號查不到、呼叫端少列 | 在 worktree 裡 `codegraph init -i`（這條分支自己的索引；`codegraph.json` 有進版控，排除照舊） |
| `graphify-out/`（程式碼＋文件＋決定的圖） | 大聲壞（`graph file not found`）—— 然後很容易就不查了，ADR、舊 issue、`.local` 目錄的牽連漏看 | 查主資料夾那一份：`graphify query "<問題>" --graph <主資料夾>/graphify-out/graph.json`。圖是快照（`GRAPH_REPORT.md` 寫了哪個 commit），程式碼那一半以 CodeGraph 為準。**不要在 worktree 裡 `graphify update`**（會拿這條分支的程式碼蓋掉主資料夾的圖）；`post-commit` 的 graphify hook 在 worktree 裡本來就不跑，合進 develop 之後在主資料夾更新 |
| `node_modules/` | 大聲壞（找不到模組） | `npm ci` |

## 接法

家裡（PowerShell）：

```powershell
$main = (git worktree list --porcelain | Select-Object -First 1).Substring(9)
New-Item -ItemType Junction -Path .local -Target "$main\.local"
git check-ignore -v .local   # 要印出 .gitignore 的 /.local/ 那一行
npm ci
codegraph init -i
npm test                     # 摘要的 skipped 要是 0（no-secrets 讀到名單了）
```

雲端 VM（bash）：

```bash
main=$(git worktree list --porcelain | head -1 | cut -d' ' -f2-)
ln -s "$main/.local" .local
git check-ignore -v .local || echo '.local' >> "$(git rev-parse --git-common-dir)/info/exclude"
git check-ignore -v .local
npm ci && codegraph init -i && npm test
```

Windows 的 junction git 當成資料夾，`/.local/` 擋得住（11/5 查過）。**Linux 的 symlink 不算資料夾，`/.local/` 擋不住** ——
沒擋住就加進 `info/exclude`（只在這台、所有 worktree 共用），再跑一次 check-ignore。擋沒擋住從畫面上看不出來（CLAUDE.md「上線」那一節）。

## 不用接的

- **記憶**：Claude Code 照主資料夾那個 repo 存，worktree 裡讀寫的是同一份（11/5 查過：一次性客人那個 worktree 的 session 改的記憶就在主資料夾那一份裡）
- `.firebaserc`、`codegraph.json`、`.graphifyignore` 有進版控；Firebase／gcloud 的登入在使用者資料夾，每個 worktree 共用

## 還要記得的

- **E2E 測到的是起模擬器的那個資料夾**（CLAUDE.md「測試怎麼跑」），而**所有 worktree 共用同一組 port**：同一時間只能一個 session 起模擬器。
  起之前看 port 上有沒有人；有的話不要停掉別人的，先問她
- app 開 worktree 時可能從本機那一份落後的分支切：**先 `git fetch`、從 `origin/develop` 開分支**
- 平行的幾輪：`sw.js` 的 VERSION、ADR 號碼各挑不同的號（CLAUDE.md「public/ 底下任何檔案」那一列）；碰同一支檔案的排先後，後合的 rebase
- 做完的 worktree 會一直留在 `.claude/worktrees/`（有的各帶一份 `node_modules`）：要清先問她
