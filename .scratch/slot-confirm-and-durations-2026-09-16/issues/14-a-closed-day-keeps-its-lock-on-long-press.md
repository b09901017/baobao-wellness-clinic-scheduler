# 結案的那一天，長按沒做的那一段會長出「客戶說可以」

Status: done
Blocked by: 01
來源：2026-09-16 審查時查到（Spec 軸報的「沒被要求的行為」，人工重現確認）
動工前先讀：`domain/visits.js` 的 `visitActions()`／`cancellableSlots()`、`SPEC.md` 第 6.4 節（已完成是唯讀鎖定區）、
`.scratch/slot-confirm-and-durations-2026-09-16/issues/11`（鎖還是整天的，**這一支不碰它**）

## 現在壞在哪

issue 01 把長按選單上狀態那幾顆改成問**那一段**的 `slotStatus()`，而且**只問那一段**。

客人做了一段就走（ADR-0025，會發生的事）：`closeVisit()` 之後第 0 段 `done`、
第 1 段 `no_show`，整筆 `done` —— 唯讀鎖定。長按第 1 段：

- **修之前（2026-09-16 develop）**：一顆都沒有（`nextStatuses('done')` 是空的）
- **issue 01 之後**：「客戶說可以」與「取消這一段」—— `no_show` 自己准那兩個轉移
- 按下「客戶說可以」：整筆從 `done` 退回 `confirmed`，**不用填更正理由**；
  按「取消這一段」：一天已經結案的日子長出「取消 Abovee」

## 做了什麼

**兩層都要准**，照同一支檔案裡 `cancellableSlots()` 的既有寫法：那一段自己准（`slotStatus()`），
**而且整筆也准**（`nextStatuses(visit.status)`）。取兩份的交集。

這一支**只把 issue 01 放寬的那一格收回來**，不動 `isLocked()` 與「改這一段」—— 那是 issue 11。

## 判準

- 第 0 段 `done`、第 1 段 `no_show`（整筆 `done`）：長按哪一段都一顆狀態都沒有
- 整天都 `no_show`：照舊有「客戶說可以」與「取消這一段」（跟 2026-09-16 一樣）
- issue 01 的判準照樣成立：談定那一段沒有「客戶說可以」、還沒問的那一段有
- 這一行會不會讓一段已經結案、次數已經扣掉的來訪被安靜地改掉？
