# 醫師要進 app，約二返時用選的（推翻 SPEC 第 12 節）

Status: done
回報者：使用者，2026-08-20
動工前先讀：`SPEC.md` 第 12 節（種子資料）、第 5.3 節（`config/staff` 與時段的形狀）、
`CONTEXT.md` 的「治療師」、`docs/adr/0022-followup-entitlements-are-expanded-in-pairs.md`

## 她要什麼

> 二返的醫師我覺得也記入 app 好了，目前總共有 **夏、許、李** 三位，
> 這樣我預約二返的時候就可以選醫生了

## 這推翻了一個既有決定

`SPEC.md` 第 12 節寫著：

> 醫師（夏、許、李）**不放進 `config/staff`** —— 他們不會被指派到時段上，
> 只出現在她的速記裡。

現在他們要被指派到時段上了。**照 `CLAUDE.md` 的規矩要補一支 ADR，不要改掉舊的**，
並更新 `SPEC.md` 第 12 節與第 5.3 節。

它也解掉舊表的一個缺口：舊試算表的二返註記寫成 `7/13 二返(夏)`，括號裡就是醫師
（`docs/legacy/README.md` 第 6 節）。醫師進了 app，報表那句才印得出括號裡那個字，
不然只能要她自己打（`issues/05`）。

## 建議的做法

### 1. 醫師是 `config/staff` 的第三種角色

`domain/masterData.js` 現在是 `STAFF_ROLES = ['物理治療師']`，
註解寫著「護理師目前不納入排程」。加上 `'醫師'`。

種子資料（`domain/seed.js`）補三筆：夏、許、李。
她們在主檔頁本來就改得動（`SPEC.md` 第 8.8 節：診間與治療師清單要能自行新增修改）。

**`CONTEXT.md` 要跟著改。** 現在「治療師」的定義是「執行療程的物理治療師，
是排班時要指派的對象」，而醫師是**另一種**要指派的人。兩個詞的界線要寫清楚，
不要讓「治療師」變成「所有會被指派的人」的統稱 —— 那會讓復能的治療師選單
跑出三位醫師來。

### 2. 課程多一個 `requiresDoctor`，時段多一個 `doctorId`

**不要去動 `assigns`。** 它是單選的（`'therapist' | 'room' | 'none'`），
而二返是 `assigns: 'room'` —— 它**同時**要診間和醫師。塞進去就得把它變成陣列，
那會動到 `roomsForCourse()`、驗證、來訪編輯器每一個讀它的地方。

改用和 `requiresEquipment` / `requiresIvProduct` **完全一樣的模式**：
課程上一個選填的布林，時段上一個選填的 id。那兩個旗標已經在那裡了，
第三個不會讓人意外，`domain/visits.js` 的驗證也照同一個形狀寫。

種子資料先只開二返（`course-followup`）。**復健科醫師門診與心臟科評估其實也有醫師**，
但她只講了二返 —— 做成主檔上的開關，她想開再開，不用改程式（理由同 ADR-0022）。

### 3. 來訪編輯器多一個選單

`requiresDoctor` 為真時才出現，選項是 `role === '醫師'` 的 staff。
和器材、品項那兩個選單長一樣，用點的不打字（`SPEC.md` 第 1 節）。

## 要一起檢查的地方

- `firestore.rules` 的 `validVisit()` / `validStaff()` 形狀檢查
- `domain/sheetReport.js` 的 `syncBundle()` 已經有 `nameOf('staff', slot.therapistId)`，
  醫師照同一條路
- `domain/audit.js` 的欄位名稱對照表要認得 `doctorId`
- 舊資料：既有的二返來訪沒有 `doctorId`，**一律當成 null，不要猜**
  （ADR-0011 的同一條原則：不知道的不假裝知道）
- 匯入器（`domain/legacyImport.js`、`domain/mergeImport.js`）：
  舊表的 `(夏)` 現在**解析得出來**了，但要不要在這一支順便接上，先問她 ——
  那是一次性的補資料，和「以後怎麼記」是兩件事

## 不要順手做的事

- 不要把醫師混進復能的治療師選單。復能三器材要的是**物理治療師**（`CONTEXT.md`），
  選錯人是實際傷害。
- 不要因為醫師進了 `config/staff` 就把他們納入衝突檢查。她看不到醫師的班表
  （那在 Abovee 上），用看不到的資料去提示只會提示錯 —— ADR-0002 的判準。


## Comments

**2026-08-20 — 做完了。** `npm test` 從 586 變成 602 全過。

| 在哪裡 | 做什麼 |
|---|---|
| `domain/masterData.js` | `STAFF_ROLES` 加醫師；新增 `THERAPIST_ROLE` / `DOCTOR_ROLE` / `staffWithRole()`；主檔標題改成「治療師與醫師」 |
| `domain/seed.js` | 夏、許、李三筆；`course-followup` 開 `requiresDoctor` |
| `domain/visits.js` | 沒選醫師 → warning；指到不存在的人或指到治療師 → error；衝突檢查明文不比醫師 |
| `ui/views/visitEditor.js` | `requiresDoctor` 才出現的醫師選單；**治療師選單改用 `staffWithRole()`**；二次確認的摘要帶上醫師 |
| `ui/views/masterList.js` | 課程多一顆「來訪時要選醫師」；角色欄補一句提示 |
| `domain/sheetReport.js` | 二返註記印得出 `8/8 二返(夏)`；來訪紀錄多一個 `doctor` |
| `sheets/readonly-report.gs` | 來訪紀錄那一行印「夏醫師」 |
| `domain/audit.js` | 認得 `requiresDoctor`（順手補上 `role` 與另外兩個 `requires*`，它們本來也是原文顯示） |

補了 [ADR-0028](../../../docs/adr/0028-doctors-are-assignable-staff.md)，
`SPEC.md` 第 5.3、12、13 節與 `CONTEXT.md` 跟著更新。**ADR-0022 沒有被推翻。**

### 三個和這一支原本寫的不一樣的決定

1. **沒選醫師是 warning，不是 error。** 原本打算照 `requiresEquipment` 那樣擋。
   但她的舊表上有 `二返(8/5)` 這種寫法 —— **日期敲定了、醫師還沒定**，
   那是真的會發生的順序，擋下來等於逼她編一個。連帶決定報表的寫法：
   沒選醫師印 `8/8 二返`，**不印 `8/8 二返()`**，因為空括號在她的寫法裡
   是「還沒約」的意思，印出來會反過來騙人。
   反過來，**指到一個不存在的人、或把物理治療師填進醫師欄是 error** ——
   那是資料壞了，不是還沒決定。

2. **`firestore.rules` 不用改。** 這一支原本寫「`validVisit()` / `validStaff()`
   形狀檢查要動」。實際看過：`validStaff()` **不存在**（主檔走
   `config/{docId=**}`，沒有任何形狀檢查），而 `validVisit()` 只驗
   `slots` 是不是非空的 list，不看時段裡面。所以前端這一層是目前唯一
   擋得住「醫師指到治療師」的地方，這件事寫進 ADR 的 Consequences 了。

3. **順手修掉一個已經存在的洞。** 治療師選單原本是
   `all.staff.filter((s) => s.active !== false)` —— **不看角色**。
   醫師一進 `config/staff`，那個選單就會跑出夏、許、李，
   而復能三器材要的是物理治療師（`CONTEXT.md`）。所以 `staffWithRole()`
   不是為了醫師選單才做的，是為了治療師選單不要壞掉。

### 沒做的兩件

- **匯入器不接 `(夏)`。** 這一支原本就說「先問她」。它是一次性的補資料，
  和「以後怎麼記」是兩件事，`domain/legacyImport.js` 與 `mergeImport.js` 沒動。
- **復健科醫師門診、心臟科評估沒開 `requiresDoctor`。** 她只講了二返；
  主檔上是一顆勾，她想開再開，不用改程式（同 ADR-0022 的理由）。

### 她要做的一件事

`sheets/readonly-report.gs` 改了一行（來訪紀錄印醫師），要重貼一次進試算表的
Apps Script。如果還沒貼過第一版，那就直接貼現在這一版。
