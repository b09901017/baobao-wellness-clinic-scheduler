// 療程單：照片上的字 → 一張她確認過的療程單（issue 14，ADR-0105）。純函式。
//
// 她 2026-09-17：「我可以在這邊搜尋人名然後看到這個人的診療單…可以先辨識這是誰，
// 然後和之前的比如果是新增的話那就替換掉那張照片，如果是不同的，那就新增照片」。
// （她說的「診療單」在 CONTEXT 叫療程單。）
//
// 療程單是**一位客戶一種課程一張**，客人每做一次簽一列，滿了換下一張（EECP 40 堂是兩張）。
// 她兩三個月拍一次，所以大部分是「同一張多了幾列」，少數是新的一張。
//
// 三件事只寫在這裡：
// 1. **年份怎麼補**（`fillYears()`）：列上的日期常常沒寫年，而考試（ADR-0100）量到列上的年份
//    會被讀成 107、113 —— 所以以表頭為準，離表頭一年以上的列年份不信
// 2. **同一張還是新的一張**（`sameSheet()`）：**不讓 AI 判斷**（ADR-0099，抄字格式裡根本沒有那一格），
//    只比她確認過的課程與前幾列。拿不準的時候一律「新的一張」——
//    「新版」會把舊照片檔真的刪掉（ADR-0101），「新的一張」什麼都不刪
// 3. **簽了、記了對不對得上**（`compareSheet()`，issue 15）：只列不修（ADR-0007、0056）

import { identifyCustomer } from './identify.js';
import { normalizeAlias } from './masterData.js';
import { isValidDate } from './dates.js';
import { EQUIPMENT_ALIASES, FLYER_COURSE_ALIASES } from './photoPlan.js';
import { SHEET_COURSE_ALIASES } from './legacyImport.js';

/** 一張照片最多多大。`storage.rules` 寫同一個數字（測試盯著）。縮圖後通常 300KB 上下。 */
export const MAX_PHOTO_BYTES = 1_572_864;

/** 「同一張」只比前幾列：後面的列是新簽的，而且多比一列就多一次被 AI 讀錯的機會。 */
export const SAME_SHEET_ROWS = 5;

const live = (rows) => (rows ?? []).filter((r) => r && !r.deletedAt && r.active !== false);
const squash = (s) => normalizeAlias(s);
const pad = (n) => String(n).padStart(2, '0');
const uniq = (list) => [...new Set(list)];
const sameSet = (a = [], b = []) => {
  const x = uniq(a ?? []).sort();
  const y = uniq(b ?? []).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};

// ---------- 日期 ----------

/** 民國年（三位數以內）→ 西元；四位數照用。 */
const westernYear = (y) => (y < 1911 ? y + 1911 : y);

/**
 * 列上的一格日期：`7/28`、`115/6/8`、`115.6.8`、`2026-06-08`。
 * 月或日不合理回 null；**日期存不存在（2/30）不在這裡判斷**，補好年份才知道。
 *
 * @returns {{year: number|null, month: number, day: number}|null}
 */
export function parseRowDate(text) {
  const s = String(text ?? '').normalize('NFKC').replace(/\s+/g, '');
  const m = s.match(/^(?:(\d{2,4})[./-])?(\d{1,2})[./-](\d{1,2})$/);
  if (!m) return null;
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year: m[1] ? westernYear(Number(m[1])) : null, month, day };
}

/** 表頭的日期（`115.5.14`）是哪一年（西元）。沒寫年、讀不出來回 null。 */
export function headerYear(headerDate) {
  return parseRowDate(headerDate)?.year ?? null;
}

/** 表頭那一格 → `YYYY-MM-DD`；讀不出來回 null。 */
export function headerISO(headerDate) {
  const p = parseRowDate(headerDate);
  if (!p?.year) return null;
  const iso = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  return isValidDate(iso) ? iso : null;
}

const md = (p) => p.month * 100 + p.day;

/**
 * 每一列補上年份。
 *
 * - **有表頭**：從表頭的年開始往下，日期比上一列早就跨年 +1。列上寫了年、而且是表頭那一年或下一年，就用那一列的
 * - **沒有表頭**：從拍照那一天往回推 —— 最後一列不會晚於拍照那天，往上一列日期比較晚就是前一年
 * - 兩個都沒有、或那一格讀不出來、或那一天不存在（2/30）→ `date: null`，確認時讓她填
 *
 * @param {{date: string}[]} rows 照片上抄的列（`date` 是原字）
 * @param {{headerDate?: string, photoDate?: string}} o
 * @returns {{date: string|null, dateText: string, yearFrom: 'row'|'header'|'photo'|null}[]} 其餘欄位照原樣帶著
 */
export function fillYears(rows = [], { headerDate = '', photoDate = '' } = {}) {
  const parsed = (rows ?? []).map((r) => ({ row: r, p: parseRowDate(r?.date) }));
  const anchor = headerYear(headerDate);
  const photo = isValidDate(photoDate) ? parseRowDate(photoDate) : null;
  const out = parsed.map(({ row }) => ({ ...row, dateText: String(row?.date ?? ''), date: null, yearFrom: null }));
  const put = (i, year, from) => {
    const { p } = parsed[i];
    const iso = `${year}-${pad(p.month)}-${pad(p.day)}`;
    if (isValidDate(iso)) out[i] = { ...out[i], date: iso, yearFrom: from };
  };

  if (anchor) {
    let year = anchor;
    let prev = null;
    parsed.forEach(({ p }, i) => {
      if (!p) return;
      const trusted = p.year && p.year - anchor >= 0 && p.year - anchor <= 1;
      if (trusted) year = p.year;
      else if (prev != null && md(p) < prev) year += 1;
      put(i, year, trusted ? 'row' : 'header');
      prev = md(p);
    });
    return out;
  }

  if (photo) {
    let year = null;
    let next = null;
    for (let i = parsed.length - 1; i >= 0; i -= 1) {
      const { p } = parsed[i];
      if (!p) continue;
      const trusted = p.year && photo.year - p.year >= 0 && photo.year - p.year <= 1;
      if (trusted) year = p.year;
      else if (year == null) year = md(p) <= md(photo) ? photo.year : photo.year - 1;
      else if (next != null && md(p) > next) year -= 1;
      put(i, year, trusted ? 'row' : 'photo');
      next = md(p);
    }
  }
  return out;
}

// ---------- 課程與器材 ----------

/** 名字夠長才拿來比「單子的名字裡有沒有這幾個字」—— `IN`、`IL` 會出現在一堆不相干的字裡。 */
const CONTAINS_MIN = 2;

function courseWords(courses) {
  const words = [];
  for (const c of live(courses)) {
    words.push([c.name, c.id]);
    if (c.shortName && squash(c.shortName).length > CONTAINS_MIN) words.push([c.shortName, c.id]);
  }
  const byName = (name) => live(courses).find((c) => squash(c.name) === squash(name))?.id ?? null;
  for (const [alias, name] of Object.entries({ ...SHEET_COURSE_ALIASES, ...FLYER_COURSE_ALIASES })) {
    const id = byName(name);
    if (id) words.push([alias, id]);
  }
  return words.filter(([w]) => squash(w).length >= CONTAINS_MIN);
}

/** 一串字裡出現了哪幾個；**被更長的那一個包住的不算**（`EECP體驗` 裡的 `EECP`）。 */
function wordsIn(text, words) {
  const t = squash(text);
  const hits = words.filter(([w]) => t.includes(squash(w)));
  return hits.filter(([w, id]) => !hits.some(([o, oid]) => oid !== id && squash(o).length > squash(w).length
    && squash(o).includes(squash(w))));
}

/** 一格器材字（`Indiba`、`超磁場`、`IN`、`高能`）→ 器材。認不出回 null。 */
export function equipmentFrom(text, equipment = []) {
  const s = squash(text);
  if (!s) return null;
  const alias = Object.entries(EQUIPMENT_ALIASES).find(([k]) => squash(k) === s)?.[1] ?? null;
  const want = squash(alias ?? s);
  return live(equipment).find((e) => squash(e.name) === want || (e.shortName && squash(e.shortName) === want)) ?? null;
}

/** 一列勾的、手寫的器材 → 器材 id（照出現的順序，不重複）。 */
export function rowEquipment(row, equipment = []) {
  const words = [
    ...(row?.ticked ?? []),
    ...String(row?.itemText ?? '').split(/[\s/／、,+＋]+/),
  ];
  return uniq(words.map((w) => equipmentFrom(w, equipment)?.id).filter(Boolean));
}

/**
 * 單子的名字、表頭勾的、每一列的器材 → 這一張是哪幾個課程（ADR-0075：器材推得出課程）。
 * 營養點滴的品項也從名字認（一款一張，她的照片上雪顏亮彩與護肝排毒是兩張）。
 * **認不出來就是空的**，讓她選。
 *
 * @returns {{courseIds: string[], ivProductIds: string[]}}
 */
export function sheetCourses(transcript, { courses = [], equipment = [], ivProducts = [] } = {}) {
  const title = [transcript?.title, transcript?.courseText].filter(Boolean).join(' ');
  const fromTitle = wordsIn(title, courseWords(courses)).map(([, id]) => id);
  const eqIds = uniq([
    ...(transcript?.headerTicked ?? []).map((w) => equipmentFrom(w, equipment)?.id),
    ...(transcript?.rows ?? []).flatMap((r) => rowEquipment(r, equipment)),
  ].filter(Boolean));
  const fromEquipment = eqIds
    .map((id) => live(equipment).find((e) => e.id === id)?.courseId)
    .filter((id) => id && live(courses).some((c) => c.id === id));
  const ivProductIds = wordsIn(title, live(ivProducts).map((p) => [p.name, p.id])).map(([, id]) => id);
  return { courseIds: uniq([...fromTitle, ...fromEquipment]), ivProductIds: uniq(ivProductIds) };
}

// ---------- 同一張還是新的一張 ----------

/**
 * `incoming` 是不是 `existing` 的新版（同一張紙多簽了幾列）。
 *
 * 同一位客戶、課程一樣（營養點滴兩邊都有品項時品項也要一樣），而且 incoming 的前 k 列
 * （k = existing 的列數，最多 `SAME_SHEET_ROWS`）日期與勾的器材都一樣。
 * **既有的一列都沒有、新的比既有的還短 → 不是**：拿不準的時候不刪任何東西。
 */
export function sameSheet(existing, incoming) {
  if (!existing || !incoming || existing.deletedAt) return false;
  if (!existing.customerId || existing.customerId !== incoming.customerId) return false;
  if (!(existing.courseIds ?? []).length || !sameSet(existing.courseIds, incoming.courseIds)) return false;
  const [a, b] = [existing.ivProductIds ?? [], incoming.ivProductIds ?? []];
  if (a.length && b.length && !sameSet(a, b)) return false;

  const k = Math.min((existing.rows ?? []).length, SAME_SHEET_ROWS);
  if (k === 0 || (incoming.rows ?? []).length < k) return false;
  for (let i = 0; i < k; i += 1) {
    const x = existing.rows[i];
    const y = incoming.rows[i];
    if (!x?.date || x.date !== y?.date || !sameSet(x.equipmentIds, y.equipmentIds)) return false;
  }
  return true;
}

/** 那一位的療程單裡，`incoming` 是哪一張的新版。沒有就 null。 */
export function matchSheet(incoming, sheets = []) {
  return (sheets ?? []).find((s) => sameSheet(s, incoming)) ?? null;
}

/** 新版比舊的多了幾列（少了是負的）。 */
export function rowsAdded(existing, incoming) {
  return (incoming?.rows ?? []).length - (existing?.rows ?? []).length;
}

// ---------- 照片上的字 → 確認層的草稿 ----------

/**
 * 一張照片的抄字 → 確認卡上的草稿。**只翻譯，不寫**。
 *
 * - 是誰：`identifyCustomer()`（ADR-0103）。`numberOnly`／`conflict`／`ambiguous` 不挑人
 * - 課程：`sheetCourses()`；每一列的器材：`rowEquipment()`
 * - 年份：`fillYears()`（表頭 → 拍照那天）
 * - 是哪一張的新版：`matchSheet()`。`suggested` 是算出來的那一個，`replaces` 是她現在選的（一開始一樣）
 *
 * @param {object} transcript
 * @param {{customers: object[], master: object, sheets: object[], today: string}} ctx
 *   `sheets`：全部客戶的療程單（還沒刪的）
 */
export function readSheet(transcript, { customers = [], master = {}, sheets = [], today = '' } = {}) {
  const who = identifyCustomer({ name: transcript?.customerName, chartNo: transcript?.customerNumber }, customers);
  const { courseIds, ivProductIds } = sheetCourses(transcript, master);
  const rows = fillYears(transcript?.rows ?? [], { headerDate: transcript?.headerDate, photoDate: today })
    .map((r, i) => ({
      seq: String(r.seq ?? '').trim() || String(i + 1),
      date: r.date,
      dateText: r.dateText,
      yearFrom: r.yearFrom,
      signed: r.signed === true,
      equipmentIds: rowEquipment(r, master.equipment),
      seenEquipment: [...(r.ticked ?? []), r.itemText].filter(Boolean).join(' '),
    }));

  const draft = {
    who,
    customerId: who.customer?.id ?? null,
    courseIds,
    ivProductIds,
    courseText: [transcript?.title, transcript?.courseText].filter(Boolean).join(' '),
    headerDate: headerISO(transcript?.headerDate),
    headerText: String(transcript?.headerDate ?? ''),
    seenName: [transcript?.customerName, transcript?.customerNumber].filter(Boolean).join(' '),
    rows,
  };
  return withMatch(draft, sheets);
}

/** 她換了人、課程或改了列之後，重算一次「是哪一張的新版」。她自己選過的保留。 */
export function withMatch(draft, sheets = [], { keepPick = false } = {}) {
  const suggested = draft.customerId
    ? matchSheet(draft, (sheets ?? []).filter((s) => s.customerId === draft.customerId))?.id ?? null
    : null;
  return { ...draft, suggested, replaces: keepPick ? draft.replaces ?? null : suggested };
}

/**
 * 存檔前要擋的。回一串講得出來的話，空的就是可以存。
 * @returns {string[]}
 */
export function validateSheet(draft) {
  const out = [];
  if (!draft?.customerId) out.push('還沒選是哪一位');
  if (!(draft?.courseIds ?? []).length) out.push('還沒選是哪一個課程的療程單');
  for (const [i, r] of (draft?.rows ?? []).entries()) {
    if (!r.date || !isValidDate(r.date)) out.push(`第 ${r.seq || i + 1} 列還沒有日期，補上或拿掉這一列`);
  }
  return out;
}

/**
 * 寫進資料庫的那一份。**只有她確認過的**：沒有照片上的名字、病歷號、原字。
 * 客戶名字與課程名是快照（稽核那一句要講得出是誰的哪一張，同 `slot.courseName`）。
 */
export function sheetFields(draft, { customers = [], master = {} } = {}) {
  return {
    customerId: draft.customerId,
    customerName: (customers ?? []).find((c) => c.id === draft.customerId)?.name ?? '',
    courseIds: uniq(draft.courseIds ?? []),
    ivProductIds: uniq(draft.ivProductIds ?? []),
    courseName: sheetLabel(draft, master),
    courseText: String(draft.courseText ?? ''),
    headerDate: draft.headerDate ?? null,
    rows: (draft.rows ?? []).map((r) => ({
      seq: String(r.seq ?? ''),
      date: r.date,
      signed: r.signed === true,
      equipmentIds: uniq(r.equipmentIds ?? []),
    })),
  };
}

/** `復能・ILIB`、`營養點滴・雪顏亮彩`。認不得的 id 跳過。 */
export function sheetLabel(sheet, { courses = [], ivProducts = [] } = {}) {
  const names = (sheet?.courseIds ?? []).map((id) => (courses ?? []).find((c) => c.id === id)?.name).filter(Boolean);
  const iv = (sheet?.ivProductIds ?? []).map((id) => (ivProducts ?? []).find((p) => p.id === id)?.name).filter(Boolean);
  return [...names, ...iv].join('・');
}

/** 最後一列有簽名的日期（比對只比到這一天，issue 15）。 */
export function lastSignedDate(sheet) {
  const dates = (sheet?.rows ?? []).filter((r) => r.signed && isValidDate(r.date)).map((r) => r.date).sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/** 照片檔的路徑。一次拍照一個檔名，**不覆蓋**（`storage.rules` 不准 update）。 */
export function photoPathFor(customerId, sheetId, takenAtMs) {
  return `treatmentSheets/${customerId}/${sheetId}/${takenAtMs}.jpg`;
}
