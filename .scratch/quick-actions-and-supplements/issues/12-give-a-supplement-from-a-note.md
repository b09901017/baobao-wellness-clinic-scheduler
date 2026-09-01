# 記隨手記的時候多一顆「給營養品」

Status: todo
來源：使用者，2026-09-01（需求 6.6）
Blocked by: 08, 10, 11
動工前先讀：`public/js/ui/components/note.js`、`public/js/domain/products.js`、
`issues/11`、ADR-0044、0059

## 原話

> 在日曆或待辦新增隨手記時，多一個「給營養品」的選項。
> 必須能選擇有加購營養品的客戶，並連動帶出該客戶擁有的品項。
> 完成勾選後，必須正確連動日曆、待辦與客戶詳情的狀態更新。

## 這一顆到底在做什麼

她要記的那一件事本來就有專門的形狀：**一筆掛了 `entitlementId` 的隨手記**
（ADR-0059）。所以「給營養品」不是第五種欄位，是一條**捷徑**：

```
一般的隨手記：  打字 → （選填）日期 → （選填）掛給誰
給營養品：      選客戶 → 選哪一包 → （選填）日期 → 文字與 entitlementId 自動填好
```

**不要讓她自己打「給客戶A營養品：夜態美」那一行字。** `noteTextFor()` 已經
產得出來，而她自己打的那一行**沒有 `entitlementId`**，於是勾掉的時候不會問
「給了哪些」，那筆要進試算表的交付紀錄就沒了 —— 正是
`components/note.js` 檔頭寫的那一種失敗。

## 接在哪：`ui/components/note.js` 多一塊

隨手記的欄位已經有兩塊共用的（`field()` 日期、`who()` 掛給誰）。這是第三塊：

```js
/**
 * 「給營養品」那一顆。**選填的捷徑，不是欄位** —— 按下去才展開，
 * 沒按就跟以前一模一樣（`domain/notes.js` 的「三秒內記完」標準）。
 *
 * 兩層：先選客戶（只列**身上有還沒給完的營養品**的那幾位），再選哪一包。
 * 選完之後文字、掛給誰、`entitlementId` 三件事一起填好，她一個字都不用打。
 *
 * @param {object} [o]
 * @param {{entitlementId, customerId, customerName, text}} [o.picked] 已經選好的
 */
export function give({ picked = null } = {})

/** 現在選的是哪一包。沒選回 null。 */
export function readGive(root)

/**
 * @param {HTMLElement} root
 * @param {{load: () => Promise<{customers, entitlementsBy, notesBy}>}} opts
 *   load：**按下去才會被呼叫，而且只呼叫一次**（同 `wireWho()`）
 */
export function wireGive(root, { load })
```

### 「有加購營養品的客戶」怎麼算

規則在 domain，畫面不自己 filter：

```js
/**
 * 現在有東西可以給的客戶與他們的那幾包。
 *
 * **給完的那幾包不列**（`isFullyDelivered()`）—— 她要的是「今天要拿什麼給誰」，
 * 而給完的那幾包不是。一包都不剩的客戶整位不出現。
 *
 * **已經有提醒的那幾包照樣列**，只是標出來（「9/3 已經約了」）——
 * 她可能就是要改成今天給。選了它就是改那一筆提醒的日期，不是長出第二筆。
 *
 * @param {{customers, entitlementsBy, notesBy}} o
 * @returns {{customerId, customerName, bags: {entitlement, note, label, hint}[]}[]}
 */
export function givableBags({ customers, entitlementsBy, notesBy })
```

`entitlementsBy` 走 `customersData.entitlementsByCustomer()`（一次 collection group
查詢，客戶總覽已經在用），`notesBy` 走 `notesData.listOpen()` 再照 `entitlementId`
收攏 —— **兩份都是這一頁本來就有或一次就讀得到的**，不要逐位客戶查。

### 選完之後

`readGive(root)` 回一份**已經填好的隨手記**：

```js
{
  entitlementId, customerId, customerName,
  text: noteTextFor(entitlement, customerName),   // 「給客戶A營養品：夜態美＋速體淨」
}
```

送出時：

- **這一包已經有提醒了** → 不要建第二筆。`notesData.update(existing.id, { date })`，
  toast 講「改成 9/3 給」。
  （判斷放在 domain：`existingReminder(notes, entitlementId)`。）
- 還沒有 → `notesData.create({ ...readGive(root), date: note.read(root), done: false })`

## 接哪幾個入口

`give()` 這一塊放進**兩個**新增隨手記的地方（她點名的那兩個）：

| 入口 | 在哪 |
|---|---|
| 右下角泡泡 | `views/home.js` 的 `quickBody()` |
| 日曆的待辦編輯器 | `views/calendar.js` 的 `mountNoteEditor()` |

**首頁那張卡底下那一格不放**：那一格是「一行字就記完」的最短路徑，
多一顆按鈕會把它撐成三排（它現在已經有日期與掛給誰兩排了）。
`#/todo/notes` 也不放，它用的是同一顆泡泡。

**選了「給營養品」之後，「掛給誰」那一排要收起來** —— 客戶已經由那一包決定了，
兩個地方各講一次會出現「掛給客戶B、內容是給客戶A營養品」這種東西。
收起來而不是 disable：畫面上少一排比多一排灰的好。

## 連動（她點名要檢查的）

一樣，**沒有第二份資料要同步**：

| 畫面 | 怎麼跟上 |
|---|---|
| 日曆 | 那一筆有日期就在那一天（ADR-0044，日曆的「待辦」就是它本人） |
| 待辦中心／`#/todo/notes` | 它就是一筆隨手記 |
| 客戶詳情的隨手記那一段 | 它掛了 `customerId` |
| 客戶詳情的營養品那一列 | 那一列的「9/3 給」讀的是同一筆提醒（issue 11） |
| 勾掉它 | 走 `prepareToggle()` → `recordDelivery()`，額度的 `deliveries[]` 跟著寫 |

## 不做

- **不做「新增一包營養品」。** 這一顆只挑她已經賣掉的那幾包。要加購走客戶詳情
  ——「賣了什麼」那張表只有一份（`CLAUDE.md` 的連動表）。
- 不列給完的那幾包。
- 不在首頁那一格與 `#/todo/notes` 的行內表單放這一顆。

## 驗證

- 新測試（`tests/products.test.js`）：
  - `givableBags()` 不列已經給完的那幾包
  - 一包都不剩的客戶整位不出現
  - 已經有提醒的那幾包會帶 `hint`（「9/3 已經約了」）
  - `existingReminder()` 找得到同一包的那一筆，找不到回 null
- 瀏覽器：待辦中心 → 右下角泡泡 → 「給營養品」→ 客戶清單只有身上有貨的那幾位
  → 選一位 → 那一位的那幾包 → 選一包 →
  - 文字自動變成「給客戶A營養品：夜態美＋速體淨」
  - 「掛給誰」那一排收起來
  - 按「今天」→ 記下來
- 瀏覽器：日曆 → 某一天 → ＋ → 新增待辦 → 「給營養品」→ 同一條路
- 瀏覽器：那一筆出現在日曆那一天、`#/todo/notes`、客戶詳情的隨手記那一段
- 瀏覽器：客戶詳情的營養品那一列右邊寫著那一天
- 瀏覽器：勾掉它 → **跳「給了什麼？」**（不是直接勾掉）→ 全給 →
  那一列變成「都給了」
- 瀏覽器：對**同一包**再走一次「給營養品」→ 選了之後存 →
  **不會長出第二筆提醒**，是把原本那一筆改期
- `npm test` 全綠
