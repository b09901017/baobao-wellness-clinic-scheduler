# 抽屜收合前會先往上跳一下

Status: todo
來源：使用者，2026-09-08（需求 9）
動工前先讀：`ui/components/sheet.js` 的 `wireDrag()`、`docs/adr/0021`

## 她要的

> 關閉或收合抽屜時，常會出現「先往上微跳/閃爍一下，才往下滑動收合」的視覺瑕疵。

## 根因（找到了，一支函式）

`sheet.js` 的 `dismiss()`：

```js
function dismiss() {
  if (dismissing) return;
  dismissing = true;
  goTall();                                  // ①
  backdrop?.classList.add('drawer-backdrop--out');
  settleAt(fullH + 40, () => onDismissed?.());  // ②
}
```

① 的 `goTall()` 做兩件事：加上 `.drawer--tall`（面板變滿高，**上緣往上跑 `peekY`**），
然後 `setY(peekY + y)` 把它推回原位補償。看起來應該沒有變化。

但 `goTall()` 裡面有**兩次 `getBoundingClientRect()`** —— 那會強制瀏覽器
算一次樣式，而那一刻 `.drawer--tall` 已經加上去了、`--sheet-y` 還是舊值。
**過場的起點就被定在那裡**：比她看到的位置高 `peekY`。

接著 ② 在**同一輪**就 `anim(true)` + `setY(fullH + 40)`，所以補償那一次
`setY()` 從來沒有被畫出來過。結果就是：先往上跳 `peekY`，再往下滑。

### 對照組：`expand()` 沒有這個問題

```js
function expand() {
  goTall();
  detent = 'full';
  requestAnimationFrame(() => settleAt(0));   // ← 多包了一層 rAF
}
```

多的那一層 `requestAnimationFrame()` 讓補償先畫出去一幀，起點才是對的。

## 修法

`dismiss()` 照 `expand()` 的形狀改：`goTall()` 之後讓補償先落地，
下一幀才開始過場。

**灰底那一句 `--out` 要跟過場同一幀**，不要提早 —— 提早的話背景會在面板
還沒開始動之前就淡掉。

**`dismissing` 那道旗標留著**（連按兩次叉叉）。

## 好消息：一支改完，三個地方一起好

`wireDrag()` 是**三個東西共用**的，三個都走同一支 `dismiss()`：

| 誰 | 哪裡 |
|---|---|
| 抽屜 | `sheet.js:75` |
| 快捷選單（長按那一張） | `actions.js:224` |
| 待辦中心的收尾抽屜 | `home.js:2023` |

所以「全域檢查所有 Bottom Sheet」這件事，**改 `dismiss()` 一支就完成了**。

其餘三條收合的路各自確認過，都沒有這個形狀的問題：

| 位置 | 現況 |
|---|---|
| 換一張面板時的 `closeSheet({ instant: true })` | 直接 `remove()`，沒有過場 |
| `onHash`（換頁） | 也是 instant |
| `toPeek()` / `toFull()` | 手勢已經接手過，`goTall()` 在 `onMove()` 裡跑過了 |

`openCard()`（讀取卡片）不走 `wireDrag()`，動工時拖一次確認就好。

## 測試

- E2E：`tests-e2e/specs/` 加一支，量抽屜在收合的**第一幀**位置不高於
  起始位置（`getBoundingClientRect().top` 不變小）
- 既有的 `10-offline.spec.js` 那幾支抽屜互動要維持綠的
