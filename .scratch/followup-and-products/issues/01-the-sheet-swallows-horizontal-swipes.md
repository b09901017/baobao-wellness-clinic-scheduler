# 抽屜裡的丸子左右滑不動

Status: 待動工
回報者：使用者，2026-08-27（「新增一批客戶的微調那裡 丸子不好左右滑」）
動工前先讀：`docs/adr/0021-the-sheet-is-dragged-by-transform.md`

## 症狀

「新增一批客戶」→ 某一列的「微調」→ 面板裡「買了什麼」那一排丸子，
橫向滑不動，或者滑一下面板自己跟著上下跑。

## 為什麼

`ui/components/sheet.js` 的 `wireDrag()` **整支只看 Y 座標**。
`onStart(clientY, target)` 與 `onMove(clientY)` 從頭到尾沒有 X。

判斷接不接手這個手勢的那一段（`onMove()` 的 `mode === 'undecided'`）：

```js
if (!dy) return false;
if (!scroller) mode = 'sheet';
else if (dy > 0 && scroller.scrollTop <= 0) mode = 'sheet';
else if (dy < 0 && detent !== 'full') mode = 'sheet';
else { mode = 'scroll'; return false; }
```

橫向滑的時候手指幾乎不可能只動 X，`dy` 通常是 1～3px。於是：

- 面板內容不夠長（`.drawer__body` 捲不動）→ `scroller` 是 `null` → **一律接手**
- 內容夠長但已經捲到最上面、手指順便往下偏一點 → 也接手

接手的第一件事是 `e.preventDefault()`（`touchmove` 是 `passive: false`），
瀏覽器的橫向捲動當場被取消。**這不是「不好滑」，是根本滑不到。**

## 範圍：不只微調那一頁

`wireDrag()` 是全站唯一一支抽屜手勢。所以同一個症狀出現在每一個
抽屜裡的橫向捲動列：

| 畫面 | 那一排是什麼 |
|---|---|
| 批次建立 →「微調」 | `components/buy.js` 的「買了什麼」「幾萬的」「哪一種」 |
| 客戶詳情 →「加購」 | 同一張表（三個入口共用一份） |
| 日曆某一天 → 來訪編輯器 | 時間、器材、治療師、診間、醫師 |
| 日曆某一天 → 待辦編輯器 | `components/note.js` 的欄位 |

一起修，不要只修微調那一頁 —— 同一支接線壞了，四個地方都在壞。

## 想要的樣子

手指橫著滑就橫著捲，面板不動；直著滑才拖面板。**判斷仍然只做一次**
（`onMove()` 檔頭那條規則不變：第一次 `touchmove` 就要決定，不然瀏覽器
會先把手勢拿走）。

## 作法

1. `onStart()` / `onMove()` 收 `clientX`，`undecided` 那一段先問一句
   「這一下比較像橫的還是直的」：`Math.abs(dx) > Math.abs(dy)` → `mode = 'scroll'`，
   直接把手勢還給瀏覽器。
2. 保險再加一道：手指按下去的地方在一個**真的捲得動的橫向容器**裡
   （`.chiprow` / `.chips` / `[class*="noscroll-bar"]`，且 `scrollWidth > clientWidth`）
   → 一律不接手。這一道擋的是「她想滑丸子但手指幾乎垂直地劃過去」那種。

兩道都要，因為它們擋的是不同情況：第一道看方向，第二道看她按在什麼上面。

## 驗收

- 微調面板裡「買了什麼」那一排，橫著滑得動，面板不會跟著上下跳
- 面板本身還是上下拖得動（把手、抬頭、留白處），拖到底還是會關掉
- 內容夠長時 `.drawer__body` 還是自己捲，捲到頂再往下拖才收面板
