# app 裡還沒有的那一列：照照片上的狀態記，整筆狀態跟著推，預設勾照新的規則

Status: done
Blocked by: 01（狀態對照、時間合不合理）
動工前先讀：`spec.md`「app 裡還沒有這一段」「次數」兩節；ADR-0104、ADR-0030、ADR-0081（時段是原子單位、整筆是推導的）、ADR-0083（一天一筆）、ADR-0144、ADR-0145、ADR-0066（寫紀錄）、ADR-0113；
`domain/aboveeImport.js` 的 `resolveItem()`（`checked` 那幾行）、`planAbovee()`（`:1471-1512`）、`picksOf()`、`newRowSay()`、`warningsByRow()`／`mustSee`、`visitsForCheck()`、`mergedItem()`；
`domain/slotDraft.js` 的 `slotFromPicks()`、`visitWithSlot()`；`domain/visits.js` 的 `withExtraSlot()`（`:351-373`）、`sameDayVisitFor()`、`visitStatusFrom()`、`settle()`、`closeVisit()`（`attended`）、`validateVisit()`、`visitsToConfirm()`；
`domain/followups.js` 的 `cannotClose()`（`:655-660`）；`data/visits.js` 的 `save()`（`:162` 只補每一段，不重推整筆）；
CLAUDE.md「新增一個會建立時段的入口」「一段來訪的狀態」「拍 Abovee 記很多段」三列；`docs/agents/lessons.md` 二、四、五

## 她要的

> 只要是abovee上寫課程完成，那就是完成了 … 已取消就是取消，客戶失約就是未到
> 然後如果在abovee課程完成，那就直接紀錄不用產生待辦，但如果是(拍照當下)未來的課程寫課程完成那要提醒
> 如果在abovee待確認，聯繫中，確認前往，那就會產生待辦，但如果是(拍照當下)過去的課程，不是已取消* 客戶失約* 課程完成，那也要提醒

> 如果app沒有但是課程完成已過去的，為什麼預設不勾呢??

> abovee上拍到已取消，app 裡又沒有的那一列，就預設不勾，就算勾了也是記成已取消並且不用在去abovee上取消了

第一段她回：「寫紀錄」**照長**；照片寫客戶失約的新列「**勾。記成未到不扣次數，日曆和試算表上看得到他沒來**」。

## 為什麼會這樣

- `slotFromPicks()` 寫死 `status: INITIAL_STATUS`（`slotDraft.js:144`）；`visitWithSlot()` 新開那一筆整筆也寫死 `INITIAL_STATUS`（`slotDraft.js:169`）
- `withExtraSlot()`（`visits.js:351-373`）：那一天原本是已確認，就把整筆改回待確認（`reopened`），**不管新加的那一段是什麼狀態**
- `save()` 只補每一段的狀態（`data/visits.js:162`），**不重推整筆** —— 整筆那個 `status` 是推導又存起來的（`visitStatusFrom()`，索引、Rules、試算表、備份讀它）
- `planAbovee()`（`aboveeImport.js:1500-1512`）每加一段就問一次 `visitWithSlot()`、把結果蓋掉 `group.visit`；`sameDayVisitFor()` 只收還開著的那一筆
- `resolveItem()`（`aboveeImport.js:538-544`）：`checked = recognized && !cancelled && future && …` —— 過去的不勾是 ADR-0030（匯入舊資料）借來的
- 已取消的新列 `canCheck` 是真的（`aboveeConfirm.js:414` 只問 `kind === 'new'`），勾了會記成一段**待確認**

**10/15 過目時實跑過**：新開一筆、唯一一段是已完成 → 整筆存成 `pending_confirm`（照推導應該是 `done`）；已確認的那一天併進一段已完成 → `reopened`、整筆變 `pending_confirm`（照推導應該是 `confirmed`）。
後果：那一天出現在「跟客人確認時間」（`visitsToConfirm()`）但沒有一段要問、資料健檢報整筆狀態對不上、確認框講「新的這一段是待確認」。
而且把整筆推對之後，`planAbovee()` 同一天的第二段會因為整筆已經結案而另開一筆、把第一筆蓋掉 —— **第一段就不見了**。

## 要做的

1. `slotFromPicks()` 多收一個狀態（沒給照舊 `INITIAL_STATUS` —— 壓表與來訪編輯器一個字都不變）。只准 `pending_confirm`／`done`／`no_show`／`cancelled`。
   **時段上只加 `status`**；已完成、未到照 `closeVisit()` 的形狀多寫 `attended: true/false`（`visits.js:1060`）。
   `cancelledAt`／`cancelReason`／`released`／`statusAt` 是**整筆的**欄位（`applyStatus()` 逐段那條路只寫那一段的 `status`，整筆那幾格由 `settle()` 在整天都取消時寫，`visits.js:1108-1154`）
2. **整筆狀態照推導**：
   - `visitWithSlot()` 新開那一筆：`status = visitStatusFrom(那一筆)`，整筆那幾格（`statusAt`；整天都取消的話 `cancelledAt`／`cancelReason`／`released: false`）照 `settle()` 的形狀寫
   - `withExtraSlot()`：**只有新加的那一段是待確認時**才改回待確認（`reopened`）；不是的話整筆用 `visitStatusFrom()` 重推
   - 壓表、日曆新增、`rebookSlot()` 共用這兩支 —— 它們的新段都是待確認，結果一個字都不變（`tests/slot-draft.test.js:139-162` 照樣全綠）
3. **同一組的段不可以掉**：`planAbovee()` 裡同一組（一位一天）的新段一律接進這一組自己那一筆，不問收不收得下；要不要併進 app 上那一天既有的那一筆**只在這一組的第一段問**（同 `afterClosed` 現在的位置）；最後推一次整筆狀態
4. `planAbovee()`／`picksOf()` 照 01 的對照帶狀態，但：
   - 未來的完成／失約、讀不出來的 → 記成**待確認**（勾了才記；提醒照講）
   - 二返／n返 照片寫完成、接的那一次健檢還沒做完 → 記成**待確認**、**不預設勾**、講一句（走 `consequences.js` 的 `closeBlockSay()`，不另寫）。
     **`cannotClose()` 要拿 `visitsForCheck()` 那一份**（含這一張照片上還沒存的那幾組；它只在傳進去的 `visits` 裡找那一次健檢，`followups.js:655-657`）—— 只看資料庫的話照片上還沒存的健檢找不到 → 不擋 → 二返記成已完成而健檢還是待確認（違反 ADR-0145）。存的時候換好真的 id 之後拿重讀的那一份再問一次是 06 的事
   - 合併扣課（`mergedItem()` 只抄第一列，`aboveeImport.js:1091`）：兩列的狀態一樣 → 照那個狀態；不一樣 → 記成待確認、不預設勾、講一句
5. 預設勾（`resolveItem()` 的 `checked`）換掉「過去的不勾」那一條，改成 spec 那張表（今天失約勾、未來失約不勾、讀不出來不勾、已取消不勾）；其餘不勾的條件一條都不拿掉
6. **提醒勾不勾都要看得到**：「還沒到就寫完成了」「日子過了還沒結案」「讀不出預約狀態」「二返簽不成」走 `newRowSay()` 那一類（勾不勾都畫，`aboveeConfirm.js:441`）；
   勾著的時候**另外**放進 `warningsByRow()` 的 `mustSee`，確認框的 `flagged` 才數得到（`warningsByRow()` 只看勾著的那幾組，`aboveeImport.js:1477`、`:1579`）。進不進「要你看」只問 `needsAttention()`，在這一支寫清楚哪幾種進
7. 記成已取消的新列：照樣過驗證（要選得到額度、器材 —— 跟一般的新段一樣）；不扣、不進超用；「取消 Abovee」一出生就勾好與「不標壓完」是寫入那一側的事（06 接線），這一支在 domain 回「這幾段是照片上放掉的」（給 06 帶進 02 的 `freed`）
8. 記成已完成的新列：照平常結案那樣長「寫紀錄」（她回的：照長）與健檢那條鏈（`syncFollowupTasks()` 本來就跑）；**掛號不長**（`acceptsNewTasks()` 只認 `confirmed`、過去的 `registrationClosed()`，不用改）
9. 驗證（`validateVisit()`）：新的一段是已完成時超用照講（`mustSee` 本來就收超用）；確認沒有一條規則擋「新的一段一開始就是已完成」

## 判準

（這一支只到 domain：判準拿 `planAbovee()` 組出來的那一筆、整筆狀態、`counts()` 驗。壓完、已勾的取消 Abovee、額度快取在 06 驗。）

- 過去、照片寫課程完成、app 沒有、認得人、讀得到全部來訪：**預設勾**，組出來那一段是**已完成**、整筆是**已完成**、`counts()` 扣 1 次；是二返的話 `syncTasksForVisit()` 長一張「寫紀錄」
- **同一天兩列都是課程完成（過去）→ 一筆兩段，兩段都在**
- 已確認的那一天、照片多一段課程完成（今天）：併進那一筆、整筆照推導（不是待確認）、不 `reopened`
- 過去、照片寫確認前往、app 沒有：**不勾**＋「日子過了還沒結案」（不勾也看得到）；勾了組成待確認
- 今天、課程完成 → 勾、已完成；今天、確認前往 → 勾、待確認；今天、客戶失約 → 勾、未到
- 未來、課程完成 → **不勾**＋「還沒到就寫完成了」；勾了組成**待確認**；未來、客戶失約 → 不勾；讀不出來 → 不勾
- 過去、客戶失約、app 沒有：**勾**、未到、`counts()` **不扣**
- 已取消、app 沒有：**不勾**；勾了組成**已取消**、不扣、回報「這一段是照片上放掉的」
- 二返、照片寫完成、接的是同一張照片上還沒存的健檢（待確認）：組成待確認、不預設勾、那一句是 `closeBlockSay()` 的
- 合併扣課兩列一個完成一個確認前往：待確認、不勾、講一句
- 送的／體驗、n返 寫完成：已完成、不扣任何一筆額度
- 讀不到這位的全部來訪：照舊一列都不預設勾
- 壓表、來訪編輯器、日曆新增、`rebookSlot()` 的新段**照舊是待確認**、整筆照舊（既有測試全綠）

## 做完時留下的（10/15 段二）

**做成的樣子**：

- `slotDraft.js`
  - `slotFromPicks()` 多收 `status`（只認 `NEW_SLOT_STATUSES`：待確認／已完成／未到／已取消，其餘當成沒給 → `INITIAL_STATUS`）與 `cancelReason`。
    已完成、未到照 `closeVisit()` 的形狀寫 `attended: true/false`；已取消的段才多 `cancelReason` 那一格（issue 11 的 `slot.cancelReason`）——
    **沒給狀態的段一個字都不變**（壓表、來訪編輯器、日曆新增）
  - `visitWithSlot(…, { at })`：新開的那一筆整筆照時段推（`newVisitWith()` → `visits.js` 的 `settle()`，**`settle()` export 了**）——
    待確認的新一筆跟以前一模一樣（`statusAt: null`）；已完成／未到蓋 `statusAt`；全部取消寫 `cancelledAt`／`cancelReason`（那幾段的理由）／`released: false`
  - 新的 `withPlannedSlot(visit, slot)`：同一組接下來的段。併進既有那一筆的（有 id）走 `withExtraSlot()`；這一次才組的新一筆照時段重推一次（取消的三格不會留在一筆已完成的身上）
- `visits.js` 的 `withExtraSlot(visit, slot, { at })`：**只有新加的那一段是待確認時**才退回待確認（`reopened`），其餘 `settle()` 照推導（沒變就不蓋時間戳）
- `aboveeImport.js`
  - `photoSlotStatus(item, today)`（export）：新的一列記成什麼。拿不準的（讀不出來、兩張照片不一樣、合併扣課兩列不一樣 —— `photoUnsure()`）與還沒到的完成／失約 → 待確認；
    已取消不看日期；那一張沒拍到那一欄 → 待確認
  - `photoWantsChecked()`：spec 那張表（過去完成、失約勾；過去待確認不勾；未來完成、失約不勾；已取消不勾；拿不準的不勾；**`photoStatus` 是 null → 照舊 ADR-0030**）。
    `resolveItem()` 的 `checked` 拿它換掉 `future`，其餘不勾的條件一條都沒拿掉
  - 列上多 `photoTime`（`photoTimeSays()` 的核心字，`resolveItem()` 算）與 `closeBlock`（二返簽不成已完成的為什麼）；兩格都在重設清單與 `asRecorded()` 裡
  - `planAbovee()` 拆成 `composeGroups()` 兩圈：第一圈照照片組；`blockedInGroups()` 拿**整批**問 `cannotClose()`（連這一次別組要記的，`visitsForCheck()` 那一份 —— 04 把它換成 `afterPhoto()`）；
    擋到的那幾列記成待確認、整批重組一次。每一組多 `blocked`（列的 key → 為什麼）與 **`freed`（記成已取消的那幾段的位置 —— 06 帶進 `save()` 的 `freed`）**。
    **同一組的段一律接進這一組自己那一筆**（第一段才問要不要併進那一天既有的那一筆）
  - `readAbovee()` 最後一步 `flagCloseBlocks()`：照片寫完成、會記成已完成的新的二返／n返，**當成勾著整批組一次**看接的那一次健檢做完了沒；擋到 → 不預設勾、`closeBlock`。
    `refreshCloseBlocks(items, ctx)`（export，只動記號）給 07 在她勾起／拿掉一列之後重算（同 `refreshNoExam()`）
  - `photoRowSays(item, block)`（export）：新的一列照片那幾句（兩張不一樣、讀不出來、合併扣課兩列不一樣、二返簽不成（`closeBlockSay()` 那一句）、還沒到就寫完成／失約、日子過了還沒結案），
    **勾不勾都看得到**：`needsAttention()` 有它就進「要你看」；`warningsByRow()` 把它放進 `all` 與 `mustSee`（勾著的列用那一組的 `blocked`，不看讀照片那一下記的）
- 測試：`tests/abovee-new-rows-photo-status.test.js`（29 條）；改了三支的預期：`abovee-six-statuses`（未來的失約不再預設勾）、`abovee-import`（檔頭與一條的標題）、`slot-note`（掃 `slotDraft.js` 那一條的寫法）

**給 06／07**：
- 存的時候（`record()`）`planAbovee()` 重組的那一份每一組都有 `freed` —— **還沒傳進 `save()`**（06）；記成已取消的那幾段也還會標壓完（`doneNow`，06）
- 確認框（`aboveeConsequences()`）還在講「每一段都記成待確認」（06）
- 畫面還沒畫 `photoRowSays()`（不勾的列）與 `statusColumnSay()`；`refreshCloseBlocks()` 還沒接（07）。`warningsByRow()` 已經會把那幾句放進 `mustSee`，所以勾著的列收起來那一行現在就看得到
- 驗證（`validateVisit()`）沒有一條擋「新的一段一開始就是已完成」（測試釘著）
