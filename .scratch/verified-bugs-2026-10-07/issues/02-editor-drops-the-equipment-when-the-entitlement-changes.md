# 日曆編輯器換額度時，上一次點的器材要跟著重設

Status: done
來源：`findings.md` 第 2 條
動工前先讀：`public/js/ui/views/visitEditor.js` 的 `readDraft()`（`:920-1040`，器材在 `:969`、`:1011`）、`blankSlot()`、`slotCard()` 畫器材那一排（`:837`）、
`public/js/ui/views/schedule.js` 的 `resetCourseBoundPicks()`（`:163`）與選額度那一下（`:2028` 附近）、
`public/js/domain/aboveeImport.js` 的 `pickOption()`（`:372`）、`public/js/domain/visits.js:1623-1627`、ADR-0075、
`CLAUDE.md` 連動表「一段來訪要選哪一台復能器材」「一段來訪要選哪一款營養點滴品項」（換額度要重設的三個時機）
Blocked by: —

## 她要的

`findings.md` 第 2 條（她 10/7：「我想修一二三六的所有內容」）：

> 先點「復能-三選一」→ INDIBA，再點「復能-SIS」：抬頭還寫 IN(60)、器材那排 SIS 沒選上、存檔被擋「第 N 個時段：這個器材不在「復能-SIS(60)」的擇一池裡」——沒說是哪一台，畫面上已經看不到 INDIBA。

## 為什麼會這樣

`readDraft()` 的 `:969` 與 `:1011` 讀 `v['s{i}-equip']` —— 那一排的 hidden input 還是上一筆額度時點的那一台。
品項那一格同一個形狀的 bug 2026-09-18 修過（`:983-994`：`entitlementId !== slot.entitlementId` 就回到買的那一款），器材沒有跟著做。
壓表沒有這個問題：選額度那一下會 `resetCourseBoundPicks()`。

## 要做的

1. `readDraft()`：**換了額度（`entitlementId !== slot.entitlementId`）器材就重算**，不讀那一排的舊值：
   - 新的額度的擇一池**只有一台** → 直接選好它（單買一台的 `復能-SIS(60)` 就是這個形狀；她沒有別的可以選）
   - 上一台剛好也在新的池裡 → 留著（三選一 ↔ 四選一，她選的那一台還是對的）
   - 其餘 → 清成 `null`，她重選
   `:969`（推課程用的）與 `:1011`（存進時段的）要用**同一個值**，不然課程照舊的那一台推、存的是新的。
2. 壓表選額度那一下也照「只有一台就選好」（現在是清成 null，單買一台時她要多點一下）—— **動工時先看壓表現在的行為**，已經會選好就不動。
3. 拍 Abovee 的 `pickOption()`（`:372-392`）第一段讀起來已經會重設（`equipmentId: null` 再照池挑），**寫一條測試釘住**，不改程式。
4. 錯誤訊息 `visits.js:1626` 帶出器材名：「INDIBA 不在「復能-SIS(60)」的擇一池裡」。修了 1 之後畫面上走不到這一句，但資料壞掉時它是唯一的線索。

「只有一台就選好／在池裡就留著／其餘清掉」放進 domain 一支（`visits.js`，跟 `courseForEquipment()`、`picksEquipment()` 放一起），壓表與編輯器共用 ——
各寫一次就是這一條 bug 本身。

## 判準

- 這一行會不會讓一段扣著 A 額度的來訪，帶著只屬於 B 額度的器材存進去？
- 她沒換額度、只改時間時，那一段的器材會不會被動到？（不可以 —— 沒畫出來的欄位照舊走 `key()` 保留）
- 換到一筆不用選器材的額度（營養點滴）時，器材是 `null` 嗎？（`picksEquipment()` 那一格照舊）
- 抬頭（`short` 名字）跟著新的那一台嗎？

## 測試

- 單元：domain 那一支三種情況；`tests/visit-editor.test.js` 有 `readDraft()` 的測法可以照抄。
- E2E：新 spec —— 同時有三選一與單台 SIS 額度的客戶 → 日曆 → ＋ → 三選一 → INDIBA → 復能-SIS → 抬頭是 SIS、器材那一排 SIS 選著 → 存得下去。

## 做完時留下的

- domain 多一支 `visits.js` 的 `equipmentAfterSwitch(entitlement, previousId)`。編輯器 `readDraft()`（換了額度才走它，推課程與存下去的是同一個值）、
  `blankSlot()`（預設那一筆額度只有一台就先選好，課程照那一台推）、拍 Abovee 的 `pickOption()`（原本自己寫了一份一樣的規則，換成呼叫它）。
- **壓表沒有改**（要做的第 2 點查過之後決定不動）：`pickOne()` 是 `view[key] === value ? null : value` —— 再點一次是取消選取。
  先替她選好的話，她照習慣點那一台反而把它點掉。編輯器的丸子（`wireChips()`）再點一次還是選著，所以那一邊可以先選。
- 錯誤訊息帶器材名：「INDIBA 不在「復能-SIS(60)」的擇一池裡」。
- `readFreeSlot()`（不算次數的課）查過：器材經 `slotFromPicks()` 的 `picksEquipment()` 閘門，不會帶著上一台。
- 單元 8 條（`tests/equipment-after-switch.test.js`）、E2E `58-verified-rules` 的 P6。
