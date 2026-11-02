# 06：日曆新增與來訪編輯器

Status: todo
Blocked by: 04, 05

## 動工前先讀

- `CLAUDE.md` 連動表「一筆來訪改得動的地方」「新增一個會建立時段的入口」「n返（三返、四返…）的形狀」
- `public/js/ui/views/visitEditor.js`：`giftOf`（251）、那一排（577-760）、`readDraft()`（990-1030）、`readNthSlot()`（1199-）、`blankSlot()`
- E2E `13-nth-followup`、`67-gift-and-trial`

## 她要的

> 我只希望我可以拍照或是自己新增來訪的時候可以直接新增二/n返，然後一樣祭悼行事曆以及試算表，一樣可以選醫生，一樣會出現耀勝等等或是寫紀錄的待辦

## 為什麼會這樣

來訪編輯器的 n返 走 `readNthSlot()`：課程從選的那一次健檢借（沒選就沿用原本那一個）、返數 3～10。
沒畫出來的段走 `key()` 的退路，要認得出那一段原本是哪一種（`readDraft()` 1000-1002）。

## 現在會怎麼壞（過目 M8，主控沒逐行再對 —— 動工時照 ripple-check 自己確認）

- 帶標記的**二返**：`entRow` 的 value（`visitEditor.js:691`）是 `slot.entitlementId`＝null → hidden input `__null__` → 走一般那一條；
  `coursesForEntitlement(null)` 回空（`visits.js:1373`）→ courseId 被清成 null（`visitEditor.js:1028-1031`）→ 存檔擋「要選一個課程」
- 帶標記的**三返**：`isNthSlot()` 是 true（`slotCard` 的 `:577`、`:589`、`:607`、`:634`；`entRow` `:691`）→ 畫出「這是哪一次健檢的」、3～10、提示句「二返…在上面那一排選它的額度」（`:781-806`）
- 換成別的一顆時三個出口都是 `...slot` 原封帶過去、**不會清掉標記**：一般那一條 `:1082-1120`、`readFreeSlot()` `:1184-1190`、`readNthSlot()` `:1223-1239`

## 要做的

- 那一排的那一顆從 05 的 `notMineOption()` 來（編輯器自己組那一排，`visitEditor.js:692-714`）
- 按了那一顆：「第幾返」那一排（**二返～十返、用不同於 `s${i}-nth` 的欄位名、不預選**，換掉「二返…在上面那一排選它的額度」那一句）、醫師（`doctorChoicesFor()`，`preselect` 照新的一段的規則）、時長、診間；
  **沒有**「這是哪一次健檢的」那一排（過目 S8：現有的那一排是 3～10，`s${i}-nth` 讀回來走 `readNthSlot()` → `followupNth: 2` → 被 `visits.js:1749-1752` 擋）
- 新開一支 `readNotMineSlot()`，走 02 的 `slotFromPicks()`（跟 `readFreeSlot()` 同一種寫法）；`readDraft()` 的三個出口換成別的一顆時把 `examNotMine`（解構拿掉）與 `followupNth` 清乾淨；
  那一排沒畫出來時（`key()` 的退路，`:1000-1002`）認得出帶標記的段
- 既有的一段改成帶標記、或從帶標記改回一般：原地改（跟扣法換成體驗一樣不取消、不重排），存檔前那一道走 04 的那一支（過目 M7）
- 讀取卡片、日／週那一列、月曆那一格的名字：照 `slotName()`（二返那一段 `二返(30)`、三返照快照），確認畫得對
- E2E 一支新的（登記進 `tests-e2e/related.js`）：沒有任何健檢與額度的客人 → 日曆新增 → 點開收合 → 健檢不是我排的 → 三返 → 選醫師 → 存 → 日曆上看得到、待辦長出掛號那一族（客人說可以之後）

## 判準

- 一般的 n返（有健檢的客人）照舊要選健檢、照舊預選返數嗎？
- 換掉那一顆之後，存進去的段還帶著 `examNotMine` 或 `followupNth` 嗎？（不可以 —— `followupNth` 當初就是這個坑）
- 沒有額度的客人那一排長怎樣（收合開著還是收著）跟她的答案一樣嗎？

## 做完時留下的

（做完的人寫）
