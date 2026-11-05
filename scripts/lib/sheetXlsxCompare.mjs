// 她匯出的 .xlsx（`xlsx-dump.py` 攤開的那一份）跟替身畫出來的（`snapshotOf()`）逐頁逐格比。
// .scratch/sheet-push-gaps/issues/13：替身終究不是 Google —— 真的 Google 畫出來的樣子只有匯出檔看得到。
//
// 兩邊先各自收成同一種形狀（`realModel()`／`stubModel()`），再比（`compareBook()`）。
// **Google 的預設值與單位換算只寫在這裡**（`DEFAULTS`、`pxOfWidth()`、`pxOfHeight()`）：
// 用 11/5 staging 那一份匯出檔對過（190／62／58 像素的欄寬匯出成 23.88／7.88／7.38、26 像素的列高匯出成 19.5 點）。
//
// 比的：值、底色、字級、粗體、字色、字型、左右／上下對齊、換行、數字格式、備註、框線（每一條邊）、合併、欄寬、列高、凍結、格線、藏起來了沒。
// 不比的：鎖（匯出檔沒有）、分頁的先後、分頁的大小。
//
// 不一樣分兩種：`diffs`（要查的）與 `info`（已知、不算錯：產生時間、Google 自己把列長高、她自己開的分頁、備註前面多了作者）。

/** 沒設過的格子 Google 長這樣（匯出檔裡沒有那一格、或那一格寫的是預設值）。 */
export const DEFAULTS = {
  value: null,
  background: null,
  fontSize: 10,
  bold: false,
  fontColor: '000000',
  fontFamily: 'Arial',
  hAlign: 'general',
  vAlign: 'bottom',
  wrap: false,
  numberFormat: 'General',
  note: null,
  width: 100,
  height: 21,
};

/** 每一格要比的格式（不含值與備註，那兩種另外比）。 */
export const FORMAT_KINDS = ['background', 'fontSize', 'bold', 'fontColor', 'fontFamily', 'hAlign', 'vAlign', 'wrap', 'numberFormat'];

/** 框線的粗細：Apps Script 的 `BorderStyle` → xlsx 的 style。 */
const BORDER_STYLE = {
  SOLID: 'thin',
  SOLID_MEDIUM: 'medium',
  SOLID_THICK: 'thick',
  DOTTED: 'dotted',
  DASHED: 'dashed',
  DOUBLE: 'double',
};
const BORDER_WEIGHT = { hair: 0, dotted: 1, dashed: 1, thin: 2, double: 3, medium: 3, thick: 4 };

/** 匯出檔的欄寬（字元寬）→ 像素。Google 匯出的是 `像素 / 8 + 0.125`。 */
export function pxOfWidth(chars) {
  return Math.round((chars - 0.125) * 8);
}

/** 匯出檔的列高（點）→ 像素。 */
export function pxOfHeight(points) {
  return Math.round((points * 4) / 3);
}

function colLetter(col) {
  let n = col;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export const a1 = (row, col) => `${colLetter(col)}${row}`;

/** `B3` 或 `B3:D5` → `{ top, left, bottom, right }`。 */
export function boundsOf(ref) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(ref);
  if (!m) throw new Error(`看不懂的範圍：${ref}`);
  const top = Number(m[2]);
  const left = colNumber(m[1]);
  return { top, left, bottom: m[3] ? Number(m[4]) : top, right: m[3] ? colNumber(m[3]) : left };
}

/** `F6` → 凍結五列五欄；沒有 → 0。 */
export function frozenOf(freeze) {
  if (!freeze) return { rows: 0, cols: 0 };
  const { top, left } = boundsOf(freeze);
  return { rows: top - 1, cols: left - 1 };
}

const hex6 = (color) => {
  if (color == null || color === '') return null;
  const s = String(color).replace(/^#/, '').toUpperCase();
  return s.length === 8 ? s.slice(2) : s;
};

/** 白底等於沒有底色（兩邊都可能明寫白色）。 */
const bgOf = (color) => {
  const s = hex6(color);
  return s === 'FFFFFF' ? null : s;
};

const textOf = (s) => String(s).replace(/\r\n?/g, '\n');

function valueOf(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'object' && v.$date) return { date: v.$date };
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  return textOf(v);
}

const V_ALIGN = { middle: 'center', center: 'center', top: 'top', bottom: 'bottom' };

/** 兩邊共用：一張空的模型。 */
function emptyModel(name) {
  return {
    name,
    hidden: false,
    frozenRows: 0,
    frozenCols: 0,
    gridlinesHidden: false,
    merges: new Set(),
    cells: new Map(),
    edges: new Map(),
    widths: new Map(),
    heights: new Map(),
  };
}

function cellAt(model, ref) {
  if (!model.cells.has(ref)) model.cells.set(ref, {});
  return model.cells.get(ref);
}

/** 同一條邊兩邊都寫了：粗的那一條算數（Google 畫出來也是粗的那一條）。 */
function putEdge(edges, key, value) {
  const old = edges.get(key);
  if (!old) { edges.set(key, value); return; }
  const w = (v) => BORDER_WEIGHT[v.split(':')[0]] ?? 0;
  if (w(value) > w(old)) edges.set(key, value);
}

/**
 * 匯出檔的一頁 → 模型。
 * 框線：每一格的四邊換成「哪一條邊」（`h:列:欄` 是那一格上面那一條、`v:列:欄` 是左邊那一條）—— Google 匯出時相鄰兩格各寫一次。
 */
export function realModel(sheet) {
  const m = emptyModel(sheet.name);
  m.hidden = sheet.state != null && sheet.state !== 'visible';
  const frozen = frozenOf(sheet.freeze);
  m.frozenRows = frozen.rows;
  m.frozenCols = frozen.cols;
  m.gridlinesHidden = sheet.gridlines === false;
  for (const ref of sheet.merges || []) m.merges.add(ref);
  m.defaultWidth = sheet.defaultColWidth ? pxOfWidth(sheet.defaultColWidth) : DEFAULTS.width;
  m.defaultHeight = sheet.defaultRowHeight ? pxOfHeight(sheet.defaultRowHeight) : DEFAULTS.height;
  for (const [min, max, chars] of sheet.widths || []) {
    for (let c = min; c <= max; c += 1) m.widths.set(c, pxOfWidth(chars));
  }
  for (const [row, pt] of sheet.heights || []) m.heights.set(row, pxOfHeight(pt));
  for (const [ref, c] of sheet.cells || []) {
    const out = {};
    const v = valueOf(c.v);
    if (v !== null) out.value = v;
    if (c.fill) out.background = bgOf(c.fill);
    if (c.font) {
      if (c.font.name) out.fontFamily = c.font.name;
      if (c.font.sz != null) out.fontSize = Number(c.font.sz);
      if (c.font.b) out.bold = true;
      if (c.font.color) out.fontColor = hex6(c.font.color);
    }
    if (c.h) out.hAlign = c.h;
    if (c.vt) out.vAlign = V_ALIGN[c.vt] ?? c.vt;
    if (c.wrap) out.wrap = true;
    if (c.fmt) out.numberFormat = c.fmt;
    if (c.note != null && c.note !== '') out.note = textOf(c.note);
    if (Object.keys(out).length) m.cells.set(ref, out);
    if (c.border) {
      const { top: row, left: col } = boundsOf(ref);
      const val = (s) => `${s[0]}:${hex6(s[1]) ?? '000000'}`;
      if (c.border.t) putEdge(m.edges, `h:${row}:${col}`, val(c.border.t));
      if (c.border.b) putEdge(m.edges, `h:${row + 1}:${col}`, val(c.border.b));
      if (c.border.l) putEdge(m.edges, `v:${row}:${col}`, val(c.border.l));
      if (c.border.r) putEdge(m.edges, `v:${row}:${col + 1}`, val(c.border.r));
    }
  }
  return m;
}

/**
 * 替身畫的一頁（`snapshotOf()` 的一項）→ 模型。
 * 框線照呼叫的先後套（後畫的蓋掉先畫的）：`setBorder(上, 左, 下, 右, 內直, 內橫, 顏色, 樣式)`，true 畫、false 拿掉、null 不動。
 */
export function stubModel(snap) {
  const m = emptyModel(snap.name);
  m.hidden = Boolean(snap.hidden);
  m.frozenRows = snap.frozenRows || 0;
  m.frozenCols = snap.frozenCols || 0;
  m.gridlinesHidden = Boolean(snap.gridlinesHidden);
  for (const ref of snap.merges || []) m.merges.add(ref);
  m.defaultWidth = DEFAULTS.width;
  m.defaultHeight = DEFAULTS.height;
  for (const [col, px] of snap.widths || []) m.widths.set(col, px);
  for (const [row, px] of snap.rowHeights || []) m.heights.set(row, px);
  for (const [ref, v] of snap.values || []) {
    const val = valueOf(v);
    if (val !== null) cellAt(m, ref).value = val;
  }
  for (const [ref, text] of snap.notes || []) {
    if (text != null && text !== '') cellAt(m, ref).note = textOf(text);
  }
  for (const [ref, color] of snap.backgrounds || []) cellAt(m, ref).background = bgOf(color);
  const f = snap.formats || {};
  for (const [ref, v] of f.fontSize || []) cellAt(m, ref).fontSize = Number(v);
  for (const [ref, v] of f.fontWeight || []) cellAt(m, ref).bold = v === 'bold';
  for (const [ref, v] of f.fontColor || []) cellAt(m, ref).fontColor = hex6(v) ?? DEFAULTS.fontColor;
  for (const [ref, v] of f.fontFamily || []) cellAt(m, ref).fontFamily = v;
  for (const [ref, v] of f.hAlign || []) cellAt(m, ref).hAlign = v;
  for (const [ref, v] of f.vAlign || []) cellAt(m, ref).vAlign = V_ALIGN[v] ?? v;
  for (const [ref, v] of f.wrap || []) cellAt(m, ref).wrap = v === true;
  for (const [ref, v] of f.numberFormat || []) cellAt(m, ref).numberFormat = v;
  for (const call of snap.borders || []) applyBorder(m.edges, call);
  return m;
}

function applyBorder(edges, { range, args }) {
  const { top, left, bottom, right } = boundsOf(range.includes(':') ? range : `${range}:${range}`);
  const [t, l, b, r, vert, horiz, color, style] = args;
  const value = `${BORDER_STYLE[style] ?? 'thin'}:${hex6(color) ?? '000000'}`;
  const set = (key, on) => {
    if (on === true) edges.set(key, value);
    else if (on === false) edges.delete(key);
  };
  for (let c = left; c <= right; c += 1) {
    set(`h:${top}:${c}`, t);
    set(`h:${bottom + 1}:${c}`, b);
    for (let row = top + 1; row <= bottom; row += 1) set(`h:${row}:${c}`, horiz);
  }
  for (let row = top; row <= bottom; row += 1) {
    set(`v:${row}:${left}`, l);
    set(`v:${row}:${right + 1}`, r);
    for (let c = left + 1; c <= right; c += 1) set(`v:${row}:${c}`, vert);
  }
}

/** 合併區裡左上角以外的格子：Google 那一格的長相看左上角，格式不比。 */
function coveredCells(merges) {
  const out = new Set();
  for (const ref of merges) {
    const { top, left, bottom, right } = boundsOf(ref);
    for (let r = top; r <= bottom; r += 1) {
      for (let c = left; c <= right; c += 1) if (r !== top || c !== left) out.add(a1(r, c));
    }
  }
  return out;
}

const same = (x, y) => {
  if (typeof x === 'number' && typeof y === 'number') return Math.abs(x - y) < 1e-9;
  return JSON.stringify(x) === JSON.stringify(y);
};

/** 值不一樣：Google 把字認成日期／數字的另外標（`value.date`、`value.number`）。 */
function valueKind(real, stub) {
  if (real && typeof real === 'object' && real.date) return 'value.date';
  if (typeof real === 'number' && typeof stub === 'string') return 'value.number';
  return 'value';
}

/** 這一格是產生時間那一格（每一次推送都換、沒變的那幾頁只改它）：不一樣算已知。 */
const isStamp = (v) => typeof v === 'string' && v.startsWith('產生時間 ');

/**
 * 比一頁。`skip`：不比的格子（A1 的集合，例如 `_data` 的 B1 計時）。
 * @returns {{ diffs: Record<string, number>, info: Record<string, number>, details: object[] }}
 */
export function compareSheet(real, stub, { skip = new Set() } = {}) {
  const diffs = {};
  const info = {};
  const details = [];
  const add = (bucket, kind, where, r, s) => {
    bucket[kind] = (bucket[kind] ?? 0) + 1;
    details.push({ kind, where, real: r, stub: s, known: bucket === info });
  };

  if (real.hidden !== stub.hidden) add(diffs, 'sheet.hidden', 'sheet', real.hidden, stub.hidden);
  if (real.frozenRows !== stub.frozenRows) add(diffs, 'sheet.frozenRows', 'sheet', real.frozenRows, stub.frozenRows);
  if (real.frozenCols !== stub.frozenCols) add(diffs, 'sheet.frozenCols', 'sheet', real.frozenCols, stub.frozenCols);
  if (real.gridlinesHidden !== stub.gridlinesHidden) add(diffs, 'sheet.gridlines', 'sheet', real.gridlinesHidden, stub.gridlinesHidden);

  for (const ref of new Set([...real.merges, ...stub.merges])) {
    if (!real.merges.has(ref) || !stub.merges.has(ref)) add(diffs, 'merge', ref, real.merges.has(ref), stub.merges.has(ref));
  }

  const covered = coveredCells(stub.merges);
  for (const ref of new Set([...real.cells.keys(), ...stub.cells.keys()])) {
    if (skip.has(ref)) continue;
    const r = real.cells.get(ref) ?? {};
    const s = stub.cells.get(ref) ?? {};
    const rv = r.value ?? null;
    const sv = s.value ?? null;
    if (covered.has(ref)) {
      // 寫在合併區裡（不是左上角）的值：Google 合併時丟掉，替身留著
      if (sv !== null && !same(rv, sv)) add(diffs, 'value.inMerge', ref, rv, sv);
      continue;
    }
    if (!same(rv, sv)) {
      if (isStamp(sv) || isStamp(rv)) add(info, 'stamp', ref, rv, sv);
      else add(diffs, valueKind(rv, sv), ref, rv, sv);
    }
    const rn = r.note ?? null;
    const sn = s.note ?? null;
    if (!same(rn, sn)) {
      // Google 匯出備註時可能在前面接作者：後面一字不差就算已知
      if (rn && sn && rn.endsWith(sn)) add(info, 'note.prefixed', ref, rn, sn);
      else add(diffs, 'note', ref, rn, sn);
    }
    for (const kind of FORMAT_KINDS) {
      const rf = r[kind] ?? DEFAULTS[kind];
      const sf = s[kind] ?? DEFAULTS[kind];
      if (!same(rf, sf)) add(diffs, kind, ref, rf, sf);
    }
  }

  for (const key of new Set([...real.edges.keys(), ...stub.edges.keys()])) {
    const re = real.edges.get(key) ?? null;
    const se = stub.edges.get(key) ?? null;
    if (re !== se) add(diffs, 'border', key, re, se);
  }

  for (const col of new Set([...real.widths.keys(), ...stub.widths.keys()])) {
    const rw = real.widths.get(col) ?? real.defaultWidth;
    const sw = stub.widths.get(col) ?? stub.defaultWidth;
    if (Math.abs(rw - sw) > 1) add(diffs, 'width', colLetter(col), rw, sw);
  }

  for (const row of new Set([...real.heights.keys(), ...stub.heights.keys()])) {
    const rh = real.heights.get(row) ?? real.defaultHeight;
    const sh = stub.heights.get(row) ?? stub.defaultHeight;
    // 比設下去的高：Google 會替沒合併、折行的格子自己長高（`setRowHeights()` 不是強制的）—— 高了算已知，矮了才要查
    if (rh > sh + 1) add(info, 'rowHeight.grew', String(row), rh, sh);
    else if (rh < sh - 1) add(diffs, 'rowHeight', String(row), rh, sh);
  }

  return { diffs, info, details };
}

/** `_data` 那一頁 A2 起接回整包（`stashRawData()` 切 45000 字一格）。沒有那一頁 → null。 */
export function bundleFromDump(dump) {
  const data = dump.sheets.find((s) => s.name === '_data');
  if (!data) return null;
  const parts = data.cells
    .map(([ref, c]) => ({ ...boundsOf(ref), v: c.v }))
    .filter((x) => x.left === 1 && x.top >= 2 && typeof x.v === 'string')
    .sort((a, b) => a.top - b.top);
  if (!parts.length) return null;
  return JSON.parse(parts.map((p) => p.v).join(''));
}

/**
 * 整份比。`dump` 是 `xlsx-dump.py` 的輸出、`snapshot` 是 `snapshotOf()`。
 * 照名字配：替身有、匯出檔沒有 → `missingSheet`（要查）；匯出檔有、替身沒有（她自己開的、預設的「工作表1」）→ 已知。
 * `_data` 的 B1（計時：替身的時鐘固定在 0）不比。
 */
export function compareBook(dump, snapshot) {
  const real = new Map(dump.sheets.map((s, i) => [s.name, { sheet: s, index: i + 1 }]));
  const totals = { diffs: {}, info: {} };
  const sheets = [];
  const bump = (bucket, kind, n = 1) => { bucket[kind] = (bucket[kind] ?? 0) + n; };
  let cells = 0;
  for (const snap of snapshot) {
    const hit = real.get(snap.name);
    if (!hit) {
      bump(totals.diffs, 'missingSheet');
      sheets.push({ name: snap.name, index: null, diffs: { missingSheet: 1 }, info: {}, details: [] });
      continue;
    }
    const skip = snap.name === '_data' ? new Set(['B1']) : new Set();
    const r = realModel(hit.sheet);
    const s = stubModel(snap);
    cells += new Set([...r.cells.keys(), ...s.cells.keys()]).size;
    const out = compareSheet(r, s, { skip });
    for (const [k, n] of Object.entries(out.diffs)) bump(totals.diffs, k, n);
    for (const [k, n] of Object.entries(out.info)) bump(totals.info, k, n);
    sheets.push({ name: snap.name, index: hit.index, ...out });
  }
  const ours = new Set(snapshot.map((s) => s.name));
  const extra = dump.sheets.filter((s) => !ours.has(s.name)).length;
  if (extra) bump(totals.info, 'extraSheet', extra);
  return { compared: snapshot.length, cells, totals, sheets };
}
