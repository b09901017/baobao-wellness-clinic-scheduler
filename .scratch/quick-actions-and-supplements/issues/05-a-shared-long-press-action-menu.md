# 一支共用的長按快捷選單

Status: todo
來源：使用者，2026-09-01（需求 B.5 的基礎）
動工前先讀：`public/js/ui/components/sheet.js`（`wireDrag()`）、
`public/js/ui/components/card.js`、`public/js/ui/nav.js`、
ADR-0020、0021、0048、0052、`app.css` 的 `.drawer` 區塊

## 原話

> 加入「長按（Long-press）」功能。點一下：維持現有邏輯（看詳情）。
> 長按：彈出快捷操作選單（Action Sheet），可以直接編輯、取消、或改變狀態。
> 這個選單希望是有 UIUX 精心設計過的，可以像是日曆抽屜點了加號出來的
> 或是一些設計過的動畫呈現等等，但必須要簡潔直觀

## 這一支解決什麼

「長按一列」現在全站都沒有。要接三個地方（日曆的三個檢視、隨手記的四個入口、
客戶詳情的營養品那一列），所以**先有一支元件**，不要三邊各寫一次 ——
`buy.js`、`note.js`、`ban.js` 三支檔頭寫的都是同一個教訓。

## 新檔案：`public/js/ui/components/actions.js`

兩個 export，一個管手勢、一個管畫面：

```js
/**
 * 把「長按這一列」接上去。事件用委派，所以那一塊重畫之後不必重掛。
 *
 * @param {HTMLElement} root 委派掛在這上面（要是重畫時會被換掉的那一層，
 *   或者本來就只有一個 —— 不然每重畫一次就多一組）
 * @param {string} selector 哪幾列算數，例：'[data-open]'
 * @param {(el: HTMLElement, ev: PointerEvent) => void} onHold 按住夠久之後做什麼
 * @param {{signal?: AbortSignal}} [opts]
 */
export function wireLongPress(root, selector, onHold, { signal } = {})

/**
 * 一張快捷選單。**它就是一張疊上去的抽屜**，不是第四種浮層 —— 同一組
 * `.drawer` 的樣式與同一支 `wireDrag()`（ADR-0060）。
 *
 * @param {object} o
 * @param {string} o.title      長按的是哪一筆
 * @param {string} [o.subtitle] 那一筆的第二行（日期・狀態）
 * @param {{id:string, label:string, note?:string, icon?:string,
 *          tone?:'default'|'danger'|'primary', disabled?:boolean}[]} o.items
 * @param {(id: string) => void} o.onPick 選了哪一顆。選完選單自己收起來
 * @returns {{close: Function, el: HTMLElement}}
 */
export function openActions({ title, subtitle, items, onPick })
```

### 為什麼不直接用 `openSheet()`

`openSheet()` 開頭第一行就是 `closeSheet({ instant: true })` —— **它是刻意的單例**
（「換一張面板時上一張直接拿掉，兩張同時在畫面上滑看起來像壞掉」）。
而長按最重要的一個場景正是「日曆那一天的抽屜開著，長按裡面某一列」——
走 `openSheet()` 會把那一天整個關掉，她看完那一筆就找不回原本那一天了（ADR-0020）。

所以 `openActions()` 自己管一個 root，但**畫面與手勢全部借既有的**：
`.drawer-backdrop` / `.drawer` 的 CSS、`wireDrag()` 的往下拖關掉、`pushLayer()`
的返回鍵、Escape、`hashchange` 收掉。程式碼大約 70 行，全部是既有零件的接線。

### 為什麼不用 `openCard()`

那一張是置中的，而長按是**拇指在螢幕下半部**做的動作 —— 選單要長在手指旁邊。
`openCard()` 的角色也不一樣（一筆的細節，先看再改），這一張是「直接做」。

## 手勢的細節（照抄不會踩到坑的那幾條）

用 **Pointer Events**，不用 touch + mouse 各接一次：
`pointerdown` / `pointermove` / `pointerup` / `pointercancel`。
理由是 `sheet.js` 那一支要 `preventDefault()` 掉瀏覽器的捲動（只有 touch 事件做得到），
這一支不需要 —— 它只要知道「手指有沒有移開、有沒有被別人接手」。

```js
const HOLD_MS = 450;   // 「刻意按住」的下限。低於 400 會誤觸，高於 500 感覺卡住
const SLOP = 8;        // 動超過這麼多就是在捲動，不是在長按
```

七件一定要做的事：

1. **移動超過 `SLOP` 就取消。** 她在抽屜裡捲動時手指一定會動。
2. **`pointercancel` 就取消。** 抽屜的 `wireDrag()` 接手手勢時
   （`touchmove` 被 `preventDefault()`）瀏覽器會送這個事件過來 ——
   這是「面板正在被拖」與「她正在長按」唯一分得開的訊號。
3. **長按成立之後要吃掉接下來那一次 `click`。**
   跟 `wireDrag()` 那一段同一個作法：capture 階段一顆一次性的
   `click` 監聽 `stopPropagation()` + `preventDefault()`。
   不吃掉的話，手一放就會**同時**跳出快捷選單與那一筆的讀取卡片。
4. **`contextmenu` 要擋掉**（在按著的那一列上）。Android Chrome 與桌機右鍵
   都會在同一個時間點跳系統選單，兩張選單疊在一起。
   順帶：桌機右鍵直接開這張選單（一行事，而且她偶爾用 iPad 接鍵盤）。
5. **CSS 要關掉選字與 iOS 的 callout**：長按一段文字在 iOS 上會跳
   「拷貝／查詢」的放大鏡。

```css
[data-longpress] {
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  user-select: none;
}
```

6. **只認主鍵、只認單指**（`ev.isPrimary`）。兩指縮放不該觸發。
7. **計時器一定要在 `pointerup` / `pointercancel` / 元件拆掉時清掉。**
   這個 repo 已經修過三次「監聽越掛越多」，用 `signal` 讓呼叫端拆得掉。

## 視覺與動畫（點到為止的那一種）

### 按下去的回饋 —— 讓她知道「再按一下下就有東西」

按住的那一刻在那一列加上 `.pressing`，放開或取消就拿掉：

```css
/* 長按的按壓回饋。**時間跟 JS 的 HOLD_MS 對齊**（450ms）——
   她看到的那一格填滿正好是選單跳出來的那一刻，所以這個等待是有回饋的，
   不是「怎麼還沒反應」。 */
[data-longpress] { transition: transform 0.12s ease; }
[data-longpress].pressing { transform: scale(0.985); }

/* 從左邊掃過去的一層極淡底色。用 ::after 疊上去，不動那一列本來的底色 ——
   來訪那幾列的底色是狀態色，蓋掉就看不出是哪一種狀態了。 */
[data-longpress]::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--kind-bg, var(--surface-2));
  opacity: 0;
  pointer-events: none;
}
[data-longpress].pressing::after {
  opacity: 0.9;
  transition: opacity 0.45s linear;   /* = HOLD_MS */
}
```

那一列要 `position: relative`（`.timerow` 與 `.noterow` 都要補）。

成立的那一下：`navigator.vibrate?.(12)`（Android 有，iOS 靜靜不做 —— 沒關係，
那一下畫面上本來就有選單跳出來）。

### 選單本身

長相跟日曆抽屜那顆「＋」展開的 `.addmenu__item` 是同一種（她指名的那一個）：
左邊一顆圓點裝圖示、右邊一行字。差別只在它是整片從底部升起來的。

```
┌──────────────────────────────┐
│         ▁▁▁▁                 │  ← 把手，往下拖關掉（同全站）
│  客戶A                        │
│  9/3(三)・已壓表，等客戶回覆    │  ← subtitle，講清楚長按到的是哪一筆
├──────────────────────────────┤
│  ◐  客戶說可以　→ 已確認       │
│  ✓  做完了　　　→ 已完成       │
│  ✕  未到                      │
│  ✎  改這一筆                  │
│  ⌫  取消這一筆        （紅）   │
├──────────────────────────────┤
│         先不要，回去           │
└──────────────────────────────┘
```

動畫三件，全部點到為止：

| 誰 | 怎麼動 | 多久 |
|---|---|---|
| 灰底 | opacity 0 → 1 | 140ms ease-out |
| 面板 | `translateY(100%) → 0` | 由 `wireDrag().playIn()` 負責，全站同一支 |
| 每一顆 | `translateY(6px)`+`opacity 0` → 0/1，**依序差 22ms** | 每顆 160ms |

依序那一段用 CSS 變數，不用 JS 排程：

```html
<button class="actionrow" style="--i: 2" ...>
```
```css
.actionrow { animation: actionrow-in 0.16s ease-out both; animation-delay: calc(var(--i) * 22ms); }
@keyframes actionrow-in { from { opacity: 0; transform: translateY(6px); } }
```

**最多六顆**（含「先不要」）。第七顆開始這張選單就不是快捷方式了，
她會停下來讀 —— 那時候該走的是編輯器。

`@media (prefers-reduced-motion: reduce)` 那一段（`app.css` 第 4576 行）
已經把全站的 `animation-duration` 與 `transition-duration` 壓成 0.01ms，
所以這裡不必另外處理。

### 深色模式

新的顏色一個都不開 —— 全部用既有的 `--surface`、`--surface-2`、`--border`、
`--text-dim`、`--danger`。所以 `tokens.css` **不用動**
（`tests/tokens.test.js` 盯著淺色深色兩份要對得上）。

## 連動

- **`public/sw.js`**：`SHELL` 清單補 `/js/ui/components/actions.js`，`VERSION` 加一。
  `tests/shell-cache.test.js` 盯著清單（不盯版號）。
- **補一支 ADR-0060**（`docs/adr/0060-a-row-answers-two-gestures.md`）：
  點一下是看、長按是做；快捷選單是一張疊上去的抽屜，不是第四種浮層。
- **`CONTEXT.md`** 補一個詞：**快捷選單**（_Avoid_：功能表、右鍵選單、action sheet、
  彈出視窗）。UI 文案要用同一個詞（`CLAUDE.md` 最後一列）。
- **`SPEC.md` 第 8.0 節**寫著「無拖拉」的原則 —— `sheet.js` 檔頭已經解釋過
  「手勢是快捷方式，不是唯一的路」。長按同理，**每一顆快捷選單上的動作，
  都要另外有一條點得到的路**（見 issue 06、07 的檢查表）。

## 不做

- 不做長按多選／整批操作。長按是一列一個快捷方式。
- 不做拖曳排序。
- 不在任何**只有長按才做得到**的地方放功能。

## 驗證

- 新測試 `tests/actions.test.js` **只測純函式那一半**（`domain` 以外的東西測不動）：
  把「一列有哪幾顆」的規則抽成純函式放在各自的 domain 檔裡（見 issue 06、07），
  這一支元件本身靠瀏覽器驗。
- 瀏覽器（手機模擬 + 真 iPad 各一次）：
  - 短按 → 照舊（讀取卡片／勾掉），**不跳選單**
  - 按住 450ms → 那一列輕微縮一下、底色掃過去 → 選單升起來 → **不會同時跳出讀取卡片**
  - 按住之後手指移開 10px → 什麼都不發生
  - 在抽屜裡按住然後往下拖 → 抽屜被拖動，選單不跳（`pointercancel`）
  - 在一排橫著滑的丸子上按住再橫滑 → 丸子照滑，選單不跳
  - iOS：長按文字**不會**跳「拷貝／查詢」
  - Android：長按**不會**跳系統選單
  - 選單開著按返回鍵 → 只收選單，底下那一天的抽屜還在
  - 選單開著按 Esc → 同上
  - 往下拖選單 → 收起來
  - 桌機右鍵那一列 → 直接開選單
- `npm test` 全綠，`tests/shell-cache.test.js` 認得新檔案
