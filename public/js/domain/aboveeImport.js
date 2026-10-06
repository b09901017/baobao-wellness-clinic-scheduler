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
import { courseFrom, roomFrom, staffFrom, staffRoleFor } from './abovee.js';
import { slotFromPicks, visitWithSlot } from './slotDraft.js';
import {
  assignsFor, coursesForEntitlement, isActive, isLiveSlot, lockedAt, shortStatus, slotStatus,
} from './visits.js';
import { counts, isProduct } from './entitlements.js';
import { examChoicesFor, pairsOf } from './followups.js';
import { DOCTOR_ROLE, THERAPIST_ROLE, normalizeAlias, isBedlessOf,
} from './masterData.js';
import { noticeFlags } from './contraindications.js';
import { toMinutes } from './visitTime.js';
import { markInQueue } from './scheduling.js';
import { NTH_PICK, uncountedCourseIdOf, uncountedPick } from './slotOptions.js';
import { MIN_NTH, nthOf } from './nthFollowup.js';
import { slotName } from './naming.js';
import { isValidDate } from './dates.js';

/** 照片上的欄名 → 列上的欄位。只有這十欄（`ABOVEE_COLUMNS`）。 */
export const ABOVEE_KEYS = Object.freeze({
  預約狀態: 'status', 預約日期: 'date', 預約時段: 'time', 姓名: 'name', 病歷號: 'chartNo',
  課程: 'course', 合併扣課: 'merged', 診間: 'room', 服務資源: 'resource', 取消原因: 'cancelReason',
});

/**
 * 右半邊那幾格：左右兩張配對時才從右半補進來。「合併扣課」在 Abovee 上緊跟著課程（左半），
 * 但她拍的那一半切在哪不一定 —— 左半那一格空著、右半有的話照樣補（左半有字的不會被蓋掉）。
 */
const RIGHT_KEYS = ['room', 'resource', 'cancelReason', 'merged'];

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

/** `09:00 - 10:15` → `10:15`。只寫了開始時間就是 null。合併扣課靠它判斷兩列接不接得上。 */
export function aboveeEnd(text) {
  const m = [...clean(text).matchAll(/(\d{1,2})\s*[:：]\s*(\d{2})/g)][1];
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59) return null;
  return `${m[1].padStart(2, '0')}:${m[2]}`;
}

/** 「合併扣課」那一格有沒有勾。Abovee 上寫「是」；抄成勾勾也算。 */
export function mergedMark(text) {
  const s = clean(text);
  if (!s || /否|不|no/i.test(s)) return false;
  return /是|有|勾|✓|✔|☑|^v$|^y|true|^1$/i.test(s);
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

/**
 * 選得出來的只有一個才預選。一層一層收窄，**收窄之後還有剩才算數**：有剩的優先 →
 * 品項跟照片上一樣的優先（同時買了腸道修復與護肝排毒的客戶，照片上寫哪一款就扣哪一筆）→
 * 時長跟照片上一樣的優先（`SIS(30)` 與 `SIS(60)` 是兩筆）。
 */
function obviousEntitlement(choices, course) {
  let pool = choices;
  const narrow = (fn) => {
    const hit = pool.filter(fn);
    if (hit.length) pool = hit;
  };
  narrow((c) => c.remaining > 0);
  if (course?.ivProductId) narrow((c) => c.entitlement.ivProductId === course.ivProductId);
  if (course?.durationMin) narrow((c) => c.entitlement.durationMin === course.durationMin);
  return pool.length === 1 ? pool[0].entitlement : null;
}

/** 二返：接哪一次健檢。只有一次沒被佔走時才預選（壓表那一頁的 `pickExamIfObvious()`）。 */
export function examChoices(customerId, entitlement, ctx) {
  if (!entitlement?.followupForEntitlementId) return [];
  const ents = liveEnts(ctx, customerId);
  const coursesById = Object.fromEntries((ctx.master?.courses ?? []).map((c) => [c.id, c]));
  const pair = pairsOf(ents, coursesById).find((x) => x.followup?.id === entitlement.id);
  return pair ? examChoicesFor(pair, ctx.visitsBy?.[customerId] ?? []) : [];
}

/**
 * 那一天那一個開始時間 app 裡已經有的段。**活著的優先**；沒有活著的才回取消掉的（`live: false`）——
 * 以前只找活著的，app 上取消掉、Abovee 上還掛著的那一段就被當成「新的」（ADR-0116）。
 * 整天取消的那一筆也看。「活著」走既有的兩支（`isActive()` 看整筆、`isLiveSlot()` 看那一段），不另寫一份。
 */
function existingAt(customerId, date, startsAt, ctx) {
  let gone = null;
  for (const visit of ctx.visitsBy?.[customerId] ?? []) {
    if (!visit || visit.deletedAt || visit.date !== date) continue;
    const here = (visit.slots ?? [])
      .map((slot, index) => ({ slot, index, status: slotStatus(visit, slot) }))
      .filter(({ slot }) => slot.startsAt === startsAt);
    const live = isActive(visit) ? here.filter(({ slot }) => isLiveSlot(slot)) : [];
    if (live.length) return { visit, slots: live, live: true };
    if (here.length && !gone) gone = { visit, slots: here, live: false };
  }
  return gone;
}

/**
 * Abovee 那一格（「預約狀態」）講的是哪一種。**只認兩個字**：取消、完成；其餘（確認前往…）都是還掛著。
 * 「確認前往」不拿來比 —— 那是客人跟 Abovee 說的，不是她問過的那一句（ADR-0104 第 3 點）。
 */
export function aboveeState(statusText) {
  const text = clean(statusText);
  if (/取消/.test(text)) return 'cancelled';
  if (/完成/.test(text)) return 'done';
  return 'booked';
}

/**
 * 同一格上 app 那一段跟 Abovee 那一格比一次（ADR-0116）。**只講不改**：回的是這一列是什麼，
 * 不是要改成什麼。回 `null` ＝ 那不是同一段，照新的一段走。
 *
 * **課程不一樣的不算同一段**：Abovee 上 10:00 的 ILIB 取消了、app 上 10:00 是 SIS —— 那是兩段不同的東西。
 * 反過來 app 上 10:00 那一段取消了、Abovee 上同一格是別的課程，照新的一段走，**但不預設打勾**
 *（`resolveItem()` 的 `appCancelledHere`）：可能是她在 Abovee 上換了課程，也可能是課程那一格抄錯了。
 *
 * @param {'cancelled'|'done'|'booked'} aboveeSays `aboveeState()`
 * @param {{live: boolean, slots: object[]}} found `existingAt()`
 * @param {object[]} sameCourse `found.slots` 裡課程（與器材）跟這一列一樣的那幾段
 */
function crossCheck(aboveeSays, found, sameCourse) {
  if (!found.live) {
    if (!sameCourse.length) return null;
    return aboveeSays === 'cancelled' ? { kind: 'recorded' } : { kind: 'mismatch', reason: 'appCancelled' };
  }
  if (!sameCourse.length) return aboveeSays === 'cancelled' ? null : { kind: 'mismatch', reason: 'course' };
  const statuses = sameCourse.map((x) => x.status);
  if (aboveeSays === 'cancelled') return { kind: 'mismatch', reason: 'aboveeCancelled', appStatus: statuses[0] };
  if (aboveeSays === 'done' && !statuses.includes('done')) {
    return statuses.includes('no_show')
      ? { kind: 'mismatch', reason: 'appNoShow', appStatus: 'no_show' }
      : { kind: 'mismatch', reason: 'notClosed', appStatus: statuses[0] };
  }
  return { kind: 'recorded' };
}

/**
 * 「新的」那一列另外要講的一句。現在只有一種：app 上這個時間有一段取消了、課程跟這一列不一樣 ——
 * 可能是她在 Abovee 上換了課程，也可能是課程那一格抄錯了，所以不預設打勾（ADR-0116）。
 */
export function newRowSay(item) {
  if (item?.kind !== 'new') return '';
  // 不默默記成一般的一段（09）：她 10/5「拍照時要有寫說"合併扣課"或是可以多問一句」
  if (item.mergeOrphan) return 'Abovee 上勾了合併扣課，照片上找不到另一半 —— 確定是單獨一段再勾。';
  // 10：Abovee 上改了時間、app 還沒改
  if (item.movedFrom) {
    return `app 上 ${item.movedFrom.startsAt} 有一段 ${item.movedFrom.name} —— 是改了時間的話去日曆改期；確定是另一段再勾。`;
  }
  return item.appCancelledHere
    ? 'app 上這個時間有一段取消了，課程跟這一列不一樣 —— 確定是新的一段再勾。'
    : '';
}

/**
 * 「對不上」那一列要講的那一句。句子在這裡，畫面只畫（`aboveeConfirm.js`）。
 * 狀態的字走 `shortStatus()`（跟日曆同一組），Abovee 那一側照原字印。
 */
export function mismatchSay(item) {
  const app = item?.appStatus ? shortStatus(item.appStatus) : '';
  switch (item?.reason) {
    case 'aboveeCancelled': return `Abovee 上取消了，app 上還是「${app}」。`;
    case 'appCancelled': return `app 上取消了，Abovee 上還在（「${item.statusText}」）—— 回 Abovee 放掉那個時段。`;
    case 'appNoShow': return `Abovee 上是「${item.statusText}」，app 上記「${app}」。`;
    case 'notClosed': return `Abovee 上是「${item.statusText}」，app 上還是「${app}」—— 還沒簽療程單。`;
    default: return 'app 裡已經有一段，但做的不一樣。';
  }
}

/**
 * 認得人之後（或她選了人之後）才算得出來的那幾格：種類、預選的額度／器材／品項／健檢、要不要勾。
 * 她在畫面上換一個人就重算一次。
 */
export function resolveItem(item, customerId, ctx) {
  const next = {
    ...item, customerId: customerId ?? null,
    entitlementId: null, equipmentId: null, ivProductId: null, followupForVisitId: null, existing: null,
    isNth: false, nth: null, uncountedCourseId: null, minutes: null,
    // 照片上別列的時間要整張一起看才算得出來（`flagMoved()`）；換一個人就不是那一位的段了
    movedFrom: null, diffs: null, adopt: false, locked: false,
    // 換一個人重算時，上一位的比對結果不可以留著
    reason: null, appStatus: null, appCancelledHere: false,
  };
  if (!next.customerId) return { ...next, kind: 'unknown', checked: false };

  const at = next.date && next.startsAt ? existingAt(next.customerId, next.date, next.startsAt, ctx) : null;
  if (at) {
    const course = next.course;
    const same = at.slots.filter(({ slot }) => Boolean(course) && slot.courseId === course.courseId
      && (!course.equipmentId || !slot.equipmentId || slot.equipmentId === course.equipmentId));
    // 預約狀態也比一次（ADR-0116）。對不上的那一列**這裡不改**（ADR-0056：改得了來訪的只有日曆）
    const verdict = crossCheck(aboveeState(next.statusText), at, same);
    if (verdict) {
      const out = { ...next, ...verdict, existing: { visitId: at.visit.id, date: at.visit.date }, checked: false };
      // 11：已經記了的那一段，治療師或診間跟 Abovee 不一樣 → 講出來，她按了才改
      return verdict.kind === 'recorded' && at.live ? { ...out, ...aboveeDiffs(next, at.visit, same, ctx) } : out;
    }
    // 課程不一樣、但 app 上這個時間有一段取消了：照新的一段走，**不預設打勾**（見 `crossCheck()`）
    next.appCancelledHere = !at.live;
  }

  const course = next.course;
  // 照片上的分鐘交給 `slotFromPicks()`：只有約的時候選時長的課（二返60）會用到（ADR-0122）
  next.minutes = course?.durationMin ?? null;

  // 「要做什麼」那一排先按好哪一顆。**n返 與不算次數的課在挑額度之前就走自己的路**：`三返` 認出來的
  // 課程是二返那一門，照常去挑額度的話會預選二返那一筆、扣到健檢配的那一次（ADR-0063：n返 不是額度）
  let value = null;
  if (course?.nth) value = NTH_PICK;
  else {
    const choices = entitlementChoices(next.customerId, course, ctx);
    // 不算次數的課（ADR-0121）：身上還有那門課的額度就照舊扣；沒有剩的才不扣
    const left = choices.filter((c) => c.remaining > 0);
    const ent = obviousEntitlement(course?.uncounted ? left : choices, course);
    value = ent?.id ?? (course?.uncounted && !left.length ? uncountedPick(course.courseId) : null);
  }
  // 按好之後那幾排（器材、品項、接哪一次健檢）跟她自己按那一顆走同一支
  Object.assign(next, pickOption(next, value, ctx));

  // 還沒到的勾、已經過的不勾（ADR-0030 的做法）；已取消的不勾；
  // **她自己選的人不自動勾**（認人沒認出這一位 —— 選了才能勾，勾是她勾）
  const future = Boolean(next.date) && next.date >= ctx.today;
  const recognized = item.who?.customer?.id === next.customerId;
  const checked = recognized && !next.cancelled && future && !next.appCancelledHere;
  return { ...next, kind: 'new', checked };
}

/** 這一列在「要做什麼」那一排按著哪一顆（`slotOptionsFor()` 那一排上的值）。 */
export function optionValueOf(item) {
  if (item?.isNth) return NTH_PICK;
  if (item?.uncountedCourseId) return uncountedPick(item.uncountedCourseId);
  return item?.entitlementId ?? null;
}

/**
 * 「要做什麼」那一排按了一顆（`slotOptionsFor()` 的值：額度 id、`NTH_PICK`、`uncountedPick()`）→
 * 這一列變成什麼（abovee-and-master/08）。翻譯時先按好的那一顆（`resolveItem()`）也走這一支 ——
 * 兩條路各寫一份的話，她自己按一次跟翻譯按好的那一列會長得不一樣。
 *
 * 接著那幾排照新的那一顆重設，照片上讀得到的先選好：
 * - 擇一池：照片上那一台在池子裡就選它，池子只有一台就選那一台
 * - 品項：**照片上寫的那一款優先**（營養點滴那一格直接寫品項名），沒寫才是額度上買的那一款
 * - 二返：接哪一次健檢只有一次按得下去才選
 * - n返：返數照照片（`三返` → 3），照片上不是 n返 就預選三返（她 10/5）；
 *   接哪一次健檢**不替她選**（壓表同一條：n返 是她特地要加的一場，替她決定會讓她漏看）
 *
 * 時長（`minutes`）、診間、治療師、醫師是照片上的，不跟著這一排動。
 */
export function pickOption(item, value, ctx) {
  const base = {
    ...item,
    entitlementId: null, isNth: false, nth: null, uncountedCourseId: null,
    equipmentId: null, followupForVisitId: null,
    ivProductId: item.course?.ivProductId ?? null,
  };
  if (value === NTH_PICK) return { ...base, isNth: true, nth: item.course?.nth ?? MIN_NTH };
  const courseId = uncountedCourseIdOf(value);
  if (courseId) return { ...base, uncountedCourseId: courseId };

  const ent = liveEnts(ctx, item.customerId).find((e) => e.id === value) ?? null;
  if (!ent) return base;
  const options = ent.optionEquipmentIds ?? [];
  const wanted = item.course?.equipmentId;
  // 只從按得下去的裡面挑（沒做完的健檢也列出來了，issues/11）
  const exams = examChoices(item.customerId, ent, ctx).filter((x) => x.pickable);
  return {
    ...base,
    entitlementId: ent.id,
    equipmentId: ent.type === 'pool'
      ? (wanted && options.includes(wanted) ? wanted : (options.length === 1 ? options[0] : null))
      : null,
    ivProductId: item.course?.ivProductId ?? ent.ivProductId ?? null,
    followupForVisitId: exams.length === 1 ? exams[0].visitId : null,
  };
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
    // 先認課程、再認人：知道這一列要治療師還是醫師，才不會被另一種人的名字搶走（07）
    const course = courseFrom(row.course, ctx.master);
    const person = staffFrom(row.resource, staff, { role: staffRoleFor(course, ctx.master) });
    const base = {
      key: `a${i}`,
      row,
      photos: row.photos,
      date: aboveeDate(row.date),
      startsAt: aboveeStart(row.time),
      statusText: clean(row.status),
      cancelled: aboveeState(row.status) === 'cancelled',
      who,
      course,
      roomId: roomFrom(row.room, row.resource, rooms)?.id ?? null,
      therapistId: person?.role === THERAPIST_ROLE ? person.id : null,
      doctorId: person?.role === DOCTOR_ROLE ? person.id : null,
      // 服務資源那一格有沒有認出人。她選了人時，認不出來的那個寫法才記住（`aliasWrites()`）
      staffKnown: Boolean(person),
    };
    return resolveItem(base, who.customer?.id ?? null, ctx);
  });

  // 照片上有沒有「合併扣課」那一欄（拍兩張時，有一張有就算）
  const hasColumn = (transcripts ?? []).some((t) => (t?.columns ?? []).some((c) => ABOVEE_KEYS[clean(c)] === 'merged'));
  return { pairing, counts: sizes, items: flagMoved(mergeRows(items, ctx, { hasColumn }), ctx) };
}

// ---------- 治療師、診間跟 Abovee 不一樣（11）----------

/**
 * 已經記了的那一段：治療師或診間跟 Abovee 不一樣（abovee-and-master/11）。她 10/5：
 *
 * > 那一列寫出「app 是 A、Abovee 是 B」，旁邊一顆「改成 Abovee 的」，你按了才改。只改治療師和診間
 *
 * 照片上**認得出**的才比 —— 那一格空著或寫法沒人認得，不比（那不是「不一樣」，是「看不出來」）。
 * 比哪一種照那一段自己要什麼（`assignsFor()`）：復能那一段不比診間、ILIB 那一段不比治療師。
 * 醫師不比（她只說治療師和診間）；時間不一樣是 10 那一條（去日曆改期）。
 *
 * @returns {{diffs?: {field: 'therapistId'|'roomId', app: string|null, abovee: string}[],
 *            existing?: object, locked?: boolean}} 沒有不一樣就是空物件
 */
function aboveeDiffs(item, visit, same, ctx) {
  const hit = same.find(({ slot }) => isLiveSlot(slot));
  if (!hit) return {};
  const { slot, index } = hit;
  const course = (ctx.master?.courses ?? []).find((c) => c.id === slot.courseId);
  const ent = liveEnts(ctx, item.customerId).find((e) => e.id === slot.entitlementId) ?? null;
  const assigns = course ? assignsFor(ent, course, slot.equipmentId) : null;
  const diffs = [];
  if (assigns === 'therapist' && item.therapistId && item.therapistId !== slot.therapistId) {
    diffs.push({ field: 'therapistId', app: slot.therapistId ?? null, abovee: item.therapistId });
  }
  // **Abovee 那一格沒寫床、app 上已經選了床的不算不一樣**（ADR-0127）：`點滴室8` 認成「沒選床位」的點滴8，
  // 而 app 上是點滴8A —— 那只是照片上比較不精確，按「改成 Abovee 的」會把她選好的床弄丟
  const roomOf = (id) => (ctx.master?.rooms ?? []).find((r) => r.id === id) ?? null;
  if (assigns === 'room' && item.roomId && item.roomId !== slot.roomId
      && !isBedlessOf(roomOf(item.roomId), roomOf(slot.roomId))) {
    diffs.push({ field: 'roomId', app: slot.roomId ?? null, abovee: item.roomId });
  }
  if (!diffs.length) return {};
  return {
    diffs,
    existing: { visitId: visit.id, date: visit.date, slotIndex: index, startsAt: slot.startsAt, courseId: slot.courseId },
    // 已完成的鎖著（`lockedAt()` 問那一段）：照樣寫出不一樣，但不給按
    locked: lockedAt(visit, index),
  };
}

/** 「治療師：app 是 A、Abovee 是 B」。名字問主檔；app 上那一格空著就說還沒選。 */
export function diffSay(diff, { staff = [], rooms = [] } = {}) {
  const room = diff?.field === 'roomId';
  const pool = room ? rooms : staff;
  const name = (id) => (pool ?? []).find((x) => x.id === id)?.name ?? '（已刪除）';
  const label = room ? '診間' : '治療師';
  return diff.app
    ? `${label}：app 是 ${name(diff.app)}、Abovee 是 ${name(diff.abovee)}`
    : `${label}：app 上還沒選、Abovee 是 ${name(diff.abovee)}`;
}

/**
 * 「改成 Abovee 的」：她按著的那幾列，把 app 上那一段的治療師／診間換成 Abovee 上的。
 *
 * **只動這兩格**（換診間時順手清掉 `bed` —— 床位 2026-09-08 取消了，舊資料上的 A／B 跟新的診間對不上）；
 * 狀態、時間、記一句一格都不碰，不取消、不重排、不動任何待辦（ADR-0108 本來就把這兩樣當成原地改）。
 *
 * 找那一段：同一天、同一個開始時間、同一個課程、還活著、沒鎖著，**而且那一格還是她看到的那個值** ——
 * 她在別的裝置上剛改過的話不蓋掉，回在 `missed` 裡讓畫面講一句。純函式，呼叫端拿剛讀回來的那一份來套。
 *
 * @returns {{visit: object, missed: object[]}}
 */
export function adoptAbovee(visit, items = []) {
  const slots = [...(visit?.slots ?? [])];
  const missed = [];
  for (const item of items ?? []) {
    const want = item.existing ?? {};
    const at = visit?.date === want.date
      ? slots.findIndex((s) => isLiveSlot(s) && s.startsAt === want.startsAt && s.courseId === want.courseId)
      : -1;
    const current = slots[at];
    if (!current || lockedAt({ ...visit, slots }, at)
      || (item.diffs ?? []).some((d) => (current[d.field] ?? null) !== d.app)) {
      missed.push(item);
      continue;
    }
    const next = { ...current };
    for (const d of item.diffs ?? []) {
      next[d.field] = d.abovee;
      if (d.field === 'roomId') next.bed = null;
    }
    slots[at] = next;
  }
  return { visit: { ...visit, slots }, missed };
}

// ---------- Abovee 改了時間、app 還沒改（10）----------

/**
 * Abovee 上把 10:00 的 SIS 改到 11:00、app 上還沒改：11:00 那一列找不到同一個時間的段，以前當成新的而且
 * 預設打勾 → 那一天兩段都佔次數。現在照舊是新的，但**不預設打勾**、講一句、給一顆去日曆（abovee-and-master/10）；
 * 勾了就是她確定是另一段。改期在 app 裡是取消＋重新排（ADR-0108），會動待辦 —— 這一層不替她做。
 *
 * 不判成「對不上」：`planAbovee()` 只收新的列，判成對不上的話照片只拍到同一天的第二段（真的是另一段）時就記不了。
 */
function flagMoved(items, ctx) {
  const timesOf = (i) => [i.startsAt, ...(i.merged?.parts ?? []).map((p) => p.startsAt)].filter(Boolean);
  return items.map((item) => {
    if (item.kind !== 'new' || item.cancelled || !item.customerId || !item.date || !item.course) return item;
    // 照片上這一位這一天出現過的每一個時間都算「有人對到了」（取消的列也算）—— 先把同一個時間的配完，
    // 再看剩下的：同一天上午、下午各一段 SIS 時兩列各對各的，不會互相搶
    const seen = new Set(items.filter((o) => o.customerId === item.customerId && o.date === item.date).flatMap(timesOf));
    const from = movedSlot(item, seen, ctx);
    return from ? { ...item, movedFrom: from, checked: false } : item;
  });
}

/** app 上那一天還活著、同一個課程（器材對得上、返數一樣）、照片上沒有那個時間的那一段。 */
function movedSlot(item, seen, ctx) {
  const { courseId, equipmentId, nth = null } = item.course;
  for (const visit of ctx.visitsBy?.[item.customerId] ?? []) {
    if (!visit || visit.deletedAt || visit.date !== item.date || !isActive(visit)) continue;
    const slot = (visit.slots ?? []).find((s) => isLiveSlot(s) && s.courseId === courseId
      && (!equipmentId || !s.equipmentId || s.equipmentId === equipmentId)
      && (nthOf(s) ?? null) === nth
      && s.startsAt && !seen.has(s.startsAt));
    if (slot) return { startsAt: slot.startsAt, name: slotName(slot, ctx.master ?? {}, 'short') };
  }
  return null;
}

// ---------- 合併扣課 ----------

/** 這一列在 Abovee 上排了幾分鐘（起訖算的，不是課程那一格的字）。讀不出結束時間就是 null。 */
function rowMinutes(item) {
  const end = aboveeEnd(item?.row?.time);
  return item?.startsAt && end ? toMinutes(end) - toMinutes(item.startsAt) : null;
}

/** 記一句裡那一列叫什麼：器材印別稱（沒有就全名），不是器材的列印課程。 */
function partLabel(item, master = {}) {
  const eq = (master.equipment ?? []).find((e) => e.id === item.course?.equipmentId);
  const course = (master.courses ?? []).find((c) => c.id === item.course?.courseId);
  const name = eq ? (eq.shortName || eq.name) : (course?.shortName || course?.name || clean(item.row?.course));
  const minutes = rowMinutes(item);
  return minutes ? `${name} ${minutes}` : name;
}

/**
 * 照片上**沒有**那一欄時，兩列像不像一對合併扣課：服務資源同一個人、兩列都是擇一池的器材、
 * 對到同一筆額度、那一筆的時長剛好是兩列加起來（60 ＝ 30＋30）。
 * 353 筆裡勾了的那三對都長這樣；兩列各自扣一筆 30 分的就不是。
 */
function looksMerged(a, b, ctx) {
  const who = normalizeAlias(a.row?.resource);
  if (!who || who !== normalizeAlias(b.row?.resource)) return false;
  if (!a.course?.equipmentId || !b.course?.equipmentId) return false;
  if (!a.entitlementId || a.entitlementId !== b.entitlementId) return false;
  const ent = liveEnts(ctx, a.customerId).find((e) => e.id === a.entitlementId);
  const total = (rowMinutes(a) ?? 0) + (rowMinutes(b) ?? 0);
  return ent?.type === 'pool' && Boolean(rowMinutes(a) && rowMinutes(b)) && Number(ent.durationMin) === total;
}

/**
 * 合併扣課（abovee-and-master/09）：Abovee 上兩列半小時、合起來扣一次 60 分。她 10/5：
 *
 * > 我選一段 60 分並且「記一句」自動寫「合併扣課：IN 30＋SIS 30」，試算表也要呈現合併扣課
 *
 * **一對**：兩列都是新的、沒取消、同一位、同一天、前一列的結束＝後一列的開始、**推出來的課程一樣**
 *（四選一含 ILIB，IN＋ILIB 不可以合成一段「IN 60」），而且：照片上有「合併扣課」那一欄就兩列都勾了；
 * 沒有那一欄就要長得像一對（`looksMerged()`）。
 *
 * 一對換成一列：開始時間、器材、治療師、診間照第一列，**用合起來的分鐘重挑額度**（每一半單獨挑會挑到
 * (30) 那一筆），記一句自動寫。`merged.parts` 留著原本那兩列 —— 「拆開成兩段」就換回去。
 *
 * 照片上勾了、旁邊找不到另一半的那一列：`mergeOrphan`，不預設打勾、排進要你看 —— 不默默記成一般的一段。
 */
export function mergeRows(items, ctx, { hasColumn = false } = {}) {
  const pool = (items ?? []).filter((i) => i.kind === 'new' && !i.cancelled && i.customerId && i.date && i.startsAt
    && !i.isNth && !i.uncountedCourseId && i.course)
    .slice()
    .sort((a, b) => `${a.customerId}|${a.date}|${a.startsAt}`.localeCompare(`${b.customerId}|${b.date}|${b.startsAt}`));
  const pairs = new Map();
  const used = new Set();
  for (let k = 0; k + 1 < pool.length; k += 1) {
    const [a, b] = [pool[k], pool[k + 1]];
    if (used.has(a.key) || used.has(b.key)) continue;
    if (a.customerId !== b.customerId || a.date !== b.date) continue;
    if (aboveeEnd(a.row?.time) !== b.startsAt || a.course.courseId !== b.course.courseId) continue;
    const pair = hasColumn ? mergedMark(a.row?.merged) && mergedMark(b.row?.merged) : looksMerged(a, b, ctx);
    if (!pair) continue;
    used.add(a.key);
    used.add(b.key);
    pairs.set(a.key, mergedItem(a, b, ctx));
  }

  return (items ?? []).flatMap((i) => {
    if (pairs.has(i.key)) return [pairs.get(i.key)];
    if (used.has(i.key)) return [];
    if (hasColumn && i.kind === 'new' && !i.cancelled && mergedMark(i.row?.merged)) {
      return [{ ...i, mergeOrphan: true, checked: false }];
    }
    return [i];
  });
}

function mergedItem(a, b, ctx) {
  const [ma, mb] = [rowMinutes(a), rowMinutes(b)];
  const minutes = ma && mb ? ma + mb : null;
  const labels = [partLabel(a, ctx.master), partLabel(b, ctx.master)];
  return resolveItem({
    ...a,
    key: `${a.key}+${b.key}`,
    // 合起來的分鐘去挑額度：客戶同時有 (30) 與 (60) 時扣 (60) 那一筆
    course: { ...a.course, durationMin: minutes ?? a.course.durationMin },
    merged: { parts: [a, b], labels, minutes, note: `合併扣課：${labels.join('＋')}` },
  }, a.customerId, ctx);
}

/** 合併扣課那一列底下那一行：「IN 30＋SIS 30 → 記成一段 60 分、扣一次」。 */
export function mergedLine(item) {
  const m = item?.merged;
  if (!m) return '';
  return `${m.labels.join('＋')} → 記成一段${m.minutes ? ` ${m.minutes} 分` : ''}、扣一次`;
}

/**
 * 合併扣課那一段只記第一台（`equipmentId`）—— 第二台要提醒的事（SIS 的體內金屬）不可以跟著消失
 *（ADR-0074：提醒不擋，但一定要看得到）。回的是要加進那一列提醒的句子。
 */
export function mergedNotices(item, customer, equipment = []) {
  const others = (item?.merged?.parts ?? []).slice(1)
    .map((p) => p.course?.equipmentId)
    .filter((id) => id && id !== item.equipmentId);
  return others
    .map((id) => (equipment ?? []).find((e) => e.id === id))
    .filter(Boolean)
    .map((eq) => ({ eq, reasons: noticeFlags(customer, eq) }))
    .filter((x) => x.reasons.length)
    .map(({ eq, reasons }) => `合併扣課的另一台 ${eq.name} 對「${reasons.join('、')}」要注意`);
}

/**
 * 這一列要不要排進「要你看」：對不上、或認不得人而且有得選（`none` 沒有候選，選不了）。
 * 確認層底下那一組與最上面那個數字都問這一支 —— 各寫一份的時候
 * 抬頭算了已取消的對不上、底下沒排，兩邊差一列。
 *
 * **Abovee 上已取消的：認不得人的不用看，對不上的要看**（ADR-0116）。以前已取消的一律跳過，
 * 於是 Abovee 上取消了、app 上還活著的那一段她看不到。課程不一樣的那種 `crossCheck()` 已經當成新的了，
 * 不會排進來喊。
 */
export const needsAttention = (item) => item?.kind === 'mismatch'
  // 11：真的不一樣（app 上有值、跟 Abovee 不同）才要你看。app 上還沒選的只是可以補 ——
  // 合併檔匯進來的來訪都沒有治療師與診間（ADR-0011），全排進來會把真的要看的淹掉
  || (item?.kind === 'recorded' && (item?.diffs ?? []).some((d) => d.app))
  || (!item?.cancelled && item?.kind === 'new' && Boolean(item?.mergeOrphan || item?.movedFrom))
  || (!item?.cancelled && item?.kind === 'unknown' && item?.who?.how !== 'none');

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
    // 兩邊都取消的那一列不算「已經記了」—— 它是已取消（ADR-0116）
    recorded: count((i) => i.kind === 'recorded' && !i.cancelled),
    attention: count(needsAttention),
    cancelled: count((i) => i.cancelled),
    checked: count((i) => i.checked),
  };
}

/** 一列交給 `slotFromPicks()` 的那一份。 */
export function picksOf(item) {
  return {
    entitlementId: item.isNth ? null : item.entitlementId,
    isNth: Boolean(item.isNth),
    uncountedCourseId: item.uncountedCourseId ?? null,
    equipmentId: item.equipmentId,
    ivProductId: item.ivProductId,
    startsAt: item.startsAt,
    roomId: item.roomId,
    bed: null,
    therapistId: item.therapistId,
    doctorId: item.doctorId,
    nth: item.isNth ? (item.nth ?? null) : null,
    followupForVisitId: item.followupForVisitId,
    minutes: item.minutes ?? null,
    // 合併扣課那一段身上那一句（她 10/5）。記一句是她的欄位，之後改掉也可以
    note: item.merged?.note ?? null,
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
