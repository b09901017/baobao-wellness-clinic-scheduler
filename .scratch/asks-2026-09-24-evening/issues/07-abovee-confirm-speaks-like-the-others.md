# 拍 Abovee 的確認框走 `consequences.js`，跟其他入口講一樣的話

Status: todo
Blocked by: 06
來源：`../spec.md` 第三、Q10（9/17 審查留下、她沒決定的那一件；這一輪策略她同意了）
PR：3（`claude/asks-0924e-abovee`）
動工前先讀：ADR-0070、ADR-0104、ADR-0107、ADR-0113、`domain/consequences.js` 的 `bookingConsequences()`／`registrationsWhenSettled()`、
`ui/components/aboveeConfirm.js` 的 `save()`、`prelaunch-audit-2026-09-23/issues/22`

## 她要的

> 第三 : …經過pr129-131這幾輪的大改動，不知道會不會影響之前做的AI的部份…可以幫我全面檢查

> 10. 都同意

## 為什麼會這樣

拍 Abovee 存檔前那一道確認的句子**寫在畫面裡**（`aboveeConfirm.js` 的 `save()`），而 CLAUDE.md 說
「一句『按下去會發生什麼』只寫在 `domain/consequences.js`」。所以其他入口跟上的兩件，它都沒跟上：

- #129 的 22：「等客人說可以之後會再多一張 X」（`registrationsWhenSettled()`，確認抽屜、改期、壓表、日曆新增共用）
- 補登過去那一天：「那一天已經過了，待辦上直接出現在『簽療程單』」（`bookingConsequences()` 的 `past`，ADR-0113 那一批）

## 談定的做法

- `consequences.js` 新增 `aboveeConsequences()`，拍 Abovee 那一道只畫它回的東西。一位一天一組（`planAbovee()` 的 `groups`），
  但**合起來講**，不是一組一段 —— 十幾段各講三句她會閉著眼睛按（ADR-0104 當初就是為了這個只問一次）：
  - 幾位・幾天・幾段（照舊）
  - 每一段都記成「待確認」—— Abovee 上寫的「確認前往」不等於問過客人（照舊）
  - 今天以後的 N 天：待辦上出現在「跟客人確認時間」；已經過了的 M 天：直接出現在「簽療程單」
  - 客人說可以之後會再多的掛號（`registrationsWhenSettled()`，照種類合計：「Examine 掛號 ×3」）—— 過了的那幾天不講（ADR-0113）
  - 併進已確認那一天的（06 那一句）
  - 記住哪幾個治療師的寫法、誰標成壓完（照舊，資料由畫面傳進去）
- 判斷一條都不在 `aboveeConsequences()` 另寫：借 `visitsToConfirm()`、`registrationsWhenSettled()`、06 那一句

## 判準

- 拍一張有一段 Examine 課程（A 類）、日期在下週的：確認框講「客人說可以之後會多一張『Examine 掛號』」？
- 勾一列上週的（補登）：確認框講它會直接在「簽療程單」，而且**不講**會多掛號？
- 全部都是復能（C 類）：確認框沒有掛號那一句？
- 畫面那一支一個字的後果都不自己組？
