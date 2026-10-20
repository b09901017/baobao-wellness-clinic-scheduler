# 拍 Abovee：認出改期之後也比扣法（改期又改成 EECP20 → 新的那一段是體驗）

Status: done
Blocked by: —
段：段九之後（medium），中途發現「段四 1」
動工前先讀：`domain/aboveeImport.js` 的 `flagMoved()`、`movedSlotFields()`、`applyPhotoMove()`、`checkMoves()`、`chargeChangeOf()`、`applyPhotoCharge()`、
`photoDayPlan()`（扣法 → 狀態 → 改期的順序、`rows` 的 `charge`）、`changeLines()`；`tests/abovee-moved-rebook.test.js`、`tests/eecp-one-course.test.js`「扣法不一樣」那一段；ADR-0154、ADR-0149

## 她要的

段四做 09 時發現（HANDOFF「段四 1」），她 10/19：「做，照你的建議」。

> Abovee 上把一段 EECP 60 改了時間、同時改成 EECP20 → app 照「改期」整段抄舊的那一段（扣額度、60 分），新的那一段不會順便變成體驗、也不講。
> 建議：`flagMoved()` 認領之後也跑一次 `chargeChangeOf()`，有差就在「要改的」多一行

## 為什麼會這樣

扣法不一樣（`chargeChangeOf()`）只在**同一個時間**對到 app 上那一段時比（`resolveItem()` 的 `crossCheck()` 那一條）。
改期那一列（`flagMoved()`）是照片上的新時間、app 上的舊時間 —— 那一條路不經過它，所以 `chargeChange` 永遠是空的。
另外 `movedSlotFields()` 在讀照片那一刻就把新的結束時間照**舊的時長**算死了（60 分）：就算扣法那一步把舊的那一段改成體驗 20，改期照樣搬成 60 分。

## 要做的

- `flagMoved()` 拿得準的那一對：也問 `chargeChangeOf()`（照片這一列 vs app 上舊的那一段），有差 → `chargeChange`、`adoptCharge`、`existing.entitlementId`
  - 預設勾：跟改期一起（改期沒先勾就不先勾 —— 只改舊時間那一段的扣法、不搬，對不上照片上任何一列）、人是她選的不勾、挑不出額度不勾
  - 拿不準的那一對（新的一段、不預設勾）不比：那一列是新的一段，扣法照它自己的預選
- 「要改的」那一塊：同一列兩行（改期一行、扣法一行），括號照計畫的 `rows`（扣法那一步先、改期從扣法之後算 —— 不重複）
- `applyPhotoMove()`：新的那一段的時長照**套的那一刻**舊的那一段（扣法套過的話是 20），不照讀照片時算死的
- `checkMoves()`：驗證改期之前先套扣法（不然拿 60 分去驗撞期與重疊）

## 判準

- app 10:00 EECP(60) 扣額度、照片 11:00 EECP20 →「已經記了」＋改期＋扣法，兩行都預設勾；套上去：10:00 取消、11:00 是體驗 20 分（`endsAt` 11:20），那一筆 EECP 已排少 1；括號加起來 −1
- 反過來（app 10:00 體驗 20、照片 11:00 EECP60）→ 改成扣、60 分（`endsAt` 12:00），扣 1 次
- 只拿掉扣法那一個勾 → 照舊改期、扣額度、60 分
- 改期沒先勾（撞期之類）→ 扣法也不先勾
- 沒改扣法的改期一個字都不變（`tests/abovee-moved-rebook.test.js` 全綠）

## 做完時留下的

- `flagMoved()`：拿得準的那一對問 `chargeChangeOf(item, old.visit, { slot, index })`，有差 → `chargeChange`／`chargeLocked`／`adoptCharge`＝`adoptMove && adoptable && !pickedByHand()`、`existing.entitlementId`。
  拿不準的那一對（新的一段）照舊不比。改期只搬還開著的段，所以 `chargeLocked` 這條路上實際上不會是真
- `applyPhotoMove()`：新的那一段的 `endsAt` 照**套的那一刻**舊的那一段的長度算（沒改扣法時跟 `movedSlotFields()` 算的一樣）
- `checkMoves()`：扣法勾著先 `applyPhotoCharge()` 再驗；改期不先勾時扣法一起不先勾
- 確認層的「要改的」、確認框、`photoDayPlan()` 的 `rows` 一個字都沒改：本來就是一列一件事、扣法那一步在改期之前（同一列兩件時次數不重複）
- 測試：`tests/abovee-move-and-charge.test.js`（7 條，先紅 5 條；「只拿掉扣法的勾」與「扣法一樣的改期」是護欄，一開始就綠）；
  `npm run verify` 單元 4901、E2E 9 支 55 條全綠。沒有新的 E2E：確認層的畫法沒變，畫面上多的那一行是 `changeLines()` 本來就會畫的
- 文件：ADR-0154「拍 Abovee」補一條、後果那一條記她 10/19「照這樣記」；CLAUDE.md 拍 Abovee 那一列
- 順手發現：本機 `develop` 從這一輪開始就沒動過（`cd71d34`），`verify` 一直拿整輪的差異挑 spec → lessons 十二
