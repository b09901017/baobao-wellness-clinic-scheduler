# 三個入口接好那一格：壓表、來訪編輯器、拍 Abovee 不會把「體驗／送的」弄丟或留錯

Status: done
Blocked by: 01
動工前先讀：01 的「做完時留下的」；CLAUDE.md「新增一個會建立時段的入口」「一段來訪要選哪一台復能器材」「一筆來訪改得動的地方」（沒畫出來的那一段**整個回原本那個物件**）三列；
`visitEditor.js` 的 `readDraft()`（一般那一條用 `...slot` 展開、只清 `followupNth`）、`readFreeSlot()`、`blankSlot()`、`equipmentField()`；
`schedule.js` 的 `resetCourseBoundPicks()`、`equipmentOptionsFor()`、組時段那一段（:2126 一帶）；
`aboveeImport.js` 的 `resolveItem()`（`next`）、`pickOption()`（`base`）、`asRecorded()`、`picksOf()`；`aboveeConfirm.js` 器材那一排（:521-525）與時長那一排（:551）

**這一支不改那一排長什麼樣（那是 04）**，只保證：她在現在的畫面上按過、改過、拍過的每一段，存進去的 `giftKind`、器材、時長都是對的。

## 她要的

> 就是如果有標註體驗的就直接送不算次數，就不會被沒有額度檔，畢竟是送的，但是來訪以及試算表還是要標註(送的)、(體驗)

## 為什麼會這樣（審查查到的，01 之後會發生）

- **編輯器把那一格留著**：`readDraft()` 一般那一條用 `...slot` 展開（`visitEditor.js:1021-1055`），只清了 `followupNth`。她把一段體驗改回扣額度，`giftKind: 'trial'` 留著，撞到 01 的「兩種身分只能挑一種」—— 一個看不懂的錯誤。`followupNth` 當初就是同一個坑
- **編輯器把那一格蓋掉**：`readFreeSlot()` 每次都經 `slotFromPicks()` 重組（:1079-1101），預設 `'trial'`。一段「送的」只改治療師存回去，會**安靜地變成體驗**
- **器材**：拍 Abovee `pickOption()` 不扣次數那一條直接回 `base`（`equipmentId: null`），照片上寫的 INDIBA 被丟掉；確認層只有擇一池額度才畫器材那一排 → 停在「先選上面那一台」、沒有東西可以按。
  壓表與編輯器沒有額度時列全部器材（ILIB 也在）
- **時長**：三個入口「排多久」那一排只看 `bookingMinutes`（壓表 `schedule.js:1402-1404`、編輯器 :864-866、拍 Abovee :551）；編輯器 `readFreeSlot()` 換了課程時把分鐘清掉（:1082、:1096）

## 要做的

1. 呼叫端改名（01 的 `giftPick()`／`giftCourseId`）：`aboveeImport.js` :471、:521、:539、:561-567、:694、:1029、:1409；`aboveeConfirm.js:510`；`schedule.js` :1276、:2126；
   `visitEditor.js` :556、:595、:615-617、:951-965、:1085；`consequences.js:475-484`
2. **`giftKind` 跟著那一段走**：
   - 編輯器 `readDraft()`：換成扣額度或 n返 → `giftKind: null`；沒換 → 留原本的（「送的」不會變成「體驗」）。`readFreeSlot()` 帶著原本的 `giftKind` 進 `slotFromPicks()`
   - 拍 Abovee：`resolveItem()` 的 `next`、`pickOption()` 的 `base`、`asRecorded()` 都清那一格；`picksOf()` 帶上去
   - 壓表 `resetCourseBoundPicks()` 清那一格
   - 改期（`rebookSlot()`）：新的一段帶著舊的 `giftKind`（同一段課改時間，還是體驗）；`withExtraSlot()` 併段不碰它
3. **器材那一排與時長那一排**三個入口都畫 01 的 `equipmentChoicesFor()`、`minuteChoicesFor()`，不各自判斷；`pickOption()` 不扣次數那一條保留照片上的器材（那一台屬於這門課才留）
4. 壓表的 `picked` 只在 `courseOptions()` 裡找（`schedule.js:1252`、`:2029`、`:2113`）—— 04 的「別的課當體驗」選出來的那一門也要找得到，不然「加這一段」一直是灰的。這一支先把查找改成走同一份名單（04 再把名單加長）

## 判準

- 編輯器：打開一段 `giftKind: 'gift'` 的心臟科評估，只改時間或治療師 → 存完還是 `'gift'`
- 編輯器：一段體驗的復能改回扣三選一 → `giftKind` 是 null、扣那一筆、存得下去
- 拍 Abovee：一列功醫門診、沒有額度 → 預選不扣、存下去 `giftKind: 'trial'`
- 拍 Abovee（用單元測試直接叫 `pickOption(item, giftPick(復能))`，畫面那一顆要等 04）：一列 IN 30 → 器材留著 INDIBA、器材那一排列得出 IN／SIS／高能量、沒有 ILIB；存下去 `equipmentId` 是 INDIBA、30 分
- 拍 Abovee：換一位（`resolveItem()`）之後上一位的 `giftKind` 不留著
- 改期一段體驗：取消的那一段與新的那一段都是體驗
- 三個入口存同一種選法（功醫門診、體驗、10:00）→ 時段的每一格一模一樣（寫一支單元測試比 `slotFromPicks()` 的輸出）

## 做完時留下的

- **壓表**（`schedule.js`）：`view.giftKind`（`null`＝還沒選過＝體驗）；`resetPicks()`、`resetCourseBoundPicks()` 都清它。
  **按著哪一顆只問 `pickedOption(row)`**（以前四處各自 `courseOptions(row).find(…)`）—— 04 把「別的課當體驗」加進 `slotOptionsFor()` 回的那一排之後，四處自動找得到。
  `pickedGiftKind(picked)`：`picked.isUncounted` 才有值（04 加新的種類時要改這一支的判斷）。`effectiveCourse()` 對送的／體驗、`requiresEquipment` 的那門課也照器材推（同 `slotFromPicks()`）。
  器材那一排 `equipmentChoicesFor()`、排多久那一排 `minuteChoicesFor()`、`pickedMinutes()` 帶 `giftKind`。**還沒有「體驗｜送的」那一排可以按**（04），所以壓表存的一律是體驗
- **來訪編輯器**（`visitEditor.js`）：`giftOf(slot, all)`（n返 一律 null，其餘 `giftKindOf()`）。`slotCard()` 的 `free` 改問它（舊的是 `isUncounted(course)`）；
  一段體驗的復能（課程不勾不算次數）也認得出來，額度那一排把那門課加進去（`...(free ? [course] : [])` 本來就有）。
  `readDraft()` 扣額度那一條寫 `giftKind: null`、`readNthSlot()` 也寫 null；`readFreeSlot()` 帶著原本的 `giftKind`（從扣額度換過來＝體驗），
  器材只留**屬於這門課**的那一台（從四選一的 ILIB 換成體驗的復能，不會被推回 ILIB），時長：沒換課程就照這一段現在的長度（`slot.minutes ?? 起訖`）—— 扣額度的復能(30) 改成體驗還是 30。
  `blankSlot()` 預設那門不算次數的課時寫 `giftKind: 'trial'`。`equipmentField()` 多收 `course`、走 `equipmentChoicesFor(…, { keep })`
- **拍 Abovee**（`aboveeImport.js`）：每一列多 `giftKind`。`resolveItem()` 的 `next`、`pickOption()` 的 `base`、`asRecorded()` 清它；
  送的／體驗那一顆走新的 `giftRow()`：原本就是送的／體驗就照舊（換一門送的課還是送的），其餘體驗；**照片上那一台屬於這門課才留**。`picksOf()` 帶上去
  （沒有 `giftCourseId` 的列交 `null`）。確認層（`aboveeConfirm.js`）器材那一排改問 `picksEquipment()` ＋ `equipmentChoicesFor()`，排多久那一排 `minuteChoicesFor()`。
  **06 要接的**：讀到「預約來源＝體驗」時在 `resolveItem()` 裡把 `value` 設成那門課的 `giftPick()`（`giftRow()` 會給 `trial`）
- 改期：`rebookSlot()` 本來就 `{ ...next }`，新的那一段帶著 `readFreeSlot()` 給的那一格；`withExtraSlot()` 不碰它（單元測試與 E2E G3 都釘著）
- 已知、沒改：`equipmentChoicesFor()` 沒有擇一池時走 `equipmentForCourse()`，那一支「一台都對不上就回全部」—— **不用選器材的課**問它會拿到全部器材。
  三個入口都只在 `picksEquipment()` 是真的時才畫那一排，所以畫面上看不到；`readFreeSlot()` 拿它過濾殘留的器材，結果交給 `slotFromPicks()` 時也會被 `picksEquipment()` 清掉
- 新測試：`tests/gift-kind-entrances.test.js`（拍 Abovee 的四條、改期、三個入口同一個結果、壓表／編輯器／確認層的原始碼掃描）；
  E2E `67-gift-and-trial`（G1 送的只改醫師還是送的、G2 體驗的復能器材三台＋30/60＋改回扣額度清掉、G3 改期兩段都是體驗），已登記進 `related.js`；
  `49` 的 U2／U3／U6 多一條 `giftKind === 'trial'`
