# 月底對帳：家人扣的那一列對到 app 上「誰來的」那一段

Status: done
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

- **過目補充那一題定了：加進 `COLS`**（`實際扣課病歷號`→`actualChartNo`、`關係`→`relation`）。家人那一列在 `readAbovee()` 裡就記在被扣的那一位身上、對到他身上有「誰來的」的那一段（03 的比對），對帳不用再自己認一次：
  - `familyBucket()` 拿掉、次數那一圈不再特別處理家人（`who = item.customerId`）；`unknown` 那一支的 `familyMissing` 拿掉（認得被扣者的列不會走到那裡）
  - **新的一列（app 上沒有那一段）、照片課程完成、是家人那一列 → `familyMissing`**（句子「家人（王小明，夫妻）用這一位的額度做了…」，該做的改成「在 app 拍一次 Abovee 補記，會自動寫好誰來的」）
  - **對到誰來的空著的舊段（8/27 那種）→ 照舊對上、次數不變，另外一件小字 `familyNoAttendee`**（「…來的，app 那一段沒寫誰來的」，收在最後一塊「不影響」）—— 照 `reconciliation-report-format` 不另開一塊表、不寫推論
  - `coveringSlot()`（合併扣課後一半）也問誰來的一樣：本人同一個時間也來、app 只記本人那一段時，家人那一列不會被講成「沒標合併扣課」（同一個形狀，寫測試時抓到）
  - 來的人不再另外列在「app 裡沒有這個人」（號碼認不得的才列）；結果頁 Abovee 那一格接「王小明（夫妻）來」（`report.mjs` 的 `aboveeCell()`）
  - `paidByOf()` 留著：畫面上「扣 X 的號碼」那一行與舊表那一步（`payerOf`）還在用
- **真資料重跑 5～10 月**（11/9 的快照與截圖，只印數字）：三個數字一個都沒變（2=2=2、29=28=28、30=31=31、49=50=50、70=70=70、99=98=98）；8 月多兩件 `familyNoAttendee`（8/27 先生那兩段），10 月那一件照舊是 `familyMissing`（10/29，07 補進去之後就會對上 —— 測試用假資料釘著）。
- 測試：`tests/month-end-reconciliation.test.js` 改兩支（strangers 不再算來的那一位；舊段那一件在 `minor`）、加三支（補進去之後對上、本人同時也來不被搶、號碼認不得照舊）。`SKILL.md`「2026-11-09 全部重對」那一段、`abovee.md` 最後一節各補一條。
