# 看今天做了什麼

Status: todo
來源：使用者，2026-09-01（需求 D.7）
動工前先讀：`public/js/domain/audit.js`、`public/js/data/audit.js`、
`public/js/ui/views/audit.js`、`public/js/data/sheetSync.js`、
ADR-0043、`SPEC.md` 第 6.2 節與第 8.1 節

## 原話

> 我需要一個能回顧今天操作紀錄的介面（例如：壓了誰的表、在 Abovee/Examine 弄了誰、
> 簽了哪些療程單、記錄了哪些日曆/Todo/來訪）。
> 目的：確認是否有遺漏登記（例如忘記把某個紀錄同步到試算表）。
> UI 呈現：可以在代辦那邊的最下方增加一個「看今天做了什麼」的按鈕，點擊後展開。
> 請用非常白話、簡潔、且 UI 閱讀起來舒服的方式呈現
> （也許可讀取現有的 audit 稽核紀錄來實作，但我希望更直觀白話簡短的呈現）。

## 素材已經全部在了

`domain/audit.js` 的 `describeEvent()` 早就會把一則稽核翻成一句話
（「客戶A的來訪改成已完成」「勾掉 Examine」）。缺的只有兩件：

1. **一層歸類** —— 稽核是照時間倒序的一長串，而她問的是
   「今天**做了幾件事**、哪一類漏了」。
2. **一個入口** —— 現在只有 `#/settings/audit`，而那一頁的框架是
   「出事時往回查」，不是「收工前對一次」。

所以這一件不新增任何一份資料（SPEC 第 6.2 節：稽核是唯一的來源），
只加一支純函式與一塊畫面。

## 新檔案：`public/js/domain/dayReview.js`

```js
/**
 * 今天做了什麼。**稽核紀錄的白話版，不是第二份紀錄**（ADR-0062）。
 *
 * 這一支只翻譯與歸類，一件事都不判斷 —— 跟 `domain/audit.js` 同一條界線。
 *
 * @param {object[]} events 那一天的稽核（新的在前）
 * @param {{today: string}} o
 * @returns {{groups: Group[], counts: object, total: number}}
 */
export function reviewOf(events, { today })
```

### 分成哪幾段：照她的流程，不照集合名

段落順序**跟待辦中心同一條流程**（ADR-0043）—— 她一天就是照那個順序做的，
兩頁用不同的順序等於要她在腦子裡翻譯一次。

| 段 | 白話抬頭 | 收哪些稽核 |
|---|---|---|
| ① | 問到時間 | `formInvites.*`（發連結）、`formResponses.*`（收下）、`customers/*/availability.*` |
| ② | 壓表 | `visits.create` |
| ③ | 跟客人確認 | `visits.update` 且 `status` 變成 `confirmed`；`visits.update` 只動到 `followupNote`（「禮拜一再問問」） |
| ④ | 登記掛號 | `tasks.update` 且 `done` 變成 true（Examine、耀聖、追蹤健檢報告、約二返 —— **種類直接印 `task.kind`**） |
| ⑤ | 簽療程單 | `visits.update` 且 `status` 變成 `done` / `no_show` |
| ⑥ | 取消與改期 | `visits.update` 且 `status` 變成 `cancelled`；`visits.softDelete` |
| ⑦ | 日曆與待辦 | `events.*`、`notes.*` |
| ⑧ | 客戶與額度 | `customers.*`、`customers/*/entitlements.*` |
| ⑨ | 設定 | `config/*.*` |
| ⑩ | 其他 | 上面都對不上的（**不要丟掉**，同 `describeEvent()` 回 null 時退回欄位表的判斷） |

**空的段不畫。** 她一天不會碰到九件事。

### 一則長什麼樣

一則就是 `describeEvent(event)` 那一句話，加上時間。翻不出來的退回
`describeAction(event.action)` —— 跟 `views/audit.js` 的 `rowHtml()` 同一條退路。

**同一句話連續好幾則要收成一則**：她一次壓表會存十幾筆，
`勾掉 Examine` 出現八次是雜訊。

```js
/**
 * 一模一樣的句子連著出現就收成一則，右邊寫「×8」。
 *
 * **只收連著的**，不是全天去重 —— 她早上勾了三張 Examine、下午又勾了兩張，
 * 那是兩件事（中間隔著別的動作）。全天去重會把「下午又做了一次」藏起來。
 */
function collapse(rows)
```

### 頂端那一排數字

```
壓了 6 筆　簽了 3 張單　記了 4 件待辦　登記 8 筆
```

只印**有值的**那幾顆（同 `countLine()` 的作法：0 不佔位）。
數字直接從段落的長度來，不另外算一份。

## 畫面：待辦中心最底下一塊

跟客戶詳情的「變更紀錄」同一種（她指名的那一個）：一塊 `<details>`，
**展開時才載入**。理由一模一樣 —— 她一天開待辦中心十幾次，
而看回顧是收工前一次的事。

```html
<details class="card" data-review>
  <summary class="card__title">看今天做了什麼</summary>
  <div data-review-body><p class="muted">展開時才載入。</p></div>
</details>
```

擺在**隨手記那張卡下面、懸浮泡泡上面**。

### 展開之後

```
┌─────────────────────────────────────┐
│ 9月1日 星期一        ‹ 昨天  今天 ›  │
│                                     │
│ 壓了 6 筆　簽了 3 張單　記了 4 件待辦 │
│                                     │
│ ② 壓表                               │
│   14:22  新增客戶A的來訪              │
│   14:20  新增客戶B的來訪         ×3   │
│                                     │
│ ⑤ 簽療程單                           │
│   16:05  客戶A的來訪改成已完成         │
│                                     │
│ ⑦ 日曆與待辦                         │
│   09:11  勾掉 給客戶C營養品：夜態美     │
│                                     │
│ ─────────────────────────────────── │
│ 試算表：16:07 推過了                  │
└─────────────────────────────────────┘
```

- **每一列不可以展開。** 那一頁的角色是「掃一眼確認沒漏」，
  要看差異表走 `#/settings/audit`（底下放一條連結）。
  這是它跟稽核那一頁唯一的分工，也是「白話簡短」的意思。
- 往前翻：`‹ 昨天` / `今天 ›`，最多往前七天（再遠她會去查稽核那一頁）。
  換一天只重畫那一塊（ADR-0038），不重畫整頁。

### 最底下那一行：試算表

她點名的那句「確認是否有遺漏登記（例如忘記把某個紀錄同步到試算表）」。
`data/sheetSync.js` 已經有四個現成的答案，一行講完：

| 狀態 | 那一行寫什麼 |
|---|---|
| 沒設定 | 「試算表：沒有設定自動推送」 |
| 乾淨、推過了 | 「試算表：16:07 推過了」 |
| `isDirty()` | 「試算表：**還有東西沒推上去**」（用 `--soon` 的顏色） |
| `lastError()` | 「試算表：上次推失敗 —— {原因}」（用 `--overdue`） |
| `lastSkipped()` | 「試算表：有 N 張分頁沒更新（{名字}）」 |

**這一行只在今天那一格出現** —— `sheetSync` 存的是「上次」，不是每一天的歷史。
翻到昨天時那一行要收起來，不然它會在講今天的事。

## `data/audit.js` 多一支

```js
/**
 * 某一天的變更，新的在前。「看今天做了什麼」用。
 *
 * `at` 上的範圍查詢加上 `at desc` 排序，吃的是 Firestore 自動有的單欄索引，
 * **不必補複合索引**。
 *
 * 上限 300 筆：她最忙的一天（一次壓十幾位客戶）大約一百多則。
 * 滿了就在畫面上講出來，不要靜靜截斷（SPEC 第 6.9 節）。
 */
export function listOnDay(day, limit = 300)
```

日界線用**本地時間**（`new Date(`${day}T00:00:00`)`）—— 她問的是「我今天做了什麼」，
而稽核的 `at` 是 Firestore 的 Timestamp。`views/audit.js` 的 `dayOf()` 已經
用本地時間分組了，兩邊要一致。

## 連動

- **`public/sw.js`**：`SHELL` 補 `/js/domain/dayReview.js`，`VERSION` 加一。
- **補一支 ADR-0062**（`docs/adr/0062-today-is-a-plain-language-view-of-the-audit-log.md`）：
  它是稽核的白話版，**不是第二份紀錄**；沒有任何東西為了這一頁而多寫一筆。
- **`SPEC.md` 第 8.1 節**補這一塊（擺在「隨手記」那一段後面）。
- **`README.md` 開發狀態表**打勾（`CLAUDE.md` 的連動表）。
- `firestore.rules` **不動** —— audit 本來就讀得到。

## 不做

- **不為了這一頁多寫任何一筆資料。** 稽核已經涵蓋每一次寫入（SPEC 第 6.2 節）。
- 不做「未完成的事」清單。那是待辦中心本人的工作，這一塊只講**做過的**。
- 不做匯出。
- 每一列不做展開。

## 驗證

- 新測試 `tests/day-review.test.js`：
  - 一則 `visits.create` 落在「壓表」那一段
  - `visits.update` 且 status → `done` 落在「簽療程單」，→ `cancelled` 落在「取消與改期」
  - `tasks.update` 且 done → true 落在「登記掛號」，done → false **不落在那裡**
  - 連著三則一模一樣的句子收成一則 `×3`；中間隔了別的就不收
  - 對不上的落進「其他」，**一則都不會被丟掉**（總數等於進去的筆數）
  - 空的段不出現
- 瀏覽器：待辦中心捲到底 → 「看今天做了什麼」→ 展開才載入
- 瀏覽器：壓一筆表、簽一張單、記一件待辦 → 回來展開 → 三段各一列，數字對得上
- 瀏覽器：往前翻昨天 → 只有那一塊重畫，試算表那一行收起來
- 瀏覽器：把試算表設定關掉／製造一次失敗 → 底下那一行講得出來
- `npm test` 全綠，`tests/shell-cache.test.js` 認得新檔案
