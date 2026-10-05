# 約的時候選時長（二返、n返 的 30／60）

Status: todo
來源：`../spec.md` 三（時長）、第一題、第一段 d
動工前先讀：ADR-0098、`domain/visits.js` 的 `slotMinutes()`、它的五個呼叫端（`slotDraft.js` 第 96 行、`schedule.js` 第 1379–1388 行、
`visitEditor.js` 第 209–222、897–921、980 行、`backfill.js` 第 119–128 行、`mergeImport.js` 第 481–483 行）、
`merge.mjs` 第 1053 行一帶的 `endOf()`（第二份，順序要一樣）、`domain/naming.js` 第 180–190 行（月曆那個分鐘什麼時候接）、
`domain/masterData.js` 的 `durationChoicesOf()`、`domain/visits.js` 的 `rebookSlot()`（ADR-0108）、`domain/nthFollowup.js` 的 `nthSlotFields()`
Blocked by: 05（`slotOptionsFor()` 與 `slotFromPicks()` 的新形狀）

## 她要的

> - 時長：SIS／IN／高能量／ILIB／二返／n返 是 30、60；EECP 是 20、60

> 1. 是，約的時候選，預設 30。拍照時照 Abovee 那一格（二返60 就記 60）

## 為什麼會這樣

app 只有一種「30／60」：**買的時候分**（`durationChoices`，ADR-0077／0078）—— `復能-三選一(30)` 與 `(60)` 是兩筆不同的額度。
二返的額度是跟著健檢自動長出來的（ADR-0022），買的時候沒得選，所以它固定 30 分（`seed.js` 的二返 `durationMin: 30`）。
Abovee 上二返60 有 9 筆，記進 app 會變成 30 分 —— 日曆那一格少一半（第一段 d）。

`slotMinutes()` 的順序是**品項 → 額度 → 課程 → 60**，沒有一層是「這一段她選的」。n返 借二返的課程（ADR-0063），
而 `visitEditor.js` 第 980 行寫著 n返 不走 `slotMinutes()` —— 那一條要一起看。

## 談定的做法

1. **課程多一格 `bookingMinutes`**（例 `[30, 60]`）：設定頁的字「約的時候選時長」，跟「可選時長（買的時候分）」分成兩格，提示講清楚差別：
   買的時候分＝兩筆額度；約的時候選＝同一筆額度、每一段自己挑。**同一門課兩格不能都填**（`validate()` 擋，講為什麼）
2. **時段多一格 `minutes`**（她選的）：只在那門課有 `bookingMinutes`、而且值在裡面時才算數。
   `slotMinutes()` 的順序變成 **這一段選的 → 品項 → 額度 → 課程 → 60**；收一個新參數，五個呼叫端都傳。預設是課程的 `durationMin`（二返 30）
3. **三個入口**：壓表與來訪編輯器在選了這門課之後多一排「30／60」丸子（預設那一顆按好）；拍 Abovee 在 08 照照片上的數字（二返60 → 60）。
   n返 借二返的課程，所以同樣有那一排；`visitEditor.js` 第 980 行那條 n返 的路要讀 `minutes`
4. **它跟著那一段走**：`readDraft()` 沒動到那一排時保留原本的 `minutes`；**改期**（`rebookSlot()`，ADR-0108）新的那一段抄舊的 `minutes`；
   每次存檔照舊重推 `endsAt`（ADR-0098：`endsAt` 從來不是她填的）
5. **月曆那一格**：`slotName()` 只在「這門課有兩種以上規格」時接分鐘（`durationChoicesOf()`）—— 有 `bookingMinutes` 的也算兩種以上，
   印的是**這一段的** `minutes`（`二返(60)`）
6. **種子**：二返 `bookingMinutes: [30, 60]`。既有資料庫由 12 的資料健檢補（她那一格是空的才補）
7. **合併檔那一側的 `endOf()`**（`merge.mjs`，第二份）：舊表與行事曆沒有「這一段選了幾分」這個資訊 → 不用加那一層，但檔頭的「順序跟 app 一樣」那句要改成講清楚為什麼少一層
8. **ADR-0122**：延伸 ADR-0098

## 牽連

- **撞期**（`conflictWarnings()`、`checkConflicts()`）、**時段反查**、**日／週檢視的高度**都讀 `endsAt` —— 結束時間對了它們就對
- **試算表**：來訪紀錄印起訖時間（`timeLabel()`）—— 跟著對
- **資料健檢**「課程的時長跟建議的不一樣」（`checkCourseDuration()`）比的是課程的 `durationMin`，不受影響
- **補登**（`backfill.js`）：只有課程那一層 —— 有 `bookingMinutes` 的課程補登時用預設值；要不要給那一排，看補登那一頁的形狀（不給就寫明）
- **營養點滴**的品項時長（ADR-0098）：營養點滴沒有 `bookingMinutes`，順序裡「這一段選的」那一層不會出現
- `type="number"` 規矩不相干（這一排是丸子不是數字欄）

## 判準

- 壓表選二返 → 多一排 30／60、預設 30；選 60 存下去，日曆那一格是一小時、名字是 `二返(60)`？
- 來訪編輯器打開那一段只改醫師、存檔：`minutes` 還是 60（沒被清回 30）？
- 那一段改期：新的那一段還是 60？
- 一段 n返 也能選 60？
- 復能三選一(30) 的那一段：**沒有**這一排（它是買的時候分的），結束時間照額度？
- 一門課兩格都填：存不下去？
- 舊資料：沒有 `minutes` 的二返照舊 30 分，`endsAt` 一個都沒變？

## 審查之後補的（2026-10-05，subagent 對著程式碼查過；跟上面衝突的地方以這一節為準）

- **不要改 `durationChoicesOf()`**：它也被額度名字（`entitlements.js` 第 662 行）、`buy.js` 第 243 行、`orderForm.js` 第 217 行、`health.js` 第 1319 行用 ——
  改了二返的額度會變成 `二返(30)`、加購會多一排丸子。**只改 `naming.js` 第 189 行一帶的接分鐘那一段**：有 `bookingMinutes` 的課也接，印那一段的 `minutes`
- **n返 在 `naming.js` 第 152 行就提早回快照了**（讀 `courseName`）→ 三返(60) 會印成「三返」。那一條路也要接分鐘
- `merge.mjs` 的 `endOf()` 在第 1106 行一帶（不是 1053）
- 這一支也延伸了 ADR-0078（三種名字裡「那天做了什麼」那一種多接一個分鐘的來源）—— ADR-0122 一起寫
