# CLAUDE.md

專案的完整需求背景、資料模型、業務規則與名詞表在 `SPEC.md`。動工前先讀。

## 文件分工

同一件事只寫在一個地方，其他地方用一行連結指過去。

| 檔案 | 只放 |
|---|---|
| `SPEC.md` | 需求、資料模型、業務規則、畫面規劃 |
| `CONTEXT.md` | 詞彙表。定義詞是什麼，不放實作 |
| `docs/adr/` | 為什麼這樣決定。一支一個決定，寫理由不寫作法。慣例見 `docs/agents/domain.md` |
| `docs/legacy/` | 舊系統的結構，唯讀參考 |
| `.scratch/<feature-slug>/issues/` | 待辦的 issue，不使用 GitHub Issues。動工前先看有沒有相關的，格式見 `docs/agents/issue-tracker.md` |

寫新文件前先確認這件事還沒被寫過。`docs/legacy/` 與 `docs/adr/` 不放任何真實客戶姓名或健康資訊。

## 容易漏掉的連動

| 改了這個 | 一定要一起檢查 |
|---|---|
| `/domain` 的業務規則 | `SPEC.md` 對應章節。推翻既有決定就補一支 ADR，不要改掉舊的 |
| `public/` 底下任何檔案 | `public/sw.js` 的 `SHELL` 清單與 `VERSION`（測試只盯清單，不盯版號） |
| 做完一個開發步驟 | `README.md` 開發狀態表打勾 |
| 新增集合、欄位、要排序的查詢 | `firestore.rules` 要開洞（預設全拒），`firestore.indexes.json` 要補索引 |
| 次數的算法 | `domain/entitlements.js` 的 `counts()`（現算）、`summarize()`（讀快取）、`reconcile()`（對帳）要一起改，見 ADR-0004 |
| 健檢與二返的關係 | 只寫在 `domain/followups.js`（配對、還欠幾次、「約二返」的待辦）。不要在 `taskRules.js` 或 UI 裡再判斷一次，見 ADR-0022 |
| 任何「先看誰」的排序或推薦名單 | 用 `domain/scheduling.js` 的同一組計分，不要另寫一套 —— 同一位客戶在兩個畫面排名不同，她不會知道哪個算數 |
| 來訪狀態的顏色、標籤或符號 | 只改 `domain/visits.js` 的 `STATUS_VIEW`，日曆、客戶詳情、試算表全部讀它。顏色在 `app.css` 的 `.status-*`，`tests/visits.test.js` 盯著兩邊對得上 |
| UI 文案、新的詞 | 用 `CONTEXT.md` 的詞，不要用它標 _Avoid_ 的同義詞 |
