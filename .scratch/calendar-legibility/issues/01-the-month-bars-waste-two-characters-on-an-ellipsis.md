# 月檢視的色條：置中、多顯示、切掉就切掉

Status: done
來源：使用者，2026-08-23（spec.md 的 a 與 c）

## 原話

> 「日曆上的文字置中」
> 「日曆字可以多顯示一點，然後不用…沒辦法顯示的就直接截斷就好，不要用…占位置」

## 現況

`public/js/ui/views/calendar.js` 的 `monthHtml()` 畫出來的 `.monthbar`，
CSS 在 `public/css/app.css`：

```css
.monthbar {
  display: block;
  text-align: left;
  font-size: 10px;
  padding: 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
```

三個問題，都在這幾行裡：

1. **`text-align: left`**，但同一格上面的日期數字是置中的（`.monthweek__hit`
   的 `justify-content: center`）。一格裡兩套對齊，短名字看起來就是歪的。
2. **`text-overflow: ellipsis`**。在 10px 的字、一格七分之一螢幕寬的地方，
   那顆 `…` 吃掉的寬度接近兩個中文字。它換來的資訊是「還有字」——
   而色條被切掉這件事她一天看幾百次，早就知道了。
3. **`padding: 0 4px`** 左右各讓掉 4px，再加上 `.monthweek` 的 `gap: 2px`，
   一格裡真正放得下字的寬度只剩下不到八成。

## 要做什麼

### 置中，但只在放得下的時候

直接把 `text-align` 改成 `center` 是錯的：文字比格子寬的時候，
置中會讓**開頭的姓也被切掉**，而姓正是她在掃的那個字。

用 `justify-content: safe center`：放得下就置中，放不下就自動退回靠左，
從右邊切。`safe` 這個關鍵字就是為了這件事存在的。

這代表 `.monthbar` 要從 `display: block` 改成 flex，而現在那行 `block`
上面有一段註解特別警告過不要這樣做：

```
/* 刻意用 block 不用 flex：text-overflow 的省略號對 flex 容器裡的裸文字無效，
   名字會被從中間切一半 —— 那看起來像畫面壞了，不像「還有字」。 */
```

**那段警告的前提正好是這一支要拿掉的東西。** 省略號不留了，
「省略號在 flex 裡無效」就不再是問題。改的時候**把那段註解一起改掉**，
寫清楚為什麼現在可以用 flex —— 留著一段講反話的註解，
下一個人（或下一次的我）會照著它把 flex 改回 block。

文字包一層 `<span>`，不要當裸文字放進 flex 容器。

### 截斷就截斷

- `text-overflow: ellipsis` → `clip`。
- 省下來的寬度拿去放字：`padding` 左右收到 3px。

### 多顯示一點

`visitAsBar()` 現在的 `title` 是 `${customerName} ${courseName}`。
兩個都放而且中間一個空白，等於一格裡最多看得到姓名的前三個字。改成：

- 姓名與課程之間**不用空白，用一個細的分隔**（例：`王小明·復能`），
  省下一個字的寬度。
- 字級 10px → 11px。這一頁的密度已經是全站最高，但 10px 的中文在
  iPad 橫式上是真的要湊近看；11px 仍然遠小於 `--text-2xs`。
- `.monthweek` 的 `gap` 與 `.monthbar` 的 `min-height` 不動 ——
  一格裡塞得下幾條是另一件事，不在這一支。

## 注意

- **色條照樣不吃點擊**（`pointer-events: none`）。ADR-0020 的核心之一，
  改對齊與寬度的時候不要把它弄掉。
- `.monthbar` 是 grid 項目，`min-width: 0` 一定要留 ——
  拿掉的話長名字會把色條撐出格子外蓋到隔壁天。
- `.allday`（日檢視上釘在最上面的整天行程）用的是另一組 class，這一支不動它。

## 驗證

- `npm test`
- 瀏覽器：一個名字很短的（例：王小明）與一個很長的（例：歐陽小美 復健科醫師門診）
  排在同一週，短的要置中、長的要從右邊切掉而且**開頭的字完整**。
- 月檢視在 380px 與 1080px 兩個寬度各看一次。

## Comments

**2026-08-23 —— done。** 照計畫做完，兩件事跟原本寫的不一樣：

- 姓名與課程之間改用**半形** `·` 而不是全形 `・`。手機上一格放得下四個多字，
  全形的間隔號等於整整少看到一個字；而且被切掉時懸在邊緣的那一顆全形符號
  比半形的顯眼得多，看起來反而像壞掉。
- `.monthbar` 上那段警告「不要改成 flex」的註解**改寫掉了**，不是刪掉 ——
  留著一段講反話的註解，下一個人會照它把 flex 改回 block。
