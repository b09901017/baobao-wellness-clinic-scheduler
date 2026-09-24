# 「已完成不能直接改」看那一段

Status: done
Blocked by: 02
來源：`../spec.md` 第 03 條（R6）；取代 `.scratch/slot-confirm-and-durations-2026-09-16/issues/11`（那一支一直是 todo）
動工前先讀：SPEC 第 6.4 節、ADR-0085、`ui/views/visitEditor.js` 的 `paint()`（`locked`）與 `wireUnlock()`

## 她要的

> 7 全都修，但是一樣要注意會不會牽連或是連累產生衍生問題

（R6 是排查找到的，她沒報過。04 讓「一天只結一半」變成常態之後，這個洞會常常碰到。）

## 為什麼會這樣

`visitEditor.js` 的 `locked = isLocked(draft.status)`、`visitActions()` 的「改這一段」問 `isLocked(visit.status)`——
都是**整筆**。一天一段已完成、一段已確認時整筆是 `confirmed`：已完成那段照樣改得動、不用填更正理由；
反過來全部做完時整筆是 `done`，就算只想改一句話也要走更正流程（這一半是對的）。

## 談定的做法

- 編輯器只畫一段時（`headSlot`），`locked` 問那一段的 `slotStatus()`；整筆那條路（網址）照舊問整筆
- `visitActions()` 的「改這一段」照 02 的寫法問那一段

## 判準

- 第 0 段已完成、第 1 段已確認：長按第 0 段**沒有**「改這一段」（同整天已完成時的現況）；
  從讀取卡片的鉛筆進第 0 段是鎖著的、要填更正理由；第 1 段直接改得動？
- 更正流程（`unlockReason`、`lastCorrection`）與稽核紀錄上印的東西一個字都沒變？
- 這一行會不會讓一段已經結案、次數已經扣掉的來訪被安靜地改掉？
