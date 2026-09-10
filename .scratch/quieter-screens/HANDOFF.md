# 接手這一輪：讓畫面安靜下來

規格在 `spec.md` 與 `issues/` 那十支。這一份只記**做到哪**。
**這一份只放在 `claude/quieter-screens-layout`（PR #97）這一支上** —— 見「記帳」那一節。
最後更新：2026-09-10（第二個帳號，07 的 E2E 重跑中）

## 狀態一覽

| issue | 狀態 | 在哪 |
|---|---|---|
| 01–04 版面小修 | ✅ PR #97 | `claude/quieter-screens-layout`（sw.js v111） |
| 06 名稱一律 short | ✅ PR #98 | `claude/naming-short-everywhere`（sw.js v112） |
| 07 備忘錄編輯 | 🟡 已 commit（c4c3eff）、**E2E 重跑中、未 push** | worktree `.claude/worktrees/agent-a1b92a33eb014e9d8`，分支 `claude/memo-editor-taller`（sw.js v113） |
| 08 Tooltip 元件 ＋ 09 首波八處 | 🟡 已 commit（0cce6f7、e473e1c），單元測試全綠，**全量 E2E 還沒跑、未開 PR** | 主工作區，分支 `claude/tooltip-component`（已 push，sw.js v114） |
| 05 用詞統一 | 🟡 剛開始 | worktree `.claude/worktrees/issue05-words`，分支 `claude/day-slot-words` |
| 10 讀取卡片單段化 | ⬜ Blocked by 05 06 09 | |

## 接手第一件事

### 一、跑 E2E 之前先停掉殘留的模擬器（這一輪最大的坑）

E2E 的 app 是模擬器的 hosting（`127.0.0.1:5000`）在服務，**服務的是「啟動它的那個目錄」的 `public/`，
而且跑完不會自己關**。在 worktree A 跑完、接著在 worktree B 跑，B 會沿用 A 的模擬器、測到 A 的程式碼
—— 這一輪 07 就「假紅」了 9 支。每次換目錄跑之前、跑完之後都停一次：

```
powershell -NoProfile -Command 'Get-NetTCPConnection -State Listen -LocalPort 4000,4400,4500,5000,8080,9099,9150 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }'
```

同一時間只能跑一組 E2E。

### 二、07

1. 看 E2E 結果（在它的 worktree 裡 `CI=1 npm run test:e2e:related`）
2. 綠了就 push、開 PR（基底 develop）。PR 內文要講：sw.js v113、不帶任何 `.scratch` 檔案、
   `dialog.js` 抽出 `ask()`（`confirmAction()` 行為不變）＋ 新增 `chooseAction()`
3. 在 #97 的分支上把 07 的 Status 改 done（臨時 worktree：`.claude/worktrees/pr97-scratch`）

07 的手動驗收（選擇器都對過原始碼）：
1. 待辦首頁 → 右上角「備忘錄」→ 點任一張的鉛筆 → 那張卡**沒有變矮**；右上角是墨綠的勾勾（存起來），左邊一顆灰色垃圾桶；底下那一排按鈕不見了
2. 打幾個字 → 點頁面標題「備忘錄 / SOP」→ 跳「這一份改到一半」→ 按「不要了」→ 字回到原本的樣子
3. 再按鉛筆、打字 → 點外面 → 按「存起來」→ 卡片上是新的字
4. 再按鉛筆、**什麼都不改** → 點外面 → 直接收起來，不跳任何框
5. 按鉛筆、打字 → 點外面 → 在框上按 Escape（或返回鍵、點灰底）→ 還在編輯，字都還在
6. 讀的狀態下**長按**鉛筆 → 變成紅色垃圾桶 → 點它 → 跳刪除確認 → 按取消 → 變回鉛筆

### 三、08＋09（Tooltip）

1. 停模擬器 → 在**主工作區**（分支 `claude/tooltip-component`）跑**全量** E2E：`app.js` 在 `related.js` 的 GLOBAL 名單，related 也會全跑
2. `git rm -r .scratch/quieter-screens` 單獨一個 commit（記帳只放 #97），push，開 PR（sw.js v114）

手動驗收：
1. 日曆 →「N 筆來訪・N 件待辦」那一行後面的茶色小 `?` → 泡泡從它底下長出來 → 點別處收起來；頁尾那一行字不見了
2. 壓表 → 選一個月 → 「排序」旁邊的 `?`；換一個排序丸子，再點 `?` 講的是新的排序
3. 客戶 → 看這個月的進度 → 摘要那一行的 `?`；頁尾三行不見了，泡泡裡沒有「ADR」
4. 客戶 → 一位還沒有任何任務的 →「還沒有任務。」後面的 `?`
5. 設定 → 名稱怎麼寫 → 標題旁邊的 `?`
6. 設定 → 資料健檢 → 磚塊只剩數字與名稱；標題旁邊的 `?` 點了**不會**展開那一塊；開一顆再點另一顆，前一顆收掉
7. 客戶 → 一位 → 不能的時間 → 月曆上方月份旁邊的 `?`
8. 日曆 → 點一位同一天兩段的其中一段 → 待辦那一塊那一列後面是 `?`（不是「這一天共用」四個字）
9. 設定切深色 → 隨便開一顆，看得清楚

### 四、05 → 10

05 的 issue 表格就是清單。補 ADR-0087（舊的 0081／0083／0085 不改）。
10 等 05 06 09 都合了再開始，從最新的 develop 開分支。

## 記帳

`.scratch/quieter-screens/` **只在 #97 這一支上改**。四支 PR 各帶一份的話，同一個新檔案內容一不同
就 add/add 衝突、後合的那一支合不進去。#97 合進 develop 之後，其他分支 rebase 上來就可以正常改它。

## 這一輪學到的

- **E2E 測到的是啟動模擬器那個目錄的程式碼**（見上面第一節）
- **平行的 PR 的 sw.js VERSION 要不同號**：同一個號碼 git 不衝突，但後合的那一支不會再清快取
- **背景 agent 一起吃額度**：上一個 session 同時開五支，全部死在半路
- **Bash 工具會把 `\` 吃成 `\`**：Python heredoc 裡的字面反斜線用 `chr(92)`，寫完 `node --check`
- 結束碼要用 `${PIPESTATUS[0]}`，`| tail` 會把紅的蓋成 0

## 談定的六個決定（不要重新討論）

1. 第三條 (d)：三頁改成「每一段自己一列，點了才看細節」，先看到的仍然是那一天有哪幾段 ＋ 那一天的待辦
2. 第二條：先做元件 ＋ 最划算的八處，其餘按畫面分批
3. 第七條 d：刪掉兩條路（長按鉛筆 ＋ 編輯中右上角的垃圾桶），ADR-0060 不動
4. 分多個 PR，小的先出
5. ADR-0085 的落差：改程式（真的拿掉那一塊），舊 ADR 不改
6. 「這一天共用」：改成 tooltip

## 交付前

- 每支 issue 的 Status 都是 done
- 補 CLAUDE.md「容易漏掉的連動」：`partnerChips()` 自己帶包裝；要分得出「不要了」與「手滑關掉」的確認框用 `chooseAction()`；說明文字先想 `tip()`、會改變寫入結果的警告不可以收進去；平行 PR 的 sw.js VERSION 不同號；E2E 換目錄先停模擬器
- 全部合完跑 `/matt-code-review`

---

# 貼給新 session 的開場

```
接手 baobao-wellness-clinic-scheduler 的一輪改動（.scratch/quieter-screens/）。

先讀，照順序：
1. CLAUDE.md —— 規則是硬的
2. HANDOFF：git fetch origin && git show origin/claude/quieter-screens-layout:.scratch/quieter-screens/HANDOFF.md
   （它只放在 PR #97 那一支上）
3. 同一支上的 .scratch/quieter-screens/spec.md 與 issues/ 那十支

然後照 HANDOFF 的「接手第一件事」一節一節做：先停殘留的模擬器，07 收尾開 PR，
Tooltip 分支跑全量 E2E、拿掉 .scratch、開 PR，接著 05、10。

規矩：一支 issue 一個 commit；PR 基底 develop；先寫失敗測試再修；日常 npm run verify；
同一時間只跑一組 E2E、換目錄跑之前先停模擬器；動到 public/ 要加 sw.js 的 VERSION 而且跟別的 PR 不同號；
.scratch 記帳只改 #97 那一支；交付附一份她可以照順序點的手動驗收清單（寫的人要真的走過）；
額度快到時先收尾、更新 HANDOFF、給新的開場提示詞。全部合完跑 /matt-code-review。
```
