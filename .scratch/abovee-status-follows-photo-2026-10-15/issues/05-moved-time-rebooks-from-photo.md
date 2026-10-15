# Abovee 上改了時間：照片為準，直接幫她改期

Status: done
Blocked by: 01（狀態對照）、03（`withExtraSlot()` 與整筆狀態推導 —— `rebookSlot()` 走它）、04（改狀態那一支的形狀，改期照同一個形狀、`freed`）
動工前先讀：`spec.md`「Abovee 改了時間」；ADR-0108（改期＝取消＋重新排）、ADR-0129（app 有、這次照片上沒有；`photoSpan()`）、ADR-0123 第 10 段（`flagMoved()` 為什麼不替她做，`docs/adr/0123-…:93-104`）；
`domain/aboveeImport.js` 的 `flagMoved()`、`movedSlot()`、`timesOf()`、`photoSpan()`、`absentFromPhoto()`、`newRowSay()`（`movedFrom` 那一句）；
`domain/visits.js` 的 `rebookSlot()`（`:400-411`）、`withExtraSlot()`、`acceptsMoreSlots()`、`validateVisit()`、`warningDetails()`；`domain/aboveeImport.js` 的 `boundsOf()`（`:1283`）、`within()`（`:1313`）、`absentFromPhoto()`（`:1336`，`:1355` 已經認 `movedFrom`）、
`planAbovee()`（`:1477`）、`examChoices()`（`:303`）、`linkBatchExams()`／`secondEntOf()`（`:692-695`）、`visitsForCheck()`；`domain/consequences.js` 的 `rebookConsequences()`（寫死待確認，拍 Abovee 不用它）；`docs/agents/lessons.md` 二、四

## 她要的

> 我覺得可以這輪做 ? 然後就不用產生取消和重排的待辦 ? 對吧我都在abovee改好了，不用再叫我去取消和重排啊?合理吧 ?

## 為什麼會這樣

`flagMoved()`（`aboveeImport.js:986`）認得出這種形狀：app 上那一天、同一門課（器材對得上、返數一樣）還活著的一段，它的時間照片上沒有；照片上同一位同一天多一個新時間。
現在只把新的那一列標 `movedFrom`、不預設勾、叫她去日曆改 —— 「改期在 app 裡是取消＋重新排（ADR-0108），會動待辦，這一層不替她做」。

## 要做的

1. 拿得準的那一對 → 照片為準改期：
   - **剛好一對**：那一天這門課只有一段舊的對不到、照片上只有一列新的對不到（一個以上 → 照舊）
   - 舊時間**落在這張照片的範圍裡** —— **跟「app 有、這次照片上沒有」用同一支範圍函式**：把 `absentFromPhoto()` 裡算範圍那一段（`boundsOf()`、`within()`，含「只有一位就放寬到整個月」那一條）收成一支匯出、兩邊共用，不在這裡另算一次
   - 舊的那一段還開著（`acceptsMoreSlots()`；已完成、未到、已取消的不搬）
   - 照片上新的那一列不是已取消（已取消的不叫改期）
2. `rebookSlot(before, index, next, { status })` 多收一個狀態，**預設 `INITIAL_STATUS`**（日曆那條路一個字都不變；現在寫死在 `visits.js:410`）。新的一段的時間、結束時間、治療師、診間照片（換了診間清 `bed`，同 `adoptAbovee()`）；
   **狀態照 01 的對照**（照片寫完成而且今天或過去 → 已完成，閘門同 04；過去的日子寫成待確認的照 03 的規則不預設勾）；額度、器材、品項、接哪一次健檢照舊那一段（換了就不是改期了）。
   它接著走 `withExtraSlot()`，所以整筆狀態吃 03 的推導
3. **改期那一列不可以再被當成新的一段記一次**：那一列的 kind 還是 `new` 的話，一勾起來 `planAbovee()`（`:1477`）就多加一段、舊的那一段沒取消 → 多扣一次，二返還會被「一次健檢只接一場」擋下來。
   同樣要排除的：`examChoices(…, items)`（`:303`）、`linkBatchExams()`／`secondEntOf()`（`:692-695`）、`visitsForCheck()`
4. 改期之後的那一天照樣過 `validateVisit()` 與 `warningDetails()`（新時間撞診間、撞治療師、跟同一天別段重疊）；有錯誤就不改、講出來
5. 舊時間那一段：回在 `freed`（02，「取消 Abovee」一出生就勾好）；Examine／耀聖掛過的照長取消（spec「我自己定」那一條）
6. 新的那一段：照平常的流程長待辦（待確認的話等客人確認）
7. 那一列在確認層算「要改的」（07 畫），預設打勾（讀不到全部來訪的不勾）。改期那一列**繼續帶著 `movedFrom`**，`absentFromPhoto()`（`:1355`）就不會再列舊時間 —— 換成別的欄位的話這一行要跟著改
8. 拿不準的照舊（`movedFrom`、不預設勾、去日曆）—— 句子不變
9. **不同天的改期不在這一輪**（`flagMoved()` 只看同一天）：舊的那一段留在「app 有、這次照片上沒有」、新的那一列照新列的規則、兩段都佔次數 —— 09 寫進常見問題

## 判準

- app 10:00 SIS(60) 已確認、照片上同一天 11:00 SIS 60 確認前往、照片範圍蓋得到 10:00：10:00 那一段已取消（`freed` 有它）、11:00 一段待確認、**`counts()` 前後一樣**
- 同上，照片 11:00 寫課程完成（過去）：11:00 已完成、次數一樣
- 同上，照片 11:00 寫客戶失約（過去）：11:00 未到、**還 1 次**
- 改期那一列勾著：`planAbovee()` 不會再多組一段新的；`examChoices()` 不把它算成另一場
- 新時間撞到同一間診間的另一位：不改、講出來
- 照片從 10:30 開始拍（10:00 不在範圍裡）：照舊不預設勾、講去日曆
- 那一天同一門課 app 有兩段對不到、照片上一列新的：照舊
- 舊的那一段已完成：不搬
- 舊時間的那一段在 Examine 掛過：多一張**沒勾**的「取消 Examine」
- 改期之後「app 有、這次照片上沒有」那一塊不再列 10:00 那一段
- 日曆上的改期（`rebookSlot()` 不帶狀態）：新段照舊是待確認（既有測試全綠）
- 同一張照片再拍一次：11:00 是已經記了，什麼都不改

## 做完時留下的（10/15 段三）

**做成的樣子**：

- `visits.js` 的 `rebookSlot(before, index, next, { status, at })`：`status` 沒給就是待確認（日曆那條路一個字都不變）；給了已完成／未到，`attended` 照 `closeVisit()` 的形狀一起寫
- `aboveeImport.js`
  - **範圍一支**：`photoBounds(transcripts, items)`（export）→ `{ customerId, ranges, why }`。`absentFromPhoto()` 改走它；改期用同一份（`inPhoto()`）
  - `flagMoved(items, ctx, bounds)`：先找每一列對得到 app 上哪幾段（`movedSlots()`：同一天、還活著、同一門課、照片上沒有那個時間），
    **拿得準**＝這一列有開始時間、只對得到一段、那一段也只被這一列對到、那一段還開著（`acceptsMoreSlots()`）、舊的時間在照片範圍裡。
    拿得準 → `asRecorded()`（**kind 是 `recorded`**，所以 `planAbovee()`／`linkBatchExams()`／`examChoices()` 都不會再當成新的一段）＋
    `move: { slot: 新的那幾格, status: photoSlotStatus() }`、`adoptMove`（預設勾：照片狀態那一張表 `photoWantsChecked()`、讀得到全部來訪、新的時間 app 上沒取消過）、
    `existing`（她看到的舊那一段：visitId／date／slotIndex／startsAt／courseId／status）、**`movedFrom` 照留**（`absentFromPhoto()` 靠它不再列舊時間）。
    拿不準 → 照舊（新的、`movedFrom`、不勾、`newRowSay()` 那一句、去日曆）
  - `movedSlotFields()`：新的時間、**時長照舊**（照片上的結束時間常常多算了準備時間，額度沒變）、治療師／醫師照照片（認不出來的留原本的）、
    診間只比要診間的課（同 `aboveeDiffs()`，換了清 `bed`）
  - `applyPhotoMove(visit, items, { at, guard })`（export）：照 `applyPhotoStatus()` 的形狀 —— 核對她看到的（`stale`）、走 `rebookSlot()`、
    回 `freed`（舊時間那幾段，給 02）、`blocked`（二返照片寫完成、接的健檢還沒做完 → **照樣改期、新的那一段記成待確認**，同 03 的新列）
  - `checkMoves()`（`readAbovee()` 最後一步）：預設勾著的改期套上去之後驗一次 —— `validateVisit()` 的錯誤、`mustSee()` 的提醒（撞期、重疊…，只看講到新那一段的）、
    二返簽不成 → **不預設勾**，`moveWarnings`／`closeBlock` 記著。**撞期是不先勾、不是不准改**（app 裡撞期從來不擋，ADR-0094）—— 跟 issue「不改、講出來」的差別要跟她講一聲
  - `afterPhoto()` 也套改期（`gateStatusChanges()`、`blockedInGroups()` 的閘門看得到改期之後的健檢）
  - `checkCtxFor()`（export）：`validateVisit()` 要的那一份，從 `aboveeConfirm.js` 搬到 domain（畫面那一支改成一行叫它）
  - `recordedSay()` 多改期那一句：「app 上 10:00 那一段 SIS(60)，Abovee 上改到 11:00 —— 照 Abovee 改期（…取消、…接上）」，沒先勾的接理由＋「確定再勾」
  - `resolveItem()` 的重設清單、`asRecorded()` 多 `move`／`adoptMove`／`moveWarnings`

**還沒接**：寫入（`record()` 還不認 `move`）與確認框 —— 06；畫面上「要改的」那一塊 —— 07（現在那一列看起來是「已經記了」＋那一句）。

測試：`tests/abovee-moved-rebook.test.js`（18 條：判準每一條、日曆的改期不變、同一張再拍一次不改、別的裝置改過不改）。`npm test` 4621 全綠。
