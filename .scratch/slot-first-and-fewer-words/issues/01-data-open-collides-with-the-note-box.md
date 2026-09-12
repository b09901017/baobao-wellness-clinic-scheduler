# 01 記一句一點就跳出「的 0 段」

Status: done
動工前先讀：`.scratch/slot-first-and-fewer-words/spec.md`

## 她要的

> a 但是現在我在跟客人確認時間那邊，我點記一句，他會顯示"的 0 段
> 確認之後會自動排進日曆，並且產生該做的登記。
>
> 哪一段客人說不行就點它一下，其餘的照樣成立。"
> 但是沒有記任何東西

## 為什麼會這樣

**一個屬性名字撞車。** 跟「記一句」這個功能本身沒有關係。

`ui/components/slotNote.js` 的 `disclosure()` 把展開狀態記在外框上：

```js
<div class="slotnote" data-slotnote="${name}" data-open="false">
```

而「跟客人確認時間」那一頁（`ui/views/home.js` 的 `wireConfirm()`）這樣接線：

```js
el.querySelectorAll('[data-open]').forEach((btn) =>
  btn.addEventListener('click', () => {
    drawer = { customerId: btn.dataset.open, rejected: new Set(), shown: false };
```

那一頁的 `[data-open]` 本來指的是「這一列是哪位客戶」。於是那個外框也被接了一次，
`btn.dataset.open` 收到字串 `"false"` → `byCustomer(...).get("false")` 是 undefined →
`visits = []` → 抬頭印成 **「的 0 段」**，底下是那張確認面板固定的兩句話。
她打的字沒有被送出 —— 那個 `submit` 根本沒機會發生。

**觸發點是她點進輸入框（或點收起來那一行）那一下**，不是點夾板那一顆：
夾板在外框外面（`followupForm()` 先 `toggle()` 再 `disclosure()`），
外框裡面的任何一下 click 都會冒泡到它身上。

日曆沒發作，是因為它所有 `[data-open]` 都先過 `parseOpen()`（`ui/views/calendar.js`），
認不出沒有冒號的值就回 `null` —— 那支函式的檔頭寫著它是為了擋 `.fab[data-open="true"]`
才這樣寫的。**同一個坑擋過一次，只是擋在日曆那一側。**

`.slotnote` 身上那個 `data-open` **在 CSS 裡沒有任何規則、JS 裡也沒有人讀**，
它是純粹的死重。

全站 `data-open` 現在有三種意思：

| 意思 | 哪裡 |
|---|---|
| 這一列是誰／哪一段 | 日曆的 `visit:<id>:<第幾段>`、`note:<id>`、`event:<id>`；home 的客戶 id 與來訪 id |
| 展開了沒（boolean） | `.slotnote`、`.reviewmore__box`、`.pbsearch` |
| 這顆懸浮鈕開著沒 | `.fab` |

## 怎麼做

把「展開了沒」那一種改名（`data-slotnote-open`），或直接拿掉 ——
沒有人讀它。順手看一眼另外兩處（`.reviewmore__box`、`.pbsearch`）會不會落在
某一頁的 `querySelectorAll('[data-open]')` 底下（目前不會，但同一個形狀）。

**不要用「在 handler 裡多判斷一次」來修。** 那正是日曆那一側已經付過的帳，
而這一頁沒付 —— 第三頁還是會忘。

## 判準

- 在「跟客人確認時間」點開記一句、點進輸入框、打字、按「記」——
  **確認面板一次都沒有跳出來**，而那句話真的存進去了
- 先寫一支失敗測試：掃原始碼，斷言 `slotNote.js` 產出的 HTML 裡沒有裸的 `data-open`
- E2E：`04-journey-a-happy` 那一段有走到確認頁，補一下「記一句」那一下
