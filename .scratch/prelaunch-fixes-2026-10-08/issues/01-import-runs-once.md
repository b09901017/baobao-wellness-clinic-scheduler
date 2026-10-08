# 匯入還在跑時再按一次，全部客戶多建一份

Status: done
來源：`report/data.mjs` 的 `f-import-twice`（🔴）、`merge/report.md` 第 1 條
動工前先讀：`docs/agents/lessons.md` 第三節、`public/js/ui/views/mergeImport.js`（`:189` 的 listener、`:518-563` 的 `run()`）、
`public/js/data/legacyImport.js:73`、`tests/save-guards.test.js`（它的 `ALLOWED`）、ADR-0029、0047、
`CLAUDE.md` 連動表「一個會建立新資料的按鈕」
Blocked by: —
重現：`node .local/references/audit-2026-10-08/merge/r06-twice.mjs`（第 1、2 段）

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

她看過、同意要修的那一張卡（報告原文）：

> 匯入還在跑時再按一次「開始匯入」，全部客戶會多建一份，而且收不回來
>
> 在「設定 → 舊資料匯入」按「開始匯入」並確認之後，畫面下方會跑「匯入中… 3/29」。這段時間那顆按鈕還在、按得下去。網路慢的時候很容易以為當掉了，再按一次、確認框又按一次「匯入」。

## 為什麼會這樣

- `run()` 沒有「正在匯」的記號，按鈕整段都按得下去。
- listener 關進的是畫面剛畫好時算的那一份 `plans` —— 那時系統裡還沒有這些人，所以第二次每一位都再建一次。
- 寫入那一側每一位 `repo.newId()`，寫的時候不再查同名。
- 這一頁沒走 `toast.withSaveState(key)`，所以 `tests/save-guards.test.js` 根本看不到它。

合併檔只匯這一次。重複的客戶刪得掉，他身上的來訪不會跟著刪，app 也沒有刪來訪的路（ADR-0089）。

## 要做的

- `run()` 進行中鎖住：按鈕 `disabled`、第二次進來直接回。**確認框開著的那一段也算進行中**（她可能在第一個確認框還沒按之前又點一次）。
- 跑完（不管成功、有人失敗、**還是丟了例外**）才放開；放開之前**重算一次 `plans`**（已經建好的那幾位現在是同名、會被跳過）——
  按鈕按得下去的時候，它手上的名單一定是照現在的資料庫算的。**重算要放在 `finally`**：現在 `run()` 的 `catch`（`:558-561`）直接 `return`、不重畫，
  而 `importEvents()`／`importNotes()` 丟例外時客戶已經全部寫進去了 —— 按鈕手上還是舊的 `plans`，再按一次就是全部多一份。這一條比「匯入中連按」更容易發生。
- 讓 `tests/save-guards.test.js` 看得到這一頁：能走 `withSaveState({ key })` 就走；走不了（這一頁有自己的進度條、一位一個 commit）
  就在那支測試加一條掃這一頁的規則。**不要只把它放進 `ALLOWED`** —— 那等於把「沒掃到」寫成「不用掃」。

## 判準

- 匯入進行中再按一次，會不會多建**任何一位**？確認框還開著時再點一次呢？
- 跑完之後按鈕手上的名單是新算的嗎？（整份都匯好了 → 灰的；有人失敗 → 只剩那幾位）
- 客戶都寫完、雜事那一步丟例外之後再按一次，會不會多建**任何一位**？
- 有人失敗之後還重試得了嗎？（要。重試的內容歸 02）
- 換頁再回來、重新整理再貼一次，照舊每一位同名跳過嗎？（照舊，那條路本來就安全）

## 測試

- 單元：把「現在能不能跑」抽成問得到的東西（例如 `canRun(state)`），測進行中／跑完／失敗三種。
- 掃原始碼：`save-guards` 那一條。
- E2E（第一段共用一支新 spec，`61`）：模擬器上貼一份兩位假客戶（客戶A、客戶B）的合併檔 → 開始匯入 → 確認 →
  按鈕是 `disabled` → 跑完客戶清單剛好兩位。不要用固定等待，等 `app.saved()`。

## 文件

`CLAUDE.md` 連動表補一列「一次寫很多筆、跑很久的按鈕」（進行中鎖住、放開前重算、`save-guards` 看得到）—— 留到 23 一起寫，這裡先在「做完時留下的」記一句。

**「做完時留下的」一定要寫清楚 `run()` 現在長怎樣**（鎖在哪、什麼時候重算、確認框的句子從哪裡來）：02 接著改同一段，20 在另一個 session 改同一段、看不到這一次的對話。

## 做完時留下的（10/8）

`run()` 現在長這樣（`public/js/ui/views/mergeImport.js`）：

- **鎖**是檔案最上面的 `let running = false`。`run()` 第一行 `if (running) return;`，接著 `running = true` ＋ `lockButtons(el, true)`
  （直接把「開始匯入／讀進來／清掉」三顆設成 `disabled`，不整頁重畫）。確認框在鎖**裡面**開，所以它開著也算進行中。
  `paint()` 畫那三顆時也讀 `running`（匯入中她點了別的勾、整頁重畫，按鈕照樣是灰的）。
- 「開始匯入」按不按得下去只問 `domain/mergeImport.js` 的 `canRun({ running, customers })`。
- `run()` 整段包在 `try / catch / finally`。`wrote` 記「真的開始寫了沒」（確認框按「先不要」時是 false）。
  **`finally` 是唯一放開的地方**：`wrote` 的話先 `await importer.loadContext()` 重讀 → `running = false` → 拿新的那一份 `paint()`
  （重算 `plans`，已經建好的那幾位同名跳過）；沒寫的話只把三顆按鈕放開。重讀失敗就整頁換成「讀取失敗」（不留一顆手上是舊名單的按鈕）。
  她匯到一半換頁了（`[data-mergepage]` 不在）就不畫 —— 以前那一句 `await render(el)` 會把匯入頁畫到別頁上面。
- 確認框的句子還是 `run()` 裡那個陣列（02 要把「對不到主檔／同名跳過」那兩句搬去 domain 算）。
- `tests/save-guards.test.js` 多一段「沒走 withSaveState 的大批寫入要有自己的鎖」：掃 `importer.import(All|Plan|Events|Notes)(`，
  那支檔案要有 `if (running) return;`、第一個 `finally` 裡要有 `running = false;` 與 `loadContext(`。
  **20 改這一段時這三個記號要留著**（或連測試一起改）。
- 沒有走 `withSaveState({ key })`：它 8 秒後會換成「已經存在這台裝置上了」，而這一頁一位一個 commit、29 位一定超過 8 秒。

E2E `61` 的 I1–I3。改之前 I1 紅（確認框開著時按鈕按得下去）、I3 紅（再按一次 4 位）。

`sw.js` 升到 `v186`（這一支 PR 只升這一次）。

留給 23：`CLAUDE.md` 連動表補一列「一次寫很多筆、跑很久的按鈕」（進行中鎖住、`finally` 放開、放開前重讀、`save-guards` 看得到）。
