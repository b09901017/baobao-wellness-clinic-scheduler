# `integrations/lineMacro.js`：叫手機上的 MacroDroid；設定頁「打開 LINE 對話」那一段

Status: todo
Blocked by: —
動工前先讀：spec 的「策略」「查到但沒驗證的」；`ui/theme.js`（記在這一台裝置的寫法、`localStorage` 一律 try/catch，ADR-0055）；`ui/components/message.js` 的 `copy()`（剪貼簿被擋時的退路）；
`ui/views/settings.js` 外觀那一段（不重畫整頁，ADR-0038）；`public/sw.js` 的 `SHELL`／`VERSION` 與 fetch 處理（跨網域一律不管 —— 已確認不會攔 `127.0.0.1`）；`tests-e2e/related.js`（新檔要登記）；
CLAUDE.md「`public/` 底下任何檔案」「寫入的等待與失敗文案」（toast 在 node 裡 import 不起來）兩列；`lessons.md` 一

## 她要的

> 在 Chrome 打 http://127.0.0.1:8080/line?name=… 走通了 !

> 這兩個應該是獨立功能，不影響其他的吧 ? 可以寫在一個獨立的資料夾

> 2. 照你的建議（沒裝 MacroDroid 的裝置、或叫不到時：複製＋打開 LINE 的聊天清單，講一句接下來怎麼做）

## 為什麼會這樣

網頁啟動不了 MacroDroid 的巨集；MacroDroid 的 **HTTP Server Request** 觸發條件在手機上開一個本機伺服器，網址後面的參數寫進巨集的變數（變數要先建好）。她用網址列驗過了。

## 要做的

`public/js/integrations/lineMacro.js`（新資料夾，**不 import `ui/toast.js`**，node 叫得到）：

- `macroUrl({ port, name, msg })` → `http://127.0.0.1:<port>/line?name=…&msg=…`（`URLSearchParams`；**`msg` 一律帶，沒有就是空字串** —— 巨集的區域變數會留著上一次的值）
- 這一台的設定：`readLineMacro(storage)`／`saveLineMacro(prefs, storage)` → `{ on: false, port: 8080 }` 預設；讀不到（無痕、擋掉）就是預設；port 只收 1–65535 的整數
- `openLineChat({ name, msg = '', notify, deps })`：
  1. 沒有 `name` → `notify('還沒填 LINE 名字：…去哪裡填')`，什麼都不開
  2. 這一台沒開 → **退路**：複製（有 `msg` 複製訊息、沒有複製名字）＋打開 `https://line.me/R/nv/chat`，講一句（有訊息：「訊息已複製；在 LINE 搜尋『王小明』再貼上」；沒有：「已複製『王小明』，到 LINE 搜尋貼上」）
  3. 開著 → `fetch(macroUrl(…), { mode: 'no-cors', cache: 'no-store', signal: 逾時 })`；resolve 就交給巨集（不再開別的）；reject／逾時 → 退路，句子前面多「叫不到 MacroDroid（它要開著，Chrome 要允許「區域網路」）」
  - **有 `msg` 時先複製再叫**（備份：巨集貼不上她還能自己貼）。剪貼簿與開新視窗要在她按下去的那一刻做得到 —— 退路裡的 `window.open` 排在 `await fetch` 之後可能被擋，實作時量一次、擋了就換寫法並記下來
  - `deps`（`fetch`、`clipboard`、`open`、`storage`）可注入，單元測試走整條路
- **不按送出**：app 這側什麼都不送，但模組註解寫清楚巨集那一側也不准加「送出」那一步（同名好友會送錯人）

設定頁一段「打開 LINE 對話」（跟「外觀」一樣記在這一台、`tip()` 講一句）：
- 勾「這台手機裝了 MacroDroid」、連接埠（預設 8080，`type="number"` 的 `min`/`step` 照 CLAUDE.md 那一列）
- 「試一次」：一格打一位好友的 LINE 名字 → 送 `msg` 一段**兩行**的測試字（「這是暴富日常的測試訊息／第二行：換行有沒有留著」）—— 一次驗三件事：叫得到、中文、換行
- 那一段的 `tip()` 講去哪裡看手機上的設定（`docs/MacroDroid設定.md`，05 寫）

### 過目補的（10/19）

- **逾時不可以接著開 LINE**：Chrome 第一次叫本機位址時，fetch 會停在「允許存取區域網路」那個框上等她。逾時一到就開 LINE 的話，LINE 蓋在框上面，她按不到「允許」。
  所以分兩種：**reject**（伺服器沒開、被拒、權限被擋）→ 退路；**逾時**（長一點，例如 15 秒）→ 只講一句「MacroDroid 沒回應：觸發條件的 Send Response 有勾嗎？」，不開 LINE
- **`no-cors` 的 resolve 不代表巨集跑了**：手機上任何伺服器回應都算（path 打錯也算）。這是做不到的，交給「試一次」與文件；判準不寫「resolve＝巨集跑了」
- **退路裡先開再複製**：iPad Safari 的 `await clipboard.writeText()` 之後才 `window.open()` 可能被擋 → 退路先 `open` 再 `writeText`（不 await 擋住 open）；`open` 回 `null`（被擋）時句子照講、不假裝開了
- **剪貼簿的備份**：情況 b 先複製訊息。巨集的「貼上」若是走剪貼簿，第 5 步貼名字就會蓋掉那份備份 —— 文件（05）要她勾「直接設定文字」，這裡照做
- **網址長度**：訊息走網址參數，幾百字的中文編碼後好幾 KB。「試一次」的測試字要跟真的一樣長（三段、兩三百字），一次驗收得下
- **「試一次」**：名字那一格空著 → 講「先打一位好友的 LINE 名字」（不是「去編輯客戶」）；開關沒開 → 講「先勾上面那一格」，不走退路（不然什麼都沒驗到）
- **掃原始碼的測試看不到新資料夾**：`no-dev-words.test.js`（FILES 只有 `ui/views`、`ui/components` 與三支 domain）與 `ui-copy.test.js`（只掃 `public/js/ui`）—— `integrations/lineMacro.js` 裡的 toast 是她看得到的字，**兩支都加進去**
- `sw.js` 的 `VERSION` 換 `v197`（develop 上是 v196，沒有開著的 PR 用過）；`related.js` 要登記新檔與新的 E2E spec（`75-line-macro.spec.js`），08-ux-audit 的前綴蓋不到 `integrations/`
- 設定頁不可以有常駐說明（`fewer-words` 的 settings 一條都沒有）→ 一律 `tip()`；`f.number` 沒有 `max`，上限由 `lineMacro` 驗
- **E2E 的 8080 是模擬器的 Firestore**（`firebase.json`、`data/firebase.js:39`）：攔 `127.0.0.1:8080/**` 會把 app 的連線一起攔掉，沒攔又會打到模擬器回 404（看起來像成功）。
  E2E 先把這一台的設定寫成別的 port（`addInitScript` 寫 `localStorage`，例如 18080），只攔那一個 port；退路開的新分頁用 `context.route('https://line.me/**')` 擋掉（不然 CI 真的連出去）；剪貼簿照 74 N9 `grantPermissions`

## 判準

- `macroUrl({ port: 8080, name: '王小明', msg: '' })` 帶著 `msg=`；兩行的訊息 `\n` 編成 `%0A`、中文原樣解得回來
- 開關沒開時**一次 fetch 都不發**（iPad 上不會跳「區域網路」的權限）
- fetch reject 時走退路、講「叫不到」；resolve 時不開 `line.me`
- `localStorage` 丟例外時頁面照樣畫、當成沒開
- 新檔在 `sw.js` 的 `SHELL`、`related.js` 有登記，`npm test` 綠

## 做完時留下的

（做完寫）
