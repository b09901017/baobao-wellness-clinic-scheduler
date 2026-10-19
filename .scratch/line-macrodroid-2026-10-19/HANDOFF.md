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
- CI 全量：01～05 那一版（run 39207395709）、06 之後（run 39209761841）都**六台全綠**
- 分支已推（`origin/claude/line-macrodroid`），**PR 還沒開**（段二審查完再開）

## 中途發現

1. ~~**確認時間那一頁開抽屜會整頁重畫，訊息框裡改過的字會不見**~~（她說修 → 06，done）（舊行為，過目查到）：她改了訊息、按 ✓ 開確認抽屜、關掉回來 → 改的字沒了。
   「打開 LINE」送的是當下那一格，所以照「改字 → 打開 LINE」的順序不受影響；先開過抽屜再按的話送的是原本那一段。建議：先不修，等她遇到再說（要修就是重畫時把那幾格的字帶著走）
2. **問這輪的時間那一頁讀客戶失敗沒有接住**（`home.js` 的 `renderAsk`，舊行為）：讀失敗整頁失敗。跟這一輪無關，只是順手看到
3. **沒驗證、要她手機上看一次的**：MacroDroid 的「Send Response」中文介面叫什麼（文件寫「傳送回應」是猜的、英文也寫了）；「貼上」的「直接設定文字」那一格的中文字；
   Chrome 從 app 裡叫本機位址那個「區域網路」的框長什麼樣；`window.open('https://line.me/R/nv/chat')` 在裝到主畫面的 app 裡是直接交給 LINE 還是先開一個分頁 —— 全部用設定頁的「試一次」與 iPad 點一次就知道

## 段二（10/19）

develop 沒動（merge-base 還是 eaa7279），不用 rebase。`/matt-code-review`（基準 `origin/develop`）：Standards 9 條、Spec 10 條。

### 改了的（一條一個 commit，改行為的先寫紅燈）

- 79b2ff9 **按兩下**：還在等回應、或叫到之後 3 秒內（`AGAIN_MS`）再按不再敲 —— 巨集跑兩次就是訊息貼兩次；打開對話與「試一次」共用那一格，退路不擋；第二下剪貼簿也不動。CLAUDE.md 那一列補一句
- bc1bfbd 「叫不到 MacroDroid」講三個原因（邊界測試清單 P2、常見問題本來就寫三個）
- e1237e0 「MacroDroid 沒回應」也講 Chrome 的「區域網路」框還開著（`NO_REPLY_MS` 的註解自己就這樣說）；常見問題跟著改
- a52e299 `fallback()` 的註解講對（叫不到之後才走到退路時，複製名字與開視窗在 fetch 之後）
- 0c18e0d 「試一次」的測試訊息 152 → 310 字（issue 02 寫「兩三百字」），第二段一段一行（真的確認訊息是單一個換行）；MacroDroid 設定多看一件「最後一句也在」
- 7933835 常見問題多「訊息已複製」「剛剛叫過」兩句；MacroDroid 設定第四段（app 那一側怎麼退）改成一行連到操作手冊
- 004850d ADR-0157 拿掉 Gemini 那一條（另一個決定；理由在 `spec.md`）
- 1a15d58 `editStore().paint(el, html)`（記 → 換掉 → 帶回去），兩頁各一行；找那一格收成 `areaOf()`。CLAUDE.md「照接」那一句指到 `paint()`
- 958e550 settings.js 的 form.js 只 import 一次
- 227d353 E2E 75 D0：客戶清單打 LINE 名字找得到（issue 01 判準要的那一條）

### 提過沒改的

- **叫不到之後 `window.open` 在 `await` 之後**（Spec）：Playwright 的 Chromium 關掉了擋彈出視窗，本機量不到。那條路只有勾了的 Android Chrome 走得到，被拒是幾毫秒、Chrome 的「剛按了」撐 5 秒；被擋時那一句照實講「沒辦法幫你打開 LINE」。理由寫進 `fallback()` 的註解（a52e299），她手機上 P2 看得到
- **退路是先複製再開，不是 issue 寫的先開再複製**（Spec）：刻意的 —— 兩件都在按下去那一刻的同一段同步程式裡叫，先開視窗的話焦點離開頁面、剪貼簿反而可能被擋。WebKit 連不上模擬器，iPad 只能她點（清單第 4、6 步）
- **設定頁 tip 沒講文件在哪**（Spec）：app 裡沒有任何一處指到 `docs/`（沒有連得過去的地方）；路徑寫在交付清單與 PR 裡
- **每個訊息框都多了 `form__actions`**（Spec）：那個 class 只有 flex＋gap、沒有 justify，只有一顆「複製」的那幾頁看起來一樣（客戶詳情「LINE 訊息」面板走過）
- **成功也講一句**（Spec）：`no-cors` 分不出 path 打錯，ADR-0157「後果」那一條
- **MacroDroid 設定第三段（app 那一側的設定步驟）**（Standards）：那是她設手機的最後一步（勾、試一次），是「怎麼設」不是規則；第四段才是 app 的行為，改成連結了
- **ADR-0157 決定 7（`integrations/` 資料夾）**（Standards）：理由是她的原話，加上「不 import 畫面」的約束（`notify` 由呼叫端傳的原因）
- **`openLineChat()`／`testLineMacro()` 開頭重複**（Standards）：各十來行、流程不同（試一次不走退路），併起來要多一個分岔，讀起來更繞
- **`line: { name }` 是包一個字串的物件**（Standards）：CLAUDE.md 與 ADR 都這樣寫，換成字串要動文件，換來的只有少一對大括號
- **`knock()` 的短名字**（`d`、`late`、`sent`、`got`）：作用範圍十幾行，註解講了每一個

### 驗證

- `npm test` 4927 全綠
- 本機 E2E：75（含 D0）、12、34、11、17 → 48 過；11 的 D3、D4 五支一起跑時紅、**單獨重跑 5/5 過**（搶 CPU；06 那一版 CI 全綠）
- `npm run verify` 的 `--related` 挑 54 支（`related.js` 這一輪改過，退回跟 develop 比）—— 本機不跑，全量交給 CI（見「CI」）
- 手動走過一次：一支暫時的 spec（沒 commit）照畫面上的字點，清單裡每一顆按鈕的字都是走的時候印出來的；MacroDroid 用攔 18080 的假的代替

### CI

（推上去之後補）

### 手動驗收清單（給她，照順序點）

**iPad 或電腦（沒裝 MacroDroid 的那一台）**

1. 設定 →「打開 LINE 對話」那一段：「這台手機裝了 MacroDroid」**不要勾** → 按「試一次」→ 跳「先勾上面那一格…」（沒勾的裝置一次都不敲手機的門）
2. 客戶 → 點一位 → 名字右邊「編輯」→「LINE 名字」那一格（旁邊的 `?`：照你 LINE 好友清單上的寫法）→ 打他在你 LINE 上的名字 → 存
3. 客戶 → 最上面的搜尋框打那個 LINE 名字 → 他那張卡在
4. 點進去 → 備註那一排的「LINE」→ 跳「已複製『…』：到 LINE 的搜尋貼上」，LINE 開起來 → 搜尋那裡貼上找得到他
5. 待辦 →「跟客人確認時間」→ 那一位的卡 →「先看一下訊息」→ 改一個字 → 卡片右上角圓的 ✓（開抽屜）→ 關掉 → 改過的字還在、還展開著
6. 同一張卡 →「複製 LINE 確認訊息」旁邊的「打開 LINE」→ 跳「訊息已複製；在 LINE 搜尋『…』，打開對話貼上」→ 到他的對話貼上，是改過的那一段
7. 一位沒填 LINE 名字的 →「打開 LINE」→ 跳「還沒填 LINE 名字：客戶詳情 → 名字旁邊的『編輯』→『LINE 名字』那一格」
8. 「問這輪的時間」（待辦首頁沒有那一列的話：設定 → 待辦首頁 →「問這輪的時間」按「一直顯示」）→ 一位的「產生 X 月的連結」→ 那一則底下「複製 LINE 訊息」旁邊有「打開 LINE」→ 按 → 同第 6 步那一句
9. 客戶詳情最底下「LINE 訊息」→ 那幾則**沒有**「打開 LINE」（照談定的，只加在確認時間與問這輪的時間）

**她的手機（照 `docs/MacroDroid設定.md` 設好巨集之後）**

10. 設定 →「打開 LINE 對話」→ 勾「這台手機裝了 MacroDroid」→ 連接埠跟 MacroDroid 的一樣（預設 8080）→「用哪一位試」打一位好友的 LINE 名字 →「試一次」→ Chrome 問「區域網路」按允許 → LINE 打開那一位、貼上三段的測試訊息：第二段一行一行、最後一句「看到這一句就代表整段都貼上了」也在 → 刪掉那一則（不會自己送出）
11. 回 app 馬上再按一次「試一次」→ 跳「剛剛叫過 MacroDroid 了…」，手機不會再跑一次
12. 客戶詳情點 LINE → LINE 停在他的對話、輸入框是空的
13. 跟客人確認時間 →「打開 LINE」→ 他的對話、訊息貼在輸入框、**沒有送出**
14. `docs/邊界測試清單.md` 的 P1～P5（同名好友、MacroDroid 被關、區域網路被拒、很長的訊息、A 之後點 B）

1～9 本機模擬器走過；10～13 只走過 app 這一側（假的 MacroDroid），手機那一側要她看（中途發現 3 那幾件也在這裡一起看）。

## 段二的開場

```
這一輪在做「LINE 用 MacroDroid 打開對話」：客戶的 LINE 那一格改存 LINE 上的名字，
客戶詳情點 LINE、確認時間／問這輪的時間的「打開 LINE」叫手機上的 MacroDroid（本機 HTTP Server）。
分支 claude/line-macrodroid，段一（01～06 實作與文件）做完了、已推，PR 還沒開。

先讀：.scratch/line-macrodroid-2026-10-19/HANDOFF.md、spec.md、issues/01～06 的「做完時留下的」、
docs/agents/lessons.md、CLAUDE.md「客戶的 LINE 那一格、打開 LINE 對話」那一列與「共用元件身上的屬性名字」。

這一段做：
1. git fetch；develop 往前走了就 rebase（不要重做）。看 HANDOFF 的 CI 結果（e2e-full run 39209761841，06 之後那一次）
2. /matt-code-review，基準是 origin/develop
3. 照建議修（一條一個 commit，修 bug 先寫紅燈測試）；提過沒改的把理由寫進 HANDOFF
4. npm run verify
5. 手動測試清單：她可以照順序點的路（自己在本機模擬器走過一次；模擬器的 Firestore 佔著 8080，
   本機驗收時設定頁的連接埠先改成別的、或只驗「沒開」那一條退路）
6. 推之前看一眼 commit 訊息與 PR 內文沒有真名；PR 開向 develop；CI 全綠之後合進 develop
7. HANDOFF 寫「已合進 develop（commit）」；README 狀態表、CLAUDE.md 連動表確認都補了
不做：進 main、Gemini 語音（她說先不做）。
```
