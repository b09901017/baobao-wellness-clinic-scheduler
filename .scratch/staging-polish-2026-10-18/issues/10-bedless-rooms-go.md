# 點滴8、VIP7（沒床位的那兩間）從種子刪掉

Status: todo
Blocked by: —
段：五（xhigh，跟 11 一起）
動工前先讀：`domain/seed.js` 診間那一段（`:14`、`:35-84`，`room-iv8`、`room-vip7` 與她 10/6 的原話）、`seedData()`；
`domain/abovee.js` 的 `roomByText()`（第 3、4 步：拿掉床位再比、停用的那幾間）、`roomFrom()`；`domain/masterData.js` 的 `bedRoomOf()`、`isBedlessOf()`、`roomSlots()`、`orderedRoomSlots(…, { keep })`、`roomsForCourse()`／`roomFitsCourse()`；
`domain/health.js` 的 `clearBeds`／`moveBedToRoom`、「診間清單」的 `retire`、`LEGACY_ROOMS`；`domain/visits.js` 的 `roomCapacityOf()`；
`.claude/skills/calendar-sheet-merge/scripts/merge.mjs` 的 `roomOf()`；`tests/bed-rooms.test.js`、E2E `53-bed-rooms`、`60`、`03`、`17`（寫死診間筆數）；
ADR-0127（點滴8A／8B、VIP7A／7B 四間；**點滴8 與 VIP7 留著、停用**那一段就是這一支要推翻的）；CLAUDE.md「診間的名字、簡寫或清單」那一列（「不要刪它、也不要把它從種子拿掉」那幾句要改寫）

## 她要的

> 你說「EECP體驗」那一門停用、不刪 … 包含你說的點滴8，vip7還多少，一樣，沒有舊資料的問題，刪掉之後幫我合併檔更新就好
>
> 不要在靠資料健檢處理，一開始匯入時就應該是好的，

## 為什麼會這樣

ADR-0127（10/6）：她說「沒選床位就寫 .8，VIP7 等等不要留空」，所以點滴8、VIP7 留在種子上、停用，當作「沒寫哪一床」的那一間 ——
舊來訪印診間、Abovee 那一格沒寫床、舊行事曆只寫 `.8` 都靠它。她現在說資料一律從合併檔重新匯、沒有舊資料要顧。

**查過的事實**（10/18）：她 10/17 那一份合併檔（`.local/references/cutover-2026-10-14/out-1017/import-final.json`）的診間只有 8A／8B／7A／7B，**一段都沒有沒床位的點滴8、VIP7**；
Abovee 5–10 月 353 列（`.local/references/abovee-m5-m10/擷取/abovee-m5-m10.json`）的點滴8 都寫著「點滴室8床A／B」。所以拿掉之後的退路幾乎不會被走到。

## 要做的

- 種子刪掉 `room-iv8`、`room-vip7`（不是 `active: false`）；種子上還有沒有別的停用列（`seedData()` 那一套是為了它們才有的 —— 刪完之後還需不需要，看一下，不需要就留著不動，別順手重構）
- **只寫「點滴8」「VIP7」、沒寫哪一床**（拍 Abovee、合併檔）：**診間留空**，那一列講一句「照片上寫點滴8，沒寫哪一床 —— 選一間」（拍 Abovee 的確認層本來就有「還差一步」那一種；要不要擋住看那門課要不要診間）。
  `roomByText()` **程式大概不用改**（過目查到）：第 3 步 `named(pool, bare)` 是**每一間**都靠它認（連沒寫床位的「治5」），不能拿；第 4 步「停用的那幾間」也認她自己停用的診間（舊來訪、舊照片用得到），留著。
  兩間從種子拿掉之後，「點滴8」三步都對不到 → `null` → 留空，正好是要的。**改的是註解**（`abovee.js:160-164` 那一段講點滴8、VIP7 的）與一支測試釘住「點滴8 → 留空＋那一句」
- `bedRoomOf()`／`isBedlessOf()`：呼叫端不只資料健檢 —— 過目查到 `aboveeImport.js:1307`（`aboveeDiffs()`）與 `:1687`（`movedSlotFields()`）也叫 `isBedlessOf()`。每一個呼叫端想一次「沒有沒床位的那一間之後它回什麼、那一行還需不需要」；
  資料健檢「來訪上還記著床位」那一列：既有資料庫還有點滴8 床 A 的來訪 → 搬到點滴8A，**那一間的父親沒了之後怎麼認**（照名字：`點滴8`＋`A` → `點滴8A` 那一間還在）—— 能刪就刪，刪不了寫清楚為什麼留
- 資料健檢（保險，同 09 第 8 點）：主檔上還有點滴8／VIP7 那兩間 → 一列：沒有任何來訪指著它就刪掉；有的話只列（她自己去日曆改成 A 或 B）
- `merge.mjs` 的 `roomOf()`：只寫 `.8`／`VIP7` 的 → 不給診間（留空）＋報告裡列一句（**她的合併檔現在沒有這種**，`tests/merge-*` 用假資料釘住）
- 文件：ADR **0155**（拿掉沒床位的那兩間；推翻 ADR-0127 的「留著、停用」那一段，0127 不改）、CLAUDE.md 診間那一列、SPEC 診間那一節、
  `docs/操作手冊.md`、`docs/常見問題.md`、`docs/邊界測試清單.md`、`CONTEXT.md`（`grep -rn "點滴8\b\|VIP7\b\|沒選床位" docs CONTEXT.md SPEC.md`）、`scripts/seed-staging.mjs:479` 的註解
- **測試裡寫死它們的**（過目列的）：E2E fixture 用 `roomId: 'room-iv8'` 的 `01-products`（約 `:244`）、`15-playbook`（約 `:351`）—— 換成點滴8A；`17`（約 `:262`）預期的診間數；
  `bed-rooms.test.js:74` 與 `master-data.test.js:463` 的 `SEED.rooms.length === 24`；`53-bed-rooms`、`60`、`03`

## 判準

- 種子沒有 `room-iv8`、`room-vip7`；`grep -rn "room-iv8'\|room-vip7'" public/js` 只剩資料健檢認舊資料庫那一列
- 拍 Abovee：「點滴室8床A」→ 點滴8A（照舊）；「點滴8」→ 診間空著＋那一句；「治5」→ 治5（照舊）
- 合併檔假資料：`.8A` → 點滴8A；`.8` → 沒有診間、報告多一句
- 診間那一排（`orderedRoomSlots()`）不再有停用的點滴8 冒出來
- 撞期：兩段都在點滴8A → 照 8A 的容量算（`roomCapacityOf()`，8A 沒填就是 1）
- 改種子的七個地方（記憶）：E2E 寫死的診間筆數、上面列的那幾支測試全部改成新的數字（不是刪掉那一條斷言）

## 做完時留下的

（做完寫）
