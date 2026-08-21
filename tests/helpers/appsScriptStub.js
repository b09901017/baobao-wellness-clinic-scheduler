// Apps Script 執行環境的替身。
//
// `sheets/readonly-report.gs` 跑在 Google 的伺服器上，node 裡沒有 SpreadsheetApp，
// 所以那 400 多行本來一行都測不到 —— 而它是整個專案裡唯一沒有測試的程式碼。
//
// 這份替身把它要用到的 API 都做出來，並且把「寫進哪一格什麼值、合併了哪些範圍、
// 鎖了哪幾張分頁」記下來讓測試去斷言。
//
// **它抓得到的**：邏輯錯（值算錯、寫錯格子、該鎖的沒鎖）、打錯的 API 名稱、
// 參數個數不對、超出範圍的 getRange。
//
// **它抓不到的**：Google 那一側真正的行為差異（配額、權限、setBorder 的實際效果、
// 網頁應用程式的部署設定）。那些只有真的部署上去才知道，
// 所以第一次部署如果炸了，是預期內的。

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

class FakeRange {
  constructor(sheet, row, col, rows, cols) {
    Object.assign(this, { sheet, row, col, rows, cols });
  }

  /** 每一個排版動作都回自己，因為 .gs 裡到處都在串。 */
  #self() { return this; }

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

  breakApart() {
    this.sheet.merges.length = 0;
    this.sheet.mergeBounds.length = 0;
    return this.#self();
  }

  setBackground(color) {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.cols; c += 1) {
        this.sheet.backgrounds.set(A1(this.row + r, this.col + c), color);
      }
    }
    return this.#self();
  }

  setBorder() { this.sheet.borders += 1; return this.#self(); }
  setFontFamily(v) { this.sheet.fonts.add(v); return this.#self(); }
  setFontSize() { return this.#self(); }
  setFontWeight() { return this.#self(); }
  setFontColor() { return this.#self(); }
  setHorizontalAlignment() { return this.#self(); }
  setVerticalAlignment() { return this.#self(); }
  setWrap() { return this.#self(); }
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
  addEditor(user) { this.editors.push(user); return this; }
  getEditors() { return this.editors; }
  removeEditors(emails) { this.removed.push(...emails); return this; }
  canDomainEdit() { return this.domainEdit; }
  setDomainEdit(v) { this.domainEdit = v; return this; }
  setWarningOnly(v) { this.warningOnly = v; return this; }
  remove() { this.sheet.protections.length = 0; }
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
    this.fonts = new Set();
    this.borders = 0;
    this.protections = [];
    this.widths = new Map();
    this.frozenRows = 0;
    this.frozenCols = 0;
    this.maxRows = 1000;
    this.maxCols = 26;
    this.hidden = false;
  }

  set(row, col, value) {
    if (row > this.maxRows || col > this.maxCols) {
      throw new Error(`「${this.name}」寫到範圍外：${A1(row, col)}（上限 ${A1(this.maxRows, this.maxCols)}）`);
    }
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

  getLastRow() {
    return [...this.cells.keys()].reduce((max, key) => Math.max(max, Number(key.replace(/^[A-Z]+/, ''))), 0);
  }

  clear() { this.cells.clear(); this.backgrounds.clear(); }
  clearConditionalFormatRules() {}

  addMerge(row, col, rows, cols) {
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
  setRowHeights() {}
  hideSheet() { this.hidden = true; }

  protect() {
    const p = new FakeProtection(this);
    this.protections.push(p);
    return p;
  }

  getProtections() { return this.protections; }
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

/**
 * 載入 .gs 並回傳它的全域函式，加上可以斷言的替身。
 *
 * @param {{token?: string, sheetNames?: string[], lock?: boolean}} [options]
 */
export function loadAppsScript({ token = 'secret', sheetNames = [], lock = true } = {}) {
  const ss = new FakeSpreadsheet(sheetNames);
  const source = readFileSync(new URL('../../sheets/readonly-report.gs', import.meta.url), 'utf8');

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

  runInContext(source, context, { filename: 'readonly-report.gs' });
  return { ss, context, post: (body) => JSON.parse(context.doPost({ postData: { contents: JSON.stringify(body) } }).text) };
}
