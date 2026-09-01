# 加購營養品存下去的時候，「哪幾款」的名字被清成空字串

Status: done
來源：使用者，2026-09-01（需求 6.1、6.2、6.5 的共同根因）
動工前先讀：`public/js/ui/components/buy.js`、`public/js/domain/products.js`、
ADR-0057、0059、`CLAUDE.md` 的「她賣了什麼給客戶」那一列

## 症狀（她講的三件事，其實是同一個 bug）

> 6.5 產生的營養品 Todo 標題不該只是「營養品：營養品」
> 6.2 加購營養品時，輸入的價格沒有正確被加入到名稱顯示中
> 6.1 營養品的 Todo 點開目前是完全空白的

## 根因

`buy.read(form, v)` 從表單讀回「哪幾種」的時候，**名字一律是空字串**：

```js
out.items = raw
  .filter((id) => id !== PRODUCT_NEW)
  .map((id) => ({ productId: id, name: '' }));   // ← 名字沒了
```

那本來不是問題：`afterDetail()` 會馬上呼叫 `withItemNames(draft, master)`
把名字從主檔補回去，所以**畫面上**的草稿一直是對的。

問題出在**存檔那一下**，三個入口都一樣：

```js
// customerDetail.js
const next = await buy.commitNewProduct({ ...live, ...readEntitlement(form) }, ...);
// customers.js（新增客戶的「加一項」）
const next = await buy.commitNewProduct({ ...item, ...buy.values(form) }, ...);
// customersBulk.js（微調面板的「加一項」）— 同上
```

`readEntitlement(form)` 與 `buy.values(form)` 裡面就是 `buy.read()`，
所以那一份**沒有名字的 items** 蓋掉了 `live` / `item` 裡有名字的那一份。
`commitNewProduct()` 只在她真的按了「＋ 新增…」時才補一筆，其餘原樣回去。

於是寫進 Firestore 的是 `items: [{ productId: 'p1', name: '' }, …]`。
接著三個地方一起壞：

```
itemNames(e)   = ''                  → productLabel(e) = 「營養品 5,000」（少了那幾款）
noteTextFor(e) = 「給營養品：營養品」   ← 6.5 她看到的那一句
askDelivery()  每一列印 x.name        → 一整片空白  ← 6.1
```

**6.5 的另一半**：`data.createEntitlement(ctx.id, ...)` 沒有帶 `{ customer }`，
所以 `deliveryNoteFor()` 收到的 `customer.name` 是 `null`，
`noteTextFor()` 的 `who` 是空的 —— 那句話因此連客戶姓名都沒有。
（ADR-0059 寫了要帶，實作漏了。）

## 要做什麼

### 一、名字在唯一的最後一站補齊

三個入口在存檔前都會呼叫 `buy.commitNewProduct(draft, master, createProduct)` ——
那就是「送出去之前的最後一站」，而且它手上有 `master`。讓它同時負責補名字：

```js
/**
 * 存檔前的最後一站。做兩件事：
 *
 *   1. 她在「＋ 新增…」打的那一款寫進主檔並選起來
 *   2. **把 `items` 上的名字從主檔補齊**
 *
 * 第二件事看起來多餘（`afterDetail()` 已經補過了），但那一份會被存檔那一下的
 * `buy.values(form)` 蓋掉 —— 表單只送得回 id。名字要跟著存：那一款之後被主檔
 * 刪掉時，畫面上還要印得出來（同 `payload()` 對 `productId` 的理由）。
 * 少了它，`productLabel()`、`noteTextFor()` 與交付面板會一起變成空白。
 *
 * 三個入口共用同一支，理由跟 `wire()` 一樣。
 */
export async function commitNewProduct(draft, master = {}, createProduct) {
  const name = String(draft?.newProductName ?? '').trim();
  if (!draft?.newProduct || !name || typeof createProduct !== 'function') {
    return withItemNames(draft, master);          // ← 早退這條路也要補
  }
  // …既有那一段…
  return withItemNames(
    { ...draft, items, newProduct: false, newProductName: '', label: draft.label },
    master,
  );
}
```

`withItemNames()` 已經存在（現在是 private），**認不出來的那一筆留著 id、
名字保持原樣**，所以不會把她自己新增的那一款洗掉。

**為什麼不改 `buy.read()`**：它是純函式而且測試直接餵一個假的 form
（`tests/buy.test.js`），要補名字就得多收一個 `master` 參數，
而三個呼叫端都要記得傳 —— 那又是三份會分岔的東西。

### 二、`payload()` 順手把形狀清乾淨

```js
items: product
  ? (e.items ?? []).map((x) => ({
      productId: x.productId ?? null,
      name: String(x.name ?? '').trim(),
    }))
  : null,
```

`itemNames()` 本來就 `filter(Boolean)`，所以空字串跟沒有一樣；統一形狀是為了
讓存進去的東西可預測（`firestore.rules` 只驗 `items is list`）。

### 三、客戶詳情加購要帶客戶姓名與交付日期

`views/customerDetail.js` 的 submit：

```js
await toast.withSaveState(
  () => data.createEntitlement(
    ctx.id,
    buy.toEntitlement(next, { purchasedAt: ctx.customer.purchasedAt ?? null }),
    {
      // 提醒那一句要印出是誰（`noteTextFor()`）。少了它會變成「給營養品：…」，
      // 而她的隨手記上一次有十幾筆，看不出是誰的。
      customer: ctx.customer,
      // 「我都是等客人哪天有預約來，我就順便給」（ADR-0059）。
      // 找不到就留空白 —— 不要退回今天，見 `nextDeliveryDate()` 的檔頭。
      deliverOn: nextDeliveryDate(ctx.visits, todayISO()),
    },
  ),
  { success: '已加購', key: `entitlement:create:${ctx.id}` },
);
```

`nextDeliveryDate()` 已經寫好了，**一直沒有人呼叫它**（全庫 grep 只有定義）。
`ctx.visits` 這一頁本來就讀好了，不多一次 IO。

### 四、舊資料

**不寫回去、不自動搬**（ADR-0011、0059 的同一條原則）。既有那幾筆
`name: ''` 的額度靠 issue 10 的「顯示時退回主檔查名字」救，
她下次編輯那一筆時才會換成新的形狀。

## 連動

- `tests/buy.test.js` 補：`commitNewProduct()` 在**沒有要新增**的情況下
  也會把名字補齊。
- `tests/products.test.js`：`noteTextFor()` 收到有名字的 items 會印出那幾款。
- `CLAUDE.md` 那一列（三個入口共用一份）**不用改** —— 這一支正是在把「共用」補完整。

## 不做

- 不改 `buy.read()` 的簽名。
- 不寫搬移腳本。

## 驗證

- 新測試：
  - `commitNewProduct({ items: [{ productId: 'p1', name: '' }] }, { products: [{ id: 'p1', name: '夜態美' }] })`
    → `items[0].name === '夜態美'`
  - 主檔裡沒有的那一筆 → id 留著、名字不變（不可以變成 `undefined`）
- 瀏覽器：客戶詳情 → 加購 → 營養品 → 勾「夜態美」「速體淨」→ 金額 5050 → 加購
  - 那一筆的顯示名稱是「營養品 5,050（夜態美＋速體淨）」
  - 隨手記多一筆「給客戶A營養品：夜態美＋速體淨」，**而且有日期**
    （＝這位客戶下一次有預約的那一天）
  - 日曆的那一天出現一件待辦
- 瀏覽器：新增客戶那一頁的「加一項」、批次建立「微調」的「加一項」各走一次，
  結果一模一樣
- `npm test` 全綠
