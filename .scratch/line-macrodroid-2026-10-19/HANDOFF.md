# HANDOFF：LINE 用 MacroDroid 打開對話（2026-10-19）

分支：`claude/line-macrodroid`（從 `origin/develop` eaa7279 開）
全貌與她的原話：`spec.md`。issue：`issues/01`～`05`。

## 分段

| 段 | 做什麼 | effort | 狀態 |
|---|---|---|---|
| 一 | 01～05 實作與文件（她 10/19：「可以」—— 這一輪小，同一個 session 做完） | high | **done**（10/19） |
| 二 | `/matt-code-review` 審這一輪全部改動，照建議修；手動測試清單；開 PR 進 develop、CI 全綠、合併 | xhigh | todo |

**01 與 03 必須同一個 PR**（只改了存名字、點下去沒接線的狀態是壞的）—— 整輪一個 PR。

## 過目（10/19，subagent 唯讀）

抓到的都補進各支 issue 的「過目補的」。主控自己對過的兩條最重的：
- E2E 與本機模擬器的 Firestore 就在 `127.0.0.1:8080`（`firebase.json`、`data/firebase.js:39`）—— E2E 改用別的 port
- LINE 丸子改成 `<button>` 會吃到 `button.mark::after { inset: -8px 0 }`（app.css:1529），要加進 -3px 那一條

## 她回答過的（10/19 段一結束時）

> 1. 好，如果沒有就沒有，不用把 LINE 名字一起帶進來
> 2. 我覺得可以修
> 3. 好

- 合併檔不帶 LINE 名字，這一輪不動
- 中途發現 1（開抽屜之後改過的字不見）→ 開了 **06** 修掉
- 中途發現 3（要她手機上看一次的）→ 合進 develop 之後她用「試一次」看

## 進度

- 01 done（3d22bf7）：那一格存名字、`lineHref()` 拿掉、丸子改按鈕、觸控區 -3px、E2E 74 N13
- 02 done（ea4898a）：`integrations/lineMacro.js`、設定頁「打開 LINE 對話」、E2E 75 L1～L3
- 03 done（3be0cf3）：客戶詳情點 LINE、E2E 75 D1～D3
- 04 done（20be5c0）：訊息框「打開 LINE」、確認時間與問這輪的時間、E2E 75 M1～M3
- 05 done（10bb254）：ADR-0157、`docs/MacroDroid設定.md`、CLAUDE.md 連動表、SPEC／CONTEXT／操作手冊／常見問題／邊界測試清單、README
- 驗證：`npm test` 4922 全綠；本機 E2E 跑了 74、75、17、12、15、34（全過）；**全量交給 CI**（`e2e-full.yml`，run 39207395709）—— `--related` 挑到 54 支（動了 `public/css/` 與 `home.js`），本機跑太重
- 06 done：訊息框裡改過的字跨整頁重畫留著（確認時間、問這輪的時間），E2E 75 R1～R3；本機 75、12、34、11 全過
- CI 全量（01～05 那一版，run 39207395709）**六台全綠**；06 之後再跑一次（見下一行）
- 分支已推（`origin/claude/line-macrodroid`），**PR 還沒開**（段二審查完再開）

## 中途發現

1. ~~**確認時間那一頁開抽屜會整頁重畫，訊息框裡改過的字會不見**~~（她說修 → 06，done）（舊行為，過目查到）：她改了訊息、按 ✓ 開確認抽屜、關掉回來 → 改的字沒了。
   「打開 LINE」送的是當下那一格，所以照「改字 → 打開 LINE」的順序不受影響；先開過抽屜再按的話送的是原本那一段。建議：先不修，等她遇到再說（要修就是重畫時把那幾格的字帶著走）
2. **問這輪的時間那一頁讀客戶失敗沒有接住**（`home.js` 的 `renderAsk`，舊行為）：讀失敗整頁失敗。跟這一輪無關，只是順手看到
3. **沒驗證、要她手機上看一次的**：MacroDroid 的「Send Response」中文介面叫什麼（文件寫「傳送回應」是猜的、英文也寫了）；「貼上」的「直接設定文字」那一格的中文字；
   Chrome 從 app 裡叫本機位址那個「區域網路」的框長什麼樣；`window.open('https://line.me/R/nv/chat')` 在裝到主畫面的 app 裡是直接交給 LINE 還是先開一個分頁 —— 全部用設定頁的「試一次」與 iPad 點一次就知道

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
