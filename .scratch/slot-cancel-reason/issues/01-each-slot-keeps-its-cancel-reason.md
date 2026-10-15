# 只取消其中一段時，取消理由記在那一段上

Status: todo
Blocked by: —（不擋 abovee-status-follows-photo 那一輪；那一輪的 04 照現在的做法：整天都取消才寫照片上的「取消原因」。這一支做完，04 的那一格改成寫在那一段上）
動工前先讀：ADR-0081（時段是原子單位）、ADR-0089（取消理由那一格搬到確認框）、ADR-0071（稽核欄位）；
`domain/visits.js` 的 `applyStatus()`、`settle()`、`applyConfirmation()`；`ui/components/dialog.js` 的 `confirmWithReason()`；
CLAUDE.md「一段來訪的狀態」「新增一個會寫進稽核的欄位」「一筆來訪的讀取卡片」三列

## 她要的

第零段（10/15）發現、她 10/15 回：「照你的建議：另外開一小支，補『每一段自己的取消理由』（注意會不會牽連別的地方），不擋這一輪」

## 為什麼會這樣

取消理由是**整筆的**（`visit.cancelReason`）。`applyStatus(…, { slotIndex, reason })` 只取消一段時走 `settle()`，
而 `settle()` 只在**推出來的整筆狀態是已取消**時才寫 `cancelReason` —— 那一天還有別段活著，她在確認框打的那一句就丟了，
一個字都沒有存。日曆長按「取消這一段」、批次取消、來訪編輯器那顆 × 都是這樣。拍 Abovee 照片上的「取消原因」也會碰到（04）。

## 10/15 清查（段一順手 grep 的，動工時再 grep 一次）

- **寫的**：`visits.js` 的 `applyStatus()`（整天那一條）、`settle()`（只取消一段推成整天取消時）、`applyConfirmation()`（「客人說這個時間不行」那一條，寫死一句、`released: true`）
- **讀的**：只有稽核（`audit.js` 的 `FIELD_LABELS.cancelReason`）。**畫面上沒有任何一處印它** —— 連整天取消的那一句也只在稽核看得到。
  所以這一支最大的問題不是存在哪，是**她要在哪裡看到**（讀取卡片那一段？日曆那一列？試算表？）—— 先問她
- 時段上的格子進稽核是整包 `slots` 陣列（`formatValue()` 印成「N 筆」）—— 存在 `slot.cancelReason` 的話稽核那一句看不到它，要另外想
- `slotDraft.js` 組新的一段時整筆的那幾格寫 `cancelReason: null`；`mergeImport.js`、`legacyImport.js` 也寫 null。新的一段上不用帶
- `firestore.rules` 不驗時段裡的格子（只驗 `slots` 是非空陣列）；備份與還原整筆搬，不用改
- 試算表（`sheetReport.js`、`.gs`）沒有讀它

## 要做的（先問她「要在哪裡看到」再定）

1. 取消一段時把理由記在那一段上（例如 `slot.cancelReason`），整天取消照舊也寫整筆那一格（舊資料、稽核那一句還讀它）
2. 讀：`slotStatus()` 那種「沒有那一格就退回整筆」的退路（舊資料）
3. 她要看到的那一處畫出來；稽核那一句要不要講
4. 拍 Abovee 04 的「改成已取消」改成寫那一段的

## 判準

- 一天兩段、只取消一段、打了理由：那一段身上有那一句；另一段沒有；整筆的 `cancelReason` 照舊是空的（沒有整天取消）
- 整天取消：照舊寫整筆那一格
- 舊資料（只有整筆那一格）讀得出來
