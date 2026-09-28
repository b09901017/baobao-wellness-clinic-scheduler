# 回報由程式寫進決定檔

Status: done
Blocked by: 02
來源：`../spec.md` 做法 3、4
動工前先讀：SKILL.md「決定檔」一節、`merge.mjs` 的 `applyPlanDecisions()`／`applySlotDecisions()`

## 她要的

> 並且這些決定要被記錄下來下次要能穩定呈現，讓我每次決定都可以越來越快

> 用程式完成這件事而不是用語言模型紀錄，讓每次結果都可以穩定

> 我希望每一題都可以讓我回答完後，可以選擇要不要保留

## 為什麼會這樣

9/15 那 93 題是模型一題一題讀、手寫進決定檔的。同一份回報交給兩個 session，寫出來的決定檔不保證一樣。

## 做法

`scripts/record.mjs`：`applyAnswers(decisions, report)` ＋ CLI（`--decisions <檔> --answers <回報>`，寫回決定檔）。

- 每一則回報記進 `decisions.answers[key]`：選了什麼、備註、保留沒、哪一天、哪一份頁面、**那一題的樣子**（下一輪沒產生時照樣畫得出來）
- 選項帶的 `ops` 寫進對應的地方（`customers[分頁].slots／skipEvents／dropProblems／notes`、`events`），每一條帶 `q: key`
- **冪等**：同一把鑰匙再套一次，先拿掉上一次那幾條再寫 —— 改主意不會留兩份
- `remove` 那一種（⓪d 換掉舊的那一條）照內容比對拿掉，`_` 開頭與 `q` 不算
- `free: true` 或選了「其他」→ `needsTranslation: true`，不算答完；CLI 最後印出還有幾條待翻譯

## 判準

- 同一份回報套兩次，決定檔一模一樣？
- 先選 A 再改選 B，決定檔裡只剩 B 那幾條？
- 保留的：照她的答案寫進去（先匯），而且 `hold: true`？
- 「其他（備註寫）」不會被當成答完？

## 做完時留下的

- 冪等靠的是答案上記著「這一次實際寫了哪幾條」（`applied`），不是在每一條決定上貼鑰匙：
  `notes.drop`、`dropProblems` 是字串陣列，貼不了東西。再套一次＝先退回上一次那幾條（加的拿掉、拿掉的放回去）再寫
- 退回之後空掉的陣列收掉（`skipEvents: []` 讀起來像有東西）
- CLI 寫回之前留一份 `.bak`
