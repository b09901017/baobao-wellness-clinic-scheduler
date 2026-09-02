# 「n返」：一場沒有額度的來訪

Status: 動工中
來源：她的四件事，2026-09-02（`../spec.md`）
動工前先讀：ADR-0022（二返額度成對展開）、ADR-0042（報告先於二返）、
ADR-0057（營養品是排不進來訪的額度）、CONTEXT.md 的「二返」與「額度」

## 她要的是什麼

> 和二返一樣，就是健檢完後會約客戶來聽醫生講解報告，約第一次叫二返，
> 第二次叫三返依此類推。不一樣的點是，二返是一定有的……但是三返、四返……
> 他不常發生，通常是客戶要求，他聽不懂或是想再聽一遍我才會預約。
> **這個 n返 不需要先加購才能有，只要有健檢的就可以選**，
> 也沒有次數限制，沒有一定要也沒有只能到幾返。

四個硬條件：
1. **二返的所有東西一個字都不動**
2. 不需要額度（不用先加購）
3. 沒有次數上限
4. 一定要指得出「這是哪一次健檢的」

## 為什麼 n返 不吃額度（她 2026-09-02 決定：**不吃**）

「額度」在 CONTEXT.md 的定義是「某位客戶**買到的**某個課程的次數」。
n返 沒有被買、沒有次數、扣不掉 —— 它不是額度。

硬要塞成額度只有兩條路，兩條都會壞：

| 作法 | 壞在哪 |
|---|---|
| 開一筆 `totalQty` 很大的「n返」額度 | 客戶詳情那一排額度卡會多一張寫著「剩 97 次」的卡；`summarize()` 的合計、`lowRemaining()`、`customersToBook()` 全部會吃到它 —— 而 ADR-0057 已經為了營養品打過同一場仗（`schedulable()` 那道閘門就是那次的產物）|
| 每約一次就把 `totalQty` 加一 | 剩餘永遠 0，看起來像用完了；而且「加購」與「排班」變成同一個動作，稽核紀錄上每一次壓表都會多一筆額度變更 |

所以：**n返 的時段不指向任何額度**（`slot.entitlementId = null`），
它靠時段上兩個新欄位自己站得住。

這件事的先例已經有了 —— `domain/visits.js` 的 `recount()` 早就寫著
`if (slot.entitlementId) ids.add(...)`，`domain/health.js` 的 `refState()`
對 `null` 回 `'none'` 並且不報孤兒。系統原本就沒有假設每一段都有額度，
只有 `validateVisit()` 那一行硬性要求。

## 資料形狀

`visits/{id}.slots[]` 多兩個欄位：

```js
{
  entitlementId: null,          // ← n返 沒有額度。二返照舊指向它那一筆
  courseId: <二返那個課程的 id>,  // 類別、要不要選醫師、要不要簽療程單全部沿用
  courseName: '三返',            // 快照，畫面上看到的就是它
  followupForVisitId: <健檢那一筆來訪的 id>,   // 既有欄位，n返 **必填**
  followupNth: 3,               // ← 新欄位。3 起跳，二返身上沒有這個欄位
  doctorId, roomId, startsAt, endsAt, attended, ...   // 其餘跟一般時段一樣
}
```

### 為什麼 `courseId` 借二返那個課程，而不是開一個新課程

借了之後這幾件事**一行程式都不用寫就成立**：

- `taskRules.js`：類別 A → 客人確認之後長出 Examine 與耀聖（她要的「一樣的 todo」）
- `visits.js` 的 `needsForm()`：二返 `needsTreatmentForm: false` → n返 也不用簽單，
  但**照樣要在「簽療程單」那一列結案**（SPEC 第 8.1 節那一句「不用簽單跟不用收尾是兩件事」）
- `masterData.js` 的 `picksDoctor()`：A 類 → 選得到醫師（試算表註記的括號要它）
- `bookingSystemsForVisit()`：取消時知道要回哪個系統放時段
- 日曆、客戶詳情的來訪紀錄、`visitCourseLabel()`：讀 `slot.courseName` → 印「三返」

開一個新課程的話，上面每一格都要她自己去主檔設定一次，設錯了症狀是
「三返沒有長出掛號待辦」而畫面上什麼都不會說。

**二返那個課程是誰**：從健檢課程的 `followupCourseId` 讀（ADR-0022，
不從名字比對）。所以「沒有設二返課程的健檢，也不能約 n返」—— 那是對的，
n返 的前提就是二返存在。

### 名字

`domain/nthFollowup.js` 的 `nthLabel(n)`：3 → `'三返'`，10 → `'十返'`。
**上限 10**（她說沒有上限，但一個數字輸入框允許她打 999 只會讓打錯字變成
一筆看不懂的資料；十返已經遠超過真的會發生的次數，真的碰到再放寬）。
下限 3 —— 2 是二返，那一條路已經有了，兩條路不可以都走得到同一個數字。

## 一支新檔案：`domain/nthFollowup.js`

**不寫進 `domain/followups.js`。** 那一支的檔頭寫著它回答三個問題，三個都是
「額度層級的一對一配對」；n返 一個都不是。混在同一支裡，之後改二返的人
一定會不小心改到 n返（反之亦然），而這一輪最硬的條件就是那兩者不能互相影響。

```js
/** 3 → '三返'。3–10，超出範圍回 null（不猜） */
export function nthLabel(n)

/** 這一段是不是 n返。看 followupNth，不看課程名字也不看額度 */
export function isNthSlot(slot)

/**
 * 可以接 n返 的健檢來訪。**已完成的才算** —— 沒做完的健檢沒有報告可以再聽一次。
 * 判斷「哪一筆來訪是健檢」跟 domain/followups.js 走同一條路（額度 → 課程有
 * followupCourseId），不是比課程名字。**但不做認領** —— 二返一對一，
 * n返 沒有上限，所以這裡沒有 taken。
 */
export function examChoicesForNth(entitlements, coursesById, visits, { selected })

/** 這一次健檢已經約掉哪幾返（含二返的 2）。給預設值與重複提醒用 */
export function nthsBookedFor(examVisitId, visits, followupEntitlementIds)

/** 下一個該是第幾返。沒有任何紀錄時是 3 */
export function nextNthFor(examVisitId, visits, ...)

/** 某一次健檢底下所有的回訪，照 n 排序。試算表註記與客戶詳情共用 */
export function followupsOfExam(examVisitId, visits, ...)
```

## `domain/visits.js` 要改的三個地方（**只有這三個**）

1. **`visitErrors()` 那一行 `if (!slot.entitlementId) errors.push('要選一個額度')`**
   → n返 的時段不要求額度。改法是先問 `isNthSlot(slot)`。

2. **n返 的 `followupForVisitId` 是必填**（二返仍然只是 warning）。
   理由不一樣所以行為不一樣：二返有舊資料一筆都沒有那個欄位（ADR-0011），
   擋下來她連改時間都存不回去；n返 是全新的，**沒有舊資料**，而且沒有那個
   連結它在試算表上就沒有位置可以印。

3. **指到的那一筆要真的是一次已完成的健檢**。二返那一條檢查的是
   「用掉這一筆二返所配的那筆健檢額度」，n返 沒有額度可以比，改成比
   「那一筆來訪裡有沒有一段用掉了任何一筆健檢額度」。

另外加一條 **warning 不是 error**：同一次健檢底下已經有一筆同樣的 n返 時提醒
（「這一次健檢的三返已經約在 9/20 了」）。不擋 —— ADR-0002：app 記錄決定，
不做決定，而她可能真的要改期（改期是取消再排一筆，兩筆會同時存在一下下）。

## 不會被影響的東西（實際查過的）

| 地方 | 為什麼安全 |
|---|---|
| `counts()` / `slotOutcome()` | 逐段比對 `slot.entitlementId !== entitlementId` → n返 的 `null` 永遠不相等，一次都不會被算到 |
| `owed()` / `claimedExams()` / `syncFollowupTasks()` | 全部以二返那一筆額度的 id 為軸；n返 沒有那個 id |
| `sheetReport.mark()` 那個矩陣 | 逐格比對 entitlementId → n返 不進矩陣（她要的就是「記在健檢底下」） |
| `entitlementWarnings()` | `entsById[undefined]` → `undefined` → `continue` |
| `domain/health.js` 的孤兒檢查 | `refState(null)` 回 `'none'`，`push()` 直接跳過 |
| `firestore.rules` 的 `validVisit()` | 只看 `slots is list && size() > 0`，一個時段欄位都不驗 |
| `data/visits.js` 的 `recount()` | 已經是 `if (slot.entitlementId)` |

**要親自再看一次的**：`domain/progress.js`（進度追蹤那一頁怎麼算「做了幾次」）、
`domain/dayReview.js`、`domain/audit.js` 的 `describeParts()`（稽核那一句話
會不會因為沒有額度而印出怪東西）。實作時逐支確認，測試補上。

## SPEC / CONTEXT / ADR 要跟著改的

- `SPEC.md` 第 5.3 節 `visits/{id}` 的 `slots[]`：補 `followupNth` 與
  「n返 的 `entitlementId` 是 null」那一句
- `CONTEXT.md`：新增詞條「**n返**」，並在「二返」那一條底下加一行界線
  （二返是買了幾次健檢就有幾次、有額度；n返 是加約的、沒有額度、沒有上限）
- 新 ADR：`0063-an-nth-followup-is-a-visit-without-an-entitlement.md`
- `CLAUDE.md` 的連動表：新增一列「改 n返 的形狀 → 一定要一起檢查⋯⋯」

## 驗證

- `npm test`（新增 `tests/nth-followup.test.js`；`tests/followups.test.js`
  與 `tests/visits.test.js` **一個現有的斷言都不可以改**）
- 一筆只有 n返 的來訪存得下去、次數一次都沒有被扣
- 同一位客戶身上二返與三返並存時，「約二返」那張待辦的行為完全沒變
