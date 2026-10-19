# 客戶詳情點 LINE → 打開他的對話（巨集停在第 9 步）

Status: todo
Blocked by: 01、02
動工前先讀：`ui/views/customerDetail.js` 的 `wireNotes()`（委派掛在 `[data-notesblock]`，電話那一顆的寫法）；01、02 的「做完時留下的」；E2E `74` 的 N1；
CLAUDE.md「共用元件身上的屬性名字」「一顆小圖示按鈕的觸控區」兩列

## 她要的

> a 在客戶詳情那邊點她的line，執行到第九步就好

## 為什麼會這樣

01 之後那一格是名字、那一顆是 `<button data-notes-line>`；這一支把它接到 `openLineChat({ name, msg: '' })`。

## 要做的

- `wireNotes()` 的委派多一支：`[data-notes-line]` → `openLineChat({ name: ctx.customer.lineId, msg: '', notify: toast.info })`（`wireNotes(ctx)` 手上只有 `ctx`，電話那一支也是 `ctx.customer`）
- E2E 的 port 不是 8080（那是模擬器的 Firestore，見 02 的「過目補的」）
- 長按那一顆不做事（電話的長按是複製，LINE 不用 —— 名字就印在編輯表單裡）
- 「調整順序」模式下那一顆不在（`reorderHtml()` 畫的是另一種列），不用管

## 判準

- E2E：開著這一台的設定、攔 `http://127.0.0.1:8080/**` → 點 LINE 那一顆，送出去的是 `name=王小明`、`msg=`（**有那個鍵、值是空的**）
- 沒開時：不發那個請求、`line.me/R/nv/chat` 開了、toast 講「已複製『王小明』」
- 攔的那一頭 abort → toast 講「叫不到 MacroDroid」

## 做完時留下的

（做完寫）
