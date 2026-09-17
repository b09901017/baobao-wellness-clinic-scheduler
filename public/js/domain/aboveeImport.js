// 拍 Abovee → 一次新增很多來訪（issue 13，ADR-0104）。純函式。
//
// 她 2026-09-17：「拍壓表的電腦畫面（Abovee）→ 一口氣新增很多來訪…可以說辯識到什麼…
// 必須要能夠主次分明一目瞭然」「讓我一次上傳兩張圖片，也接受上傳一張」「直接標成壓完」。
//
// AI 只抄字（`functions/transcripts/aboveeList.js`：九欄、照照片的順序），這一支：
//
// 1. **兩張怎麼對**（`mergeAboveePhotos()`）：Abovee 列表二十幾欄塞不進一個畫面，右半邊沒有姓名、
//    日期、時段 —— 兩張只能照「第幾列」對上，**列數不一樣就不對**
// 2. **每一列分成四種**（`readAbovee()`）：新的、已經記了、對不上、認不得人。
//    認人走 11 的 `identifyCustomer()`，課程／診間／治療師走 12 的 `courseFrom()` 等
// 3. **組成來訪**（`planAbovee()`）：一律走 10 的 `slotFromPicks()`／`visitWithSlot()`
// 4. **直接標成壓完**（`queueMarksAfter()`）
//
// **Abovee 上的預約狀態只照原字留著**（`statusText`）。「確認前往」是客人跟 Abovee 說的，
// 不是她問過的那一句 —— 新段一律 `INITIAL_STATUS`（ADR-0027、0097、0099）。

import { identifyCustomer, normalizeChartNo, normalizeName } from './identify.js';
import { courseFrom, roomFrom, staffFrom } from './abovee.js';
import { slotFromPicks, visitWithSlot } from './slotDraft.js';
import { coursesForEntitlement, isActive, isLiveSlot } from './visits.js';
import { counts, isProduct } from './entitlements.js';
import { examChoicesFor, pairsOf } from './followups.js';
import { DOCTOR_ROLE, THERAPIST_ROLE } from './masterData.js';
import { markInQueue } from './scheduling.js';
import { isValidDate } from './dates.js';

/** 照片上的欄名 → 列上的欄位。只有這九欄（`ABOVEE_COLUMNS`）。 */
export const ABOVEE_KEYS = Object.freeze({
  預約狀態: 'status', 預約日期: 'date', 預約時段: 'time', 姓名: 'name', 病歷號: 'chartNo',
  課程: 'course', 診間: 'room', 服務資源: 'resource', 取消原因: 'cancelReason',
});

/** 右半邊那幾格：左右兩張配對時才從右半補進來。 */
const RIGHT_KEYS = ['room', 'resource', 'cancelReason'];

const clean = (s) => String(s ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim();

// ---------- 讀字 ----------

/** `2026-09-10`、`2026/9/3`、民國 `115/09/10` → ISO。讀不出來回 null。 */
export function aboveeDate(text) {
  const m = clean(text).match(/(\d{2,4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})/);
  if (!m) return null;
  let year = Number(m[1]);
  if (year < 1000) year += 1911;
  const iso = `${year}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  return isValidDate(iso) ? iso : null;
}

/** `09:00 - 10:15` → `09:00`。結束時間不用：長度由 `slotMinutes()` 推（Abovee 的區塊是 75 分）。 */
export function aboveeStart(text) {
  const m = clean(text).match(/(\d{1,2})\s*[:：]\s*(\d{2})/);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

// ---------- 兩張怎麼對 ----------

function tableOf(transcript, photo) {
  const keys = (transcript?.columns ?? []).map((c) => ABOVEE_KEYS[clean(c)] ?? null);
  return {
    photo,
    hasName: keys.includes('name'),
    rows: (transcript?.rows ?? []).map((cells, line) => {
      const row = { photos: [photo], line };
      keys.forEach((key, j) => { if (key) row[key] = clean(cells?.[j]); });
      return row;
    }),
  };
}

const hasWho = (r) => Boolean(clean(r.name) || clean(r.chartNo));

/**
 * @param {object[]} transcripts `aboveeList` 的抄字，照拍的順序（一張或兩張）
 * @returns {{rows: object[], pairing: 'single'|'halves'|'mismatch'|'pages'|'noNames',
 *            counts: {left: number, right: number}|null}}
 *   `halves`：照列的順序對上（畫面上要常駐講出來 —— 它會改變寫進去的東西）；
 *   `mismatch`：列數不一樣，沒配對，右半那幾格空著
 */
export function mergeAboveePhotos(transcripts = []) {
  const tables = (transcripts ?? []).map((t, i) => tableOf(t, i));
  const named = tables.filter((t) => t.hasName);
  const unnamed = tables.filter((t) => !t.hasName && t.rows.length);
  if (!named.length) return { rows: [], pairing: 'noNames', counts: null };

  if (named.length > 1) {
    // 兩頁（或上下兩半）：接起來，同一位同一天同一個開始時間的只留一列
    const byKey = new Map();
    for (const row of named.flatMap((t) => t.rows).filter(hasWho)) {
      const key = [normalizeName(row.name), normalizeChartNo(row.chartNo), aboveeDate(row.date), aboveeStart(row.time)].join('|');
      if (byKey.has(key)) byKey.get(key).photos.push(...row.photos);
      else byKey.set(key, row);
    }
    return { rows: [...byKey.values()], pairing: 'pages', counts: null };
  }

  const [left] = named;
  if (!unnamed.length) return { rows: left.rows.filter(hasWho), pairing: 'single', counts: null };

  const [right] = unnamed;
  const counts = { left: left.rows.length, right: right.rows.length };
  if (counts.left !== counts.right) return { rows: left.rows.filter(hasWho), pairing: 'mismatch', counts };

  const rows = left.rows.map((row, i) => {
    const out = { ...row, photos: [...row.photos, right.photo] };
    for (const key of RIGHT_KEYS) if (!out[key] && right.rows[i][key]) out[key] = right.rows[i][key];
    return out;
  });
  return { rows: rows.filter(hasWho), pairing: 'halves', counts };
}

// ---------- 每一列 ----------

const liveEnts = (ctx, customerId) =>
  (ctx.entitlementsBy?.[customerId] ?? []).filter((e) => e && !e.deletedAt && !isProduct(e));

/**
 * 這一列這位客戶可以扣哪幾筆。擇一池要裝得下那一台（沒有器材就看課程），單一課程比課程。
 * 有剩的排前面；時長跟照片上一樣的優先（`SIS(30)` 與 `SIS(60)` 是兩筆）。
 */
export function entitlementChoices(customerId, course, ctx) {
  if (!customerId || !course) return [];
  const { courses = [], equipment = [] } = ctx.master ?? {};
  const visits = ctx.visitsBy?.[customerId] ?? [];
  return liveEnts(ctx, customerId)
    .filter((e) => (e.type === 'pool'
      ? (course.equipmentId
        ? (e.optionEquipmentIds ?? []).includes(course.equipmentId)
        : coursesForEntitlement(e, courses, equipment).some((c) => c.id === course.courseId))
      : e.courseId === course.courseId))
    .map((e) => ({ entitlement: e, remaining: counts(e, visits, e.id).remaining }))
    .sort((a, b) => (b.remaining > 0) - (a.remaining > 0));
}

/** 選得出來的只有一個才預選（有剩的優先、時長一樣的優先）。 */
function obviousEntitlement(choices, course) {
  const withLeft = choices.filter((c) => c.remaining > 0);
  const pool = withLeft.length ? withLeft : choices;
  if (pool.length === 1) return pool[0].entitlement;
  const sameLength = pool.filter((c) => course?.durationMin && c.entitlement.durationMin === course.durationMin);
  return sameLength.length === 1 ? sameLength[0].entitlement : null;
}

/** 二返：接哪一次健檢。只有一次沒被佔走時才預選（壓表那一頁的 `pickExamIfObvious()`）。 */
export function examChoices(customerId, entitlement, ctx) {
  if (!entitlement?.followupForEntitlementId) return [];
  const ents = liveEnts(ctx, customerId);
  const coursesById = Object.fromEntries((ctx.master?.courses ?? []).map((c) => [c.id, c]));
  const pair = pairsOf(ents, coursesById).find((x) => x.followup?.id === entitlement.id);
  return pair ? examChoicesFor(pair, ctx.visitsBy?.[customerId] ?? []) : [];
}

/** 那一天那一個開始時間 app 裡已經有的段。 */
function existingAt(customerId, date, startsAt, ctx) {
  for (const visit of ctx.visitsBy?.[customerId] ?? []) {
    if (!isActive(visit) || visit.date !== date) continue;
    const slots = (visit.slots ?? []).map((slot, index) => ({ slot, index }))
      .filter(({ slot }) => isLiveSlot(slot) && slot.startsAt === startsAt);
    if (slots.length) return { visit, slots };
  }
  return null;
}

/**
 * 認得人之後（或她選了人之後）才算得出來的那幾格：種類、預選的額度／器材／品項／健檢、要不要勾。
 * 她在畫面上換一個人就重算一次。
 */
export function resolveItem(item, customerId, ctx) {
  const next = {
    ...item, customerId: customerId ?? null,
    entitlementId: null, equipmentId: null, ivProductId: null, followupForVisitId: null, existing: null,
  };
  if (!next.customerId) return { ...next, kind: 'unknown', checked: false };

  const at = next.date && next.startsAt ? existingAt(next.customerId, next.date, next.startsAt, ctx) : null;
  if (at) {
    const course = next.course;
    const same = course && at.slots.some(({ slot }) => slot.courseId === course.courseId
      && (!course.equipmentId || !slot.equipmentId || slot.equipmentId === course.equipmentId));
    next.existing = { visitId: at.visit.id, date: at.visit.date };
    // 對不上的那一列**這裡不改**（ADR-0056：改得了來訪的只有日曆）
    return { ...next, kind: same ? 'recorded' : 'mismatch', checked: false };
  }

  const course = next.course;
  const ent = obviousEntitlement(entitlementChoices(next.customerId, course, ctx), course);
  next.entitlementId = ent?.id ?? null;
  if (ent?.type === 'pool') {
    const options = ent.optionEquipmentIds ?? [];
    next.equipmentId = course?.equipmentId && options.includes(course.equipmentId)
      ? course.equipmentId
      : (options.length === 1 ? options[0] : null);
  }
  const courseRow = (ctx.master?.courses ?? []).find((c) => c.id === course?.courseId);
  if (courseRow?.requiresIvProduct) next.ivProductId = ent?.ivProductId ?? null;
  const open = examChoices(next.customerId, ent, ctx).filter((c) => !c.taken);
  next.followupForVisitId = open.length === 1 ? open[0].visitId : null;

  // 還沒到的勾、已經過的不勾（ADR-0030 的做法）；已取消的不勾；
  // **她自己選的人不自動勾**（認人沒認出這一位 —— 選了才能勾，勾是她勾）
  const future = Boolean(next.date) && next.date >= ctx.today;
  const recognized = item.who?.customer?.id === next.customerId;
  const checked = recognized && !next.cancelled && future;
  return { ...next, kind: 'new', checked };
}

/**
 * 抄字 → 一列一列的「要不要記、記成什麼」。
 *
 * @param {object[]} transcripts
 * @param {{customers, entitlementsBy, visitsBy, master: {courses, equipment, rooms, staff, ivProducts}, today}} ctx
 * @returns {{pairing: string, counts: object|null, items: object[]}}
 */
export function readAbovee(transcripts, ctx) {
  const { rows, pairing, counts: sizes } = mergeAboveePhotos(transcripts);
  const { rooms = [], staff = [] } = ctx.master ?? {};

  const items = rows.map((row, i) => {
    const who = identifyCustomer({ name: row.name, chartNo: row.chartNo }, ctx.customers);
    const person = staffFrom(row.resource, staff);
    const base = {
      key: `a${i}`,
      row,
      photos: row.photos,
      date: aboveeDate(row.date),
      startsAt: aboveeStart(row.time),
      statusText: clean(row.status),
      cancelled: /取消/.test(clean(row.status)),
      who,
      course: courseFrom(row.course, ctx.master),
      roomId: roomFrom(row.room, row.resource, rooms)?.id ?? null,
      therapistId: person?.role === THERAPIST_ROLE ? person.id : null,
      doctorId: person?.role === DOCTOR_ROLE ? person.id : null,
    };
    return resolveItem(base, who.customer?.id ?? null, ctx);
  });

  return { pairing, counts: sizes, items };
}

/**
 * 這一列要不要排進「要你看」：對不上、或認不得人而且有得選（`none` 沒有候選，選不了）。
 * **已取消的一律不用**。確認層底下那一組與最上面那個數字都問這一支 —— 各寫一份的時候
 * 抬頭算了已取消的對不上、底下沒排，兩邊差一列。
 */
export const needsAttention = (item) => !item?.cancelled
  && (item?.kind === 'mismatch' || (item?.kind === 'unknown' && item?.who?.how !== 'none'));

/** 照片上讀得到的每一個日期（`aboveeDate()` 的讀法，排好、不重複）。確認層靠它補讀那幾天的來訪。 */
export function aboveeDatesIn(transcripts = []) {
  const cells = (transcripts ?? []).flatMap((t) => (t?.rows ?? []).flatMap((r) => (Array.isArray(r) ? r : [])));
  return [...new Set(cells.map(aboveeDate).filter(Boolean))].sort();
}

/** 最上面那一行：新的幾段、已經記了幾段、要你看幾段。 */
export function summarizeAbovee(items = []) {
  const count = (fn) => items.filter(fn).length;
  return {
    total: items.length,
    new: count((i) => i.kind === 'new' && !i.cancelled),
    recorded: count((i) => i.kind === 'recorded'),
    attention: count(needsAttention),
    cancelled: count((i) => i.cancelled),
    checked: count((i) => i.checked),
  };
}

/** 一列交給 `slotFromPicks()` 的那一份。 */
export function picksOf(item) {
  return {
    entitlementId: item.entitlementId,
    isNth: false,
    equipmentId: item.equipmentId,
    ivProductId: item.ivProductId,
    startsAt: item.startsAt,
    roomId: item.roomId,
    bed: null,
    therapistId: item.therapistId,
    doctorId: item.doctorId,
    nth: null,
    followupForVisitId: item.followupForVisitId,
    note: null,
  };
}

// ---------- 組成來訪 ----------

/**
 * 勾起來的那幾列 → 一位一天一筆來訪（ADR-0083）。同一天已經有收得下的就併進去。
 *
 * @returns {{groups: {key: string, customerId: string, customerName: string, date: string,
 *                     visit: object, items: object[], reopened: boolean}[],
 *            problems: Record<string, string[]>}}
 *   `problems`：勾了卻組不起來的那幾列（還沒選額度、沒有時間），照列的 key
 */
export function planAbovee(items, ctx) {
  const { courses = [], equipment = [], ivProducts = [] } = ctx.master ?? {};
  const byId = new Map((ctx.customers ?? []).map((c) => [c.id, c]));
  const groups = new Map();
  const problems = {};

  const chosen = (items ?? []).filter((i) => i.checked && i.customerId && i.kind === 'new')
    .slice()
    .sort((a, b) => `${a.customerId}|${a.date}|${a.startsAt}`.localeCompare(`${b.customerId}|${b.date}|${b.startsAt}`));

  for (const item of chosen) {
    const { slot, errors } = slotFromPicks(picksOf(item), {
      courses, equipment, ivProducts,
      entitlements: ctx.entitlementsBy?.[item.customerId] ?? [],
      visits: ctx.visitsBy?.[item.customerId] ?? [],
    });
    if (!item.date) errors.push('讀不出是哪一天');
    if (errors.length || !slot) {
      problems[item.key] = errors;
      continue;
    }

    const key = `${item.customerId}|${item.date}`;
    const customerName = byId.get(item.customerId)?.name ?? '';
    const group = groups.get(key) ?? {
      key, customerId: item.customerId, customerName, date: item.date, visit: null, items: [], reopened: false,
    };
    // 這一組已經組出來的那一筆放進去，下一段才併得進同一天
    const pool = [
      ...(ctx.visitsBy?.[item.customerId] ?? []).filter((v) => !group.visit || v.id !== group.visit.id),
      ...(group.visit ? [group.visit] : []),
    ];
    const { visit, merged } = visitWithSlot({ customerId: item.customerId, customerName }, item.date, slot, pool);
    group.visit = visit;
    group.reopened = group.reopened || Boolean(merged?.reopened);
    group.items.push(item);
    groups.set(key, group);
  }

  return { groups: [...groups.values()], problems };
}

// ---------- 直接標成壓完 ----------

/**
 * 存好的那幾位 → 那幾段落在哪個月、那個月有壓表清單、這位在清單裡 → 標成壓完。
 * **不在清單裡的人不加進去**；已經壓完的不再寫一次。
 *
 * 「壓完」只影響進度條、卡片牆上的小標、「下一位」跳不跳過他 —— 不擋任何事（她 9/17 問過）。
 *
 * @param {{customerId: string, date: string}[]} saved
 * @param {object[]} batches 還開著的壓表清單
 * @returns {{batchId: string, cursor: string|null, customerIds: string[], queue: object[]}[]}
 */
export function queueMarksAfter(saved = [], batches = []) {
  const out = [];
  for (const batch of batches ?? []) {
    const month = batch?.targetMonth;
    if (!month) continue;
    const wanted = [...new Set(saved.filter((s) => String(s.date).startsWith(`${month}-`)).map((s) => s.customerId))];
    const marked = wanted.filter((id) => (batch.queue ?? []).some((q) => q.customerId === id && q.state !== 'done'));
    if (!marked.length) continue;
    let queue = batch.queue;
    for (const id of marked) queue = markInQueue({ queue }, id, 'done');
    out.push({ batchId: batch.id, cursor: batch.cursor ?? null, customerIds: marked, queue });
  }
  return out;
}
