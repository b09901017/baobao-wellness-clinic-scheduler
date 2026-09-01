# 金額打進去不會進顯示名稱，而且 5050 被瀏覽器擋掉

Status: todo
來源：使用者，2026-09-01（需求 6.2、6.3）
Blocked by: 08
動工前先讀：`public/js/ui/components/buy.js` 的 `wire()` 與 `productRow()`、
`public/js/ui/components/form.js` 的 `number()`、`firestore.rules` 的 `validEntitlement()`

## 原話

> 6.2 加購營養品時，輸入的價格沒有正確被加入到名稱顯示中
> 6.3 加購營養品時，不需要強制檢查整數（例如輸入 5050 卻被要求 5000 或 5100）。我打多少就存多少

## 根因一：金額打字沒有人在聽

`buy.wire()` 的 `input` 監聽只認兩個欄位：

```js
root.addEventListener('input', (ev) => {
  if (!ev.target.matches?.('[name="tierText"], [name="newProductName"]')) return;
  …
});
```

「多少錢」那一格（`name="amountTwd"`）不在裡面。所以：

- 打字時 `afterDetail()` 不會跑 → 顯示名稱不會重算
- 「會變成『…』」那句預告也不會換
- 存檔時 `readEntitlement(form)` 讀得到金額（那是 `readForm()` 讀的），
  但 `label` 是**上一次重畫時**算的，裡面沒有金額

換句話說：金額有存進去，只是**沒有進名字**。而 `productLabel()` 的設計
（ADR-0059：`營養品(5000)` 是她舊表的寫法）整個依賴那個名字。

## 根因二：`step="100"`

```js
${f.number({ name: 'amountTwd', label: '多少錢　選填', value: …, min: 0, step: 100 })}
```

`<input type="number" step="100">` 會讓瀏覽器的內建驗證擋下 5050，
訊息是「請輸入有效值，最接近的有效值為 5000 和 5100」——**她看到的就是這一句**。
表單因此連 submit 都不會觸發，所以 `validateProduct()` 那條「要是正整數」
其實一次都沒有攔到她。

那個 `100` 是當初「金額通常是整百」的猜測，而 5050 就是反例。

## 決定（使用者 2026-09-01 選的）

**只拿掉倍數限制，仍然限正整數。不碰 `firestore.rules`。**

理由是 `firestore.rules` 的 `validEntitlement()` 現在寫著：

```
(d.amountTwd is int && d.amountTwd > 0)
```

小數會被**資料庫整包拒收**，而那個失敗發生在寫入那一刻、沒有畫面事先擋得住。
要開放小數就得同時改 Rules、`amountOf()`、`validateProduct()`、試算表報表的
金額欄與四支測試，而她要的只是「5050 存得下去」。

## 要做什麼

### 一、`buy.wire()` 聽金額

```js
/**
 * 打字會改到顯示名稱的那幾格。**打字不重畫** —— 重畫會把游標與輸入法的
 * 組字狀態一起洗掉，所以名稱與那句預告是就地改的（`reflect()`）。
 */
const TYPED_FIELDS = '[name="tierText"], [name="newProductName"], [name="amountTwd"]';

root.addEventListener('input', (ev) => {
  if (!ev.target.matches?.(TYPED_FIELDS)) return;
  …
});
```

`reflect()` 已經會把新的 `label` 寫回「顯示名稱」那一格與那句預告，
所以她會**看著金額長進名字裡**。

### 二、`productRow()` 的欄位

```js
${f.number({
  name: 'amountTwd', label: '多少錢　選填',
  value: e.amountTwd ?? '', min: 1, step: 1,
  hint: '整包的價錢，打多少就是多少。會寫進名稱裡，也會進試算表。',
})}
```

- `step: 1` —— 5050 過得了瀏覽器那一關
- `min: 1` 而不是 `0` —— `validateProduct()` 本來就擋 0（「送的東西她不會記在
  營養品那一列」），欄位跟驗證要講同一句話

### 三、驗證訊息講人話

`domain/products.js` 的 `validateProduct()`：

```js
errors.push('金額要是大於 0 的整數（5050 可以，5050.5 不行）');
```

**規則沒有變**，變的是那句話 —— 她剛剛才被「5000 或 5100」擋過，
要看得出這一次擋的是別的東西。

## 連動

- `tests/buy.test.js` 補一條：在 `amountTwd` 上派 `input` 事件之後，
  `onChange` 收到的草稿 `label` 裡有金額。（`buy.wire()` 測得動 ——
  它不 import 任何 `/data`，只要一個假的 form，現有的測試已經在這樣做。）
- `tests/products.test.js` 那一條「金額填了就要是正整數」比對的是 `/金額/`，
  改了訊息也不會紅。
- `firestore.rules` **不動**。`sheets/readonly-report.gs` 與 `SYNC_FORMAT` **不動**。

## 不做

- 不開放小數。要開放的話這一支要重開，而且**她必須回 Google 試算表重貼 `.gs`
  並重新部署**（`CLAUDE.md` 那一列）。
- 不把金額變成必填 —— 她的舊表裡有沒寫金額的。

## 驗證

- 瀏覽器：加購 → 營養品 → 勾兩款 → 在「多少錢」打 `5050`
  - **每打一個字**，底下那句「會變成『營養品 5,050（夜態美＋速體淨）』」跟著變
  - 展開「進階設定」，顯示名稱那一格也是同一句
  - 按加購 → **存得下去**，不再跳「最接近的有效值」
- 瀏覽器：打 `0` → 送出 → 錯誤訊息是「金額要是大於 0 的整數（5050 可以，5050.5 不行）」
- 瀏覽器：清空金額 → 送出 → 存得下去，名稱是「營養品（夜態美＋速體淨）」
- `npm test` 全綠
