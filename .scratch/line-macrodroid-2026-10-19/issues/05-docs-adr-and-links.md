# 文件：ADR-0157、手機上的 MacroDroid 設定、CLAUDE.md 連動表、SPEC／CONTEXT／操作手冊／常見問題

Status: done（10/19，段一）
Blocked by: 01、02、03、04
動工前先讀：CLAUDE.md「文件分工」那張表（新文件要登記）、`docs/agents/domain.md`（ADR 慣例）、ADR-0156（**不改它**，新的那一支推翻它 LINE 那一條）；
`SPEC.md` 的 `customers/{id}` 那一段（548 附近）；`CONTEXT.md` 的備註／長備註那一段（530 附近）；`docs/操作手冊.md` 的「七之一、備註與長備註」與確認時間、問這輪的時間那兩節；`docs/常見問題.md` 的格式；README 的開發狀態表

## 她要的

> 然後也要記的紀錄多了這兩個功能，之後優化其他地方的時候也要記得考慮

## 要做的

- **ADR-0157**：LINE 那一格存名字、打開對話交給手機上的 MacroDroid。寫理由不寫作法：LINE 沒有用名字打開對話的網址、不想一位一位要 ID／連結（她的原話）；為什麼走本機 HTTP Server 不走 Webhook（客戶的名字與訊息不出手機）；
  為什麼開關記在這台裝置；為什麼 `msg` 一律帶；為什麼巨集永遠不按送出；欄位代號為什麼不換。推翻 ADR-0156 的「LINE 點了開他的 LINE」那一條（0156 一個字都不改）。Gemini 不做也記一句（spec 有理由）
- **`docs/MacroDroid設定.md`**（給她照著設的）：HTTP Server Request 觸發條件（path `line`、port、**勾 Send Response**、建兩個區域變數 `name`／`msg`）、巨集一步一步（第一段的建議：第一個等待 1500ms、每一次點擊等點完並存成功與否、點不到就跳一句停下來、`msg` 空的停在第 9 步、第 11 步前先點輸入框、貼上勾「直接設定文字」、**不加送出**）、
  省電設定（電池不受限制）、Chrome 第一次問「區域網路」按允許、app 設定頁的開關與「試一次」。**截圖不放**（裡面會有好友名字）
- CLAUDE.md：「文件分工」登記 `docs/MacroDroid設定.md`；「容易漏掉的連動」補一列「客戶的 LINE 那一格、打開 LINE 對話」：存的是名字（代號照舊 `lineId`）、唯一的叫法 `integrations/lineMacro.js`、`msg` 一律帶、巨集的 path／變數名字跟文件同一份、新的入口走 `message.box({ line })` 或 `openLineChat()`、不經 Webhook
- `SPEC.md` 客戶那一段 `lineId` 註解；`CONTEXT.md` 補「LINE 名字」一條；`docs/操作手冊.md` 七之一的 LINE 那一行、確認時間與問這輪的時間各補一句；`docs/常見問題.md` 一條「按了打開 LINE 為什麼沒有跳到他的對話」（三段）
- README 開發狀態表照既有格式補一列（若那張表是大步驟才列，就不加、寫在這裡）

### 過目補的（10/19）

- **CLAUDE.md:70**（「備註那一段的順序、長備註」那一列）寫著「連結只走 `telHref()`／`lineHref()`」—— 01 之後 `lineHref()` 沒了，**那一句要改**（指到新那一列），不然指著一支刪掉的函式
- **SPEC.md §10「程式碼組織」**（1888 附近）只列 /data、/domain、/ui —— 補 /integrations（手機上別的 app 的接口；只准被 /ui 叫、不 import /ui）
- CONTEXT 的「LINE 名字」要跟課程的「LINE 名」（貼給客人那一句裡的課程名，`lineName`）分清楚
- `docs/邊界測試清單.md` 補三條：同名的好友、MacroDroid 被系統砍掉、Chrome 的「區域網路」被拒過
- 文件寫「訊息很長時先用『試一次』驗」與「貼上要勾直接設定文字」（不然第 5 步貼名字會蓋掉 app 先複製的那一份訊息）

## 判準

- 新的 session 只讀 CLAUDE.md 那一列，就知道改客戶詳情的 LINE、改訊息框、改那一格的意思時要一起看 `lineMacro.js` 與手機上的巨集
- `npm test` 綠（`no-dev-words`、`no-secrets`、文件裡沒有真名）

## 做完時留下的

- ADR-0157（`docs/adr/0157-line-field-is-the-name-macrodroid-opens-the-chat.md`），推翻 0156 的 LINE 那一條（0156 沒動）；Gemini 不做寫在「後果」
- `docs/MacroDroid設定.md`：觸發條件、兩個變數、十三步（第一個等待 1500ms、`msg` 空的停、點輸入框、貼上勾「直接設定文字」、Click Result、不送出）、省電、Chrome 的「區域網路」、試一次、沒裝的裝置
- CLAUDE.md：文件分工登記那一份；連動表新一列「客戶的 LINE 那一格、打開 LINE 對話」；第 70 行（備註那一列）「連結只走 `telHref()`／`lineHref()`」改成指到新那一列
- SPEC：`lineId` 註解、§10 分層補 `/integrations`；CONTEXT：「LINE 名字」一條（跟課程的「LINE 名」分開）
- 操作手冊：七之一 LINE 那一行、步驟 6 確認時間一段、問這輪的時間「發連結」那一列；常見問題最後一條（照跳出來的那一句分六種）；邊界測試清單 P1～P5（只能在她手機上點）
- README 開發狀態 41c
