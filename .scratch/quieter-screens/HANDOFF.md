# 接手這一輪：讓畫面安靜下來

規格在 `spec.md` 與 `issues/` 那十支。這一份只記**做到哪**。
最後更新：2026-09-10（十支全部做完）

## 這一輪收工了

十支 issue 的 `Status:` 全部是 `done`。#97～#101 都合進 develop、#102 上了正式。
最後一支（10）在 `claude/read-card-one-slot`，PR 見下。收尾三件事也做完了：
`CLAUDE.md` 的連動表補了六條、`SPEC.md` 第 4.4 節跟著改、補了 ADR-0088。

## 狀態一覽

| issue | 狀態 | PR | sw.js |
|---|---|---|---|
| 01–04 版面小修 | ✅ | #97 `claude/quieter-screens-layout` | v111 |
| 06 名稱一律 short | ✅ 相關 E2E 172（J-A9 是舊行為的斷言，已改） | #98 `claude/naming-short-everywhere` | v112 |
| 07 備忘錄編輯 | ✅ 相關 E2E 66 全過 | #99 `claude/memo-editor-taller` | v113 |
| 05 用詞統一 | ✅ 相關 E2E 182 過（1 flaky 是 Google Fonts 網路，與改動無關） | #100 `claude/day-slot-words` | v115 |
| 08＋09 Tooltip | ✅ 全量 E2E 205 過；那 1 支 flaky（T2）是**真 bug**，修正與 T4 已補在同一支，驗證結果見 #101 的留言 | #101 `claude/tooltip-component` | v114 |
| 10 讀取卡片單段化 | ✅ 相關 E2E 全過（新增 `27-read-card-one-slot`，5 支） | `claude/read-card-one-slot` | v117 |

每一支 PR 的內文都有她可以照順序點的手動驗收清單。

## 這一輪學到的（10 那一支）

- **develop 上有一支 E2E 連 parse 都過不了**：`15-playbook.spec.js` 裡
  `'三樓報到
改成四樓'` 的反斜線在寫檔的路上被吃掉，變成字串中間一個真的換行。
  症狀是**整個 run 一支都沒跑**（不是「15 紅」），而單元測試全綠、
  沒有人在那個目錄跑 `node --check`。c4c3eff（#99）帶進來的，已修（`5d7cbd7`）。
- **`scripts/e2e.mjs --related` 比的是本機的 `develop` ref**，不是 `origin/develop`。
  本機那一支停在幾天前的話它會說「62 個檔案 → 全跑」。動工前
  `git branch -f develop origin/develop`。
- **舊的斷言又把待修的行為寫成預期**，這一輪第三次了：
  `calendar.test.js` 釘著「另外三頁不該帶 `focusSlot`」、
  `visit-editor.test.js` 釘著「那一摺要在」、`05` 與 `19` 兩支 E2E 各自
  寫了「把那一摺點開」的 helper。改之前先問它斷言的是不是她要改掉的行為。

## 已經做完的：合併（留著當紀錄）

### 一、合併（她點過 staging 之後）

- **#97 先合**（它帶著 `.scratch/`）。其餘四支之間沒有依賴
- **每合一支，下一支的 `sw.js` 那一行會衝突**：五支都是從 v110 往上加，號碼刻意不同（同號的話 git 不衝突，
  但後合的那一支不會清快取，她在 staging 上會看到「沒變」）。解法：**留數字大的那一個**，
  或者 rebase 到最新的 develop 之後改成「develop 上的號碼 + 1」
- 05、06、09 動到同幾個檔案（calendar、schedule、home、visitEditor、todoFlow），都是不同的行，應該不會文字衝突；
  但合完要在 develop 上跑一次 `npm test` —— `tests/css-shadowing.test.js`（#97）與 `tests/tip-red-lines.test.js`（#101）
  會掃到別支的檔案

### 二、E2E 的模擬器（這一輪最大的坑）

E2E 的 app 是模擬器 hosting（`127.0.0.1:5000`）在服務，**服務的是啟動它的那個目錄的 `public/`，
跑完不會自己關，E2E 也不會幫你開**。每一組都要：停掉殘留的 → 在**那一組自己的目錄**
`bash tests-e2e/start-emulators.sh &` → 等 5000／8080／9099 都在聽 → 跑 → 停掉。停的方式：

```
powershell -NoProfile -Command 'Get-NetTCPConnection -State Listen -LocalPort 4000,4400,4500,5000,8080,9099,9150 -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $_ -Force }'
```

### 三、10：等 #98、#100、#101 都合進 develop 之後，從最新的 develop 開分支

讀 issue 10 全文再動手。它動的是四個畫面共用的 `visitReadHtml()`，是這一輪最大最危險的一支。
要一起收掉的：來訪編輯器帶了 slotIndex 時「這一天整筆的」那一塊整個拿掉（ADR-0085 的落差，談定改程式），
「改這一天的狀態」另外留一條點得到的路（ADR-0060）。

### 四、收尾（已完成）

- 補 `CLAUDE.md`「容易漏掉的連動」：
  - `partnerChips()` 自己帶包裝（不可以裸接在 `alertChips()` 後面）
  - 要分得出「不要了」與「手滑關掉」的確認框用 `dialog.js` 的 `chooseAction()`（關掉回 null）
  - 常駐說明先想 `ui/components/tip.js` 的 `tip()`；會改變寫入結果的警告不可以收進去（`tip-red-lines.test.js`）
  - 畫面上的單位只有「這一段／這一天」，「筆」不上畫面（ADR-0087）
  - 平行 PR 的 `sw.js` VERSION 不同號
  - E2E 換目錄先停模擬器、從自己的目錄起
- 全部合完跑 `/matt-code-review`，照建議微調
- 清掉本機的 worktree：`git worktree list`，這一輪開的都在 `.claude/worktrees/` 底下

## 記帳

`.scratch/quieter-screens/` 在 #97 合進 develop 之後就直接在 develop 上，
10 那一支正常改它。這一輪開的 worktree（`.claude/worktrees/` 底下四個
＋ `issue05-words`）都可以清掉了：`git worktree list` 看得到。

## 這一輪學到的

- **E2E 測到的是啟動模擬器那個目錄的程式碼** —— 07 因此「假紅」兩次，第三次才是真的
- **flaky 要看失敗現場再決定**：05 的是網路（不用修），Tooltip 的是真 bug（看不見的泡泡沒被移除）
- **舊的斷言可能把 bug 寫成預期**：`todo-flow.test.js`、J-A9 都是 —— 改之前先問它斷言的是不是她要改掉的行為
- **平行 PR 的 sw.js VERSION 要不同號**
- **背景 agent 一起吃額度**：上一個 session 同時開五支，全死在半路
- **Bash 工具會把 `\` 吃成 `\`**：heredoc 裡的字面反斜線用 `chr(92)`；正規表示式能不用就不用
- 結束碼用 `${PIPESTATUS[0]}`，`| tail` 會把紅的蓋成 0

## 談定的六個決定（不要重新討論）

1. 第三條 (d)：三頁改成「每一段自己一列，點了才看細節」，先看到的仍然是那一天有哪幾段 ＋ 那一天的待辦
2. 第二條：先做元件 ＋ 最划算的八處，其餘按畫面分批（還沒轉的清單在 issue 08 的盤點裡）
3. 第七條 d：刪掉兩條路（長按鉛筆 ＋ 編輯中右上角的垃圾桶），ADR-0060 不動
4. 分多個 PR，小的先出
5. ADR-0085 的落差：改程式（真的拿掉那一塊），舊 ADR 不改
6. 「這一天共用」：改成 tooltip

---

# 這一輪結束了，不需要開場提示詞

十支全部 `done`，收尾三件事也做完了。下一輪是 README 開發狀態表的第 28 步「多帳號」，
那是另一輪的事，跟這一份沒有關係。

留著沒做的只有一件，而且**是刻意留的**：issue 08 的盤點裡還有一批常駐說明沒轉成
說明泡泡（談定的是「先做元件 ＋ 最划算的八處，其餘按畫面分批」）。那份清單在
`issues/08-a-tooltip-is-a-speech-bubble.md` 裡。
