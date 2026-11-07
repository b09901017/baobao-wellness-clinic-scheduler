# 健檢報告（給 AI 看的完整版）

查的版本：`develop` `45dd973`。行號都是那一版的。嚴重的排前面。
每一條都是讀完前後文、能算的實際算過才列的；「怎麼確認的」那一行寫了確認到什麼程度。

單元測試：`npm test` 5354 個，5349 通過。失敗的 4 支（`tests/photo.test.js`、`reset-staging`、`restore-backup`、
`seed-staging`）是那台機器沒有 `node_modules`（缺 `sharp`、`firebase-admin`），不是程式錯 —— 但也代表這 4 支這次沒驗到。

---

## 一、會寫錯資料或算錯次數

### #1（中）來訪編輯器沿用打開時讀的來訪，存檔時額度快取少算 → `issues/01`

- **位置**：`public/js/ui/views/visitEditor.js:1643-1652`（`refreshCustomerVisits()`），
  搭配 `public/js/data/visits.js:279-290`（`save()` 拿呼叫端給的清單組 `after`，交給 `countOps()` 重算）
- **形狀**：`refreshCustomerVisits()` 在「打開時讀的是伺服器那一份（`isWholeList`）、這一位最近一次也是伺服器讀的
  （`lastReadWhole`）、現在沒離線」時**不重讀**，直接沿用 `boot()`（`:141`）那一刻的 `ctx.customerVisits`。
  `save()` 的 `guardWhole()` 只問「來源是不是伺服器」，不問「是不是現在的」，所以放行；
  `ifUpdatedAt` 只擋**同一筆**來訪被改過，擋不到同一位客戶的**別筆**。
- **情境**：iPad 開著日曆「新增來訪」（或「改這一段」）→ 這段時間手機替同一位客戶排了一段、扣同一筆額度 →
  iPad 存檔 → 那筆額度的 `bookedCount` 被寫成少一次。兩段剛好同一天時，`mergedPayload()`（`:1446`）拿舊清單問
  `sameDayVisitFor()` 問不到手機那一筆 → 同一天長出第二筆來訪（ADR-0083 破功）。
- **其他入口都沒有這個洞**：壓表（`schedule.js:2301` `listWhole`）、日曆長按（`calendar.js:1178`）、批次取消
  （`bulkCancel.js:576`）、確認抽屜、簽療程單抽屜（`home.js:4027`）、拍 Abovee（`record()` 重讀）都在按下去那一刻重讀。
- **後果**：卡片牆／客戶清單的「剩 N」錯一次（讀快取）；資料健檢「次數對帳」抓得到、可以一鍵修；同一天兩筆由
  「同一天有兩筆來訪」列出（只列不修）。不刪資料。
- **註解跟行為不一致**：`:1639-1641` 寫「別台在那之後改了這一筆，`save()` 的 `ifUpdatedAt` 照樣擋」—— 只對這一筆成立。
- **怎麼確認的**：讀完整條路徑；用 `domain/visits.js` 的 `recount()` 模擬（打開時的清單＋新的一段 vs 加上另一台那一段），
  寫進去 `bookedCount = 2`，應該是 3。**沒有在畫面上實際點過**（沒開模擬器）。
- **修的方向**：拿掉那個提前 return（一律在按下去那一刻 `listWhole()`），或至少新增一筆（`isNewDoc`）時一定重讀。
  代價是確認框晚一拍（註解說的理由）。改完要回頭看 `cancelOneSlot()`（`:1679`）也走同一支。

### #2（中低）資料健檢的修正沒有防連按，「補上二返額度」「補警示詞」每按一次多建一筆 → `issues/02`

- **位置**：`public/js/ui/views/health.js:802-815`（`applyAndReload()`：`withSaveState` 沒帶 `key`，寫入期間按鈕照樣按得到，
  成功才 `render(el)`）；`public/js/data/health.js:497-505`（`addFollowup`：`id: repo.newId(path)`，每次呼叫都是新 id）、
  `:223-229`（`addAlert`：沒給 id → 自動 id）
- **情境**：按「補上二返額度」→「修正」→ 還在「修正中…」（中間要先跑 `chainAfterEntitlements()` 好幾次讀取，行動網路要好幾秒）
  時再按一次同一顆 →「修正」→ 客戶身上兩筆一樣的二返額度（二返次數變兩倍、待辦鏈也照兩筆算）。
  toast 的「重試」也是重跑同一個閉包，同樣會再鑄新 id。
- **同一支檔案自己的理由**：`addCourse`（`:395`）、`addEquipment`（`:455`）、`addIvProduct`、`addStaff`、`applyRoom add`
  都用種子的固定 id，註解寫著「隨機生一個的話……會再建出第二台」—— 這兩種沒照做。
- **為什麼測試沒抓到**：`tests/save-guards.test.js` 只認 `/\.(create|take|save)\s*\(/`，`healthData.applyFixes(` 不在視野裡
  （lessons 第三節同一個形狀）。
- **怎麼確認的**：讀程式。沒在畫面上連按過。
- **修的方向**：`applyAndReload()` 給 `key`（例如 `health:fix:${種類}:${客戶}`）並在寫入期間把按鈕鎖住；
  `addFollowup` 的 id 在掃描時就鑄好、放進 `fix`（重試、連按都寫同一個 id）；`addAlert` 同理。
  `save-guards` 的正規表示式可以考慮多認 `applyFixes`。

### #3（低中）「把計數欄位改成重算值」寫的是掃描那一刻的數字 → `issues/03`

- **位置**：`public/js/data/health.js:484-495`（`recount` 那一個 op：直接寫 `fix.to`，沒有 `ifUpdatedAt`）
- **情境**：掃描完不按修正 → 別台替那位客戶排了一段（額度的 `bookedCount` 已經被那一台寫對）→ 回來按修正 →
  舊數字蓋回去，差一次。
- **對照**：同一支的 `clearBeds`、`moveBedToRoom`、`restatVisit`、`renameChartNo`、`chartNoToField` 都帶 `ifUpdatedAt`。
  額度文件每存一次來訪都會換 `updatedAt`，所以帶上就擋得住。
- **怎麼確認的**：讀程式；`applyAndReload()` 修正前不重掃。
- **修的方向**：掃描時把額度的 `updatedAt` 放進 `fix`、op 帶 `ifUpdatedAt`；或修正前重讀那位客戶的來訪再算一次。

### #4（低）營養品「記交付」連按，`deliveries` 多一筆一樣的 → `issues/04`

- **位置**：`public/js/ui/views/customerDetail.js:1395`（沒有 `key`）、`public/js/data/notes.js:132-159`
  （`withDelivery()` 拿呼叫端手上那一份額度判斷「給過了沒」，兩次手上都是舊的）
- **後果**：「給了沒」的狀態不會錯（`deliveredIds()` 是 Set），但交付紀錄重複一行、會進試算表。
- **怎麼確認的**：讀程式。
- **修的方向**：給 `key`；或寫入前重讀那一筆額度。

---

## 二、CLAUDE.md 連動表的規則

除了 #1（lessons 第二節「拿部分／舊的資料算次數」）、#2（第三節「按兩次」）之外**沒找到違反**。對過的見 `NOTES.md`。

---

## 三、`firestore.rules`／`storage.rules`

**沒找到可以被利用的漏洞。** 查了什麼見 `NOTES.md`。

### #8（低）規則的註解跟函式講的不是同一件事 → `issues/06`（併在小事裡）

- `firestore.rules:24-28`：註解「永不硬刪除：刪除只能是寫入 deletedAt 時間戳。這條規則存在的意義是『就算程式寫錯了也刪不掉』」，
  但 `keepsExistingId()` 只檢查 `request.resource.data` 有沒有 `updatedAt` 這個鍵（名字也對不上）。
  真正擋刪除的是每一個 match 的 `allow delete: if false`。資料是安全的，只是註解誤導。
- 順帶：`audit` 的 `at` 沒有釘成 `request.time`，白名單裡的人可以寫倒填的稽核時間（只有她一個人，風險很低）。

---

## 四、文件跟程式不一樣 → `issues/05`

### #5（中，因為她照文件做）`docs/常見問題.md:1030-1046`

「我點的是其中一段，為什麼跳出來三段？」那一題的「怎麼辦」還寫：卡片底下有「這一天還有另外 2 段 —— 看全部」；
長按那幾顆（取消、標成未到…）動的是**整筆**；選單抬頭寫「這一天共 3 段」。
現在：沒有「看全部」那一行（2026-09-09 她說不需要）；長按每一顆只動那一段（ADR-0097、0111）；
抬頭是 `日期・狀態・第 N 段`（`calendar.js:1128-1140`）。確認：`public/` 搜那幾句一句都找不到。

### #6（中）`docs/邊界測試清單.md`

- C10-3（`:352`）叫她按「看全部」、C10-4（`:353`）叫她看「這一天共 3 段」—— 都不存在了
- C10-6（`:355`）「客戶詳情、待辦中心、進度追蹤各點一筆 → 照舊畫整筆」跟同一份的 C12-9（`:392`，兩段以上先列目錄，
  ADR-0089）矛盾，畫面是 C12-9 那樣
- C12 編號重複：C12-8、9、10、14、15 在 `:391-395` 與 `:396-403` 各出現一次

確認方式：用腳本把三份文件（操作手冊、常見問題、邊界測試清單）裡 `「…」` 括起來的字逐一拿去 `public/` 找，
找不到的再人工看前後文（大部分是樣板字串如「還有 N 行」，只有上面這幾條是真的過時）。

---

## 五、其他小事 → `issues/06`

- **#7 部署順序**：`.github/workflows/deploy.yml:178` 先部署 Hosting，`:193` 才推 Firestore Rules 與索引、`:208` 才推 Storage。
  新程式要用新規則或新索引時有一段空窗；Rules 那一步紅了，正式站會停在「程式新、規則舊」。
  （ADR-0167 之後手機要點「有新版本」才換，空窗對她影響小，但新裝置第一次打開吃的是新程式。）
- **#9 小腳本用 UTC 的今天**：`.claude/skills/customer-availability-sheet/scripts/history.mjs:92-93`
  （`new Date().toISOString().slice(0, 10)`，lessons 第七節）。台灣 00:00–08:00 跑，當天的來訪被標成 `future`、不進習慣統計。
  `scripts/seed-staging.mjs:112` 同一個寫法，但只跑在模擬器上，可以忽略。
- **備份沒有 `config/ai`**：`public/js/data/backup.js` 的 `exportAll()` 不匯出每月 AI 上限與暫停開關，還原後回到預設
  （US$10、沒暫停）。`docs/STAGING.md:360` 說沒有那一份也能用，所以只是記一下，不一定要改。
- **（不算 bug）`applyConfirmation()` 沒傳 `asked` 時會把已完成／未到的段蓋成已確認**（`visits.js:1026-1044`）。
  現在每個呼叫端都有傳（`home.js:3539`、`consequences.js:713` 跟著呼叫端），所以沒事；之後新增呼叫端要記得傳。
- **（不算 bug）資料健檢「孤兒資料」對任務的那一句寫「但任務還開著」**（`domain/health.js` `checkOrphans()`），
  但沒有濾 `task.done`。實務上幾乎不會出現（來訪沒有刪除的路），只是字跟條件不一致。
