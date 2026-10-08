// 拍 Abovee → 一次新增很多來訪（issue 13，ADR-0104）。純函式。
//
// 她 2026-09-17：「拍壓表的電腦畫面（Abovee）→ 一口氣新增很多來訪…可以說辯識到什麼…
// 必須要能夠主次分明一目瞭然」「讓我一次上傳兩張圖片，也接受上傳一張」「直接標成壓完」。
//
// AI 只抄字（`functions/transcripts/aboveeList.js`：九欄、照照片的順序），這一支：
//
// 1. **兩張怎麼對**（`mergeAboveePhotos()`）：Abovee 列表二十幾欄塞不進一個畫面，右半邊沒有姓名、
//    日期、時段 —— 兩張只能照「第幾列」對上，**列數不一樣就不對**。兩張都有姓名（兩頁、同一頁拍兩次）
//    就接起來：**只拿不同張的列比**（`sameRow()`），同一張照片裡的兩列永遠不互相去掉
// 2. **每一列分成四種**（`readAbovee()`）：新的、已經記了、對不上、認不得人。
//    認人走 11 的 `identifyCustomer()`，課程／診間／治療師走 12 的 `courseFrom()` 等。
//    **「已經記了」認得三種形狀**：同一天同一個開始時間（`existingAt()`）、合併扣課的後一半（`claimHalves()`）、
//    合併檔匯進來沒有開始時間的舊段（`claimTimeless()`）
// 3. **組成來訪**（`planAbovee()`）：一律走 10 的 `slotFromPicks()`／`visitWithSlot()`
// 4. **直接標成壓完**（`queueMarksAfter()`）
//
// **Abovee 上的預約狀態只照原字留著**（`statusText`）。「確認前往」是客人跟 Abovee 說的，
// 不是她問過的那一句 —— 新段一律 `INITIAL_STATUS`（ADR-0027、0097、0099）。

import { identifyCustomer, nearNameSay, normalizeChartNo, normalizeName } from './identify.js';
import { courseFrom, roomFrom, staffFrom, staffRoleFor } from './abovee.js';
import { slotFromPicks, visitWithSlot } from './slotDraft.js';
import {
  assignsFor, coursesForEntitlement, equipmentAfterSwitch, isActive, isLiveSlot, lockedAt, mustSee, sameDayState, shortStatus, slotStatus,
} from './visits.js';
import { counts, isProduct } from './entitlements.js';
import { examChoicesFor, pairsOf } from './followups.js';
import { DOCTOR_ROLE, THERAPIST_ROLE, normalizeAlias, isBedlessOf, oneCharOff,
} from './masterData.js';
import { noticeFlags } from './contraindications.js';
import { toMinutes } from './visitTime.js';
import { markInQueue, monthRange } from './scheduling.js';
import { NTH_PICK, uncountedCourseIdOf, uncountedPick } from './slotOptions.js';
import { MIN_NTH, nthOf } from './nthFollowup.js';
import { slotName } from './naming.js';
import { isValidDate, shortDate } from './dates.js';
import { bookingSystemOf } from './taskRules.js';

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

/**
 * 交界上的那三欄：**兩張都有字時取比較長的那一個**（prelaunch-fixes/13）。
 *
 * Abovee 的列表太寬，她拍左右兩張；「診間」剛好在交界，左半張常切到一半。10/5 那次考試 AI 把被切掉的字
 * 照抄成「治療」—— 以前「左半那一格空著才用右半的」，右半完整的「治療室5」就被丟掉；EECP 的服務資源寫的是
 * 機器（EECP1）推不回診間，那幾段存進去沒有診間。
 *
 * 不寫成「右半有字就用右半」：右半從那一欄中間開始拍時，右半那一格只有後半個字，反過來蓋掉左半完整的。
 * **被切掉的一定比完整的短**，取長的兩個方向都對。「合併扣課」不在這裡 —— 它屬於左半，照舊左半有字就不動。
 */
const EDGE_KEYS = ['room', 'resource', 'cancelReason'];

/** 兩張上同一格取哪一個：只有一邊有字就用那一邊；都有字取比較長的；一樣長取 `tie`。 */
function fullerCell(first, second, tie = 'first') {
  if (!first || !second) return first || second || '';
  if (first.length === second.length) return tie === 'second' ? second : first;
  return second.length > first.length ? second : first;
}

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
 * **不同張**照片上的兩列是不是同一列（prelaunch-fixes/10）。兩張都有姓名時（兩頁、同一頁拍了兩次）靠它接。
 *
 * - **是誰**：兩列都有病歷號就比病歷號（AI 抄名字會錯一個字，號碼考試時 10/10 全對），不然比名字
 * - 同一天、同一個開始時間
 * - **課程**與**取消了沒**也要一樣：同一位同一個時間可以有兩門課（ILIB＋復健門診）、可以取消之後在同一格重約 ——
 *   那是兩列。狀態只分取消／沒取消（`aboveeState()`），不比原字
 * - **某一張沒有那一欄（那一格空著）時，那一格不參加比較** —— 不然第二張沒拍到課程欄，每一段都變成兩列
 *
 * 以前的鑰匙是「名字原字＋病歷號＋日期＋開始時間」而且連同一張裡的列一起去重：少記一段（同一格的第二列）、
 * 或同一段記兩次（名字差一個字）。她 5～10 月的 353 筆裡真的有 2 組同一格兩列。
 */
function sameRow(a, b) {
  const [na, nb] = [normalizeChartNo(a.chartNo), normalizeChartNo(b.chartNo)];
  if (na && nb ? na !== nb : normalizeName(a.name) !== normalizeName(b.name)) return false;
  if (aboveeDate(a.date) !== aboveeDate(b.date) || aboveeStart(a.time) !== aboveeStart(b.time)) return false;
  const [ca, cb] = [normalizeAlias(a.course), normalizeAlias(b.course)];
  if (ca && cb && ca !== cb) return false;
  const gone = (r) => aboveeState(r.status) === 'cancelled';
  if (clean(a.status) && clean(b.status) && gone(a) !== gone(b)) return false;
  return true;
}

/**
 * 後一張的列接到前面那幾列上：對得上的**併成一列**（空的那幾格從另一張補 —— 第二張獨有的診間、服務資源不可以不見），
 * 對不上的照原本的順序接在後面（`extra`）。
 *
 * **一列只配一次、只跟前面那幾張的列比**：這一張自己的列是等整張比完才接上去的，所以同一張照片裡的兩列
 * 永遠不互相去掉。`photoSpan()` 數「不重複的列」也走這一支 —— 兩邊數的是同一份列。
 */
function joinPages(base, incoming) {
  const taken = new Set();
  const rows = [...base];
  const extra = [];
  for (const row of incoming) {
    const at = base.findIndex((b, i) => !taken.has(i) && sameRow(b, row));
    if (at < 0) {
      extra.push(row);
      continue;
    }
    taken.add(at);
    const merged = { ...base[at], photos: [...base[at].photos, ...row.photos] };
    for (const key of Object.values(ABOVEE_KEYS)) if (!merged[key] && row[key]) merged[key] = row[key];
    // 交界上那三欄可能有一張切到一半（13）：兩張都有字就取比較長的，一樣長留第一張的
    for (const key of EDGE_KEYS) if (base[at][key] && row[key]) merged[key] = fullerCell(base[at][key], row[key]);
    rows[at] = merged;
  }
  return { rows: [...rows, ...extra], extra };
}

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
    // 兩頁（或上下兩半、同一頁拍了兩次）：接起來，別張上同一列的併成一列（`joinPages()`）
    let rows = named[0].rows.filter(hasWho);
    for (const t of named.slice(1)) ({ rows } = joinPages(rows, t.rows.filter(hasWho)));
    return { rows, pairing: 'pages', counts: null };
  }

  const [left] = named;
  if (!unnamed.length) return { rows: left.rows.filter(hasWho), pairing: 'single', counts: null };

  const [right] = unnamed;
  const counts = { left: left.rows.length, right: right.rows.length };
  if (counts.left !== counts.right) return { rows: left.rows.filter(hasWho), pairing: 'mismatch', counts };

  const rows = left.rows.map((row, i) => {
    const out = { ...row, photos: [...row.photos, right.photo] };
    for (const key of RIGHT_KEYS) if (!out[key] && right.rows[i][key]) out[key] = right.rows[i][key];
    // 交界上那三欄：左半切到一半的不可以蓋掉右半完整的（一樣長取右半 —— 那幾欄本來就在右半）
    for (const key of EDGE_KEYS) {
      if (row[key] && right.rows[i][key]) out[key] = fullerCell(row[key], right.rows[i][key], 'second');
    }
    return out;
  });
  return { rows: rows.filter(hasWho), pairing: 'halves', counts };
}

// ---------- 每一列 ----------

/**
 * 照片上認得的是哪幾位（prelaunch-fixes/09）。確認層打開時替他們**各讀一次全部來訪** ——
 * 算「還剩幾次」、預選、提醒都拿那一份（`ctx.visitsBy[那一位]`）。壓表那一頁手上的只有最近 180 天，
 * 半年前打完的那一筆在那一份裡看起來還有剩。認人跟翻譯同一支（`identifyCustomer()`）。
 */
export function customersOnPhoto(transcripts, customers) {
  const { rows } = mergeAboveePhotos(transcripts);
  const ids = rows.map((row) => identifyCustomer({ name: row.name, chartNo: row.chartNo }, customers).customer?.id);
  return [...new Set(ids.filter(Boolean))];
}

/** 這一位的全部來訪讀不到（`ctx.partial`：確認層記著的那幾位）—— 手上那一份算出來的次數不可信。 */
const historyPartial = (ctx, customerId) => Boolean(customerId) && new Set(ctx.partial ?? []).has(customerId);

/**
 * 「新的」那一列：這一位過去的來訪沒有讀到全部（網路、或那一下讀失敗）。**不安靜地照算** ——
 * 那一列不預設打勾（`resolveItem()`）、講這一句。她在那一列「換一位」再選一次同一位會重讀。
 */
export function partialSay(item) {
  return item?.kind === 'new' && item.partialHistory
    ? '這一位過去的來訪沒有讀到全部，這裡的「剩幾次」與提醒可能不準 —— 確定再勾（「換一位」再選一次他會重讀）。'
    : '';
}

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
 * 認得、但不是一字不差的那幾格（ADR-0128）：病歷號對上而名字差一個字、課程那一格差一個字。
 * 收起來也看得到 —— **不是安靜地當成完全吻合**。名字那一句只在這一列還是認人那一次認的那一位時講
 *（她換了人就不是那一次的事了）。沒有就是空字串。
 */
export function nearSay(item) {
  const out = [];
  const who = nearNameSay(item?.who, item?.row?.name, item?.customerId ?? null);
  if (who) out.push(who);
  const near = item?.course?.near;
  if (near) out.push(`課程那一格照片上是「${near.seen}」，差一個字，認成「${near.as}」—— 不對的話點開選`);
  return out.join('；');
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
    reason: null, appStatus: null, appCancelledHere: false, partialHistory: false,
    // 「看起來跟另一列是同一段」是整張一起看的（`flagRepeats()`）；換了人由 `markRepeat()` 再看一次
    repeatOf: null,
    // 「合併扣課的後一半」「沒有時間的舊段」也是整張一起看才認領的（`asRecorded()`）—— 換了人就不是那一段了，
    // 留著的話這一列又對到別的段時會照講「這是合併扣課的後一半」（2026-10-09 審查）
    halfOf: null, timeless: false,
  };
  if (!next.customerId) return { ...next, kind: 'unknown', checked: false };

  const at = next.date && next.startsAt ? existingAt(next.customerId, next.date, next.startsAt, ctx) : null;
  if (at) {
    const course = next.course;
    const same = at.slots.filter(({ slot }) => Boolean(course) && slot.courseId === course.courseId
      && (!course.equipmentId || !slot.equipmentId || slot.equipmentId === course.equipmentId));
    // 預約狀態也比一次（ADR-0116）。對不上的那一列**這裡不改**（ADR-0056：改得了來訪的只有日曆）
    const verdict = crossCheck(aboveeState(next.statusText), at, same);
    // 10：取消之後在同一格重約 —— 照片上這一格另有一列還掛著（`rebookedHere()`），app 上活著的那一段是那一列的。
    // 取消的這一列不拿去喊「Abovee 上取消了，app 上還是已完成」：照新的、已取消的走（不打勾、不進要你看）。
    // 記著的是「替哪一位看的」—— 她把這一列換成別人就不算了
    const rebooked = verdict?.reason === 'aboveeCancelled' && Boolean(item.rebookedFor) && item.rebookedFor === next.customerId;
    if (verdict && !rebooked) {
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
  // 09：這一位的全部來訪讀不到 → 上面的預選是拿不完整的那一份算的，不替她勾（`partialSay()` 講出來）
  const partialHistory = historyPartial(ctx, next.customerId);
  const checked = recognized && !next.cancelled && future && !next.appCancelledHere && !partialHistory;
  return { ...next, kind: 'new', checked, partialHistory };
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
  const wanted = item.course?.equipmentId;
  // 只從按得下去的裡面挑（沒做完的健檢也列出來了，issues/11）
  const exams = examChoices(item.customerId, ent, ctx).filter((x) => x.pickable);
  return {
    ...base,
    entitlementId: ent.id,
    // 照片上那一台在池子裡就選它，池子只有一台就選那一台（跟來訪編輯器換額度同一支）
    equipmentId: equipmentAfterSwitch(ent, wanted),
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

  const bases = rows.map((row, i) => {
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
    return base;
  });
  // 取消之後在同一格重約要整張一起看才知道（10）—— 先認完每一列是誰、做什麼，才分種類
  const items = bases.map((base) => resolveItem(
    { ...base, rebookedFor: rebookedHere(base, bases) ? base.who.customer.id : null },
    base.who.customer?.id ?? null,
    ctx,
  ));

  // 照片上有沒有「合併扣課」那一欄（拍兩張時，有一張有就算）
  const hasColumn = (transcripts ?? []).some((t) => (t?.columns ?? []).some((c) => ABOVEE_KEYS[clean(c)] === 'merged'));
  // 整張一起看才知道的事，照這個順序：合併扣課的後一半（要趕在 `mergeRows()` 把它標成找不到另一半之前）→
  // 合併扣課 → 沒有時間的舊段（一對先合成一列，才對得到那一段舊的）→ 搬了時間 → 看起來是同一段
  const paired = mergeRows(claimHalves(items, ctx, { hasColumn }), ctx, { hasColumn });
  return { pairing, counts: sizes, items: flagRepeats(flagMoved(claimTimeless(paired, ctx), ctx)) };
}

// ---------- 「已經記了」的另外兩種形狀（prelaunch-fixes/11）----------
//
// `existingAt()` 只認「同一天、同一個開始時間」。app 上存的形狀跟照片上不一樣的那兩種，再拍一次會被當成新的：
//
// - **合併扣課**：app 上是一段（10:30–11:30、記一句「合併扣課：IN 30＋SIS 30」），照片上是兩列。第一列對到那一段，
//   第二列（11:00）找不到同一個開始時間的；`mergeRows()` 又只在「新的」裡找另一半 —— 於是它變成「要你看：
//   照片上找不到另一半，確定是單獨一段再勾」，沒有那一欄的照片更糟：普通的新的一段、預設打勾
// - **合併檔匯進來的舊段沒有開始時間**（行事曆上沒寫的那幾段）：比不到，抬頭寫「新的 1 段」，看起來像 app 漏記了

/** 這一列變成「已經記了」（或對不上）：它不是新的一段了，翻譯時先按好的那幾顆一起拿掉。 */
const asRecorded = (item, existing, extra = {}) => ({
  ...item,
  entitlementId: null, equipmentId: null, ivProductId: null, followupForVisitId: null,
  isNth: false, nth: null, uncountedCourseId: null, minutes: null,
  mergeOrphan: false, movedFrom: null, appCancelledHere: false, partialHistory: false,
  kind: 'recorded', checked: false, existing, ...extra,
});

/** 一列對到的 app 上那一段（同一個開始時間、同一門課、還活著）。 */
function appSlotOf(item, ctx) {
  const visit = (ctx.visitsBy?.[item.customerId] ?? []).find((v) => v?.id === item.existing?.visitId);
  return (visit?.slots ?? []).find((s) => isLiveSlot(s) && s.startsAt === item.startsAt
    && s.courseId === item.course?.courseId) ?? null;
}

const covers = (slot, from, to) => Boolean(slot?.startsAt && slot?.endsAt)
  && toMinutes(slot.startsAt) <= toMinutes(from) && toMinutes(slot.endsAt) >= toMinutes(to);

/**
 * 合併扣課的後一半：前一列對到 app 上的一段、同一位同一天、時間接得上（前一列的結束＝這一列的開始）、同一門課，
 * 而且 **app 上那一段的時間蓋得住這一半**（開始到結束包住它）→ 這一列也是「已經記了」。
 *
 * - 少了「蓋得住」那一條：app 上真的只記了前一半（30 分的一段）時，後一半會被吞掉
 * - 照片上**有**「合併扣課」那一欄時另外要求這一列勾了；**沒有**那一欄時上面那幾條就夠
 * - 前一列是「還沒簽療程單／未到」的對不上也算（那一段在，只是狀態講不一樣 —— 那一句前一列講了，這一列不再喊一次）
 * - 這一列**不給「改成 Abovee 的」**：那一段的治療師／診間由前一列比（`aboveeDiffs()`），兩列各比一次會指到同一段兩次
 */
function claimHalves(items, ctx, { hasColumn = false } = {}) {
  const held = items.filter((a) => !a.cancelled && a.existing && a.course && a.startsAt
    && (a.kind === 'recorded' || (a.kind === 'mismatch' && ['notClosed', 'appNoShow'].includes(a.reason))));
  if (!held.length) return items;
  return items.map((b) => {
    if (b.kind !== 'new' || b.cancelled || !b.customerId || !b.date || !b.startsAt || !b.course) return b;
    if (hasColumn && !mergedMark(b.row?.merged)) return b;
    const end = aboveeEnd(b.row?.time);
    if (!end) return b;
    const first = held.find((a) => a.customerId === b.customerId && a.date === b.date
      && aboveeEnd(a.row?.time) === b.startsAt && a.course.courseId === b.course.courseId
      && covers(appSlotOf(a, ctx), b.startsAt, end));
    return first
      ? asRecorded(b, { visitId: first.existing.visitId, date: first.existing.date }, { halfOf: first.startsAt })
      : b;
  });
}

/**
 * 沒有開始時間的舊段：找不到同一個開始時間時，再找「那一天、同一位、同一門課、**沒有開始時間**、還算數」的段。
 *
 * - **Abovee 上已取消的列不認領** —— 不然拿取消的那一列去對，會喊「Abovee 上取消了，app 上還是已完成」，
 *   而真的那一列反而變成新的
 * - **一段舊的只蓋一列**：同一天同一門課真的做了兩次時，第二列照舊是新的。所以要整張一起看（跟 `flagMoved()` 同一層）
 * - 「同一門課」比的是認出來的課程（`sameCourse()`）：擇一池那一列是器材推出來的課程，舊段上有記器材就要同一台，
 *   沒記（匯入的常常沒有）就只比課程
 * - 預約狀態照樣對一次（`crossCheck()`）：Abovee 寫完成、app 那一段還沒結案 → 對不上
 * - **不給「改成 Abovee 的」**：`adoptAbovee()` 靠開始時間找那一段，這一段沒有；匯入的舊段本來就沒有治療師與診間（ADR-0011）
 */
function claimTimeless(items, ctx) {
  const taken = new Set();
  return items.map((item) => {
    if (item.kind !== 'new' || item.cancelled || !item.customerId || !item.date || !item.course) return item;
    for (const visit of ctx.visitsBy?.[item.customerId] ?? []) {
      if (!visit || visit.deletedAt || visit.date !== item.date || !isActive(visit)) continue;
      const index = (visit.slots ?? []).findIndex((s, i) => isLiveSlot(s) && !s.startsAt && !taken.has(`${visit.id}:${i}`)
        && sameCourse({ courseId: s.courseId, equipmentId: s.equipmentId, nth: nthOf(s) }, item.course));
      if (index < 0) continue;
      taken.add(`${visit.id}:${index}`);
      const hit = { slot: visit.slots[index], index, status: slotStatus(visit, visit.slots[index]) };
      const verdict = crossCheck(aboveeState(item.statusText), { live: true, slots: [hit] }, [hit]);
      return asRecorded(item, { visitId: visit.id, date: visit.date }, { ...verdict, timeless: true });
    }
    return item;
  });
}

/**
 * 「已經記了」那一列點開之後那一句：是哪一種已經記了。句子在 domain（同 `mismatchSay()`、`newRowSay()`）。
 */
export function recordedSay(item) {
  if (item?.kind !== 'recorded') return '';
  if (item.cancelled) return '兩邊都是取消的，不用記。';
  if (item.halfOf) return `這是合併扣課的後一半 —— app 上 ${item.halfOf} 那一段已經包著它，不用再記。`;
  if (item.timeless) return 'app 上這一天已經有這一段了（匯入的舊資料，沒有時間），不用再記。';
  return '這一段 app 裡已經有了，不用再記。';
}

// ---------- 同一格的兩列：重約、看起來是同一段（prelaunch-fixes/10）----------

/** 兩列認出來的是不是同一種東西：同一門課、同一台（有一邊沒寫器材就不比器材）、同一個返數。 */
const sameCourse = (a, b) => Boolean(a && b) && a.courseId === b.courseId
  && (!a.equipmentId || !b.equipmentId || a.equipmentId === b.equipmentId)
  && (a.nth ?? null) === (b.nth ?? null);

/**
 * 這一列是取消的，而照片上**同一位、同一天、同一個開始時間、同一門課另有一列沒取消** ＝ 取消之後在同一格重約。
 * 353 筆裡真的有。兩列都留；`resolveItem()` 看到就不拿取消的那一列去跟 app 上活著的那一段比。
 * 重約的是別的課不算（那是兩件事：一段取消了、同一格另外排了別的）。
 */
function rebookedHere(base, bases) {
  const who = base.who?.customer?.id;
  if (!base.cancelled || !who || !base.date || !base.startsAt) return false;
  return bases.some((o) => o !== base && !o.cancelled && o.who?.customer?.id === who
    && o.date === base.date && o.startsAt === base.startsAt && sameCourse(o.course, base.course));
}

/** 還要她決定記不記的列（新的、認不得人的），而且沒取消、讀得出是哪一天幾點。 */
const undecided = (i) => (i?.kind === 'new' || i?.kind === 'unknown') && !i.cancelled && Boolean(i.date && i.startsAt);

/**
 * 兩列看起來是不是同一段：**在不同張照片上**、同一天同一個開始時間、同一位、同一門課，都沒取消。
 * `sameRow()` 的鑰匙擋不住的那幾種（同一頁拍了兩次，其中一張的名字或病歷號被抄錯）會落到這裡。
 *
 * - 同一張照片裡的兩列不猜 —— Abovee 上真的有兩列（只送一張、左右兩半的每一列都在同一張上，所以永遠不會被標）
 * - 是誰：兩列都認出來就比認出來的那一位；有一列還沒認出來就比照片上的名字（一樣，或差一個字 `oneCharOff()`）
 * - 做什麼：兩列的課程都認出來就比課程、器材、返數、品項；不然比課程那一格的原字
 */
function looksRepeated(a, b) {
  if (!a || !b || a.key === b.key || !undecided(a) || !undecided(b)) return false;
  if ((a.photos ?? []).some((p) => (b.photos ?? []).includes(p))) return false;
  if (a.date !== b.date || a.startsAt !== b.startsAt) return false;
  if (a.customerId && b.customerId) {
    if (a.customerId !== b.customerId) return false;
  } else {
    const [x, y] = [normalizeName(a.row?.name), normalizeName(b.row?.name)];
    if (!x || !y || (x !== y && !oneCharOff(x, y))) return false;
  }
  if (!a.course || !b.course) return normalizeAlias(a.row?.course) === normalizeAlias(b.row?.course);
  return a.course.courseId === b.course.courseId
    && (a.course.equipmentId ?? null) === (b.course.equipmentId ?? null)
    && (a.course.nth ?? null) === (b.course.nth ?? null)
    && (a.course.ivProductId ?? null) === (b.course.ivProductId ?? null);
}

/**
 * 看起來是同一段的那幾列**只留一列先勾好**，其餘不預設打勾、講一句（`repeatSay()`）。
 * 留哪一列：本來就勾著的第一列 → 第一列新的 → 第一列。跟 `flagMoved()` 同一層，整張一起看。
 */
function flagRepeats(items) {
  const repeatOf = new Map();
  const grouped = new Set();
  for (const item of items) {
    if (grouped.has(item.key)) continue;
    const group = items.filter((o) => o.key === item.key || looksRepeated(item, o));
    if (group.length < 2) continue;
    const keeper = group.find((o) => o.kind === 'new' && o.checked) ?? group.find((o) => o.kind === 'new') ?? group[0];
    for (const o of group) {
      grouped.add(o.key);
      if (o !== keeper) repeatOf.set(o.key, keeper.key);
    }
  }
  return items.map((i) => (repeatOf.has(i.key) ? { ...i, repeatOf: repeatOf.get(i.key), checked: false } : i));
}

/**
 * 她替一列換了人之後再看一次那一列（`resolveItem()` 只看得到自己那一列）：跟別張照片上的哪一列看起來是同一段，
 * 就不打勾、講一句 —— 認不得的那一列她選了人，常常正是「同一頁拍了兩次、這一張名字抄錯」的那一列。
 * **只動這一列**：整張重跑的話她剛勾好的別列會被取消。
 */
export function markRepeat(item, items = []) {
  const twin = (items ?? []).find((o) => looksRepeated(item, o));
  return twin ? { ...item, repeatOf: twin.key, checked: false } : { ...item, repeatOf: null };
}

/** 「看起來是同一段」那一句。收起來也看得到（那一列沒有先勾好的理由）。 */
export function repeatSay(item) {
  return item?.repeatOf && undecided(item)
    ? '這一列跟另一張照片上同一個時間的那一列看起來是同一段（同一頁拍了兩次？）—— 確定是另一段再勾。'
    : '';
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

/**
 * 最上面那一行：新的幾段、已經記了幾段、要你看幾段。
 * `absent`（`absentFromPhoto()` 的 `slots`）也算進「要你看」—— 底下那一組畫的就是它們，
 * 兩邊的數字要一樣（上一輪就差過一列）。
 */
export function summarizeAbovee(items = [], absent = []) {
  const count = (fn) => items.filter(fn).length;
  return {
    total: items.length,
    new: count((i) => i.kind === 'new' && !i.cancelled),
    // 兩邊都取消的那一列不算「已經記了」—— 它是已取消（ADR-0116）
    recorded: count((i) => i.kind === 'recorded' && !i.cancelled),
    attention: count(needsAttention) + (absent ?? []).length,
    cancelled: count((i) => i.cancelled),
    checked: count((i) => i.checked),
  };
}

// ---------- app 有、這次照片上沒有（ADR-0129）----------
//
// 她 2026-10-06：
//
// > 能不能同個月，如果有這次拍照沒有的來訪也列出，原因是我通常都會一次拍一個月一個人的所有壓表來訪，
// > 所以如果沒有拍到但是我app卻有紀錄的話那可能是錯的，如果已取消那abovee上也會標取消
// > 我拍照通常有兩種，一種是一次拍某段時間內的很多人，或是一個月內的一個人
//
// **一次確認層就是一頁**（Abovee 一頁 10 筆，一次最多兩張）。所以範圍預設是照片上第一列到最後一列之間，
// **兩頭那個時間不算**（翻頁常常切在同一天、同一個時間的中間）；知道是第一頁／最後一頁才往外放寬。
// 讀不出是第幾頁就不放寬 —— 少對幾段，好過把下一頁的喊成沒拍到。句子講「這次照片上沒有」，不講「Abovee 沒有」。
// 只講不改（ADR-0056、0116）：不勾、不存、不取消。

/** 這一列在照片上佔了哪幾個時間：開始時間＋合併扣課另一半的。 */
const timesOf = (i) => [i.startsAt, ...(i.merged?.parts ?? []).map((p) => p.startsAt)].filter(Boolean);

/** `75筆第1/8頁` → `{ total: 75, page: 1, pages: 8 }`。讀不到（或讀出來不合理）的那一格是 null。 */
export function aboveePage(text) {
  const s = clean(text);
  const total = s.match(/(\d+)\s*筆/);
  const at = s.match(/(\d+)\s*[/／]\s*(\d+)/);
  const page = at && Number(at[1]) >= 1 && Number(at[1]) <= Number(at[2]) ? at : null;
  return {
    total: total ? Number(total[1]) : null,
    page: page ? Number(page[1]) : null,
    pages: page ? Number(page[2]) : null,
  };
}

const pointKey = (p) => `${p.date} ${p.time ?? ''}`;
// 那一天所在那個月的頭尾（壓表那一支 `monthRange()`，不另算一次）
const monthStartOf = (iso) => monthRange(iso.slice(0, 7)).from;
const monthEndOf = (iso) => monthRange(iso.slice(0, 7)).to;

/** 照片上的列是不是由早到晚（讀不出時間的那幾列只比日期）。 */
function inOrder(points) {
  for (let k = 1; k < points.length; k += 1) {
    const [a, b] = [points[k - 1], points[k]];
    if (b.date < a.date) return false;
    if (b.date === a.date && a.time && b.time && b.time < a.time) return false;
  }
  return true;
}

/**
 * 這一次照片看得到哪幾段時間（ADR-0129）。有「姓名」那一欄的每一張是一段；
 * 兩張的頁數接得上（同一頁、或前後頁）就併成一段 —— 接不上（第 1 頁與第 3 頁）中間那一頁沒拍，不可以一起算。
 *
 * - `firstPage`／`lastPage`：讀得出是第一頁／最後一頁，或總筆數不多於這幾張的列數（`all`：每一列都在這裡）
 * - **列數照不重複的列算**（別張上同一列的只算一次，跟 `mergeAboveePhotos()` 同一支 `joinPages()`）——
 *   同一頁拍了兩次的話照張數加，15 筆的第一頁就會被算成「20 列 ≥ 15 筆、每一列都在這裡」（審查查到的）。
 *   **同一張裡同一個時間的兩列各算一列**（Abovee 的「N 筆」數的是列）
 * - 列不是照時間排的那一段：除非每一列都在這裡，不然丟掉 —— 別頁的列可能在任何一天
 *
 * Function 還沒重新部署（沒有起訖那兩格）時 `from`／`to` 是 null，照樣算得出來。
 *
 * @returns {{segments: {first: object, last: object, firstPage: boolean, lastPage: boolean, all: boolean}[],
 *            from: string|null, to: string|null, why: null|'noDates'|'unsorted'}}
 */
export function photoSpan(transcripts = []) {
  const list = transcripts ?? [];
  const from = list.map((t) => aboveeDate(t?.dateFromText)).find(Boolean) ?? null;
  const to = list.map((t) => aboveeDate(t?.dateToText)).find(Boolean) ?? null;
  const named = list.map((t, i) => ({ t, table: tableOf(t, i) })).filter((x) => x.table.hasName);
  const known = (p) => Boolean(p.page || p.total);
  // 頁數那一句可能在沒有姓名的那一半 —— 只有一張有姓名時，那一句就是它的
  const loose = named.length === 1 ? list.map((t) => aboveePage(t?.pageText)).find(known) ?? null : null;

  const pointsOf = (rows) => rows.map((r) => ({ date: aboveeDate(r.date), time: aboveeStart(r.time) })).filter((p) => p.date);
  const pieces = named.map(({ t, table }) => {
    const own = aboveePage(t?.pageText);
    return { points: pointsOf(table.rows), rows: table.rows, page: known(own) ? own : (loose ?? own) };
  }).filter((p) => p.points.length);
  if (!pieces.length) return { segments: [], from, to, why: 'noDates' };

  pieces.sort((a, b) => pointKey(a.points[0]).localeCompare(pointKey(b.points[0])));
  const runs = [];
  for (const p of pieces) {
    const last = runs[runs.length - 1];
    const step = last && last.page.page && p.page.page && last.page.pages === p.page.pages ? p.page.page - last.page.page : null;
    if (step === 0 || step === 1) {
      // 已經算過的列（同一頁拍了兩次、上下兩半重疊的那幾列）不再接一次 —— 接了的話順序看起來是亂的
      const joined = joinPages(last.rows, p.rows);
      last.points.push(...pointsOf(joined.extra));
      last.rows = joined.rows;
      last.page = { ...last.page, lastOf: p.page };
    } else {
      runs.push({ ...p, points: [...p.points], rows: [...p.rows] });
    }
  }

  let unsorted = false;
  const segments = [];
  for (const run of runs) {
    const total = run.page.total ?? run.page.lastOf?.total ?? null;
    const all = Boolean(total) && total <= run.rows.length;
    if (!all && !inOrder(run.points)) { unsorted = true; continue; }
    const sorted = [...run.points].sort((a, b) => pointKey(a).localeCompare(pointKey(b)));
    const end = run.page.lastOf ?? run.page;
    segments.push({
      first: sorted[0],
      last: sorted[sorted.length - 1],
      firstPage: all || run.page.page === 1,
      lastPage: all || (Boolean(end.page) && end.page === end.pages),
      all,
    });
  }
  if (!segments.length) return { segments, from, to, why: unsorted ? 'unsorted' : 'noDates' };
  return { segments, from, to, why: null };
}

/**
 * 一段的下界與上界。`key` 拿來比（`YYYY-MM-DD HH:MM`），`date`／`time` 拿來講。
 * 第一頁：讀得到「起」用那一天；讀不到、拍的是一個人、**而且每一列都在這裡**（`all`），用第一列那個月的一號；
 * 都沒有就從第一列（含）。不是第一頁：從第一列那個時間之後（不含 —— 同一個時間的別段可能在上一頁）。上界反過來。
 *
 * 「拍的是一個人」只是照這幾列猜的：很多人的列表最後一頁剛好只剩一位時也長這樣（審查查到的）。
 * 不是每一列都在這裡、又讀不到起訖時不猜整個月 —— 少對幾段，好過把別人查詢範圍外的喊成沒拍到。
 */
function boundsOf(seg, span, onePerson) {
  const { first, last } = seg;
  const month = onePerson && seg.all;
  let lo;
  if (seg.firstPage) {
    const base = span.from ?? (month ? monthStartOf(first.date) : null);
    lo = base
      ? { date: base < first.date ? base : first.date, time: null }
      : { date: first.date, time: first.time };
    lo.key = `${lo.date} ${lo.time ?? '00:00'}`;
    lo.open = false;
  } else {
    // 第一列讀不出時間：那一整天都不知道哪幾段在上一頁 —— 從隔天算起
    lo = { date: first.date, time: first.time, key: `${first.date} ${first.time ?? '24:00'}`, open: Boolean(first.time) };
  }
  let hi;
  if (seg.lastPage) {
    const base = span.to ?? (month ? monthEndOf(last.date) : null);
    hi = base
      ? { date: base > last.date ? base : last.date, time: null }
      : { date: last.date, time: last.time };
    hi.key = `${hi.date} ${hi.time ?? '24:00'}`;
    hi.open = false;
  } else {
    hi = { date: last.date, time: last.time, key: `${last.date} ${last.time ?? '00:00'}`, open: true };
  }
  return { lo, hi };
}

/** 那一段落不落在範圍裡。沒有開始時間的段（合併檔匯進來的）要整天都在裡面才算。 */
function within(range, date, startsAt) {
  const [start, stop] = startsAt ? [`${date} ${startsAt}`, `${date} ${startsAt}`] : [`${date} 00:00`, `${date} 23:59`];
  const { lo, hi } = range;
  const above = lo.open ? start > lo.key : start >= lo.key;
  const below = hi.open ? stop < hi.key : stop <= hi.key;
  return above && below;
}

/**
 * app 上有、這次照片上沒有的那幾段（ADR-0129）。確認層每畫一次就算一次 —— 她換了某一列是誰，結果跟著變。
 *
 * **對象**：照片上每一列都認出來、而且是同一位 → 那一位（「一個月內的一個人」）；否則範圍裡 app 上有來訪的每一位。
 * **哪幾段算 app 有**：來訪還在、那一段還活著（未到也算 —— Abovee 上失約的那一列還在）、**那門課壓在 Abovee**
 *（`bookingSystemOf()`：健檢壓 Examine、HRV 不用壓，都不算；認不得的課照它的猜法算 Abovee）。
 * **哪幾段算照片上有**：同一位、同一天，而且開始時間一樣（合併扣課的另一半也算）；那一段沒有開始時間的話，
 * 照片上那一天有同一門課；被「搬了時間」指到的那一段也算；照片上那一位那一天有一列讀不出時間 → 那一天都算。
 * **照片上那一天那個時間有一列還沒認出是誰** → 先不列（那一列可能就是他）。
 *
 * @param {object[]} transcripts 那一次的抄字（`photoSpan()` 讀）
 * @param {object[]} items `readAbovee()` 的那幾列（她改過之後的）
 * @param {{customers, visitsBy, master}} ctx
 * @returns {{checked: {customerId: string|null, ranges: object[]}|null, why: null|'noDates'|'unsorted', slots: object[]}}
 */
export function absentFromPhoto(transcripts, items, ctx) {
  const list = items ?? [];
  if (!list.length) return { checked: null, why: null, slots: [] };
  const span = photoSpan(transcripts);
  if (span.why) return { checked: null, why: span.why, slots: [] };

  const ids = new Set(list.map((i) => i.customerId ?? null));
  const customerId = ids.size === 1 && !ids.has(null) ? [...ids][0] : null;
  const ranges = span.segments.map((seg) => boundsOf(seg, span, Boolean(customerId)));
  const courses = new Map((ctx.master?.courses ?? []).map((c) => [c.id, c]));
  const nameOf = (id, visit) => (ctx.customers ?? []).find((c) => c.id === id)?.name ?? visit?.customerName ?? '';

  const onPhoto = (who, date, slot) => {
    const here = list.filter((i) => i.date === date);
    // 還沒認出是誰的那一列可能就是他
    if (here.some((i) => !i.customerId && (!slot.startsAt || !i.startsAt || i.startsAt === slot.startsAt))) return true;
    const mine = here.filter((i) => i.customerId === who);
    if (mine.some((i) => !i.startsAt)) return true;
    if (!slot.startsAt) return mine.some((i) => i.course?.courseId === slot.courseId);
    return mine.some((i) => timesOf(i).includes(slot.startsAt) || i.movedFrom?.startsAt === slot.startsAt);
  };

  const slots = [];
  const people = customerId ? [customerId] : Object.keys(ctx.visitsBy ?? {});
  for (const who of people) {
    for (const visit of ctx.visitsBy?.[who] ?? []) {
      if (!visit || visit.deletedAt || !isActive(visit) || !visit.date) continue;
      (visit.slots ?? []).forEach((slot, index) => {
        if (!isLiveSlot(slot)) return;
        if (bookingSystemOf(courses.get(slot.courseId) ?? null) !== 'Abovee') return;
        if (!ranges.some((r) => within(r, visit.date, slot.startsAt))) return;
        if (onPhoto(who, visit.date, slot)) return;
        slots.push({
          key: `${visit.id}:${index}`,
          customerId: who,
          customerName: nameOf(who, visit),
          visitId: visit.id,
          date: visit.date,
          startsAt: slot.startsAt ?? null,
          slotIndex: index,
          name: slotName(slot, ctx.master ?? {}, 'short'),
          status: slotStatus(visit, slot),
        });
      });
    }
  }
  slots.sort((a, b) => `${a.date}|${a.startsAt ?? ''}|${a.customerName}`.localeCompare(`${b.date}|${b.startsAt ?? ''}|${b.customerName}`));
  return { checked: { customerId, ranges }, why: null, slots };
}

const md = (iso) => `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`;
const pointSay = (p) => (p.time ? `${md(p.date)} ${p.time}` : md(p.date));

/**
 * 那一塊上面那一句：對了誰、哪一段日期、結果。**講「這次照片上沒有」，不講「Abovee 沒有」** —— 可能在別頁。
 * 沒有對的時候講為什麼（不然她分不出沒列出來是「沒有」還是「沒檢查」）。照片上一列都沒有就不講。
 *
 * @param {ReturnType<typeof absentFromPhoto>} result
 * @param {{id: string, name: string}[]} customers
 */
export function absentSay(result, customers = []) {
  if (result?.why === 'unsorted') {
    return '照片上的列不是照時間排的，看不出這一頁是哪一段時間 —— 沒有對「app 有、這次照片上沒有」。';
  }
  if (result?.why === 'noDates') return '照片上讀不到日期 —— 沒有對「app 有、這次照片上沒有」。';
  if (!result?.checked) return '';
  const { customerId, ranges } = result.checked;
  const when = ranges.map(({ lo, hi }) => `${pointSay(lo)}–${pointSay(hi)}`).join('、');
  const name = customerId ? ((customers ?? []).find((c) => c.id === customerId)?.name ?? '') : '';
  const scope = customerId ? `對過 ${name} ${when} 在 app 上的段` : `對過 ${when} 每一位在 app 上的段`;
  const n = result.slots.length;
  return n ? `${scope}：這 ${n} 段這次照片上沒有。` : `${scope}：都在這次的照片上。`;
}

/**
 * 那一塊底下那一顆的字：按下去會發生什麼（句子在 domain，同 `newRowSay()`、`mismatchSay()`）。
 * 有勾起來還沒記的 → 先走既有的存檔、記好才換頁；沒有 → 直接去。**兩種都講照片不會留著**（ADR-0101）——
 * 她看完那幾段之前不可以因為按了什麼而失去那張照片、卻沒有被告知。去的是第一段那一天（日曆上那個月的其餘幾段一翻就到）。
 */
export function goneButtonSay(pending, date) {
  const day = shortDate(date);
  return pending
    ? `先記勾起來的 ${pending} 段，再去日曆 ${day}（照片不會留著）`
    : `去日曆 ${day}（照片不會留著）`;
}

/**
 * 打開確認層時要補讀哪幾天的來訪：照片上讀得到的每一個日期（含起訖那兩格），放寬到整個月 ——
 * 範圍可能放寬到「起」那一天或整個月（`boundsOf()`），讀少了會把有的喊成沒有。多讀一兩個月不貴。
 */
export function aboveeLoadRange(transcripts = []) {
  const dates = [
    ...aboveeDatesIn(transcripts),
    ...(transcripts ?? []).flatMap((t) => [aboveeDate(t?.dateFromText), aboveeDate(t?.dateToText)]),
  ].filter(Boolean).sort();
  if (!dates.length) return null;
  return { from: monthStartOf(dates[0]), to: monthEndOf(dates[dates.length - 1]) };
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
 *                     visit: object, items: object[], reopened: boolean, afterClosed: boolean}[],
 *            problems: Record<string, string[]>}}
 *   `problems`：勾了卻組不起來的那幾列（還沒選額度、沒有時間），照列的 key。
 *   `afterClosed`：那一天已經結案了（已完成／未到），所以這幾段另開一次新的來訪（ADR-0083）——
 *   確認框要講出來（`consequences.js` 的 `closedDayLine()`）。問的是 `sameDayState()`，跟日曆同一支。
 *   `at`：每一列在那一筆來訪裡是第幾段（列的 key → 位置）—— 提醒要歸到它講的那一列（`warningsByRow()`）
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
      afterClosed: false, at: {},
    };
    // 這一組已經組出來的那一筆放進去，下一段才併得進同一天
    const pool = [
      ...(ctx.visitsBy?.[item.customerId] ?? []).filter((v) => !group.visit || v.id !== group.visit.id),
      ...(group.visit ? [group.visit] : []),
    ];
    const { visit, merged } = visitWithSlot({ customerId: item.customerId, customerName }, item.date, slot, pool);
    // 這一組的第一段沒有併進任何一筆、而那一天有結案的 → 另開一次（同一組接下來的段併進剛開的那一筆）
    if (!group.visit && !merged) {
      group.afterClosed = sameDayState(ctx.visitsBy?.[item.customerId] ?? [], item.customerId, item.date).closed.length > 0;
    }
    group.visit = visit;
    // 新的一段一律接在尾巴（`withExtraSlot()`、新的一筆只有它）
    group.at[item.key] = visit.slots.length - 1;
    group.reopened = group.reopened || Boolean(merged?.reopened);
    group.items.push(item);
    groups.set(key, group);
  }

  return { groups: [...groups.values()], problems };
}

// ---------- 驗證一組時拿哪些來訪（2026-10-09 審查）----------

/**
 * 驗證某一組（一位一天）時，`validateVisit()` 要的那兩份來訪：**資料庫裡已經有的，加上這一次別組要記的**。
 *
 * 每一組以前各自驗、只看資料庫裡的 —— 同一張照片上同一位客人別天的那幾段不在裡面。「一個月一個人」的拍法
 * 正好是這樣：只買 1 次、照片上三天各一段，三列都先按好同一筆、都打勾，沒有一句「會超過總次數」；
 * 同一張照片上兩位排同一間同一個時間也講不出來。這是 `CLAUDE.md`「算次數、驗證…要拿哪些來訪」那一列的同一件事：
 * 全部來訪**連這一次還沒存的**。
 *
 * - `customerVisits`：這位客戶的全部來訪，別天那幾組換成（或加上）組好的那一筆
 * - `sameDayVisits`：那一天全部客戶的來訪，別人那一天的那一組也是
 * - **還沒存的那幾筆給一個暫時的 id**：`validateVisit()` 每一圈都靠 `v.id !== visit.id` 把正在驗的這一筆濾掉，
 *   沒有 id 的會全部被當成「就是這一筆」
 *
 * @param {object[]} groups `planAbovee()` 的每一組（勾著的那幾列）
 * @param {object} group 正在驗的那一組
 * @param {{visitsBy: Record<string, object[]>}} ctx
 * @returns {{customerVisits: object[], sameDayVisits: object[]}}
 */
export function visitsForCheck(groups, group, ctx) {
  const planned = (groups ?? []).filter((g) => g !== group && g.visit)
    .map((g) => ({ ...g.visit, id: g.visit.id ?? `abovee:${g.key}` }));
  const replaced = new Set(planned.map((v) => v.id));
  const stored = (list) => (list ?? []).filter((v) => v && !replaced.has(v.id));
  return {
    customerVisits: [
      ...stored(ctx.visitsBy?.[group.customerId]),
      ...planned.filter((v) => v.customerId === group.customerId),
    ],
    sameDayVisits: [
      ...stored(Object.values(ctx.visitsBy ?? {}).flat()),
      ...planned,
    ].filter((v) => v.date === group.date),
  };
}

// ---------- 提醒歸到各列（prelaunch-fixes/12，ADR-0138）----------

/**
 * 一組（同一位同一天）的提醒歸到各列：**每一列只拿講到它那一段的那幾句**。
 *
 * 以前整組的提醒原樣掛到那一組每一列上 —— 同一天三列各印三遍。那時候只有點開才看得到，還過得去；
 * 現在收著的列也要畫、確認框還要數「幾段有提醒」，照搬的話三列都多一行、N 數成三倍。
 * 併進既有那一天時，那一天原本那幾段的提醒不屬於任何一列（那不是這一次的事）。
 *
 * - `all`：點開那一列看到的（每一種都在）
 * - `mustSee`：不點開也要看得到的（`visits.js` 的 `mustSee()`：器材對警示、重疊、超用、品項不一樣、撞到別人），
 *   是 `all` 的子集、同一句。合併扣課另一台的提醒（`mergedNotices()`）也算 —— 那是同一種「器材對警示要注意」
 *
 * @param {{items: object[], at: Record<string, number>}} group `planAbovee()` 的一組
 * @param {{text: string, source: string, slots: number[]}[]} details `warningDetails(group.visit, …)`
 * @param {{customer?: object, equipment?: object[]}} [o] 合併扣課第二台要問的：這位客戶的警示、器材主檔
 * @returns {Record<string, {all: string[], mustSee: string[]}>}
 */
export function warningsByRow(group, details = [], { customer = null, equipment = [] } = {}) {
  const out = {};
  for (const item of group?.items ?? []) {
    const at = group.at?.[item.key];
    const mine = (details ?? []).filter((w) => (w.slots ?? []).includes(at));
    const second = mergedNotices(item, customer, equipment);
    out[item.key] = {
      all: [...mine.map((w) => w.text), ...second],
      mustSee: [...mine.filter(mustSee).map((w) => w.text), ...second],
    };
  }
  return out;
}

/** 收著的那一行最多畫幾句：前兩句，其餘收成一句「還有 N 句」（一列多半只有一兩句）。 */
export function briefWarnings(texts = [], max = 2) {
  const list = texts ?? [];
  return list.length > max ? [...list.slice(0, max), `還有 ${list.length - max} 句 —— 點開這一列看`] : [...list];
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
