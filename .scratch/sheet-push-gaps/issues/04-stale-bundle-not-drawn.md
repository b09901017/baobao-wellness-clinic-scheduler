# 04 兩台同時推：比較舊的那一包不畫

Status: todo
Blocked by: 02（同一支 `.gs` 的 `doPost()`／`render()`）

## 動工前先讀

- `FINDINGS.md` 的 ④、`spec.md`「第二輪」第 3 點
- `public/js/data/sheetSync.js` 的 `buildBundle()`、`run()`（讀到快取這一趟不推的那一套要包住新的讀取）
- `public/js/data/audit.js` 的 `listRecent()`（`at desc`，Firestore 自動有的單欄索引）
- `sheets/readonly-report.gs` 的 `doPost()`（`tryLock(30000)` 之後才可以比、才可以記）
- ADR-0013、ADR-0161（照舊送整包、冪等）；寫 **ADR-0174**

## 她要的

> 我不介意回去重貼……所以如果是有顧慮到要不要重貼的問題，可以不用顧慮了，你覺得可以改就改

（④ 原本她選先觀察，理由只有「要重貼」；這一句之後照建議一起修。）

## 為什麼會這樣

`.gs` 只用鎖讓請求排隊，不比新舊。手機與 iPad 幾乎同時推：新的那一包先拿到鎖畫完，舊的那一包等到鎖接著畫 —— 試算表停在舊的，要等下一次推送。
（另一半「等不到鎖被拒」第一輪 01 的重試已經會自己再推。）

## 做法

- **新舊的依據是稽核紀錄最新那一則的 `at`**（伺服器時間；每一次寫入都帶一則，軟刪除也算）。**不可以用資料本身的 `updatedAt` 取最大**：
  刪掉的那一筆不會被讀進來，刪除之後的那一包會被當成比較舊的
- `buildBundle()` **先**讀那一則（`listRecent(1)`）、**再**讀資料 —— 資料只會比那個時間新，不會舊。那一讀也算進「讀到快取就不推」
- 時間放在請求的最外層（`{ token, bundle, dataAt }`），**不放進 `syncBundle()`**（一次性客人那一輪會改那一支；也不用升 `SYNC_FORMAT`）
- `.gs` 拿到鎖之後：比文件屬性記的（例如 `lastDataAt`）—— 比較舊 → 不畫、回 `{ ok: true, stale: true }`；一樣或比較新 → 照畫，畫完才記
  （畫到一半逾時不記）。沒帶 `dataAt` 的（舊版 app）照畫、不記。`force`（整份重畫）比較舊照樣不畫
- app 收到 `stale` 算成功（試算表上已經是更新的那一份），清待推標記照舊看 `version`；設定頁那一句講得出「試算表上已經是更新的，這一包沒畫」

## 判準

- 刪掉一筆來訪之後推的那一包，會不會被當成比較舊的不畫？（用稽核的時間就不會；寫一支測試釘住「不可以拿資料的 updatedAt」）
- 舊的那一包會不會把新的蓋掉？（替身：先推新的、再推舊的 → 第二次一格都不動）
- 舊版 app（沒帶時間）推過來會不會被擋？（不會：照畫）
- 兩台時鐘不準會不會判錯？（不會：用的是伺服器時間）
- 讀那一則讀到快取（離線）會不會被拿來推？（不會：跟其他讀取一起算進 `readsIncomplete()`）

## 過目抓到的（主控對過）

- 不經過 `repo.commit()` 的寫入只有 `publicForm.js`（客戶自己填的表單回覆，不上試算表）→ 稽核的時間當依據沒有洞
- `firestore.rules` 允許讀稽核；`listRecent()` 走 `repo.listWithDeleted()`，算進 `cacheReads()`
- 還沒送上雲端的那一則 `at` 是 null → 當成沒帶時間（照畫、不記）；Timestamp 先換成毫秒（`audit.js` 的 `millisOf()`）
- `.gs` 回 `stale` 時沒有 `sheets` → `sheetReport.js` 的 `pushedSay()` 會說「更新了 0 張」：改 `pushedSay()`（它不在一次性客人那一輪要動的 `syncBundle()`／`customerReport()` 裡）與 `run()`
- 記的時間放文件屬性：`forgetStale()` 只刪 `fp:` 開頭的鍵，不會被清掉
- `docs/STAGING.md`（約 480 行）只寫「改了 `SYNC_FORMAT` 才重貼」—— 這一輪不升版也要重貼，補一句；`docs/常見問題.md` 的秒數等實測後改

## 做完時留下的

（做完填）
