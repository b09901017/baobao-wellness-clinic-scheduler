# 客戶詳情的備註那一段：電話、LINE、長備註、短備註一起排順序；長備註點開是中間那張卡

Status: todo
Blocked by: 13（她看過原型）
段：七（high）
動工前先讀：13 的「做完時留下的」與她對原型的回覆；`domain/customerMarks.js` 整支（`readMarks()`、`validateMarks()`、`toCustomerFields()`、`marksToText()`；`customer.notes` 是 `marks` 的純文字鏡像，ADR-0019）；
**讀 `customer.marks` 的 21 處**（`grep -rn "\.marks\b" public/js`：壓表卡片牆、客戶清單卡片、試算表、拍訂購單的「尾款」、合併檔匯入、確認框…）；`ui/components/marks.js`、`ui/views/customerDetail.js` 的備註那一段與 `openMarks()`；
`data/customers.js` 的 `update()`；`domain/audit.js` 的 `FIELD_LABELS`／`QUIET_IN_SENTENCE`；`domain/identify.js`（病歷號從備註讀，`CHART_NO_PREFIX`）；
CLAUDE.md「客戶身上的標記」「共用元件身上的屬性名字」「一顆小圖示按鈕的觸控區」「蓋住整頁的一層」「`tokens.css` 加一個顏色」幾列；ADR-0019、ADR-0067

## 她要的

（見 13 的「她要的」，四段原話都適用；她對原型的回覆貼在這裡）

## 為什麼會這樣

備註是 `customer.marks`：`{ text, color }` 的陣列，一則最多 40 字（`MAX_MARK_LENGTH`）、最多 12 則（`MAX_MARKS`）—— 設計成「掃一眼就懂的短標記」（ADR-0019），
長的只能拆成好幾則（圖 3；10/18 切換前的檢查也真的抓到一則 51 字的）。電話與 LINE 是客戶身上另兩格（`phone`、`lineId`），**客戶詳情上一個地方都沒畫**（只有編輯表單裡有）。
沒有排序：要換順序只能刪掉重打。

## 要做的（形狀是建議，13 之後可以改；改了寫回這裡）

- **長備註是備註的長版本**，不是第四種東西（ADR-0067 擋的就是「綁客戶的東西第四種」）：一則 = 標題＋一大塊字（上限照備忘錄的 `MAX_TITLE`／`MAX_BODY` 那一級）。**存在客戶身上**（例如 `longNotes: [{ id, title, body }]`）——
  備份、稽核、刪客戶、改名全部自動跟著，不用新開集合、不用開 Rules 的洞
- **`marks` 一個字都不改形狀**：21 處讀它的地方照舊只看到短備註，`customer.notes` 鏡像照舊只有短備註（**長備註不進試算表、不上壓表卡片牆**）
- **順序另外存一份**（例如 `noteOrder`：`['phone', 'mark', 'long:<id>', 'mark', 'line']` 這種「第幾個位置放哪一種」）：
  短備註在 `noteOrder` 裡只佔位置（第 n 個 `'mark'` = **`readMarks(customer)` 回來的第 n 則**，不是原始的 `customer.marks[n]` —— `readMarks()` 會丟掉空的、沒有 `marks` 時退回 `notes` 一行一則，`customerMarks.js:69-79`，過目查到），
  所以**別的入口加了一則短備註**不會壞：過目查過其他寫 `marks` 的只會接在最後（拍訂購單的「尾款」，`orderForm.js:543`）或原地改字（資料健檢的病歷號，`health.js:871`）—— 沒有位置的接在最後；
  順序裡指到不存在的東西就跳過。**讀這一串只有一支 domain**（例如 `customerMarks.js` 的 `noteItems(customer)` → `[{ kind: 'phone'|'line'|'long'|'mark', … }]`），畫面不自己拼
- 電話、LINE **只是位置**：值照舊是 `customer.phone`／`customer.lineId`（編輯在客戶的編輯表單），沒填就不畫、不佔位
- **電話**：`tel:` 連結；長按複製（`navigator.clipboard`，失敗講一句）
- **LINE**：標題寫「LINE」；點了開他的 LINE —— 那一格存的是**網址**（`line.me/…`，加好友那一頁「複製連結」來的）就直接開；是 **LINE ID** 就開 `https://line.me/R/ti/p/~<ID>`（對方要開放 ID 搜尋才找得到，打不開時 LINE 自己會講）。
  客戶編輯表單那一格的 `hint` 講一句「貼他的 LINE 連結最穩」（`form.js` 的 `hint` 參數，不手寫 `field__hint`）
- **長備註在那一串裡**：一顆看得出「點開有全文」的（照原型）；點了 → **畫面中間那張卡**（照原型的動畫；`prefers-reduced-motion` 時不飛）；那張卡可以捲、可以關（返回鍵也關 —— 推一層，`pushLayer()` 的 handle 存成變數、問 `.active`，CLAUDE.md 那一列）、可以進編輯
- **編輯器**：`openMarks()` 那一張擴成整串的編輯器：加短備註（照舊）、加長備註（標題＋內文）、刪；**「調整順序」**：按了每一則出現把手、拖曳排（pointer events，手機與 iPad 都要；拖的時候不可以帶動抽屜本身的拖曳）；完成才存，一次存 `marks`、`longNotes`、`noteOrder`（同一個 commit）
- 驗證：短備註照舊 40 字／12 則；長備註標題必填、內文上限；`validate` 在 domain
- **`firestore.rules`**：客戶文件那一段照既有的型別檢查寫法（過目指 `firestore.rules:69` 那一種）補 `longNotes`（list）、`noteOrder`（list）；Rules 測試補一條（`npm run test:rules`）
- 客戶詳情那一段抬頭的數字（`section__n` 現在數短備註）要不要把長備註算進去 —— 照原型；空狀態那一句「還沒有備註…」在 `tests/fewer-words.test.js` 的 `KEEP` 裡，改字要一起改那一條
- 稽核：`FIELD_LABELS` 補「長備註」「備註的順序」（後者進 `QUIET_IN_SENTENCE`？—— 她拖過一次順序，稽核那一句講「調了備註的順序」比較誠實，這一段決定）
- 共用元件的屬性用自己的前綴（`data-notes-*`），不要裸的 `data-open`
- 文件：ADR **0156**（長備註是備註的長版本；備註那一段一起排順序；為什麼 `marks` 不改形狀）、`CONTEXT.md` 新增「長備註」（_Avoid_：筆記、便條）、「備註」那一條補一句、SPEC 客戶詳情那一節、CLAUDE.md 新一列（「備註那一段的順序」：只有一支在讀、`marks` 不改形狀的理由、21 處）

## 判準

- **這一行會不會讓一則長備註被算成短備註，或反過來？** 壓表卡片牆、客戶清單卡片、試算表、`customer.notes` 鏡像：加了長備註之後一個字都不變（各一個測試）
- 拖：把電話拖到最後、一則短備註拖到最前 → 存 → 重新整理 → 順序照她排的；再從拍訂購單加一則「尾款」短備註 → 它出現在最後、原本的順序不亂
- 刪掉一則短備註（第 2 則）→ 其餘的位置照舊（不是全部往前錯一格錯到別種東西的位置上）
- 長備註點開：中間那張卡出現、全文看得到、按返回鍵關掉而不是離開客戶詳情
- LINE：存網址 → `href` 是那個網址；存 `abc123` → `href` 是 `https://line.me/R/ti/p/~abc123`；沒填 → 那一列不畫
- 沒有長備註、沒排過順序的舊客戶：那一段長得跟現在一樣（只多了電話／LINE 那一兩列，有填才有）

## 做完時留下的

（做完寫）
