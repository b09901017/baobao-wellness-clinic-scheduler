# 讀取卡片：取消／未到的段不寫「扣 X」

Status: done
來源：`findings.md` 第 7 條
動工前先讀：`public/js/ui/views/calendar.js` 的 `fromLine()`（`:1675`）與它在 `visitReadHtml()` 裡的呼叫端、
`public/js/domain/entitlements.js` 的 `slotOutcome()`（ADR-0025：這一段算不算）、`public/js/domain/visits.js` 的 `slotStatus()`、
ADR-0018、0056、0070、`CLAUDE.md` 連動表「一筆來訪的讀取卡片」「一段來訪的狀態、或它算不算數」兩列
Blocked by: —

## 她要的

> 我想修一二三六的所有內容

（她 2026-10-07 的原話只有上面這一句。底下是我方 10/7 驗證時寫的描述，出自 `findings.md`，**不是她的話**：）

- 取消／未到的段，讀取卡片寫「扣 X」

## 為什麼會這樣

`fromLine(slot, data)` 只看 `slot.entitlementId` 查得到名字就印「扣 復能-SIS(60)」，不看那一段的狀態。
取消的段不佔次數、未到的段不扣（`slotOutcome()`）—— 資料是對的，那一行在講一件沒發生的事（ADR-0070）。

## 要做的

`fromLine()` 多收那一筆來訪（呼叫端 `visitReadHtml()` 手上就有），**問 `slotOutcome()`** 這一段算不算，不自己比狀態字串：

- 算數的（待確認／已確認／已完成）：照舊「扣 X」
- 不算的（取消、未到）：「沒扣 X」—— 名字留著，她還是看得出那一段原本是哪一筆額度的

讀取卡片四個畫面共用（日曆、客戶詳情、待辦中心、進度追蹤），一處改四頁一起好。

## 判準

- 這一行寫「扣」的時候，那一段在 `counts()` 裡真的佔著一次嗎？
- n返與不算次數的課照舊沒有這一行嗎？（它們沒有 `entitlementId`）

## 測試

- 單元：`visitReadHtml()` 有既有的測法（`tests/read-card-one-slot.test.js`）—— 取消的段、未到的段各一條斷言「沒扣」。
- E2E：讀取卡片那一支加一條斷言就好，不另開 spec。

## 做完時留下的

- `entitlements.js` 多一支 `chargesEntitlement(visit, slot)`（排著或做完才算扣著；沒有額度的段回 false），`fromLine()` 多收那一筆來訪、問它。
- 沒扣的那一段寫「沒扣 X」。四個畫面共用 `visitReadHtml()`，一處改四頁。
- 單元 6 條（`tests/consequences.test.js` 最後兩組）、E2E `59-verified-words` 的 W1。`sw.js` v184（這一支分支的號）。
