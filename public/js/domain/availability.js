// 本輪可用性：她用 LINE 問客戶「下個月哪幾天方便」，把回覆記下來。純函式。
//
// 兩條不能違反的原則（SPEC 第 4.3 節）：
//
// 1. **原文是最終依據。** 解析出來的規則只是為了讓系統算得出「可用日」，
//    原文永遠保留、永遠顯示在旁邊。解析錯了以原文為準。
// 2. **不確定就不要猜。** 看不懂的句子原樣列出來給她看，而不是安靜地丟掉 ——
//    安靜丟掉會讓她以為系統知道，其實不知道。
//
// 規則的形狀照 SPEC 第 5.3 節，多一個選填的 partOfDay：
//   { kind:'exclude_weekday', weekday:1, partOfDay?:'am'|'pm' }
//   { kind:'exclude_date',    date:'2026-09-17', partOfDay?:'am'|'pm' }
//   { kind:'exclude_range',   from:'2026-09-22', to:'2026-09-24' }
//   { kind:'prefer',          weekday:3, partOfDay?:'am'|'pm' }
//
// partOfDay 是為了不丟資訊：「禮拜一下午不行」如果當成整天不行，會蓋掉真的有空的
// 上午；如果直接忽略「下午」，又會推薦一個她不能用的時段。兩種都是錯的，所以記下來。

import { addDays, daysBetween, isValidDate, weekdayOf, shortDate } from './dates.js';

export const RULE_KINDS = ['exclude_weekday', 'exclude_date', 'exclude_range', 'prefer'];

const WEEKDAYS = { 日: 0, 天: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6 };

const PART_LABELS = { am: '上午', pm: '下午' };

const CN_NUMBERS = { 一: 1, 二: 2, 兩: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };

// ---------- 解析 ----------

/**
 * 把她抄下來的原文解析成規則。
 *
 * @param {string} rawText 原文，例：'9月禮拜一不行，9/17、9/18、9/22–24 不行'
 * @param {{year?: number}} [options] 沒寫年份的日期要補哪一年
 * @returns {{rules: object[], unparsed: string[]}} unparsed 是看不懂的句子，要顯示出來
 */
export function parseAvailability(rawText, { year = new Date().getFullYear() } = {}) {
  const rules = [];
  const unparsed = [];

  for (const segment of withInheritedPolarity(segmentsOf(rawText))) {
    const found = segment.polarity ? parseSegment(segment.text, segment.polarity, year) : [];
    if (found.length) rules.push(...found);
    else unparsed.push(segment.text);
  }

  return { rules: dedupe(rules), unparsed };
}

/**
 * 「9/17、9/18、9/22–24 不行」的「不行」在最後一段，前面幾段光禿禿只有日期。
 * 中文常這樣寫，所以往後借語氣。
 *
 * 但只有「整段就只是日期或星期」時才敢借 —— 「禮拜一再確認一次」也沒有語氣詞，
 * 借了就會憑空多出一條「禮拜一不行」。那種寧可列成看不懂，讓她自己看原文。
 */
function withInheritedPolarity(texts) {
  const segments = texts.map((text) => ({ text, polarity: polarityOf(text) }));
  for (let i = segments.length - 2; i >= 0; i -= 1) {
    if (!segments[i].polarity && segments[i + 1].polarity && isBareTokens(segments[i].text)) {
      segments[i].polarity = segments[i + 1].polarity;
    }
  }
  return segments;
}

function isBareTokens(segment) {
  const rest = segment
    .replace(/\d{1,2}\s*\/\s*\d{1,2}/g, '')
    .replace(/(?:星期|禮拜|週|周)[一二三四五六日天]+/g, '')
    .replace(/上午|下午|早上|晚上|傍晚/g, '')
    .replace(/[-–—~～至到]/g, '')
    .replace(/\d+/g, '')
    .replace(/[\s、，,和及與跟]/g, '');
  return rest === '';
}

/** 一句一句處理。頓號、逗號、句號、分號、換行都算句子的邊界。 */
function segmentsOf(rawText) {
  return String(rawText ?? '')
    .split(/[、，,。；;\n\r]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const NEGATIVE = /不行|不可|不能|沒空|沒辦法|不方便|出國|請假|要上班|有事/;
const POSITIVE = /方便|可以|有空|都可|ok|OK/;

/** 講不出是「行」還是「不行」的句子不要猜。例如「再確認一次」那種備註。 */
function polarityOf(segment) {
  if (NEGATIVE.test(segment)) return 'negative';
  if (POSITIVE.test(segment)) return 'positive';
  return null;
}

function parseSegment(segment, polarity, year) {
  const positive = polarity === 'positive';
  const part = partOfDayOf(segment);

  // 有順序：範圍要先吃掉，否則 9/22–24 會被當成兩個單獨日期
  const ranges = rangeRules(segment, year);
  const spans = spanRules(segment, year);
  const weeks = weekRules(segment, year);
  const eaten = [...ranges, ...spans, ...weeks];

  const dates = dateRules(segment, year, eaten);
  const weekdays = weekdayRules(segment, part, positive);

  if (positive) {
    // 「9/17 可以」這種也記成偏好，讓她看得出來系統讀懂了
    return [
      ...weekdays,
      ...dates.map((r) => ({ kind: 'prefer', date: r.date, ...(part ? { partOfDay: part } : {}) })),
    ];
  }

  return [...eaten, ...withPart(dates, part), ...weekdays];
}

function withPart(rules, part) {
  if (!part) return rules;
  return rules.map((r) => ({ ...r, partOfDay: part }));
}

function partOfDayOf(segment) {
  if (/上午|早上|早/.test(segment)) return 'am';
  if (/下午|晚上|傍晚/.test(segment)) return 'pm';
  return null;
}

/** 9/22–24、9/22-9/24、9/22 到 9/24 */
function rangeRules(segment, year) {
  const out = [];
  const re = /(\d{1,2})\s*\/\s*(\d{1,2})\s*[-–—~～至到]\s*(?:(\d{1,2})\s*\/\s*)?(\d{1,2})/g;
  for (const m of segment.matchAll(re)) {
    const from = iso(year, Number(m[1]), Number(m[2]));
    const to = iso(year, Number(m[3] ?? m[1]), Number(m[4]));
    if (from && to && from <= to) out.push({ kind: 'exclude_range', from, to });
  }
  return out;
}

/** 8/18 出國八天 —— 從那天起算 N 天 */
function spanRules(segment, year) {
  const out = [];
  const re = /(\d{1,2})\s*\/\s*(\d{1,2})[^0-9]{0,8}?([0-9一二兩三四五六七八九十]+)\s*天/g;
  for (const m of segment.matchAll(re)) {
    const from = iso(year, Number(m[1]), Number(m[2]));
    const days = numberOf(m[3]);
    if (from && days > 0) out.push({ kind: 'exclude_range', from, to: addDays(from, days - 1) });
  }
  return out;
}

/** 9/6 那星期不行 —— 涵蓋那一天所在的整週（一到日） */
function weekRules(segment, year) {
  const out = [];
  const re = /(\d{1,2})\s*\/\s*(\d{1,2})\s*(?:那|這|整)?\s*(?:整)?(?:星期|禮拜|週)(?![一二三四五六日天])/g;
  for (const m of segment.matchAll(re)) {
    const date = iso(year, Number(m[1]), Number(m[2]));
    if (!date) continue;
    const monday = addDays(date, -((weekdayOf(date) + 6) % 7));
    out.push({ kind: 'exclude_range', from: monday, to: addDays(monday, 6) });
  }
  return out;
}

function dateRules(segment, year, eaten) {
  const out = [];
  for (const m of segment.matchAll(/(\d{1,2})\s*\/\s*(\d{1,2})/g)) {
    const date = iso(year, Number(m[1]), Number(m[2]));
    if (!date) continue;
    // 已經被範圍吃掉的日期不要再記一次
    if (eaten.some((r) => date >= r.from && date <= r.to)) continue;
    out.push({ kind: 'exclude_date', date });
  }
  return out;
}

/**
 * 禮拜一、星期一三、週二四五。
 * 「一三下午方便」這種沒有「禮拜」前綴的，只在同一句有上午／下午時才敢認 ——
 * 不然「12/1 三次」裡的數字也會被當成星期。
 */
function weekdayRules(segment, part, positive) {
  const chars = new Set();

  for (const m of segment.matchAll(/(?:星期|禮拜|週|周)\s*([一二三四五六日天]+)/g)) {
    for (const c of m[1]) chars.add(c);
  }

  if (!chars.size && part) {
    const bare = /^([一二三四五六日天]{1,7})\s*(?:上午|下午|早上|晚上|傍晚|早)/.exec(segment.trim());
    if (bare) for (const c of bare[1]) chars.add(c);
  }

  return [...chars].map((c) => ({
    kind: positive ? 'prefer' : 'exclude_weekday',
    weekday: WEEKDAYS[c],
    ...(part ? { partOfDay: part } : {}),
  }));
}

function numberOf(text) {
  if (/^\d+$/.test(text)) return Number(text);
  if (text === '十') return 10;
  // 十一、二十 這種在這裡用不到，出國兩三週會直接寫日期
  let total = 0;
  for (const c of text) total += CN_NUMBERS[c] ?? 0;
  return total;
}

function iso(year, month, day) {
  const candidate = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidDate(candidate) ? candidate : null;
}

function dedupe(rules) {
  const seen = new Set();
  return rules.filter((r) => {
    const key = JSON.stringify(r);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------- 查詢 ----------

/**
 * 某一天能不能排。
 *
 * @returns {{available: boolean, blockedPart: 'am'|'pm'|null,
 *            preferred: boolean, reasons: string[]}}
 *   available 只有整天被擋掉時才是 false。只擋半天的日子仍然排得進去，
 *   由 blockedPart 告訴 UI 哪半天不行 —— 把半天當整天會蓋掉真的有空的時間。
 */
export function dayStatus(rules, date) {
  const reasons = [];
  let available = true;
  let blockedPart = null;
  let preferred = false;

  for (const rule of rules ?? []) {
    if (!hits(rule, date)) continue;

    if (rule.kind === 'prefer') {
      preferred = true;
      continue;
    }

    reasons.push(describeRule(rule));
    if (rule.partOfDay) blockedPart = blockedPart && blockedPart !== rule.partOfDay ? 'all' : rule.partOfDay;
    else available = false;
  }

  // 上午與下午分別被不同規則擋掉，等於整天不行
  if (blockedPart === 'all') {
    available = false;
    blockedPart = null;
  }

  return { available, blockedPart: available ? blockedPart : null, preferred, reasons };
}

function hits(rule, date) {
  if (rule.kind === 'exclude_date') return rule.date === date;
  if (rule.kind === 'exclude_range') return date >= rule.from && date <= rule.to;
  if (rule.kind === 'exclude_weekday') return weekdayOf(date) === rule.weekday;
  if (rule.kind === 'prefer') {
    if (rule.date) return rule.date === date;
    return weekdayOf(date) === rule.weekday;
  }
  return false;
}

/**
 * 這段期間裡排得進去的日子。壓表模式的「可用日」與排序用的「可用天數」都是這個。
 * 只擋半天的日子算可用 —— 那天真的排得進去，只是要挑時段。
 */
export function availableDates(rules, from, to) {
  if (!isValidDate(from) || !isValidDate(to) || from > to) return [];
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (dayStatus(rules, d).available) out.push(d);
  }
  return out;
}

/** 人話。她要看得懂系統把她的話讀成了什麼，才有辦法發現解析錯了。 */
export function describeRule(rule) {
  const part = rule.partOfDay ? PART_LABELS[rule.partOfDay] : '';

  switch (rule.kind) {
    case 'exclude_weekday':
      return `每個禮拜${weekdayName(rule.weekday)}${part}不行`;
    case 'exclude_date':
      return `${shortDate(rule.date)}${part}不行`;
    case 'exclude_range':
      return `${shortDate(rule.from)} 到 ${shortDate(rule.to)} 不行`;
    case 'prefer':
      return rule.date
        ? `${shortDate(rule.date)}${part}方便`
        : `禮拜${weekdayName(rule.weekday)}${part}方便`;
    default:
      return `看不懂的規則（${rule.kind}）`;
  }
}

function weekdayName(weekday) {
  return ['日', '一', '二', '三', '四', '五', '六'][weekday] ?? '？';
}

// ---------- 有效期 ----------

/**
 * 這份收集現在還算不算數。
 * 過期的要變灰並提示「該重問了」，不是安靜地繼續用（SPEC 第 4.3 節）。
 *
 * @returns {{state:'valid'|'expiring'|'expired'|'upcoming'|'none', days:number|null}}
 *   days 是距離失效還有幾天，已過期就是負的
 */
export function collectionState(record, today) {
  if (!record?.validTo || !isValidDate(record.validTo) || !isValidDate(today)) {
    return { state: 'none', days: null };
  }
  if (record.validFrom && isValidDate(record.validFrom) && today < record.validFrom) {
    return { state: 'upcoming', days: daysBetween(today, record.validFrom) };
  }

  const days = daysBetween(today, record.validTo);
  if (days < 0) return { state: 'expired', days };
  if (days <= 3) return { state: 'expiring', days };
  return { state: 'valid', days };
}

/**
 * 現在該用哪一份。同時有效時取收集日期最新的那份 ——
 * 她重問過就以新的為準。
 */
export function currentCollection(collections, today) {
  return (collections ?? [])
    .filter((c) => !c.deletedAt && collectionState(c, today).state !== 'expired')
    .filter((c) => collectionState(c, today).state !== 'none')
    .sort((a, b) => String(b.collectedAt ?? '').localeCompare(String(a.collectedAt ?? '')))[0] ?? null;
}

/**
 * 涵蓋某一段期間的那一份。**壓表要用的是「那個月問到的」，不是「今天還有效的」。**
 *
 * 兩支的差別是刻意的，因為它們回答的是兩個不同的問題：
 *
 * - `currentCollection()` 問「現在手上有沒有一份還算數的」—— 待辦中心的
 *   「問這輪的時間」與資料健檢用它，那兩個地方講的是此時此刻。
 * - `collectionFor()` 問「這段期間問到了什麼」—— 壓表與時段反查用它，
 *   因為她八月坐下來壓的可能是九月的表，而九月那一份在今天還沒生效。
 *
 * 分不開的代價是實際會發生的錯：八月的表吃到九月那一份，交集是空的，
 * 「可用 0 天」會把一位其實只是還沒問的客戶推到排序的第一位 ——
 * 而那一頁的第一位正是她最信任的那一列。
 *
 * 有交集就算數（不必整段涵蓋），可用日的計算本來就只算交集那幾天。
 * 同時有好幾份時取**交集最多**的那一份，一樣多才比收集日期 ——
 * 「哪一份在講這個月」比「哪一份比較新」更接近她的意思。
 *
 * @param {object[]} collections 這位客戶的全部收集
 * @param {string} from 'YYYY-MM-DD'
 * @param {string} to 'YYYY-MM-DD'
 * @returns {object|null} 沒有任何一份涵蓋到這段期間就是 null（= 這段期間還沒問）
 */
export function collectionFor(collections, from, to) {
  if (!isValidDate(from) || !isValidDate(to) || from > to) return null;

  return (collections ?? [])
    .filter((c) => c && !c.deletedAt && isValidDate(c.validFrom) && isValidDate(c.validTo))
    .filter((c) => c.validFrom <= to && c.validTo >= from)
    .map((c) => ({
      c,
      cover: daysBetween(
        c.validFrom > from ? c.validFrom : from,
        c.validTo < to ? c.validTo : to,
      ) + 1,
    }))
    .sort((a, b) => b.cover - a.cover
      || String(b.c.collectedAt ?? '').localeCompare(String(a.c.collectedAt ?? '')))[0]?.c ?? null;
}

// ---------- 驗證 ----------

/**
 * 手動加的一條規則。
 *
 * 解析器一定會漏 —— 它的正確目標是「常見的認得，其餘老實說看不懂」。
 * 漏掉的時候原本唯一的辦法是把原文改寫成它認得的講法，而那違反 SPEC 第 4.3 節的
 * 「原文照抄、永遠保留」。所以改成**補在 rules 上，原文一個字都不動**。
 *
 * 標上 `manual` 是為了讓「用原文重新解析」認得出它們 —— 重新解析是整份取代，
 * 沒有這個標記，她自己加的那幾條會被無聲蓋掉。
 *
 * @param {{kind: string, weekday?: number|string, date?: string,
 *          from?: string, to?: string, partOfDay?: string}} raw
 * @returns {object|null} 不認得的種類回 null
 */
export function manualRule(raw = {}) {
  const part = raw.partOfDay === 'am' || raw.partOfDay === 'pm' ? { partOfDay: raw.partOfDay } : {};
  const weekday = Number(raw.weekday);
  const base = { manual: true };

  switch (raw.kind) {
    case 'exclude_weekday':
      return { kind: 'exclude_weekday', weekday, ...part, ...base };
    case 'exclude_date':
      return { kind: 'exclude_date', date: raw.date ?? null, ...part, ...base };
    case 'exclude_range':
      return { kind: 'exclude_range', from: raw.from ?? null, to: raw.to ?? null, ...base };
    case 'prefer':
      // 喜好可以綁星期也可以綁某一天。填了日期就以日期為準。
      return raw.date
        ? { kind: 'prefer', date: raw.date, ...part, ...base }
        : { kind: 'prefer', weekday, ...part, ...base };
    default:
      return null;
  }
}

/**
 * 重新解析原文時，手動加的規則要留著。
 *
 * 「用原文重新解析」是整份取代，這很合理 —— 原文才是最終依據。但手動加的那幾條
 * **本來就不在原文的解析結果裡**（那正是她要手動加的原因），整份取代等於每次
 * 重新解析都把它們清掉一次，而且不會有任何訊息。
 *
 * @param {object[]} existing 目前這一份的規則
 * @param {object[]} parsed 剛從原文解析出來的
 */
export function mergeRules(existing = [], parsed = []) {
  return [...parsed, ...existing.filter((r) => r?.manual)];
}

/** 一條規則對不對。validateCollection() 與 UI 的「自己加一條」共用這一份。 */
export function validateRule(rule) {
  if (!RULE_KINDS.includes(rule?.kind)) return ['不認得的種類'];

  const errors = [];
  if (rule.kind === 'exclude_date' && !isValidDate(rule.date)) errors.push('日期不合法');
  if (rule.kind === 'exclude_range') {
    if (!isValidDate(rule.from) || !isValidDate(rule.to)) errors.push('日期不合法');
    else if (rule.to < rule.from) errors.push('結束日不能早於開始日');
  }
  if ((rule.kind === 'exclude_weekday' || (rule.kind === 'prefer' && !rule.date))
      && !(rule.weekday >= 0 && rule.weekday <= 6)) {
    errors.push('星期不合法');
  }
  return errors;
}

export function validateCollection(record) {
  const errors = [];

  if (!String(record?.rawText ?? '').trim()) {
    errors.push('原文不可空白 —— 解析可能出錯，原文才是最終依據');
  }
  if (!isValidDate(record?.collectedAt)) errors.push('收集日期不合法');
  if (!isValidDate(record?.validFrom)) errors.push('有效期起日不合法');
  if (!isValidDate(record?.validTo)) errors.push('有效期迄日不合法');
  if (isValidDate(record?.validFrom) && isValidDate(record?.validTo)
      && record.validTo < record.validFrom) {
    errors.push('有效期的迄日不能早於起日');
  }

  (record?.rules ?? []).forEach((rule, i) => {
    for (const why of validateRule(rule)) errors.push(`第 ${i + 1} 條規則：${why}`);
  });

  return errors;
}

/** 給 UI 的一句話摘要：這份收集大概說了什麼。 */
export function summarize(record, today) {
  const rules = record?.rules ?? [];
  if (!rules.length) return '沒有解析出規則，看原文';

  const from = record.validFrom ?? today;
  const to = record.validTo ?? today;
  const days = availableDates(rules, from, to).length;
  return `${rules.length} 條規則・這段期間可用 ${days} 天`;
}
