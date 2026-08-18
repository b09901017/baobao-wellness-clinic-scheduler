# CLAUDE.md

專案的完整需求背景、資料模型、業務規則與名詞表在 `SPEC.md`。動工前先讀。

## 文件分工

同一件事只寫在一個地方，其他地方用一行連結指過去。

| 檔案 | 只放 |
|---|---|
| `SPEC.md` | 需求、資料模型、業務規則、畫面規劃 |
| `CONTEXT.md` | 詞彙表。定義詞是什麼，不放實作 |
| `docs/adr/` | 為什麼這樣決定。一支一個決定，1–3 句 |
| `docs/legacy/` | 舊系統的結構，唯讀參考 |
| `.scratch/` | 待辦的 issue。動工前先看有沒有相關的 |

寫新文件前先確認這件事還沒被寫過。`docs/legacy/` 與 `docs/adr/` 不放任何真實客戶姓名或健康資訊。

## Agent skills

### Issue tracker

Issues 以 markdown 檔存在本 repo 的 `.scratch/<feature-slug>/`，不使用 GitHub Issues。See `docs/agents/issue-tracker.md`.

### Domain docs

Single-context：根目錄 `CONTEXT.md` + `docs/adr/`。See `docs/agents/domain.md`.
