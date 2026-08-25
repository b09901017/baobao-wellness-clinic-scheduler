# 全庫掃描：矛盾與潛在的 bug

來源：使用者，2026-08-25
動工前先讀：`CLAUDE.md`、`SPEC.md`、`CONTEXT.md`、`docs/adr/`

## 為什麼要這一輪

她的原話是「很嚴謹的掃瞄檢查整份程式碼，看有沒有甚麼地方有矛盾或是潛在的
bug」，然後要一份「我可以怎麼操作、預期結果是什麼」的測試流程。

上一輪（`.scratch/broken-call-sites/`）留下的教訓是：**938 個測試全綠，
是因為整個測試套件不曾載入任何一支 UI 檔案。** `tests/module-names.test.js`
補起了「名字不存在」那一種，但它刻意不執行程式碼，所以抓不到
「物件上沒有那個欄位」「這張對照表少一列」這一種 —— 而這一輪抓到的兩個
真 bug 都是那一種。

## 怎麼掃的

三層，一層抓一種：

1. **靜態對帳** —— SPEC／ADR／CONTEXT 的說法與程式碼逐條對照；
   查詢與 `firestore.indexes.json`；`sw.js` 的 SHELL；JS 用到的 CSS class
   與 `app.css` 定義的；enum 與各處對照表（`STATUS_VIEW`、`MASTER_LABELS`、
   `FLOW`、`CHECKS`／`RUNNERS`、`FIX_COPY`）。
2. **把畫面真的畫出來** —— Playwright + Chromium，把 `https://www.gstatic.com`
   的三支 Firebase SDK 換成一份記憶體裡的假 Firestore（刻意模仿真實語意：
   `where('x','==',null)` 對缺欄位的文件不成立、`orderBy(f)` 會把缺 `f` 的
   文件整個排除）。41 條路由全部畫得出來，429 顆按鈕逐顆點過去。
3. **走完整條流程** —— 壓表存一筆、確認、收尾、取消、資料健檢一鍵修正、
   合併檔匯入、客戶表單填答，每一步都比對 Firestore 裡真的寫了什麼。

第 2 層在乾淨的資料上是零錯誤的；兩個真 bug 都要**特定的資料狀態**才長得出
那顆按鈕。這件事本身是這一輪最值得記下來的：**「點得到的都點過了」不等於
「測過了」**，因為有些按鈕要有資料才會出現。

## 結果

| # | 是什麼 | 嚴重度 | 狀態 |
|---|---|---|---|
| 01 | 資料健檢的「病歷號」一鍵修正整個按不動 | 高 | done |
| 02 | 從日曆改一件勾掉的待辦，會把它變回沒做 | 中 | done |
| 03 | 資料健檢頁說「只有兩件事有修正」，其實有三件 | 中 | done |
| 04 | 匯入預覽同一頁自打嘴巴 | 中 | done |
| 05 | 二次確認每開一次就在 `document` 上多留一顆監聽 | 低 | done |
| 06 | 客戶表單的星期起點跟她的日曆相反 | 低 | todo（要她決定） |
| 07 | `SPEC` 第 7 節規則編號四處對不上 | 低 | done |
| 08 | 用了但沒定義的 CSS class、沒有人用的索引 | 低 | todo（小掃除） |

沒有找到的（都對）：次數三段式與 `slotOutcome()`／`counts()`／`recount()` 的
一致性、醫療禁忌硬性阻擋、ADR-0027 的「確認之後才長登記任務」、ADR-0041 的
無條件取消任務、ADR-0029 的匯入狀態、ADR-0036 的可用性挑月份、
`firestore.indexes.json` 與所有查詢、`sw.js` 的 SHELL 清單、分層守衛。

## 這一輪之後留下來的東西

- 兩支迴歸測試：`tests/notes.test.js` 的 `normalizePatch`、
  `tests/health.test.js` 的「畫面認得每一種修正」（跟 `module-names.test.js`
  同一個路數：不執行 UI 程式碼，只讀原始碼問「這個名字在不在那張表裡」）
- `.claude/skills/graphify/`：把整份程式碼建成知識圖，之後問「誰呼叫誰」
  不用再 grep（`skills-lock.json` 有記來源）
