# 拍 Abovee 只拿 180 天的來訪算「還剩幾次」

Status: done
來源：`f-abovee-180`（🔴）、`ai/report.md` 第 1 條
動工前先讀：`docs/agents/lessons.md` 第二節、`public/js/ui/components/aboveeConfirm.js:110-170`（`:122` 的 `listBetween`、`:834` 存檔前才 `listByCustomer`）、
`public/js/ui/views/schedule.js:370-380`、`:677-690`（把那一頁的來訪傳進去）、`public/js/domain/aboveeImport.js:149-190`（`readAbovee()`、`pickOption()`）、
`public/js/domain/visits.js:1789-1806`（超用提醒）、ADR-0004、0123、0132、
`CLAUDE.md` 連動表「拍 Abovee 記很多段」「次數的算法」「試算表要讀哪些來訪」
Blocked by: —
重現：`node .local/references/audit-2026-10-08/ai/r09-partial-history.mjs`

## 她要的

> ・「上線前要先修」那 18 件，要怎麼出貨？ → 全部一起修完、一起上 staging，你點一次驗收清單

報告那一張卡：

> 拍 Abovee 會預選一筆已經用完的額度，也不提醒超過總次數
>
> 客人身上有兩筆營養點滴：「護肝排毒」半年前就打完了，「腸道修復」還沒用。照片上那一列寫的是護肝排毒。確認層預設扣護肝排毒那一筆（丸子上其實印著「剩 0」），那一列預設打勾，也不講「排完會超過」。

## 為什麼會這樣

確認層算次數用的是壓表那一頁讀進來的來訪 —— 只有最近 180 天。更早做掉的看不到，就以為那一筆還有剩。
壓表那一頁自己存檔前會重讀這位客戶的全部（`schedule.js:2161`），確認層在**打開**時沒有；它要到存檔那一刻（`:834`）才讀。
預選、丸子、提醒都是打開時算的，所以她看到的與存下去的是兩份。

## 要做的

- 打開確認層時，替照片上認得的每一位客人 `visitsData.listByCustomer()`（一頁最多 20 位，一起讀），**算次數、預選、提醒都用這一份**。
- 她在某一列按「換一位」換到一位還沒讀過的客人：那一下再讀他的。
- **撞期要的是另一份**（那幾天全部客戶的來訪，`listBetween`），那一份照舊。
  最小的改法（審查建議）：不用拆成兩個 map —— 照片上認得的那幾位，把 `visitsBy[那一位]` **整份換成** `listByCustomer()` 讀回來的；
  撞期那一份本來就是把全部攤平再濾日期（`aboveeConfirm.js:157`），照舊成立。健檢候選（`aboveeImport.js:186` 的 `examChoicesFor()`）會跟著一起對。
- 把同一個形狀的地方查一次（lessons 二）：`grep` `counts(`、`validateVisit(`、`slotOptionsFor(`、`summarize(` 的每一個呼叫端，
  確認餵給它的來訪是那位客戶的全部或快取。結果（哪幾個、各拿什麼）寫進「做完時留下的」。

## 判準

- 180 天前用完的那一筆還會不會被預選？超用的那一句打開時就算得出來嗎？
- 讀不到全部（離線、失敗）時，會不會**安靜地**退回 180 天那一份照算？（不可以 —— 講一句，或那一位的列不預設打勾）
- 「已經記了」的判斷（`existingAt()`）拿到的來訪是不是變多了、有沒有因此把半年前同一個時間的段當成這一次的？（它比的是同一天，不會；確認一次）
- 20 位一起讀，打開確認層慢了多少？（模擬器上量一次，寫下來）
- 存檔前那一次重讀還在嗎？（要在 —— 打開到存檔之間別台裝置可能動過）

## 測試

- 單元：r09 改寫成 `tests/`（王小明、兩筆假品項的營養點滴，一筆 200 天前用完）：給全部來訪 → 預選沒用完的那一筆、有品項不一樣的那一句。
- 掃原始碼：`aboveeConfirm.js` 餵給 `readAbovee()` 的 `visitsBy` 來自 `listByCustomer`（不是 `listBetween` 那一份）。
- E2E（第二段共用一支新 spec，`62`，走 `fakeModel`）：假客戶 200 天前用完 A、B 還沒用 → 拍一張 → 那一列預選的是 B。

## 文件

`CLAUDE.md` 連動表補一列「算次數／驗證一律拿那位客戶的全部來訪」（誰讀、讀多少天；畫面為了快只讀一段期間的那幾頁不可以拿那一份去算）—— 23 一起寫。

## 做完時留下的（10/8）

- **兩種需求、兩份來訪**，都在 `aboveeConfirm.js` 的 `start()`：撞期與「app 有、這次照片上沒有」照舊 `listBetween()`（那幾天全部客戶）；
  算次數／預選／提醒多一支 `loadHistory(ids)` —— 照片上認得的每一位各 `listByCustomer()` 一次，**整份換掉 `visitsBy[那一位]`**（照審查建議，不拆成兩個 map）。
  認得哪幾位是 domain 的 `customersOnPhoto(transcripts, customers)`（`mergeAboveePhotos()` ＋ `identifyCustomer()`，跟翻譯同一支）。
- **「換一位」**：`pickWho(key, id)` 先 `await loadHistory([id])` 才 `resolveItem()`。讀的那一下她可能又按了別的，回來之後照 key 再找那一列。
- **讀不到全部不安靜地照算**（判準兩個都做）：`loadHistory()` 把讀不到的那一位記進 `ctx.partial`（Set）；`resolveItem()` 看到就 `partialHistory: true`、**不預設打勾**；
  那一列收著也看得到一句（`partialSay()`，`rowHtml()` 的 hint）。**離線也算讀不到** —— Firestore 開著本機快取，離線時 `getDocs` 不會失敗，回的是快取裡剛好有的那幾筆（`isOffline()`）。
  沒有做「再讀一次」的按鈕：她在那一列「換一位」再選同一位就會重讀（`whole` 裡沒有他）。`recorded`／`mismatch` 的列不講那一句（比的是同一天，那幾天另外讀了）。
- 判準逐條：180 天前用完的那一筆不再被預選（單元＋E2E `62` 的 P1，P1 在舊程式上是紅的）；超用那一句打開時就算得出來（單元）；
  `existingAt()` 比的是同一天，半年前同一個時間的段不會被當成這一次的（單元）；存檔前那一次重讀還在（`write()` 裡的 `fresh`，掃原始碼釘著）。
- **慢了多少**（模擬器、她的筆電）：20 位各 40 筆來訪一起讀 **約 1.5 秒**（同一台上 `listBetween()` 一個月 100 筆約 0.2 秒）。打開確認層多等這一段；真的 Firestore 沒量。
- **同一個形狀的地方查過一輪**（lessons 二）—— 拿不完整的來訪去算次數的**只有確認層這一處**：
  | 呼叫端 | 拿的來訪 | |
  |---|---|---|
  | `aboveeImport.js` 的 `entitlementChoices()`／`examChoices()`、`aboveeConfirm.js` 的兩個 `validateVisit()`、`slotOptionsFor()`、`examChoicesForNth()` | 以前：壓表那一頁的 180 天；現在：那一位的全部 | 這一支修的 |
  | 壓表 `courseOptions()` 的「剩 N」、`customerPools()`／`pendingFor()` 的每一個呼叫端（客戶清單、待辦中心、時段反查） | 額度上的快取欄位（`cached` 預設 true），不靠來訪 | 對 |
  | 壓表 `addSlot()` 的 `validateVisit()` | 存檔前 `listByCustomer()` | 對 |
  | 壓表 `examChoicesOf()`／`nthExamChoices()`／`nextNthFor()` | 180 天 —— **刻意的**（`schedule.js:1741` 的註解：半年前的健檢去日曆接） | 不動 |
  | 來訪編輯器、客戶詳情、批次取消、待辦中心兩張抽屜、日曆長按 | `listByCustomer()` | 對 |
  | 資料健檢 | 整份快照 | 對 |
  | 試算表 | `listForSheet()`（過去的全部，ADR-0132） | 對 |
- `r09-partial-history.mjs` **是 import 真的那一支**，但它餵的來訪是腳本自己框的 —— 修的是「確認層餵哪一份」，所以它修完照樣印那兩行。
  取代它的是 `tests/abovee-whole-history.test.js`（規則＋掃 `aboveeConfirm.js` 的原始碼）與 E2E `62` 的 P1。
- 既有的 `41`、`51` 跑過，全綠。

給 10 的：`customersOnPhoto()` 讀的是 `mergeAboveePhotos()` 回的列 —— 去重的鑰匙怎麼改它都跟著；`resolveItem()` 的回傳多一格 `partialHistory`（換人重算時會清掉）。
`ctx.partial` 是確認層記的，domain 只讀。

留給 23：`CLAUDE.md` 連動表補一列「算次數／驗證一律拿那位客戶的全部來訪」（上面那張表可以直接搬）；「拍 Abovee 記很多段」那一列補 `loadHistory()`／`customersOnPhoto()`／`partialSay()`。
