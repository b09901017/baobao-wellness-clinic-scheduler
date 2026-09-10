# 接手這一輪：讓畫面安靜下來

貼給新 session 的開場提示詞在最下面。這一份是狀態，不是規格 —— 規格全部在
`.scratch/quieter-screens/spec.md` 與 `issues/` 底下那十支。

## 已經完成

| issue | 狀態 | 在哪 |
|---|---|---|
| 01 切換器折行 | ✅ done | PR #97 |
| 02 兩顆 › | ✅ done | PR #97 |
| 03 底條懸空 | ✅ done | PR #97 |
| 04 自然美丸子 | ✅ done | PR #97 |

**PR #97**（`claude/quieter-screens-layout` → `develop`）已開，等她點過。
`npm test` 2262 支全綠、相關 E2E 82 支全過（14.0m）。

## 進行中（背景 agent，可能已經做完）

| issue | 分支（本機 worktree） |
|---|---|
| 06 名稱一律 short | `claude/naming-short-everywhere` |
| 07 備忘錄編輯 | `claude/memo-editor-taller` |

兩支都在 `.claude/worktrees/` 底下自己的 worktree 裡，從 `origin/develop` 開的，
**沒有 push、沒有開 PR**。接手的人第一件事是去看它們做完了沒：

```
git branch --list 'claude/naming-short-everywhere' 'claude/memo-editor-taller'
git log --oneline origin/develop..claude/naming-short-everywhere
git log --oneline origin/develop..claude/memo-editor-taller
```

有 commit 的話：跑一次 `npm test`，讀 diff，確認 issue 的判準都滿足了，再開 PR。
沒有 commit 的話當它沒發生過，自己做。

## 卡在紅燈的那一支

**issue 08（Tooltip 元件）** 在 `claude/tooltip-component`（已 push）。

那支分支上只有一個 commit：`tests/tip.test.js`，**整支是紅的** ——
`public/js/ui/components/tip.js` 還不存在。這是 TDD 的紅燈階段，故意留著的。

設計方向已經定了，寫進測試裡了，照著做就好：

- **視覺一律沿用既有語彙**，不開新的色相：`--tea` / `--tea-soft` / `--surface` /
  `--border` / `--radius-sm` / `--shadow-2` / `--text-xs`
- **說明那一種不畫 SVG**：16px 圓、`--tea-soft` 底、`--tea` 的 `?`，700 / 11px。
  一個字形在 16px 下比線條清楚（既有的 `icon('info')` 其實畫成驚嘆號的形狀，
  點在下面、豎在上面 —— 那是另一件事，這一輪不動它）
- **提醒那一種**用既有的 `icon('alert')`（三角形）
- **大膽度只花在一個地方**：`transform-origin` 綁在小尖角上（`--tip-origin`），
  泡泡從她按的那一顆長出來，不是憑空淡入。時長沿用 `--motion-base`
- 想加一個 `--ease-pop`（帶一點回彈）給那個「可愛」的手感的話：
  **motion token 放在 tokens.css 的「淺色」標記之前**，那裡的東西不需要深色版
  （`tests/tokens.test.js` 只管標記之後的）。issue 08 原本寫「不要另開一組」，
  要開就在 commit 裡講清楚為什麼
- 小尖角**兩層疊**（`::before` 邊線色、`::after` 底色，差 1px），
  不要用旋轉的方塊 —— 那會在邊線上留一道縫
- **不要 `pushLayer()`**：它太輕，不值得佔一格瀏覽器紀錄。
  點外面、Escape、`hashchange` 要關掉，一次只開一張
- 位置：測量之後夾在視窗內，小尖角跟著位移量一起移，撞到底就翻到上面

## 還沒開始

| issue | 難度 |
|---|---|
| 05 用詞統一（20 處 ＋ 2 個真 bug） | 中。動 domain 文案，要補一支 ADR（下一個編號 0087） |
| 09 首波八處轉換 | 小，但 Blocked by 08 |
| 10 讀取卡片單段化 | **這一輪最大最危險的一支**。Blocked by 05, 06, 09 |

## 這一輪談定的六個決定（不要重新討論）

1. **第三條 (d)**：三頁改成「每一段自己一列，點了才看細節」，但先看到的仍然是
   那一天有哪幾段 ＋ 那一天的待辦
2. **第二條**：先做元件 ＋ 最划算的那八處，其餘按畫面分批
3. **第七條 d**：刪掉要有兩條路（長按鉛筆 ＋ 編輯狀態右上角一顆低調的垃圾桶），
   ADR-0060 不動
4. **PR 切法**：五個 PR，小的先出（實際六支）
5. **ADR-0085 的落差**：改程式（真的拿掉那一塊），舊 ADR 一個字不改
6. **「這一天共用」**：改成 tooltip，點了才講（它沒寫錯，它在講一件真的事）

## 交付前

- 每一支 issue 的 `Status:` 都是 `done`
- **回去補 `CLAUDE.md` 的「容易漏掉的連動」那張表**：這一輪長出來的新連動至少有
  「改 `partnerChips()` 的畫法」「加一段常駐說明文字」兩條
- 05 要補的那支 ADR 寫了，舊的 0081 / 0083 / 0085 一個字都沒改
- 全部合完之後跑一次 `/matt-code-review`

---

# 貼給新 session 的開場

```
接手 baobao-wellness-clinic-scheduler 的一輪改動。

先讀這三份，照順序：
1. CLAUDE.md（專案根目錄）—— 規則是硬的，尤其「容易漏掉的連動」那張表
2. .scratch/quieter-screens/HANDOFF.md —— 這一輪做到哪了、哪幾件已經談定
3. .scratch/quieter-screens/spec.md 與 issues/ 底下那十支

上一個 session 做完 01–04（PR #97 已開），06 與 07 分給背景 agent 做了
（分支在，可能已經有 commit，HANDOFF 第一節寫了怎麼確認），
08 停在 TDD 的紅燈（分支 claude/tooltip-component 上有一支整支紅的
tests/tip.test.js，元件還沒寫）。

請從這裡接下去：

一、先確認 06 與 07 那兩支背景 agent 的成果。有 commit 就跑 npm test、
    讀 diff、對 issue 的判準，然後各開一個 PR（基底 develop）。
    沒有就自己做。

二、把 08 的紅燈變綠 —— 寫 public/js/ui/components/tip.js 與它的 CSS。
    設計方向已經定死在 HANDOFF 裡與測試裡了，不要重新設計。

三、接著 09、05、10（10 要等 05 06 09）。

規矩：
- 一支 issue 一個 commit，PR 基底一律 develop 不是 main
- 先寫重現得出來的失敗測試再修，不要先改 code 再補測試
- 日常驗收 npm run verify，不要全跑 E2E（無頭 24 分鐘，而她在等）
- 交付時給一份她可以照順序點的手動驗收清單，而且寫的人要真的走過那條路
- 動到 domain 規則或狀態機那幾支，做完一支就換一個 session

全部合完之後跑 /matt-code-review。
```
