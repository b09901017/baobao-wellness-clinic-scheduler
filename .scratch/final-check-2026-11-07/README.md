# 上 main 前最後健檢（2026-11-07）

develop `a8081e6b` 比 main `5dc22c05` 多的 26 支 PR（#199～#224），分五組各開一個 session 查（code review 兩軸＋ripple-check），一次兩個；
主控另外查跨 PR 的整合、重現每一組報的每一條。**只查、沒有改任何程式。**

## 結論

**沒有要在合進 main 之前修的程式問題。** 每一支 PR 都做到當初要的；各輪審查說修了的（一次性客人 R1～R14、隨手記網頁 R1～R8、Android R1～R9）都真的修好了；
平行合進來的 PR 沒有互相踩到（後合的每一支都先把當時 develop 的頂合進自己的分支）。CI 上整套 E2E 在 `a8081e6b` 六台全綠（run `42337540955`）。

| 組 | PR | 上 main 前要修 | 之後再做 | 報告 |
|---|---|---|---|---|
| 1 一次性客人 | #210、#212 | 0 | 1 | [1-one-time-guests.md](1-one-time-guests.md) |
| 2 試算表 | #201、#202、#204、#207～#209、#211、#213、#216、#218～#220 | 0（文件一條） | 2 | [2-sheet.md](2-sheet.md) |
| 3 隨手記網頁 | #221、#224、#203 的 05 | 0 | 4 | [3-notes-web.md](3-notes-web.md) |
| 4 Android 小工具 | #222 | 0 | 5＋1 要實機看 | [4-android.md](4-android.md) |
| 5 其餘 | #203、#214、#215、#199、#205、#206、#217、#223、#200 | 0（多點一條實機） | 3 | [5-misc.md](5-misc.md) |

## 主控查的跨 PR 整合

| 查了什麼 | 結果 |
|---|---|
| 平行合併時 CLAUDE.md／SPEC.md／CONTEXT.md／ADR 索引／README／STAGING.md 有沒有哪一支加的字被蓋掉（每一支 PR 加的小句到 develop 還在不在） | 找不到的都是後來的 PR 刻意改寫的（不凍結之後拿掉的凍結說明、情境表搬到共用情境檔、worktree 不再建 `.local` 連結） |
| 新的 Firestore 查詢要不要複合索引（模擬器不檢查索引） | 網頁新加的兩個都是單一欄位等號（`linkId`、`entitlementId`）；Android 的 `(deletedAt, done, createdAt desc)` 索引本來就有；`firestore.indexes.json` 沒變 |
| `firestore.rules` 的差異 | 只多了隨手記 `linkId` 的檢查，比 main 那一份**更嚴**（main 的 `validNote()` 沒有欄位白名單，本來就不擋 `linkId`） |
| `functions/`、`storage.rules` | 沒變 —— 上 main 不用部署 Function |
| `SYNC_FORMAT` | 兩邊都是 8，新舊 app 與新舊 `.gs` 四種組合都推得上去（第 2 組用替身實際跑過，主控重跑一次一樣） |
| ADR 0171～0181 都進了索引；沒有開著的 PR | 對 |

## 主控重現過的（每一條都跑過，結果跟報告一樣）

| # | 哪一組 | 內容 | 會不會寫錯資料 | 大小 |
|---|---|---|---|---|
| A | 3 | 日曆的編輯器可以把營養品的提醒改掛給別人 → 勾掉時不問給了哪幾款、交付沒記（正式站本來就有；#221 多一條「打名字跳出客戶」的路）。E2E X1／X1b／X2 | **會**（少記交付）。正式站現在一包營養品都沒有，所以目前碰不到 | 約 5 行＋E2E |
| B | 5 | 「跟客人確認時間」的記一句連按兩下「記」→ 隨手記長兩筆（正式站本來就有；`save-guards` 那一條豁免的理由不成立）。E2E F1 紅：2 筆 | 多一筆一樣的隨手記 | 約 3 行 |
| C | 3 | 打字時轉方向（鍵盤還開著）→ 底部導覽列站回鍵盤上面，收一次鍵盤才好（#221） | 不會 | 約 5 行 |
| D | 3 | 「改日期」那張卡寫「只改這一天」、選單同一件事寫「只改這一筆」（#221，R2 漏一個字） | 不會 | 1 行 |
| E | 3 | 「給營養品」名單上「已經約了」印 `2026-11-10`、沒日期的提醒不講「已經有一筆」 | 不會 | 2 行 |
| F | 1 | 批次建立打到一次性客人的名字，只講「已經有 1 位叫這個名字」（新增客戶那一頁會講轉成我的客戶） | 不會 | 約半小時 |
| G | 2 | `sheets/README.md`、`.gs` 檔頭、`docs/STAGING.md` 都沒寫「加 Google Sheets API 服務」；README 還寫 `LAYOUT_VERSION` 2 | 不會（沒加只是慢） | 文件 10 分鐘 |
| H | 4 | staging 清空重來（真刪）之後，HTC 上的小工具一直留著已經不存在的那幾筆，要登出再登入；`docs/STAGING.md`「二、清空重來」沒寫 | 不會（只有 staging） | 文件 1 行 |
| I | 3 | CLAUDE.md 寫「`validateNote()` 與 Rules 一起擋」，網頁其實沒有任何寫入路徑叫 `validateNote()`（擋的是 `copyPlan()`、選單、Rules） | 不會 | 文件 1 行 |
| J | 3、4 | `.scratch/notes-widget/HANDOFF.md` 段九 6 與 `android-checklist.md` 寫「舊的 Rules 會擋 `linkId`」—— 不對（main 不擋）；真正要等 main 的理由是舊的網頁看不懂連在一起 | 不會 | `.scratch` 半句 |

## 上 main 前修掉的（她 11/7：「先修再上 main」，分支 `claude/pre-main-fixes-2026-11-07`）

每一條先寫一支會紅的測試、確認紅了才改（F 收進 backlog）：

| # | 改了什麼 | 測試（改之前紅、改之後綠） |
|---|---|---|
| A | `calendar.js` 的 `mountNoteEditor()`：既有的營養品提醒（`bagOwned`）不畫「掛給誰」、不接打名字跳出客戶、存的時候只送日期；抬頭底下那一行換成「客戶C 的營養品提醒：掛給誰跟著那一包」。**ripple-check 另外抓到一處**：「從日曆拿掉」那一顆也從表單讀「掛給誰」—— 只把那一顆藏起來的話，按它會把掛的人清成空的，一起改成不帶那兩格 | E2E `98` 的 S9（重跑三次都綠） |
| B | `home.js` 的 `saveFollowupNote()`：`withSaveState()` 帶 `key: followupNote:<客戶>`，第二下接到同一趟；`tests/save-guards.test.js` 那一條豁免拿掉 | E2E `28` 的 N3（改之前 2 筆、改之後 1 筆；重跑三次都綠） |
| C | `ui/keyboard.js`：抽成純函式 `nextKeyboard()` —— 量過最高的照寬度各記一份；轉到還沒量過的方向、那一刻鍵盤開著還在打字，就先照舊算開著，等長回來一截或不打字了再照一般的量 | `tests/keyboard.test.js` 五條（轉過去、轉回來、沒在打字、不打字了、桌機縮放）；第 3 組的 `keyboard-rotate.mjs` 對改好的程式重跑 → PASS |
| D | 「改日期」那張卡底下那一行改問 `linkedWords(reach).date`（網頁 `note.js` 的 `askDateChange()`，**Android 的 `MenuActivity.kt` 的 `DateCard` 也寫死同一個字，一起改**） | `tests/notes-linked.test.js` 一條（兩邊都不寫死「只改這一天」） |
| E | `domain/products.js` 的 `givableBags()`：日期用 `shortDate()`（`11/10(二) 已經約了`）、沒日期的提醒講「已經有一筆提醒」 | `tests/products.test.js` 改一條、加一條 |
| G | `sheets/README.md`「升版之後」、`.gs` 檔頭的安裝步驟（註解，不動程式碼雜湊、不升 `LAYOUT_VERSION`）、`docs/STAGING.md` 上線檢查表：加「Google Sheets API」服務那一步與怎麼確認；README 不再寫死 `LAYOUT_VERSION` 2 | — |
| H | `docs/STAGING.md`「二、清空重來」與 CLAUDE.md Android 那一列：真刪之後小工具要登出再登入 | — |
| I | CLAUDE.md「隨手記的 `linkId`」那一列：營養品的提醒不能連在一起實際擋在哪（網頁沒有任何寫入路徑叫 `validateNote()`）；「營養品」那一列補「掛給誰跟著那一包」（A 的規則）；「蓋住整頁的一層」那一列補 `nextKeyboard()` | — |
| J | `.scratch/notes-widget/HANDOFF.md` 段九 6、`android-checklist.md` B 段前提：要等 main 的理由改成「舊的網頁看不懂連在一起」 | — |

跑過的：全部單元測試 6,015 支過（skipped 1 是只在 worktree 裡驗得到的那一條）；本機 E2E（模擬器、1 個 worker）`100`、`98`、`97`、`91`、`28`、`99` 共 39 支，`01`、`04`、`07`、`15`、`34`、`44`、`70`、`89` 共 79 支，全過。

## 之後再做（沒有重現的必要或要實機）

- F：批次建立打到一次性客人的名字講不清楚（第 1 組，收進 backlog）

- 轉頁登入沒有任何一支 E2E（第 5 組；`repro-login-redirect.spec.js` 的 L1～L3 可以搬進 `81`）
- 轉頁回來那一下 iframe 載不到：12 秒跳「載入失敗」、按重新載入就好；`getRedirectResult()` 的錯誤一律吞掉（第 5 組；#215 以前也這樣）
- 每次打開 app 都整份讀一次 Firestore 去推試算表（第 2 組；只花錢，估每月台幣個位數到十幾元）；`.gs` 計時那一行多記有沒有用到 Sheets API（下次貼 `.gs` 一起）
- Android：寫入前一筆一筆讀（L4）、`notes-parity` 沒釘 `#/todo/notes` 與 `#/customers/:id`（L5）、圖示沒有加小筆（L3，spec 有寫、沒有決定 → 問她）、過午夜到下一次同步之前小工具的「今天」還是昨天（S1，要三星實機看）
- `.scratch/notes-widget/HANDOFF.md:104` 有 HTC 的裝置序號（不是秘密，要不要拿掉她決定）

## 上 main 的順序（第 2 組的建議＋CLAUDE.md、`docs/STAGING.md` 七）

1. staging 上她要點的（壞了會整天用不了的放前面）：
   - **iPad 主畫面那一顆**：拍照、**登出再登入**、打開要多久（PR #215 清單）
   - **Android 主畫面那一顆：登出再登入**（第 5 組新加：#215 改了轉頁回來那一段，這一台一直走轉頁）
   - PR #221 清單 B 段（鍵盤、注音、打字時拖抽屜、iPad、深色）—— 鍵盤那一條改的是全站的版面
   - PR #203 第 5 條（手機「挑日期」）、PR #210 一次性客人清單、PR #224 清單
2. staging 那一份試算表貼版號 8 的 `.gs` → 部署新版本 → 立刻推一次 → 看疊在日期底下的長句與錯開的顏色
3. **正式那一份試算表先換 `.gs`**（先換就不用擔心舊 `.gs` 慢又每次打開都推）：記下現在部署的版本號（退路）→ 服務 ＋ Google Sheets API（ID 保持 `Sheets`）→ 貼 develop 的 `.gs` → 部署新版本 → 正式站 app「立刻推一次」（34 頁整份重畫約 2 分鐘；備註淡灰、營養品沒日期是正常的，等第 6 步）
4. 正式站：設定 → 匯出備份（放 `.local/references/`）＋跑一次 `#/settings/health` 記下結果
5. 開 develop → main 的 PR、CI 全綠、合併（**她另外說**）
6. 部署好之後：**手機與 iPad 一台接一台點「有新版本・點一下更新」**（只更新一台的話兩台交替推、每次都整份重畫）→ 其中一台立刻推一次（又是整份重畫一次）→ 備註有顏色、營養品有購買日 → 再跑一次 `#/settings/health` 跟第 4 步比
7. Android 正式版：從 main 那一個 commit、乾淨的 checkout 建 `assembleProdRelease` → App Distribution 派給三星（正式專案的 App Distribution 第一次要在主控台按「開始使用」；三星那個帳號的 email 到時候才問、不寫進 repo）

## 重現檔

都在各組 worktree 的 `.scratch/final-check-2026-11-07/`（`.claude/worktrees/final-check-{guests,sheet,notes,android,misc}-*`），沒有 commit；這個資料夾收五份報告與 `keyboard-rotate.mjs`（C 的重現：`node .scratch/final-check-2026-11-07/keyboard-rotate.mjs`，改好之後印 PASS）。A、B 的重現已經變成正式的 E2E（`98` S9、`28` N3）。
