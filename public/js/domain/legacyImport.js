// 舊試算表匯入。純函式，只負責「這張工作表要變成什麼」，不碰 IO。
//
// SPEC 第 6.10 節要求：先 dry-run 產出比對報告 → 人工確認 → 才真的寫入，
// 匯入的資料標 importedFrom。這個檔負責前半段，寫入在 data/legacyImport.js。
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
/** 療程列：第 2–12 列，C 欄療程、D 欄應有次數、E 欄實際次數、B 欄品項明細 */
const FIRST_ITEM_ROW = 1;
const LAST_ITEM_ROW = 11;
const COL_DETAIL = 1;
const COL_LABEL = 2;
const COL_EXPECTED = 3;
const COL_ACTUAL = 4;
/** 第 13 列二返註記、第 14 列當日營養點滴品項簡寫 */
const FOLLOWUP_ROW = 12;
const IV_SHORTHAND_ROW = 13;

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
  'ILIB 60mins': '靜脈',
  ILIB: '靜脈',
  EECP: 'EECP',
  營養點滴: '營養點滴',
});

/** 這一列是擇一池，不是單一課程。舊表寫「復能(1小時)」。 */
const POOL_LABELS = ['復能(1小時)', '復能（1小時）', '復能'];

/** 第 9 列的健檢，名稱裡混著金額等級，例：`0.75萬健檢`、`x萬健檢`（未定）。 */
const CHECKUP_SUFFIX = '健檢';

/** 第 12 列，例：`營養品(12000)`。不佔時段、不排班、不產生額度。 */
const PRODUCT_PREFIX = '營養品';

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

  const dateColumns = [];
  const header = grid[HEADER_ROW] ?? [];
  for (let c = FIRST_DATE_COL; c < header.length; c += 1) {
    const raw = normalize(header[c]);
    if (raw) dateColumns.push({ col: c, raw });
  }

  const items = [];
  for (let r = FIRST_ITEM_ROW; r <= LAST_ITEM_ROW && r < grid.length; r += 1) {
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

  // 第 13、14 列：二返註記與當日品項簡寫。整列收下來，別自作聰明只挑一格。
  const followupCells = (grid[FOLLOWUP_ROW] ?? []).map(normalize).filter(Boolean);
  const ivShorthand = {};
  for (const { col } of dateColumns) {
    const v = cell(IV_SHORTHAND_ROW, col);
    if (v) ivShorthand[col] = v;
  }

  return {
    sheetName,
    customerName: cell(...NAME_CELL),
    source: cell(...SOURCE_CELL),
    dateColumns,
    items,
    followupNote: followupCells.join(' '),
    ivShorthand,
  };
}

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
  existingCustomers = [],
  year = new Date().getFullYear(),
  importedAt = null,
} = {}) {
  const problems = [];
  const notes = [];
  const skippedRows = [];
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

  // ---------- 額度 ----------

  const entitlements = [];
  /** @type {Map<number, {keys: string[], course: object|null, kind: string}>} 列 → 這一列產生了什麼 */
  const byRow = new Map();
  const poolEquipmentIds = equipment.filter((e) => !e.deletedAt).map((e) => e.id);

  for (const item of parsed.items) {
    const checks = item.checks.filter((c) => readCheckbox(c.value) === true).length;
    const expected = toQty(item.expected);
    const actual = toQty(item.actual);

    // 第 12 列的營養品：只記錄與顯示，不佔時段、不排班、不產生額度（CONTEXT.md）
    if (item.label.startsWith(PRODUCT_PREFIX)) {
      const line = [item.label, item.detail].filter(Boolean).join('：');
      notes.push(line);
      if (checks) problem(`第 ${item.row} 列`, item.label, `勾了 ${checks} 次，但營養品不排班，沒有匯入成來訪`);
      continue;
    }

    // 第 11 列的營養點滴：B 欄拆成每個品項各一筆額度（各自計次，不合併）
    if (SHEET_COURSE_ALIASES[item.label] === '營養點滴' || item.label === '營養點滴') {
      const course = resolveCourse(item.label, courses);
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
          doc: entitlementDoc({ label: `營養點滴 - ${p.name}`, course, totalQty: qty, stamp }),
        });
        made.push(key);
      }

      if (!made.length) {
        // B 欄沒有明細（或全部沒次數），退回一筆合計的額度，總比丟掉好
        const qty = expected ?? checks;
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

    // 第 7 列的復能：擇一池，換的是器材不是課程
    const isPool = POOL_LABELS.includes(item.label);
    const course = resolveCourse(isPool ? '復能' : item.label, courses)
      ?? (item.label.endsWith(CHECKUP_SUFFIX) ? resolveCourse(CHECKUP_SUFFIX, courses) : null);

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

    if (isPool && poolEquipmentIds.length < 2) {
      problem(`第 ${item.row} 列`, item.label, '主檔裡的器材不到兩種，擇一池建不起來');
      continue;
    }

    const key = keyOf(item.row);
    entitlements.push({
      key,
      productName: null,
      productId: null,
      doc: isPool
        ? entitlementDoc({ label: item.label, course, totalQty: qty, stamp, poolEquipmentIds })
        : entitlementDoc({ label: item.label, course, totalQty: qty, stamp }),
    });
    byRow.set(item.row, { keys: [key], course, kind: isPool ? 'pool' : 'single' });
  }

  // ---------- 來訪 ----------

  const visits = [];
  const assumedYears = new Set();

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

    const slots = [];
    for (const item of checkedRows) {
      const made = byRow.get(item.row);
      if (!made) {
        problem(`第 ${item.row} 列 ${raw}`, item.label, '這一列沒有建出額度，這一格的勾選沒有匯入');
        continue;
      }

      let entitlementKey = made.keys[0];
      let ivProductId = null;

      if (made.kind === 'iv') {
        const shorthand = parsed.ivShorthand[col] ?? '';
        const picked = pickIvEntitlement(shorthand, entitlements, made.keys);
        if (!picked) {
          problem(`第 ${item.row} 列 ${raw}`, shorthand,
            shorthand
              ? '這個簡寫對不到任何一個品項，不知道要扣哪一份額度，這一天沒有匯入'
              : '沒有寫當天用了哪個品項，不知道要扣哪一份額度，這一天沒有匯入');
          continue;
        }
        entitlementKey = picked.key;
        ivProductId = picked.productId;
        if (!picked.productId) {
          problem(`第 ${item.row} 列 ${raw}`, picked.productName ?? '',
            '主檔裡沒有這個品項，這一次的品項留空');
        }
      }

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

  if (parsed.followupNote) notes.push(parsed.followupNote);

  return {
    sheetName: parsed.sheetName,
    customerName: parsed.customerName,
    source: parsed.source,
    skip: null,
    customer: {
      name: parsed.customerName,
      phone: null,
      lineId: null,
      source: parsed.source || null,
      purchasedAt: null,
      membershipExpiresAt: null,
      priority: 0,
      flags: [],
      // 原文照抄，一個字都不改寫
      notes: notes.join('\n'),
      active: true,
      importedFrom: stamp,
    },
    entitlements,
    visits,
    problems,
    skippedRows,
    quantityHint: quantityHint(parsed, plans),
    counts: {
      entitlements: entitlements.length,
      visits: visits.length,
      slots: visits.reduce((n, v) => n + v.slots.length, 0),
    },
  };
}

function entitlementDoc({ label, course, totalQty, stamp, poolEquipmentIds = null }) {
  return {
    type: poolEquipmentIds ? 'pool' : 'single',
    label,
    courseId: poolEquipmentIds ? null : course.id,
    optionEquipmentIds: poolEquipmentIds,
    totalQty,
    durationMin: course.durationMin ?? null,
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

  const hits = candidates.filter(
    (e) => e.productName && (e.productName.startsWith(shorthand) || shorthand.startsWith(e.productName)),
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
function quantityHint(parsed, plans) {
  for (const plan of plans) {
    if (plan.deletedAt) continue;
    const n = multipleOf(parsed, plan);
    if (n == null) continue;
    return n === 1 ? `看起來是「${plan.name}」` : `看起來是「${plan.name}」 × ${n}`;
  }
  return null;
}

/** 這張表的 D 欄是不是這個範本的整數倍。對不上就回 null，換下一個範本試。 */
function multipleOf(parsed, plan) {
  const ratios = [];
  for (const item of plan.items ?? []) {
    const row = parsed.items.find((i) => {
      const wanted = SHEET_COURSE_ALIASES[i.label] ?? i.label;
      return wanted === item.label || i.label === item.label
        || (POOL_LABELS.includes(i.label) && item.type === 'pool');
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
    skippedRows: [],
    quantityHint: null,
    counts: { entitlements: 0, visits: 0, slots: 0 },
  };
}

// ---------- 比對報告 ----------

/**
 * SPEC 第 6.10 節要的那份 dry-run 報告：會建立幾位客戶、幾筆額度、幾筆來訪，
 * 有哪幾筆解析不了。
 *
 * @param {ReturnType<typeof planForSheet>[]} plans
 */
export function summarize(plans) {
  const willImport = plans.filter((p) => !p.skip);
  return {
    sheets: plans.length,
    customers: willImport.length,
    skipped: plans.filter((p) => p.skip).map((p) => ({
      sheetName: p.sheetName,
      customerName: p.customerName,
      why: p.skip,
    })),
    entitlements: willImport.reduce((n, p) => n + p.counts.entitlements, 0),
    visits: willImport.reduce((n, p) => n + p.counts.visits, 0),
    slots: willImport.reduce((n, p) => n + p.counts.slots, 0),
    problems: plans.reduce((n, p) => n + p.problems.length, 0),
  };
}

/**
 * 比對報告的純文字版。她要在按下「開始匯入」之前把它看完，
 * 也要能存一份下來 —— 匯完之後回頭查「那天到底跳過了什麼」只剩這一份。
 *
 * 排版放在 domain 是為了測得到。報告漏講一件事跟解析錯一樣嚴重：
 * 她是照著這份決定要不要按下去的。
 *
 * @param {ReturnType<typeof planForSheet>[]} plans
 * @param {{generatedAt?: string, year?: number}} [meta]
 */
export function reportText(plans, { generatedAt = '', year = null } = {}) {
  const s = summarize(plans);
  const lines = [
    '舊資料匯入 — 比對報告（dry-run，還沒有寫入任何東西）',
    generatedAt ? `產生時間：${generatedAt}` : '',
    year ? `沒寫年份的日期一律當成：${year} 年` : '',
    '',
    `${s.sheets} 張工作表 → 會建立 ${s.customers} 位客戶、`
      + `${s.entitlements} 筆額度、${s.visits} 筆來訪（${s.slots} 個時段）`,
    `要看一下的地方：${s.problems} 處`,
    '',
  ];

  for (const p of plans) {
    lines.push(`── ${p.customerName || '（沒有名字）'}${p.sheetName ? `｜工作表：${p.sheetName}` : ''}`);
    if (p.skip) {
      lines.push(`   整張跳過：${p.skip}`, '');
      continue;
    }
    if (p.quantityHint) lines.push(`   ${p.quantityHint}`);
    lines.push(`   額度 ${p.counts.entitlements}、來訪 ${p.counts.visits}、時段 ${p.counts.slots}`);
    for (const e of p.entitlements) lines.push(`     · ${e.doc.label} ${e.doc.totalQty} 次`);
    for (const x of p.problems) lines.push(`   ⚠ ${x.where}｜${x.raw}｜${x.why}`);
    for (const x of p.skippedRows) lines.push(`   － 第 ${x.row} 列 ${x.label}：${x.why}`);
    lines.push('');
  }

  return lines.filter((l, i) => l !== '' || lines[i - 1] !== '').join('\n');
}
