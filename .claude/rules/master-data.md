---
paths:
  - "public/js/domain/seed.js"
  - "public/js/domain/masterData.js"
  - "public/js/domain/health.js"
  - "public/js/ui/views/masterList.js"
  - "public/js/ui/views/preferences.js"
---

# 主檔與種子：人員、課程、醫師、分類、排序權重

**每一節的標題是「改了這個」，底下每一條是「一定要一起檢查」的**（從根目錄 `CLAUDE.md`「容易漏掉的連動」那張表搬來，標題照舊）。
新長出來的連動補進對應的那一節（沒有就加一節）；不屬於這一份的補進別份或開新的一份，並加進根目錄 `CLAUDE.md` 的索引。

## 人員的全名與簡寫

- **`name` 是全名、`shortName` 是簡寫**（ADR-0141，2026-10-09）。
- 印法照診間那一套：**簡寫只在四處** —— 日／週那一列（`domain/calendar.js` 的 `agendaFor()`，那一列的撞期句跟著）、讀取卡片（`visitReadHtml()`）、試算表的 `二返(…)` 與 n返 括號（`sheetReport.js` 的 `followupNotes()`）、拍 Abovee 收著的那一行（`aboveeImport.js` 的 `rowGlance()`，ADR-0170；點開之後的丸子照舊全名）；其餘印全名。
- **取名字只走 `nameOf(row, 'short')`／`fullNameOf(row)`**，`tests/staff-short-name.test.js` 掃原始碼盯著沒有人從人員那一筆直接讀 `.name`（`staffById[…]?.name`、`staff.find(…)?.name`，**先存成變數再讀的也算**）。
- 簡寫**整份人員一起比、不分角色**（`validators.staff()`：簡寫對簡寫、簡寫對全名、全名對簡寫）—— 合併檔匯入靠簡寫認人、角色從認到的那一筆讀。
- 比名字的三處都要認得簡寫：拍 Abovee 的 `staffFrom()`（寫法 → 全名一模一樣 → 簡寫看開頭／結尾 → 差一個字也比全名）、資料健檢的 `checkSeedStaff()`（她的簡寫＝種子的名字就是同一位）、合併檔的 `resolveAssignments()`（名字對不到比簡寫，剛好一位才算）。
- 產檔那側 `merge.mjs` 讀種子的名字，不讀簡寫。
- **全名不進 repo**：只在 `.local/references/staff-names.json`，跟著合併檔 v6 進來

## 課程的「設定暫定」（`course.provisional`）

- **只畫一個小標**（設定 → 課程 清單那一列的徽章、上面那一句「還有 N 門的設定是暫定的」），**沒有任何規則讀它**：判斷只有 `masterData.js` 的 `isProvisional()`（只認 `true`），`tests/provisional-courses.test.js` 掃原始碼 —— `public/js` 底下只有 `masterData.js` 與 `masterList.js` 可以問那一格。
- 種子上標著的是 2026-10-06 補的六門（Abovee 上一筆都沒排過、每一格照同一類的課先猜）。
- 字是「設定暫定」，**不要寫「待確認」**（那是來訪的狀態）。
- 新增一個要跟著它走的行為之前先想：她看到的只是一個小標，不會知道那件事跟著變了

## 設定頁裡收起來的欄位（`<details class="foldout">`）

- **裡面有錯時要自己打開**，兩條路都要接（`masterList.js` 課程那一張，2026-10-06 issue 06、17）：瀏覽器擋下的（`min` 之類）走 `invalid`（**不冒泡，用 capture**）—— 關著的 `<details>` 裡一格不合法時，瀏覽器想把焦點移過去卻移不到，按「儲存」**一個字都不講**；domain 驗證講到的走 `onErrors()`（比錯誤字眼：`MORE_WORDS`、「指定幾間」）。
- **新收一段就要把它的錯誤字眼加進 `onErrors()`**，不然那一句錯誤講的是一格看不到的欄位。
- 收著的那一行印現在的值（`foldout__now`），不是一個空的標題

## 一門課要不要醫師、哪一科

- 只寫在 `domain/masterData.js`（ADR-0120）：`doctorRuleOf()`（`course.doctorPick`：`none`／`any`／某一科；**沒有那一格照 ADR-0058 退回** —— A 類或 `requiresDoctor`）、`picksDoctor()`（＝不是 `none`）、`doctorChoicesFor()`（`{ first, others, preselect }`）。
- **指定一科是排序不是限制**（同 `preferredRoomIds`）：那一科排前面、其餘收在「其他醫師」後面；那一科一位都沒有就退回全部列出來。
- **三個入口（壓表、來訪編輯器、拍 Abovee）都走 `doctorChoicesFor()`，不可以自己 `staffWithRole(…, DOCTOR_ROLE)` 排一次**（`tests/doctor-specialties.test.js` 掃原始碼）。
- `preselect`（那一科剛好一位）**只在新的一段、還沒選醫師時套**：壓表選額度／換器材那一下（`pickDoctorIfOnly()`）、來訪編輯器的 `blankSlot()` 與 `readDraft()` 換了課程那一下；**拍 Abovee 不套**（照片上寫著是誰）。
- 科別（`staff.specialties`）不是主檔，名單是 `specialtyNames()`；物理治療師帶著科別存不下去。
- `requiresDoctor` 存檔時跟著寫，讀的那一側只認 `doctorRuleOf()`。
- **設定頁那一排是四選一**（診間／物理治療師／醫師／都不用，ADR-0130）：那一顆與 `assigns`／`doctorPick` 兩格的對照只在 `assignKindOf()`／`assignFieldsFor()`，清單那一行走 `assignSummaryOf()`（以前印 `assigns`，醫師的課寫「都不用」）；資料上兩個都有的舊課，她沒動那一排就照舊存回去

## `domain/seed.js`（種子）加一筆、改一格

- `loadSeed()` **只建不覆蓋**，既有資料庫不會跟 —— **每一個改動配一列資料健檢**（`domain/health.js`）：新的一筆走「種子有、她沒有」那幾列（課程 `checkSeedCourse()`、器材、診間、點滴 `checkSeedIvProduct()`、人員 `checkSeedStaff()` —— 人員的「同名」要比別的寬：拍 Abovee 認人靠名字的一部分，所以她用全名建的算同一位、種子的名字以她既有那一位開頭／結尾的**不建只列**；建新醫師的那一顆同時補既有醫師空著的科別 `fix.also`，不然只按那一顆時原本的醫師會被收進「其他醫師」），新的一格或改掉的值走 `checkSeedBlanks()`（一格一列、`setMasterFields`）或那一格自己的那一列。
- **三條護欄每一列都要有**：她改過的不動（空的／還是舊種子值才報）、一個種子 id 都沒有的資料庫不念、她自己已經建了同名的不再建（`sameNamed()`，ADR-0125）；補上去的值要過得了 `validate()`，不然按完那一筆在設定頁存不回去。
- **種子的名字還有三個地方在讀**：產檔那側 `merge.mjs` 的 `TOKENS` 與 `ivProductOf()`（兩個字的前綴比對 —— 新品項的前兩個字剛好是一門課的開頭就會誤認，2026-10-05「營養守護」吃掉「營養師」）、`roomOf()` 讀診間的名字（`.8A` → 種子上的點滴8A，走 `bedRoomOf()`）、**同一支也讀人員的名字（連醫師）**：`therapistOf()` 拿每一個名字對整句做 `includes`、`residualNames()` 把名字扣掉 —— 加一位只有一個字的人就會中同姓的客戶（2026-10-06 補「林」醫師，真檔跑出 21 段被掛上他）。
- 現在先把客戶自己的名字拿掉（`withoutNames()`）、種子上一個字的名字不自動當認得的雜訊（要她在別名表 `doctors` 列），`tests/merge-staff-names.test.js` 盯著；**改了人員、課程名、診間寫法之後拿她的真檔照基準比一次**（`.local/references/merge-baseline-2026-10-06/baseline.mjs <標籤> --vs 00-baseline`，只印數字）、拍 Abovee 的 `courseFrom()`（`aboveeNames`）、E2E 裡寫死的筆數（設定頁那幾支：47、16、17）。
- `seed.js` 只登記在種子是主角的那幾支 spec（`related.js` 的註解），**改了種子要另外想一次哪幾支 spec 寫死了筆數或自己建了同名的東西**

## 設定 → 課程 的分類（`course.group`）

- **只管畫面怎麼分組**：設定 → 課程 那一頁、新增時帶哪一組預設值、加購那一排先分類再項目（2026-10-06，`buy.js`）。
- 沒有任何規則讀它（`tests/course-groups.test.js` 掃 `domain/`：只有 `masterData.js` 問 `.group`，資料健檢補空格那一支例外；`buy.js` 只准問 `groupCourses()`）。
- 推導只在 `masterData.js`：`groupOf()`（沒填＝「其他」，存成 `null`）、`coursesByGroup()`、`groupCourses()`、`courseDefaultsFor()`（`GROUP_DEFAULTS`：只在建立那一刻抄一次）。
- 新增一個要跟著分類走的行為之前先想：她改分類的時候不會知道那件事跟著變了

## 設定 → 排序權重 的「回復預設值」

- **只蓋那幾格**：`seed.js` 的 `PREFERENCE_KEYS`／`preferenceDefaults()`（2026-10-18 段二）。
- 整份 `saveSettings(DEFAULT_SETTINGS)` 會順手清掉試算表推送的網址與密鑰、她改過的 LINE 模板 —— 畫面上一句都不講，試算表安靜地不再推。
- **那一頁多一格就加進 `PREFERENCE_KEYS`**；`tests/preferences-reset.test.js` 也掃沒有任何一頁整份蓋回去
