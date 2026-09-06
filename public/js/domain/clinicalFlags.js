// 警示要畫成什麼樣。純函式。
//
// 警示是永久限制的第一層（ADR-0074）：**什麼都不擋，但壓表那一刻要一眼看得到**。
// 兩層合併之後，一位客戶身上可能同時有「體內金屬」「血管難打」「第一針」「怕痛」，
// 而系統分不出這四個哪一個對她比較重要 —— 那是她的判斷（ADR-0002）。
//
// 所以樣式跟著**那一個警示**走，記在主檔上。同一個作法行事備註做過一次
// （ADR-0040：自己挑顏色）。她的原話（2026-09-06）：
//
// > 血管難打，體內有金屬，可以最明顯……其餘的提醒希望也可以選樣式，
// > 例如實心，什麼顏色，或是空心甚麼顏色等等
//
// ## 顏色借行事備註那六色
//
// **名單**跟客戶備註共用（`MARK_COLORS`），**值**用 `--evcolor-*` ——
// 跟行事備註同一個理由（ADR-0040）：`--mark-*` 是給小圓點用的，
// 當 11px 的字擺在色塊上對比度不夠，而一顆警示丸子正好就是那個尺寸。
//
// 不開新的色相（ADR-0039 已經記著色相不夠用），深淺兩份也都已經調好了（ADR-0055）。
//
// ## 實心怎麼在深色模式下也讀得出來
//
// `--evcolor-X` 與 `--evcolor-X-bg` 這一對本來就是互為對比的（淺色模式一深一淺、
// 深色模式反過來），所以實心那一種**把兩個對調**就好：底色用前者、字用後者。
// 不必為了「色塊上的字」另外開一組 on-color 的 token。

import { MARK_COLORS } from './customerMarks.js';

/** 六色。跟客戶備註的小圓點是同一組（`domain/customerMarks.js`）。 */
export const ALERT_COLORS = MARK_COLORS;

/** 實心或外框。兩種就夠了 —— 第三種畫法沒有東西可以對應。 */
export const ALERT_FILLS = [
  { id: 'solid', label: '實心' },
  { id: 'outline', label: '空心' },
];

/**
 * 沒設定過就是**茶色空心**，也就是 2026-09-06 之前臨床提醒的樣子。
 * 所以正式資料庫裡那兩筆一個字都不用改，畫出來跟以前一模一樣。
 */
export const DEFAULT_ALERT_COLOR = 'tea';
export const DEFAULT_ALERT_FILL = 'outline';

/** 色票 id → 那一對 CSS 變數名。認不得的一律回預設那一對。 */
export function colorTokens(id) {
  const ok = ALERT_COLORS.some((c) => c.id === id);
  const key = ok ? id : DEFAULT_ALERT_COLOR;
  return { fg: `--evcolor-${key}`, bg: `--evcolor-${key}-bg` };
}

const knownColor = (id) => ALERT_COLORS.some((c) => c.id === id);
const knownFill = (id) => ALERT_FILLS.some((f) => f.id === id);

/**
 * 一筆警示主檔的樣式。認不得的一律回預設 ——
 * **不要讓畫面上出現一顆沒有顏色的丸子**（同 `colorToken()` 的判斷）。
 *
 * @param {{color?: string, fill?: string}|null} row
 * @returns {{color: string, fill: string, tokens: {fg: string, bg: string}}}
 */
export function lookOf(row) {
  const color = knownColor(row?.color) ? row.color : DEFAULT_ALERT_COLOR;
  const fill = knownFill(row?.fill) ? row.fill : DEFAULT_ALERT_FILL;
  return { color, fill, tokens: colorTokens(color) };
}

/**
 * 「這個字要畫成什麼樣」的查表。
 *
 * 客戶身上存的是**字串不是 id**（同永久限制的慣例），所以查的是名字。
 * **主檔上沒有那個字時回預設** —— 那是資料健檢要列出來的一種
 * （器材上有、警示主檔沒有），不是崩潰。
 *
 * @param {{name?: string, deletedAt?: any, active?: boolean}[]} rows config/clinicalFlags
 * @returns {(name: string) => {color: string, fill: string, tokens: object}}
 */
export function lookup(rows = []) {
  const byName = new Map();
  for (const r of rows ?? []) {
    if (!r || r.deletedAt || r.active === false) continue;
    const name = String(r.name ?? '').trim();
    if (name && !byName.has(name)) byName.set(name, lookOf(r));
  }
  return (name) => byName.get(String(name ?? '').trim()) ?? lookOf(null);
}

/**
 * 一顆丸子的行內樣式。**顏色不做成十二個 class** ——
 * 六色 × 兩種填法會長出十二條 CSS，而值全部都在 `tokens.css` 裡了。
 *
 * 回的是 `style` 屬性的內容；實心與空心的差別由 `app.css` 的
 * `.flag--solid` / `.flag--outline` 決定（那兩條各兩行）。
 */
export function styleFor(look) {
  const { fg, bg } = look?.tokens ?? colorTokens(DEFAULT_ALERT_COLOR);
  return `--flag-fg: var(${fg}); --flag-bg: var(${bg})`;
}
