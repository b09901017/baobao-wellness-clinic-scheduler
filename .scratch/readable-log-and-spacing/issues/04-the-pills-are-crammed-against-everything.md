# 丸子貼著輸入框、貼著底下的任務、彼此也貼在一起

Status: todo
來源：使用者，2026-09-01（需求 C）
動工前先讀：`public/js/ui/components/note.js` 的 `field()`／`who()`／`give()`、
`public/css/app.css` 的 `.notemeta` 那一段、
`public/js/ui/views/customerDetail.js` 的 `notesBlock()`、
`public/js/ui/views/calendar.js` 的 `mountNoteEditor()`、
`CLAUDE.md` 的「隨手記的欄位或那一列的樣子」那一列

## 原話

> 1. 客戶詳情：隨手記底下的「今天/挑日期」丸子，跟輸入框以及下方的任務貼得
>    太近了，請增加留白空間。
> 2. 日曆新增 Todo：「營養品」和「掛給誰」的丸子貼得太近，會擠在一起。
> 3. 全站盤點：請順手幫我檢查其他使用類似排版的區塊，統一調整舒適的留白。

## 根因：四個入口只有兩個包了 `.notemeta`

`CLAUDE.md` 寫著那四個入口共用 `ui/components/note.js`，
「長得不一樣會讓她以為是兩種東西」。**元件本身確實共用了，
但包住它們的那一層沒有**：

| 入口 | 現在怎麼包 |
|---|---|
| 待辦首頁那張卡 | `<div class="notemeta">`（gap 6px） |
| 右下角泡泡 | `<div class="notemeta">`（gap 6px） |
| 客戶詳情 | **裸放**在 `<form style="margin-top: var(--space-2)">` 裡，`note.field()` 直接接在輸入框底下 |
| 日曆的待辦編輯器 | **裸放**，`哪一天`／`掛給誰`／`給營養品` 三塊之間一點間距都沒有 |

而 `.notemeta` 自己的 `gap: 6px` 本來就偏緊 —— 那是**一排丸子內部**該有的
間距（`.notedate` / `.notewho` / `.notegive` 內部也是 6px），
不是**兩排之間**該有的。所以就算包了也還是擠。

底下那一塊「跟下方的任務貼太近」則是另一半：客戶詳情的隨手記表單底下
直接就是 `<div data-taskblock>`，而 `.section` 的 `margin-top` 是
`var(--space-5)`，在**一個剛剛結束的表單**後面不夠 —— 表單的最後一個元素
是一排 28px 高的小丸子，視覺重量很輕，需要更多空白才分得開。

## 要做什麼

### 1. `.notemeta` 變成真的「一疊欄位」

```css
/* 日期、掛給誰、給營養品那幾排。四個入口共用（首頁那一格、右下角泡泡、
   客戶詳情、日曆的待辦編輯器）—— 長得不一樣會讓她以為是兩種東西。

   **gap 是「排與排之間」，不是「丸子與丸子之間」**：一排丸子內部
   是 var(--space-2)，兩排之間要更大，否則三排丸子看起來像一團。 */
.notemeta {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);          /* 6px → 12px */
  margin-top: var(--space-3);   /* 跟上面的輸入框分開 */
}
```

`.notedate` / `.notewho` / `.notegive` 內部的 `gap: 6px` → `var(--space-2)`（8px），
`row-gap` 也給 `var(--space-2)`（換行的時候現在會黏在一起）。

### 2. 客戶詳情：包進 `.notemeta`，並跟底下的任務分開

- `notesBlock()` 的表單 `margin-top: var(--space-2)` → `var(--space-4)`。
- `note.field()` 包進 `<div class="notemeta">`。
- 表單底下補一塊間距，讓它跟 `<div data-taskblock>` 的 `.section` 分得開：
  在 `data-taskblock` 上給 `margin-top: var(--space-5)`（加上 `.section`
  自己的 margin 就夠了），**不要改 `.section` 本身** —— 那條規則全站在用。

### 3. 日曆的待辦編輯器：三排各自成一個欄位

現在是 `field__label` ＋ 一塊、`field__label` ＋ 一塊、再接一塊，
中間什麼都沒有。改成跟其他表單一樣的節奏：

```html
<label class="field">…記什麼…</label>

<div class="field">
  <span class="field__label">哪一天</span>
  <div class="notemeta">{note.field()}</div>
</div>

<div class="field" data-calwho>
  <span class="field__label">掛給誰</span>
  <div class="notemeta">{note.who()}</div>
</div>

<div class="field">{note.give()}</div>
```

`.field` 已經有 `margin-bottom: var(--space-3)`，所以三排自然分開，
而且跟這張表單上面那個「記什麼」用同一個節奏 —— 這是「同一種東西長一樣」
的另一半。

**`[data-calwho][hidden]` 那條 `display: none !important` 要留著**
（`app.css` 的註解寫過原因：任何 `display` 宣告都會讓 `[hidden]` 失效）。
換成 `<div class="field">` 之後那條規則照樣命中，但要驗一次：
選了一包營養品的時候「掛給誰」那一整塊要整個消失，不可以留一段空白。

### 4. 全站盤點（同一種排版的其他地方）

只改**間距**，不動任何顏色、字級、圓角：

| 地方 | 現在 | 改成 |
|---|---|---|
| `.notewho__list`（點開的客戶名單） | `margin-top: var(--space-1)` | `var(--space-2)` |
| `.chips`（全站的丸子群：壓表、可用性、進度、行事備註、客戶總覽） | `gap: var(--space-2)` / `row-gap: 10px` | `row-gap: var(--space-3)`，換行時才看得出是兩排 |
| `.notetags`（一列隨手記右邊的小丸） | `gap: 4px` | `var(--space-1)`（一樣是 4px，只是換成 token） |
| 客戶詳情 `taskBlock()` 的 `.seg` | `margin-bottom: var(--space-2)` | `var(--space-3)` |
| 待辦中心那張隨手記卡的表單 | `margin-top: var(--space-3)` | 照舊（它已經有 `.notemeta` 了，會跟著上面第 1 條變寬） |

**不要為了「統一」去改沒有問題的地方。** 這一輪只碰上面這幾條，
每一條都對得上她講的三件事其中之一。

## 過場動畫（她另外點名的那一段）

> 加入滑順的 CSS 過場動畫（如：長按的按壓回饋、抽屜滑出/收起的過渡、
> 選單展開、狀態切換的顏色漸變等）……但必須點到為止，
> 絕不能過度設計導致眼花撩亂或拖慢操作節奏。

**大部分已經有了**（PR44 就做過）：長按的按壓回饋（`.16s`）、
快捷選單逐列進場（`actionrow-in`，22ms 階梯）、抽屜拖曳（`.3s` cubic-bezier）、
卡片 `deck-in`。而 `app.css` 底下已經有 `@media (prefers-reduced-motion: reduce)`
把全部壓成 0.01ms。

所以這一輪只補**還沒有的那三個**，每一個都是「顏色／狀態的漸變」，不是位移：

1. `.chip` 的 `aria-pressed` 切換：現在是瞬間跳色。
   ```css
   .chip { transition: background-color 0.16s ease, border-color 0.16s ease, color 0.16s ease; }
   ```
2. `.seg__item` 的切換（「照人／照流程」「未完成／已完成」）：同一組漸變。
3. `.notewho__list` / `[data-ng-list]` 點開時的淡入：沿用既有的 `deck-in`，
   **不要另外寫一支 keyframes**。

**不加**：捲動視差、彈跳、陰影呼吸、逐字動畫、任何超過 0.2s 的東西。
一顆丸子她一位客戶要點五六下（ADR-0038），動畫再長就是在擋她。

## 連動

- `public/sw.js` 的 `VERSION` 加一（`SHELL` 不動，沒有新檔案）。
- **`tokens.css` 不動** ⇒ `tests/tokens.test.js` 不受影響
  （這一輪一個顏色都不新增，所以不會踩到「淺色深色兩份都要有」那一條）。
- `CLAUDE.md` 的「隨手記的欄位或那一列的樣子」那一列要補一句：
  **包住它們的那一層（`.notemeta`）也是共用的一部分**（issue 06）。

## 不做

- 不改字級、顏色、圓角、陰影。
- 不改 `.section` 本身的 margin（全站在用）。
- 不動 `.chip` 的高度與 `::after` 的感應範圍（44px 那一條是可觸控的底線）。
- 不新增 keyframes。

## 驗證

`npm test` 全綠（`tests/tokens.test.js`、`tests/shell-cache.test.js` 尤其）。

瀏覽器（淺色與深色各看一次）：
- 客戶詳情 → 隨手記 → 輸入框、丸子、底下的「任務」抬頭三段分得開
- 日曆 → 某一天 → 新增待辦 → 「哪一天」「掛給誰」「給營養品」三排各自成塊
- 日曆 → 新增待辦 → 按「給營養品」選一包 → **「掛給誰」整塊消失，不留空白**
- 右下角泡泡 → 三排的間距跟上面兩個畫面一模一樣
- 點丸子 → 顏色是滑進去的，不是跳的；連點五下不會覺得卡
- 系統開「減少動態效果」→ 全部瞬間完成，沒有殘影
