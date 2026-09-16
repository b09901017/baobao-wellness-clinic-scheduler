# 日曆併進「已確認」的那一天，整筆的狀態沒有跟著時段重推

Status: done
Blocked by: 06, 07
來源：`../spec.md`（報告 §1.3）；已知，`.scratch/coverage-gaps/issues/03` 寫過
動工前先讀：`.scratch/coverage-gaps/issues/03`、`docs/adr/0081`（時段才是原子單位）、
`domain/visits.js` 的 `withExtraSlot()`／`visitStatusFrom()`

## 現在壞在哪

同一件事，兩個入口兩種結果：

| 入口 | 走哪一支 | 加一段進「已確認」那一筆之後 |
|---|---|---|
| 壓表 | `withExtraSlot()` | 整筆**退回「待確認」**，`confirmedAt` 一起清掉 |
| 日曆 | `withNewSlot()`（`ui/views/visitEditor.js:236`）| 整筆**停在「已確認」** |

時段那一層兩邊都對（新的那一段是 `pending_confirm`）。壞的是整筆那一格，
而 `data/visits.js` 的 `save()` 也不重推 —— 它只跑 `withSlotStatuses()` 與 `withSlotNotes()`。

拿 domain 跑出來的四個後果（不是推論）：

```
存進去的整筆狀態          : confirmed
visitStatusFrom() 說應該是 : pending_confirm
待辦「跟客人確認時間」列得到嗎: false
當場長出來的任務          : Examine(死線 9/19)、耀聖(死線 9/19)
```

**一段從沒問過客人的時間，在待辦上沒有任何一列會叫她去問**，而且 A 類的登記當場長出來。

`tests-e2e/specs/25-visit-editor-one-slot.spec.js` 的 **V4b 掛著 `test.fail()`** 指著這件事。

## 做法

issue 03 建議的是「日曆這條路改走 `withExtraSlot()`」，而它先問了兩件事，兩件都要答完：

1. `withExtraSlot()` 的 `reopened` 會清掉 `confirmedAt` —— 要確認日曆這條路走得到
   「既有那幾段先把自己的狀態落下來」那一段（`withExtraSlot()` 裡已經有），
   不然她會被要求把**已經談定的那兩段**重問一次
2. 既有那幾筆已經歪掉的：資料健檢的「來訪的狀態跟它的時段對不起來」列得出來、
   也有一鍵重推，所以**不做資料遷移**。要數一下她現在有幾筆

**修好之後把 V4b 的 `test.fail()` 拿掉** —— 不拿掉的話它通過時整份會紅。

## 判準

- **這一行會不會讓她已經談定的那幾段被重新問一次？**
- 併一段進一筆已確認的來訪 → 整筆變 `pending_confirm`、既有那幾段還是 `confirmed`
- 那一筆出現在待辦中心的「跟客人確認時間」
- 新那一段是 A 類時，Examine 與耀聖**不會當場長出來**（客人還沒答應）
- 壓表那條路一個字都沒變
- V4b 轉綠並拿掉 `test.fail()`
