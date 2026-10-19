# 「跟客人確認時間」「問這輪的時間」的訊息框旁多一顆「打開 LINE」（巨集做到第 11 步）

Status: todo
Blocked by: 02
動工前先讀：`ui/components/message.js` 整支（`box()`、`wire()`、`copy()`）；`ui/views/home.js` 的 `confirmCard()`（`message.box` 在 2971 附近，`customer` 參數）與 `askCard()`（2727 附近，`byId[row.customerId]`）、兩處 `message.wire(el, toast.info)`；
`message.box` 的其他呼叫端（`formInbox.js`、`backfill.js`、`customerDetail.js`）**不加**；CLAUDE.md「共用元件身上的屬性名字」「要貼給客戶的那幾句話」兩列

## 她要的

> b 在跟客人確認時間那邊，第一我希望可以先幫我在複製line確認訊息的按鈕旁，加一個可以直接打開她的line，這邊就是執行到第11步，把訊息也貼上去

> 3. 加，照你的建議（「問這輪的時間」那張卡也加）
> 4. 照你的建議（還沒填 LINE 名字：按鈕照樣畫，按了講去哪裡填）

## 為什麼會這樣

兩張卡都是一位客戶一張、底下一則可以改的訊息（`message.box`，`collapsed: true`）＋「複製」那一顆。訊息框是共用元件，所以「打開 LINE」那一顆長在元件裡、由呼叫端決定要不要。

## 要做的

- `box()` 多一個選填的 `line`（例如 `{ name }`；**有給才畫**那一顆，`name` 可以是空的 —— 空的照樣畫、按了講還沒填）。屬性用元件自己的前綴（`data-msg-line="<id>"`），名字不放進屬性也可以（從呼叫端給的對照表拿），擇一、寫清楚
- `wire()` 接那一顆：讀**那一格現在的字**（`textarea.value`，她改過的）→ `openLineChat({ name, msg, notify })`
- `confirmCard()` 傳 `line: { name: customer?.lineId }`；`askCard()` 傳 `line: { name: customer?.lineId }`（只在已經有連結、畫了訊息框的時候 —— 還沒產生連結時那一則還不存在）
- 兩顆並排在同一個 `<p>`，中間留間距（CLAUDE.md 觸控區那一列：兩顆並排中間至少 16px 的那條是給 44px 小圖示的；這裡是兩顆一般按鈕，照 `.btn` 既有的間距）

### 過目補的（10/19）

- **間距**：`.btn` 沒有 margin，`.msg-box` 與 `.msg-box p` 一條 CSS 都沒有 —— 兩顆擺在同一個 `<p>` 只隔一個空白（約 4px）。用既有的 `.form__actions`（flex、`gap: var(--space-2)`、`flex-wrap`）包那兩顆
- **確認時間那一頁客戶讀不到時**（`renderConfirm()` 的 `customersData.list().catch(() => [])`，home.js:2887）`customer` 是 null —— 那時講「還沒填 LINE 名字」是假話。**`customer` 是 null 就不畫那一顆**（她選的「照樣畫」講的是讀得到客戶、只是沒填的那一位）
- 開抽屜會整頁重畫（textarea 改過的字會不見，舊行為）—— E2E「改一個字 → 直接按打開 LINE」中間不開抽屜
- 「不加」的呼叫端還有 `report.js:112`

## 判準

- E2E：確認時間那張卡 → 展開訊息 → **改一個字** → 按「打開 LINE」→ 攔到的 `msg` 是改過的那一段（含換行），`name` 是那位的 LINE 名字；剪貼簿裡也是那一段
- 問這輪的時間那張卡（已產生連結）同樣一條
- 還沒填 LINE 名字的那位：那一顆在、按了 toast 講「還沒填 LINE 名字」、沒有發請求
- 表單收件匣、補登、客戶詳情的邀約訊息框**沒有**那一顆

## 做完時留下的

（做完寫）
