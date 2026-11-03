---
name: claude-md
description: 建立、健檢、精簡 CLAUDE.md 或 AGENTS.md：用刪除測試決定每一條規則留不留，刪掉的搬到子目錄 CLAUDE.md、.claude/rules/、skill、hook 或個人檔。用在使用者提到 CLAUDE.md、AGENTS.md、專案規則檔，說「幫我整理／檢查／瘦身／重寫規則檔」「Claude 一直忘記專案規則」「一直重複犯同樣的錯」「規則檔越來越肥」，或剛跑完 /init 要過濾的時候。
---

# CLAUDE.md 健檢與撰寫

CLAUDE.md 的每一行，每次新對話都會載入 context。官方建議每份 200 行以內：越長，遵守度越低，真正重要的幾條被稀釋。
它是 context，不是強制設定 —— 一定要成立的事要靠 hook。

**預設立場是刪除。** 一條規則要留下來，得自己舉證。

## 開始前：量，再對照模型

1. **先量**：每份多少行、多少字，哪一節佔多少（`wc -l`、`wc -m`，逐節數）。肥常常集中在一節，先處理那一節。
2. **對照現在的模型**：給舊模型的防呆規則，在新模型上會變成綁手綁腳、甚至過度觸發
   （官方 [Prompting best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) 的 migration 那幾節）。
   `/doctor prompt-audit [路徑]` 會找「寫給舊模型的指示」、指到不存在的檔、互相矛盾的句子，先跑一次。

## 刪除測試

對每一條，依序問：

1. **Explore subagent 掃一遍 codebase 找得到嗎？** 框架、目錄、build 指令、架構總覽 —— 找得到的刪。
2. **大部分任務都用得到嗎？** 否 → 搬走（見下一節）。
3. **三個月後還成立嗎？** 會過期的刪。
4. **跟 codebase 現狀或其他文件牴觸嗎？** 是 → 刪掉整段，改成一行指向那份唯一的正本。

任何一題答錯就處理掉，不要因為「當初是踩過坑才寫的」捨不得 —— 坑的細節可以搬去 lessons 或離那段程式最近的地方，CLAUDE.md 只留一句。

## 刪掉的內容搬到哪

| 內容性質 | 去處 |
|---|---|
| 客觀現狀、架構、指令 | 不寫，交給 Explore 自己找 |
| 只跟某些檔案或某個資料夾有關 | `.claude/rules/*.md` 加 `paths:`（按路徑或檔案類型載入），或那個資料夾的子目錄 CLAUDE.md（讀到那裡的檔案才載入） |
| 多步驟流程、很長偶爾才用的 SOP | 獨立成 skill |
| 絕對不能違反的 | hook 用程式攔；CLAUDE.md 留一句說明就好 |
| commit／PR 的規則 | `settings.json` 的 `attribution`、`includeGitInstructions`（寫在 CLAUDE.md 會跟內建的打架） |
| 個人偏好，不想進 git | `CLAUDE.local.md`（gitignore）；所有專案都要的 → `~/.claude/CLAUDE.md` 或 `~/.claude/rules/` |
| 給維護的人看的註記 | `<!-- -->`：載入前會被拿掉，不花 token |

層級由上而下疊加：使用者 → 專案 → 子目錄。放得離實際工作的檔案越近，適用範圍越準。
`@import` 只是整理，**不省 context**（被 import 的一起載入）。

## 該留下來的：codebase 翻不到的隱性知識

1. **不能搞錯的規定** — 對客顯示的價格一律含稅
2. **固定的處理方式** — 改價格要從試算表開始，直接改網頁會被蓋掉
3. **容易漏掉的連動** — 改會員價要同步首頁、結帳頁、FAQ、通知信（連動多了就搬去子目錄 CLAUDE.md 或 rules）
4. **完成的定義** — 改完 UI 要同時檢查桌機與手機版
5. **其他文件的位置** — 一行指過去，需要時再讀

## 撰寫規範

- 一條規則一行，陳述句，祈使語氣，寫成可以驗證的（「改完跑 `npm test`」，不是「記得測試」）
- 用標題與條列分組，不寫大段文字
- 理由**只在它會改變行為時**寫：讓 Claude 在規則沒講到的邊界情況判斷得對的那種（「……因為兩種症狀都不指向那一行」）。
  只是說明來龍去脈的理由不寫 —— 每次對話都要付它的 token
- 用領域專有名詞取代冗長描述 —— 術語是壓縮過的指令
- 不寫模型本來就會做的事
- 能寫成正向的寫正向；真正的硬護欄保留「絕不」，並考慮配 hook
- 同一件事只寫一處，其他地方一行指過去；兩條矛盾時 Claude 可能隨便挑一條
- CLAUDE.md 與 AGENTS.md 並存時，Claude Code 只讀 CLAUDE.md：在 CLAUDE.md 寫一行 `@AGENTS.md`，只維護 AGENTS.md 那一份

**會讓檔案只加不減的規則**本身也要檢查：例如「新發現的連動補進 CLAUDE.md 的表」—— 這種規則會讓根目錄 CLAUDE.md 一輪一輪變胖。
改成「寫在離那段程式最近的地方」。

## 兩種進入模式

**新建**：先跑 `/init` 產生初版，然後立刻對每一行套用刪除測試。`/init` 的產出是起點不是成品，它整理得太完整，而那些完整正是 Explore 本來就找得到的。

**維護**：新增與修剪成對做，否則檔案只會單向變胖。

- **新增**：`/insights` 分析最近的 session（只在本機），找反覆發生的問題。只補**第二次**出現的錯、或使用者打了第二次的同一句糾正。
- **修剪**：`/doctor` 的修剪建議、`/doctor prompt-audit` 找過時與矛盾，再對每一條跑一次刪除測試。

## 完成標準

- [ ] 量過，也跑過 `/doctor prompt-audit`
- [ ] 每一條保留的規則都通過刪除測試；每份 200 行以內
- [ ] 刪掉的每一條都找得到去處（Explore／rules／子目錄／skill／hook／settings／local），或寫了為什麼不需要
- [ ] 沒有任何一條與 codebase 現狀或其他文件牴觸
- [ ] 向使用者回報：刪除 N 條、搬移 N 條、保留 N 條，逐條附理由
- [ ] 改動前讓使用者看過 diff；使用者已經交代這次怎麼改（例如寫在 issue 裡）時，改完再給 diff

> 名字裡有 `claude`：Claude Code 照常載入；只有要上傳到 claude.ai 或 API 時要改名（那邊不准 `claude`、`anthropic`）。
