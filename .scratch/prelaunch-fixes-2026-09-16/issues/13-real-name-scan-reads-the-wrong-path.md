# 真名掃描在這台機器上一直跳過，而且就算跑也只掃得到一小部分

Status: todo
來源：`../spec.md`（報告 §2.4）
動工前先讀：`tests/no-secrets.test.js`、`SPEC.md` 第 10 節、
`.claude/skills/calendar-sheet-merge/SKILL.md` 的別名表那一段

## 現在壞在哪

兩件事，第二件比第一件嚴重：

1. `tests/no-secrets.test.js:162` 讀 `.local/aliases.json`，而檔案在
   `.local/references/aliases.json` —— 所以 `npm test` 那 1 條 skip 就是它。
   **2026-09-08 那次外洩就是這條沒跑到。**
2. 放對位置之後它**只收 `nicknames` 的鍵與值**（`:176`），而那一份只有 **6 位**
   有暱稱的客戶（19 個字串）。這一批 import 有 **28 位、52 個字串**，
   其中別名表只涵蓋得到 13 個。**綠燈只代表那 6 位沒進版控。**

（我用完整名單掃過一次這一輪的 diff：52 個名字 × 757 個被追蹤的檔案，**零命中**。
所以壞的是這條測試掃不到，不是有東西漏出去。）

## 做法

- 路徑改成 `.local/references/aliases.json`。**同時試舊路徑**，兩個都沒有才 skip
  —— 別的機器上可能還放在舊位置，而這條測試壞掉的方式必須是大聲的
- 名單的來源擴大：`nicknames` 的鍵與值以外，把 `.local/references/` 底下
  `import-*.json` 的 `customers[].name` / `rawName` / `sheetName` 也收進來
  （**那是最完整的一份名單**，而且就在她那台機器上）
- 沒有 import 檔時照舊只掃 `nicknames`，並且在測試訊息裡把**掃了幾個名字**講出來
  —— 現在它只說過了，不說掃了幾個，而 6 跟 52 的差別正是這一支要講的話
- **測試本身照舊一個真名都不寫**，命中哪一個名字也不印（那行字會進 CI 的 log）

## 判準

- **這條測試綠燈的時候，她知不知道它掃了幾個名字？**
- `.local/references/aliases.json` 在的機器上不 skip
- 兩個路徑都不在時 skip，而且訊息講得出要把檔案放哪
- 有 `import-*.json` 時掃描的名字數 > 只有 `nicknames` 時
- 故意在一支被追蹤的檔案裡放一個假名單裡的名字 → 紅
