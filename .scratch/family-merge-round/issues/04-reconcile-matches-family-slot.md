# 月底對帳：家人扣的那一列對到 app 上「誰來的」那一段

Status: todo
Blocked by: 01、03
動工前先讀：`.claude/skills/month-end-reconciliation/SKILL.md`、`scripts/reconcile.mjs` 的 `paidByOf()`／`familyBucket()`／`familyMissing`、`tests/month-end-reconciliation.test.js`、`.claude/rules/abovee.md` 最後一節

## 她要的

（同 family-charge issue 的判準）
> 月底對帳：那一列不再列在「Abovee 上有、app 裡沒有這個人」（對到 app 裡那一段）

## 為什麼會這樣

PR #236 已經把家人扣的那一列算到被扣的那一位（`familyBucket()`），對不到時記 `familyMissing`。
app 現在有「誰來的」之後，對帳應該認得「被扣那一位身上、同時間、有誰來的」那一段就是這一列；8/27 那種「記在太太身上、誰來的空著」也要照樣對得上（只是可以提一句「沒寫誰來的」）。

## 要做的

1. 家人那一列對到被扣那一位同時間那一段時算對上；結果頁看得出是家人來的。
2. 誰來的空著（舊資料）照舊對得上、不列成要處理（要不要另列一小塊「家人來的、app 沒寫誰來的」自己判斷，**照 `reconciliation-report-format`：小表、不寫推論段落**）。
3. `tests/month-end-reconciliation.test.js` 加案例。

## 判準

- 10/29 那一件補進 app 之後重跑 10 月：那一列不在「app 裡沒有這個人」、也不在 `familyMissing`。
- 8/27 那種（誰來的空著）：照舊對上、次數不變。
- 其他月份的三個數字（5 月 2=2=2…10 月）一個都不變。

## 過目補充（2026-11-09）

- 對帳自己組抄字（`COLS`），沒有那兩欄的話 03 不影響對帳；`assemble.mjs` 已經抄 `actualChartNo`／`relation`。要不要讓 `readAbovee()` 那一側也拿到（加進 `COLS`），加的話 `unknown` 分支的 `familyMissing` 改走 `readAbovee()` 的結果 —— 段二定、寫進「做完時留下的」。

## 做完時留下的

（做完寫）
