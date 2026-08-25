# 資料健檢頁說「只有兩件事有修正」，其實有三件

Status: done
來源：全庫掃描，2026-08-25（`../spec.md`）
動工前先讀：`SPEC.md` 第 6.6 節、`docs/adr/0050`

## 症狀

`#/settings/health` 抬頭底下那一句寫著：

> 只有計數欄位重算與補二返額度**這兩件事**有「修正」可以按，其餘一律不會
> 自動改任何資料。

而「備註寫著舊的說法」那一項也有修正（ADR-0050）。畫面在講一件不成立的事。

`SPEC.md` 第 6.6 節 2026-08-25 已經改成**寫條件不寫數量**（有明確正解／
沒有第二種意思／沒有別的地方做得了），但程式那一側四個地方沒跟上：

- `ui/views/health.js` 的檔頭與 `page__lead`
- `domain/health.js` 的檔頭
- `data/health.js` 的 `applyFixes()` 註解

順帶：`domain/health.js` 的 `CHECKS` 上面寫著「**八項**檢查」，
而 `CHECKS` 有九項（`tests/health.test.js` 早就在測九項了）。

## 做了什麼

四處全部改成寫條件不寫數字，並在 `domain/health.js` 的 `CHECKS` 上面補一句
「每一個 id 在 `RUNNERS` 都要有一支，`FIX_COPY` 也要有一列」——
那正是 issue 01 斷掉的地方。「八項」改成不寫數字。

## 驗證

- `npm test`
- 瀏覽器：設定 → 資料健檢，抬頭那一句不再講數量
