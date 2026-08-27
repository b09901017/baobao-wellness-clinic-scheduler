# 壓表壓門診時選不到醫師

Status: 待動工
回報者：使用者，2026-08-27（「然後其實A類的門診都要選醫生」）
動工前先讀：`docs/adr/0026-doctors-are-assignable-staff.md`

## 症狀

壓表那一頁（`ui/views/schedule.js`）的欄位有：幾點、器材、營養點滴品項、治療師、診間。
**沒有醫師。**

醫師只在來訪編輯器（`ui/views/visitEditor.js` 的 `doctorField()`）選得到，
而那要先把來訪存下去、再去日曆上點開它。所以她壓完二返之後，
那一段的 `slot.doctorId` 一定是 `null`。

連帶後果：`domain/sheetReport.js` 的 `bookingsOf()` 讀的就是 `slot.doctorId`，
所以試算表的二返註記括號裡永遠沒有醫師名字。

## 兩件事要分開

1. **壓表要能選醫師**（這一張的主體）
2. **A 類是不是一律要選醫師** —— 現在是 `course.requiresDoctor` 這個**課程層級的旗標**，
   跟 A/B/C 類別是兩套設定。她說「A類的門診都要選醫生」，
   聽起來是想讓類別直接決定，不要再逐課程勾一次。

第 2 點動到 `domain/taskRules.js` 的 `RULES`（類別現在只管「在哪壓表」與
「確認後要登記什麼」），是業務規則的改動，**要先問過她**再動 —— 見這一輪的問題清單。
第 1 點不管第 2 點怎麼決定都要做。

## 作法（第 1 點）

`ui/views/schedule.js` 的 `entFields()` 加一排：

```js
${course.requiresDoctor ? doctorField(all) : ''}
```

判準沿用 `visitEditor.js` 那一支（`course.requiresDoctor` + `staffWithRole(all.staff, DOCTOR_ROLE)`），
**不要自己再判斷一次** —— 兩邊各寫一次的話，一邊選得到、一邊選不到，
她會以為其中一個畫面壞了（同 `components/buy.js` 檔頭那個教訓）。

還沒選也存得下去（跟來訪編輯器一樣的措辭：「醫師　還沒定也存得下去」）：
`domain/visits.js` 的 `validateVisit()` 對 `requiresDoctor && !slot.doctorId`
給的是 warning 不是 error，這一頁不要比它嚴格。

## 驗收

- 壓表選到二返（或任何 `requiresDoctor` 的課程）時，冒得出醫師那一排
- 沒選醫師照樣存得下去，只是旁邊有一句提醒
- 選了之後，試算表的二返註記括號裡印得出那位醫師
