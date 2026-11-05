// Apps Script 執行環境的替身。
//
// `sheets/readonly-report.gs` 跑在 Google 的伺服器上，node 裡沒有 SpreadsheetApp，
// 所以那 400 多行本來一行都測不到 —— 而它是整個專案裡唯一沒有測試的程式碼。
//
// 這份替身把它要用到的 API 都做出來，並且把「寫進哪一格什麼值、合併了哪些範圍、
// 鎖了哪幾張分頁」記下來讓測試去斷言。
//
// **2026-11-05 起每一格的格式也記**（字級、粗體、字色、字型、左右／上下對齊、換行、底色）、
// 欄寬、列高、框線的每一次呼叫：`.gs` 改成批次寫（.scratch/sheet-push-gaps 的 02、03），
// 要比得出「改前改後畫出來一模一樣」—— `snapshotOf()` 把整份試算表收成一份可以比的東西。
// 格式只記**最後一次設的值**（跟 Google 一樣：後設的蓋掉先設的），沒設過的格子不在裡面。
//
// **它抓得到的**：邏輯錯（值算錯、寫錯格子、該鎖的沒鎖）、打錯的 API 名稱、
// 參數個數不對、超出範圍的 getRange。
//
// **它抓不到的**：Google 那一側真正的行為差異（配額、權限、setBorder 的實際效果、
// 寫進合併區的細節、真的快不快、網頁應用程式的部署設定）。那些只有真的部署上去才知道。

import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';

const A1 = (row, col) => `${colLetter(col)}${row}`;

function colLetter(col) {
  let n = col - 1;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

function colNumber(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** `B3` 或 `B3:D5` → `{ row, col, rows, cols }`。`getRangeList()` 收的就是這種字串。 */
export function parseA1(a1) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  if (!m) throw new Error(`看不懂的 A1：${a1}`);
  const row = Number(m[2]);
  const col = colNumber(m[1]);
  const row2 = m[3] ? Number(m[4]) : row;
  const col2 = m[3] ? colNumber(m[3]) : col;
  if (row2 < row || col2 < col) throw new Error(`A1 範圍反了：${a1}`);
  return { row, col, rows: row2 - row + 1, cols: col2 - col + 1 };
}

/** 每一格會記的格式（Range 上那一支設定 → 記在哪一格）。 */
const FORMAT_SETTERS = {
  setFontSize: 'fontSize',
  setFontWeight: 'fontWeight',
  setFontColor: 'fontColor',
  setFontFamily: 'fontFamily',
  setHorizontalAlignment: 'hAlign',
  setVerticalAlignment: 'vAlign',
  setWrap: 'wrap',
};

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }

  /** 每一個排版動作都回自己，因為 .gs 裡到處都在串。 */
  #self() { return this; }

  #each(fn) {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) fn(this.row + r, this.col + c);
    }
  }

  setValue(value) {
    this.sheet.set(this.row, this.col, value);
    return this.#self();
  }

  setValues(grid) {
    if (grid.length !== this.rows) throw new Error(`setValues 列數不合：${grid.length} vs ${this.rows}`);
    grid.forEach((row, r) => {
      if (row.length !== this.cols) {
        throw new Error(`setValues 欄數不合：${row.length} vs ${this.cols}`);
      }
      row.forEach((v, c) => this.sheet.set(this.row + r, this.col + c, v));
    });
    return this.#self();
  }

  getValue() {
    return this.sheet.get(this.row, this.col);
  }

  merge() {
    this.sheet.addMerge(this.row, this.col, this.rows, this.cols);
    return this.#self();
  }

  /** 每一列各自合併（Google 的 mergeAcross）。 */
  mergeAcross() {
    for (let r = 0; r < this.rows; r += 1) this.sheet.addMerge(this.row + r, this.col, 1, this.cols);
    return this.#self();
  }

  breakApart() {
    this.sheet.merges.length = 0;
    this.sheet.mergeBounds.length = 0;
    return this.#self();
  }

  setBackground(color) {
    this.sheet.checkBounds(this.row + this.rows - 1, this.col + this.cols - 1);
    this.#each((r, c) => this.sheet.backgrounds.set(A1(r, c), color));
    return this.#self();
  }

  setBorder(...args) {
    this.sheet.borders += 1;
    this.sheet.borderCalls.push({ range: `${A1(this.row, this.col)}:${A1(this.row + this.rows - 1, this.col + this.cols - 1)}`, args });
    return this.#self();
  }
}

for (const [method, key] of Object.entries(FORMAT_SETTERS)) {
  FakeRange.prototype[method] = function setFormat(value) {
    this.sheet.checkBounds(this.row + this.rows - 1, this.col + this.cols - 1);
    if (key === 'fontFamily') this.sheet.fonts.add(value);
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) this.sheet.formats[key].set(A1(this.row + r, this.col + c), value);
    }
    return this;
  };
}

/** `sheet.getRangeList([...])`：同一個動作套在每一塊上（Google 的 RangeList，沒有合併）。 */
class FakeRangeList {
  constructor(sheet, ranges) {
    this.sheet = sheet;
    this.ranges = ranges;
  }

  getRanges() { return [...this.ranges]; }
}

for (const method of ['setBackground', 'setBorder', 'breakApart', ...Object.keys(FORMAT_SETTERS)]) {
  FakeRangeList.prototype[method] = function applyAll(...args) {
    for (const range of this.ranges) range[method](...args);
    return this;
  };
}

class FakeProtection {
  constructor(sheet) {
    this.sheet = sheet;
    this.editors = [{ getEmail: () => 'someone-else@example.com' }];
    this.warningOnly = false;
    this.domainEdit = true;
    this.removed = [];
  }

  setDescription(d) { this.description = d; return this; }
  getDescription() { return this.description ?? ''; }
  addEditor(user) { this.editors.push(user); return this; }
  getEditors() { return this.editors; }
  removeEditors(emails) {
    this.removed.push(...emails);
    this.editors = this.editors.filter((u) => !emails.includes(u.getEmail()));
    return this;
  }
  canDomainEdit() { return this.domainEdit; }
  setDomainEdit(v) { this.domainEdit = v; return this; }
  setWarningOnly(v) { this.warningOnly = v; return this; }
  remove() {
    const i = this.sheet.protections.indexOf(this);
    if (i !== -1) this.sheet.protections.splice(i, 1);
  }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.cells = new Map();
    /** 給測試斷言用的 A1 字串（例：`A1:M1`）。 */
    this.merges = [];
    /** 同一份合併，但留著數字邊界 —— 凍結線的檢查要算得出來。 */
    this.mergeBounds = [];
    this.backgrounds = new Map();
    /** 每一格最後一次設的格式（`FORMAT_SETTERS` 那幾種）。 */
    this.formats = Object.fromEntries(Object.values(FORMAT_SETTERS).map((k) => [k, new Map()]));
    this.fonts = new Set();
    this.borders = 0;
    this.borderCalls = [];
    this.protections = [];
    this.widths = new Map();
    this.rowHeights = new Map();
    this.frozenRows = 0;
    this.frozenCols = 0;
    this.maxRows = 1000;
    this.maxCols = 26;
    this.hidden = false;
    /** 清空重畫了幾次（格式 8：沒變的那幾頁不重畫，測試數它） */
    this.clears = 0;
  }

  checkBounds(row, col) {
    if (row > this.maxRows || col > this.maxCols) {
      throw new Error(`「${this.name}」寫到範圍外：${A1(row, col)}（上限 ${A1(this.maxRows, this.maxCols)}）`);
    }
  }

  set(row, col, value) {
    this.checkBounds(row, col);
    this.cells.set(A1(row, col), value);
  }

  get(row, col) { return this.cells.get(A1(row, col)) ?? ''; }
  at(a1) { return this.cells.get(a1) ?? ''; }

  getName() { return this.name; }
  getMaxRows() { return this.maxRows; }
  getMaxColumns() { return this.maxCols; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  insertColumnsAfter(_after, n) { this.maxCols += n; }

  getRange(row, col, rows = 1, cols = 1) {
    if (row < 1 || col < 1 || rows < 1 || cols < 1) {
      throw new Error(`「${this.name}」getRange 參數不合法：${row},${col},${rows},${cols}`);
    }
    return new FakeRange(this, row, col, rows, cols);
  }

  getRangeList(a1s) {
    if (!Array.isArray(a1s) || !a1s.length) throw new Error(`「${this.name}」getRangeList 要一個不是空的陣列`);
    return new FakeRangeList(this, a1s.map((a1) => {
      const { row, col, rows, cols } = parseA1(a1);
      return this.getRange(row, col, rows, cols);
    }));
  }

  /** **跟 Google 一樣只算有內容的格子**：寫進 `''` 或 null 的不算（2026-11-05 以前替身會算）。 */
  getLastRow() {
    let max = 0;
    for (const [key, v] of this.cells) {
      if (v === '' || v == null) continue;
      max = Math.max(max, Number(key.replace(/^[A-Z]+/, '')));
    }
    return max;
  }

  clear() {
    this.cells.clear();
    this.backgrounds.clear();
    for (const m of Object.values(this.formats)) m.clear();
    this.borderCalls.length = 0;
    this.clears += 1;
  }

  clearConditionalFormatRules() {}

  addMerge(row, col, rows, cols) {
    this.checkBounds(row + rows - 1, col + cols - 1);
    this.merges.push(`${A1(row, col)}:${A1(row + rows - 1, col + cols - 1)}`);
    this.mergeBounds.push({
      top: row, left: col, bottom: row + rows - 1, right: col + cols - 1,
    });
  }

  // 凍結線不能穿過合併儲存格。Google 是這樣擋的，替身原本兩件事都記得住
  // 但從來不檢查它們有沒有打架 —— 所以 setFrozenColumns(1) 加上一個橫跨
  // 整張表的表頭，測試全綠、真的部署一推就炸。
  // 見 .scratch/first-real-import/issues/01-frozen-column-splits-a-merged-cell.md

  setFrozenRows(n) {
    const split = this.mergeBounds.find((m) => n >= m.top && n < m.bottom);
    if (split) {
      throw new Error('很抱歉，你無法凍結僅包含部分合併儲存格的列。'
        + `請取消合併儲存格，或凍結更多列以納入全部的合併儲存格。（${this.name} 凍結 ${n} 列）`);
    }
    this.frozenRows = n;
  }

  setFrozenColumns(n) {
    const split = this.mergeBounds.find((m) => n >= m.left && n < m.right);
    if (split) {
      throw new Error('很抱歉，你無法凍結僅包含部分合併儲存格的欄。'
        + `請取消合併儲存格，或凍結更多欄以納入全部的合併儲存格。（${this.name} 凍結 ${n} 欄）`);
    }
    this.frozenCols = n;
  }

  setColumnWidth(col, w) { this.widths.set(col, w); }

  setColumnWidths(start, n, w) {
    if (n < 1) throw new Error(`「${this.name}」setColumnWidths 至少要一欄：${start},${n}`);
    for (let i = 0; i < n; i += 1) this.widths.set(start + i, w);
  }

  setRowHeights(start, n, h) {
    if (n < 1) throw new Error(`「${this.name}」setRowHeights 至少要一列：${start},${n}`);
    for (let i = 0; i < n; i += 1) this.rowHeights.set(start + i, h);
  }

  hideSheet() { this.hidden = true; }
  isSheetHidden() { return this.hidden; }

  protect() {
    const p = new FakeProtection(this);
    this.protections.push(p);
    return p;
  }

  getProtections() { return [...this.protections]; }
}

class FakeSpreadsheet {
  constructor(names = []) {
    this.sheets = names.map((n) => new FakeSheet(n));
    this.toasts = [];
  }

  getSheets() { return [...this.sheets]; }
  getSheetByName(name) { return this.sheets.find((s) => s.name === name) ?? null; }

  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }

  deleteSheet(sheet) {
    this.sheets = this.sheets.filter((s) => s !== sheet);
  }

  toast(message, title) { this.toasts.push({ message, title }); }
}

/** 一張 Map（A1 → 值）收成照位置排好的陣列，空的格子不收（Google 裡寫 '' 跟沒寫一樣）。 */
function sortedCells(map, { dropEmpty = false } = {}) {
  const pos = (a1) => {
    const { row, col } = parseA1(a1);
    return row * 100000 + col;
  };
  return [...map.entries()]
    .filter(([, v]) => !dropEmpty || (v !== '' && v != null))
    .sort((a, b) => pos(a[0]) - pos(b[0]));
}

/**
 * 整份試算表收成一份可以比的東西：每一張分頁的值、每一格的格式、合併、框線、欄寬、列高、凍結、鎖、藏起來了沒。
 * 合併照位置排（先合併哪一塊不影響長相）；框線照呼叫的先後（後畫的蓋掉先畫的）。
 */
export function snapshotOf(ss) {
  return ss.getSheets().map((s) => ({
    name: s.name,
    hidden: s.hidden,
    frozenRows: s.frozenRows,
    frozenCols: s.frozenCols,
    maxRows: s.maxRows,
    maxCols: s.maxCols,
    values: sortedCells(s.cells, { dropEmpty: true }),
    backgrounds: sortedCells(s.backgrounds),
    formats: Object.fromEntries(Object.entries(s.formats).map(([k, m]) => [k, sortedCells(m)])),
    merges: [...s.merges].sort(),
    borders: s.borderCalls,
    widths: [...s.widths.entries()].sort((a, b) => a[0] - b[0]),
    rowHeights: [...s.rowHeights.entries()].sort((a, b) => a[0] - b[0]),
    protections: s.protections.map((p) => ({
      description: p.description ?? null,
      removed: [...p.removed].sort(),
      domainEdit: p.domainEdit,
      warningOnly: p.warningOnly,
    })),
  }));
}

/**
 * 載入 .gs 並回傳它的全域函式，加上可以斷言的替身。
 *
 * @param {{token?: string, sheetNames?: string[], lock?: boolean, source?: string}} [options]
 *   `source`：拿另一份 `.gs` 的原始碼來跑（比改前改後用，`scripts/sheet-gs-compare.mjs`）
 */
export function loadAppsScript({
  token = 'secret', sheetNames = [], lock = true, source = null,
} = {}) {
  const ss = new FakeSpreadsheet(sheetNames);
  // 文件屬性（格式 8 記每一頁的指紋）。同一個替身裡推好幾次都留著 —— 跟真的試算表一樣
  const docProps = new Map();
  const code = source ?? readFileSync(new URL('../../sheets/readonly-report.gs', import.meta.url), 'utf8');

  const context = createContext({
    SpreadsheetApp: {
      getActiveSpreadsheet: () => ss,
      BorderStyle: { SOLID: 'SOLID' },
      ProtectionType: { SHEET: 'SHEET' },
    },
    ContentService: {
      createTextOutput: (text) => ({ text, setMimeType: (m) => ({ text, mimeType: m }) }),
      MimeType: { JSON: 'application/json' },
    },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: () => token }),
      getDocumentProperties: () => ({
        getProperty: (k) => (docProps.has(k) ? docProps.get(k) : null),
        setProperty: (k, v) => { docProps.set(k, String(v)); },
        setProperties: (map) => { for (const [k, v] of Object.entries(map)) docProps.set(k, String(v)); },
        deleteProperty: (k) => { docProps.delete(k); },
        getProperties: () => Object.fromEntries(docProps),
      }),
    },
    LockService: {
      getScriptLock: () => ({ tryLock: () => lock, releaseLock() {} }),
    },
    Session: {
      getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }),
    },
    JSON,
    String,
    Number,
    Math,
    Object,
    Array,
    Error,
    RegExp,
  });

  runInContext(code, context, { filename: 'readonly-report.gs' });
  return { ss, context, docProps, post: (body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text) };
}
