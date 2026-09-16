# 佳璐與 LuLu 是同一個人

Status: todo
來源：`../spec.md`（保留第 4 題）
動工前先讀：`.claude/skills/calendar-sheet-merge/references/shorthand.md`、
`.scratch/prelaunch-fixes-2026-09-16/spec.md`（2026-09-16 那一條「先當作視同一個人」）

## 她的答案（原話）

> 這個確認了是同一個人

## app 這側一行都不用改

匯入從來不建立 `staff`，所以不加就不會有第二位。

## 要做什麼

**版控這一側（進得了 PR 的）**：
`.claude/skills/calendar-sheet-merge/references/shorthand.md:99` 那一列現在寫著

```
| 佳璐 | 一樣。**2026-09-15 新的一位，主檔還沒建** —— 匯進去之後治療師那一格留空，匯入頁會講 |
```

改成把「佳璐」併進 `LuLu` 那一列，並把這一列刪掉。

**不進版控的那一側（要跟她講、由她或我在本機改）**：
`.local/references/aliases.json`

- `therapistAliases.LuLu`：`["LU"]` → `["LU", "佳璐"]`
- `therapists` 名單裡的「佳璐」拿掉（留著的話它會同時是正式名字與別名）

**改完要重跑一次產檔**，不然那 2 段來訪的治療師還是空的。

## 判準

- `shorthand.md` 裡「佳璐」只出現在 `LuLu` 那一列的右欄
- 重跑產檔之後，匯入頁不再有「治療師對不到」那兩段
- `tests/no-secrets.test.js` 照樣過（`.local/` 被 `.gitignore` 第 57 行的 `/.local/`
  擋著 —— 改完跑一次 `git check-ignore -v .local/references/aliases.json` 確認）
