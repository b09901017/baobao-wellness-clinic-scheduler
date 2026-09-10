# 04 合作機構那顆丸子多一個「＋」，而且在壓表上拉滿整行

Status: todo
動工前先讀：`.scratch/quieter-screens/spec.md`、`docs/adr/0076-a-memo-can-hang-on-a-partner.md`

## 她要的

> 我發現自然美這個標註的框框很怪，a不需要"+"自然美，b那個綠色框框是一直延伸的誒 ? 像是在壓表那邊的呈現，有點太長了，不能像是體內金屬那種符合"自然美"這三個字大小的嗎?

（「自然美」是合作機構主檔上的一個名字。）

## 為什麼會這樣

### a 那個「＋」

`public/css/app.css:680`：

```css
.flag--partner::before { content: '＋'; margin-right: 2px; opacity: 0.7; }
```

它是 ADR-0076 落地時刻意加的 —— 註解寫著理由：「這一顆是中性的方框加一個小前綴，
掃過去一眼就知道它是另一種東西」。**現在有更好的分辨方式**（顏色與圓角已經跟警示分開了），
而她說那個符號讀起來像一顆「新增」按鈕。拿掉。

### b 框框延伸

`public/js/ui/components/flags.js:73` 的 `alertChips()` 回的是
`<span class="blockchips">…</span>` —— `.blockchips` 是 `display: flex` 的橫排包裝。

而 `public/js/ui/views/schedule.js:932`：

```js
return flagsUi.alertChips({ … }) + flagsUi.partnerChips(row.partners ?? []);
```

**partner 那幾顆被接在 `.blockchips` 的外面**，裸放進 `.row__main`。
而 `.row__main` 在那個脈絡下算出來是 `display: flex; flex-direction: column`，
`align-items` 是預設的 stretch —— 於是那顆丸子被拉滿整行。

實測（390px）：

| 呼叫端 | 那顆丸子的寬度 |
|---|---|
| `schedule.js:932`（壓表卡片牆一列） | **273px** ← 這一個 |
| `home.js:3358`（待辦「壓表登記」一列） | 60px |
| `customers.js:314`（客戶清單） | 60px |
| `customerDetail.js:221`（客戶詳情） | 60.6px |

所以壞掉的**只有壓表那一個呼叫端**，其餘三處都是對的。

## 怎麼做

1. 拿掉 `.flag--partner::before` 那三行。
2. `partnerChips()` **自己回一個包裝**（跟 `alertChips()` 一樣的 `.blockchips`，
   或一個 `display: inline-flex` 的殼），不要再讓呼叫端把它裸接在別人後面。
   四個呼叫端都改成拿那一份包好的。
3. `.flag` 補一條 `align-self: flex-start`——這是保險：以後任何一個呼叫端
   把它丟進 column flex 都不會再被拉開，而**這種 bug 從畫面上分不出是誰的錯**。

## 判準

- 壓表卡片牆那一列上，「自然美」那顆的寬度跟「體內金屬」同一個量級（貼合文字）
- 另外三個呼叫端寬度一個 px 都沒有變
- 那顆丸子前面沒有任何符號
- 警示那幾顆（`chipHtml()`）一個字都沒動 —— 它們的顏色由主檔上的填法決定（ADR-0074）
- 測試：一支掃原始碼的測試，斷言 `partnerChips()` 的輸出**不是**裸的 `<span class="flag">`
  開頭（也就是它自己帶包裝）
