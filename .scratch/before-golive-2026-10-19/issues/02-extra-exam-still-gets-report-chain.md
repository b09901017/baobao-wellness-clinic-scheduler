# 健檢做的比買的多：多出來那一次也長報告；補了額度之後那一串重算

Status: done
段：一（xhigh）
動工前先讀：`domain/followups.js` 的 `syncFollowupTasks()`、`examsAwaitingReport()`（`quota` 那一行）、`placeSeconds()`、`owedCounts()`（`cap` 那一行）、`pairsOf()`；`data/customers.js` 的 `entitlementWrites()`、`addEntitlement()`、`addEntitlements()`、`createWithPlan()`；`ui/views/customerDetail.js` 的 `data-add-followup`；ADR-0022、0065、0068、0139、0142、0145；`docs/課程與待辦對照表.md`；`CLAUDE.md`「健檢與二返的關係」「報告到手之後的那一站」兩列；`tests/followups.test.js` 最後那一條隨機定點

## 她要的

> 5.  健檢做的次數比買的多，多出來那一次不會長報告那一串待辦。 好 修

我問：「沒有二返額度的那一次，『約二返』先不長，等你補了額度才長？」她：「是」。

## 為什麼會這樣

`examsAwaitingReport()`：

```js
const quota = Math.max(0, Math.min(exam.done, second.total) - second.done - definite.length);
```

名額被**二返額度的總次數**（`second.total`）蓋住。買 1 次健檢配 1 次二返、做了 2 次健檢 → 第二次健檢一張「追蹤健檢報告」都不長，後面的「寄報告給醫師」「約二返」也就不長。
`owedCounts()` 的 `cap = Math.min(doneCheckups, c.total)` 是「還欠幾場二返」—— 那一格照舊（她：沒有額度就不長約二返）。

**另一個洞**（第一段查到、她同意一起修）：加購（`entitlementWrites()` 的三條路）、客戶詳情「補一筆二返額度」都**不跑** `syncFollowupTasks()` —— 補了二返額度之後，那一次健檢的「約二返」要等她下一次存這位客人的某一筆來訪（或勾一張鏈上的待辦）才長出來。

沒有配二返額度的健檢額度（`pair.followup` 是 null）整條不長：**這一支不動**（客戶詳情有那一句＋「補一筆二返額度」、資料健檢有一列；那是 2026-08 以前的舊資料才有的形狀）。

## 做法（方向）

1. 報告與寄報告的名額不再被 `second.total` 蓋住：每一次做完、沒被二返做完佔掉的健檢都追報告（照 ADR-0139／0142 既有的排序：有連結的先定案 → 報告勾過的 → 已經有待辦的 → 其餘）。**先想清楚「照位置算二返做完」那一段**：二返做完的次數照舊佔名額，只有「二返額度不夠」不再佔
2. 「約二返」照舊受 `owed()` 管（沒有額度不長）
3. 補額度之後重算：`entitlementWrites()` 寫進一筆二返（或健檢）額度時，同一個 commit 帶上 `syncFollowupTasks()` 的結果（讀這位客人的全部來訪與任務 —— **讀不完整就不重算、不擋寫額度**，那是 01 的規則反過來用：寫額度本身不吃來訪）。或在呼叫端寫完之後補一次 —— 選一個不會讓三條購買的路各自漏掉的
4. 確認框：加購那一道要不要講「會長一張約二返」—— 看 `consequences.js` 有沒有現成的 `followupBookingLines()` 可以接；沒有確認框的路就不講

## 過目改的（10/19，主控對過；跟上面衝突時以這裡為準）

Blocked by: 01（「讀不完整就不重算」用 01 的判斷）

- **「名額被二返總次數蓋住」是 ADR-0139 的技術選擇**（「上限跟 `owed()` 同一個」），不是她要的 —— 推翻它補 ADR-0159，0139 不改。`tests/followups.test.js:1354`「二返的總次數是上限：只買 1 次二返、健檢做了兩次、二返做完一次 → 一張都不長」**要翻過來**（先看新的那一條紅）。
- **最重的副作用**：拿掉那一層之後，切換那天匯進來、健檢做的比二返額度多的**舊健檢**，第一次存這位客人時會長出一出生就逾期的「追蹤健檢報告」。ADR-0142 在「約二返」那一圈已經排除這種形狀（照位置算二返做完、從來沒有過任何待辦的那一次不進名額），報告這一圈沒有。**要擋**：從來沒有過任何一張鏈上待辦（含清掉的，`seenTasks()` 那一套）、而且報告的死線已經過了的那一次 → 不長（或照 `importedFrom` 認；選一個講得出理由的，寫進 ADR）。合併檔匯進模擬器量一次：多長的 0 張是匯進來的舊健檢。
- **「補一筆二返額度 → 約二返長出來」那一條路走不到**：那顆按鈕只在 `pair.followup` 是 null 時出現（`customerDetail.js:1053`）。超用的人補額度的真正的路：
  - 改二返那一筆的次數（`customerDetail.js:1887` 的 `updateEntitlement()`）
  - 資料健檢的 `addFollowup`（`data/health.js:433`，**不經過** `entitlementWrites()`）
  - `removeEntitlement()`／`restoreEntitlement()`（次數變少也要重算：收掉不該有的）
  - 加購（`entitlementWrites()` 的三條路）—— 但新買的是**另一對**額度，超用的那一段還扣在舊的那一筆上，舊那一對的二返總數不變；判準裡「補了額度約二返長出來」用改次數那一條路量
  重算要掛在**每一條**改到健檢／二返額度的路上，或掛在它們共用的一支底下 —— 寫進 CLAUDE.md「健檢與二返的關係」那一列
- `customerDetail.js:1105`「補了之後，健檢標成已完成才會長出『約二返』的待辦」—— 重算之後變成假話（已經做完的那幾次補完就長）→ 照 ADR-0070 改成真的會發生的那一句

## 判準

- 這一行會不會讓一次做完的健檢**沒有任何一張**「追蹤健檢報告」，只因為二返額度不夠？
- 這一行會不會替一次「二返已經做完」的健檢多長一張報告？（照位置配的那一段照舊成立）
- 買 1 次、做 2 次：第二次做完 → 長報告；報告勾掉 → 長寄報告、**不長**約二返；補一筆二返額度 → 約二返長出來（不用再存任何來訪）
- `tests/followups.test.js` 的隨機定點照舊全綠；那一條要不要多一種「健檢超用」的狀態（加的話先看它紅）
- 合併檔（`.local/references/import-2026-10-19.json`）匯進模擬器之後，報告／約二返的張數改之前與改之後只印數字比一次 —— 多出來的每一張講得出是哪一種（超用的那幾位）

## 連動

- `docs/課程與待辦對照表.md`、`SPEC.md` 健檢鏈那一節、ADR（補一支 0159 或寫進 0139 的「後果」—— 推翻的是 0139 名額的上限，**補新的一支**）
- `CLAUDE.md`「報告到手之後的那一站」補一句；「健檢與二返的關係」那一列講「補額度會重算」

## 做完時留下的（10/19 段一，`8fb687a` 程式＋收尾那一個 commit）

- **名額**：`examsAwaitingReport()` 不再被 `second.total` 蓋住（ADR-0159，0139 一個字沒改）。超出舊上限的那幾次，`isImported()` 而且 `chainSeen`（`seenTasks()` 那一份裡有沒有過這一次的鏈上待辦）沒有 → 不長。
  「約二返」照舊 `owedCounts()` 的 `cap`；它多回一格 `short`（還欠、額度不夠），收掉時 `reasonFor()` 多一種「二返的次數不夠」
- **重算**：`data/visits.js` 的 `chainAfterEntitlements(customerId, change, { name })` 回 `{ ops, plan, visits, tasks }`；動到的不是健檢或二返 → `null`（不讀）、讀不完整 → `null`（額度照寫）。
  `data/customers.js` 的 `createEntitlement()`／`addEntitlements()`／`updateEntitlement()`／`updateEntitlements()`／`removeEntitlement()`／`restoreEntitlement()` 都把 `ops` 放進同一個 commit；`entitlementWrites()` 先鑄好二返那一筆的 id（`created`）。
  `data/health.js` 的 `applyFixes()`（`addFollowup`）同樣；`createWithPlan()` 不用（還沒有來訪）
- **確認框**：`data/customers.js` 的 `previewChain()`、`data/health.js` 的 `previewFollowupChains()` → `consequences.js` 的 `chainPlanLines()`／`chainCountLines()`。客戶詳情「補一筆二返額度」那一句寫死的「健檢標成已完成才會長」拿掉了；改次數那一張表沒有確認框，不講
- **測試**：`tests/extra-exam-report.test.js`（新）；`tests/followups.test.js` 的上限那一條翻過來、隨機定點多了匯進來的健檢；`tests/consequences.test.js` 一條翻成「講」。
  E2E `76` 改名 `76-incomplete-read-and-extra-exam.spec.js`（`related.js` 跟著改、多登記 `data/customers.js`、`data/health.js`、`customerDetail.js`）、加 I3：簽療程單結掉超用那一次 → 報告；勾掉 → 寄報告、不長約二返；客戶詳情二返那一筆總次數 1 → 2 → 約二返當場出現、一筆來訪都沒動；改回 1 → 收起來。**換回 `ad7e702` 的 `followups.js` 跑過：第一步就紅**
- **合併檔量過**（`import-2026-10-19.json`，node 裡照 `importPlan()` 的形狀組好每一位，舊的 `followups.js` 與新的各跑一次 `syncFollowupTasks()`，只印數字）：34 位，改之前 1 張追蹤健檢報告、改之後 1 張，**差 0 位**；把 `importedFrom` 拿掉再跑一次也是 0 —— 她的資料裡沒有健檢做的比二返額度多的人，切換那天這一支一張都不多長
- 文件：`CLAUDE.md`「健檢與二返的關係」「報告到手之後的那一站」、`SPEC.md` 健檢鏈兩處、`docs/課程與待辦對照表.md`、`docs/常見問題.md`「健檢多做的那一次，怎麼只有報告、沒有『約二返』？」
