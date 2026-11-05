# 營養品「記交付」連按只記一次

Status: done
Blocked by: —
動工前先讀：`.scratch/code-health-2026-11-04/issues/04-product-delivery-double-press.md`；`public/js/ui/views/customerDetail.js`（約 `:1395`，`recordDelivery` 那一段）；
`public/js/data/notes.js` 的 `recordDelivery()`；`public/js/domain/products.js` 的 `withDelivery()`；另外三個勾隨手記的入口共用的 `ui/components/note.js` `prepareToggle()`（CLAUDE.md「營養品的形狀或交付」那一列）

## 她要的

同 01。

## 為什麼會這樣

`withSaveState()` 沒有 `key`；`withDelivery()` 拿呼叫端手上那一份額度判斷「給過了沒」，兩次手上都是舊的 → `deliveries` 多一筆一樣的、會進試算表。
「給了沒」的狀態不會錯（`deliveredIds()` 是 Set）。

## 做法

（過目 11/5 校正）`key` 只擋寫入還在飛的那幾秒；客戶詳情第二次要先過選單和兩個問框，更可能撞到的是「寫完、還沒 reload」或 toast 重試。
`ifUpdatedAt` 也擋不住：還沒回到伺服器的 serverTimestamp 讀回來是 null，`sameStamp` 放行。所以：
1. **`recordDelivery()` 寫之前重讀那一筆額度、拿重讀的那一份 `withDelivery()`**（讀回來會帶本機還沒送出的寫入）—— 四個入口一次補好
   （客戶詳情、`prepareToggle()` 那條路的首頁／泡泡／日曆；`runAction` 的 `save(plan.run, …)` 與 `calendar.js` 約 `:1041` 都沒有 key）
2. 客戶詳情那一顆另外給 `key`

## 判準

- 「記交付」連按兩下（第二下在第一下還沒寫完時）→ `deliveries` 會不會多一筆？（不可以）
- 別的入口勾掉那一則營養品提醒 → 同上
- 第一次寫完、還沒重畫就再記一次同一款 → 會不會多一筆？（不可以：重讀之後 `withDelivery()` 看得到已經給了）

測試：data 的單元（`recordDelivery()` 寫之前有讀）或掃原始碼 ＋ 一支 E2E 連按。

## 做完時留下的

- `data/notes.js` 的 `recordDelivery()`：寫之前 `repo.getOne()` 重讀那一筆額度，拿重讀的那一份 `withDelivery()`、算提醒的字（讀不到照手上那一份）—— 四個入口一次補好
- 客戶詳情「已經給了」那一顆的 `withSaveState()` 帶 `key: delivery:<額度 id>`
- **寫 E2E 時發現舊的寫法在「寫完還沒重讀」那個情境更糟**：`withDelivery()` 拿手上那一份接一筆、整份寫回 `deliveries`，
  別處（或上一下）記的那一筆**被蓋掉**、筆數剛好還是 1 —— 不是只有多一筆。E2E `89-delivery-once` 比內容（別處記的那一筆原封不動），舊程式碼上紅、修完綠
- 新單元 `tests/delivery-once.test.js`（掃原始碼）；`89` 登記在 `related.js`
- 驗證：`verify` 因為 `related.js` 改過退回整條分支（55 支），改成照 `pick()` 對這一支動到的檔案挑的 26 支直接跑（上一輪 54 支剛全綠）
- `sw.js` `v234` → `v235`

