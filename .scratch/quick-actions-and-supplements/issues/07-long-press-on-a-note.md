# 隨手記的每一列接上長按

Status: done
來源：使用者，2026-09-01（需求 B.5 的後半）
Blocked by: 05
動工前先讀：`issues/05`、`public/js/ui/components/note.js`、
`public/js/domain/notes.js`、ADR-0044、0045

## 原話

> Todo 那邊的長按也要能快捷新增掛載的客戶、日期，或是「給營養品」。

## 接在哪：五個入口，一份清單

隨手記的一列（`note.row()`）出現在**五個**地方：

1. 待辦首頁底下那張卡（`views/home.js` 的 `notesCard()`）
2. 右下角泡泡記完之後那幾列（同上，`[data-just]`）— **不接**，那是剛記的回執不是清單
3. `#/todo/notes`（`paintNotes()`）
4. 客戶詳情的隨手記那一段
5. 日曆的抽屜／日／週（issue 06 那一支的第三種）

**清單只有一份，放在 `domain/notes.js`**：

```js
/**
 * 長按一筆隨手記，快捷選單上有哪幾顆。
 *
 * 五個入口共用一份 —— 在待辦中心長按有「改日期」、在日曆長按沒有，
 * 那不是兩個畫面，是同一個畫面壞了一半（`components/note.js` 的檔頭）。
 *
 * @param {object} note
 * @param {{today: string, onCalendar?: boolean}} o
 *   onCalendar：這一列現在畫在日曆上（那裡「拿掉日期」要講成
 *   「從日曆拿掉」，因為那正是她看得到的後果）
 */
export function noteActions(note, { today, onCalendar = false })
```

| id | label | 什麼時候有 |
|---|---|---|
| `tick` | 做完了，勾掉 | `!note.done` |
| `untick` | 拿回來，還沒做 | `note.done` |
| `today` | 改成今天 | 沒有日期，或日期不是今天 |
| `date` | 挑一天 | 一定有 |
| `undate` | 從日曆拿掉 | 有日期（`onCalendar` 時 label 換成這一句，否則寫「拿掉日期」） |
| `who` | 掛給誰 / 改掛給誰 | 一定有 |
| `deliver` | 給營養品 | 見 issue 12 |
| `edit` | 改文字 | 一定有 |
| `remove` | 刪掉（紅） | `note.done`（跟垃圾桶同一條規矩：還沒做的要刪先勾掉） |

**最多六顆**（issue 05 定的）。所以要分兩層：

- 沒有 `entitlementId` 的一般隨手記：`tick` / `today` 或 `date` / `who` / `edit` /
  `undate` 或 `remove`。
- 有 `entitlementId` 的營養品提醒：`tick`（那一顆會問「給了哪些」）/ `date` /
  `edit` /「看那一包」。它已經有交付面板了，不再塞 `deliver`。

`noteActions()` 自己收斂到六顆以內，測試盯著。

## 每一顆怎麼做

| id | 做什麼 |
|---|---|
| `tick` / `untick` | **走 `note.prepareToggle()`**，跟四個入口同一支（營養品的提醒會先問「給了哪些」）。不可以直接叫 `notesData.setDone()` —— `#/todo/notes` 曾經那樣做，交付紀錄靜靜沒了 |
| `today` | `notesData.update(id, { date: todayISO() })` + toast |
| `date` | 開系統原生的 `<input type="date">`（`note.field()` 的「挑日期」同一招：`showPicker()` 要在點擊的手勢堆疊裡才叫得動）→ 選完就存 |
| `undate` | `update(id, { date: null })`，toast 講「從日曆拿掉了，隨手記裡還在」 |
| `who` | 一張小面板列客戶（`note.wireWho()` 的那一排丸子）→ 選完 `update(id, { customerId, customerName })` |
| `edit` | 開既有的待辦編輯器（日曆那一支 `openNoteEditor()`）—— 待辦中心那三個入口本來沒有編輯器，這一顆等於**補上了 ADR-0044 Consequences 記的那個缺口** |
| `remove` | `notesData.remove(id, '長按刪掉')`，走 `withSaveState()` 所以復原退得回去 |

## 一個坑：`normalizePatch()` 不碰 `entitlementId`

`domain/notes.js` 的 `normalizePatch()` 刻意只整理「有帶到的那幾個欄位」。
所以上面每一顆都**只帶它自己要改的那一欄**就好，帶多了反而會清掉別的
（那正是 2026-08-25 那個「改一件已經勾掉的待辦會把它變回沒做」的 bug）。

`who` 那一顆是唯一要帶兩欄的（`customerId` + `customerName` 是一組）。

## 連動

- 客戶詳情的隨手記那一段長按 → 存完要重畫那一段（不是整頁，ADR-0038）。
- 日曆上長按 → 存完 `render(el)` 再把那一天重開（同 issue 06）。
- `#/todo/notes` 與首頁 → 存完 `renderNotes()` / `render()`。
- 這一支**同時解決了 ADR-0044 Consequences 記的一個缺口**：
  「沒有編輯隨手記這條路，除了日曆上那一張卡」。現在五個入口都改得動了 ——
  要在那一份 Consequences 底下補一句（不改舊的段落，補在最後）。

## 不做

- 不做長按多選。
- 不在快捷選單裡改「文字」本身（那要鍵盤，鍵盤要一張表單 → 走 `edit`）。
- 不接右下角泡泡記完之後那幾列（那是回執，不是清單）。

## 驗證

- 新測試（`tests/notes.test.js`）：
  - `noteActions()` 對還沒勾的回 `tick` 不回 `untick`，反之亦然
  - 沒有日期的不回 `undate`
  - 還沒勾的不回 `remove`
  - 任何情況都**不超過六顆**
  - 掛了 `entitlementId` 的回的是營養品那一組
- 瀏覽器（四個入口各走一次）：長按 → 改成今天 → 那一筆當場出現在日曆那一天
- 瀏覽器：長按一筆營養品的提醒 → 勾掉 → **跳出「給了什麼？」**（不是直接勾掉）
- 瀏覽器：長按 → 掛給誰 → 選一位 → 客戶詳情的隨手記那一段看得到它
- 瀏覽器：長按已勾掉的 → 刪掉 → toast 上的「復原」退得回來
- `npm test` 全綠
