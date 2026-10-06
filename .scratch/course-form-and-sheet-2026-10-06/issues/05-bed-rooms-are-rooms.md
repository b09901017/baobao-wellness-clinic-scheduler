# 診間：補治 6、VIP1；點滴 8A／8B、VIP 7A／7B 是四間各自的診間（ADR-0127）

Status: todo
來源：她 2026-10-06 問題 8 的回答
動工前先讀：ADR-0056、ADR-0079、ADR-0094、ADR-0124、ADR-0125、`public/js/domain/seed.js` 的 `rooms`（上面那段註解）、
`public/js/domain/abovee.js` 的 `ROOM_WORDS`／`BED`／`roomByText()`／`roomFrom()`、`public/js/domain/health.js` 的 `checkRoomList()`／`checkSlotBeds()`／
`LEGACY_ROOMS`／`RETURNED_ROOMS`、`public/js/data/health.js` 的 `applyRoom` 與 `clearBeds`、`public/js/domain/masterData.js` 的 `roomSlots()`／`orderedRoomSlots()`、
`public/js/ui/views/visitEditor.js` 的 `roomField()`、`public/js/domain/visits.js` 的 `roomCapacityOf()`／`conflictWarnings()`、
`tests/abovee.test.js`、`tests/master-data.test.js`、`docs/邊界測試清單.md` 的 C11-7、
`CLAUDE.md` 連動表「診間的名字、簡寫或清單」「一筆來訪改得動的地方」兩列
Blocked by: —

## 她要的

問她「治療室 6、休息室 1 要不要補進診間？」，她回：

> 問題 8：好幫我補進去，並且
> 點滴室8床A* 點滴室8床B* 休息室7床A*休息室7床B
> 幫我算不同的診間可以記.8A .8B vip7A vip7B

## 這推翻了什麼（先翻紀錄）

- 2026-09-08 她選「取消任何床位區分」→ ADR-0079：沒有床位這一層，`roomSlots()` 一間一個選項，時段上的 `bed` 留著但不再寫
- 2026-09-16 她：「目前的確不需要床位，都寫 .8」→ ADR-0094：點滴 8 的 `capacity` 是 2，撞期算人頭
- 2026-10-06 她要 8A、8B、7A、7B **算不同的診間**

**新的決定不是把床位那一層加回來。** 是那四個本來就是四間（Abovee 的診間下拉裡沒有單獨的「點滴室 8」「休息室 7」，只有床 A、床 B）。
所以 ADR-0079「沒有床位這一層」照舊成立、`bed` 照舊不寫；ADR-0094 的 `capacity` 機制留著，只是種子上不再有一間裝得下兩位的。
補 ADR-0127，舊的兩支一個字都不改。

## 談定的做法

### 種子

- 拿掉 `room-iv8`（點滴 8）、`room-vip7`（VIP7）
- 加六間：

| id | 全名 | 簡寫 | 類型 |
|---|---|---|---|
| `room-t6` | 治6 | （無） | 治療室 |
| `room-vip1` | VIP1 | vip1 | VIP室 |
| `room-iv8a` | 點滴8A | .8A | 點滴室 |
| `room-iv8b` | 點滴8B | .8B | 點滴室 |
| `room-vip7a` | VIP7A | vip7A | VIP室 |
| `room-vip7b` | VIP7B | vip7B | VIP室 |

一共 22 間，跟 Abovee 的診間清單一樣（點滴室 9、休息室 7、治療室 6）。

種子的課程沒有一門用 id 指到點滴 8 或 VIP7（營養點滴與 ILIB 是照類型、EECP 是治 5／7／8），所以課程那一側不用動。

### 拍 Abovee 認診間（`abovee.js`）

現在 `BED` 把結尾的床位**先拿掉**再比（`點滴室8床A` → `點滴8`）。改成：

1. **先帶著床位比**：`點滴室8床A`／`點滴8A` → `點滴8A`；`休息室7床B`／`4樓休7B` → `VIP7B`
2. 對不到才拿掉床位再比一次（還沒按資料健檢、主檔上只有「點滴 8」的資料庫照舊認得）

她記在主檔上的 `aboveeNames` 照舊最優先。

### 既有資料庫（`loadSeed()` 只建不覆蓋）

資料健檢「診間清單跟建議的不一樣」（`checkRoomList()`）：

- 六間新的走既有的 `add`（種子有、她沒有；她自己已經建了同名的不再建）
- **點滴 8、VIP7 多一種 `retire`：停用，不刪**。既有來訪還指著它（正式站有真的來訪），刪掉的話那幾筆印不出診間名字。
  **只在名字還是原樣時才報**（她改過名字就是拿去當別的用了）。**不可以放進 `LEGACY_ROOMS`** —— 那一份走的是 `drop`（刪掉）
- **`data/health.js` 的 `applyRoom` 要加 `retire` 分支**：它現在只認 `add`／`restore`／`drop`，其餘一律當成 `short` 去寫 `shortName` ——
  沒加分支的話按下去是把簡寫寫成 `undefined`

「來訪上還記著床位」（`checkSlotBeds()`，現在的修法是 `clearBeds`：清掉）：

- 那一段在點滴 8／VIP7、床位是 A 或 B：
  - **對應的那一間已經在主檔上** → 修法是「搬到 點滴8A」：`roomId` 換掉、`bed` 清成 null。**用新的一種 fix**（例：`moveBedToRoom`），
    稽核那一句寫「搬到 點滴8A」—— `clearBeds` 的稽核寫死「清掉來訪上的床位」，借它的話紀錄上講的不是發生的事
  - **那一間還沒在主檔上** → **只列不修**，講「先按『診間清單』那一列把 點滴8A 建起來」。
    不可以落到「清掉」那一條：她一按，A／B 就永遠沒了、之後搬不了家
- 其餘（別間的床位、認不得的字）照舊是清掉
- `clearBeds` 現在是整包 `slots` 直接 `update`（不經 `visitsData.save()`、不問鎖）。新的那一種照它的做法：這是資料修正不是改來訪，
  已完成的那幾筆也要搬得動（舊資料幾乎全是已完成）。**但每一段除了 `roomId` 與 `bed` 一個字都不可以變**（測試釘住）
- 沒記床位、還排在點滴 8／VIP7 的段：**不動**。多一列只列不修的「未來還排在點滴 8 的段」讓她知道（同 `checkSameDayVisits()` 的做法）

**這是「日曆以外改得動來訪」的又一條窄路**（ADR-0056；`CLAUDE.md`「一筆來訪改得動的地方」那一列列著每一條）——
`clearBeds` 本來就是一條，這一支多一條只動 `roomId` 與 `bed` 的。ADR-0127 與那一列都要登記。

三條護欄每一列都要有（她改過的不動、一個種子 id 都沒有的資料庫不念、她自己已經建了同名的不再建）。

### 停用的那一間不可以在編輯時被清掉（審查查到的）

`visitEditor.js` 的 `roomField()` 選項來自 `orderedRoomSlots()` → `roomSlots()`，後者濾掉停用的。還排在點滴 8 的那一段打開時一顆都沒按著，
`readDraft()` 讀回空的 → **她只改記一句存一次，診間就安靜地沒了**。`docs/邊界測試清單.md` C11-7 現在要求「不可以被清成空的」。

→ `roomField()` 把**這一段現在指著的那一間**就算停用也列出來（標「已停用」）—— 同一支檔案對停用的不算次數課程就是這樣做的（額度那一排）。
壓表那一頁是新增，不用列。

### 撞期

不用改：8A、8B 各是一間、沒填 `capacity` 就是 1。「一對夫妻同時排 8A 與 8B」不撞，8A 同時兩位照撞。

## 判準

- **這一行會不會讓既有來訪上的「點滴 8」印不出名字？**（日曆、讀取卡片、試算表的來訪紀錄）
- **停用點滴 8 之後，打開一段還排在點滴 8 的未來來訪、只改記一句存檔 → 診間還是點滴 8**（寫成 E2E）
- 拍 Abovee 診間寫 `點滴室8床B`：主檔有 8B 的認成 8B；還沒按資料健檢的認成點滴 8，**不是 `null`**
- 服務資源寫 `4樓休7A`（點滴那一列）→ VIP7A
- 同一個時間 8A 一位、8B 一位：不跳撞期；8A 兩位：跳
- 月曆那一格印 `.8A`、`vip7B`；設定頁與試算表印全名
- 資料健檢：按了「停用點滴 8」之後，壓表的診間那一排沒有它、有 8A 與 8B；那一筆舊來訪照樣寫著點滴 8
- 舊來訪點滴 8 床 A：8A 建好之後按 → 變成點滴 8A、床位那一格空了、其餘每一格都沒變；**8A 還沒建的時候那一列沒有按鈕、床位記號還在**
- 按了 `retire` 那一顆：那一間 `active` 是 false、`shortName` 一個字都沒變
- `tests/abovee.test.js` 那張 353 筆寫法的表：帶床位的那幾種寫法期望值換成 A／B 那一間，其餘一筆都不變

## 改了種子另外要查的（審查逐處查過）

- `tests/master-data.test.js`（釘著種子診間的名單與 `vip7`）
- E2E：`17-settings-fields`（點 `[data-edit="room-iv8"]` 測 capacity —— 種子拿掉之後那一顆不存在，要自己建一間）、
  `01-products`、`03-health-and-counts`（測的就是「清掉床位」）、`15-playbook`（夾具用 `room-iv8` 加 `bed: 'A'`）、`47-course-groups`（現在 18 間 → 22 間）
- `ui/views/masterList.js` 診間那一格「同時幾位」的說明（拿點滴 8 當例子）
- `docs/常見問題.md`（教她把點滴 8「同時幾位」填 2 的那一條）、`docs/操作手冊.md`（三處寫到點滴 8）
- `tests/health.test.js` 的夾具（`checkRoomList()` 會多報）
- `scripts/seed-staging.mjs`：審查查過，沒用到這兩間
- **合併檔帶診間**（第一版的這一支寫錯了）：`merge.mjs` 的 `roomOf()` 把行事曆上的 `.8`、`IL.8`、`點滴8` 都讀成字串 `點滴8`（床位的 A／B 丟掉），
  app 那側照名字精確比對。種子沒有點滴 8 之後，重匯的每一段 `.8` 會落在一間停用的診間上（既有資料庫）或留空（新資料庫）。
  **`roomOf()` 的修改在 11**（它 Blocked by 這一支）；這一支只要記得 `tests/calendar-merge-answers.test.js` 釘著 `點滴8`、
  `.claude/skills/calendar-sheet-merge/references/shorthand.md` 也寫著

## 連動

- 新 ADR `docs/adr/0127-bed-rooms-are-rooms.md`（含：資料健檢多一條只動 `roomId` 與 `bed` 的窄路）
- `CLAUDE.md` 連動表「診間的名字、簡寫或清單」那一列（`capacity` 的例子、拍 Abovee 的床位寫法）、「一筆來訪改得動的地方」那一列（多一條窄路）
- `SPEC.md` 診間清單、`CONTEXT.md`（診間／床位那幾條）、`docs/邊界測試清單.md`（8A／8B 同時；C11-7）
- `public/sw.js` 的 VERSION
