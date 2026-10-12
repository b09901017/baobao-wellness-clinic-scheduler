# 醫師分科、課程指定要哪一科的醫師

Status: done
來源：`../spec.md` 三、四
動工前先讀：ADR-0026、ADR-0058、`domain/masterData.js` 的 `STAFF_ROLES`／`staffWithRole()`／`picksDoctor()`、
`ui/views/masterList.js` 的 `editors.staff` 與課程表單的「來訪時要選醫師」、`ui/views/schedule.js` 的 `doctorField()`（第 1445、1695 行一帶）、
`ui/views/visitEditor.js` 的 `doctorField()`（第 608、935、997 行）、`ui/components/aboveeConfirm.js` 第 390 行、
`domain/visits.js` 第 1750–1762 行（沒選醫師的 warning）、`domain/slotDraft.js` 第 100 行
Blocked by: 02、03（課程表單）

## 她要的

> **四、醫師要分科**：功能／二返、泌尿科、心臟科、復健科。物理治療師是另一種人（操作復能機器的）。

> - 每個課程都要可以自己選：…哪一科的醫師…

> - 羊膜：加購（有次數，像營養針）；選復健科醫師（只有一位）；要簽療程單

## 為什麼會這樣

`config/staff` 只有兩種角色（物理治療師、醫師），醫師沒有科別。課程上「選不選得到醫師」只看 `picksDoctor()`：
A 類一律選得到、其餘看 `requiresDoctor`（ADR-0058：她 2026-08-27 說「門診類的可以選醫生」，不要把已知的規則丟給她記）。
醫師那一排列出**全部醫師**，照主檔順序。Abovee 上醫師有 8 位，app 主檔現在只有三個姓。

## 談定的做法

1. **醫師多一格 `specialties`（字串陣列）**：設定 → 治療師與醫師 → 編輯，角色是醫師時多一排丸子：預設的四科（功能／二返、泌尿科、心臟科、復健科）
   ＋已經有醫師用過的字＋「其他…」自己打。可以勾不只一科。物理治療師沒有這一格（`validate()` 擋：治療師帶科別存不下去）。
   科別**不是一份新的主檔** —— 名單＝預設四科＋大家身上已經有的字
2. **課程多一格 `doctorPick`**：`'none'`（不用醫師）／`'any'`（哪一科都可以）／某一科的字。
   **沒有這一格的課程照舊**：A 類或 `requiresDoctor` → `'any'`，其餘 `'none'`（ADR-0058 的退回留著）。唯一一支：`doctorRuleOf(course)`；
   `picksDoctor(course)` 改成 `doctorRuleOf(course) !== 'none'` —— 呼叫端一個都不用改
3. **排法是順序不是限制**（同常用診間，`preferredRoomIds`）：一支 `doctorChoicesFor(course, staff)` 回
   `{ first, others, preselect }` —— 那一科的醫師排前面、其餘收在「其他醫師」後面；**那一科剛好一位時 `preselect` 是他**（羊膜只有一位復健科醫師）。
   代診那天照樣選得到別人。三個入口（壓表、來訪編輯器、拍 Abovee）都用它；`preselect` 只在**新的一段、還沒選醫師**時套，既有的一段不動
4. **課程表單**：「來訪時要選醫師」那個開關換成三選一（不用／哪一科都可以／指定一科＋一排科別丸子）。舊課程打開時照 `doctorRuleOf()` 畫好。
   `requiresDoctor` 留在資料上、存檔時跟著寫（`doctorPick !== 'none'`），讀的那一側只認 `doctorRuleOf()`
5. **種子**：二返 → 功能／二返；復健科醫師門診 → 復健科；心臟科評估 → 心臟科。新的兩門（功醫門診、羊膜）在 12。
   種子醫師（夏、許、李）**不填科別**（她還沒說誰是哪一科，第 1 題；她自己在設定填）
6. **ADR-0120**：延伸 ADR-0058 —— 門診的退回留著；新增的「指定一科」是排序不是限制；為什麼只有一位時先選好

## 牽連

- `validateVisit()` 沒選醫師是 warning 不是 error（ADR-0002）—— 不變
- 試算表的來訪紀錄印醫師名字（`sheetReport.js` 的 `log`）—— 不變
- `staffFrom()`（拍 Abovee 認人）在 07 改成看角色；科別不參與認人
- 物理治療師那一排（`staffWithRole(THERAPIST_ROLE)`）一個字都不動 —— 「選錯人是實際傷害」那條界線（CONTEXT.md）
- `aliasWrites()`／`validators.staff()` 的「兩位不可以同一個寫法」不受影響
- 稽核那一句（`describeParts()`）照舊

## 判準

- 舊資料：沒有 `doctorPick` 的 A 類課程照樣選得到醫師；非 A、沒開 `requiresDoctor` 的照樣選不到？（逐一比 `picksDoctor()` 舊的答案）
- 羊膜指定復健科、主檔只有一位醫師勾了復健科：壓表選羊膜之後醫師那一排已經選好他；其他醫師收在「其他醫師」後面、點得到？
- 復健科有兩位：一個都不預選，兩位排在最前面？
- 物理治療師的編輯表看不到科別那一排；硬塞一個科別進去存不下去？
- 一位醫師勾兩科：兩門不同科的課都把他排在前面？

## 審查之後補的（2026-10-05，subagent 對著程式碼查過；跟上面衝突的地方以這一節為準）

- 稽核：`FIELD_LABELS` 補 `doctorPick`、`specialties`

## 做完時留下的

- 判斷只在 `domain/masterData.js`：`DEFAULT_SPECIALTIES`、`specialtyNames()`、`doctorRuleOf()`（`DOCTOR_NONE`／`DOCTOR_ANY`／某一科）、
  `picksDoctor()`（＝不是 `none`，呼叫端一個都沒改）、`doctorChoicesFor()` → `{ first, others, preselect }`
- **那一科一位都沒有（她還沒填科別）→ 退回全部列出來、不預選**。種子醫師不填科別，所以在她填之前三門門診的醫師那一排
  跟以前長得一模一樣（E2E D5 釘著）
- `preselect` 套在哪：壓表選額度那一下與換器材換了課程那一下（`pickDoctorIfOnly()`）；來訪編輯器的 `blankSlot()`、
  `readDraft()` 裡**換了課程而且畫面上還沒選醫師**那一下。**沒換課程的一律只讀畫面** —— 她存過「還沒定」的那一段不會被填回來。
  **拍 Abovee 不套**（照片上寫著是誰；那一排只照 `first`、`others` 的順序排，全部看得到 —— 08 重做確認層時再決定要不要收合）
- 「其他醫師」的收合沿用品項那一排「換一款」的同一組 class（`chip--tucked`、`[data-tuck]`、`[data-chip-more]`），壓表自己畫、
  來訪編輯器走 `f.chips()` 的 `tuckAfter`／`moreLabel`
- 設定 → 治療師與醫師：科別那一塊（`[data-specialties]`）角色不是醫師時藏起來，存檔時清空；清單那一行灰字多印科別
- 設定 → 課程：「來訪時要選醫師」從開關變成一排丸子（不用／哪一科都可以｜指定一科…）。**A 類的課也關得掉了**
  （以前「這一格開不開都一樣」）。`requiresDoctor` 存檔時跟著寫
- 種子：二返 → 功能／二返、復健科醫師門診 → 復健科、心臟科評估 → 心臟科；`GROUP_DEFAULTS` 醫師門診帶 `doctorPick: 'any'`
- ADR-0120、SPEC 5.3、CONTEXT「科別」、對照表一之二、操作手冊七之四／七之五、`CLAUDE.md` 連動表加一列
- `sw.js` v147。新 spec `48-doctor-specialties`（D1–D6）。相關 E2E 28 支、17.6 分鐘、204 過

