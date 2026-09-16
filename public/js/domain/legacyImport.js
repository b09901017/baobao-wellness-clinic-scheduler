// 舊試算表的解析。純函式，只負責「這張工作表要變成什麼」，不碰 IO。
//
// **這一支現在只有一個消費者**：`.claude/skills/calendar-sheet-merge` 的
// `merge.mjs`。它拿 `parseSheet()` 與 `planForSheet()` 讀舊表，再跟行事曆對帳、
// 補上時間，產出合併檔。app 這一側吃的是那份合併檔（`domain/mergeImport.js`），
// **不再有「把試算表文字貼進 app」那條路** —— 那條 2026-08-23 拿掉了，
// 因為它讀得到的東西是合併檔的子集（沒有時間、診間、治療師、器材），
// 而兩條路共用同一個寫入端，等於留著一條只會匯進比較少東西的入口。
//
// 所以這裡的 `status: 'done'` 不是結論：日期在未來的那幾筆由
// `domain/mergeImport.js` 的 `statusFor()` 在匯入當下重判（ADR-0029）。
//
// SPEC 第 6.10 節要求：先 dry-run 產出比對報告 → 人工確認 → 才真的寫入，
// 匯入的資料標 importedFrom。報告在 skill 那側產（`merge.mjs` 的 `reportText()`），
// 寫入在 data/legacyImport.js。
//
// 舊表的結構與已知陷阱在 docs/legacy/README.md。三條原則：
//
// 1. **原文照抄。** 額度名稱、註記、看不懂的格子一律原樣保留。舊表寫
//    `0.75萬健檢`，這裡就存 `0.75萬健檢` —— 舊的 parseWan() 會把它讀成 75，
//    因為它把數字混在名稱裡。新系統不挖那個數字，也就沒有那個 bug。
// 2. **不確定就不要猜，但也不要安靜地丟掉。** 對不到課程的療程列、對不到品項的
//    簡寫、看不懂的格子，全部進 problems 讓她在報告上看得見。安靜丟掉最危險：
//    她會以為系統讀進去了。
// 3. **不反推購買數量。** 舊系統用 Math.round(D2 / 模板D2) 反推，改一下 Inbody
//    的次數就算錯。但 D 欄存的本來就是乘完的數字，直接拿它當 totalQty 即可 ——
//    反推出來的數量只在報告上提一句，不進資料。
//
// 匯入的來訪沒有時間、沒有診間、沒有治療師：舊表的勾選只有日期。
// 見 docs/adr/0011-imported-visits-are-incomplete-on-purpose.md。

import { isValidDate, lastDayOf } from './dates.js';
import { contraindicationHints } from './contraindications.js';
import { equipmentForCourse } from './masterData.js';
import { followupPlanEntries } from './followups.js';
import { itemisedLabel, idsForPoolKind, POOL_SET_ALL } from './entitlements.js';
import { MAX_MARK_LENGTH, MAX_MARKS, toCustomerFields } from './customerMarks.js';

// ---------- 工作表幾何 ----------
//
// 全部用具名常數，因為這是「舊表長什麼樣」而不是「規則是什麼」——
// 真的看到檔案發現差一列時，改這裡一個數字就好。
// 列與欄都是 0-based：第 1 列是 0，A 欄是 0。

/** 第 1 列是表頭，A1 寫「客戶名稱」，F 欄以後每欄一個日期 */
const HEADER_ROW = 0;
/** 日期欄從 F 欄（第 6 欄）開始 */
const FIRST_DATE_COL = 5;
/** A2 客戶名稱、B2 購買名稱 */
const NAME_CELL = [1, 0];
const SOURCE_CELL = [1, 1];
/** 療程列：最多到第 12 列，C 欄療程、D 欄應有次數、E 欄實際次數、B 欄品項明細 */
const FIRST_ITEM_ROW = 1;
const LAST_ITEM_ROW = 11;
const COL_DETAIL = 1;
const COL_LABEL = 2;
const COL_EXPECTED = 3;
const COL_ACTUAL = 4;
/** 第 13 列二返註記、第 14 列當日營養點滴品項簡寫 */
const FOLLOWUP_ROW = 12;
const IV_SHORTHAND_ROW = 13;

/**
 * TODO／FINISH 區塊的標題。**療程列到這裡為止。**
 *
 * 文件說療程列固定是第 2–12 列、第 13 列是二返註記，但真的檔案不是這樣：
 * 第 11、12 列（營養點滴、營養品）只有三分之一的表有，所以 TODO 區塊浮動在
 * 第 13 到第 18 列之間。照著寫死的列號讀，剛好停在第 13 列的那些表會把
 * 「TODO」「FINISH」兩個字當成二返註記寫進客戶備註（docs/legacy/README.md 第 6 節）。
 */
const TASK_BLOCK_HEADERS = new Set(['TODO', 'FINISH']);

/** 0-based 欄號 → 試算表的欄名。她講的是「A11」，報告就要講 A11。 */
function colLetter(col) {
  let n = col;
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** 第一個 TODO／FINISH 出現在哪一列（0-based）。沒有就回 Infinity。 */
function taskBlockRow(grid) {
  for (let r = FIRST_ITEM_ROW; r < grid.length; r += 1) {
    if ((grid[r] ?? []).some((c) => TASK_BLOCK_HEADERS.has(normalize(c)))) return r;
  }
  return Infinity;
}

// ---------- 名稱對照 ----------

/**
 * 試算表寫法 → 課程正式名稱。來自 SPEC 第 3 節的對照表。
 * 對照到的是 config/courses 的 name，不是 id —— id 是她自己建的，可能不是種子那組。
 */
export const SHEET_COURSE_ALIASES = Object.freeze({
  Inbody: '身體組成分析',
  復健門診: '復健科醫師門診',
  物理諮詢: '物理治療師諮詢',
  營養諮詢: '營養師諮詢',
  體適能分析: '體適能檢查分析',
  'ILIB 60mins': 'ILIB',
  EECP: 'EECP',
  // 舊表第 14 列寫過這四個字（家屬用本人的名額體驗）。2026-09-16 起它是
  // 一門自己的課程（30 分，正式課 60 分）—— 名字一字不差，所以其實走得到
  // 底下那條退路，列在這裡是因為這張表就是「舊表怎麼寫」的那一份紀錄。
  'EECP體驗': 'EECP體驗',
  營養點滴: '營養點滴',
  // 第 11 列不是營養點滴專用的，也拿來放別的加購。舊表寫「心臟門診」，
  // 主檔那個課程叫「心臟科評估」。
  心臟門診: '心臟科評估',
});

/** 這一列是擇一池，不是單一課程。舊表寫「復能(1小時)」。 */
const POOL_LABELS = ['復能(1小時)', '復能（1小時）', '復能'];

/**
 * 帶時長、帶器材的列名長什麼樣子。2026-09-14 那一批多出來的寫法
 * （`.scratch/merge-answers-2026-09-14/issues/01`）：
 *
 * | 舊表寫 | 是什麼 |
 * |---|---|
 * | `復能(1小時)`、`復能(30分）`、`復能(30min)` | 復能擇一池，沒寫幾選一就是三選一 |
 * | `復能四選一(30)`、`復能三選一(60)` | 照寫的 |
 * | `任選(30min)` | 擇一池，**沒寫幾選一** —— 她 9/15：之後個別問 |
 * | `SIS(60min)`、`INDIBA(30)`、`高能(60)` | 只有那一台的池（ADR-0075：單買一台就是一台的池） |
 * | `ILIB 30`、`ILIB (60mins)`、`ILIB 60mins` | ILIB 那個課程 |
 *
 * **時長要進額度的 `durationMin`**：30 分與 60 分是兩種東西，塌成課程的預設值的話，
 * 她之後排出來的每一段長度都是錯的，而畫面上看不出來。
 *
 * @returns {{kind:'pool'|'single', course:string, only:string|null, set:'home'|'all'|null,
 *            undecided:boolean, durationMin:number|null}|null}
 *   不是這幾種就回 null，照舊走 `SHEET_COURSE_ALIASES` 那張對照表
 */
export function rowShape(label) {
  const s = normalize(label).replace(/（/g, '(').replace(/）/g, ')');
  if (s === '復能') {
    return { kind: 'pool', course: '復能', only: null, set: null, undecided: false, durationMin: null };
  }

  const pool = /^(復能|賦能)?\s*(任選)?\s*(三選一|四選一)?\s*\(\s*(\d+)\s*(小時|mins?|分鐘?)?\s*\)$/i.exec(s);
  if (pool && (pool[1] || pool[2] || pool[3])) {
    return {
      kind: 'pool',
      course: '復能',
      only: null,
      set: { 四選一: 'all', 三選一: 'home' }[pool[3]] ?? null,
      undecided: Boolean(pool[2]) && !pool[3],
      durationMin: /小時/.test(pool[5] ?? '') ? Number(pool[4]) * 60 : Number(pool[4]),
    };
  }

  const one = /^(SIS|超磁場?|INDIBA|IN|高能量雷射|高能)\s*\(\s*(\d+)\s*(mins?|分鐘?)?\s*\)$/i.exec(s);
  if (one) {
    // 輸出的是**器材主檔的全名**（ADR-0078），不是她寫的簡寫
    const only = /^(SIS|超磁)/i.test(one[1]) ? 'SIS' : /^IN/i.test(one[1]) ? 'INDIBA' : '高能量雷射';
    return { kind: 'pool', course: '復能', only, set: null, undecided: false, durationMin: Number(one[2]) };
  }

  const ilib = /^ILIB\s*\(?\s*(\d+)\s*(mins?|分鐘?)?\s*\)?$/i.exec(s);
  if (ilib) {
    return { kind: 'single', course: 'ILIB', only: null, set: null, undecided: false, durationMin: Number(ilib[1]) };
  }
  return null;
}

/**
 * 一個字的點滴品項（她 2026-09-15）。舊表第 14 列、第 13 列與行事曆上都這樣寫。
 *
 * **只收這三個字**：多收一個就多一種把別的東西讀成品項的機會 ——
 * 行事曆上「腸胃鏡」的腸不是腸道修復。
 */
export const IV_SHORTHAND = Object.freeze({ 雪: '雪顏亮彩', 肝: '護肝排毒', 腸: '腸道修復' });

/** 簡寫換成全名；不是那三個字就原樣回去（兩個字的「護肝」「雪顏」照舊靠前綴比對）。 */
const expandIv = (s) => IV_SHORTHAND[normalize(s)] ?? normalize(s);

/**
 * 擇一池有哪幾台。
 *
 * - 只有一台（`SIS(60min)`）→ 那一台
 * - 四選一 → 全部還在用的器材，組法借 `idsForPoolKind()`，**不另寫一份**
 * - 其餘（`復能(1小時)`、三選一、沒寫的 `任選`）→ 復能自己的那幾台，不含 ILIB（ADR-0075）
 */
function poolIdsFor(shape, course, { equipment = [], courses = [] }) {
  if (shape?.only) {
    const hit = equipment.find((e) => !e.deletedAt && normalize(e.name).toLowerCase() === shape.only.toLowerCase());
    return hit ? [hit.id] : [];
  }
  if (shape?.set === 'all') {
    return idsForPoolKind(POOL_SET_ALL, { equipment, courses })
      ?? equipment.filter((e) => !e.deletedAt && e.active !== false).map((e) => e.id);
  }
  return equipmentForCourse(course?.id ?? null, equipment).map((e) => e.id);
}

// ---------- 警示與合作機構 ----------

/**
 * 舊表文字裡看得出來的警示。她 2026-09-07：「體內金屬類、血管難打類自動變警示」，
 * 而**否定句一個都不可以長出來** —— 「沒有金屬」讀成有金屬，卡片牆上那顆假的丸子本身就是錯的資訊。
 *
 * 判準看的是同一句裡、那個字**前面**有沒有否定詞，不是整格有沒有「金屬」兩個字。
 * 名字只從主檔的警示名單裡挑（ADR-0074：客戶身上存的是字串，主檔上沒有的字畫不出來）。
 */
const FLAG_PATTERNS = [
  { flag: '體內金屬', re: /金屬|合金|鋼釘|鋼板/ },
  { flag: '血管難打', re: /血管細|血管難打|難上針|難打針/ },
];
/** 否定詞在前（「沒有金屬」）或在後（「金屬已取出」）都算否定 —— 後面那一種最容易漏。 */
const NEGATED_BEFORE = /(無|沒有|沒|不是)\s*$/;
const NEGATED_AFTER = /^\s*(已經?取出|已經?拿掉|已經?拆掉|取出了|拿掉了|拆掉了)/;

export function flagsFromText(texts, clinicalFlags = []) {
  const names = new Set((clinicalFlags ?? []).filter((f) => !f.deletedAt).map((f) => normalize(f.name)));
  return FLAG_PATTERNS
    .filter(({ flag }) => names.has(flag))
    .filter(({ re }) => texts.some((t) => String(t ?? '').split(/[，,。；;！!\n]/).some((clause) => {
      const m = re.exec(clause);
      return m && !NEGATED_BEFORE.test(clause.slice(0, m.index))
        && !NEGATED_AFTER.test(clause.slice(m.index + m[0].length));
    })))
    .map(({ flag }) => flag);
}

/** 文字裡出現了合作機構的名字（ADR-0076）。一樣只認主檔上有的。 */
export function partnersFromText(texts, partners = []) {
  return (partners ?? [])
    .filter((x) => !x.deletedAt && normalize(x.name))
    .map((x) => normalize(x.name))
    .filter((name) => texts.some((t) => String(t ?? '').includes(name)));
}

/**
 * 第 9 列的健檢。名稱裡混著金額等級，後面還可能再接項目：
 * `0.75萬健檢`、`x萬健檢`（金額未定）、`5萬健檢(心臟)`、`5萬健檢(腸道)`。
 * 所以是「含有」不是「結尾是」—— 用 endsWith 會把後面帶括號的兩種整列丟掉。
 */
const CHECKUP_WORD = '健檢';

/** 第 11 列的營養點滴，後面可能接項目：`營養點滴（腸道）`。 */
const IV_DRIP_PREFIX = '營養點滴';

/** 她也寫「營養針」（2026-09-07 回答過）。課程照樣是營養點滴。 */
const IV_DRIP_LABELS = [IV_DRIP_PREFIX, '營養針'];

/** 第 12 列，例：`營養品(12000)`。不佔時段、不排班、不產生額度。 */
const PRODUCT_PREFIX = '營養品';

/**
 * 她也寫「營養素」（2026-09-07）。**營養品不排班**（ADR-0057）——
 * 認成營養點滴的話，那位客戶會多出一堆排不掉的次數。
 */
const PRODUCT_LABELS = [PRODUCT_PREFIX, '營養素'];

const isProductRow = (label) => PRODUCT_LABELS.some((x) => label.startsWith(x));
const isIvRow = (label) => IV_DRIP_LABELS.some((x) => label.startsWith(x));

/** 表頭的 `9月7日`／`9/7` → 備註裡用的 `9/7`。讀不出來就原樣。 */
function shortDate(raw) {
  const m = DATE_RE.exec(normalize(raw));
  return m ? `${Number(m[2])}/${Number(m[3])}` : normalize(raw);
}

const normalize = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');

// ---------- 分隔文字 → 格子 ----------

/**
 * CSV / TSV 都吃。Google 試算表匯出的是 CSV，她從畫面上複製貼過來的是 TSV，
 * 兩種都要能接，所以自動判斷分隔字元而不是叫她選。
 *
 * 自己寫是因為引號裡包著逗號與換行的欄位（手寫註記常常有）用 split(',') 會碎掉，
 * 而這個專案刻意沒有相依套件。
 *
 * @param {string} text
 * @returns {string[][]} 每列一個陣列，不補齊長度
 */
export function parseDelimited(text) {
  const src = String(text ?? '').replace(/^﻿/, '');
  if (!src.trim()) return [];

  const delimiter = detectDelimiter(src);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];

    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += ch;
      continue;
    }

    if (ch === '"' && field === '') quoted = true;
    else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (ch !== '\r') field += ch;
  }

  row.push(field);
  rows.push(row);

  // 尾端整列都空的不算資料列
  while (rows.length && rows[rows.length - 1].every((c) => normalize(c) === '')) rows.pop();
  return rows;
}

/** 只看第一行：tab 比逗號多就是 TSV。手寫註記裡的逗號不會多到蓋過欄位分隔。 */
function detectDelimiter(src) {
  const firstLine = src.split('\n', 1)[0];
  const tabs = (firstLine.match(/\t/g) ?? []).length;
  const commas = (firstLine.match(/,/g) ?? []).length;
  return tabs > commas ? '\t' : ',';
}

// ---------- 日期 ----------

const DATE_RE = /^(?:(\d{4})[-/.])?(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/;

/**
 * 表頭的日期。舊表大多只寫 `8/11` —— **沒有年份**，所以一定要給一個基準年，
 * 而且要在報告上講明白補了哪一年。猜錯一年，那筆來訪就掉到別的地方去了。
 *
 * @param {string} raw
 * @param {number} year 沒寫年份時補這一年
 * @returns {{date: string|null, hadYear: boolean}}
 */
export function parseSheetDate(raw, year) {
  const m = DATE_RE.exec(normalize(raw));
  if (!m) return { date: null, hadYear: false };

  const y = m[1] ? Number(m[1]) : Number(year);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!Number.isInteger(y) || month < 1 || month > 12) return { date: null, hadYear: false };
  if (day < 1 || day > lastDayOf(y, month)) return { date: null, hadYear: false };

  const iso = `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return { date: isValidDate(iso) ? iso : null, hadYear: Boolean(m[1]) };
}

// ---------- 勾選格 ----------

const CHECKED = new Set(['TRUE', 'true', 'True', '1', '✓', '✔', 'V', 'v', 'X', 'x', '是', 'Y', 'y']);
const UNCHECKED = new Set(['', 'FALSE', 'false', 'False', '0', '-', '—']);

/**
 * @returns {true|false|null} null = 這一格有東西但看不懂，要列進報告
 */
export function readCheckbox(raw) {
  const v = normalize(raw);
  if (CHECKED.has(v)) return true;
  if (UNCHECKED.has(v)) return false;
  return null;
}

// ---------- 營養點滴的品項明細 ----------

/**
 * B11 的 `護肝排毒x11+雪顏亮彩x22` → 每個品項各自的次數。
 *
 * CONTEXT.md：營養點滴品項「各自有各自的次數，不合併計算」，所以這裡拆成
 * 好幾筆額度，而不是一筆 33 次的「營養點滴」。D 欄的加總留著跟拆出來的對一次。
 *
 * @param {string} raw
 * @returns {{items: {name: string, qty: number|null}[], unparsed: string[]}}
 */
export function parseIvBreakdown(raw) {
  const items = [];
  const unparsed = [];

  for (const piece of String(raw ?? '').split(/[+＋、,，]/)) {
    const text = normalize(piece);
    if (!text) continue;
    const m = /^(.+?)\s*[x×*]\s*(\d+)$/i.exec(text);
    if (m) items.push({ name: normalize(m[1]), qty: Number(m[2]) });
    // 沒寫次數的（第 12 列的營養品就是這樣）照樣收下來，次數留 null
    else if (/^[^x×*]+$/i.test(text)) items.push({ name: text, qty: null });
    else unparsed.push(text);
  }

  return { items, unparsed };
}

// ---------- 解析一張工作表 ----------

/**
 * 把一張工作表的文字解析成結構。這一步**只讀不判斷**：對不對得到課程、
 * 次數合不合理，是 planForSheet() 的事。
 *
 * @param {string} text CSV 或 TSV
 * @param {{sheetName?: string}} [options]
 */
export function parseSheet(text, { sheetName = '' } = {}) {
  const grid = parseDelimited(text);
  const cell = (r, c) => normalize(grid[r]?.[c]);
  const blockRow = taskBlockRow(grid);

  const dateColumns = [];
  const header = grid[HEADER_ROW] ?? [];
  for (let c = FIRST_DATE_COL; c < header.length; c += 1) {
    const raw = normalize(header[c]);
    if (raw) dateColumns.push({ col: c, raw });
  }

  const items = [];
  const lastItemRow = Math.min(LAST_ITEM_ROW, blockRow - 1);
  for (let r = FIRST_ITEM_ROW; r <= lastItemRow && r < grid.length; r += 1) {
    const label = cell(r, COL_LABEL);
    if (!label) continue;
    items.push({
      row: r + 1, // 對外一律講試算表的列號（1-based），她看的是那個
      label,
      detail: cell(r, COL_DETAIL),
      expected: cell(r, COL_EXPECTED),
      actual: cell(r, COL_ACTUAL),
      checks: dateColumns.map(({ col, raw }) => ({ col, raw, value: cell(r, col) })),
    });
  }

  // 第 13、14 列：二返註記與當日品項簡寫。整列收下來，別自作聰明只挑一格 ——
  // 但兩列都可能已經被 TODO 區塊佔走，那時候這裡什麼都不該讀。
  const dateCols = new Set(dateColumns.map((d) => d.col));
  const ivShorthand = {};
  if (IV_SHORTHAND_ROW < blockRow) {
    for (const { col } of dateColumns) {
      const v = cell(IV_SHORTHAND_ROW, col);
      if (v) ivShorthand[col] = v;
    }
  }
  // 第 13 列那一格只寫了一個字的品項（雪、肝、腸）→ 那是品項，不是二返註記。
  // 2026-09-14 那一批有一張表把品項寫到第 13 列來了，於是「腸 肝 腸 肝」整串進了備註。
  // 沒有日期的那一格也寫了一個字的，是她多寫的 —— 不進備註，但要在報告上講。
  const followupCells = [];
  const strayIvShorthand = [];
  if (FOLLOWUP_ROW < blockRow) {
    (grid[FOLLOWUP_ROW] ?? []).forEach((raw, col) => {
      const v = normalize(raw);
      if (!v) return;
      if (!IV_SHORTHAND[v]) followupCells.push(v);
      else if (!dateCols.has(col)) strayIvShorthand.push({ cell: `${colLetter(col)}${FOLLOWUP_ROW + 1}`, text: v });
      else if (!ivShorthand[col]) ivShorthand[col] = v;
      else followupCells.push(v);
    });
  }

  return {
    sheetName,
    customerName: cell(...NAME_CELL),
    source: cell(...SOURCE_CELL),
    dateColumns,
    items,
    followupNote: followupCells.join(' '),
    ivShorthand,
    strayIvShorthand,
    leftovers: leftoverCells(grid, cell, { dateColumns, lastItemRow, blockRow }),
  };
}

/**
 * 有字、但上面每一段都沒有讀到的格子。
 *
 * 舊表的手寫註記沒有固定的位置：A11 寫「目前只要SIS」、B14 寫「寄紙本報告」、
 * A15 寫「和妻同一天賦能」—— 那些是器材偏好、永久限制、待辦，全部是有用的東西。
 * 這個檔案開頭的第二條原則說「不確定就不要猜，但也不要安靜地丟掉」，
 * 而在補上這一段之前，這些格子就是被安靜丟掉的那一種。
 *
 * 所以改成反過來：**沒有被任何一段讀走的字，一律撿起來。**
 * 撿到什麼由 planForSheet() 原文收進備註，並且在報告上一格一格列出來 ——
 * 她要能一眼看出「這張表上的字有沒有全部進去」，而不是自己一格一格對。
 */
function leftoverCells(grid, cell, { dateColumns, lastItemRow, blockRow }) {
  const dateOf = new Map(dateColumns.map((d) => [d.col, d.raw]));
  const labelled = (r) => Boolean(cell(r, COL_LABEL));

  const wasRead = (r, c) => {
    if (r === HEADER_ROW) return true;
    if (r === NAME_CELL[0] && (c === NAME_CELL[1] || c === SOURCE_CELL[1])) return true;
    if (r === FOLLOWUP_ROW) return true;
    if (r === IV_SHORTHAND_ROW) return dateOf.has(c);
    // 療程列裡，B–E 欄與日期欄**只有在那一列有療程名稱時**才算讀過（那是明細、次數與勾選格）。
    // 沒有名稱的那一列，日期欄裡寫的是一句手寫註記（「欠30」「療程單有簽…」）——
    // 2026-09-14 以前這裡把整列日期欄都當成讀過，那幾句話就安靜地不見了。
    if (r >= FIRST_ITEM_ROW && r <= lastItemRow && labelled(r)) {
      return (c >= COL_DETAIL && c <= COL_ACTUAL) || dateOf.has(c);
    }
    return false;
  };

  const out = [];
  for (let r = 0; r < grid.length && r < blockRow; r += 1) {
    for (let c = 0; c < (grid[r] ?? []).length; c += 1) {
      const text = cell(r, c);
      // 沒被讀到的勾選框不是註記，是排在日期欄外面的空框。撿起來只會洗版。
      if (!text || wasRead(r, c) || readCheckbox(text) !== null) continue;
      // 寫在日期欄裡的，那一天就是它的上下文 —— 進備註時要帶著（「9/7 欠30」）
      out.push({ cell: `${colLetter(c)}${r + 1}`, text, date: dateOf.get(c) ?? null });
    }
  }
  return out;
}

// ---------- B2「購買名稱」那一格 ----------

/**
 * 認得的購買通路。**照她真的寫過的字列**（2026-09-13 讀她那份 xlsx：只有這兩種）。
 * 新的通路出現時加在這裡；認不得的整格退回 leftover，不猜。
 */
export const PURCHASE_CHANNELS = ['顧客會', 'H2U導客'];

/** B2 的 `8` 是 8 萬方案，其餘數字一律是健檢金額（她 2026-09-13 的第 2 題）。 */
const PLAN_NUMBER = 8;

/**
 * 舊表 B2「購買名稱」拆成購買日、通路、方案與套數、健檢、寫在字裡的加購、剩下的字。
 *
 * 她 2026-09-13：
 *
 * > 我寫0617 顧客會-8+5 (其中0617代表6/17買的，8代表8萬方案(8+8代表8萬方案買了兩套)
 * > 5(0.75/12) 代表+5(0.75/12)萬健檢
 *
 * > 新就是新 8 萬方案
 *
 * 實際的寫法比那一句多（`docs/legacy/README.md` 第 6 節、`.scratch/asks-2026-09-13/issues/07` 那張表）：
 * 日期在後面的（`新-8萬-顧客會8/24`）、數字前面沒有破折號的（`0723顧客會12`）、
 * 加購寫在字裡的（`only sis(60)x10`）、括號裡是微調的、破折號後面是一句醫療註記的、
 * 整格手寫的。
 *
 * **這一支只讀字，不判斷對不對** —— 驗證（套數跟 D 欄對不對得上、「新」跟範本對不對得上）
 * 在 `planForSheet()`，那裡才看得到 D 欄。這裡只把「字面上就講不通」的講出來。
 *
 * **讀不懂的一個字都不丟**：全部進 `leftover`，原文照抄（這個檔案開頭的第二條原則）。
 *
 * @param {string} raw B2 那一格
 * @param {number} year 表頭沒寫年份，由呼叫端補
 * @returns {{date:string|null, channel:string|null,
 *            plan:{newTemplate:boolean, sets:number}|null, exams:string[],
 *            extras:{text:string, qty:number}[], leftover:string, problems:string[]}}
 */
export function parsePurchaseCell(raw, year) {
  const out = {
    date: null, channel: null, plan: null, exams: [], extras: [], leftover: '', problems: [], newWithoutPlan: false,
  };
  let s = normalize(raw)
    .replace(/[（]/g, '(').replace(/[）]/g, ')')
    .replace(/[＋]/g, '+').replace(/[－—–]/g, '-')
    .replace(/[ｘＸ×＊]/g, 'x');
  if (!s) return out;

  // 日期：開頭的 MMDD，或任何位置的 M/D
  const dateAt = (m, d) => {
    const iso = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isValidDate(iso) ? iso : null;
  };
  const head = s.match(/^(\d{2})(\d{2})(?!\d)/);
  if (head) {
    out.date = dateAt(Number(head[1]), Number(head[2]));
    if (out.date) s = s.slice(head[0].length);
  } else {
    const slash = s.match(/(\d{1,2})\/(\d{1,2})/);
    if (slash) {
      out.date = dateAt(Number(slash[1]), Number(slash[2]));
      if (out.date) s = `${s.slice(0, slash.index)} ${s.slice(slash.index + slash[0].length)}`;
    }
  }

  // 「新」只認緊接在日期後面、或整格開頭的那一個 —— 註記裡的「新」字不算。
  // 日期與「新」之間可以夾一個破折號（`0824-新顧客會-8`，2026-09-14 那一批）
  let isNew = false;
  const fresh = s.match(/^\s*-?\s*新\s*-?\s*/);
  if (fresh) {
    isNew = true;
    s = s.slice(fresh[0].length);
  }

  for (const channel of PURCHASE_CHANNELS) {
    if (s.includes(channel)) {
      out.channel = channel;
      s = s.replace(channel, ' ');
      break;
    }
  }

  // 剩下的：去掉頭尾的分隔，照 + 切
  s = s.replace(/^[\s-]+/, '').replace(/[\s-]+$/, '').trim();
  const leftovers = [];
  let sets = 0;

  for (const piece of s ? s.split('+') : []) {
    const token = piece.replace(/^[\s-]+/, '').trim();
    if (!token) continue;

    // 數字後面可以接括號（微調）或空一格接一句話（`5 欠尾款3萬`）—— 數字照讀，其餘進 leftover。
    // 健檢也會寫全（`5萬健檢（尾款欠…）`，2026-09-14 那一批）
    const number = token.match(/^(\d+(?:\.\d+)?)\s*萬?\s*(?:健檢)?\s*(?:\((.*?)\)?)?(?:\s+(.+))?$/);
    if (number) {
      const n = Number(number[1]);
      if (n === PLAN_NUMBER) sets += 1;
      else out.exams.push(`${number[1]}萬`);
      if (number[2]?.trim()) leftovers.push(number[2].trim());
      if (number[3]?.trim()) leftovers.push(number[3].trim());
      continue;
    }

    const extra = token.match(/^(?:only\s*)?(.+?)\s*x\s*(\d+)\s*堂?$/i);
    if (extra) {
      out.extras.push({ text: extra[1].trim(), qty: Number(extra[2]) });
      continue;
    }

    leftovers.push(token);
  }

  if (sets) out.plan = { newTemplate: isNew, sets };
  // 寫了「新」卻沒有方案數字：她 2026-09-13 回答過「應該只是打錯」，**回答過就不再問**
  // （9/14 那一批又問了三次）。留一個旗子 —— D 欄剛好是新範本的那一種，`legacyPlanFor()` 照樣會講
  else if (isNew) out.newWithoutPlan = true;
  // 用 + 接回去：切的時候拿掉的就是 +，讀不懂的那一段要是原文（`A+B再說` 不可以變成 `A B再說`）
  out.leftover = leftovers.join('+');
  return out;
}

/**
 * 舊表的兩份 8 萬方案。**用舊表自己的列名寫**，不讀 app 的方案主檔 ——
 * 這一支只在 skill 那一側跑（ADR-0047 之後 app 裡沒有貼試算表那一頁），
 * 而 skill 看不到她的主檔。
 *
 * 次數是她那份 xlsx 最前面兩張模板分頁上的（2026-09-13 讀的）：
 * 舊 8 萬（復健門診 2、復能 20、ILIB 12）與新 8 萬（復健門診 6、復能 12、ILIB 20）。
 * 名字是**快照**（ADR-0003），她說「新就是新 8 萬方案」。
 */
export const LEGACY_PLANS = Object.freeze([
  Object.freeze({
    name: '8萬方案', newTemplate: false,
    rows: Object.freeze({
      Inbody: 4, 復健門診: 2, 物理諮詢: 4, 營養諮詢: 4, 體適能分析: 4, '復能(1小時)': 20, 'ILIB 60mins': 12,
    }),
  }),
  Object.freeze({
    name: '新8萬方案', newTemplate: true,
    rows: Object.freeze({
      Inbody: 4, 復健門診: 6, 物理諮詢: 4, 營養諮詢: 4, 體適能分析: 4, '復能(1小時)': 12, 'ILIB 60mins': 20,
    }),
  }),
]);

/**
 * 這一張表的第 2–8 列是不是一份方案，是哪一份、幾套。**拿 D 欄的應有次數驗 B2**。
 *
 * 她 2026-09-13：「所有的方案課程加購都可以再用各種課程的應有次數去驗證一次，
 * 然後合併的時候也可以再問我一次」。所以：
 *
 * - D 欄剛好是某一份的整數倍 → 照 D 欄（那是當初真的建進去的次數）。跟 B2 寫的不一樣就講
 * - D 欄不是整數倍（微調過）→ 照 B2 的套數，挑對得上最多列的那一份
 * - B2 沒寫方案但 D 欄剛好是整數倍 → 當成方案，而且講（合併時要問）
 *
 * @returns {{template: object|null, sets: number|null, problems: string[]}}
 */
function legacyPlanFor(parsed, purchase) {
  const problems = [];
  const expectedOf = (label) => toQty(parsed.items.find((i) => i.label === label)?.expected) ?? 0;
  const exactOf = (t) => {
    const ratios = Object.entries(t.rows).map(([label, q]) => expectedOf(label) / q);
    const n = ratios[0];
    return Number.isInteger(n) && n > 0 && ratios.every((x) => x === n) ? n : null;
  };
  const hits = LEGACY_PLANS.map((t) => ({ t, n: exactOf(t) })).filter((x) => x.n);
  const said = purchase.plan;

  if (said) {
    const hit = hits.find((x) => x.t.newTemplate === said.newTemplate) ?? hits[0] ?? null;
    if (hit) {
      if (hit.t.newTemplate !== said.newTemplate) {
        problems.push(said.newTemplate
          ? `購買名稱寫了「新」，但第 2–8 列的應有次數是「${hit.t.name}」的，照應有次數匯`
          : `購買名稱沒寫「新」，但第 2–8 列的應有次數是「${hit.t.name}」的，照應有次數匯`);
      }
      if (hit.n !== said.sets) {
        problems.push(`購買名稱寫 ${said.sets} 套，但第 2–8 列的應有次數是 ${hit.n} 套，照應有次數匯`);
      }
      return { template: hit.t, sets: hit.n, problems };
    }

    const score = (t) => Object.entries(t.rows)
      .filter(([label, q]) => expectedOf(label) === q * said.sets).length;
    const ranked = LEGACY_PLANS
      .map((t) => ({ t, s: score(t) }))
      .sort((a, b) => b.s - a.s || (a.t.newTemplate === said.newTemplate ? -1 : 1));
    if (ranked[0].s > 0) {
      if (ranked[0].t.newTemplate !== said.newTemplate) {
        problems.push(`購買名稱${said.newTemplate ? '寫了' : '沒寫'}「新」，但第 2–8 列的應有次數比較像「${ranked[0].t.name}」`);
      }
      return { template: ranked[0].t, sets: said.sets, problems };
    }
    problems.push(`購買名稱寫了 ${said.sets} 套 8 萬方案，但第 2–8 列的應有次數對不上任何一份，那幾列當成加購匯`);
    return { template: null, sets: null, problems };
  }

  if (hits.length) {
    const [hit] = hits;
    problems.push(`購買名稱沒寫方案，但第 2–8 列的應有次數剛好是「${hit.t.name}」× ${hit.n}，當成方案匯`);
    return { template: hit.t, sets: hit.n, problems };
  }
  return { template: null, sets: null, problems };
}

/** `SIS(60min)`、`sis(60)` → `sis60`。寫在 B2 字裡的加購跟 C 欄的列名比對用。 */
const looseName = (v) => String(v ?? '').toLowerCase()
  // 「任選」是她講擇一池的說法（`復能任選(30)` 那一列叫 `復能(30min)`，2026-09-13 真檔上看到的）。
  // 幾選一也拿掉：B2 寫 `復能四選一(30)`、那一列只寫 `復能(30min)`（2026-09-14）—— 幾選一另外讀
  .replace(/mins?|分鐘|分|堂|only|任選|三選一|四選一/g, '')
  .replace(/[\s()（）\-_]/g, '');

// ---------- 一張工作表 → 要寫進去的東西 ----------

const IMPORT_SOURCE = 'legacy-sheet';

/** 額度與時段之間用 key 相認，真正的 id 要等寫入時才有（子集合的路徑需要父 id）。 */
const keyOf = (row, suffix = '') => `r${row}${suffix ? `:${suffix}` : ''}`;

function stampOf(sheetName, importedAt) {
  return { source: IMPORT_SOURCE, sheetName: sheetName || null, importedAt: importedAt ?? null };
}

function toQty(raw) {
  const v = normalize(raw).replace(/[, ]/g, '');
  if (v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 對照表 → 課程正式名稱 → config/courses 的那一筆。對不到就回 null。 */
function resolveCourse(label, courses) {
  const alive = courses.filter((c) => !c.deletedAt);
  const wanted = SHEET_COURSE_ALIASES[label] ?? label;
  return (
    alive.find((c) => normalize(c.name) === wanted)
    ?? alive.find((c) => normalize(c.name) === label)
    ?? null
  );
}

/**
 * 一張工作表要建立什麼。**不寫入任何東西**，回傳的是計畫，
 * 給 dry-run 報告看，也給 data 層照著寫。
 *
 * @param {ReturnType<typeof parseSheet>} parsed
 * @param {object} ctx
 * @param {object[]} ctx.courses    config/courses
 * @param {object[]} ctx.equipment  config/equipment，擇一池的候選器材
 * @param {object[]} ctx.ivProducts config/ivProducts
 * @param {object[]} ctx.plans      config/plans，只拿來推測「看起來是哪個方案 × 幾」
 * @param {object[]} ctx.existingCustomers 已經在系統裡的客戶，同名就整張跳過
 * @param {number}   ctx.year       表頭沒寫年份時補這一年
 * @param {string|null} [ctx.importedAt]
 */
export function planForSheet(parsed, {
  courses = [],
  equipment = [],
  ivProducts = [],
  plans = [],
  clinicalFlags = [],
  partners = [],
  existingCustomers = [],
  year = new Date().getFullYear(),
  importedAt = null,
} = {}) {
  const problems = [];
  const notes = [];
  const skippedRows = [];
  /** 刻意不建額度的列（營養品）。日期迴圈碰到它們要安靜跳過。 */
  const deliberate = new Set();
  const stamp = stampOf(parsed.sheetName, importedAt);
  const problem = (where, raw, why) => problems.push({ where, raw: raw || '', why });

  if (!parsed.customerName) {
    problem('A2', '', '這張表沒有客戶名稱，整張跳過');
    return emptyPlan(parsed, { problems, skip: '沒有客戶名稱' });
  }

  const clash = existingCustomers.find(
    (c) => !c.deletedAt && normalize(c.name) === parsed.customerName,
  );
  if (clash) {
    return emptyPlan(parsed, {
      skip: `系統裡已經有「${parsed.customerName}」，整張跳過以免建出第二份`,
    });
  }

  // 姓名格裡不只有名字：`名字3157`、`名字\n(高能/sis)3157` 兩種都有，數字是
  // 病歷編號、括號是器材偏好。名字本身照 SPEC 第 4.3 節原文照抄，一個字都不動 ——
  // 拆錯名字比留著多餘的字嚴重得多。但那些多出來的東西是有用的，
  // 所以另外解析一份放進備註，客戶詳情頁看得到。
  notes.push(...nameExtras(parsed.customerName));

  // 沒有欄位可放的手寫註記（A11 的器材偏好、B14 的待辦、A15 的排班習慣…）。
  // 原文照抄，一個字都不改寫 —— 讀不懂不是丟掉的理由（SPEC 第 4.3 節）。
  // 寫在日期欄裡的前面帶那一天（「9/7 欠30」），不然她看不出那句話講的是哪一次。
  notes.push(...parsed.leftovers.map((x) => (x.date ? `${shortDate(x.date)} ${x.text}` : x.text)));
  for (const s of parsed.strayIvShorthand ?? []) {
    problem(s.cell, s.text, '第 13 列這一格寫了一個字的品項，但上面沒有日期，沒有匯入');
  }

  // B2「購買名稱」拆成購買日、通路、方案與套數（`.scratch/asks-2026-09-13/issues/07`）。
  // 讀不懂的字（括號裡的微調、醫療註記、手寫句子）原文進備註，**排在最前面** ——
  // 那是她寫在客戶名字旁邊的那一格，比 A11 那種角落裡的註記重要。
  const purchase = parsePurchaseCell(parsed.source, year);
  if (purchase.leftover) notes.unshift(purchase.leftover);
  const purchaseProblems = [...purchase.problems];
  const legacy = legacyPlanFor(parsed, purchase);
  purchaseProblems.push(...legacy.problems);

  // ---------- 額度 ----------

  const entitlements = [];
  /** @type {Map<number, {keys: string[], course: object|null, kind: string}>} 列 → 這一列產生了什麼 */
  const byRow = new Map();
  /** 寫了「任選」卻沒寫幾選一的那幾列。B2 字裡有寫的話會被補上，剩下的才問 */
  const undecided = [];

  for (const item of parsed.items) {
    const checks = item.checks.filter((c) => readCheckbox(c.value) === true).length;
    const expected = toQty(item.expected);
    const actual = toQty(item.actual);

    // 第 12 列的營養品：只記錄與顯示，不佔時段、不排班、不產生額度（CONTEXT.md）
    if (isProductRow(item.label)) {
      const line = [item.label, item.detail].filter(Boolean).join('：');
      notes.push(line);
      if (checks) problem(`第 ${item.row} 列`, item.label, `勾了 ${checks} 次，但營養品不排班，沒有匯入成來訪`);
      // 這一列不會有額度，而且那是刻意的。記下來，免得下面每個勾起來的日期
      // 再各報一次「這一列沒有建出額度」—— 同一件事講六遍就沒有人在看了。
      deliberate.add(item.row);
      continue;
    }

    // 第 11 列的營養點滴：B 欄拆成每個品項各一筆額度（各自計次，不合併）
    if (isIvRow(item.label)) {
      const course = resolveCourse(IV_DRIP_PREFIX, courses);
      if (!course) {
        problem(`第 ${item.row} 列`, item.label, '對不到任何課程，這一列沒有匯入');
        continue;
      }
      const { items: products, unparsed } = parseIvBreakdown(item.detail);
      for (const raw of unparsed) problem(`第 ${item.row} 列 B 欄`, raw, '看不懂這一段品項明細');

      const made = [];
      for (const p of products) {
        const product = ivProducts.find((x) => !x.deletedAt && normalize(x.name) === p.name) ?? null;
        if (!product) problem(`第 ${item.row} 列 B 欄`, p.name, '主檔裡沒有這個營養點滴品項，額度照建但每次來訪的品項會是空的');
        const qty = p.qty ?? 0;
        if (qty <= 0) {
          problem(`第 ${item.row} 列 B 欄`, p.name, '沒有寫次數，這個品項沒有建額度');
          continue;
        }
        const key = keyOf(item.row, p.name);
        entitlements.push({
          key,
          productName: p.name,
          productId: product?.id ?? null,
          doc: entitlementDoc({ label: itemisedLabel(IV_DRIP_PREFIX, p.name), course, totalQty: qty, stamp }),
        });
        made.push(key);
      }

      if (!made.length) {
        // B 欄沒有明細（或全部沒次數），退回一筆合計的額度，總比丟掉好。
        // D 欄是 0 也要退回勾選數 —— 真實的舊表上「營養點滴（腸道）」就是
        // D 欄留 0、E 欄寫 5、日期欄勾了五格，不接住就整列掉了。
        const qty = expected && expected > 0 ? expected : checks;
        if (qty > 0) {
          const key = keyOf(item.row);
          entitlements.push({
            key,
            productName: null,
            productId: null,
            doc: entitlementDoc({ label: item.label, course, totalQty: qty, stamp }),
          });
          made.push(key);
          if (!expected) problem(`第 ${item.row} 列`, item.label, `D 欄沒有次數，總次數先用勾選數 ${checks}`);
        } else {
          skippedRows.push({ row: item.row, label: item.label, why: '沒有次數也沒有勾選' });
          continue;
        }
      } else if (expected != null) {
        const sum = entitlements.filter((e) => made.includes(e.key))
          .reduce((n, e) => n + e.doc.totalQty, 0);
        if (sum !== expected) {
          problem(`第 ${item.row} 列`, `${item.detail}（D 欄 ${expected}）`,
            `品項次數加起來是 ${sum}，跟 D 欄的 ${expected} 對不起來。以品項為準`);
        }
      }

      byRow.set(item.row, { keys: made, course, kind: 'iv' });
      continue;
    }

    // 第 7 列的復能：擇一池，換的是器材不是課程。帶時長、只寫一台的新寫法見 `rowShape()`
    const shape = rowShape(item.label);
    const isPool = shape ? shape.kind === 'pool' : POOL_LABELS.includes(item.label);
    const course = resolveCourse(shape?.course ?? (isPool ? '復能' : item.label), courses)
      ?? (item.label.includes(CHECKUP_WORD) ? resolveCourse(CHECKUP_WORD, courses) : null);

    // 這一池有哪幾台，從**課程**推（ADR-0075）——「所有器材」在 ILIB 補成
    // 第四台之後就不對了：舊表的「復能(1小時)」講的是那三台，不含 ILIB。
    const poolEquipmentIds = isPool ? poolIdsFor(shape, course, { equipment, courses }) : [];
    if (shape?.undecided) undecided.push(item);

    if (!course) {
      problem(`第 ${item.row} 列`, item.label,
        '對不到任何課程，這一列的額度與勾選都沒有匯入（可以先去主檔把課程建起來再匯一次）');
      continue;
    }

    let qty = expected;
    if (qty == null || qty <= 0) {
      if (checks > 0) {
        qty = checks;
        problem(`第 ${item.row} 列`, item.label, `D 欄沒有次數，但勾了 ${checks} 次，總次數先用 ${checks}`);
      } else {
        skippedRows.push({ row: item.row, label: item.label, why: '沒有次數也沒有勾選' });
        continue;
      }
    }

    // `x萬健檢` 的 x 是還沒決定的金額等級，不是打錯字。額度照建（名稱原文照抄），
    // 但要講一聲 —— 不講的話她會在客戶詳情頁看到一筆叫「x萬健檢」的額度，
    // 而那看起來像系統壞掉，不像「這裡還沒填」。
    if (item.label.includes(CHECKUP_WORD) && /[xX]\s*萬/.test(item.label)) {
      problem(`第 ${item.row} 列`, item.label,
        '健檢的金額等級還沒填，額度會照這個名字建起來，記得回客戶詳情頁改成實際的等級');
    }

    if (actual != null && actual !== checks) {
      problem(`第 ${item.row} 列`, item.label,
        `E 欄的實際次數是 ${actual}，但勾起來的日期有 ${checks} 個。以勾選為準（次數的真相是來訪）`);
    }

    // 勾得比買的還多。照樣匯進去（app 不擋，ADR-0002），但資料健檢會把它列成額度超用，
    // 所以先在這裡講一次，免得匯完之後才在別的頁面看到一個沒頭沒尾的紅字。
    if (checks > qty) {
      problem(`第 ${item.row} 列`, item.label,
        `勾了 ${checks} 次但總次數只有 ${qty}，匯進去之後資料健檢會列成額度超用`);
    }

    if (isPool && !poolEquipmentIds.length) {
      problem(`第 ${item.row} 列`, item.label, shape?.only
        ? `主檔裡沒有「${shape.only}」這台器材，這一列建不起來`
        : '主檔裡一台器材都沒有，擇一池建不起來');
      continue;
    }

    const key = keyOf(item.row);
    const durationMin = shape?.durationMin ?? null;
    entitlements.push({
      key,
      productName: null,
      productId: null,
      doc: isPool
        ? entitlementDoc({ label: item.label, course, totalQty: qty, stamp, poolEquipmentIds, durationMin })
        : entitlementDoc({ label: item.label, course, totalQty: qty, stamp, durationMin }),
    });
    byRow.set(item.row, { keys: [key], course, kind: isPool ? 'pool' : 'single', shape });
  }

  // 健檢配二返。舊表的 C 欄只有 11 個固定療程列，二返不在裡面（它是第 13 列的
  // 一句自由文字），所以匯進來的客戶身上不會有二返額度 —— 而她行事曆上記了十筆
  // 左右的二返，沒有額度可扣就補不進來。見 GitHub issue #15 與 ADR-0022。
  //
  // 不歸任何一列管，所以不進 byRow：報告上那張逐列對帳表講的是舊表的每一列
  // 讀出了什麼，而二返在舊表上沒有列。
  // ---------- 購買日、方案、驗證 ----------
  //
  // 第 2–8 列（會乘套數的那七列）是方案的就帶方案名、套數與「方案本來幾次」，
  // 其餘是加購。**totalQty 照舊是 D 欄** —— 跟範本不一樣就是微調過（`isTweaked()` 看得出來）。
  const planKeys = new Set();
  if (legacy.template) {
    for (const [label, base] of Object.entries(legacy.template.rows)) {
      const item = parsed.items.find((i) => i.label === label);
      const made = item ? byRow.get(item.row) : null;
      for (const key of made?.keys ?? []) {
        const e = entitlements.find((x) => x.key === key);
        if (!e) continue;
        planKeys.add(key);
        e.doc.sourcePlanName = legacy.template.name;
        e.doc.sourcePlanSets = legacy.sets;
        e.doc.sourcePlanQty = base * legacy.sets;
        if (e.doc.totalQty !== base * legacy.sets) {
          purchaseProblems.push(`第 ${item.row} 列 ${label}：方案本來 ${base * legacy.sets} 次，這裡寫 ${e.doc.totalQty} 次（微調過）`);
        }
      }
    }
  }
  for (const e of entitlements) {
    e.doc.purchasedAt = purchase.date;
    e.doc.purchaseKey = planKeys.has(e.key) ? 'plan' : 'extras';
  }

  // 健檢：B2 寫的金額要在第 9 列那一格找得到
  const examRows = parsed.items.filter((i) => i.label.includes(CHECKUP_WORD) && (toQty(i.expected) ?? 0) > 0);
  const tierOf = (label) => label.match(/(\d+(?:\.\d+)?)\s*萬/)?.[1] ?? null;
  const mentioned = new Set();
  for (const tier of purchase.exams) {
    const row = examRows.find((i) => `${tierOf(i.label)}萬` === tier);
    if (row) mentioned.add(row.row);
    else {
      purchaseProblems.push(examRows.length
        ? `購買名稱寫了 ${tier}健檢，但健檢那一列是「${examRows.map((i) => i.label).join('、')}」`
        : `購買名稱寫了 ${tier}健檢，但沒有任何一列健檢有應有次數`);
    }
  }

  // 寫在字裡的加購：要找得到次數一樣、名字對得上的那一列
  const planRows = new Set(parsed.items
    .filter((i) => [...(byRow.get(i.row)?.keys ?? [])].some((k) => planKeys.has(k)))
    .map((i) => i.row));
  const settled = new Set();
  for (const extra of purchase.extras) {
    const want = looseName(extra.text);
    const row = parsed.items.find((i) => !planRows.has(i.row)
      && toQty(i.expected) === extra.qty
      && (looseName(i.label).includes(want) || want.includes(looseName(i.label))));
    if (!row) {
      purchaseProblems.push(`購買名稱寫了 ${extra.text}x${extra.qty}，但找不到應有次數 ${extra.qty} 的那一列`);
      continue;
    }
    mentioned.add(row.row);
    // B2 字裡寫了幾選一、那一列沒寫：照 B2 組池（`復能四選一(30)x10` 對 `復能(30min)`，2026-09-14）
    const made = byRow.get(row.row);
    const set = /四選一/.test(extra.text) ? 'all' : /三選一/.test(extra.text) ? 'home' : null;
    if (made?.kind === 'pool' && set && !made.shape?.set && !made.shape?.only) {
      const ids = poolIdsFor({ set }, made.course, { equipment, courses });
      for (const e of entitlements.filter((x) => made.keys.includes(x.key))) e.doc.optionEquipmentIds = ids;
      settled.add(row.row);
    }
  }

  // 寫了「任選」卻沒寫幾選一、B2 也沒講的：先照三選一，但要講（她 2026-09-15：之後個別問）
  for (const item of undecided.filter((x) => !settled.has(x.row))) {
    purchaseProblems.push(`「${item.label}」沒寫是三選一還是四選一，先照三選一匯（還沒定，之後再問她）`);
  }

  // D 欄有次數、B2 一個字都沒提 —— 只是提醒（應有次數才是建進去的東西）
  for (const item of parsed.items) {
    if (planRows.has(item.row) || mentioned.has(item.row)) continue;
    if (isProductRow(item.label)) continue;
    const qty = toQty(item.expected) ?? 0;
    if (qty > 0 && parsed.source) {
      purchaseProblems.push(`「${item.label}」應有 ${qty} 次，購買名稱沒提到（照應有次數匯，只是提醒）`);
    }
  }

  const paired = followupPlanEntries(entitlements, courses, { importedFrom: stamp });
  entitlements.push(...paired);

  // ---------- 來訪 ----------

  const visits = [];
  const assumedYears = new Set();
  /** 第幾列的勾選變成了幾個時段。報告要拿它跟舊表的數字並排。 */
  const importedByRow = new Map();
  /** 第 14 列（或第 13 列）的簡寫被營養點滴那一段拿去用過的日期欄 */
  const usedShorthandCols = new Set();

  // 先一欄一欄讀出「這一欄是哪一天、勾了哪幾列」，再依日期歸戶。
  //
  // 同一天出現在兩個相鄰欄位是有的（格子不夠寫就再開一欄）。一欄一筆來訪會讓
  // 那天長出兩筆，但 CONTEXT.md 的來訪是「客戶某一天到院一次，含 2–3 個連續
  // 時段」—— 分成兩筆就等於說她那天來了兩趟，而舊表根本沒說這件事。
  /** @type {Map<string, {raw: string[], cols: {col: number, raw: string, items: object[]}[]}>} */
  const byDate = new Map();

  for (const { col, raw } of parsed.dateColumns) {
    const { date, hadYear } = parseSheetDate(raw, year);
    const checkedRows = parsed.items.filter((item) => {
      const hit = item.checks.find((c) => c.col === col);
      const state = readCheckbox(hit?.value);
      if (state === null && normalize(hit?.value)) {
        problem(`第 ${item.row} 列 ${raw}`, hit.value, '這一格看不懂，沒有當成勾選');
      }
      return state === true;
    });

    if (!date) {
      if (checkedRows.length) problem('表頭', raw, `讀不出日期，這一欄的 ${checkedRows.length} 個勾選沒有匯入`);
      continue;
    }
    if (!hadYear) assumedYears.add(raw);
    if (!checkedRows.length) continue;

    const group = byDate.get(date) ?? { raw: [], cols: [] };
    group.raw.push(raw);
    group.cols.push({ col, raw, items: checkedRows });
    byDate.set(date, group);
  }

  for (const [date, group] of [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (group.cols.length > 1) {
      problem('表頭', group.raw.join('、'),
        `同一天有 ${group.cols.length} 欄，已經合併成一筆來訪。`
        + '舊表沒有記時間，看不出這是一天來兩趟還是格子不夠寫');
    }

    const slots = [];
    const checks = group.cols.flatMap(
      ({ col, raw, items }) => items.map((item) => ({ col, raw, item })),
    );

    for (const { col, raw, item } of checks) {
      const made = byRow.get(item.row);
      if (!made) {
        if (!deliberate.has(item.row)) {
          problem(`第 ${item.row} 列 ${raw}`, item.label, '這一列沒有建出額度，這一格的勾選沒有匯入');
        }
        continue;
      }

      let entitlementKey = made.keys[0];
      let ivProductId = null;

      if (made.kind === 'iv') {
        const shorthand = parsed.ivShorthand[col] ?? '';
        usedShorthandCols.add(col);
        const picked = pickIvEntitlement(shorthand, entitlements, made.keys);
        if (!picked) {
          problem(`第 ${item.row} 列 ${raw}`, shorthand,
            shorthand
              ? '這個簡寫對不到任何一個品項，不知道要扣哪一份額度，這一天沒有匯入'
              : '沒有寫當天用了哪個品項，不知道要扣哪一份額度，這一天沒有匯入');
          continue;
        }
        entitlementKey = picked.key;
        // 合計的那一筆額度身上沒有品項（B 欄沒寫明細），但那一天的簡寫還是講得出是哪一款
        ivProductId = picked.productId ?? (shorthand
          ? ivProducts.find((x) => !x.deletedAt && normalize(x.name).startsWith(expandIv(shorthand)))?.id ?? null
          : null);
        // 品項留空有兩種：B 欄根本沒寫明細（退回一筆合計額度，上面已經講過了），
        // 以及寫了但主檔裡沒有。只有後者要在每一天再提醒一次。
        if (!picked.productId && picked.productName) {
          problem(`第 ${item.row} 列 ${raw}`, picked.productName,
            '主檔裡沒有這個品項，這一次的品項留空');
        }
      }

      importedByRow.set(item.row, (importedByRow.get(item.row) ?? 0) + 1);
      slots.push({
        entitlementKey,
        courseId: made.course.id,
        courseName: made.course.name,
        // 舊表只有日期。時間、器材、診間、治療師一律不詳 ——
        // 見 docs/adr/0011-imported-visits-are-incomplete-on-purpose.md
        equipmentId: null,
        ivProductId,
        startsAt: null,
        endsAt: null,
        roomId: null,
        bed: null,
        therapistId: null,
        attended: true,
      });
    }

    if (!slots.length) continue;

    visits.push({
      customerName: parsed.customerName,
      date,
      // 勾起來就是做過了。舊表沒有「排了但還沒上」這種狀態。
      status: 'done',
      confirmedAt: null,
      cancelledAt: null,
      cancelReason: null,
      released: false,
      slots,
      importedFrom: stamp,
    });
  }

  if (assumedYears.size) {
    problem('表頭', [...assumedYears].join('、'),
      `這些日期沒有寫年份，一律當成 ${year} 年。年份錯了整批來訪就會掉到別的地方`);
  }

  // 第 14 列寫了字、那天卻沒有營養點滴拿去用（「EECP體驗」）→ 那是一句註記，不是品項
  for (const [col, text] of Object.entries(parsed.ivShorthand)) {
    if (usedShorthandCols.has(Number(col))) continue;
    const raw = parsed.dateColumns.find((d) => d.col === Number(col))?.raw;
    notes.push(`${shortDate(raw)} ${text}`);
  }

  if (parsed.followupNote) notes.push(parsed.followupNote);

  // 一則超過上限的備註先照句子切（她 2026-09-15），切不下去的照原文收，但要講 ——
  // 匯進去之後她一按「編輯」，那一則就存不下去（`validateMarks()`）。
  const marks = marksFrom(notes);
  for (const m of marks) {
    if (m.text.length > MAX_MARK_LENGTH) {
      problem('備註', m.text, `這一則超過 ${MAX_MARK_LENGTH} 個字，匯進去之後編輯時要先拆成幾則才存得下去`);
    }
  }
  if (marks.length > MAX_MARKS) {
    problem('備註', '', `一共 ${marks.length} 則，app 一位客戶最多 ${MAX_MARKS} 則，匯進去之後編輯時要先刪掉幾則`);
  }

  // 警示與合作機構（她 2026-09-07：自動帶；否定句不算）。看的是她寫的字，不是備註裡加工過的字
  const said = [parsed.source, parsed.followupNote, ...parsed.leftovers.map((x) => x.text)];

  return {
    sheetName: parsed.sheetName,
    customerName: parsed.customerName,
    source: parsed.source,
    skip: null,
    customer: {
      name: parsed.customerName,
      phone: null,
      lineId: null,
      // 通路（`顧客會`），不是整格原文 —— 原文拆出來讀不懂的那一段已經在備註裡了
      source: purchase.channel,
      purchasedAt: purchase.date,
      membershipExpiresAt: null,
      priority: 0,
      flags: flagsFromText(said, clinicalFlags),
      partners: partnersFromText(said, partners),
      // 原文照抄，一個字都不改寫。**備註是真相，notes 是它的鏡像**（ADR-0019）
      // 寫入的形狀只有 `toCustomerFields()` 一份（marks 與 notes 鏡像同一次算出來）
      ...customerFieldsFrom(marks),
      active: true,
      importedFrom: stamp,
    },
    entitlements,
    visits,
    problems,
    // B2 拿應有次數驗過一次、對不上的那幾條。**合併時要逐條問她**
    purchaseProblems,
    skippedRows,
    leftovers: parsed.leftovers,
    contraindications: contraindicationHints([
      { where: 'B2 購買名稱', text: parsed.source },
      { where: 'A2 姓名欄', text: parsed.customerName },
      { where: '二返註記', text: parsed.followupNote },
      ...parsed.leftovers.map((x) => ({ where: x.cell, text: x.text })),
    ], equipment),
    // 一列一行的對帳：舊表的 D／E／勾選數，跟匯進去的額度與來訪並排。
    // 她要能一眼看完一位客戶，而不是自己回試算表一格一格核對。
    rows: parsed.items.map((item) => {
      const made = byRow.get(item.row);
      const keys = made?.keys ?? [];
      return {
        row: item.row,
        label: item.label,
        expected: toQty(item.expected),
        actual: toQty(item.actual),
        checks: item.checks.filter((c) => readCheckbox(c.value) === true).length,
        qty: keys.length
          ? entitlements.filter((e) => keys.includes(e.key))
            .reduce((n, e) => n + e.doc.totalQty, 0)
          : null,
        // 一列拆成好幾筆額度的只有營養點滴（品項各自計次，不合併）。
        // 表格上那一列只看得到加總，拆成什麼要另外講一次。
        parts: keys.length > 1
          ? entitlements.filter((e) => keys.includes(e.key))
            .map((e) => `${e.productName ?? e.doc.label} ${e.doc.totalQty} 次`)
          : [],
        visits: importedByRow.get(item.row) ?? 0,
      };
    }),
    quantityHint: quantityHint(parsed, plans, courses),
    counts: {
      entitlements: entitlements.length,
      // 舊表上沒有二返這一列，所以這幾筆是系統配出來的，不是讀出來的。
      // 匯入那一頁要分開講一次（`ui/views/mergeImport.js` 的 summaryCard()）。
      followups: paired.length,
      visits: visits.length,
      slots: visits.reduce((n, v) => n + v.slots.length, 0),
    },
  };
}

/**
 * 備註那幾行變成帶顏色的備註。**有「尾款」兩個字的預設紅色**（她 2026-09-13：
 * 「尾款欠多少的預設用紅色的備註」）。顏色只是預設值，不綁任何行為（ADR-0019）。
 *
 * 一格裡的換行拆成好幾則 —— `notes` 是用換行接起來的鏡像，兩邊要講同一件事。
 */
/** `toCustomerFields()` 沒有備註時 notes 是 null；舊表匯入一直寫空字串，下游（試算表、健檢）認的是它。 */
function customerFieldsFrom(marks) {
  const { marks: list, notes } = toCustomerFields(marks);
  return { marks: list, notes: notes ?? '' };
}

function marksFrom(lines) {
  return lines
    .flatMap((line) => String(line ?? '').split('\n'))
    .map((text) => text.trim())
    .filter(Boolean)
    .flatMap(splitLong)
    .map((text) => ({ text, color: text.includes('尾款') ? 'red' : 'grey' }));
}

/**
 * 超過上限的一則照句子切。她 2026-09-15：「照句號、驚嘆號、分號切成幾則」。
 *
 * 太短的碎片（`20?!年。` 被驚嘆號切出來的 `年。`）接回前一則；一句話本身還是太長就照逗號裝箱；
 * 再切不下去就原文照收，由呼叫端在報告上講 —— 讀不懂不是丟掉的理由。**一個字都不改、不砍**。
 */
function splitLong(text) {
  if (text.length <= MAX_MARK_LENGTH) return [text];
  const sentences = [];
  for (const piece of text.split(/(?<=[。！!；;])/)) {
    if (!piece) continue;
    if (sentences.length && piece.trim().length < 4) sentences[sentences.length - 1] += piece;
    else sentences.push(piece);
  }
  return sentences
    .flatMap((s) => (s.length <= MAX_MARK_LENGTH ? [s] : packByComma(s)))
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 照逗號把一句話裝成幾箱，每一箱不超過上限（單一段本身就超過的，那一箱照樣超過）。 */
function packByComma(text) {
  const out = [];
  let box = '';
  for (const seg of text.split(/(?<=[，,、])/)) {
    if (box && (box + seg).length > MAX_MARK_LENGTH) {
      out.push(box);
      box = seg;
    } else box += seg;
  }
  if (box) out.push(box);
  return out;
}

/**
 * 舊表姓名格裡那串數字的名字。
 *
 * 它**就是病歷號** —— 2026-08-24 她確認的。原本寫「姓名欄的編號：」是刻意的
 * 保守（舊表沒有標題，那時候只是我們的推測），現在知道了就叫它的真名。
 * 冒號也拿掉了 ——「病歷號 3157」讀起來就是一件事，不需要標點。
 */
export const CHART_NO_PREFIX = '病歷號 ';

/** 匯入到 2026-08-24 為止寫的說法。資料健檢認得它，才改得掉既有的那幾筆。 */
export const OLD_CHART_NO_PREFIX = '姓名欄的編號：';

/**
 * 姓名格裡除了名字以外的東西。
 *
 * `王小明 (高能/sis)3157` → ['病歷號 3157', '姓名欄的註記：高能/sis']
 */
function nameExtras(name) {
  const text = String(name ?? '');
  const out = (text.match(/\d{3,}/g) ?? []).map((d) => `${CHART_NO_PREFIX}${d}`);
  for (const m of text.matchAll(/[(（]([^)）]*)[)）]/g)) {
    const inner = normalize(m[1]);
    if (inner) out.push(`姓名欄的註記：${inner}`);
  }
  return out;
}

function entitlementDoc({ label, course, totalQty, stamp, poolEquipmentIds = null, durationMin = null }) {
  return {
    type: poolEquipmentIds ? 'pool' : 'single',
    label,
    courseId: poolEquipmentIds ? null : course.id,
    optionEquipmentIds: poolEquipmentIds,
    totalQty,
    // 列名寫了時長（`復能(30分）`、`ILIB 30`）就照它，沒寫才是課程的預設值
    durationMin: durationMin ?? course.durationMin ?? null,
    frequencyRule: course.frequencyRule ?? null,
    // 舊表沒有記是哪個方案展開的，所以沒有快照可寫。null = 單項加購（SPEC 第 5.3 節）
    sourcePlanName: null,
    purchasedAt: null,
    expiresAt: null,
    doneCount: 0,
    bookedCount: 0,
    lastReconciledAt: null,
    importedFrom: stamp,
  };
}

/** 第 14 列的簡寫（`護肝`、`雪`）對到哪一筆品項額度。對到不只一個就當作對不到。 */
function pickIvEntitlement(shorthand, entitlements, keys) {
  const candidates = entitlements.filter((e) => keys.includes(e.key));
  if (!shorthand) return candidates.length === 1 ? candidates[0] : null;

  // 一個字的（肝、雪、腸）先換成全名，其餘照舊靠前綴（護肝、雪顏）
  const wanted = expandIv(shorthand);
  const hits = candidates.filter(
    (e) => e.productName && (e.productName.startsWith(wanted) || wanted.startsWith(e.productName)),
  );
  if (hits.length === 1) return hits[0];
  if (!hits.length && candidates.length === 1) return candidates[0];
  return null;
}

/**
 * 「看起來是 8萬方案 × 3」。**只是報告上的一句話，不進資料。**
 *
 * 舊系統用 Math.round(D2 / 模板D2) 反推購買數量並存成真相，改一下 Inbody 的次數
 * 就整份算錯（docs/legacy/README.md）。這裡不需要那個數字 —— D 欄本來就是乘完的，
 * 直接當 totalQty 就好。所以推不出來也無所謂，報告上少一句話而已。
 */
function quantityHint(parsed, plans, courses = []) {
  for (const plan of plans) {
    if (plan.deletedAt) continue;
    const n = multipleOf(parsed, plan, courses);
    if (n == null) continue;
    return n === 1 ? `看起來是「${plan.name}」` : `看起來是「${plan.name}」 × ${n}`;
  }
  return null;
}

/**
 * 這張表的 D 欄是不是這個範本的整數倍。對不上就回 null，換下一個範本試。
 *
 * **比課程不比名字。** 方案項目的 `label` 是她改得動的顯示字串
 * （「ILIB(60)」「復能三選一(60)」），拿它去對舊表的欄名遲早對不上 ——
 * 而對不上的症狀是報告上少一句話，沒有人會發現它壞了。
 * 名字仍然當退路：舊範本的項目可能沒有 courseId。
 */
function multipleOf(parsed, plan, courses = []) {
  const ratios = [];
  for (const item of plan.items ?? []) {
    const row = parsed.items.find((i) => {
      if (item.type === 'pool') return POOL_LABELS.includes(i.label);
      const wanted = SHEET_COURSE_ALIASES[i.label] ?? i.label;
      const course = resolveCourse(wanted, courses);
      return (item.courseId && course?.id === item.courseId)
        || wanted === item.label || i.label === item.label;
    });
    const base = Number(item.qty) || 0;
    const got = toQty(row?.expected);
    if (!base || got == null) return null;
    ratios.push(got / base);
  }
  if (!ratios.length) return null;
  const n = ratios[0];
  return Number.isInteger(n) && n > 0 && ratios.every((r) => r === n) ? n : null;
}

function emptyPlan(parsed, { skip = null, problems = [] } = {}) {
  return {
    sheetName: parsed.sheetName,
    customerName: parsed.customerName,
    source: parsed.source,
    skip,
    customer: null,
    entitlements: [],
    visits: [],
    problems,
    purchaseProblems: [],
    skippedRows: [],
    leftovers: [],
    contraindications: [],
    rows: [],
    quantityHint: null,
    counts: { entitlements: 0, followups: 0, visits: 0, slots: 0 },
  };
}
