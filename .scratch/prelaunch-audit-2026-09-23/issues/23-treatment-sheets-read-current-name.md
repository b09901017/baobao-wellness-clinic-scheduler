# 改名時療程單那一頁跟著變，表單邀請不變

Status: todo
來源：`../spec.md`（第二輪）、09 的延伸
動工前先讀：`issues/09`、`domain/treatmentSheets.js` 的 `compareAll()`、`ui/views/treatmentSheets.js` 的 `compareEveryone()`、
`domain/availabilityForm.js` 的 `newInvite()`、`data/publicForm.js`
相關：16

## 她要的

照建議（2026-09-23）：

- **療程單那一頁改讀客戶本人的名字**
- **客人填時間的表單邀請不換** —— 那一句是客人自己看得到的，而改名常常是為了跟同名的人分開，那個尾巴不該給客人看

## 現在壞在哪

帶 `customerName` 快照、而 09 沒有處理的集合有兩個：

- `treatmentSheets`：主清單本來就讀客戶本人（`ui/views/treatmentSheets.js:128`），但「全部比對一次」的結果讀的是療程單身上的快照
  （`domain/treatmentSheets.js:477`，`:482` 還拿它排序；畫在 `ui/views/treatmentSheets.js:305`）。改名之後那一塊印舊名字
- `formInvites`：`newInvite()` 存 `customerName`，`data/publicForm.js:66` 給客人看的表單讀它。**這一個刻意不換**

## 做法（方向）

- `compareAll(sheets, visits, master, customers)`（或畫面那一側）用 `customerId` 去查客戶本人的名字，查不到才退回快照；排序跟著用現在的名字
- 表單邀請：一行程式都不改。CLAUDE.md「客戶改名」那一列寫清楚：療程單那一頁讀本人、**表單邀請刻意不換**（附理由），
  下一個看到「漏了一個帶 `customerName` 的集合」的人才不會把它補回去

## 判準

- 客戶A 有一張療程單 → 改名王大明 →「全部比對一次」那一塊印王大明，而且照王大明排序
- 客戶A 有一份這個月的表單邀請 → 改名之後打開那張表單，還是客戶A
- `tests/treatment-sheets.test.js` 補一條
