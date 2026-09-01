# 一則紀錄要講得出誰、哪一天、哪一項

Status: done
來源：使用者，2026-09-01（需求 A）
動工前先讀：`public/js/domain/audit.js`、`public/js/ui/views/audit.js`、
`public/js/domain/availability.js` 的 `describeRuleChanges()`、
`public/js/domain/visits.js` 的 `visitCourseLabel()`、`SPEC.md` 第 6.2 節

## 原話

> 目前的「今天做了什麼」與「稽核紀錄」文字太過籠統、機器化，甚至出現如
> 「勾掉客戶A的客戶A」這種看不懂的疊字。
>
> 問到時間：不要寫新增本輪可用性？這是什麼意思？要寫新增誰.什麼
> 壓表：不要寫新增客戶A的來訪，要寫新增客戶A.日期.項目
> 跟客人確認：誰.日期.項目.改成已確認
> 登記掛號：什麼叫勾掉客戶A的客戶A??
> 日曆與待辦：新增客戶B的隨手記／勾掉客戶B的客戶B？要具體寫是什麼，
> 就是類似，新增了什麼時候誰的什麼事這樣
> 客戶與額度：我不懂甚麼叫改了二返（x萬健檢）的已排未上次數、上次對帳時間

## 根因有三個，不是一個

### 1. 疊字：`override` 撞上 `customerName`

```js
// domain/audit.js，勾任務／勾隨手記那一條
const what = e.after?.kind || subjectOf(e) || describeKind(e);
return `${done ? '勾掉' : '取消勾選'}${withSubject(e, '', { override: what })}`;
```

`subjectOf()` 的第一順位就是 `customerName`，而 `withSubject()` 看到
`customerName` 又會印一次 —— **任務**身上有 `kind` 所以躲過了，
**隨手記**沒有，於是變成「勾掉客戶B的客戶B」。

### 2. 句子只講「哪一種東西」，不講「哪一天、哪一項」

`describeKind()` 回的是集合的名字（來訪、額度、本輪可用性）。
那是**資料的形狀**，不是她講話的方式。素材其實都在稽核裡：
來訪的 `before`／`after` 併起來就有 `date` 與 `slots[].courseName`。

### 3. 有些集合身上根本沒有名字

`customers/{id}/availability` 與 `customers/{id}/entitlements` 都是子集合，
文件上**沒有 `customerName`**（來訪與任務身上才有那個冗餘欄位）。
所以「新增本輪可用性」講不出是誰的。

**id 在路徑上就有**（`customers/{id}/availability/{aid}`），
缺的只是「id → 名字」那一步，而那一步不屬於純函式 ——
所以做成一個**選填的解析器**傳進來，讀不到就退回現在的講法。
**絕不編一個名字**（`subjectOf()` 的檔頭已經寫過這條規矩）。

## 要做什麼

### `domain/audit.js`：多兩支、重寫 `SENTENCES`

```js
/**
 * 這一則掛在哪一位客戶身上。
 *
 * 兩條路：身上有冗餘的 `customerId`（來訪、任務、隨手記），
 * 或者路徑本身就以 `customers/{id}` 開頭（額度、本輪可用性）。
 * 兩條都答不出來就回 null —— **不要編一個**。
 */
export function customerIdOf(event)

/**
 * 一則稽核拆成「誰」與「做了什麼」兩半。
 *
 * 分兩半是為了「今天做了什麼」的**照人分組**：抬頭已經寫著名字了，
 * 每一列再印一次是雜訊。`describeEvent()` 就是把這兩半接起來，
 * 所以兩邊不可能講得不一樣。
 *
 * @param {object} event
 * @param {{nameOf?: (customerId: string) => string|null}} [ctx]
 *   nameOf：id → 名字。子集合（額度、本輪可用性）身上沒有名字，只有路徑上有 id。
 *   **沒傳就退回現在的講法**，不要編一個名字。
 * @returns {{who: string|null, whoId: string|null, text: string}|null}
 *   翻不出來回 null，由畫面退回欄位表（跟現在同一條退路）
 */
export function describeParts(event, ctx = {})

/** 兩半接起來。畫面上要一整句的地方（稽核那一頁、照流程那一格）用它。 */
export function describeEvent(event, ctx = {})
```

### 句子長什麼樣

分隔用 `・`（全站已經在用：`${monthsOf(e)} 個月・${gave.text}`）。
日期一律走 `shortDate()`（全站慣例是 `9/14(日)`，只有這裡印過原始 ISO）。

| 稽核 | `who` | `text` | 接起來 |
|---|---|---|---|
| `visits.create` | 客戶A | `新增・9/14(日)・復能、營養針` | 新增 客戶A・9/14(日)・復能、營養針 |
| `visits.update` status→confirmed | 客戶A | `9/14(日)・復能、營養針・改成已確認` | 客戶A・9/14(日)・… |
| status→done / no_show / cancelled | 客戶A | `9/14(日)・…・改成已完成` | 同上 |
| `visits.update` 只動 `followupNote` | 客戶A | `9/14(日)・記了一句「禮拜一再問問」` | |
| `visits.softDelete` | 客戶A | `刪掉・9/14(日)・復能、營養針` | |
| `tasks.update` done→true | 客戶A | `勾掉・Examine` | |
| `tasks.update` done→false | 客戶A | `取消勾選・Examine` | |
| `notes.create` | 客戶B | `新增待辦・9/3・「帶健保卡」` | |
| `notes.update` done→true | 客戶B | `勾掉待辦・「帶健保卡」` | ← 疊字修掉 |
| `notes.update` 只動 `date` | 客戶B | `待辦「帶健保卡」・改到 9/5` | |
| `notes.update` 拿掉 `date` | 客戶B | `待辦「帶健保卡」・從日曆拿掉` | |
| `notes.softDelete` | 客戶B | `刪掉待辦・「帶健保卡」` | |
| `events.create`（休假） | — | `新增休假・「宜蘭休假」・9/5–9/8` | |
| `events.create`（行事備註） | — | `新增行事備註・「高齡演講」・9/5` | |
| `availability.create` | 客戶A | `新增・9 月的本輪可用性・3 條不能的時間` | |
| `availability.update` 動到 `rules` | 客戶A | `9 月的本輪可用性・多了 9/17 不行、少了 週三不行` | |
| `entitlements.create`（課程） | 客戶A | `新增額度・復能・12 次` | |
| `entitlements.create`（營養品） | 客戶A | `新增營養品・夜態美＋速膳淨・2 個月` | |
| `entitlements.update` 次數 | 客戶A | `二返（12萬健檢）・已排未上 1 → 2 次` | |
| `entitlements.update` `totalQty` | 客戶A | `復能・應有 12 → 15 次` | |
| `entitlements.softDelete` | 客戶A | `刪掉額度・復能` | |
| `formInvites.create` | 客戶A | `發出時間表單連結・9 月` | |
| `formResponses.update` `takenAt` | 客戶A | `收下他填的 9 月時間` | |
| `customers.create` | 客戶A | `新增客戶` | |
| `customers.update` | 客戶A | `改了電話、LINE` | |
| `config/*` | — | 照現在（`新增課程「復能」`） | |

**認不出來的一律回 null**，畫面退回欄位表。硬湊一句錯的比退回去糟
（`describeEvent()` 現在的檔頭就是這樣寫的，這一條不變）。

### 「上次對帳時間」要從句子裡消失

`lastReconciledAt` 每次對帳都會動，而它跟著 `bookedCount` 一起被寫進去，
所以現在那一則掉進「一般的修改」那一條，印出
「改了二返（x萬健檢）的已排未上次數、上次對帳時間」。

```js
/**
 * 只在**組句子**的時候忽略的欄位。
 *
 * 跟 `NOISE_FIELDS` 是兩件事：那一組連欄位表都不列（`updatedAt` 那種
 * 每次寫入都變的），這一組**照樣要列在展開的差異表裡** ——
 * 出事時「上次對帳是什麼時候」是有用的，只是它不該擠掉那一句話。
 */
const QUIET_IN_SENTENCE = new Set(['lastReconciledAt', 'confirmedAt', 'cancelledAt']);
```

濾掉之後那一則只剩 `bookedCount`，就會落進「次數」那一條，
印成「二返（12萬健檢）・已排未上 1 → 2 次」。
只動到 `lastReconciledAt` 的那一則印「復能・對帳過了」。

### 呼叫端要把 `nameOf` 傳進來

| 畫面 | 名字哪裡來 |
|---|---|
| `#/settings/audit`（整頁） | `render()` 多讀一次 `customersData.list()`，跟稽核平行讀 |
| 客戶詳情的「變更紀錄」 | 那一頁本來就知道是誰，傳一個只有一位的解析器 |
| 待辦中心的「今天做了什麼」 | 見 issue 02（那一塊本來就是展開才載入） |

讀不到客戶名單**不可以擋住稽核**：`Promise.allSettled` 或各自 catch，
名單失敗就退回沒有名字的講法。稽核讀得到才是那一頁的主體。

## 連動

- **`tests/audit.test.js` 的斷言字串全部要跟著改。** 那不是「測試壞了」，
  那正是這一件在做的事 —— 每一條都要留著，只是改成新的句子。
- `domain/dayReview.js` 呼叫 `describeEvent()`，簽章多一個選填參數，
  不傳照樣能動（issue 02 才會傳）。
- `domain/audit.js` 會多 import `domain/availability.js`（`describeRuleChanges`）
  與 `domain/dates.js`（`shortDate`）。**都在 `/domain` 底下，沒有循環**
  （`availability.js` 不 import `audit.js`）。`tests/layering.test.js` 盯著。
- `public/sw.js` 的 `VERSION` 加一（`SHELL` 不用改，沒有新檔案）。

## 不做

- **不改稽核的儲存形狀。** 不回頭替 `audit` 補 `customerId` 或 `customerName`
  —— 既有的補不上，補了會變成「新的看得懂、舊的看不懂」，而出事時要回溯的
  往往正是舊的那些（`data/audit.js` 的檔頭已經寫過這個判斷）。
- **不讓 `/domain` 去讀客戶**。名字由呼叫端解析後傳進來，這一層仍然是純函式。
- 不改差異表（展開之後那一張）。它是給查證用的，欄位名照舊。

## 驗證

`tests/audit.test.js`：
- 隨手記勾掉 → `勾掉待辦・「帶健保卡」`，**句子裡「客戶B」只出現一次**
  （`describeEvent()` 的結果對「客戶B」做 split 之後長度是 2）
- 來訪新增 → 句子裡同時有日期與課程名
- 來訪改成已確認 → 句子裡有日期、課程名、`改成已確認`（狀態的字仍然從
  `domain/visits.js` 的 `STATUS_VIEW` 來，不在這裡再寫一份）
- 額度 `bookedCount` ＋ `lastReconciledAt` 一起變 → 句子只講次數；
  但 `changedFields()` **照樣回兩個欄位**（差異表不可以少東西）
- `availability.create` 帶 `nameOf` → 講得出「客戶A・9 月」；
  **不帶 `nameOf` 就不講名字，也不編一個**
- 認不得的東西照樣回 null
- 每一種都要有一條：`describeParts().who` ＋ `.text` 接起來 === `describeEvent()`

瀏覽器：
- `#/settings/audit` 每一列都看得出誰、哪一天、哪一項；展開之後的差異表沒有變少
- 客戶詳情 → 變更紀錄 → 同樣讀得懂
