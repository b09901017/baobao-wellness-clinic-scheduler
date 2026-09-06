# 警示可以挑樣式：六色 × 實心／空心

Status: 已完成
Blocked by: 01

## 她說的

> 其餘的提醒希望也可以選樣式，例如實心，什麼顏色，或是空心甚麼顏色等等
> (像是目前，只能indiba這個標記丸子就蠻好看的)

> 血管難打，體內有金屬，可以最明顯

## 為什麼不是「系統決定誰最大聲」

`01` 之後兩層合併，一排丸子裡可能同時有「體內金屬」「血管難打」「第一針」
「怕痛」。系統分不出這四個哪一個對她比較重要 —— 那是她的判斷（ADR-0002）。
所以樣式跟著**那一個警示**走，記在主檔上，不是從別的地方推出來的。

這跟行事備註自己挑顏色是同一個作法（ADR-0040）。

## 要做什麼

### 一、`config/app/clinicalFlags` 加兩個欄位

```js
{
  name,      // '體內金屬'。<= 12 字（不變）
  hint,      // 一句說明，選填（不變）
  color,     // 'grey'|'green'|'tea'|'red'|'blue'|'violet'，預設 'tea'
  fill,      // 'solid' | 'outline'，預設 'outline'
  active, deletedAt
}
```

**顏色借備註那六色**（`domain/customerMarks.js` 的 `MARK_COLORS`），不開新的色相
—— `tokens.css` 的 `--mark-*` 深淺兩份都已經調好了（ADR-0055），而 ADR-0039
已經記著色相不夠用。

**預設是茶色空心**，也就是今天臨床提醒的樣子。沒有這兩個欄位的舊資料就照預設畫，
所以正式資料庫裡那兩筆一個字都不用改。

### 二、種子

```js
clinicalFlags: [
  { id: 'cf-metal',  name: '體內金屬', color: 'red',  fill: 'solid',
    hint: '超磁場與高能量雷射要提醒；建議改用 INDIBA' },
  { id: 'cf-veins',  name: '血管難打', color: 'tea',  fill: 'solid',  hint: … },
  { id: 'cf-first',  name: '第一針',   color: 'blue', fill: 'outline', hint: … },
],
```

`cf-metal` 是這一輪新增的：`01` 之後「體內金屬」不再自成一層，它得在這份名單裡
才畫得出來、才點得到。**既有資料庫裡沒有這一筆**，補進去交給 `09`。

### 三、`ui/components/flags.js`

`alertChips()` 與 `detailChips()` 兩支都要吃得到樣式。**兩支共用同一個算色的
地方**，不要各寫一次 —— 這一支的檔頭已經記著「四個地方各寫一次」付過的帳。

```js
// domain/clinicalFlags.js（新，純函式）
export const ALERT_FILLS = ['solid', 'outline'];
export const DEFAULT_ALERT_COLOR = 'tea';
export const DEFAULT_ALERT_FILL = 'outline';

/** 一個警示要畫成什麼樣。認不得的顏色一律回預設 —— 不要讓畫面上出現沒有顏色的丸子。 */
export function alertLook(name, rows) { … }  // → { color, fill }
```

CSS：`.flag--alert` 這一個 class 留著當底，顏色與填法用 `data-` 屬性或
`--flag-color` 這個自訂屬性帶進去，**不要長出十二個 class**。

### 四、設定 → 警示那一頁

`ui/views/masterList.js` 的 `clinicalFlags` 那一段多兩排丸子：顏色（六顆）
與填法（兩顆）。旁邊即時畫出那一顆丸子長什麼樣 —— 挑顏色不給看預覽，
等於要她存下去再回頭看。

## 不做的

- **不加「要不要閃一下」。** 一頁廿幾張卡都在動的話反而看不到重點。
- **不讓她自己打十六進位色碼。** 六色是給定的（同備註、同行事備註），
  自由色會在深色模式下變成看不見的字。

## 測試

- `tests/tokens.test.js` 已經在盯「深淺兩份都要有」，六色本來就有，不必補。
- 新的 `tests/clinical-flags.test.js`：`alertLook()` 對認不得的顏色／填法回預設；
  主檔上沒有的名字回預設（那是 `09` 要列出來的那一種，不是崩潰）。
- `tests/master-data.test.js`：`validate('clinicalFlags')` 擋掉不合法的 color/fill。
