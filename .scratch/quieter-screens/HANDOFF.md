# 接手這一輪：讓畫面安靜下來

規格在 `spec.md` 與 `issues/` 那十支。這一份只記**做到哪**。
**這一份只放在 `claude/quieter-screens-layout`（PR #97）這一支上**（見「記帳」）。
最後更新：2026-09-10（第二個帳號；#99 開了，05 與 Tooltip 兩組 E2E 跑中）

## 狀態一覽

| issue | 狀態 | 在哪 | sw.js |
|---|---|---|---|
| 01–04 版面小修 | ✅ PR #97 | `claude/quieter-screens-layout` | v111 |
| 06 名稱一律 short | ✅ PR #98 | `claude/naming-short-everywhere` | v112 |
| 07 備忘錄編輯 | ✅ PR #99（相關 E2E 66 支全過） | `claude/memo-editor-taller` | v113 |
| 08＋09 Tooltip | 🟡 已 commit 已 push、`.scratch` 已拿掉；**全量 E2E 排隊中** | 主工作區、`claude/tooltip-component` | v114 |
| 05 用詞統一 | 🟡 已 commit 已 push（5624d93）、單元 2266 綠；**相關 E2E 排隊中** | worktree `.claude/worktrees/issue05-words`、`claude/day-slot-words` | v115 |
| 10 讀取卡片單段化 | ⬜ 未開始（等 05 06 09 合進 develop） | | |

## 接手第一件事

### 一、E2E 的模擬器（這一輪最大的坑）

E2E 的 app 是模擬器 hosting（`127.0.0.1:5000`）在服務，**服務的是啟動它的那個目錄的 `public/`，
而且跑完不會自己關，E2E 也不會幫你開**。每一組都要：停掉殘留的 → 在**那一組自己的目錄**
`bash tests-e2e/start-emulators.sh &` → 等 5000／8080／9099 都在聽 → `CI=1 npm run test:e2e:related`
（Tooltip 分支要全量 `npm run test:e2e`）→ 停掉。停的方式：

```
powershell -NoProfile -Command 'Get-NetTCPConnection -State Listen -LocalPort 4000,4400,4500,5000,8080,9099,9150 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }'
```

### 二、07：✅ 已完成（PR #99、Status 已改 done）—— 下面留著當驗收清單的參考

PR 內文要講：sw.js v113；不帶 `.scratch`；`dialog.js` 抽出 `ask()`（`confirmAction()` 行為不變）＋ 新增
`chooseAction()`（關掉回 null ＝ 繼續改）；返回鍵刻意沒接（issue 07 的 Comments）。

手動驗收：
1. 待辦首頁 → 右上角「備忘錄」→ 點任一張的鉛筆 → 那張卡**沒有變矮**；右上角是墨綠的勾勾，左邊一顆灰色垃圾桶；底下那一排按鈕不見了
2. 打幾個字 → 點頁面標題「備忘錄 / SOP」→ 跳「這一份改到一半」→ 按「不要了」→ 字回到原本的樣子
3. 再按鉛筆、打字 → 點外面 → 按「存起來」→ 卡片上是新的字
4. 再按鉛筆、**什麼都不改** → 點外面 → 直接收起來，不跳任何框
5. 按鉛筆、打字 → 點外面 → 在框上按 Escape（或返回鍵、點灰底）→ 還在編輯，字都還在
6. 讀的狀態下**長按**鉛筆 → 變紅色垃圾桶 → 點它 → 跳刪除確認 → 按取消 → 變回鉛筆

### 三、Tooltip（08＋09）：全量 E2E 綠了就開 PR（v114），兩支 issue 的 Status 在這一支改 done

手動驗收：
1. 日曆 →「N 筆來訪・N 件待辦」那一行後面的茶色小 `?` → 泡泡從它底下長出來 → 點別處收起；頁尾那一行字不見了
2. 壓表 → 選一個月 →「排序」旁邊的 `?`；換一個排序丸子，再點 `?` 講的是新的排序
3. 客戶 → 看這個月的進度 → 摘要那一行的 `?`；頁尾三行不見了，泡泡裡沒有「ADR」
4. 客戶 → 一位還沒有任務的 →「還沒有任務。」後面的 `?`
5. 設定 → 名稱怎麼寫 → 標題旁邊的 `?`
6. 設定 → 資料健檢 → 磚塊只剩數字與名稱；標題旁的 `?` 點了**不會**展開那一塊；開一顆再點另一顆，前一顆收掉
7. 客戶 → 一位 → 不能的時間 → 月曆上方月份旁邊的 `?`
8. 日曆 → 點一位同一天兩段的其中一段 → 待辦那一塊那一列後面是 `?`（不是「這一天共用」四個字）
9. 設定切深色 → 隨便開一顆，看得清楚

### 四、05：相關 E2E 綠了就開 PR（v115），Status 在這一支改 done

手動驗收：
1. 日曆 → 長按一段（那一天有兩段以上）→ 選單寫「改這一段」「取消這一段」「取消一整天（N 段）」
2. 按「取消一整天」→ 標題「取消 某某 這一整天的來訪？」、第一句「這一整天的 N 個時段會退回去…」、確認鈕「取消這一整天」→ 先按取消
3. 日曆 → 長按一段（那一天只有一段）→ 選單寫「取消這一天」
4. 壓表 → 在已經有來訪的那一天再記一段 → 按鈕底下那一句寫「併進同一天已經有的來訪，那一天會…」
5. 來訪編輯器 → 存檔前只有一件提醒時 → 標題寫「這一件先看一下」

### 五、10：開一個新的 session 做

等 #98（06）、Tooltip（09）、05 都合進 develop 之後，從最新的 develop 開分支。
它動的是四個畫面共用的 `visitReadHtml()`，是這一輪最大最危險的一支 —— 讀 issue 10 全文再動手。

## 記帳

`.scratch/quieter-screens/` **只在 #97 這一支上改**（臨時 worktree：`.claude/worktrees/pr97-scratch`）。
四支 PR 各帶一份會在同一批新檔案上 add/add 衝突。#97 合進 develop 之後，其他分支 rebase 上來就能正常改。

## 這一輪學到的

- **E2E 測到的是啟動模擬器那個目錄的程式碼**（上面第一節）—— 這一輪 07 因此「假紅」兩次
- **平行 PR 的 sw.js VERSION 要不同號**：同號 git 不衝突，但後合的那一支不會清快取
- **背景 agent 一起吃額度**：上一個 session 同時開五支，全死在半路
- **Bash 工具會把 `\` 吃成 `\`**：heredoc 裡的字面反斜線用 `chr(92)`，寫完 `node --check`
- 結束碼用 `${PIPESTATUS[0]}`，`| tail` 會把紅的蓋成 0
- **舊的斷言可能把 bug 寫成預期**：`todo-flow.test.js`、J-A9 都是 —— 改之前先問它斷言的是不是她要改掉的那個行為

## 談定的六個決定（不要重新討論）

1. 第三條 (d)：三頁改成「每一段自己一列，點了才看細節」，先看到的仍然是那一天有哪幾段 ＋ 那一天的待辦
2. 第二條：先做元件 ＋ 最划算的八處，其餘按畫面分批
3. 第七條 d：刪掉兩條路（長按鉛筆 ＋ 編輯中右上角的垃圾桶），ADR-0060 不動
4. 分多個 PR，小的先出
5. ADR-0085 的落差：改程式（真的拿掉那一塊），舊 ADR 不改
6. 「這一天共用」：改成 tooltip

## 交付前

- 每支 issue 的 Status 都是 done
- 補 CLAUDE.md「容易漏掉的連動」：`partnerChips()` 自己帶包裝；要分得出「不要了」與「手滑關掉」的確認框用 `chooseAction()`；說明文字先想 `tip()`、會改變寫入結果的警告不可以收進去；畫面上的單位只有「這一段／這一天」（ADR-0087）；平行 PR 的 sw.js VERSION 不同號；E2E 換目錄先停模擬器
- 全部合完跑 `/matt-code-review`

---

# 貼給新 session 的開場

```
接手 baobao-wellness-clinic-scheduler 的一輪改動（.scratch/quieter-screens/）。

先讀，照順序：
1. CLAUDE.md —— 規則是硬的
2. HANDOFF：git fetch origin && git show origin/claude/quieter-screens-layout:.scratch/quieter-screens/HANDOFF.md
3. 同一支上的 .scratch/quieter-screens/spec.md 與 issues/ 那十支

照 HANDOFF「接手第一件事」一節一節做：先看 07、05、Tooltip 三組 E2E 的結果（沒跑完就照第一節自己跑），
綠的開 PR、在 #97 那一支改 Status；三支都合進 develop 之後再做 10。

規矩：一支 issue 一個 commit；PR 基底 develop；先寫失敗測試再修；同一時間只跑一組 E2E、
每一組從自己的目錄起模擬器；動到 public/ 要加 sw.js 的 VERSION 且跟別的 PR 不同號；.scratch 記帳只改 #97；
交付附一份她可以照順序點的手動驗收清單；額度快到時先收尾、更新 HANDOFF、給新的開場提示詞。
全部合完跑 /matt-code-review。
```
