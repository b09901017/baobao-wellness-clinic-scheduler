# 03 批次取消的底條浮在半空

Status: done
動工前先讀：`.scratch/quieter-screens/spec.md`

## 她要的

> 批次取消點進去人名之後，勾選了一天，下面會出現"選了n段(m天) 取消這一段" 這個區域很突兀，有種懸空的感覺?版面很怪?

## 為什麼會這樣

`.bulkbar`（`public/css/app.css:7134`）是 `position: sticky; bottom: 0`。
**sticky 只有在它的容器捲得動的時候才會貼底。** 只勾一天時整頁高度撐不滿一個視窗，
它就停在自然文件流的位置。

實測（390×844）：

```
bulkbar top=328 bottom=395   viewportH=844   底下還有 450px 空白
```

而它身上帶著 `border-top`、`background: var(--surface)`、
`box-shadow: 0 -2px 12px`（往上打的陰影）—— 那一整套是「我貼在畫面底部」的視覺語言。
貼不到底的時候，那些訊號就變成「一條浮在空氣上的橫條」，正是她說的懸空。

按鈕上的字是 `取消這 ${picked.length} 段`（`bulkCancel.js:326`），她記成「取消這一段」。

## 怎麼做

兩條路，選一條：

1. **讓那一頁至少撐滿一個視窗高**（`min-height: 100dvh` 之類），sticky 就永遠貼底。
   改動最小，但要確認頂上的 `.envbar` / `.netbar` 存在時不會多出捲軸。
2. **改成真的固定在底部**（`position: fixed`），並在頁面底部墊出等高的空白，
   免得最後一列被蓋住。

也順手把版面收乾淨：現在它是 `margin: … calc(-1 * var(--gutter))` 硬把自己撐出
`.page` 的左右留白，如果改成 fixed 就不需要那一招了。

## 判準

- 只勾一段（頁面很短）時，那一條**貼在視窗底部**，不是浮在內容正下方
- 勾很多段、頁面捲得動時，行為跟現在一模一樣（捲動時黏在底部）
- 最底下那一列不會被它蓋住
- iOS 的 `env(safe-area-inset-bottom)` 那一行留著
- 測試：E2E 勾一段，斷言 `.bulkbar` 的 `getBoundingClientRect().bottom`
  跟 `window.innerHeight` 的差距在幾 px 以內
