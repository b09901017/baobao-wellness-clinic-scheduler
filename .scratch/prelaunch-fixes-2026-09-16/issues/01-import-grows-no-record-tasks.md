# 匯入會長出一批一出生就逾期的「寫紀錄」，而確認框講的是相反的話

Status: done
來源：`../spec.md`（報告 §1.1）
動工前先讀：`docs/adr/0066`（紀錄是來訪之後才出生的任務）、`SPEC.md` 第 6.10 節、
`data/legacyImport.js` 的檔頭、`domain/taskRules.js` 的 `syncTasksForVisit()`

## 她要的

> 對於未來的要長，對於過去的如果不會有問題的話就不長，或是當已完成，都可以，
> 但是對於未來發生的還沒到的都要長

## 現在壞在哪

拿她那份 import 整份模擬（腳本沒進 repo）：`countNewTasks()` 回 **18**，而那 18 張
**全部是「寫紀錄」、全部掛在已經發生的來訪上**（9 張二返 ＋ 9 張復健科醫師門診），
死線 5/21 到 9/15，**逾期 18、今天到期 0、未來 0**。還沒發生的那 22 筆
（營養點滴 4、復能 10、EECP 5、ILIB 10）一張都不長，因為它們都是不用另外掛號的課程。

確認框那一句會印成：

> 還沒發生的那幾筆會產生 18 筆登記待辦；已經發生的一筆都不會長

**每一半都是反的。**

為什麼：

- `data/legacyImport.js:97-99` 對每一筆來訪跑 `syncTasksForVisit(visit, [], …)`
- `domain/taskRules.js:370`：`if (t.kind === RECORD_TASK_KIND || acceptsNewTasks(visit.status))`
  —— 紀錄那一族**刻意不走** `acceptsNewTasks()`（ADR-0066），而匯入的過去來訪是 `done`，
  `acceptsRecordTasks('done')` 是開的
- `SPEC.md` 第 6.10 節與 `data/legacyImport.js` 的檔頭都寫著「已經發生的那些一筆都不長」，
  而那兩句是 ADR-0066（2026-09-04 加「寫紀錄」）**之前**寫的
- `tests/merge-import.test.js:440-441` 那筆「過去的來訪」用的課程沒有 `needsRecord`，所以測試沒抓到

**那 18 這個數字要看她的主檔。** 模擬用的是 `domain/seed.js`，而 seed 裡復健科醫師門診
已經勾了 `needsRecord`。她的主檔沒勾的話現在是 **9 張**，她按下資料健檢那一列的修正鈕之後變 18。

## 做法

- `data/legacyImport.js` 的 `importPlan()`：那一圈產出的任務**濾掉 `RECORD_TASK_KIND`**。
  未來那幾筆的掛號任務照長（`acceptsNewTasks()` 本來就管著），所以她要的兩半都成立
- `domain/mergeImport.js` 的 `countNewTasks()` 要**跟寫入端算出一樣的數字** ——
  它的存在理由就是「不要在 UI 上再判斷一次」，所以兩邊共用同一個濾法，不要各寫一次
- `ui/views/mergeImport.js` 的兩段文案（`runCard()` 的最後一句、`noTaskWhy()`、
  `run()` 確認框倒數第二行）跟著改 —— 現在它們假設「會長的一定是還沒發生的登記」
- `SPEC.md` 第 6.10 節那一句改成「**不分族**都不長」，並補 ADR-0093

## 判準

- **這一行會不會讓一筆還沒發生、已確認的 A 類來訪少長掉 Examine 與耀聖？**
- 一筆過去的、`done` 的、課程有 `needsRecord` 的來訪，匯進去之後 `tasks` 是 0
- 一筆未來的、A 類的來訪，匯進去之後照樣有 Examine 與耀聖
- 確認框上的數字 === 真的寫進去的任務筆數（同一支函式算的）
- 紀錄那一族在**正常存檔**那條路上一個字都沒變（她自己記完一場來訪照樣長「寫紀錄」）
- 重現測試 `tests/prelaunch-repro/1-1-import-record-tasks.test.js` 轉綠，搬進 `tests/merge-import.test.js`
