# 09：拍 Abovee（確認層的畫法與 E2E）

Status: done
Blocked by: 08

## 動工前先讀

- issue 08 的「做完時留下的」
- `public/js/ui/components/aboveeConfirm.js` 那一列的畫法（559-683）、`optionsFor()`（759）、`nthRows()`（775-792）
- E2E `41`、`51`、`65`、`68`（尤其假的模型回應怎麼放：`tests-e2e/fixtures/ai/`）

## 她要的

（同 08）

## 為什麼會這樣

`aboveeConfirm.js:588-590` 在照片是 n返、那一排沒有 n返 時講「選別的，或先去約健檢」；`nthRows()` 畫 3～10 與「接哪一次健檢」；
副字 `o.isNth || o.isGift ? '不扣次數' : 剩 …`（`:583`）。

## 要做的

- 那一列按著「健檢不是我排的」時：「第幾返」2～10（照片上的先按好）、醫師、時長、診間；**沒有**「接哪一次健檢」
- `:588-590` 那一句換成 08 的那一句（字在 domain）
- 副字認新的旗標（05 一起做了就確認）
- 紅字（04 的 `mustSee`）在收著的列底下也看得到
- E2E 一支新的（登記進 `tests-e2e/related.js`）：一位沒有健檢、沒有額度的客人，照片上一列三返、一列二返 →
  兩列都不預設打勾、講那一句 → 按那一顆 → 選醫師 → 勾 → 記錄 → 日曆上兩段、沒有扣任何額度；再拍一次同一張 →「已經記了」
- 跑既有的 `41`、`51`、`65`、`68`（只跑這幾支，不跑全量）

## 判準

- 一般的照片（有健檢、有額度）那幾列的畫面一個字都沒變嗎？
- 畫面上按那一顆與讀照片的預選，存出來的段一樣嗎？

## 做完時留下的

- `aboveeConfirm.js`：
  - `optionsFor()`：拿掉 05 暫時加的 `.filter((o) => !o.isNotMine)` —— 那一顆照 `slotOptionsFor()` 收在「送的／體驗／其他…」的「其他 ▸」裡；
    `giftFold.html({ value })` 傳的是 `optionValueOf()`（`NOT_MINE_PICK`），所以按著它重畫時「其他 ▸」那一層照樣開著（05 做好的，沒另外開）
  - **`notMineNthRow(item)`**：那一列按著它（`item.notMine`）時畫「第幾返」二返～十返（`SECOND`～`MAX_NTH`）、屬性 **`data-abl-nmnth`**（不是 n返 的 `data-abl-nth`）、
    照片上的字已經按好（08 的 `pickOption()`）、說明收在 `?`；**沒有「接哪一次健檢」**（`detailHtml()` 先問 `item.notMine`，排在 `isNth` 前面）
  - 點 `data-abl-nmnth` → `set({ ...item, nth })`（只換返數）
  - 原本 588-590 那一句（「照片上是 n返…選別的，或先去約健檢」）拿掉：08 之後那一列不再預選 n返，那一句搬進 domain（`newRowSay()` 的 `notMineHint`），
    畫在列的上面那一行（收著也看得到，`rowHtml()` 本來就畫 `newRowSay()`）
  - 副字「不扣次數」05 做了；醫師、時長、診間那幾排照 `built.course`（`slotFromPicks()` 在返數還沒選時照樣交回課程）畫，沒改
  - 紅字（04 的 `mustSee`）：收著的列底下走既有的 `briefWarnings(must)`、點開走 `warnings`，沒改（04 的 `aboveeConsequences()` 單元測試＋ 08 的計畫測試量過；
    E2E 這一支的客人沒有額度、沒有健檢，量的是「一句都不跳」）
- E2E **`85-exam-not-mine-abovee`**（新的，登記進 `related.js`；假抄字 `tests-e2e/fixtures/ai/aboveeList-not-mine.json`）：
  Y1 有一筆三選一、沒有健檢沒有二返額度的客人，照片一列三返、一列二返 → 兩列在「要你看」、沒勾、講那一句、「記錄」按不下去 →
  點開一顆都沒按 →「送的／體驗／其他…」→「其他 ▸」（點開之前看不到那一顆）→ 按它：第幾返照照片（三返／二返）、不是 n返 那一排、沒有接哪一次健檢、那一句消失 →
  選醫師 → 勾 → 記錄：確認框講「三返／二返的健檢不是你排的」→ 存進去的形狀（標記、返數、沒有額度、沒有連結、醫師）、三選一一次都沒扣 → 日曆那一天印三返 →
  再拍一次同一張：兩列「已經記了」、記錄按不下去、來訪還是兩筆
- 畫面自己截圖看過（收著兩列的那一句；點開按著之後的那幾排）
- 跑了 `41`、`51`、`65`、`68`、`85`：28 passed（2.4 分）
- `public/sw.js` v216 → v217、`npm run shell:snapshot`
