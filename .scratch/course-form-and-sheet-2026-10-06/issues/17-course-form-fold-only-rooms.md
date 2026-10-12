# 設定 → 課程 → 編輯：「只能排在這幾間」收起來

Status: done
來源：她 2026-10-06 在 staging 試完 06 回的
動工前先讀：`issues/06-…`「做完時留下的」（「其他設定」那一段怎麼收、兩條自己打開的路）、
`public/js/ui/views/masterList.js` 的 `editors.courses`（`fields()` 裡 `data-when="room"` 那一塊、`exceptionRoomOptions()`、`moreSummary()`、`wireForm()`、`onErrors`）、
`public/css/app.css` 的 `.foldout`／`.foldout__now`、`tests-e2e/specs/54-course-form.spec.js`、`tests-e2e/specs/47-course-groups.spec.js`（G 那幾條會勾這一排）
Blocked by: —

## 她要的

她 2026-10-06（逐字）：

> 第二：關於課程編輯那邊，我覺得只能排在這幾間的那一堆也可以先收合，平常設定不到
> → 「只能排在這幾間」收起來（收著時印出現在勾了哪幾間，例：治5、治7、治8；裡面有錯時存檔自己打開，同「其他設定」）

## 為什麼會這樣

06 重排時，選了「診間」之後底下露出三排：可用的診間類型、只能排在這幾間、常用診間。
中間那一排（`allowedRoomIds`，硬限制）一間診間一個勾 —— 補完診間之後是十幾個勾，而整份種子裡只有 EECP 兩門用得到。

## 談定的做法

- 那一排包進既有的 `.foldout`（`<details>`，跟「其他設定」同一組 class）。summary 寫「只能排在這幾間」，
  後面 `.foldout__now` 印**現在勾了哪幾間**（`治5、治7、治8`；一間都沒勾印「沒有限制」）。收起來是縮成一行，不是藏起來
- 她在裡面勾／取消時那一行就地更新（不重畫，ADR-0038）
- 預設收著 —— 有勾的也收著（那一行印得出來）
- **裡面有錯時自己打開**：domain 的錯誤訊息講到「指定幾間」的那一句（選了診間、類型與這一排都空的），走既有的 `onErrors`
- 欄位名字、`parse()`、候選（含「已停用」「已刪除」那兩種）一個字都不變

## 判準

- 打開 EECP 的編輯表：那一段收著，那一行寫著 治5、治7、治8；打開 ILIB：寫「沒有限制」
- 展開、多勾一間、收起來：那一行多了那一間；存下去的 `allowedRoomIds` 跟勾的一樣
- 什麼都不改就存：`allowedRoomIds` 一個字都沒變（E2E 54 的 C1 原樣綠 —— 收起來的勾選框照樣送得出去）
- 選了診間、類型全部取消、這一排也沒勾 → 按儲存：那一段自己打開
- **這一行會不會讓收著的那幾個勾在存檔時被清掉？**

## 連動

- E2E 裡勾這一排的那幾支要先展開（`47` 的 G 那一條）
- `docs/操作手冊.md` 七之五
- `public/sw.js` 的 VERSION

## 做完時留下的（2026-10-07）

- `masterList.js`：那一排包進 `<details class="foldout courseform__only" data-onlyrooms>`，summary 後面 `[data-onlyrooms-now]` 印
  `onlyRoomsSummary(r, all)`（名字跟裡面那幾個勾同一份 `exceptionRoomOptions()`，所以「（已停用）」「（診間已刪除）」也印得出來；一間都沒勾印「沒有限制」）
- 裡面那一組勾的標題從「只能排在這幾間」改成「勾了就只有這幾間排得進去」（summary 已經寫了那幾個字，展開時不重複）；`?` 的說明照舊
- 勾／取消時那一行就地更新（`change` 那一段既有的分支多一行）；`onErrors` 多一條：錯誤訊息講到「指定幾間」就打開這一段
- 欄位名字、`parse()`、候選都沒動 —— **收著的勾照樣送得出去**（`<details>` 關著只是不畫），E2E 54 的 C1（每一門什麼都不改就存）盯著
- E2E：`54` 新的一條 C8（收著、那一行、什麼都不改就存、展開多勾一間、沒有限制、有錯自己打開）—— 在舊的程式上紅過；`47` 的 G6 先展開那一段
- `sw.js` v175；`docs/操作手冊.md` 七之五兩處
