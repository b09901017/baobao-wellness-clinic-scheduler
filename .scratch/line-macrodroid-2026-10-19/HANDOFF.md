# HANDOFF：LINE 用 MacroDroid 打開對話（2026-10-19）

分支：`claude/line-macrodroid`（從 `origin/develop` eaa7279 開）
全貌與她的原話：`spec.md`。issue：`issues/01`～`05`。

## 分段

| 段 | 做什麼 | effort | 狀態 |
|---|---|---|---|
| 一 | 01～05 實作與文件（她 10/19：「可以」—— 這一輪小，同一個 session 做完） | high | 進行中 |
| 二 | `/matt-code-review` 審這一輪全部改動，照建議修；手動測試清單；開 PR 進 develop、CI 全綠、合併 | xhigh | todo |

**01 與 03 必須同一個 PR**（只改了存名字、點下去沒接線的狀態是壞的）—— 整輪一個 PR。

## 過目（10/19，subagent 唯讀）

抓到的都補進各支 issue 的「過目補的」。主控自己對過的兩條最重的：
- E2E 與本機模擬器的 Firestore 就在 `127.0.0.1:8080`（`firebase.json`、`data/firebase.js:39`）—— E2E 改用別的 port
- LINE 丸子改成 `<button>` 會吃到 `button.mark::after { inset: -8px 0 }`（app.css:1529），要加進 -3px 那一條

## 待她回答

- **合併檔**：她說「幫我改合併檔就好，讓合併檔是最新的就好」。查過合併檔沒有 LINE 那一格（匯入一律寫 `null`），存的意思換了也不用改、不用升版。
  她是不是想要合併檔**帶 LINE 名字進來**？那要一份名單（從哪裡來？）—— 段一結束時問

## 進度

（每支做完寫一行）

## 中途發現

（段一結束時一次列給她）

## 段二的開場

```
這一輪在做「LINE 用 MacroDroid 打開對話」：客戶的 LINE 那一格改存 LINE 上的名字，
客戶詳情點 LINE、確認時間／問這輪的時間的「打開 LINE」叫手機上的 MacroDroid（本機 HTTP Server）。
分支 claude/line-macrodroid，段一（01～05 實作與文件）做完了。

先讀：.scratch/line-macrodroid-2026-10-19/HANDOFF.md、spec.md、issues/01～05 的「做完時留下的」、
docs/agents/lessons.md、CLAUDE.md「客戶的 LINE 那一格、打開 LINE 對話」那一列與「共用元件身上的屬性名字」。

這一段做：
1. git fetch；develop 往前走了就 rebase（不要重做）
2. /matt-code-review，基準是 origin/develop
3. 照建議修（一條一個 commit，修 bug 先寫紅燈測試）；提過沒改的把理由寫進 HANDOFF
4. npm run verify
5. 手動測試清單：她可以照順序點的路（自己在本機模擬器走過一次；模擬器的 Firestore 佔著 8080，
   本機驗收時設定頁的連接埠先改成別的、或只驗「沒開」那一條退路）
6. 推之前看一眼 commit 訊息與 PR 內文沒有真名；PR 開向 develop；CI 全綠之後合進 develop
7. HANDOFF 寫「已合進 develop（commit）」；README 狀態表、CLAUDE.md 連動表確認都補了
不做：進 main、Gemini 語音（她說先不做）。
```
