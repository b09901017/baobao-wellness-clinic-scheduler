# 把「只取消一段時 Examine／耀聖要不要收，她還沒定案」從四份文件拿掉

Status: todo
來源：`../spec.md`（保留第 1 題）
動工前先讀：`docs/adr/0091`、`domain/taskRules.js` 的 `cancelTasksFor()`

## 她的答案（原話）

> 收，但是就只收那個時段的，反正現在就是每個時段和每個時段都是分開獨立的，
> 但是我不確定有沒有回答道問題？

有回答到，**而且就是現行行為**。`cancelTasksFor()`（`domain/taskRules.js:477`）
的兩圈都是 `for (const i of dead)`，讀的是 `coursesById[slots[i].courseId]` ——
那一段自己的課程。暫定值＝定案，程式八成一行都不用改。

**動工第一件事是先確認一次行為真的是「只收那一段的」**，用測試，不是讀 code。

## 要改哪幾個地方

| 檔案 | 那一句 |
|---|---|
| `SPEC.md:816` | 「**只取消一段時 Examine／耀聖要不要收，她還沒定案**（暫定：要，因為「Examine 上是一段登記一筆」）」 |
| `CLAUDE.md:65` | 「只取消一段時 Examine／耀聖要不要收**她還沒定案**（2026-09-13，暫定要）」 |
| `docs/adr/0091` 的「## 還沒定案的」一節 | 整節改寫成「2026-09-16 她定案了」＋ 原話。**ADR 的其餘部分一個字都不改** |
| `.scratch/asks-2026-09-13/issues/02` 第 74 行 | 「暫定：要」→ 定案 |
| `C:\Users\DELL\.claude\...\memory\open-question-single-slot-examine-cancel.md` | 這一則記憶要刪掉（它已經不是待決問題了） |

## 判準

- 加一支測試：兩段的那一天（A 類 ＋ C 類），只取消 A 類那一段
  → 長出來的「取消 X」只帶那一段的 `slotIndexes`，而且系統是 A 類那一段的
- `grep -rn "還沒定案" SPEC.md CLAUDE.md docs/ .scratch/asks-2026-09-13/` 掃不到這一題
- 這一行會不會讓下一輪的人以為這件事還沒決定？
