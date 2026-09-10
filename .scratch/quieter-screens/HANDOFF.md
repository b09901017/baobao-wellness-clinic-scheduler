# 接手這一輪：讓畫面安靜下來

規格在 `.scratch/quieter-screens/spec.md` 與 `issues/` 那十支。這一份只記**做到哪**。
最後更新：2026-09-10（換了一個帳號接手之後）

## 狀態一覽

| issue | 狀態 | 在哪 |
|---|---|---|
| 01–04 版面小修 | ✅ PR #97 已開 | `claude/quieter-screens-layout`（已 push，sw.js v111） |
| 06 名稱一律 short | ✅ 已 commit，**未 push、未開 PR** | 本機 worktree `.claude/worktrees/agent-a709c9f4e317f5f99`，分支 `claude/naming-short-everywhere`（sw.js v112） |
| 07 備忘錄編輯 | 🟡 **程式寫完、未 commit** | 本機 worktree `.claude/worktrees/agent-a1b92a33eb014e9d8`，分支 `claude/memo-editor-taller`（sw.js v113） |
| 08 Tooltip 元件 | 🔴 紅燈 | `claude/tooltip-component`（已 push）：只有 `tests/tip.test.js`，元件還沒寫 |
| 05 用詞統一 | ⬜ 未開始 | |
| 09 首波八處 | ⬜ 未開始（Blocked by 08） | |
| 10 讀取卡片單段化 | ⬜ 未開始（Blocked by 05 06 09） | |

## 接手第一件事

兩個 worktree 裡的東西**只在這台電腦上**，先看一眼還在不在：

```
git -C .claude/worktrees/agent-a709c9f4e317f5f99 log --oneline -1     # 06
git -C .claude/worktrees/agent-a1b92a33eb014e9d8 status --short       # 07
```

**同一時間只能跑一組 E2E**（會搶模擬器的 port）。在 worktree 裡跑 `CI=1 npm run test:e2e:related`。

### 06 還差

1. 相關 E2E
2. `04-journey-a-happy.spec.js` 的 J-A9 很可能會紅：它斷言確認抽屜 `toContain('復能')`，
   而那一段是 INDIBA（簡稱 `IN`）。06 之後抽屜印的是 `IN(60)` 之類。
   **那支斷言寫的是她要改掉的舊行為** —— 改斷言，不是改回程式
3. push、開 PR（基底 develop）

### 07 還差

1. `npm test`、相關 E2E
2. Status 改 done、commit、push、開 PR

07 已經寫進程式的設計（照著驗就好，不要重新設計）：

- 編輯卡頂端一排：標題 ＋ 灰色垃圾桶（`data-del`）＋ 墨綠存檔鈕（`data-save`，最右邊＝鉛筆原本的位置），中間 16px；底下那一排拿掉
- `.pbdeck` 讀與編輯都是 78dvh（以前編輯是 62dvh，比讀的時候矮）
- 點卡片以外的地方或 Escape：沒改過直接收；改過跳 `chooseAction()` 三選一（存起來／不要了／關掉＝繼續改）
- 讀的狀態長按鉛筆 → 原地變紅色垃圾桶（`data-armed="true"`），再點才跳刪除確認
- `dialog.js` 抽出共用的 `ask()`：`confirmAction()` 行為不變，新增 `chooseAction()`
- 返回鍵維持原樣（沒接），理由在 issue 07 的 Comments

### 08

設計方向寫死在 issue 08 與 `tests/tip.test.js` 裡：視覺沿用既有 token；說明用 16px
`--tea-soft` 圓底的 `?` 字形（不畫 SVG），提醒用既有的 `icon('alert')`；泡泡的
`transform-origin` 綁在小尖角上（`--tip-origin`）；小尖角兩層疊；不用 `pushLayer()`；
點外面、Escape、`hashchange` 關掉，一次一張。

## 這一輪學到的

- **背景 agent 會一起吃額度。** 上一個 session 同時開了三支盤點、兩支實作，全部撞到上限死在半路，成果只剩沒 commit 的檔案。額度吃緊時寧可自己一支一支做
- **動了 `public/` 一定要加 sw.js 的 VERSION，而且平行的 PR 要各用不同號碼** —— 同一個號碼 git 不會衝突，但後合的那個不會再清一次快取，她在 staging 上看到的會是「沒變」
- `.claude/worktrees/` 要在 `.gitignore` 裡，不然 `git add -A` 會把 worktree 當成 gitlink 加進去（兩支分支都補了）

## 談定的六個決定（不要重新討論）

1. 第三條 (d)：三頁改成「每一段自己一列，點了才看細節」，先看到的仍然是那一天有哪幾段 ＋ 那一天的待辦
2. 第二條：先做元件 ＋ 最划算的八處，其餘按畫面分批
3. 第七條 d：刪掉兩條路（長按鉛筆 ＋ 編輯中右上角的垃圾桶），ADR-0060 不動
4. 分多個 PR，小的先出
5. ADR-0085 的落差：改程式（真的拿掉那一塊），舊 ADR 不改
6. 「這一天共用」：改成 tooltip

## 交付前

- 每支 issue 的 Status 都是 done
- 補 CLAUDE.md「容易漏掉的連動」：至少「`partnerChips()` 自己帶包裝」「要分得出『不要了』與『手滑關掉』的確認框用 `chooseAction()`」「平行 PR 的 sw.js VERSION 要不同號」
- 05 補 ADR-0087，舊的 0081／0083／0085 不改
- 全部合完跑 `/matt-code-review`

---

# 貼給新 session 的開場

```
接手 baobao-wellness-clinic-scheduler 的一輪改動（.scratch/quieter-screens/）。

先讀，照順序：
1. CLAUDE.md —— 規則是硬的
2. .scratch/quieter-screens/HANDOFF.md —— 做到哪、接手第一件事、哪六件已經談定
3. .scratch/quieter-screens/spec.md 與 issues/ 那十支

然後照 HANDOFF 的「接手第一件事」：先把 06 與 07 收尾開 PR（兩個都在本機 worktree 裡），
再把 08 的紅燈變綠，接著 09、05、10。

規矩：一支 issue 一個 commit；PR 基底 develop；先寫失敗測試再修；日常 npm run verify、
不要全跑 E2E、同一時間只跑一組 E2E；動到 public/ 要加 sw.js 的 VERSION 而且跟別的 PR 不同號；
交付附一份她可以照順序點的手動驗收清單（寫的人要真的走過那條路）；
額度快到時先收尾、更新 HANDOFF、給新的開場提示詞。全部合完跑 /matt-code-review。
```
