# 新增時的確認框只講這次新加的那幾段會長什麼

Status: todo
Blocked by: 15
來源：`../spec.md`（第二輪）
動工前先讀：`domain/consequences.js` 的 `bookingConsequences()`／`pendingRegistrations()`、15 做出來的那一支「這幾段談定了會長什麼」、
呼叫端 `ui/views/schedule.js:2162`、`ui/views/visitEditor.js:1130`

## 她要的

ADR-0070：畫面上的後果只能講真的會發生的事，而且跟真的寫入共用同一段身體。

## 現在壞在哪

壓表與來訪編輯器存檔前那一道（「已經在 Abovee 壓好表了嗎？」）的「等客人說可以之後，待辦會再多一張 X」
走 `pendingRegistrations()`（`consequences.js:72`）：把**整筆**活著的段的種類全部列出來。這在 02 之前是「一天一種」的判斷，02 之後兩頭都錯：

- 往一天已經有門診（Examine 掛好了）的來訪裡加一段**復能** → 它說「會再多一張 Examine」，其實不會
- 往一天已經掛好 Examine 的來訪裡**再加一段門診** → 02 之後會長一張新的，它講得出來是碰巧

## 做法（方向）

- `bookingConsequences()` 多收「這次新加的是哪幾段」（壓表：最後一段；編輯器：`draft.slots.slice(storedSlotCount)`）與那一筆身上的任務
  （新的一筆就是空陣列；併進既有那一天時點下去才讀 `listByVisitForSync()`，讀不到就當沒有）
- 那一句改問 15 那一支（把新加的段假設成已確認去問 `newRegistrations()`）
- `pendingRegistrations()` 改完之後沒有人用 → 刪掉

## 判準

- 已掛好 Examine 的門診那一天，加一段復能 → 那一句不出現
- 同一天再加一段門診 → 「會再多一張「Examine」、一張「耀聖」」
- 全新的一天、一段門診 → 同上
- `tests/consequences.test.js` 補這三條，並且跟「存下去 → 新的那幾段確認 → 真的長了什麼」直接比
