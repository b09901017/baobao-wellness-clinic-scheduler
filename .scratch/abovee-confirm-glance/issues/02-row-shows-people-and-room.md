# 02：拍 Abovee 每一列直接印治療師／醫師／診間，已經記了的印 app 的名字

Status: done
Blocked by: —

## 動工前先讀

- `spec.md` 第一件、第三件
- `CLAUDE.md` 連動表「拍 Abovee 記很多段」「人員的全名與簡寫」「診間的名字、簡寫或清單」「一段來訪要指派誰／哪裡」「一段來訪在畫面上叫什麼」
- `public/js/ui/components/aboveeConfirm.js` 的 `slotOf()`、`rowHtml()`（約 418–560 行）、點開那一塊畫醫師／診間的地方（約 590–670 行）
- `public/js/domain/calendar.js` 的 `agendaFor()`（約 185–235 行：`room`、`therapist` 怎麼印）

## 她要的

> 第一 : 我拍完照辨識完後，能不能也看到診間和醫師 不要我每個都要點開 像日曆那邊一樣 IN 60 某璇 或是像IL 60 治2，能讓我一眼確認，不對的我在點開就好

> 第三 : 想請你幫我確認，我辨識三返，有辨識到醫生嗎 ? …還是如果是像沒有綁健檢的三返那種，一開始便認不出來他是什麼就不會辨別醫師或診間 ?

## 為什麼會這樣

- 列上那一行只有時間、名字、`what`、標籤（`rowHtml()`）。`what` 是 `slotOf(item)?.slot` 的 `slotName(…, 'short')`，組不出時段就退回照片上的原字 `item.row.course`
- **已經記了的列**：`slotOf()` 拿 `picksOf(item)` 交給 `slotFromPicks()` —— 已經記了的列沒有挑額度，多半組不出來，所以截圖上印的是 `EECP60`、`IN 60`（照片原字），不是日曆上的名字
- **還沒按任何一顆的列**（照片上三返、還沒按「健檢不是我排的」）：`slotFromPicks()` 組不起來 → `built.course` 是 null → 點開那一塊的器材、診間、醫師幾排全部不畫。
  可是 `readAbovee()` 讀照片那一下已經認好了：`item.course`（`courseFrom()`，三返 → 二返那門課＋`nth: 3`）、`item.doctorId`／`therapistId`／`roomId`
  （用種子假名試過：服務資源寫「夏」「夏醫師」「夏醫師(功醫)」都認到）
- 日曆那一列印簡寫：`nameOf(row, 'short')`；診間只在 `showsRoom()` 時印；**日曆不印醫師**（`agendaFor()` 沒有 doctor）—— 這裡要印（她指名「診間和醫師」）

## 要做的

- **domain 一支**（`aboveeImport.js`，名字自己取，例：`rowGlance(item, ctx)`）回這一列要印的「課程名＋人／診間」，畫面只畫：
  - 課程：新的列＝組得出時段就 `slotName(slot, master, 'short')`，組不出就照片認出的課程（`item.course`；n返 印返數 —— 走 `slotName()` 讀 `followupNth` 那條路，或 `nthLabel()`），都認不出才退回原字
  - 已經記了的列＝**存完之後那一段**：app 上那一段套上「要改的」那一塊勾著的（治療師／診間 `adopt`、狀態、改期、扣法）。
    **讀 `photoDayPlan()` 已經算好的那一份，不要在這裡再套一次**：`writes[].touch` 的 `visit`＋`at[key]`（aboveeImport.js 約 2835–2840、2912）
    已經套了四種、有 problems 的已經跳過 —— 建議 `photoDayPlan()` 回傳多一份 `slotAfter[key]`，畫面只讀它；測試拿 `plan.after[customerId]` 對答案。
    **不要用 `afterPhoto()`**（約 1796）：它沒套 `adoptAbovee()`、也沒 export —— 照它印的話勾了 B 列上還是 A（過目 E1）。
    不在 writes 裡的列（什麼都沒改、或那一格沒勾）退回 app 上那一段。**`item.existing` 不一定有 `slotIndex`**（過目 E3）：
    合併扣課的後一半（約 1266）、沒有時間的舊段（約 1307）、對不上沒有 hit 的（約 868）只有 `{ visitId, date }`；改期那一列的 `slotIndex` 是舊的那一段，新的在 `moved.at[key]` —— 每一種寫退路（找不到那一段就退回照片上的）
  - 新的列：**組得出 `built.slot` 時讀 slot 上的 `therapistId`／`roomId`／`doctorId`**（存檔 `composeGroups()` 寫進去的就是它），組不出才讀 `item.*Id` —— 不然列上印的可能跟存進去的不一樣（過目 M8）
  - 對不上、認不得、已取消的列：照照片上讀到的印（`item.*Id`、`item.course`）；認不出課程就只印課程原字、不印人
  - 要印哪幾格：`assignsFor(ent, course, equipmentId)` 是 therapist → 治療師、room → 診間；擇一池還沒選器材（回 null）退回 `course.assigns`（同 `staffRoleFor()` 的理由）；`picksDoctor(course)` → 醫師
  - 名字一律簡寫（`nameOf(row, 'short')`；人員照 `tests/staff-short-name.test.js` 的規矩，不直接讀 `.name`）；缺的那一格回一個「缺」的記號，畫面印灰色「醫師？」
- `rowHtml()` 把它接在課程那一格後面（樣子照日曆那一列：`IN 60　某璇`、`三返(30)　VIP5　夏`）。**版面**：`.abl-row__what` 現在是 `nowrap`＋`ellipsis`、整列是四欄的 grid（app.css 約 10511、10547）——
  人與診間塞進同一格的話 375 寬會被截掉。**段二的紅字短標記要自己一格**（被截掉＝收著看不到），所以這一支先把課程那一行排成「課程＋人／診間」一格（可以截）＋右邊留一格給標記（04 填），不可以撐出橫向捲動
- 點開那一塊：還沒按任何一顆時，**醫師與診間兩排照照片認出的課程畫出來**（第三件）—— 先看這樣會不會讓還沒選額度的列存得進去（不會：存檔照舊走 `slotFromPicks()`），再決定要不要做；做的話寫進「做完時留下的」
- 動到 `public/`：`VERSION` 升一號、`shell:snapshot`；**E2E 另開一支新的**（不接進 `85`／`51` —— 04 會再改那幾支），登記 `tests-e2e/related.js`
- 已經記了的列「一定」組不出時段（`asRecorded()` 約 1212–1219 把額度、送的、n返、notMine 全清掉，`slotFromPicks()` 一定 fail），不是「多半」

## 判準

- 照片上三返、服務資源寫著醫師、還沒按任何一顆：列上印不印得出那位醫師？（單元：domain 那一支；E2E：模擬器假模型那一列）
- 一列已經記了、app 那一段的治療師是 A、照片是 B、「要改的」那一格**沒勾**：列上印的是 A 嗎？勾了印 B 嗎？（印的要等於存完之後的）
- 已經記了的 EECP 那一列：課程印的是日曆上那個名字，不是照片原字 `EECP60`？
- 治療師的課會不會多印一格診間（或反過來）？醫師那一格只在 `picksDoctor()` 為真時出現？
- 有沒有任何一處從人員那一筆直接讀 `.name`（`tests/staff-short-name.test.js` 會抓）？

## 做完時留下的（段一，2026-11-03）

- **domain**：`aboveeImport.js` 的 `rowGlance(item, plan, ctx)` → `{ what, cells: [{ field, label, name|null }] }`。找那一段的順序：
  1. `photoDayPlan()` 多回一份 `slotAfter[key]`（`{ visit, slot }`）：`writes` 裡每一列 —— `touch.done` 的（「要改的」勾著、真的改成了的）讀 `touch.at[key]`，新的讀 `adds.at[key]`。
     沒套上的（`missed`、有 problems 的）不在 `writes` 裡 → 往下退到 app 上那一段，也就是存完之後的樣子
  2. 已經記了：`recordedSlotOf()` —— 有 `slotIndex` 照位置；**改期存好之後**（舊的那一段已取消）找照片那個時間、同一筆剛好一段活著的；
     `halfOf` 找前一半那個時間；`timeless` 找那一天同一門課、沒有時間、剛好一段；都找不到退回照片上的
  3. 新的：`slotFromPicks(picksOf(item))`（存檔交給它的同一份）
  4. 其餘（認不得人、對不上、組不出來）：照片上的 `item.course`＋`item.*Id`；n返 走 `slotName()` 讀 `followupNth`／快照那一條；認不出課程只有原字
  - 要印哪幾格：`assignsFor()`（擇一池還沒選器材退回 `course.assigns`）＋`picksDoctor()`；名字只走 `nameOf(row, 'short')`
- **畫面**：`rowHtml()` 只畫（`glanceHtml()`）。`.abl-row__what` 改成 flex 容器，裡面 `.abl-row__glance`（課程＋人，nowrap＋ellipsis）——
  **段二的紅字標記直接接在 `.abl-row__glance` 後面、`flex: none`**，不被截。「app 有、這次照片上沒有」那一塊的列也包一層 `.abl-row__glance`（樣子不變）。
  缺的那一格灰色（`.abl-row__person--none`，`醫師？`）。列底下那幾行提示一行都沒動
- **點開那一塊（第三件）做了**：組不出時段時，治療師／診間／醫師那幾排照照片認出的課程畫（`seenCourse`）。按了只改那一列的那一格（`pickOption()` 本來就留著人與診間），
  存檔照舊走 `slotFromPicks()`、組不出照舊擋 —— 不會讓還沒選額度的列存進去。器材、品項、排多久那幾排照舊要 `built.course`
- 測試：`tests/abovee-row-glance.test.js`（9 條：勾／不勾的治療師、日曆名字、沒有計畫、合併扣課後一半與找不到、沒有時間的舊段、三返醫師、新的列讀時段、缺的格、認不得人）；
  E2E `86-abovee-row-glance`（W1：三返還沒按就印醫師、灰色「治療師？」、已經記了照「要改的」勾不勾換人、375 寬不橫向捲、點開醫師那一排先選好、換醫師列上跟著換），登記 `related.js`
- `aboveeConfirm.js` 不再 import `slotName`。`sw.js` v220 → v221
- 已知的小洞（沒修）：**記好了**的列（`savedKeys`）不在計畫裡，改期記好之後靠 `recordedSlotOf()` 那一條找新的那一段；新的列記好之後照舊 `slotFromPicks()`（同一份選擇，印的一樣）
