# 營養品的提醒：空白的交付面板與一條走不完的路

Status: todo
來源：使用者，2026-09-01（需求 6.1）
Blocked by: 08
動工前先讀：`public/js/ui/components/note.js` 的 `prepareToggle()` 與 `askDelivery()`、
`public/js/data/notes.js` 的 `recordDelivery()`、`public/js/domain/products.js`、ADR-0059

## 原話

> 營養品的 Todo 點開目前是完全空白的，而且完成後不會被勾掉？？是嗎

## 三個獨立的坑，症狀長得一樣

### 坑一：名字空白 → 面板每一列都是空的

`askDelivery()` 的每一列印的是 `x.name`：

```js
<span class="slotrow__what">${esc(x.name)}</span>
```

issue 08 已經修掉「以後存進去的名字」，但**既有那幾筆額度身上的名字還是空的**，
而 ADR-0011／0059 的原則是不寫回去、不自動搬。所以**顯示這一側要有退路**。

`domain/products.js` 的 `itemsOf()` 多收一份主檔，認不出名字的時候查一次：

```js
/**
 * @param {object} e
 * @param {{products?: object[]}} [master] 有給的話，名字空白的那幾筆從主檔補
 *   —— 2026-08 到 09 之間存進去的那幾筆 `name` 是空字串（issue 08），
 *   而 ADR-0011 的原則是不回頭改資料。所以認回來的責任在讀的這一側。
 *   主檔裡也沒有（那一款被刪了）就退回「（不知道是哪一款）」，
 *   **不要留空白** —— 一列空白看起來像壞掉的東西。
 */
export function itemsOf(e, master)
```

`itemNames()` / `undelivered()` / `noteTextFor()` / `deliveryState()` /
`productLabel()` 一律把 `master` 往下傳（選填，不給就跟現在一樣）。
`askDelivery()` 的呼叫端把 `config.listAll('products')` 讀進來傳下去。

### 坑二：沒東西可給的時候，那張面板是一條死路

```js
const left = undelivered(entitlement);          // 有可能是空的
const state = new Set(left.map((x) => x.productId));
…
<button … data-give-ok ${n ? '' : 'disabled'}>   // n === 0 → 永遠按不下去
```

`left` 是空的有兩種情況：**一款都沒選的額度**（舊資料）、
**每一款都給過了但提醒沒被勾掉**（`recordDelivery()` 中途失敗、或她手動改過）。
兩種都會得到：**一張沒有任何一列、按鈕還是灰的面板**，
而唯一的出路是「先不要，回去」。她的原話「完全空白、完成後不會被勾掉」
講的就是這一種。

`askDelivery()` 要認出這個狀態並給一條出路：

```js
if (!left.length) {
  // 沒有東西可以給。**不要開一張按不下去的面板** —— 那是死路。
  // 直接問她要不要就這樣勾掉，並講清楚為什麼沒得選。
  const ok = await confirmAction({
    title: '這一包沒有還沒給的東西',
    consequences: [
      items.length
        ? '這一包裡的每一款都已經記過交付了'
        : '這一包沒有記到是哪幾款（舊資料）',
      '勾掉只是把這一則提醒收起來，不會再多記一筆交付',
      '要補記給了什麼，到客戶詳情的營養品那一段改',
    ],
    confirmLabel: '就這樣勾掉',
  });
  return ok ? [] : null;      // [] = 勾掉但不記交付
}
```

`prepareToggle()` 那一段跟著改：`picked` 是空陣列時走 `plain`（純勾掉），
不要呼叫 `recordDelivery()`（它收到空的 `productIds` 會回 `null` patch，
然後那一筆提醒原封不動 —— 又是一條死路）。

### 坑三：她按了「先不要」之後沒有任何回饋

`prepareToggle()` 回 `null`，四個呼叫端都是 `if (!plan) return;`。
**這是對的**（不要說一件沒發生的事），但完全靜默會讓她以為點擊沒反應。
`askDelivery()` 的「先不要，回去」本來就是她自己按的，所以不必加 toast ——
**要加的是坑二那一條路上的**：勾掉之後 toast 講「收起來了，沒有多記交付」。

## 順帶修掉的一件事：提醒沒有日期就不上日曆

issue 08 已經讓客戶詳情加購帶 `deliverOn`。但**找不到下一次來訪時
`deliveryNoteFor()` 會給 `date: null`**（ADR-0059 刻意的：不要猜一天），
於是那一筆提醒只活在隨手記裡，日曆上看不到。

這一支不改那個決定，改的是**看得見**：客戶詳情的營養品那一列，
提醒還沒有日期時多一句「還沒排哪天給」，而 issue 11 的快捷選單第一顆
就是「約時間」。

## 連動

- `tests/products.test.js` 補 `itemsOf(e, master)` 的三種情況
  （有名字、名字空白但主檔查得到、主檔也查不到）。
- `tests/notes.test.js` / 新的 `tests/note-toggle.test.js`：
  `prepareToggle()` 在 `undelivered()` 是空的時候不會呼叫 `recordDelivery()`。
  （`components/note.js` import 了 `components/sheet.js`，而那一支碰 DOM ——
   所以**要先把 `askDelivery()` 的「有哪幾款可以給」抽成 `domain/products.js`
   的純函式** `deliveryChoices(entitlement, master)`，測那一支就好。）
- `data/notes.js` 的 `recordDelivery()` 不動 —— 它的判斷（沒給完就留著、
  換文字）是對的，而且 ADR-0059 寫死了。

## 不做

- 不自動把舊資料的 `items[].name` 寫回去。
- 不讓交付面板變成可以「補選一款」—— 改一包裡有哪幾款是編輯那一筆額度的事。

## 驗證

- 新測試：
  - `itemsOf({ items: [{ productId: 'p1', name: '' }] }, { products: [{ id: 'p1', name: '夜態美' }] })`
    → 名字是「夜態美」
  - 主檔查不到 → 名字是「（不知道是哪一款）」，不是空字串
  - `deliveryChoices()` 對一包都給完的回空陣列
- 瀏覽器：拿一筆**舊的**（名字空白的）營養品提醒 → 勾掉 →
  面板列得出那幾款的名字，不是空白
- 瀏覽器：把一包全部給完之後手動把提醒改回沒勾 → 再勾一次 →
  **跳的是那張「這一包沒有還沒給的東西」的確認**，不是空白面板；
  按「就這樣勾掉」→ 提醒勾掉了，額度上的 `deliveries` 沒有多一筆
- 瀏覽器：只給一部分 → 提醒**不勾掉**、文字換成剩下的那幾款、日期不動（ADR-0059）
- `npm test` 全綠
