# 永久限制併成兩層，醫療禁忌不再硬擋

Status: 已完成

## 她說的

> 有體內金屬只能壓INDIBA(但是其他兩個也不是一定不行(只要儀器不要在金屬的上方
> 或附近)，只是會強烈建議用indiba)所以其實體內有金屬這件事不用硬性擋不能壓其他
> 兩個，就只要明顯的標註提醒就好，不用擋

> 我覺得可以合併成兩層(警示/其餘)，然後血管難打，體內有金屬，可以最明顯，
> 然後不需要在丸子上提示說只能選甚麼，只需要在選到不是indiba的時候更明顯提醒就好

## 現在是什麼樣

永久限制有三層（ADR-0064）。第一層**醫療禁忌**是全站唯一會擋下儲存的規則，
第二層**臨床提醒**什麼都不擋。兩層的唯一界線就是「會不會擋」—— 拿掉阻擋之後，
那條界線就不存在了，所以兩層要合併，不是留著一個空殼。

五個執行點：

| 位置 | 現在做什麼 | 改成 |
|---|---|---|
| `domain/contraindications.js` | 整支的前提是「這是唯一的硬性阻擋」 | 改成「哪一台要提醒、建議用哪一台」 |
| `domain/visits.js` `visitErrors()` | 選到被擋的器材 → **存不下去** | 移到 `visitWarnings()` |
| `ui/views/visitEditor.js:560` | 選項劃掉、不可點 | 可點，選了才出現一句明顯的建議 |
| `ui/views/schedule.js:1395` | 同上 | 同上 |
| `domain/scheduling.js` `allEquipmentBlocked()` | 時段反查把這個人**整個排除** | 整支拿掉 —— 不再有「真的不能來上這堂課」 |

## 要做什麼

### 一、`domain/customers.js` 的 `splitFlags()` 回兩層

```js
// 從
{ contraindications: [...], clinical: [...], others: [...] }
// 改成
{ alerts: [...], others: [...] }
```

`alerts` 的名單就是 `clinicalTerms(clinicalFlags)`。**器材主檔上那些字要在這份
名單裡**，否則「體內金屬」會掉到 `others` 去、卡片牆上就不畫了 —— 補進去那一步
交給 `09` 的資料健檢，這裡不自動搬。

`splitFlagsForEdit()` 與 `mergeFlags()` 跟著從三份變兩份。

### 二、`domain/contraindications.js` 改語意，**檔名不改**

檔名留著是刻意的：改檔名要動 `public/sw.js` 的 `SHELL` 清單、十幾支 import 與
`tests/`，而換來的只是一個更貼切的名字。同一個取捨這個專案做過一次
（`events.category` 的 `personal` / `leave` 在改名成「行事備註」之後沒有跟著改，
見 `CONTEXT.md`）。**檔頭要整段重寫**，講清楚它現在是什麼。

| 現在 | 改成 | 為什麼 |
|---|---|---|
| `isBlocked()` | 刪掉 | 沒有人再問「擋不擋」 |
| `blockingFlags()` | `noticeFlags()` | 同一段身體，名字不再說「擋」 |
| `annotateOptions()` | 留，`blocked` 欄改成 `notice` | 呼叫端要的是「這一台要不要提醒」 |
| `validateSlots()` | `equipmentNotices()`，回 warning 形狀 | 呼叫端從 `visitErrors()` 換成 `visitWarnings()` |
| `equipmentLimitLabel()` | `suggestedEquipment()` | 回「這一池裡沒有被提醒的那幾台」 |
| `contraindicationTerms()` | 留著不動 | 器材上登記了哪些字，`09` 與匯入都要問 |
| `contraindicationHints()` | 留著不動 | 匯入時從舊表的字裡找提示，一行都不用改 |

`suggestedEquipment()` 回的是**建議**，不是限制：

```js
// 這一池裡，這位客戶身上沒有任何一個警示對得上的那幾台
// 回 null = 這一池沒有任何一台要提醒（那就不必講任何話）
{ suggested: [{id, name}], noticed: [{id, name, reasons}] }
```

### 三、選到要提醒的那一台時，講一句明顯的話

兩個入口（來訪編輯器、壓表的記錄面板）共用一支，**不要各寫一次** —— 兩份寫法
遲早有一邊漏掉新加的器材，而漏掉的症狀是「這一頁有提醒、那一頁沒有」。

句子由 domain 算，不在畫面上拼：

```
「體內金屬」：建議改用 INDIBA，或先確認儀器不會在金屬上方
```

- 前半段是**對得上的那幾個警示**（`noticeFlags()`）。
- 中段是**建議哪幾台**（`suggestedEquipment().suggested`）。一台都不剩就整句
  省略後半 —— 沒有東西可以建議的時候硬講一句話，比不講糟。
- 後半那句固定，因為它就是她講的原話（「只要儀器不要在金屬的上方或附近」）。

畫法：不是 `field__hint` 那種灰字。它要跟警示丸子同一個重量級，貼在器材那一排
底下、有底色。**`aria-live="polite"`** —— 她換一台丸子時那一句是就地換字的
（ADR-0038：選了什麼不重畫整頁），沒有 live region 的話讀螢幕的人不會知道它變了。

### 四、卡片牆上那顆算出來的丸子拿掉

`ui/components/flags.js` 的 `alertChips()` 裡 `equipmentLimitLabel()` 那一段整段
刪掉，`options` 這個參數跟著消失。她明講不需要（見上面的原話）。

**警示本身那幾顆留著**，而且變成兩層合併後唯一的那一排。畫法在 `02`。

### 五、時段反查不再排除任何人

`domain/scheduling.js` 的 `allEquipmentBlocked()` 整支刪掉，`backfillCandidates()`
裡那一段 `drop(customer, ...)` 跟著刪。理由要留在程式碼旁邊：一台都不能用
這件事以後不存在了，而「這個人不要推薦給我」是她的判斷不是 app 的（ADR-0002 的
主體仍然成立）。

## 不做的

- **不刪 `equipment.contraindications` 這個欄位。**「哪一台要提醒」仍然從器材主檔
  推出來 —— 她 2026-09-06 選的。改的只有那一欄在畫面上叫什麼
  （設定 → 器材：「醫療禁忌」→「要特別提醒的狀況」）。
- **不動 `firestore.rules`。** Rules 從來沒有擋過禁忌（`contraindications.js` 檔頭
  那句「前端擋一次，Firestore Rules 再擋一次」講的是別的事），所以那一層沒有
  東西要拆。
- **不碰匯入那條路。** `contraindicationHints()` 找的是「舊表的字裡有沒有提到
  器材上登記的狀況」，那件事跟擋不擋無關。

## 測試

- `tests/customers.test.js`：`splitFlags()` 回兩層；器材上有、警示主檔沒有的字
  掉進 `others`（那正是 `09` 要列出來的那一種）。
- `tests/visits.test.js`：選到要提醒的器材 → `errors` 是空的、`warnings` 有一句。
  **這一條是這一輪的回歸主軸**：它以前是 error。
- `tests/scheduling.test.js`：一位有體內金屬、池裡三台全部要提醒的客戶，
  仍然出現在時段反查的候選裡。
- `tests/domain.test.js` / 新的 `contraindications` 測試：`suggestedEquipment()`
  三種情形（沒有任何一台要提醒 → null、剩一台、一台都不剩）。
- `tests-e2e/specs/14-clinical-alert.spec.js` 要跟著改：那一支現在在驗「擋得住」。

## 連帶

`12` 會改 `SPEC.md` §4.3／§4.5／§14、`CONTEXT.md` 三條，並補 ADR-0074。
