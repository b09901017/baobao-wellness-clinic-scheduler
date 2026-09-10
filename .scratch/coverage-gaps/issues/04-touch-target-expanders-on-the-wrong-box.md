# 十二個撐開觸控區的 `::after` 貼錯了盒子

Status: open（`.slothead__x` 與 `.slotnote__pin` 兩顆 2026-09-10 已修）
來源：2026-09-10，`25-visit-editor-one-slot.spec.js` 的 V7 / V8 點不到那顆夾板
動工前先讀：`SPEC.md` 第 1 節（不能有小到 44px 以下的點擊區）

## 症狀（已修的那一顆）

來訪編輯器每一段右上角那兩顆：夾板（記一句）與 ×（取消這一段）。
**按夾板會跳出「取消第 N 段？」。**

`.slothead__x::after { position: absolute; inset: -8px }` 是把 28px 的視覺撐回
44px 觸控區用的，但 `.slothead__x` 自己**沒有 `position: relative`** ——
於是那一層去貼最近的定位祖先，也就是 `.slotcard__tools`（那一格本身是
`position: absolute`）。結果是 × 的感應範圍蓋住整格，包含左邊那顆夾板。

破壞性的那一顆吃掉旁邊那一顆，是這個形狀裡最貴的一種錯法。

2026-09-10 修掉的是：兩顆都補 `position: relative`、夾板補上自己的撐開層、
`gap` 從 2px 改成 16px（兩個 44px 的感應範圍才不會互相疊）。

## 還沒動的十一個

同一支掃描（`app.css` 裡 `X::after` 有 `position:absolute` + `inset: -`，
而 `X` 自己沒有定位）還列得出這幾個：

```
.btn--sm::after          button.mark::after      .mark__x::after
.drawer__grip::after     .popcard__icon::after   .namerow__edit::after
.taskrow__link::after    .roster__x::after       .noterow__trash::after
.iconbtn::after          .seg__btn::after        .emojirow__btn::after
```

**沒有一起改是刻意的。** 每一個的感應範圍現在都落在某個上層盒子上，
改成貼自己身上會**同時移動十一個地方的觸控區** —— 那是一次沒有人要求的
重構，而且症狀（按到旁邊那一顆）只有在旁邊真的有另一顆控制項時才出得來。

## 做法

1. 先寫一支原始碼掃描擋住新的（見下），**掛在既有那十一個的白名單上**，
   白名單只准變短 —— 同 `tests/e2e-waits.test.js` 的 `PENDING`
2. 一顆一顆看：它旁邊有沒有別的控制項？有的先修
3. `08-ux-audit` 的 U7+U8 量的是「有沒有小於 44px」，量不到「壓到隔壁」——
   要補的是「兩顆相鄰的圖示按鈕，各自的感應範圍不可以蓋到對方的中心」

## 掃描長什麼樣

```js
// public/css/app.css：每一個用 ::after 撐開觸控區的元素，自己一定要是
// 定位的 —— 不然那一層會去貼上層某個盒子，而症狀是「按到旁邊那一顆」。
```

放進 `tests/tokens.test.js`（`.backlink` 那條掃描的隔壁）。
