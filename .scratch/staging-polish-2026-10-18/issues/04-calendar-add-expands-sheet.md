# 日曆：那一天的抽屜按「＋」先拉到全高，選單才不會被擋住

Status: done
Blocked by: —
段：一（high，先單獨一支 PR）
動工前先讀：`ui/views/calendar.js` 的 `addMenuHtml()`、`wireAddMenu()`（約 `:815-875`）與 `openDay()` 那一段（`openSheet({ … tools: addMenuHtml() })`）；
`ui/components/sheet.js` 的 `openSheet()` 回傳的 `expand`、`wireDrag()` 的 `expand()`／`detent`；E2E 用到 `addmenu` 的那幾支（`13`、`22`、`25`…，`grep -rln addmenu tests-e2e/specs`）；
CLAUDE.md「存起來的 `pushLayer()` handle」（拉到全高不是多一層，不推 history）

## 她要的

> 7. 如圖9，日曆這邊，如果我點加 那應該要自動往上滑展開 不然會遮住 ?

圖 9：那一天的抽屜停在半高（peek），按右上角「＋」，選單往下長，「新增來訪」只露出一半，底下兩顆被螢幕底部切掉。

## 為什麼會這樣

選單往下長（`addMenuHtml()` 註解：離觸發點最近的最常按）；抽屜停在 peek 時底下沒有空間。`sheet.js` 已經有 `expand()`（拉到全高那一格），只是「＋」沒接。

## 要做的

- 按「＋」打開選單時，抽屜不在全高就先 `expand()`，再打開選單（選單的位置跟著抽屜走 —— 等抽屜到位再開，或開著跟著動都行，畫面上不可以看到選單先被切掉再跳上去）
- 收起選單**不**把抽屜退回半高（她可能接著要看那一天的列）
- 抽屜已經在全高：行為一個字不變
- 不推 history（拉高不是多一層東西）

## 判準

- 390×844：打開某一天（半高）→ 按「＋」→ 三顆選項的外框都在 viewport 裡（`getBoundingClientRect()` 的 bottom ≤ 視窗高；**用 `elementFromPoint()` 確認最下面那一顆點得到**，不只量外框）
- 按「新增來訪」照舊進選人那一步
- 既有用到 `addmenu` 的 E2E 全綠

## 做完時留下的

- `sheet.js` 的 `expand(after)` 多收一個「到位之後」的 callback（已經在全高就馬上叫；`settleAt(0, after)`）。另外兩個呼叫端（`calendar.js:1424`、`:1814`）不帶參數，行為不變
- `calendar.js` 的 `wireAddMenu()`：打開時 `sheet.expand(() => setOpen(true))` —— 等抽屜停好才開選單，所以畫面上不會看到選單先被切掉；收起選單走 `setOpen(false)`、抽屜不動
- 不推 history（P4 量 `history.length` 前後一樣）
- E2E `69` 的 P4：390×844 半高 → 按「＋」→ 三顆的下緣 ≤ 844、`elementFromPoint` 點得到最下面那一顆（`event`）、抽屜上緣比半高時高；收起選單之後抽屜的位置不變。紅的時候第一顆就在 857px
- 既有用到 `addmenu` 的 E2E（`13`、`22`、`25`…）在 verify 裡全綠 —— 選單晚 ~0.3 秒才出來，Playwright 會等
