# 人員多一格「簡寫」，顯示名是全名

Status: done
來源：決定 1（`d-staff-names`）、`master/report.md` 第一節、`ai/report.md` 第 9 條
動工前先讀：`docs/agents/lessons.md` 第一、六、八節、`spec.md`「決定 1」、
`public/js/domain/naming.js:76-105`（`nameOf()` 已經會「簡寫退回全名」）、`public/js/domain/masterData.js:532-548`（`nameVariants()`）、`:634-653`（`validators.staff()`）、
`public/js/domain/abovee.js:40-110`（`staffFrom()`、`aliasWrites()`）、`public/js/domain/health.js:1755-1800`（`checkSeedStaff()`）、
`public/js/ui/views/masterList.js:386-430`（人員那一張表與它的 `?`）、ADR-0079（診間的全名與簡寫，照它的做法）、0103、0120、0128、
`CLAUDE.md` 連動表「主檔的 `aboveeNames`」「診間的名字、簡寫或清單」「`domain/seed.js` 加一筆、改一格」「新增一個會寫進稽核的欄位」「客戶改名」
Blocked by: —
重現：`node .local/references/audit-2026-10-08/master/r01-staff.mjs`、`…/merge/r02-renamed-master.mjs`（第 1～4 種：改全名之後各對不到幾段；讀真檔，只印數字）

## 她要的

> ・人員的全名要怎麼放？ → 人員多一格「簡寫」，顯示改成全名、簡寫照你設定｜我最希望的是顯示名是全名，人員多一格簡寫，並且要有一支小工具可以幫我先預設好所有人的簡寫(就是現在的顯示名)以及把 21 位全名一次填進 staging 和正式站的「Abovee 上的寫法」，但是可以匯入合併檔或是載入種子資料的時候一並更新上去，就是不知道能不能不要寫進公開的程式碼，但是可以放入資料庫之類的，或是放在合併檔一起匯入也可以

她在健檢時問的那一句（報告「你問的」第 2 題）：

> 醫師的名字為什麼只有一個字？我都給了完整的清單，拍照不是應該預設就認得嗎？

**這一支只做程式那一半**（主檔多一格、畫面、比對）。全名怎麼進資料庫在 20。**人員全名一個字都不進 repo**：測試與文件裡的人寫「某＋名」「姓＋某」。

## 為什麼會這樣

repo 是 public，所以種子只放她口述的叫法（醫師的姓、治療師的名字）。人員主檔沒有簡寫這一格（診間、器材、課程、品項都有）。
現在如果直接把顯示名改成全名：合併檔匯入拿名字一字不差去對 → 58 段的治療師或醫師留空；拍 Abovee「差一個字也算」只比 `aboveeNames` → 全名抄錯一個字就一位都不認。

## 要做的

### 主檔

- 人員多一格 `shortName`（畫面上叫「簡寫」），選填，沒填就退回全名（`nameOf()` 本來就是這樣）。上限照 `nameVariants()` ——
  但那一支的錯誤字眼寫死「別稱」（`masterData.js:540`），人員要印「簡寫」。
- **整份人員裡簡寫不可以重複，也不可以等於別人的全名**（跟 `aliasErrors()` 一樣是整份一起比、不分角色 —— `masterData.js:590-600`）。
  20 的匯入要靠簡寫認出「這一位」，連他是醫師還是治療師都是從認到的那一筆讀的；分角色比的話一位醫師與一位治療師可以同一個簡寫，匯入就分不出來。
- 設定 → 治療師與醫師：那一張表多一格；清單那一列全名後面帶簡寫。那顆 `?` 現在只講治療師的規則，改成兩種人都講。
  **人員那一張的 `parse()`（`masterList.js:423` 起）是白名單，要加 `shortName`** —— 不加的話填了存不進去，而畫面看起來是存好了。
- `audit.js` 的 `FIELD_LABELS` 補「簡寫」。

### 畫面上印哪一個

照診間那一套（ADR-0079）：**窄的地方印簡寫，其餘印全名**。

| 印簡寫 | 印全名 |
|---|---|
| 日／週那一列（`domain/calendar.js:223` 組的 `therapist`）、讀取卡片（`calendar.js:1613`）、試算表的 `二返(…)`（`sheetReport.js:821`）**與 n返 括號裡的醫師（`:840`，同一欄，要一起）** | 三個入口的治療師／醫師丸子、撞期與錯誤訊息（`visits.js:1658/1947`、**資料健檢的撞期 `health.js:704`**）、來訪編輯器抬頭那一行（`visitEditor.js:1386-1388`）、壓表（`schedule.js:1225`）、拍 Abovee（`aboveeConfirm.js:512`）、批次取消、設定頁、試算表來訪紀錄（`sheetReport.js:642/645`） |

審查另外找到、要決定是哪一欄的：`domain/calendar.js:337`（日曆列表自己的撞期句 —— 它拿的是 `:223` 組好的那個名字，那一格改成簡寫之後這一句會跟著印簡寫；
同一列上印簡寫說得通，確認一次）、`sheets/readonly-report.gs:441-442`（`.gs` 只印 app 送過去的字，改的是 `sheetReport.js` 那一側 —— 確認不用動 `.gs`、不用升 `SYNC_FORMAT`）。

**先 grep 一次把印人名的地方列全**（上面是 10/8 找到的，不保證是全部）：凡是從人員那一筆讀 `.name` 的，逐個決定是哪一欄，
結果列進「做完時留下的」。取名字走 `nameOf(row, 'short')`／`fullNameOf(row)`，不要再散一份 `?.name`。

**沒有存人名快照**（審查查過）：來訪只存 `therapistId`／`doctorId`，改名後日曆、試算表、稽核都跟著變；`checkSeedStaff()` 先比 id（`health.js:1766`），種子建出來的人改名不會被叫去再建一位。

### 比對（改名之後每一條都要還認得）

- `staffFrom()`：照片上的字跟**全名**一樣就是那一位（現在全名只在 `aboveeNames` 裡比）；「差一個字」也拿全名比；
  「醫師看開頭、治療師看結尾」那兩條改拿**簡寫**問（沒填簡寫退回全名）。順序與「只有一位符合才算」不變。
- `checkSeedStaff()`：她的主檔上那一位的**簡寫**等於種子的名字 → 同一位，不建、不列。
- 合併檔匯入的 `resolveAssignments()` 在 20 改（同一段，但那一支連著契約）。

## 判準

- 把一位醫師改成「全名＋簡寫＝原本的姓」之後：拍 Abovee 還認得他嗎（全名一模一樣、全名差一個字、只寫姓開頭的舊規則）？
- 兩位同姓的醫師，簡寫不同：各認各的嗎？簡寫一樣存得下去嗎？（存不下去）一位醫師與一位治療師同一個簡寫呢？（也存不下去）
- 設定頁填了簡寫按儲存，重新整理之後還在嗎？（`parse()` 白名單那一條）
- 種子上名字是英文暱稱的那一位、用了異體字的那一位：全名填對之後認得嗎？（這兩位是健檢量到的 28 筆空著的原因）
- 改名之後打開資料健檢：有沒有任何一列叫她再建一位、或把名字改回去？（不可以）
- **沒填簡寫的人**（她自己新增的）：每一個畫面都照舊印全名嗎、有沒有哪裡印出空的？
- 既有來訪存的是 id：改名之後日曆、試算表、稽核上那幾筆顯示的名字跟著變了嗎？有沒有哪裡存的是名字的快照？（列出來；客戶有 `customerName` 快照，人員有沒有要查）
- 拍 Abovee 存檔時 `aliasWrites()` 還會不會把「本來就認得的全名」又寫進 `aboveeNames`？（不寫）
- 產檔那一側（`merge.mjs` 的 `therapistOf()`／`residualNames()`）讀的是種子的名字 —— 確認它不讀簡寫、也不需要讀。
- 重跑 `r01-staff.mjs` 的形狀（用假人員）：全名＋簡寫的主檔，353 筆的寫法裡寫了人的認得幾筆？數字寫進「做完時留下的」。

## 測試

- 單元：`staffFrom()` 每一條（假人員：醫師「王某」簡寫「王」、治療師「某小芳」簡寫「小芳」）；validator；`checkSeedStaff()`；
  `tests/abovee.test.js` 那張 353 筆寫法的表照舊全過。
- 掃原始碼：`public/js` 裡不再有從人員那一筆直接讀 `.name` 來顯示的（名單上的例外附理由）。
- E2E（第四段共用一支新 spec，`64`）：設定頁替一位治療師填全名與簡寫 → 日曆那一列印簡寫、來訪編輯器的丸子印全名。
- **做完跑一次** `node .local/references/staff-scan.mjs`（分支與 `origin/develop` 的差異裡有沒有真的人名）。

## 文件

新的一支 ADR（她的原話兩段；為什麼全名不進 repo；哪裡印哪一個）。`CONTEXT.md` 人員那一條（現在寫「一開始建了三位，其餘由她自己加」，種子已有 21 位）。
`docs/操作手冊.md` 人員那一節（現在寫「治療師與醫師由你自己加」）。`CLAUDE.md` 連動表補一列「人員的全名與簡寫」。

## 做完時留下的（10/9）

- 主檔：`shortName`（設定頁叫「簡寫」）。`validators.staff()` 多兩條：`nameVariants(r, { short: '簡寫' })`（12 字上限、錯誤講「簡寫」）、
  整份人員一起比的撞字（簡寫對簡寫、簡寫對全名、全名對簡寫；全名對全名照舊是 `duplicateName()`）。設定頁 `parse()` 加了 `shortName`、清單那一列印「簡寫 X」、
  「姓名」「簡寫」「Abovee 上的寫法」三顆 `?` 都改了。稽核的 `shortName` 改成「別稱／簡寫」（同一格，課程與器材叫別稱、人員診間品項叫簡寫；`course-groups.test.js` 那一條跟著改）。
- **印人名的地方全部列過**（grep `staffById`、`staff.find`、`.therapistId`／`.doctorId`）：
  - 簡寫：`domain/calendar.js` `agendaFor()`（日／週那一列，`:337` 的撞期句拿同一格，同一列印簡寫說得通）、`ui/views/calendar.js` 讀取卡片、`sheetReport.js` `followupNotes()` 兩處（二返、n返）。
    `.gs` 只印 app 送過去的字，**不用動、`SYNC_FORMAT` 不升**。
  - 全名（不改，或只把 `?.name` 換成 `fullNameOf()`）：`health.js:704` 資料健檢撞期、`visits.js` `staffName()`（撞期句）與 `:1658`（不是醫師）、`aboveeConfirm.js` 丸子與「記住」那一句、
    `schedule.js` 丸子與「這個月記了」那一串、`visitEditor.js` 丸子與抬頭、`bulkCancel.js` `slotLine()`、`sheetReport.js` 來訪紀錄、`abovee.js` `aliasWrites()`、`health.js` `checkSeedStaff()` 的句子。
  - 掃原始碼：`tests/staff-short-name.test.js` 最後一條擋 `staffById[…]?.name` 與 `staff.find(…)?.name` 兩種寫法。丸子那種 `s.name`（map 裡的變數）掃不到，名單上都是全名、照舊。
- 比對：`staffFrom()` 寫法 → **全名一模一樣**（新的第二步）→ 簡寫看開頭／結尾（沒填退回全名）→ 知道角色時全名或寫法差一個字。`checkSeedStaff()` 多認「她的簡寫＝種子的名字」。
- 人員沒有名字快照：來訪只存 id（審查查過，這次又 grep 一次）。
- `r01-staff.mjs`（import 真的那一支，輸入是從她的清單組的主檔）多一種「全名＋簡寫（ADR-0141）」：B 21/21（不知道角色也 21/21）、C 抄錯一個字 20/21、D 353 筆裡寫人的 186 筆認對 186、
  G 日曆那一列 2 個字；**E 合併檔 59 段只對到 1 段 —— 那是 20 的事**（`resolveAssignments()` 還沒比簡寫）。F 21 位都在、改成全名後資料健檢 0 列。
- E2E `64` 的 N1；也跑了 `48`、`51`（12 條全過）。
- ADR-0141（19＋20 一支）、`CONTEXT.md` 醫師那一條、`SPEC.md`「治療師與醫師」、`docs/操作手冊.md` 人員那一條、`CLAUDE.md` 連動表一列「人員的全名與簡寫」。

20 要知道的：`resolveAssignments()` 比簡寫時角色從認到的那一筆讀，「剛好一位」才算；`validate('staff', 候選, { existing })` 已經會擋簡寫撞字，算「要改哪幾位」直接叫它。
