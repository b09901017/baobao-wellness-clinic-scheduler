# 文件：v9 與備註順序

Status: todo
Blocked by: 01, 02, 03, 04
動工前先讀：CLAUDE.md「舊表 B2…合併檔」「備註那一段的順序、長備註」兩列；`.claude/skills/calendar-sheet-merge/SKILL.md`「合併檔（import.json）」那一節；`SPEC.md` 匯入那一節與備註順序那一句（過目：約 1529 行）；`docs/STAGING.md` 寫著 v8 的那一句（約 489 行）；`docs/操作手冊.md`／`docs/常見問題.md` 有沒有講到備註的順序

## 判準

- CLAUDE.md 那張表講的是 v9 的四格、一律寫 v9；備註那一列講新的預設順序（ADR 編號）
- SKILL.md 的格式區塊有 `note`／`status`／`cancelReason`／`longNotes`，並寫清楚 `merge.mjs` 自己不產它們（切換腳本產）
- 一個真名都沒有（`tests/no-secrets.test.js`）
