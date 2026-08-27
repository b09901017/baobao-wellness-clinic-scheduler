# 壓表壓門診時選不到醫師

Status: done
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

## 她的回答（2026-08-27）

> 我想要的是物理治療師和醫師是分開的，門診類的可以選醫生，復能類的選物理治療師這樣，
> 我看目前好像是門診類的不能選，復能可以選醫生和治療師? 然後不用強制要選

所以第 2 點是**要做**的：類別直接決定，不用逐課程勾。

順帶澄清她那句「復能可以選醫生和治療師?」—— 不成立。復能是 C 類、沒開旗標，
所以它只有治療師那一排。會有那個印象是因為主檔的課程編輯器上兩個開關都在，
而那一頁列的是「可以設定什麼」，不是「這個課程現在有什麼」。

## 做了什麼

- `domain/masterData.js` 多一支 `picksDoctor(course)`：**A 類一律選得到**，
  其餘看 `requiresDoctor`。全站唯一一份判斷 —— 驗證、來訪編輯器、壓表都讀它
  （以前 UI 那兩處各自寫 `course?.requiresDoctor`）
- 壓表那一頁多一排醫師（`doctorField()`），治療師那一排順手改走
  `staffWithRole(all.staff, THERAPIST_ROLE)` —— 它以前是 `filter(active !== false)`，
  所以**醫師會跑進治療師的選單裡**，正是 ADR-0026 要防的那件事
- 沒選照樣存得下去（warning 不是 error），她說「不用強制要選」
- 主檔的開關在 A 類課程上改口：「門診（A 類）本來就選得到醫師，這一格開不開都一樣」
- `docs/adr/0058-outpatient-always-picks-a-doctor.md`（推翻 ADR-0026 那一段），
  SPEC 第 5.3、5.4、12 節跟著改
