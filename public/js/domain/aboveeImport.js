// 拍 Abovee → 一次新增很多來訪（issue 13，ADR-0104）。純函式。
//
// 她 2026-09-17：「拍壓表的電腦畫面（Abovee）→ 一口氣新增很多來訪…可以說辯識到什麼…
// 必須要能夠主次分明一目瞭然」「讓我一次上傳兩張圖片，也接受上傳一張」「直接標成壓完」。
//
// AI 只抄字（`functions/transcripts/aboveeList.js`：十一欄、照照片的順序），這一支：
//
// 1. **兩張怎麼對**（`mergeAboveePhotos()`）：Abovee 列表二十幾欄塞不進一個畫面，右半邊沒有姓名、
//    日期、時段 —— 兩張只能照「第幾列」對上，**列數不一樣就不對**。兩張都有姓名（兩頁、同一頁拍兩次）
//    就接起來：**只拿不同張的列比**（`sameRow()`），同一張照片裡的兩列永遠不互相去掉
// 2. **每一列分成四種**（`readAbovee()`）：新的、已經記了、對不上、認不得人。
//    認人走 11 的 `identifyCustomer()`，課程／診間／治療師走 12 的 `courseFrom()` 等。
//    **「已經記了」認得三種形狀**：同一天同一個開始時間（`existingAt()`）、合併扣課的後一半（`claimHalves()`）、
//    合併檔匯進來沒有開始時間的舊段（`claimTimeless()`）
// 3. **組成來訪**（`planAbovee()`）：一律走 10 的 `slotFromPicks()`／`visitWithSlot()`（同一組接下來的段 `withPlannedSlot()`）。
//    **每一段的狀態照照片**（`photoSlotStatus()`，abovee-status-follows-photo 03）：課程完成、客戶失約、已取消照記，
//    不合理的（還沒到就完成、讀不出來）記成待確認；整筆照時段推
// 4. **直接標成壓完**（`queueMarksAfter()`）
//
// **Abovee 上的預約狀態**（「預約狀態」那一格）：原字留著（`statusText`，畫面照印），翻成 app 的哪一種只有
// `statusFromAbovee()` 一支（六種，abovee-status-follows-photo 01）→ 每一列的 `photoStatus`。
// 整張照片沒拍到那一欄時是 `null`（看不出來），跟「那一格讀不出來」（`statusUnread`）是兩件事。

import { identifyCustomer, nearNameSay, normalizeChartNo, normalizeName } from './identify.js';
import { courseFrom, roomFrom, staffFrom, staffRoleFor } from './abovee.js';
import { slotFromPicks, visitWithSlot, withPlannedSlot } from './slotDraft.js';
import {
  INITIAL_STATUS, acceptsMoreSlots, applyStatus, assignsFor, closeVisit, coursesForEntitlement, equipmentAfterSwitch, equipmentChoicesFor,
  isActive, isLiveSlot, isOpenStatus, lockedAt, mustSee, rebookSlot, sameDayState, shortStatus, slotSay, slotStatus, validateVisit,
  warningDetails, withSlotStatuses,
} from './visits.js';
import { chargesEntitlement, counts, isProduct } from './entitlements.js';
import { cannotClose, closeBlocks, examChoicesFor, examStatusIn, pairsOf, PICKABLE_EXAM } from './followups.js';
import { closeBlockSay } from './consequences.js';
import { DOCTOR_ROLE, THERAPIST_ROLE, normalizeAlias, isBedlessOf, oneCharOff, GIFT_KINDS, canBeGift,
} from './masterData.js';
import { noticeFlags } from './contraindications.js';
import { endOf, toMinutes } from './visitTime.js';
import { markInQueue, monthRange } from './scheduling.js';
import { NTH_PICK, giftCourseIdOf, giftPick } from './slotOptions.js';
import { MIN_NTH, nthOf } from './nthFollowup.js';
import { fullNameOf, slotName } from './naming.js';
import { isValidDate, shortDate } from './dates.js';
import { bookingSystemOf } from './taskRules.js';

/** 照片上的欄名 → 列上的欄位。只有這十一欄（`ABOVEE_COLUMNS`）。 */
export const ABOVEE_KEYS = Object.freeze({
  預約狀態: 'status', 預約日期: 'date', 預約時段: 'time', 姓名: 'name', 病歷號: 'chartNo',
  課程: 'course', 合併扣課: 'merged', 預約來源: 'source', 診間: 'room', 服務資源: 'resource', 取消原因: 'cancelReason',
});

/**
 * 右半邊那幾格：左右兩張配對時才從右半補進來。「合併扣課」在 Abovee 上緊跟著課程（左半），
 * 但她拍的那一半切在哪不一定 —— 左半那一格空著、右半有的話照樣補（左半有字的不會被蓋掉）。
 */
const RIGHT_KEYS = ['room', 'resource', 'cancelReason', 'merged', 'source'];

/**
 * 交界上的那幾欄：**兩張都有字時取比較長的那一個**（prelaunch-fixes/13）。「預約來源」也在交界（gift-and-trial 06）。
 *
 * Abovee 的列表太寬，她拍左右兩張；「診間」剛好在交界，左半張常切到一半。10/5 那次考試 AI 把被切掉的字
 * 照抄成「治療」—— 以前「左半那一格空著才用右半的」，右半完整的「治療室5」就被丟掉；EECP 的服務資源寫的是
 * 機器（EECP1）推不回診間，那幾段存進去沒有診間。
 *
 * 不寫成「右半有字就用右半」：右半從那一欄中間開始拍時，右半那一格只有後半個字，反過來蓋掉左半完整的。
 * **被切掉的一定比完整的短**，取長的兩個方向都對。「合併扣課」不在這裡 —— 它屬於左半，照舊左半有字就不動。
 */
const EDGE_KEYS = ['room', 'resource', 'cancelReason', 'source'];

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

/**
 * 這一列 Abovee 寫的是體驗嗎（gift-and-trial 06）：「預約來源」那一格去空白後含「體驗」。**只有這一支。**
 * 抄字沒有那一欄（Function 還沒重新部署）就是空的 → 不是體驗，跟以前一模一樣。
 */
export const isTrialRow = (row) => clean(row?.source).replace(/\s/g, '').includes('體驗');

/** 「合併扣課」那一格有沒有勾。Abovee 上寫「是」；抄成勾勾也算。 */
export function mergedMark(text) {
  const s = clean(text);
  if (!s || /否|不|no/i.test(s)) return false;
  return /是|有|勾|✓|✔|☑|^v$|^y|true|^1$/i.test(s);
}

// ---------- 兩張怎麼對 ----------

function tableOf(transcript, photo) {
  const keys = (transcript?.columns ?? []).map((c) => ABOVEE_KEYS[clean(c)] ?? null);
  // 這一張有沒有拍到「預約狀態」那一欄（01）：沒拍到的列狀態是「看不出來」，不是「那一格讀不出來」
  const statusSeen = keys.includes('status');
  return {
    photo,
    hasName: keys.includes('name'),
    rows: (transcript?.rows ?? []).map((cells, line) => {
      const row = { photos: [photo], line, statusSeen };
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
 *   那是兩列。狀態只分取消／沒取消（`statusFromAbovee()`），不比原字
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
  const gone = (r) => statusFromAbovee(r.status).status === 'cancelled';
  if (clean(a.status) && clean(b.status) && gone(a) !== gone(b)) return false;
  return true;
}

/**
 * 後一張的列接到前面那幾列上：對得上的**併成一列**（空的那幾格從另一張補 —— 第二張獨有的診間、服務資源不可以不見），
 * 對不上的照原本的順序接在後面（`extra`）。
 *
 * **一列只配一次、只跟前面那幾張的列比**：這一張自己的列是等整張比完才接上去的，所以同一張照片裡的兩列
 * 永遠不互相去掉。`photoSpan()` 數「不重複的列」也走這一支 —— 兩邊數的是同一份列。
 *
 * **兩張都讀得出預約狀態、讀出來的不一樣**（同一頁拍兩次、中間在 Abovee 上改過）：記下兩個原字（`statusConflict`）——
 * 以前先傳的那一張贏、差異安靜地沒了（段一中途發現 3）。照片的狀態拿來寫之後，那一列不改、不預設勾、講一句
 *（abovee-status-follows-photo 04 第 4 點）。`sameRow()` 只分取消／沒取消，所以會併起來的是「課程完成」與「確認前往」那一種。
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
    // 兩張有一張拍到「預約狀態」那一欄就算拍到了（狀態從那一張補，底下那一圈）
    const merged = { ...base[at], photos: [...base[at].photos, ...row.photos], statusSeen: base[at].statusSeen || row.statusSeen };
    for (const key of Object.values(ABOVEE_KEYS)) if (!merged[key] && row[key]) merged[key] = row[key];
    // 交界上那幾欄可能有一張切到一半（13）：兩張都有字就取比較長的，一樣長留第一張的
    for (const key of EDGE_KEYS) if (base[at][key] && row[key]) merged[key] = fullerCell(base[at][key], row[key]);
    const conflict = statusConflictOf(base[at], row);
    if (conflict) merged.statusConflict = conflict;
    rows[at] = merged;
  }
  return { rows: [...rows, ...extra], extra };
}

/** 兩張上同一列的預約狀態：兩張都拍到那一欄、都讀得出來、翻出來的不一樣 → 兩個原字（照上傳的順序）；不然 null。 */
function statusConflictOf(a, b) {
  if (a.statusConflict) return a.statusConflict;
  if (!a.statusSeen || !b.statusSeen) return null;
  const [sa, sb] = [statusFromAbovee(a.status), statusFromAbovee(b.status)];
  if (sa.unread || sb.unread || sa.status === sb.status) return null;
  return [clean(a.status), clean(b.status)];
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
    // 交界上那幾欄：左半切到一半的不可以蓋掉右半完整的（一樣長取右半 —— 那幾欄本來就在右半）
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

/**
 * 二返：接哪一次健檢。只有一次沒被佔走時才預選（壓表那一頁的 `pickExamIfObvious()`）。
 *
 * **帶了 `items`（這一張照片上的每一列）就連同這一批勾著的一起列**（ADR-0145，她 10/9：「那不能讓我當下決定接誰嗎」）：
 * 同一張照片上健檢和二返都是新的時，那一次健檢還沒有來訪 id —— 用跟驗證同一套的暫時 id（`plannedId()`），
 * 存的時候先存那一天、再換成真的（`resolveSaved()`）。
 *
 * `row`：畫的是哪一列。它現在接著的那一次不算被佔走（這一批裡它自己那一組也佔著那一次 —— 同來訪編輯器的 `selected`）；
 * **它自己那一天、這一次才要記的健檢列得出來但按不下去**（`unsaved`）：連結記的是來訪 id，而那一段跟這一列同一次寫進去
 * （來訪編輯器同一條：「這一天的健檢存好之後才接得上」）。那一天存著的那一份本來就有健檢的照舊接得上。
 * 以前先選好自己那一天的暫時 id，驗證認不得它，那一天整組記不進去（10/9 審查）。沒給 `row` 就不分自己別人（`refreshNoExam()`）。
 */
export function examChoices(customerId, entitlement, ctx, items = null, row = null) {
  if (!entitlement?.followupForEntitlementId) return [];
  const ents = liveEnts(ctx, customerId);
  const coursesById = Object.fromEntries((ctx.master?.courses ?? []).map((c) => [c.id, c]));
  const pair = pairsOf(ents, coursesById).find((x) => x.followup?.id === entitlement.id);
  if (!pair) return [];
  const stored = ctx.visitsBy?.[customerId] ?? [];
  if (!items) return examChoicesFor(pair, stored);
  const groups = planAbovee(items, ctx).groups.filter((g) => g.customerId === customerId);
  // 記完之後的樣子（`afterPhoto()`，06）：照片取消掉的那一場二返不再佔著那一次健檢、照片改成已完成的健檢照樣接得上 ——
  // 只看存著的那一份的話，驗證放行（`photoDayPlan()`）的那一次在這一排卻按不下去
  const choices = examChoicesFor(pair, afterPhoto(customerId, groups, items, ctx), { selected: row?.followupForVisitId ?? null });
  const own = row ? groups.find((g) => g.date === row.date) : null;
  if (!own) return choices;
  const ownId = plannedId(own);
  if (PICKABLE_EXAM.has(examStatusIn(stored.find((v) => v.id === ownId), [pair.source.id]))) return choices;
  return choices.map((x) => (x.visitId === ownId ? { ...x, pickable: false, unsaved: true } : x));
}

/**
 * 還沒存的那一組（一位一天）在驗證、「接哪一次健檢」那一排、存檔排先後與換 id 時叫什麼。併進既有那一天的就是那一筆的 id。
 * **只有這一支在拼那個暫時的 id** —— 存檔那一圈以前自己拼一次、只認得暫時的，健檢併進既有那一天時排不到前面（10/9 審查）。
 */
export const plannedId = (group) => group.visit?.id ?? `abovee:${group.key}`;

/** 「接哪一次健檢」只有一次按得下去才先選好（她回的第 3 題）。讀照片那一下、她自己按一顆、換一位都問這一支。 */
const onlyOpen = (choices) => {
  const open = choices.filter((x) => x.pickable);
  return open.length === 1 ? open[0].visitId : null;
};

/** 暫時的 id 嗎（`plannedId()` 給還沒存的那幾組的）。 */
const isPlannedId = (id) => typeof id === 'string' && id.startsWith('abovee:');

/**
 * 存的時候：這一列接的是同一批裡還沒存的那一次健檢 → 換成先存好的那一天的真的 id（`savedIds`：暫時 id → 真的 id）。
 * 換不到（那一天沒存成）就**不接** —— 寫一個指到不存在的連結比沒接糟（資料健檢、試算表都會讀到它）。
 */
export function resolveSaved(item, savedIds = new Map()) {
  if (!isPlannedId(item?.followupForVisitId)) return item;
  return { ...item, followupForVisitId: savedIds.get(item.followupForVisitId) ?? null };
}

/**
 * 接著同一批**另一天才要記的健檢**、而那一天這一次記不進去（有一列有問題）的那幾列 —— 這一列也先不記、講出來。
 * 照樣存的話換不到那一天的 id（`resolveSaved()`），她選好的那一次被安靜地存成沒接上（10/9 審查）。
 *
 * @param {object[]} groups `planAbovee()` 的每一組
 * @param {Record<string, string[]>} problems 列的 key → 記不進去的原因
 * @returns {Record<string, string>} 列的 key → 那一句
 */
export function stuckLinks(groups, problems, ctx) {
  const stuck = new Map((groups ?? []).filter((g) => g.items.some((i) => problems?.[i.key])).map((g) => [plannedId(g), g]));
  const out = {};
  for (const g of groups ?? []) {
    for (const i of g.items) {
      const day = stuck.get(i.followupForVisitId);
      const exam = secondEntOf(i, ctx)?.followupForEntitlementId;
      if (!day || day === g || !exam || !day.items.some((x) => x.entitlementId === exam)) continue;
      out[i.key] = `接的那一次健檢（${shortDate(day.date)}）那一天還記不進去 —— 先處理那一天，或換「接哪一次健檢」`;
    }
  }
  return out;
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

/** `existingAt()` 找到的那幾段裡，跟照片上這一門課一樣的（有一邊沒寫器材就不比器材）。 */
const sameCourseHere = (at, course) => (at?.slots ?? []).filter(({ slot }) => Boolean(course) && slot.courseId === course.courseId
  && (!course.equipmentId || !slot.equipmentId || slot.equipmentId === course.equipmentId));

/**
 * 勾著的新的那一列，app 上那一天那個時間**已經有一段活著的同一門課**了（10/16 審查）。
 * 打開確認層時沒有（不然 `resolveItem()` 就認成「已經記了」）—— 有，就是那之後在別的地方記了，
 * 或上一次按「記錄」那一趟其實寫進去了、只是沒收到回應。照記的話同一天另開一筆、同一段多扣一次。
 */
function alreadyInApp(item, ctx) {
  // 照片上已取消的那一列不算：取消之後同一格重約的那一種（`rebookedHere()`）app 上活著的那一段是另一列的
  if (item.kind !== 'new' || item.cancelled || !item.customerId || !item.date || !item.startsAt) return false;
  const at = existingAt(item.customerId, item.date, item.startsAt, ctx);
  return Boolean(at?.live) && sameCourseHere(at, item.course).length > 0;
}
export const ALREADY_IN_APP = 'app 上已經有這一段了（剛在別的地方記了）—— 不用再記，把勾拿掉';

/** Abovee 上「還沒結案」的那三種字。整格一模一樣才算（`statusFromAbovee()`）。 */
const PENDING_WORDS = Object.freeze(['待確認', '聯繫中', '確認前往']);

/**
 * Abovee「預約狀態」那一格 → app 的哪一種狀態（abovee-status-follows-photo 01）。**判那一格的只有這一支。**
 *
 * Abovee 上有六種（她 10/5 給的欄位結構）：
 *
 * | Abovee | app |
 * |---|---|
 * | 課程完成 | `done` |
 * | 待確認、聯繫中、確認前往 | `pending_confirm` |
 * | 已取消 | `cancelled` |
 * | 客戶失約 | `no_show` |
 *
 * - **先判失約、取消、完成**（字裡有沒有那兩個字），**再判待確認那三種**（整格一模一樣）——
 *   「待確認」「確認前往」都含「確認」，拿「確認」當鑰匙會互相吃掉
 * - 空的、認不出來的（抄壞的「確認前往X」、近似的「聯絡中」）→ 待確認＋`unread`：**不猜成完成或取消**，那一列要講一句
 * - 比之前去掉每一個空白（`clean()` 已經把全形換成半形）
 * - 整張照片沒拍到這一欄不歸這裡（`readAbovee()` 那一列的 `photoStatus` 是 `null`）—— 那不是讀不出來，是沒拍到
 *
 * 9/24 的 `aboveeState()` 只認「取消」「完成」兩個字（從當時的截圖歸納的，ADR-0116）：客戶失約被當成還排著。
 *
 * @returns {{status: 'done'|'pending_confirm'|'cancelled'|'no_show', unread: boolean}}
 */
export function statusFromAbovee(statusText) {
  const text = clean(statusText).replace(/\s/g, '');
  if (/失約/.test(text)) return { status: 'no_show', unread: false };
  if (/取消/.test(text)) return { status: 'cancelled', unread: false };
  if (/完成/.test(text)) return { status: 'done', unread: false };
  return { status: 'pending_confirm', unread: !PENDING_WORDS.includes(text) };
}

/**
 * 照片上這個狀態，在**那一天**看來合不合理（01）。她 10/15：「不合理的（例如未來的完成了或是過去的沒取消也沒完成）也提醒」。
 *
 * - 還沒到的完成、還沒到的失約 → 講
 * - 過了的待確認（三種都算）→ 講
 * - 今天的什麼都不講；已取消不看日期
 *
 * `today` 是拍照那一刻的日期，由呼叫端傳（`todayISO()`，lessons 七）—— 這裡不 `new Date()`。
 * 回的是那一句的核心，要不要勾、勾了記成什麼是呼叫端的事。沒有要講的就是空字串。
 */
export function photoTimeSays(status, date, today) {
  if (!date || !today) return '';
  if (date > today && status === 'done') return '還沒到就寫完成了';
  if (date > today && status === 'no_show') return '還沒到就寫失約了';
  if (date < today && status === 'pending_confirm') return '日子過了還沒結案';
  return '';
}

/**
 * 這一列的預約狀態要講的那一句：那一格讀不出來就講讀不出來（不再拿它去比時間 —— 不知道 Abovee 上寫什麼），
 * 讀得出來就照 `photoTimeSays()`。那一張沒拍到那一欄（`photoStatus` 是 `null`）不在這裡講 —— 抬頭講一次（`statusColumnSay()`）。
 */
export function photoStatusSay(item, today) {
  if (!item?.photoStatus) return '';
  if (item.statusUnread) {
    return item.statusText ? `讀不出預約狀態（照片上是「${item.statusText}」）` : '讀不出預約狀態（照片上那一格是空的）';
  }
  return photoTimeSays(item.photoStatus, item.date, today);
}

/**
 * 確認層抬頭那一句：照片沒拍到「預約狀態」那一欄（01）。**整張講一次**，不是每一列各講一次。
 * `read` 是 `readAbovee()` 回的那一份（看它的 `noStatusColumn`）。
 */
export function statusColumnSay(read) {
  if (read?.noStatusColumn === 'all') return '這張照片沒拍到「預約狀態」那一欄 —— 看不出哪幾段完成或取消了，照舊記成待確認。';
  if (read?.noStatusColumn === 'some') return '有一張照片沒拍到「預約狀態」那一欄 —— 只在那一張上的列看不出完成或取消，照舊記成待確認。';
  return '';
}

// ---------- 新的一列：照照片上的狀態記（abovee-status-follows-photo 03）----------
//
// 她 10/15：「只要是abovee上寫課程完成，那就是完成了 … 已取消就是取消，客戶失約就是未到」
// 「我幾乎都是先完成abovee上的壓表或取消後才會想要記錄到app上，app只是記錄用的」。
// 以前新的一段一律待確認（ADR-0104 第 3 點）、已經過的一律不預設勾（ADR-0030 借來的）。

/** 合併扣課那一對（`mergedItem()` 只抄第一列）兩列的預約狀態不一樣。 */
const mergedStatusesDiffer = (item) => {
  const parts = item?.merged?.parts ?? [];
  return parts.length > 1
    && parts.some((p) => p.photoStatus !== parts[0].photoStatus || p.statusUnread || p.statusConflict);
};

/** 照片上這一列的狀態拿不準（不是「沒拍到那一欄」那一種）：讀不出來、兩張寫的不一樣、合併扣課兩列不一樣。 */
const photoUnsure = (item) => Boolean(item?.statusUnread || item?.statusConflict || mergedStatusesDiffer(item));

/**
 * 一列新的記進 app 時，那一段是什麼狀態（03）。照片上寫什麼就記什麼（`statusFromAbovee()` 的對照），**不合理的記成待確認**：
 *
 * - 那一張沒拍到那一欄（`photoStatus` 是 null）、拿不準的（`photoUnsure()`）→ 待確認（不猜成完成或取消）
 * - 還沒到的完成、還沒到的失約 → 待確認（不預設勾，`photoTime` 那一句講；勾了才會走到這裡）
 * - 已取消不看日期
 *
 * 二返／n返 接的那一次健檢還沒做完 → 也是待確認，但那要整批一起看（`planAbovee()` 的第二圈），不在這裡。
 * `today` 是拍照那一刻的日期（`todayISO()`，lessons 七）；沒給就當成看不出過去未來 → 待確認。
 *
 * @returns {'pending_confirm'|'done'|'no_show'|'cancelled'}
 */
export function photoSlotStatus(item, today) {
  if (!item?.photoStatus || photoUnsure(item)) return INITIAL_STATUS;
  if (item.photoStatus === 'cancelled') return 'cancelled';
  if (item.photoStatus === 'done' || item.photoStatus === 'no_show') {
    return today && item.date && item.date <= today ? item.photoStatus : INITIAL_STATUS;
  }
  return INITIAL_STATUS;
}

/**
 * 新的那一列照照片上的狀態要不要先勾好（03）。她 10/15：「如果app沒有但是課程完成已過去的，為什麼預設不勾呢??」——
 * 換掉 ADR-0030 借來的「已經過的不勾」（那裡的假設是「過去的事合併檔都匯過了」；她是剛壓完就拍）。
 *
 * | 照片 | 過去 | 今天 | 未來 |
 * |---|---|---|---|
 * | 課程完成 | 勾 | 勾 | 不勾（「還沒到就寫完成了」） |
 * | 待確認、聯繫中、確認前往 | 不勾（「日子過了還沒結案」） | 勾 | 勾 |
 * | 客戶失約 | 勾（記成未到、不扣 —— 她第 2 題） | 勾 | 不勾 |
 * | 已取消 | 不勾 | 不勾 | 不勾 |
 *
 * 拿不準的（`photoUnsure()`）不勾。**那一張沒拍到那一欄 → 照舊**：還沒到的勾、已經過的不勾。
 * 這只是照片那一條；認不得人、讀不到全部來訪、app 上取消過……那幾條照舊在 `resolveItem()`。
 */
function photoWantsChecked(item, today) {
  const date = item?.date;
  if (!date || !today) return false;
  if (!item.photoStatus) return date >= today;
  if (photoUnsure(item)) return false;
  if (item.photoStatus === 'done' || item.photoStatus === 'no_show') return date <= today;
  if (item.photoStatus === 'pending_confirm') return date >= today;
  return false;
}

/**
 * 新的那一列，照片上的預約狀態要講的那幾句（03）。**勾不勾都要看得到**：沒勾的時候講為什麼沒先勾好、
 * 勾著的時候講記成什麼 —— 畫面沒勾的時候畫，勾著的時候 `warningsByRow()` 放進 `mustSee`（確認框的 `flagged` 才數得到）。
 *
 * @param {object} item
 * @param {{examDate: string, status: string|null}|null} [block] 二返／n返 簽不成已完成的原因（`cannotClose()`）。
 *   沒給就看列上記著的那一個（`closeBlock`，讀照片那一下算的）；勾著的列由 `planAbovee()` 那一組的 `blocked` 給
 * @returns {string[]}
 */
export function photoRowSays(item, block = item?.closeBlock ?? null) {
  if (item?.kind !== 'new' || item.cancelled) return [];
  if (item.statusConflict) {
    return [`兩張照片上這一段的預約狀態不一樣（${item.statusConflict.map((t) => `「${t}」`).join('、')}）—— 記成待確認，照 Abovee 現在的樣子確定再勾`];
  }
  if (item.statusUnread) return [`${photoStatusSay(item, null)} —— 記成待確認，確定再勾`];
  if (mergedStatusesDiffer(item)) {
    const texts = item.merged.parts.map((p) => `「${p.statusText || '空的'}」`).join('＋');
    return [`合併扣課兩列的預約狀態不一樣（${texts}）—— 記成待確認，確定再勾`];
  }
  if (block) return [`${closeBlockSay(block)}；Abovee 上寫課程完成，這一段先記成待確認`];
  if (item.photoTime === '日子過了還沒結案') return ['日子過了還沒結案 —— Abovee 上還不是完成、取消或失約；勾了記成待確認'];
  if (item.photoTime) return [`${item.photoTime} —— 勾了記成待確認`];
  return [];
}

/**
 * 同一格上 app 那一段跟 Abovee 那一格比一次。**照片為準**（abovee-status-follows-photo 04，推翻 ADR-0116 的「只講不改」）：
 * 她是先在 Abovee 上改好才拍的（她 10/15：「如果是本來app上還沒取消的客拍照拍到已取消了，那也幫我把這堂課的狀態改成已取消」）。
 * 回 `null` ＝ 那不是同一段，照新的一段走。
 *
 * | Abovee ↓ ／ app → | 待確認 | 已確認 | 已完成 | 未到 |
 * |---|---|---|---|---|
 * | 待確認三種 | 不動（過去的日子 ⚠ `bothOpen`） | 不動，**不退回待確認**（同左） | ⚠ `aboveeNotDone` | ⚠ `aboveeNotNoShow` |
 * | 課程完成 | **改成已完成** | **改成已完成** | 不動 | **改成已完成** |
 * | 客戶失約 | **改成未到** | **改成未到** | ⚠ `appDoneStays` | 不動 |
 * | 已取消 | **改成已取消** | **改成已取消** | ⚠ `appDoneStays` | ⚠ `noShowStays` |
 *
 * 「改成已完成／未到」只在今天或過去，還沒到的只提醒（`futureDone`／`futureNoShow`）；「改成已取消」不看日期。
 * 要改的那一列是 `{ kind: 'recorded', statusChange: { from, to } }`（app 已經有這一段了，照片要它換狀態）；
 * 只提醒的是對不上（`kind: 'mismatch'`，進「要你看」，句子在 `mismatchSay()`）。**這裡只判表上那一格** ——
 * 二返簽不簽得成（`cannotClose()`）、讀不讀得到全部來訪、合併扣課兩列一不一樣、沒有時間的舊段，由呼叫端與後處理那幾步再收。
 *
 * - **課程不一樣的不算同一段**：Abovee 上 10:00 的 ILIB 取消了、app 上 10:00 是 SIS —— 那是兩段不同的東西
 * - app 上 10:00 那一段取消了、Abovee 上同一格還掛著（**不管課程一不一樣**，ADR-0144）：照新的一段走、不預設打勾。
 *   Abovee 上也是已取消 → 兩邊都取消、已經記了；Abovee 上是客戶失約 → 只提醒（`appCancelled`）
 * - 拿不準的不比：那一張沒拍到那一欄（`photoStatus` 是 null）、那一格讀不出來 → 已經記了；兩張照片寫的不一樣 → 只提醒（`photosDiffer`）
 *
 * @param {object} item 那一列（`photoStatus`、`statusUnread`、`statusConflict`、`date`）
 * @param {{live: boolean, slots: object[]}} found `existingAt()`
 * @param {object[]} sameCourse `found.slots` 裡課程（與器材）跟這一列一樣的那幾段
 * @param {string} today 拍照那一刻的日期（`todayISO()`）
 * @returns {null|{kind: 'recorded', statusChange?: {from: string, to: string}, hit?: object}
 *   |{kind: 'mismatch', reason: string, appStatus?: string, hit?: object}}  `hit`：比的是 app 上哪一段
 */
function crossCheck(item, found, sameCourse, today) {
  const said = item.statusUnread ? null : item.photoStatus;
  if (!found.live) {
    if (!sameCourse.length) return null;
    // 取消之後在同一格重約的那一段要記得進去；她沒重約、只是還沒回 Abovee 放掉的那一種，那一句照樣講（`newRowSay()`）
    if (said === 'cancelled') return { kind: 'recorded' };
    if (said === 'no_show' && !item.statusConflict) return { kind: 'mismatch', reason: 'appCancelled', appStatus: 'cancelled' };
    return null;
  }
  if (!sameCourse.length) return said === 'cancelled' ? null : { kind: 'mismatch', reason: 'course' };
  // 同一個時間同一門課有兩段（少見）：先找狀態已經一樣的那一段 —— 有的話就是已經記了
  const hit = sameCourse.find((x) => x.status === said) ?? sameCourse[0];
  const app = hit.status;
  const remind = (reason) => ({ kind: 'mismatch', reason, appStatus: app, hit });
  if (item.statusConflict) return remind('photosDiffer');
  if (!said) return { kind: 'recorded', hit };
  const change = (to) => ({ kind: 'recorded', statusChange: { from: app, to }, hit });
  // 今天或過去才改得成已完成／未到（`todayISO()`；沒給今天就當成看不出來 → 只提醒）
  const happened = Boolean(today) && Boolean(item.date) && item.date <= today;

  if (said === 'pending_confirm') {
    if (app === 'done') return remind('aboveeNotDone');
    if (app === 'no_show') return remind('aboveeNotNoShow');
    // app 待確認或已確認、Abovee 待確認：不動 —— **不退回待確認**（app 的「已確認」是她問過客人，Abovee 那一格可能只是沒改）。
    // 日子過了兩邊都還沒結案才講
    return today && item.date && item.date < today ? remind('bothOpen') : { kind: 'recorded', hit };
  }
  if (app === said) return { kind: 'recorded', hit };
  if (said === 'done') return happened ? change('done') : remind('futureDone');
  if (said === 'no_show') {
    if (app === 'done') return remind('appDoneStays');
    return happened ? change('no_show') : remind('futureNoShow');
  }
  // 已取消：不看日期。已完成的鎖著、未到取消不掉（ADR-0111）
  if (app === 'done') return remind('appDoneStays');
  if (app === 'no_show') return remind('noShowStays');
  return change('cancelled');
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
  // ADR-0145：系統裡沒有、照片上也沒有（勾著的）健檢 —— 她 10/9：「先預設不壓，也提醒要先去約健檢 ? 但還是可以先存然後去日曆接」
  if (item.noExam) return '還沒有接得上的健檢 —— 先去約健檢；要先記的話勾起來，約好健檢之後去日曆接。';
  if (!item.appCancelledHere) return '';
  // 同一門課：取消之後又約了同一格（ADR-0144，她 2026-10-09：「預設不勾並提醒已取消過」），或她還沒回 Abovee 放掉
  return item.appCancelledSame
    ? 'app 上這一段取消過 —— 是重新約的再勾；沒有重約的話回 Abovee 放掉那個時段。'
    : 'app 上這個時間有一段取消了，課程跟這一列不一樣 —— 確定是新的一段再勾。';
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
  const photo = `Abovee 上是「${item?.statusText || '？'}」`;
  switch (item?.reason) {
    // 只提醒、不改的那幾格（04 的表上 ⚠ 那幾格）。改了的那幾種不在這裡 —— 它們是「已經記了」＋要改成什麼
    case 'aboveeNotDone': return `${photo}，app 上已經是「${app}」—— Abovee 上還沒改成課程完成。`;
    case 'aboveeNotNoShow': return `${photo}，app 上記「${app}」—— Abovee 上還沒改成客戶失約。`;
    case 'bothOpen': return `日子過了，${photo}、app 上還是「${app}」—— 兩邊都還沒結案。`;
    case 'futureDone': return `還沒到就寫完成了（${photo}），app 上照舊是「${app}」。`;
    case 'futureNoShow': return `還沒到就寫失約了（${photo}），app 上照舊是「${app}」。`;
    case 'appDoneStays': return `${photo}，app 上已經是「已完成」—— 已完成的改不回來，要更正去日曆。`;
    case 'noShowStays': return `${photo}，app 上記「未到」—— 未到取消不掉，要取消先在日曆「退回簽療程單」。`;
    case 'appCancelled': return `${photo}，app 上這一段已經取消了 —— 沒有改。`;
    case 'photosDiffer':
      return `兩張照片上這一段的預約狀態不一樣（${(item.statusConflict ?? []).map((t) => `「${t}」`).join('、')}），`
        + `app 上是「${app}」—— 沒有改，照 Abovee 現在的樣子再拍一次或去日曆改。`;
    case 'closeBlocked': return `${item.closeBlock ? closeBlockSay(item.closeBlock) : '接的那一次健檢還沒做完'}；${photo}，app 這一段先不改。`;
    case 'halvesDiffer': return `合併扣課兩列的預約狀態不一樣（${halvesTexts(item)}），app 上是「${app}」—— 沒有改，去日曆看那一段。`;
    case 'timeless':
      return `app 上這一天的這一段沒有時間（匯入的舊資料），${photo}、app 上是「${app}」—— 沒有自動改，去日曆改。`;
    default: return 'app 裡已經有一段，但做的不一樣。';
  }
}

/** 合併扣課那一對（照片兩列、app 一段）兩列的原字：`「課程完成」＋「確認前往」`。 */
const halvesTexts = (item) => (item?.halfTexts ?? []).map((t) => `「${t || '空的'}」`).join('＋');

/**
 * 認得人之後（或她選了人之後）才算得出來的那幾格：種類、預選的額度／器材／品項／健檢、要不要勾。
 * 她在畫面上換一個人就重算一次。
 */
export function resolveItem(item, customerId, ctx, items = null) {
  const next = {
    ...item, customerId: customerId ?? null,
    entitlementId: null, equipmentId: null, ivProductId: null, followupForVisitId: null, existing: null,
    // 送的／體驗也是上一位的（gift-and-trial 02）：換一個人重算，留著的話她剛換的那一位會被記成送的
    isNth: false, nth: null, giftCourseId: null, giftKind: null, minutes: null,
    // 照片上別列的時間要整張一起看才算得出來（`flagMoved()`）；換一個人就不是那一位的段了
    movedFrom: null, diffs: null, adopt: false, locked: false,
    // 換一個人重算時，上一位的比對結果不可以留著 —— 「照片要把這一段改成什麼」（04）也是：留著的話換成的那一位被改狀態
    reason: null, appStatus: null, appCancelledHere: false, appCancelledSame: false, partialHistory: false,
    statusChange: null, adoptStatus: false, halfTexts: null,
    // 照片為準改期（05）也是整張一起看的（`flagMoved()`）—— 換了人就不是那一位的段了
    move: null, adoptMove: false, moveWarnings: null,
    // 「看起來跟另一列是同一段」是整張一起看的（`flagRepeats()`）；換了人由 `markRepeat()` 再看一次
    repeatOf: null,
    // 「合併扣課的後一半」「沒有時間的舊段」也是整張一起看才認領的（`asRecorded()`）—— 換了人就不是那一段了，
    // 留著的話這一列又對到別的段時會照講「這是合併扣課的後一半」（2026-10-09 審查）
    halfOf: null, timeless: false,
    // 「一次健檢都沒有」也是整張一起看的（`linkBatchExams()`）
    noExam: false,
    // 二返簽不成已完成（03）也是整張一起看的（`flagCloseBlocks()`）
    closeBlock: null,
    // 照片上的狀態在那一天看來合不合理（03）：只看照片與日期，換了人照樣算
    photoTime: item.photoStatus && !item.statusUnread && !item.statusConflict
      ? photoTimeSays(item.photoStatus, item.date, ctx.today) : '',
  };
  if (!next.customerId) return { ...next, kind: 'unknown', checked: false };
  // **她自己選的人不自動勾**（認人沒認出這一位 —— 選了才能勾，勾是她勾）：新的一段、改狀態、換治療師／診間都是（10/16 審查）
  const recognized = !pickedByHand({ ...item, customerId: next.customerId });

  const at = next.date && next.startsAt ? existingAt(next.customerId, next.date, next.startsAt, ctx) : null;
  if (at) {
    const same = sameCourseHere(at, next.course);
    // 10：取消之後在同一格重約 —— 照片上這一格另有一列還掛著（`rebookedHere()`），app 上活著的那一段是那一列的。
    // 取消的這一列**不拿去比**（不然 04 會把重約的那一段取消掉）：照新的、已取消的走（不打勾、不進要你看）。
    // 記著的是「替哪一位看的」—— 她把這一列換成別人就不算了
    const rebooked = next.photoStatus === 'cancelled' && at.live && same.length > 0
      && Boolean(item.rebookedFor) && item.rebookedFor === next.customerId;
    // 預約狀態照照片（04，`crossCheck()` 的表）：要改的那一列是「已經記了」＋`statusChange`、只提醒的是對不上
    const verdict = rebooked ? null : crossCheck(next, at, same, ctx.today);
    if (verdict) {
      const { hit, ...said } = verdict;
      // 比的是 app 上哪一段、那一段她在這一層看到的是什麼（寫之前再比一次，`applyPhotoStatus()`）
      const existing = hit
        ? { visitId: at.visit.id, date: at.visit.date, slotIndex: hit.index, startsAt: hit.slot.startsAt ?? null,
          courseId: hit.slot.courseId ?? null, status: hit.status }
        : { visitId: at.visit.id, date: at.visit.date };
      const out = { ...next, ...said, existing, checked: false };
      if (said.statusChange) {
        // 照片要改這一段的狀態：**預設打勾**（她第 3 題）；這一位的全部來訪讀不到時不勾（次數拿不準）、人是她選的不勾
        const partialHistory = historyPartial(ctx, next.customerId);
        Object.assign(out, { adoptStatus: recognized && !partialHistory, partialHistory });
      }
      // 11：app 上那一段（還活著、同一門課）的治療師或診間跟 Abovee 不一樣 → 講出來。狀態只提醒的那幾種也比
      //（那一段照樣在，她可能只想換診間）；**照片上已經取消的那一段不比**（spec 07：被取消的那一段不再列治療師／診間）
      if (!hit || said.statusChange?.to === 'cancelled') return out;
      const diffs = aboveeDiffs(next, at.visit, same, ctx);
      // 07：治療師／診間預設照 Abovee 改（推翻 ADR-0123 的「她按了才改」）—— 已完成的鎖著，不勾
      return diffs.diffs ? { ...out, ...diffs, adopt: recognized && !diffs.locked, existing: { ...existing, ...diffs.existing } } : out;
    }
    // app 上這個時間有一段取消了（課程一樣或不一樣）：照新的一段走，**不預設打勾**（見 `crossCheck()`）。
    // 哪一種要講的那一句不一樣，所以記著課程一不一樣
    next.appCancelledHere = !at.live;
    next.appCancelledSame = !at.live && same.length > 0;
  }

  const course = next.course;
  // 照片上的分鐘交給 `slotFromPicks()`：只有約的時候選時長的課（二返60）會用到（ADR-0122）
  next.minutes = course?.durationMin ?? null;

  // 「要做什麼」那一排先按好哪一顆。**n返 與不算次數的課在挑額度之前就走自己的路**：`三返` 認出來的
  // 課程是二返那一門，照常去挑額度的話會預選二返那一筆、扣到健檢配的那一次（ADR-0063：n返 不是額度）
  let value = null;
  const courses = ctx.master?.courses ?? [];
  if (course?.nth) value = NTH_PICK;
  // Abovee 寫體驗（06）：那門課的體驗，**不看身上有沒有額度**（她選的：「就算他身上有買那門課也不扣」）。
  // 健檢、二返沒有體驗 → 照下面挑額度，那一列多一句（`trialSay()`）
  else if (isTrialRow(next.row) && canBeGift(courses.find((c) => c.id === course?.courseId), courses)) value = giftPick(course.courseId);
  else {
    const choices = entitlementChoices(next.customerId, course, ctx);
    // 不算次數的課（ADR-0121）：身上還有那門課的額度就照舊扣；沒有剩的才不扣
    const left = choices.filter((c) => c.remaining > 0);
    const ent = obviousEntitlement(course?.uncounted ? left : choices, course);
    value = ent?.id ?? (course?.uncounted && !left.length ? giftPick(course.courseId) : null);
  }
  // 按好之後那幾排（器材、品項、接哪一次健檢）跟她自己按那一顆走同一支
  Object.assign(next, pickOption(next, value, ctx, items));

  // 照照片上的狀態決定（03，`photoWantsChecked()`：過去的完成與失約勾、過去的待確認不勾、未來的完成與失約不勾、
  // 已取消不勾；那一張沒拍到那一欄照舊 ADR-0030 的「還沒到的勾」）；她自己選的人不自動勾（上面的 `recognized`）
  // 09：這一位的全部來訪讀不到 → 上面的預選是拿不完整的那一份算的，不替她勾（`partialSay()` 講出來）
  const partialHistory = historyPartial(ctx, next.customerId);
  const checked = recognized && !next.cancelled && photoWantsChecked(next, ctx.today)
    && !next.appCancelledHere && !partialHistory;
  return { ...next, kind: 'new', checked, partialHistory };
}

/** 這一列的人是她自己選的（照片上的名字與病歷號沒認出這一位）。 */
const pickedByHand = (item) => Boolean(item?.customerId) && item.who?.customer?.id !== item.customerId;

/** 這一列在「要做什麼」那一排按著哪一顆（`slotOptionsFor()` 那一排上的值）。 */
export function optionValueOf(item) {
  if (item?.isNth) return NTH_PICK;
  if (item?.giftCourseId) return giftPick(item.giftCourseId);
  return item?.entitlementId ?? null;
}

/**
 * 「要做什麼」那一排按了一顆（`slotOptionsFor()` 的值：額度 id、`NTH_PICK`、`giftPick()`）→
 * 這一列變成什麼（abovee-and-master/08）。翻譯時先按好的那一顆（`resolveItem()`）也走這一支 ——
 * 兩條路各寫一份的話，她自己按一次跟翻譯按好的那一列會長得不一樣。
 *
 * 接著那幾排照新的那一顆重設，照片上讀得到的先選好：
 * - 擇一池：照片上那一台在池子裡就選它，池子只有一台就選那一台
 * - 品項：**照片上寫的那一款優先**（營養點滴那一格直接寫品項名），沒寫才是額度上買的那一款
 * - 二返：接哪一次健檢只有一次按得下去才選（`onlyOpen()`）。**帶了 `items`（這一張照片上的每一列）就連同這一批一起看** ——
 *   讀照片那一下的預選（`linkBatchExams()`）看整批，她自己再按一次只看資料庫的話，同一列按一次就換一個答案（10/9 審查）
 * - n返：返數照照片（`三返` → 3），照片上不是 n返 就預選三返（她 10/5）；
 *   接哪一次健檢**不替她選**（壓表同一條：n返 是她特地要加的一場，替她決定會讓她漏看）
 *
 * 時長（`minutes`）、診間、治療師、醫師是照片上的，不跟著這一排動。
 */
export function pickOption(item, value, ctx, items = null) {
  const base = {
    ...item,
    entitlementId: null, isNth: false, nth: null, giftCourseId: null, giftKind: null,
    equipmentId: null, followupForVisitId: null, noExam: false,
    ivProductId: item.course?.ivProductId ?? null,
  };
  if (value === NTH_PICK) return { ...base, isNth: true, nth: item.course?.nth ?? MIN_NTH };
  const courseId = giftCourseIdOf(value);
  if (courseId) return { ...base, ...giftRow(item, courseId, ctx) };

  const ent = liveEnts(ctx, item.customerId).find((e) => e.id === value) ?? null;
  if (!ent) return base;
  const wanted = item.course?.equipmentId;
  const row = {
    ...base,
    entitlementId: ent.id,
    // 照片上那一台在池子裡就選它，池子只有一台就選那一台（跟來訪編輯器換額度同一支）
    equipmentId: equipmentAfterSwitch(ent, wanted),
    ivProductId: item.course?.ivProductId ?? ent.ivProductId ?? null,
  };
  // 這一列換成剛選的樣子再問：它原本接著的那一次不可以把自己擋住
  const batch = items ? items.map((i) => (i.key === row.key ? row : i)) : null;
  return { ...row, followupForVisitId: onlyOpen(examChoices(row.customerId, ent, ctx, batch, row)) };
}

/**
 * 「送的／體驗」那一顆按下去，這一列多哪幾格（gift-and-trial 02）。
 *
 * - **體驗還是送的**：這一列原本就是送的／體驗就照舊（換一門送的課還是送的）；其餘是體驗（她：「四門都寫體驗」）
 * - **照片上那一台器材留著**，只要它屬於這門課（`equipmentChoicesFor()`：復能那三台）—— 以前這一條直接回 `base`，
 *   照片上寫的 INDIBA 被丟掉，確認層又只有擇一池才畫器材那一排，停在「先選上面那一台」、沒有東西可以按
 */
function giftRow(item, courseId, ctx) {
  const course = (ctx.master?.courses ?? []).find((c) => c.id === courseId) ?? null;
  const wanted = item.course?.equipmentId ?? null;
  const fits = Boolean(wanted) && equipmentChoicesFor(null, course, ctx.master?.equipment ?? []).some((e) => e.id === wanted);
  return {
    giftCourseId: courseId,
    giftKind: item.giftCourseId && GIFT_KINDS.includes(item.giftKind) ? item.giftKind : 'trial',
    equipmentId: fits ? wanted : null,
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
  // 照片沒拍到「預約狀態」那一欄的列有幾列（01）：整張講一次（`statusColumnSay()`），不每一列各講
  const unseen = rows.filter((r) => !r.statusSeen).length;
  const noStatusColumn = !unseen ? null : unseen === rows.length ? 'all' : 'some';

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
      ...photoStatusOf(row),
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
  // 合併扣課 → 沒有時間的舊段（一對先合成一列，才對得到那一段舊的）→ 搬了時間 → 看起來是同一段 →
  // 二返接哪一次健檢 → 二返照片寫完成、接的那一次還沒做完（要知道接哪一次，排在最後）
  const paired = claimTimeless(mergeRows(claimHalves(items, ctx, { hasColumn }), ctx, { hasColumn }), ctx);
  // 改期要知道這張照片看得到哪一段時間（跟「app 有、這次照片上沒有」同一支，05）
  const moved = flagMoved(paired, ctx, photoBounds(transcripts, paired));
  const linked = linkBatchExams(flagRepeats(moved), ctx);
  // 二返簽不簽得成已完成：既有的那幾段先（要改的 → 對不上），新的那幾列看「記完之後」的健檢；
  // 改期的那一天最後驗一次（撞到別人、二返簽不成 → 不先勾）
  return {
    pairing, counts: sizes, noStatusColumn, items: checkMoves(flagCloseBlocks(gateStatusChanges(linked, ctx), ctx), ctx),
  };
}

/**
 * 一列的預約狀態那三格（01）：`photoStatus`（app 的哪一種；**那一張沒拍到那一欄是 `null`**）、
 * `statusUnread`（拍到了、但那一格空的或認不出來）、`cancelled`（＝照片上已取消；失約不算取消）。
 */
function photoStatusOf(row) {
  if (!row.statusSeen) return { photoStatus: null, statusUnread: false, cancelled: false, statusConflict: null };
  const { status, unread } = statusFromAbovee(row.status);
  // 兩張寫的不一樣（`joinPages()`）：`photoStatus` 照先傳的那一張（畫面印得出來），但拿不準 —— 不寫、不改（04）
  return { photoStatus: status, statusUnread: unread, cancelled: status === 'cancelled', statusConflict: row.statusConflict ?? null };
}

// ---------- 二返接哪一次健檢：整張一起看（ADR-0145）----------

/**
 * 二返那幾列「接哪一次健檢」**連同這一張照片上勾著的健檢一起看**（`examChoices(…, items)`）。後處理的最後一步 ——
 * 前面幾步會改哪幾列是新的、勾不勾，而這一步要知道這一批有哪幾次健檢。
 *
 * - 剛好一次接得上 → 先選好（她回的第 3 題：照舊「剛好一顆按得下去才選」，`onlyOpen()`）；兩次以上就不選
 *   （`resolveItem()` 那時候只看得到資料庫裡的，那一份要重算）
 * - **一列一列接**：前面那一列先選好的那一次，後面那一列看得到它被約走了 —— 各看各的話，一次健檢、兩列二返會各選同一次、
 *   存的時候互相擋住（一次健檢只接一場）
 * - **一次接得上的健檢都沒有**（沒有排著或做完的，系統裡、照片上都沒有）→ 不預設打勾、`noExam`（`newRowSay()` 講「先去約健檢」）
 *
 * n返 不在這裡：它本來就不替她選（`pickOption()`）。
 */
function linkBatchExams(items, ctx) {
  if (!items.some((i) => secondEntOf(i, ctx))) return items;
  const out = items.map((i) => (secondEntOf(i, ctx) ? { ...i, followupForVisitId: null } : i));
  out.forEach((i, at) => {
    const ent = secondEntOf(i, ctx);
    if (!ent) return;
    const choices = examChoices(i.customerId, ent, ctx, out, i);
    out[at] = choices.some((c) => PICKABLE_EXAM.has(c.status))
      ? { ...i, followupForVisitId: onlyOpen(choices) }
      : { ...i, noExam: true, checked: false };
  });
  return out;
}

/**
 * 照片寫課程完成、會記成已完成的新的二返／n返，哪幾列接的那一次健檢還沒做完（03，ADR-0145 的閘門 `cannotClose()`）。
 * **當成每一列都勾著、整批組一次**（`planAbovee()` 的第二圈）：同一張照片上還沒存的健檢要算進去 ——
 * 只看資料庫的話找不到那一次健檢 → 不擋 → 二返記成已完成而健檢還是待確認。
 * 擋的依據只有健檢那幾段，二返彼此不影響，所以一起當成勾著算不會互相干擾。
 *
 * @returns {Map<string, {examVisitId: string, examDate: string, status: string|null}>} 列的 key → 為什麼
 */
function closeBlockedKeys(items, ctx) {
  const wanted = new Set(items.filter((i) => i.kind === 'new' && i.customerId && (i.isNth || secondEntOf(i, ctx))
    && photoSlotStatus(i, ctx.today) === 'done').map((i) => i.key));
  if (!wanted.size) return new Map();
  const { groups } = planAbovee(items.map((i) => (wanted.has(i.key) && !i.checked ? { ...i, checked: true } : i)), ctx);
  return new Map(groups.flatMap((g) => Object.entries(g.blocked ?? {})).filter(([key]) => wanted.has(key)));
}

/**
 * 讀照片那一下（`readAbovee()` 的最後一步）：簽不成已完成的那幾列**不預設打勾**、記著為什麼（`closeBlock`，
 * `photoRowSays()` 講 `closeBlockSay()` 那一句）。勾了照樣記得進去，記成待確認（`planAbovee()`）。
 */
function flagCloseBlocks(items, ctx) {
  const blocked = closeBlockedKeys(items, ctx);
  // 只管新的列：既有那一段的（04，`gateStatusChanges()`）是對不上的理由，不在這裡清
  return items.map((i) => {
    if (i.kind !== 'new') return i;
    if (blocked.has(i.key)) return { ...i, closeBlock: blocked.get(i.key), checked: false };
    return i.closeBlock ? { ...i, closeBlock: null } : i;
  });
}

/**
 * 她勾起／拿掉一列之後重算「二返簽不成已完成」那一個記號（`closeBlock`）—— **只動記號**，勾不勾是她的
 *（同 `refreshNoExam()`）。拿掉照片上那一次健檢的勾，二返那一列的那一句要跟著出來。
 */
export function refreshCloseBlocks(items, ctx) {
  const blocked = closeBlockedKeys(items, ctx);
  return items.map((i) => {
    if (i.kind !== 'new') return i;
    const why = blocked.get(i.key) ?? null;
    return (why === null && !i.closeBlock) ? i : { ...i, closeBlock: why };
  });
}

/** 這一列是新的一場二返嗎：回它扣的那一筆二返額度（不是就 null）。 */
function secondEntOf(item, ctx) {
  if (item?.kind !== 'new' || item.isNth || !item.customerId) return null;
  return liveEnts(ctx, item.customerId).find((e) => e.id === item.entitlementId && e.followupForEntitlementId) ?? null;
}

/**
 * 她在畫面上勾起／拿掉一列之後，重算「一次接得上的健檢都沒有」那一個旗標（`noExam`）—— **只動旗標**，
 * 勾不勾、接哪一次照舊是她的（讀照片那一下的預設才由 `linkBatchExams()` 決定）。勾起照片上那一次健檢之後，
 * 二返那一列「先去約健檢」那一句要跟著收掉；接好了的也收掉。
 */
export function refreshNoExam(items, ctx) {
  return items.map((i) => {
    const ent = secondEntOf(i, ctx);
    const none = Boolean(ent) && !i.followupForVisitId
      && !examChoices(i.customerId, ent, ctx, items).some((c) => PICKABLE_EXAM.has(c.status));
    return none === Boolean(i.noExam) ? i : { ...i, noExam: none };
  });
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
  isNth: false, nth: null, giftCourseId: null, giftKind: null, minutes: null,
  mergeOrphan: false, movedFrom: null, appCancelledHere: false, appCancelledSame: false, partialHistory: false, noExam: false,
  closeBlock: null, statusChange: null, adoptStatus: false, halfTexts: null, move: null, adoptMove: false, moveWarnings: null,
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
 * - 前一列**對到 app 上那一段還活著的都算**：已經記了、照片要改它的狀態（04）、狀態只提醒的對不上（那一段在，只是狀態講不一樣 ——
 *   那一句前一列講了，這一列不再喊一次）。**新的種類或理由沒算進來的話，後一半變成新的一段、預設打勾 → 多扣一次**；
 *   課程不一樣的對不上不算（那不是同一段，`existing` 上也沒有 `slotIndex`）
 * - 後一半寫已取消也認領（04：兩列都寫已取消 → 那一段改成已取消，後一半不可以變成一段新的已取消）
 * - **兩列的預約狀態不一樣 → 前一列不改、只提醒**（`halvesDiffer`）：照片兩列、app 一段，改成哪一個都是猜的
 * - 這一列**不給「改成 Abovee 的」**：那一段的治療師／診間由前一列比（`aboveeDiffs()`），兩列各比一次會指到同一段兩次
 */
function claimHalves(items, ctx, { hasColumn = false } = {}) {
  const held = items.filter((a) => Number.isInteger(a.existing?.slotIndex) && a.course && a.startsAt
    && (a.kind === 'recorded' || a.kind === 'mismatch'));
  if (!held.length) return items;
  const firstOf = new Map();
  for (const b of items) {
    if (b.kind !== 'new' || !b.customerId || !b.date || !b.startsAt || !b.course) continue;
    if (hasColumn && !mergedMark(b.row?.merged)) continue;
    const end = aboveeEnd(b.row?.time);
    if (!end) continue;
    const first = held.find((a) => a.customerId === b.customerId && a.date === b.date
      && aboveeEnd(a.row?.time) === b.startsAt && a.course.courseId === b.course.courseId
      && covers(appSlotOf(a, ctx), b.startsAt, end));
    if (first) firstOf.set(b.key, first);
  }
  if (!firstOf.size) return items;
  // 前一列 → 後一列的原字（兩列的狀態不一樣時前一列要講）
  const differ = new Map([...firstOf].filter(([key, a]) => statusesDiffer(a, items.find((b) => b.key === key)))
    .map(([key, a]) => [a.key, [a.statusText, items.find((b) => b.key === key).statusText]]));
  return items.map((x) => {
    const first = firstOf.get(x.key);
    if (first) return asRecorded(x, { visitId: first.existing.visitId, date: first.existing.date }, { halfOf: first.startsAt });
    if (!differ.has(x.key) || x.kind === 'mismatch') return x;
    return {
      ...x, kind: 'mismatch', reason: 'halvesDiffer', appStatus: x.existing.status ?? null,
      statusChange: null, adoptStatus: false, halfTexts: differ.get(x.key),
    };
  });
}

/** 合併扣課那一對兩列的預約狀態一不一樣（拿不準的也算不一樣：讀不出來、兩張照片不一樣）。 */
const statusesDiffer = (a, b) => (a?.photoStatus ?? null) !== (b?.photoStatus ?? null)
  || Boolean(a?.statusUnread) !== Boolean(b?.statusUnread) || Boolean(a?.statusConflict || b?.statusConflict);

/**
 * 沒有開始時間的舊段：找不到同一個開始時間時，再找「那一天、同一位、同一門課、**沒有開始時間**、還算數」的段。
 *
 * - **先讓沒取消的列認領**，Abovee 上已取消的列只認剩下的、**還開著的**那一段 —— 不然拿取消的那一列去對，
 *   會喊「Abovee 上取消了，app 上還是已完成」，而真的那一列反而變成新的（同一天取消一段、另一段做完了）
 * - **一段舊的只蓋一列**：同一天同一門課真的做了兩次時，第二列照舊是新的。所以要整張一起看（跟 `flagMoved()` 同一層）
 * - 「同一門課」比的是認出來的課程（`sameCourse()`）：擇一池那一列是器材推出來的課程，舊段上有記器材就要同一台，
 *   沒記（匯入的常常沒有）就只比課程
 * - 預約狀態照樣對一次（`crossCheck()`），但**只提醒、不改**（04，spec「我自己定」）：照時間找不到它，照位置找又拿不準是哪一段 ——
 *   照片要改它的話是對不上（`timeless`），去日曆改
 * - **不給「改成 Abovee 的」**：`adoptAbovee()` 靠開始時間找那一段，這一段沒有；匯入的舊段本來就沒有治療師與診間（ADR-0011）
 */
function claimTimeless(items, ctx) {
  const taken = new Set();
  const claim = (item, { openOnly = false } = {}) => {
    if (!item.customerId || !item.date || !item.course) return null;
    for (const visit of ctx.visitsBy?.[item.customerId] ?? []) {
      if (!visit || visit.deletedAt || visit.date !== item.date || !isActive(visit)) continue;
      const index = (visit.slots ?? []).findIndex((s, i) => isLiveSlot(s) && !s.startsAt && !taken.has(`${visit.id}:${i}`)
        && (!openOnly || isOpenStatus(slotStatus(visit, s)))
        && sameCourse({ courseId: s.courseId, equipmentId: s.equipmentId, nth: nthOf(s) }, item.course));
      if (index < 0) continue;
      taken.add(`${visit.id}:${index}`);
      const hit = { slot: visit.slots[index], index, status: slotStatus(visit, visit.slots[index]) };
      const verdict = crossCheck(item, { live: true, slots: [hit] }, [hit], ctx.today);
      const said = verdict.statusChange
        ? { kind: 'mismatch', reason: 'timeless', appStatus: hit.status }
        : { kind: verdict.kind, reason: verdict.reason ?? null, appStatus: verdict.appStatus ?? null };
      return asRecorded(item, { visitId: visit.id, date: visit.date }, { ...said, timeless: true });
    }
    return null;
  };
  const first = items.map((item) => (item.kind === 'new' && !item.cancelled ? claim(item) ?? item : item));
  return first.map((item) => (item.kind === 'new' && item.cancelled ? claim(item, { openOnly: true }) ?? item : item));
}

/**
 * 「已經記了」那一列點開之後那一句：是哪一種已經記了。句子在 domain（同 `mismatchSay()`、`newRowSay()`）。
 */
export function recordedSay(item) {
  if (item?.kind !== 'recorded') return '';
  if (item.halfOf) return `這是合併扣課的後一半 —— app 上 ${item.halfOf} 那一段已經包著它，不用再記。`;
  if (item.statusChange) {
    return `這一段 app 裡已經有了（「${shortStatus(item.statusChange.from)}」）—— 照 Abovee 改成「${shortStatus(item.statusChange.to)}」。`;
  }
  if (item.move) {
    const to = item.move.status === INITIAL_STATUS ? '' : `、記成「${shortStatus(item.move.status)}」`;
    const said = `app 上 ${item.existing.startsAt} 那一段 ${item.movedFrom?.name ?? ''}，Abovee 上改到 ${item.move.slot.startsAt}`
      + ` —— 照 Abovee 改期（${item.existing.startsAt} 那一段取消、${item.move.slot.startsAt} 接上${to}）。`;
    // 讀完整張才知道的那兩種不先勾（`checkMoves()`）：講出來
    const why = item.closeBlock ? closeBlockSay(item.closeBlock) : (item.moveWarnings ?? [])[0];
    return why ? `${said}${why} —— 確定再勾。` : said;
  }
  if (item.cancelled) return '兩邊都是取消的，不用記。';
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

// ---------- 確認層「要改的」那一塊（abovee-status-follows-photo 07）----------
//
// 她 10/15：「如果是修改的，可以區分開來…就是寫的簡短，誰的什麼時候的甚麼改了，打勾就只是改狀態那些等等，
// 不要多記或少記次數! 次數不能弄錯這很重要 ! !」

/** 這一列有沒有要改 app 上既有那一段的事：狀態（04）、改期（05）、治療師／診間（11，鎖著的不算）。抬頭的「要改 N 段」也問它。 */
export const offersChange = (item) => Boolean(item?.customerId)
  && Boolean(item.statusChange || item.move || ((item.diffs?.length ?? 0) > 0 && !item.locked));

/** 治療師／診間那一格的名字（人員走全名，CLAUDE.md「人員的全名與簡寫」）。 */
function assignName(field, id, { staff = [], rooms = [] } = {}) {
  if (field === 'roomId') return (rooms ?? []).find((r) => r.id === id)?.name ?? '（已刪除）';
  return fullNameOf((staff ?? []).find((x) => x.id === id)) || '（已刪除）';
}
const ASSIGN_LABEL = { therapistId: '治療師', roomId: '診間' };

/** 次數那一個括號：拿計畫那一列的 `charge`（扣 +1、還 −1，`photoDayPlan()` 拿寫入那一份算的），不在這裡推。 */
function chargeSay(charge, slot) {
  if (charge > 0) return `（扣 ${charge} 次）`;
  if (charge < 0) return `（還 ${-charge} 次）`;
  return slot?.entitlementId ? '（次數不變）' : '（本來就不扣次數）';
}

/**
 * 「要改的」那一塊每一行（07）。**一行一件事**，`field` 是勾的那一格（`adoptStatus`／`adoptMove`／`adopt`），勾了只改那一件。
 * 句子：`客戶A 9/16 09:00 SIS(60)：已確認 → 已取消（還 1 次）`。括號讀計畫（`plan.rows`）：勾著而計畫裡沒有那一列 ＝ 這一次改不成，
 * 講為什麼（`plan.missed`／`plan.problems`）；沒勾的寫「不改」（＋為什麼沒先勾）。
 * 治療師／診間「app 上空著、照片上有」收成一行（`fill`）—— 合併檔匯進來的都空著（ADR-0011），一列一列攤開會把要看的淹掉。
 *
 * @param {object[]} items 還沒記的列
 * @param {object} plan 那一份 `photoDayPlan()`
 * @param {{customers, visitsBy, master}} ctx
 * @returns {{lines: {key: string, field: string, on: boolean, text: string}[],
 *            fill: {keys: string[], on: boolean, text: string, details: string[]}|null}}
 */
export function changeLines(items, plan, ctx) {
  const rowOf = (key, kind) => (plan?.rows ?? []).find((r) => r.key === key && r.kind === kind) ?? null;
  const stuck = (key, field) => {
    const m = (plan?.missed ?? []).find((x) => x.key === key && (!x.missedField || x.missedField === field));
    if (m?.missedWhy === 'closeBlocked') return m.closeBlock ? closeBlockSay(m.closeBlock) : '接的那一次健檢還沒做完';
    if (m?.missedWhy === 'stale') return '那一段剛在別的地方改過';
    if (m?.missedWhy === 'refused') return '那一段現在的狀態不准這樣改';
    const problem = plan?.problems?.[key]?.[0];
    return problem ? `還差一步：${problem}` : '';
  };
  const offWhy = (item) => (item.closeBlock ? closeBlockSay(item.closeBlock)
    : (item.moveWarnings ?? [])[0] ?? (item.partialHistory ? '這一位過去的來訪沒有讀到全部，次數拿不準'
      : pickedByHand(item) ? '人是你選的，確定再勾' : ''));
  const FIELD_OF = { status: 'adoptStatus', move: 'adoptMove', adopt: 'adopt' };
  const notNow = (item, kind) => {
    const why = stuck(item.key, FIELD_OF[kind]);
    return why ? `（這一次改不成 —— ${why}）` : '';
  };
  const tail = (item, kind, on, slot) => {
    if (!on) {
      const why = offWhy(item);
      return `（不改${why ? ` —— ${why}` : ''}）`;
    }
    const row = rowOf(item.key, kind);
    return row ? chargeSay(row.charge, slot) : notNow(item, kind);
  };

  const lines = [];
  const filling = [];
  for (const item of (items ?? []).filter(offersChange)) {
    const ex = item.existing ?? {};
    const visit = (ctx.visitsBy?.[item.customerId] ?? []).find((v) => v?.id === ex.visitId);
    const slot = visit?.slots?.[ex.slotIndex] ?? null;
    const who = (ctx.customers ?? []).find((c) => c.id === item.customerId)?.name ?? '';
    const head = [who, ex.date ? shortDate(ex.date) : '', ex.startsAt ?? '', slot ? slotName(slot, ctx.master ?? {}, 'short') : '']
      .filter(Boolean).join(' ');
    if (item.statusChange) {
      const { from, to } = item.statusChange;
      lines.push({ key: item.key, field: 'adoptStatus', on: Boolean(item.adoptStatus),
        text: `${head}：${shortStatus(from)} → ${shortStatus(to)}${tail(item, 'status', item.adoptStatus, slot)}` });
    }
    if (item.move) {
      const to = item.move.status === INITIAL_STATUS ? '' : `、記成「${shortStatus(item.move.status)}」`;
      lines.push({ key: item.key, field: 'adoptMove', on: Boolean(item.adoptMove),
        text: `${head}：${ex.startsAt} → ${item.move.slot.startsAt}${to}${tail(item, 'move', item.adoptMove, slot)}` });
    }
    if ((item.diffs?.length ?? 0) > 0 && !item.locked) {
      const said = item.diffs.map((d) => (d.app
        ? `${ASSIGN_LABEL[d.field]} ${assignName(d.field, d.app, ctx.master)} → ${assignName(d.field, d.abovee, ctx.master)}`
        : `${ASSIGN_LABEL[d.field]} ${assignName(d.field, d.abovee, ctx.master)}`)).join('、');
      // 治療師與診間不動次數 —— 不寫括號（她：「不會動到次數的，就是寫的簡短」）；勾著卻改不成的講為什麼
      const off = !item.adopt ? '（不改）' : plan && !rowOf(item.key, 'adopt') ? notNow(item, 'adopt') : '';
      if (item.diffs.every((d) => !d.app)) filling.push({ item, text: `${head}：${said}${off}` });
      else lines.push({ key: item.key, field: 'adopt', on: Boolean(item.adopt), text: `${head}：${said}${off}` });
    }
  }
  if (!filling.length) return { lines, fill: null };
  const fields = new Set(filling.flatMap(({ item }) => item.diffs.map((d) => ASSIGN_LABEL[d.field])));
  const on = filling.every(({ item }) => item.adopt);
  return {
    lines,
    fill: {
      keys: filling.map(({ item }) => item.key),
      on,
      text: `${lines.length ? '另外 ' : ''}${filling.length} 段補上${['治療師', '診間'].filter((x) => fields.has(x)).join('／')}${on ? '' : '（不補）'}`,
      details: filling.map(({ text }) => text),
    },
  };
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

// ---------- 照片要改既有那一段的狀態（abovee-status-follows-photo 04）----------
//
// 她 10/15：「如果是本來app上還沒取消的客拍照拍到已取消了，那也幫我把這堂課的狀態改成已取消」
// 「打勾就只是改狀態那些等等，不要多記或少記次數! 次數不能弄錯這很重要 ! !」
// 要改成什麼是 `crossCheck()` 判的（`statusChange`），這一段只管「怎麼套上去」與「差幾次」。

/**
 * 照片要改的狀態套到**剛讀回來的那一份**來訪上。純函式，照 `adoptAbovee()` 的形狀：她在這一層看到的跟現在不一樣就不蓋。
 *
 * - 套哪幾列：指到這一筆的、有 `statusChange`、勾著的（`adoptStatus`）
 * - 找那一段照 `existing.slotIndex`，再核對開始時間、課程、狀態跟她看到的一樣 —— 不一樣 → 不改（`stale`：剛在別的地方改過）
 * - 一律走既有的那幾支，**不另寫一份轉移表**：取消走 `applyStatus(…, 'cancelled', { slotIndex, reason })`
 *  （照片上的「取消原因」記在那一段上，issue 11；那一天全部取消時整筆那一格也寫）；已完成與未到**一次**交給 `closeVisit()`
 *  （`attended: true/false`，跟簽療程單同一個形狀）—— 同一天健檢與二返都要改成已完成時，同一份 `attended` 裡打勾的健檢才算數
 * - **未到 → 已完成**：先退回簽療程單（`applyStatus(…, 'confirmed')`，ADR-0111 唯一的路）再結。二返／n返 接的那一次健檢
 *   還沒做完（`cannotClose()`，ADR-0145）→ **一格都不動**（`closeBlocked`）—— 停在半路的已確認會多扣一次、又回到簽療程單
 * - 每一步都問狀態機（`applyStatus()`／`closeVisit()` 自己問 `canTransition()`），沒有轉成的是 `refused`
 *
 * @param {object} visit 剛讀回來的那一筆
 * @param {object[]} items 照片上的列（只看指到這一筆的）
 * @param {{at?: string, guard?: {entitlements: object[], visits: object[]}|null}} [o]
 *   `guard`：這位客戶的額度與全部來訪（`closeVisit()` 那一份）—— 二返要看接的那一次健檢。**跨天的時候那一份要是改完之後的**
 *  （別天的健檢這一次也從照片改成已完成）。沒給就不擋（只拿來試算）
 * @returns {{visit: object, missed: object[], freed: number[]}}
 *   `missed`：沒改成的那幾列，多一格 `missedWhy`（`stale`／`closeBlocked`（`closeBlock` 是為什麼）／`refused`）；
 *   `freed`：改成已取消的那幾段（位置）—— 存的時候交給 `save()` 的 `freed`，「取消 Abovee」一出生就勾好（02）
 */
export function applyPhotoStatus(visit, items = [], { at = new Date().toISOString(), guard = null } = {}) {
  const mine = (items ?? []).filter((i) => i?.statusChange && i.adoptStatus && visit?.id && i.existing?.visitId === visit.id);
  const missed = [];
  const freed = [];
  if (!mine.length) return { visit, missed, freed };
  const miss = (item, missedWhy, extra = {}) => missed.push({ ...item, missedWhy, ...extra });
  const seen = withSlotStatuses(visit);
  const ok = mine.filter((item) => {
    const want = item.existing;
    const slot = seen.slots?.[want.slotIndex];
    const same = visit.date === want.date && Boolean(slot) && (slot.startsAt ?? null) === (want.startsAt ?? null)
      && slot.courseId === want.courseId && slotStatus(seen, slot) === want.status;
    if (!same) miss(item, 'stale');
    return same;
  });

  // 已完成與未到：一次交給 `closeVisit()`。未到 → 已完成的先退回簽療程單
  const closing = ok.filter((i) => i.statusChange.to === 'done' || i.statusChange.to === 'no_show');
  const picks = [];
  for (const i of closing) picks[i.existing.slotIndex] = i.statusChange.to === 'done';
  const back = closing.filter((i) => i.existing.status === 'no_show');
  const reopen = (v, list) => list.reduce((x, i) => applyStatus(x, 'confirmed', { slotIndex: i.existing.slotIndex, at }), v);
  // 閘門拿「退回之後」的那一份問：同一天的健檢也是未到 → 已完成時，它要先開著才算「同一份裡打勾」
  const blocked = guard ? closeBlocks(reopen(seen, back), picks, guard) : new Map();
  for (const i of closing) {
    if (!blocked.has(i.existing.slotIndex)) continue;
    miss(i, 'closeBlocked', { closeBlock: blocked.get(i.existing.slotIndex) });
    picks[i.existing.slotIndex] = null;
  }
  let next = reopen(seen, back.filter((i) => !blocked.has(i.existing.slotIndex)));
  if (picks.some((p) => p === true || p === false)) next = closeVisit(next, picks, at, guard);
  for (const i of closing) {
    if (!blocked.has(i.existing.slotIndex) && slotStatus(next, next.slots[i.existing.slotIndex]) !== i.statusChange.to) miss(i, 'refused');
  }

  for (const i of ok.filter((x) => x.statusChange.to === 'cancelled')) {
    const after = applyStatus(next, 'cancelled', { slotIndex: i.existing.slotIndex, reason: i.row?.cancelReason ?? null, at });
    if (after === next || slotStatus(after, after.slots[i.existing.slotIndex]) !== 'cancelled') {
      miss(i, 'refused');
      continue;
    }
    next = after;
    freed.push(i.existing.slotIndex);
  }
  return { visit: missed.length === mine.length ? visit : next, missed, freed };
}

/**
 * 這一次記完之後這一位的全部來訪（**閘門還沒擋的樣子**）：存著的那幾筆套上照片要改的狀態（`applyPhotoStatus()`）、
 * 加上這一次要記的那幾組（暫時 id，`plannedId()`）。二返簽不簽得成已完成要看接的那一次健檢**記完之後**是什麼 ——
 * 那一次可能這一次才從照片改成已完成（04），也可能是同一張照片上新記的（03）。
 * 擋的依據只有健檢那幾段（健檢不會被擋），所以「沒擋的樣子」就是健檢記完之後的樣子。
 */
function afterPhoto(customerId, groups, items, ctx) {
  const planned = (groups ?? []).filter((g) => g.customerId === customerId && g.visit).map((g) => ({ ...g.visit, id: plannedId(g) }));
  const replaced = new Set(planned.map((v) => v.id));
  return [...(ctx.visitsBy?.[customerId] ?? []).filter((v) => v && !replaced.has(v.id)), ...planned]
    .map((v) => applyPhotoMove(applyPhotoStatus(v, items).visit, items).visit);
}

/**
 * 讀照片那一下：照片要把哪一段二返／n返 改成已完成、接的那一次健檢**記完之後**還是沒做完的（`cannotClose()`，ADR-0145）→
 * 不改、對不上（`closeBlocked`，`mismatchSay()` 講 `closeBlockSay()` 那一句）。spec：「簽不成已完成 → 只提醒」。
 * 她之後拿掉健檢那一列的勾：寫的時候 `applyPhotoStatus()` 的 guard 再擋一次（`missed`）。
 */
function gateStatusChanges(items, ctx) {
  const wanted = items.filter((i) => i.statusChange?.to === 'done' && i.customerId);
  if (!wanted.length) return items;
  const { groups } = planAbovee(items, ctx);
  const blocked = new Map();
  for (const customerId of new Set(wanted.map((i) => i.customerId))) {
    const visits = afterPhoto(customerId, groups, items, ctx);
    const entitlements = ctx.entitlementsBy?.[customerId] ?? [];
    for (const i of wanted.filter((x) => x.customerId === customerId)) {
      const visit = visits.find((v) => v.id === i.existing.visitId);
      const why = visit ? cannotClose(visit, i.existing.slotIndex, [], { entitlements, visits }) : null;
      if (why) blocked.set(i.key, why);
    }
  }
  if (!blocked.size) return items;
  return items.map((i) => (blocked.has(i.key)
    ? { ...i, kind: 'mismatch', reason: 'closeBlocked', appStatus: i.existing.status, closeBlock: blocked.get(i.key),
      statusChange: null, adoptStatus: false }
    : i));
}

/**
 * 改之前與改之後，每一筆額度差幾次（04 第 7 點）：同一份來訪各跑一次 `counts()` 相減 —— **跟寫入同一份輸入**，
 * 不在畫面上照表推（ADR-0070、lessons 五）。營養品不算（排不進來訪）。只回有變的那幾筆，每一格是「改之後 − 改之前」：
 * 已確認 → 已完成是 `done +1、booked −1、remaining 0`（次數不變）；已確認 → 已取消是 `remaining +1`（還 1 次）。
 *
 * @returns {{entitlementId: string, remaining: number, done: number, booked: number, noShow: number}[]}
 */
export function countDeltas(entitlements = [], before = [], after = []) {
  return (entitlements ?? []).filter((e) => e && !e.deletedAt && !isProduct(e)).map((e) => {
    const [was, now] = [counts(e, before, e.id), counts(e, after, e.id)];
    return {
      entitlementId: e.id,
      remaining: now.remaining - was.remaining,
      done: now.done - was.done,
      booked: now.booked - was.booked,
      noShow: now.noShow - was.noShow,
    };
  }).filter((d) => d.remaining || d.done || d.booked || d.noShow);
}

/**
 * 這一列（照片要改既有那一段的狀態）改了之後那一筆額度差幾次 —— 給「要改的」那一塊的括號（07）與確認框加總。
 * 拿手上這一位的全部來訪試算，套的是寫入那一支（`applyPhotoStatus()`，帶閘門）。
 */
export function photoChangeDelta(item, ctx) {
  const visits = ctx.visitsBy?.[item?.customerId] ?? [];
  const visit = visits.find((v) => v?.id === item?.existing?.visitId);
  if (!visit || !item?.statusChange) return [];
  const entitlements = ctx.entitlementsBy?.[item.customerId] ?? [];
  const { visit: after } = applyPhotoStatus(visit, [{ ...item, adoptStatus: true }], { guard: { entitlements, visits } });
  return countDeltas(entitlements, visits, visits.map((v) => (v === visit ? after : v)));
}

// ---------- Abovee 改了時間、app 還沒改（10）----------

/**
 * Abovee 上把 10:00 的 SIS 改到 11:00、app 上還沒改：11:00 那一列找不到同一個時間的段。
 *
 * **拿得準的那一對 → 照片為準改期**（abovee-status-follows-photo 05，她 10/15：「我都在abovee改好了，不用再叫我去取消和重排啊」）：
 * 那一列變成「已經記了」＋`move`（不再是新的一段 —— 不然舊的沒取消、新的多一段，多扣一次；`planAbovee()`、
 * `linkBatchExams()`、`examChoices()` 都只收新的列），預設打勾（`adoptMove`）。拿得準＝
 * - **剛好一對**：這一列只對得到 app 上一段、那一段也只被這一列對到（兩段對一列、一段對兩列都拿不準）
 * - 舊的那個時間**落在這張照片的範圍裡**（`photoBounds()`，跟「app 有、這次照片上沒有」同一支）—— 照片從 10:30 才開始拍的話，
 *   10:00 那一段可能在上一頁
 * - 舊的那一段還開著（待確認／已確認 —— 已完成、未到不搬，`rebookSlot()` 本來就不搬）、照片上這一列不是已取消（已取消的不叫改期）
 *
 * **拿不準的照舊**（abovee-and-master/10）：新的、不預設打勾、講一句、給一顆去日曆；勾了就是她確定是另一段。
 * 不判成「對不上」：`planAbovee()` 只收新的列，判成對不上的話照片只拍到同一天的第二段（真的是另一段）時就記不了。
 *
 * **不同天的改期不在這裡**（只看同一天）：舊的那一段留在「app 有、這次照片上沒有」、新的那一列照新列的規則。
 */
function flagMoved(items, ctx, bounds) {
  const olds = new Map();
  for (const item of items) {
    if (item.kind !== 'new' || item.cancelled || !item.customerId || !item.date || !item.course) continue;
    // 照片上這一位這一天出現過的每一個時間都算「有人對到了」（取消的列也算）—— 先把同一個時間的配完，
    // 再看剩下的：同一天上午、下午各一段 SIS 時兩列各對各的，不會互相搶
    const seen = new Set(items.filter((o) => o.customerId === item.customerId && o.date === item.date).flatMap(timesOf));
    const found = movedSlots(item, seen, ctx);
    if (found.length) olds.set(item.key, found);
  }
  const claims = new Map();
  for (const found of olds.values()) for (const o of found) claims.set(o.id, (claims.get(o.id) ?? 0) + 1);

  return items.map((item) => {
    const found = olds.get(item.key);
    if (!found) return item;
    const [old] = found;
    const movedFrom = { startsAt: old.slot.startsAt, name: slotName(old.slot, ctx.master ?? {}, 'short') };
    // 照片上這一列讀不出時間就不知道改到哪裡 —— 照舊
    const sure = Boolean(item.startsAt) && found.length === 1 && claims.get(old.id) === 1 && acceptsMoreSlots(old.status)
      && inPhoto(bounds, item.date, old.slot.startsAt);
    if (!sure) return { ...item, movedFrom, checked: false };
    const existing = {
      visitId: old.visit.id, date: old.visit.date, slotIndex: old.index,
      startsAt: old.slot.startsAt, courseId: old.slot.courseId, status: old.status,
    };
    const partialHistory = historyPartial(ctx, item.customerId);
    return asRecorded(item, existing, {
      movedFrom,
      move: { slot: movedSlotFields(item, old, ctx), status: photoSlotStatus(item, ctx.today) },
      // 照片上的狀態那一張表（過去還寫確認前往、還沒到就寫完成……不勾）、讀不到全部來訪、app 上新的那個時間取消過 —— 不先勾。
      // 撞到別人、二返簽不成已完成是讀完整張之後才知道的（`checkMoves()`）
      adoptMove: photoWantsChecked(item, ctx.today) && !partialHistory && !item.appCancelledHere,
      partialHistory,
    });
  });
}

/** app 上那一天還活著、同一個課程（器材對得上、返數一樣）、照片上沒有那個時間的那幾段。 */
function movedSlots(item, seen, ctx) {
  const { courseId, equipmentId, nth = null } = item.course;
  const out = [];
  for (const visit of ctx.visitsBy?.[item.customerId] ?? []) {
    if (!visit || visit.deletedAt || visit.date !== item.date || !isActive(visit)) continue;
    (visit.slots ?? []).forEach((slot, index) => {
      if (isLiveSlot(slot) && slot.courseId === courseId
        && (!equipmentId || !slot.equipmentId || slot.equipmentId === equipmentId)
        && (nthOf(slot) ?? null) === nth
        && slot.startsAt && !seen.has(slot.startsAt)) {
        out.push({ id: `${visit.id}:${index}`, visit, index, slot, status: slotStatus(visit, slot) });
      }
    });
  }
  return out;
}

/**
 * 改期之後新的那一段跟舊的不一樣的那幾格：時間（**時長照舊** —— 額度沒變，Abovee 那一格的結束時間常常多算了準備的時間）、
 * 治療師、醫師、診間照照片（照片上認不出來的那一格留著原本的；診間只比要診間的課，同 `aboveeDiffs()`，換了清 `bed`）。
 * 額度、器材、品項、接哪一次健檢照舊那一段 —— 換了就不是改期了。
 */
function movedSlotFields(item, old, ctx) {
  const { slot } = old;
  const span = slot.startsAt && slot.endsAt ? toMinutes(slot.endsAt) - toMinutes(slot.startsAt) : null;
  const course = (ctx.master?.courses ?? []).find((c) => c.id === slot.courseId);
  const ent = liveEnts(ctx, item.customerId).find((e) => e.id === slot.entitlementId) ?? null;
  const assigns = course ? assignsFor(ent, course, slot.equipmentId) : null;
  const roomOf = (id) => (ctx.master?.rooms ?? []).find((r) => r.id === id) ?? null;
  const room = assigns === 'room' && item.roomId && item.roomId !== slot.roomId
    && !isBedlessOf(roomOf(item.roomId), roomOf(slot.roomId)) ? item.roomId : null;
  return {
    startsAt: item.startsAt,
    endsAt: span > 0 ? endOf(item.startsAt, span) : (aboveeEnd(item.row?.time) ?? slot.endsAt ?? null),
    therapistId: item.therapistId ?? slot.therapistId ?? null,
    doctorId: item.doctorId ?? slot.doctorId ?? null,
    ...(room ? { roomId: room, bed: null } : {}),
  };
}

/**
 * 照片為準改期，套到**剛讀回來的那一份**來訪上（05）。純函式，照 `applyPhotoStatus()` 的形狀：她在這一層看到的跟現在不一樣就不改。
 *
 * - 套哪幾列：指到這一筆的、有 `move`、勾著的（`adoptMove`）
 * - 舊的那一段照 `existing.slotIndex` 找，核對開始時間、課程、狀態跟她看到的一樣 —— 不一樣 → 不改（`stale`）
 * - 一律走 `rebookSlot()`（ADR-0108：舊的取消、新的接在尾巴），新的那一段的狀態照照片（`move.status`）
 * - 照片寫課程完成的二返／n返，接的那一次健檢還沒做完（`cannotClose()`，ADR-0145）→ 照樣改期、**新的那一段記成待確認**（同 03 的新列），
 *   回在 `blocked`。閘門拿 `guard`（這位客戶記完之後的全部來訪）問；沒給就不擋（只拿來試算）
 *
 * @returns {{visit: object, missed: object[], freed: number[], blocked: Record<string, object>, at: Record<string, number>}}
 *   `at`：列的 key → 新的那一段在這一筆裡的位置；`freed`：取消掉的舊時間那幾段 —— 存的時候交給 `save()` 的 `freed`，「取消 Abovee」一出生就勾好（02）
 */
export function applyPhotoMove(visit, items = [], { at = new Date().toISOString(), guard = null } = {}) {
  const mine = (items ?? []).filter((i) => i?.move && i.adoptMove && visit?.id && i.existing?.visitId === visit.id);
  const missed = [];
  const freed = [];
  const blocked = {};
  /** 列的 key → 新的那一段在這一筆裡的位置（提醒、次數歸到這一列，06） */
  const where = {};
  let next = visit;
  for (const item of mine) {
    const want = item.existing;
    const seen = withSlotStatuses(next);
    const old = seen.slots?.[want.slotIndex];
    const same = next.date === want.date && Boolean(old) && (old.startsAt ?? null) === (want.startsAt ?? null)
      && old.courseId === want.courseId && slotStatus(seen, old) === want.status;
    if (!same) {
      missed.push({ ...item, missedWhy: 'stale' });
      continue;
    }
    const moved = { ...old, ...item.move.slot };
    let after = rebookSlot(next, want.slotIndex, moved, { status: item.move.status, at });
    const why = after && item.move.status === 'done' && guard
      ? cannotClose(after, after.slots.length - 1, [], guard) : null;
    if (why) {
      blocked[item.key] = why;
      after = rebookSlot(next, want.slotIndex, moved, { at });
    }
    if (!after) {
      missed.push({ ...item, missedWhy: 'refused' });
      continue;
    }
    next = after;
    freed.push(want.slotIndex);
    where[item.key] = after.slots.length - 1;
  }
  return { visit: next, missed, freed, blocked, at: where };
}

/**
 * 讀照片的最後一步（05）：拿得準、預設打勾的改期，**套上去之後**那一天驗一次（`validateVisit()` 與 `warningDetails()`）——
 * 新的時間撞到別人（同一間診間、同一位治療師）、跟同一天別段重疊、二返簽不成已完成 → **不預設打勾、講出來**（`moveWarnings`／`closeBlock`）。
 * 勾了照樣改（撞期在 app 裡從來不擋，ADR-0094）；有錯誤的照片上的計畫會擋（06）。驗證拿這一次記完之後的全部來訪（`afterPhoto()`）。
 */
function checkMoves(items, ctx) {
  const wanted = items.filter((i) => i.move && i.adoptMove);
  if (!wanted.length) return items;
  const { groups } = planAbovee(items, ctx);
  const notes = new Map();
  for (const item of wanted) {
    const visit = (ctx.visitsBy?.[item.customerId] ?? []).find((v) => v?.id === item.existing.visitId);
    if (!visit) continue;
    const guard = { entitlements: ctx.entitlementsBy?.[item.customerId] ?? [], visits: afterPhoto(item.customerId, groups, items, ctx) };
    const { visit: after, blocked } = applyPhotoMove(visit, [item], { guard });
    if (blocked[item.key]) {
      notes.set(item.key, { adoptMove: false, closeBlock: blocked[item.key] });
      continue;
    }
    const check = checkCtxFor(groups, { customerId: item.customerId, date: after.date, visit: after }, ctx);
    const at = after.slots.length - 1;
    const said = [
      ...validateVisit(after, check).errors,
      ...warningDetails(after, check).filter((w) => mustSee(w) && w.slots.includes(at)).map((w) => w.text),
    ];
    if (said.length) notes.set(item.key, { adoptMove: false, moveWarnings: said });
  }
  return items.map((i) => (notes.has(i.key) ? { ...i, ...notes.get(i.key) } : i));
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
    && !i.isNth && !i.giftCourseId && i.course)
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
    // 送的／體驗的列不扣，沒有「扣兩次」的風險 —— 不標（06）
    if (hasColumn && i.kind === 'new' && !i.cancelled && !i.giftCourseId && mergedMark(i.row?.merged)) {
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
  // 治療師／診間不一樣：改得了的在「要改的」那一塊（07，`changeLines()`），不再排進來 —— 同一列兩邊都出現就是兩個地方各記一份。
  // 已完成鎖著、改不了的照舊要你看（只能提醒）
  || (item?.kind === 'recorded' && Boolean(item?.locked) && (item?.diffs ?? []).some((d) => d.app))
  // app 上取消過的同一段（ADR-0144）：以前是「對不上」，現在是新的一段 —— 照舊排在最前面要她看
  || (!item?.cancelled && item?.kind === 'new' && Boolean(item?.mergeOrphan || item?.movedFrom || item?.appCancelledSame || item?.noExam))
  // 照片上的預約狀態不合理或拿不準（03）：還沒到就寫完成／失約、日子過了還沒結案、讀不出來、兩張不一樣、
  // 合併扣課兩列不一樣、二返簽不成已完成 —— 這幾種都沒先勾好，要她決定（`photoRowSays()` 講為什麼）
  || (!item?.cancelled && item?.kind === 'new' && photoRowSays(item).length > 0)
  || (!item?.cancelled && item?.kind === 'unknown' && item?.who?.how !== 'none');

/**
 * 「要你看」裡面收起來的那一種（中途發現 5，她 10/15：「應該不常發生…用收合的就好」）：**日子過了、Abovee 上還是待確認那三種**，
 * app 上沒有（新的那一列只剩「日子過了還沒結案」那一句）或 app 上也還沒結案（`bothOpen`）。拍一張比較舊的頁面時一次好幾列，
 * 排在最上面會把真的要決定的擠下去。別的理由也在的（二返簽不成、找不到另一半、取消過…）不收。
 */
export const pastStillOpen = (item) => (item?.kind === 'mismatch' && item.reason === 'bothOpen' && !item.closeBlock)
  || (item?.kind === 'new' && !item.cancelled && !newRowSay(item)
    && (photoRowSays(item)[0] ?? '').startsWith('日子過了還沒結案'));

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
    // 兩邊都取消的那一列不算「已經記了」—— 它是已取消（ADR-0116）；要改的那幾段另外數（07）
    recorded: count((i) => i.kind === 'recorded' && !i.cancelled && !offersChange(i)),
    changes: count(offersChange),
    // 收起來的那幾列（`pastStillOpen()`）另外數，不算進「要你看」—— 抬頭的數字要跟攤開的那一組一樣
    attention: count((i) => needsAttention(i) && !pastStillOpen(i)) + (absent ?? []).length,
    pastOpen: count((i) => needsAttention(i) && pastStillOpen(i)),
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
 * 這一次照片看得到哪幾段時間（`photoSpan()` → `boundsOf()`）。**「app 有、這次照片上沒有」（ADR-0129）與
 * 「Abovee 改了時間」（`flagMoved()`，abovee-status-follows-photo 05）共用這一支** —— 各算一次的話，
 * 一邊把 10:00 喊成沒拍到、另一邊卻當成拍到了去改期。照片上每一列都認出來、而且是同一位 → `customerId` 是他（放寬到整個月的那一條要它）。
 *
 * @returns {{customerId: string|null, ranges: {lo: object, hi: object}[], why: null|'noDates'|'unsorted'}}
 */
export function photoBounds(transcripts, items) {
  const span = photoSpan(transcripts);
  if (span.why) return { customerId: null, ranges: [], why: span.why };
  const ids = new Set((items ?? []).map((i) => i.customerId ?? null));
  const customerId = ids.size === 1 && !ids.has(null) ? [...ids][0] : null;
  return { customerId, ranges: span.segments.map((seg) => boundsOf(seg, span, Boolean(customerId))), why: null };
}

/** 那一天那個時間落不落在這張照片看得到的範圍裡（`photoBounds()`）。 */
const inPhoto = (bounds, date, startsAt) => (bounds?.ranges ?? []).some((r) => within(r, date, startsAt));

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
  const { customerId, ranges, why } = photoBounds(transcripts, list);
  if (why) return { checked: null, why, slots: [] };
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
        if (!inPhoto({ ranges }, visit.date, slot.startsAt)) return;
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
    giftCourseId: item.giftCourseId ?? null,
    // 沒有 giftCourseId 的列這一格不算數（`slotFromPicks()` 只在走送的／體驗那一條時讀它）
    giftKind: item.giftCourseId ? (item.giftKind ?? 'trial') : null,
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
 *   `blocked`：照片寫課程完成、卻簽不成已完成的二返／n返（列的 key → `cannotClose()` 的為什麼），那一段記成待確認
 *   `freed`：照片上已經放掉、記成已取消的那幾段（在那一筆來訪裡的位置）—— 存的時候交給 `save()` 的 `freed`，
 *   「取消 Abovee」一出生就勾好（abovee-status-follows-photo 02）
 *
 * **每一段的狀態照照片**（03，`photoSlotStatus()`），整筆照時段推（`visitWithSlot()`、`withPlannedSlot()`）。
 * **同一組（一位一天）的段一律接進這一組自己那一筆**：要不要併進 app 上那一天既有的那一筆只在第一段問 ——
 * 以前每一段都重問，第一段把新的那一筆推成已完成之後，第二段另開一筆、把第一段蓋掉。
 *
 * 二返／n返 照片寫完成、接的那一次健檢還沒做完（ADR-0145）：**組好整批再看一次**（同一張照片上還沒存的健檢要算進去，
 * `visitsForCheck()`），擋到的那幾段改成待確認、整批重組一次。擋的依據只有健檢那幾段 —— 二返改成待確認不會讓別段變，
 * 所以重組一次就定了。
 */
export function planAbovee(items, ctx) {
  const first = composeGroups(items, ctx, new Map());
  const blocked = blockedInGroups(first.groups, items, ctx);
  const { groups, problems } = blocked.size ? composeGroups(items, ctx, blocked) : first;
  for (const g of groups) {
    g.blocked = Object.fromEntries(g.items.filter((i) => blocked.has(i.key)).map((i) => [i.key, blocked.get(i.key)]));
  }
  return { groups, problems };
}

/** `planAbovee()` 的一圈：勾著的列組成一位一天一筆。`blocked` 裡的那幾列記成待確認。 */
function composeGroups(items, ctx, blocked) {
  const { courses = [], equipment = [], ivProducts = [] } = ctx.master ?? {};
  const byId = new Map((ctx.customers ?? []).map((c) => [c.id, c]));
  const groups = new Map();
  const problems = {};

  const chosen = (items ?? []).filter((i) => i.checked && i.customerId && i.kind === 'new')
    .slice()
    .sort((a, b) => `${a.customerId}|${a.date}|${a.startsAt}`.localeCompare(`${b.customerId}|${b.date}|${b.startsAt}`));

  for (const item of chosen) {
    const status = blocked.has(item.key) ? INITIAL_STATUS : photoSlotStatus(item, ctx.today);
    const { slot, errors } = slotFromPicks({ ...picksOf(item), status, cancelReason: item.row?.cancelReason ?? null }, {
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
      afterClosed: false, at: {}, freed: [],
    };
    // 第一段才問那一天有沒有收得下的那一筆；接下來的段接進這一組自己那一筆（`withPlannedSlot()`）
    const step = group.visit
      ? withPlannedSlot(group.visit, slot)
      : visitWithSlot({ customerId: item.customerId, customerName }, item.date, slot, ctx.visitsBy?.[item.customerId] ?? []);
    // 這一組的第一段沒有併進任何一筆、而那一天有結案的 → 另開一次（同一組接下來的段併進剛開的那一筆）
    if (!group.visit && !step.merged) {
      group.afterClosed = sameDayState(ctx.visitsBy?.[item.customerId] ?? [], item.customerId, item.date).closed.length > 0;
    }
    group.visit = step.visit;
    // 新的一段一律接在尾巴（`withExtraSlot()`、新的一筆照順序接）
    group.at[item.key] = step.visit.slots.length - 1;
    if (slot.status === 'cancelled') group.freed.push(group.at[item.key]);
    group.reopened = group.reopened || Boolean(step.merged?.reopened ?? step.reopened);
    group.items.push(item);
    groups.set(key, group);
  }

  return { groups: [...groups.values()], problems };
}

/**
 * 組好的那幾組裡，照片寫課程完成、記成已完成的二返／n返，接的那一次健檢還沒做完（`cannotClose()`，ADR-0145）。
 * 那一次健檢拿**記完之後**的那一份找（`afterPhoto()`：連這一次別組要記的、照片要改的狀態一起）。
 *
 * @returns {Map<string, {examVisitId: string, examDate: string, status: string|null}>}
 */
function blockedInGroups(groups, items, ctx) {
  const out = new Map();
  for (const g of groups) {
    const entitlements = ctx.entitlementsBy?.[g.customerId] ?? [];
    let visits = null;
    for (const item of g.items) {
      const index = g.at[item.key];
      const slot = g.visit.slots[index];
      if (slot?.status !== 'done' || !slot.followupForVisitId) continue;
      // 記完之後的樣子（`afterPhoto()`）：接的那一次健檢可能這一次才從照片改成已完成（04）
      visits ??= afterPhoto(g.customerId, groups, items, ctx);
      const visit = visits.find((v) => v.id === plannedId(g)) ?? g.visit;
      const why = cannotClose(visit, index, [], { entitlements, visits });
      if (why) out.set(item.key, why);
    }
  }
  return out;
}

// ---------- 一位一天一份計畫（abovee-status-follows-photo 06）----------
//
// 「拍完、記錄之後那一天長什麼樣」只算一次：確認層的驗證與提醒（`plan()`）、確認框（`aboveeConsequences()`）、
// 真的寫入（`record()` → `writePhotoPlan()`）**三邊都只讀 `photoDayPlan()`**。以前三邊各算一份 —— 照片上「舊時間已取消＋
// 新時間的二返」、合併扣課的後一半、同一天兩筆的那一天，三邊講三種結果（lessons 一、五）。

/** 這一列這一次會寫進去嗎：勾著的新的、按著的「改成 Abovee 的」、打著勾的改狀態（04）與改期（05）。 */
export const wantsWrite = (item) => Boolean(item?.customerId) && (
  (item.kind === 'new' && Boolean(item.checked))
  || (Boolean(item.adopt) && (item.diffs?.length ?? 0) > 0)
  || (Boolean(item.statusChange) && Boolean(item.adoptStatus))
  || (Boolean(item.move) && Boolean(item.adoptMove)));

/**
 * 底下那一顆要數的（10/16 審查）：她勾著的那幾列（`wanted`，`wantsWrite()` 的）裡，**這一份計畫真的會寫的**記新的幾段、改既有的幾段；
 * 還差一步的（`problems`）與這一次改不成的（不在任何一筆 `writes` 裡，例：她看到的那一段剛在別的地方改過、二返簽不成）。
 * 以前那一顆數的是勾著的：每一件都改不成時照樣寫「改這 1 段」、按得下去，按了什麼都沒發生。
 */
export function recordBar(wanted = [], plan = {}) {
  const going = new Set((plan.writes ?? []).flatMap((w) => w.keys));
  const will = wanted.filter((i) => going.has(i.key));
  const fresh = will.filter((i) => i.kind === 'new').length;
  return {
    fresh,
    changed: will.length - fresh,
    stuck: wanted.filter((i) => plan.problems?.[i.key]).length,
    cannot: wanted.filter((i) => !going.has(i.key) && !plan.problems?.[i.key]).length,
  };
}

/** 那一顆上面那一句（還差一步、這一次改不成、還沒勾）。 */
export function recordBarSay({ fresh = 0, changed = 0, stuck = 0, cannot = 0 } = {}) {
  if (stuck) return `勾起來的有 ${stuck} 段還差一步，點開補上`;
  if (cannot) return `勾起來的有 ${cannot} 段這一次改不成（「要改的」那一塊寫著為什麼）`;
  return fresh + changed ? '' : '勾起要記的那幾段';
}

/** 那一段現在扣不扣著它的額度（1／0）。`counts()` 一段一段加起來就是它（`slotOutcome()`）。 */
const charge = (visit, index) => (visit && chargesEntitlement(visit, visit.slots?.[index]) ? 1 : 0);

/**
 * 這一批勾著的列記完之後，每一位每一天長什麼樣。**組法**：重讀的那一份 → 「改成 Abovee 的」（`adoptAbovee()`）→
 * 照片的狀態（`applyPhotoStatus()`）→ 改期（`applyPhotoMove()`）→ 新的段（`planAbovee()`，**拿改完之後的那一份組** ——
 * 要不要併進那一天、那一天結案了沒，看的是改完之後的）。閘門（二返簽不成已完成）拿記完之後的全部來訪問（`afterPhoto()`）。
 *
 * **驗證拿改完之後的那一天**：取消掉的那一段不再佔著那一次健檢、不再算進超用。新的段的錯誤照舊擋那一組（`problems`）；
 * 改期那一段的錯誤擋那一列（那一筆不寫）；改狀態與換治療師／診間只拿提醒（舊資料本來就可能驗不過，不可以因此改不了狀態）。
 *
 * @param {object[]} items 這一次還沒記的列（她看到的那一份）
 * @param {{customers, entitlementsBy, visitsBy, master, today, partial?}} ctx `visitsBy` 是讀回來的全部來訪
 * @param {{at?: string}} [o]
 * @returns {{
 *   groups: object[], problems: Record<string, string[]>, warningsBy: Record<string, string[]>, mustSeeBy: Record<string, string[]>,
 *   writes: {id: string, customerId: string, customerName: string, date: string, visit: object, before: object|null,
 *            freed: number[], keys: string[], adds: object|null, touch: object|null, pressed: boolean}[],
 *   missed: object[], rows: {key: string, customerId: string, date: string, kind: 'new'|'status'|'move'|'adopt', to?: string,
 *                            charge: number, fields?: string[]}[],
 *   before: Record<string, object[]>, after: Record<string, object[]>, deltas: Record<string, object[]>,
 * }}
 *   `writes`：要存的每一筆，**照存的先後**（被接著的那幾筆先存，ADR-0145）；`id` 是 `plannedId()`（新的一筆是暫時的）、
 *   `freed` 給 `save()`（「取消 Abovee」一出生就勾好，02）、`keys` 是這一筆寫進去的那幾列、`pressed` 是那一天有沒有一段活著的新段（標壓完）。
 *   `rows`：每一列做了什麼、那一筆額度因此差幾次（`charge`：扣 +1、還 −1；跟 `counts()` 一段一段加起來同一個數）。
 *   `deltas`：每一位每一筆額度前後的差（`countDeltas()`）—— `rows` 的 `charge` 加起來就是它的 `remaining` 的負數
 */
export function photoDayPlan(items, ctx, { at = new Date().toISOString() } = {}) {
  const list = items ?? [];
  const changes = list.filter((i) => i.kind !== 'new' && i.existing?.visitId && wantsWrite(i));
  const visitsBy = { ...(ctx.visitsBy ?? {}) };
  const touched = new Map();
  const missed = [];
  for (const customerId of new Set(changes.map((i) => i.customerId))) {
    const guard = { entitlements: ctx.entitlementsBy?.[customerId] ?? [], visits: afterPhoto(customerId, [], list, ctx) };
    visitsBy[customerId] = (ctx.visitsBy?.[customerId] ?? []).map((v) => {
      const mine = changes.filter((i) => i.customerId === customerId && i.existing.visitId === v?.id);
      if (!mine.length) return v;
      const adopts = mine.filter((i) => i.adopt && i.diffs?.length);
      const adopted = adoptAbovee(v, adopts);
      const status = applyPhotoStatus(adopted.visit, mine, { at, guard });
      const moved = applyPhotoMove(status.visit, mine, { at, guard });
      // 記著沒改成的是哪一格（`missedField`）：同一列一件改成了、一件沒改成時，存完只拿掉那一個勾（10/16 審查）
      const tag = (list, field) => list.map((m) => ({ ...m, missedField: field }));
      missed.push(...tag(adopted.missed.map((m) => ({ ...m, missedWhy: 'stale' })), 'adopt'),
        ...tag(status.missed, 'adoptStatus'), ...tag(moved.missed, 'adoptMove'));
      const lost = (from, key) => from.some((m) => m.key === key);
      const done = {};
      for (const i of adopts) if (!lost(adopted.missed, i.key)) (done[i.key] ??= []).push('adopt');
      for (const i of mine.filter((x) => x.statusChange && x.adoptStatus)) if (!lost(status.missed, i.key)) (done[i.key] ??= []).push('status');
      for (const i of mine.filter((x) => x.move && x.adoptMove)) if (!lost(moved.missed, i.key)) (done[i.key] ??= []).push('move');
      if (!Object.keys(done).length) return v;
      const slotAt = Object.fromEntries(mine.map((i) => [i.key, moved.at[i.key] ?? i.existing.slotIndex]));
      touched.set(v.id, {
        customerId, before: v, visit: moved.visit, done, at: slotAt, freed: [...status.freed, ...moved.freed], blocked: moved.blocked,
      });
      return moved.visit;
    });
  }

  const after = { ...ctx, visitsBy };
  // 打開之後才在別的地方記了的那一段不再記一次（`alreadyInApp()`，問的是重讀的那一份、改之前的樣子）——
  // 先拿掉再組，同一天別的新列照記
  const already = list.filter((i) => i.checked && alreadyInApp(i, ctx));
  const { groups: composed, problems } = planAbovee(list.filter((i) => !already.includes(i)), after);
  for (const i of already) problems[i.key] = [ALREADY_IN_APP];
  const warningsBy = {};
  const mustSeeBy = {};
  const { courses = [], equipment = [] } = ctx.master ?? {};
  // 改過的那一筆裡，改了的那幾段身上的提醒；改期那一段有錯誤就擋那一列
  const onTouched = (t, details, errors) => {
    for (const key of Object.keys(t.done)) {
      const mine = details.filter((w) => (w.slots ?? []).includes(t.at[key]));
      warningsBy[key] = mine.map((w) => w.text);
      mustSeeBy[key] = mine.filter(mustSee).map((w) => w.text);
      if (errors.length && t.done[key].includes('move')) problems[key] = [...(problems[key] ?? []), ...errors];
    }
  };
  for (const g of composed) {
    const check = checkCtxFor(composed, g, after);
    const { errors } = validateVisit(g.visit, check);
    const details = warningDetails(g.visit, check);
    // 合併扣課第二台、體驗、照片的狀態那幾句（`warningsByRow()`）
    const byRow = warningsByRow(g, details, { customer: check.customer, equipment, courses });
    for (const item of g.items) {
      if (errors.length) problems[item.key] = [...(problems[item.key] ?? []), ...errors];
      warningsBy[item.key] = byRow[item.key].all;
      mustSeeBy[item.key] = byRow[item.key].mustSee;
    }
    if (g.visit.id && touched.has(g.visit.id)) onTouched(touched.get(g.visit.id), details, errors);
  }
  const merged = new Set(composed.map((g) => g.visit.id).filter(Boolean));
  for (const [id, t] of touched) {
    if (merged.has(id)) continue;
    const check = checkCtxFor(composed, { customerId: t.customerId, date: t.visit.date, visit: t.visit }, after);
    onTouched(t, warningDetails(t.visit, check), validateVisit(t.visit, check).errors);
  }
  // 接的那一次健檢那一天記不進去的，這一列也先不記（`stuckLinks()`）—— 照樣存就是安靜地沒接上
  for (const [key, say] of Object.entries(stuckLinks(composed, problems, after))) problems[key] = [...(problems[key] ?? []), say];

  const groups = composed.filter((g) => g.items.every((i) => !problems[i.key]));
  const nameOf = (id) => (ctx.customers ?? []).find((c) => c.id === id)?.name ?? '';
  const storedOf = (customerId, id) => (ctx.visitsBy?.[customerId] ?? []).find((v) => v?.id === id) ?? null;
  const groupWrites = [];
  const usedTouch = new Set();
  for (const g of groups) {
    const t = g.visit.id ? touched.get(g.visit.id) : null;
    if (t && Object.keys(t.done).some((k) => problems[k])) continue;
    if (t) usedTouch.add(g.visit.id);
    groupWrites.push({
      id: plannedId(g), customerId: g.customerId, customerName: g.customerName, date: g.date, visit: g.visit,
      before: t?.before ?? (g.visit.id ? storedOf(g.customerId, g.visit.id) : null),
      freed: [...(t?.freed ?? []), ...g.freed], keys: [...Object.keys(t?.done ?? {}), ...g.items.map((i) => i.key)],
      adds: g, touch: t ?? null,
      // 標壓完：那一天有一段新的是活著的（整組都是照片上已取消的不算 —— 那不是壓好了）
      pressed: g.items.some((i) => g.visit.slots[g.at[i.key]]?.status !== 'cancelled'),
    });
  }
  // 只改既有那一筆的排前面（照片的順序），新的段接在後面
  const writes = [];
  for (const [id, t] of touched) {
    if (usedTouch.has(id) || Object.keys(t.done).some((k) => problems[k])) continue;
    writes.push({
      id, customerId: t.customerId, customerName: nameOf(t.customerId), date: t.visit.date, visit: t.visit, before: t.before,
      freed: t.freed, keys: Object.keys(t.done), adds: null, touch: t, pressed: false,
    });
  }
  writes.push(...groupWrites);
  // **被接著的那幾筆先存**（ADR-0145）：二返接的是那一天的暫時 id，要等它有真的 id；照片同一批改成已完成的健檢也先存 ——
  // 二返先存、健檢那一筆失敗的話，資料庫裡就是一場做完的二返接在一次還沒做完的健檢上
  const linked = new Set(writes.flatMap((w) => (w.visit.slots ?? []).map((s) => s.followupForVisitId)).filter(Boolean));
  writes.sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)));

  // 每一列做了什麼、差幾次（拿寫進去的那一份一段一段算，`counts()` 同一個定義）
  const rows = [];
  const byKey = new Map(list.map((i) => [i.key, i]));
  for (const w of writes) {
    for (const [key, kinds] of Object.entries(w.touch?.done ?? {})) {
      const item = byKey.get(key);
      const old = item.existing.slotIndex;
      for (const kind of kinds) {
        const base = { key, customerId: w.customerId, date: w.date, kind };
        if (kind === 'adopt') rows.push({ ...base, charge: 0, fields: item.diffs.map((d) => d.field), filled: item.diffs.every((d) => !d.app) });
        if (kind === 'status') {
          rows.push({ ...base, to: item.statusChange.to, charge: charge(w.visit, old) - charge(w.before, old) });
        }
        if (kind === 'move') {
          const fresh = w.touch.at[key];
          rows.push({ ...base, to: slotStatus(w.visit, w.visit.slots[fresh]), charge: charge(w.visit, old) - charge(w.before, old) + charge(w.visit, fresh) });
        }
      }
    }
    for (const item of w.adds?.items ?? []) {
      const index = w.adds.at[item.key];
      rows.push({ key: item.key, customerId: w.customerId, date: w.date, kind: 'new', to: w.visit.slots[index]?.status, charge: charge(w.visit, index) });
    }
  }

  const before = {};
  const afterAll = {};
  const deltas = {};
  for (const customerId of new Set(writes.map((w) => w.customerId))) {
    const stored = ctx.visitsBy?.[customerId] ?? [];
    const mine = writes.filter((w) => w.customerId === customerId);
    const replaced = new Set(mine.map((w) => w.id));
    before[customerId] = stored;
    afterAll[customerId] = [...stored.filter((v) => !replaced.has(v?.id)), ...mine.map((w) => ({ ...w.visit, id: w.id }))];
    deltas[customerId] = countDeltas(ctx.entitlementsBy?.[customerId] ?? [], stored, afterAll[customerId]);
  }
  return { groups, problems, warningsBy, mustSeeBy, writes, missed, rows, before, after: afterAll, deltas };
}

/** 這一份計畫裡要標成壓完的每一位每一天（`queueMarksAfter()` 收的那一份）。 */
export const pressedDays = (plan) => (plan?.writes ?? []).filter((w) => w.pressed).map((w) => ({ customerId: w.customerId, date: w.date }));

/**
 * 存的那一下要寫的那一份（`record()`：一位重讀之後叫它，再交給 `writePhotoPlan()`）。
 * 接著同一批別天那一次健檢的列：**那一次已經存好了**（上一次按「記錄」、`savedIds` 有它）才先換成真的 id（`resolveSaved()`）；
 * 還沒存的留著暫時 id —— 那一天在這一份計畫裡的話會先存（`writes` 的先後），`writePhotoPlan()` 存好就換；不在的話換不到、不接。
 * 以前每一列先 `resolveSaved()`：兩天都還沒存時二返的連結在算計畫之前就被清成空的（E2E `65` 的 L6）。
 */
export function planToWrite(items, ctx, savedIds = new Map()) {
  return photoDayPlan((items ?? []).map((i) => (savedIds.has(i.followupForVisitId) ? resolveSaved(i, savedIds) : i)), ctx);
}

/** 那一筆身上接著同一批還沒存的那一次健檢的段（暫時 id）→ 換成先存好的真的 id；換不到就不接（同 `resolveSaved()`）。 */
function withSavedLinks(visit, savedIds) {
  if (!(visit?.slots ?? []).some((s) => isPlannedId(s.followupForVisitId))) return visit;
  return {
    ...visit,
    slots: visit.slots.map((s) => (isPlannedId(s.followupForVisitId)
      ? { ...s, followupForVisitId: savedIds.get(s.followupForVisitId) ?? null } : s)),
  };
}

/**
 * 照計畫一筆一筆存（06）。`save(visit, customerVisits, { freed })` 是 `data/visits.js` 的 `save()`（測試換成假的）。
 *
 * - **每存一筆就換進手上那一份**：`save()` 重算額度快取（`doneCount`／`bookedCount`）用的是手上那一份換掉自己之後的樣子 ——
 *   同一天存兩筆時，第二筆以前看不到第一筆，快取寫錯
 * - 新的一筆存好之後記住真的 id（`savedIds`：暫時 id → 真的 id），後面接著它的二返換成真的（`withSavedLinks()`）
 * - `onWrite(write, id, hand)` 每存好一筆叫一次：呼叫端記住那幾列存過了（失敗重按不重複，lessons 三）
 *
 * 一次只交一位的計畫（手上那一份是那一位的全部來訪）。存到一半丟出來的錯照樣往外丟。
 *
 * @returns {Promise<object[]>} 存完之後手上那一份
 */
export async function writePhotoPlan(plan, { hand = [], save, savedIds = new Map(), onWrite = () => {} } = {}) {
  let mine = [...(hand ?? [])];
  for (const w of plan?.writes ?? []) {
    const visit = withSavedLinks(w.visit, savedIds);
    // eslint-disable-next-line no-await-in-loop
    const id = await save(visit, mine, { freed: w.freed });
    if (!w.visit.id) savedIds.set(w.id, id);
    mine = [...mine.filter((v) => v.id !== id), { ...visit, id }];
    onWrite(w, id, mine);
  }
  return mine;
}

/**
 * 寫的時候沒改成的那幾列，一句話講完（`record()` 的 toast）。以前寫死「治療師／診間剛在別的裝置上改過」——
 * 狀態、改期也會沒改成，理由也不只一種（lessons 五：一道擋有幾種原因，就要有幾句下一步）。
 */
export function missedSay(missed = []) {
  const of = (why) => (missed ?? []).filter((m) => m.missedWhy === why);
  const out = [];
  const stale = of('stale');
  if (stale.length) out.push(`${stale.length} 段剛在別的地方改過，這裡沒改 —— 去日曆看那一天`);
  for (const m of of('closeBlocked')) {
    out.push(`${m.existing?.date ? `${shortDate(m.existing.date)} ` : ''}沒改成已完成：${m.closeBlock ? closeBlockSay(m.closeBlock) : '接的那一次健檢還沒做完'}`);
  }
  const refused = of('refused');
  if (refused.length) out.push(`${refused.length} 段這裡改不了（那一段現在的狀態不准這樣改）—— 去日曆看那一天`);
  const invalid = of('invalid');
  if (invalid.length) out.push(`${invalid.length} 段存不下去：${invalid[0].errors?.[0] ?? '那一天驗證沒過'}`);
  return out.join('；');
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
    .map((g) => ({ ...g.visit, id: plannedId(g) }));
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

/**
 * `validateVisit()` 要的那一份（這位客戶、那一天）。確認層每一組、改期那一天（`checkMoves()`）共用 —— 以前寫在畫面裡。
 *
 * **每一段用時間與名字叫**（`slotSay()`，issue 07）：這一層一列一段，沒有「第幾個時段」可以指。
 * **來訪那兩份連這一次別組要記的一起算**（`visitsForCheck()`，2026-10-09 審查）。
 *
 * @param {object[]} groups 這一次要記的每一組（`planAbovee()`）
 * @param {{customerId: string, date: string, visit: object}} group 正在驗的那一組（或改期那一天）
 */
export function checkCtxFor(groups, group, ctx) {
  const master = ctx.master ?? {};
  return {
    slotLabel: (i) => slotSay(group.visit?.slots?.[i], master),
    customer: { flags: (ctx.customers ?? []).find((c) => c.id === group.customerId)?.flags ?? [] },
    entitlements: ctx.entitlementsBy?.[group.customerId] ?? [],
    courses: master.courses ?? [], equipment: master.equipment ?? [], rooms: master.rooms ?? [],
    staff: master.staff ?? [], ivProducts: master.ivProducts ?? [],
    ...visitsForCheck(groups, group, ctx),
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
 *   是 `all` 的子集、同一句。合併扣課另一台的提醒（`mergedNotices()`）也算 —— 那是同一種「器材對警示要注意」；
 *   Abovee 寫體驗卻照扣的那一句（`trialSay()`）也算；照片上的預約狀態記成別的那幾句（`photoRowSays()`，03）也算 ——
 *   她勾了一列「還沒到就寫完成了」，存進去的是待確認，沒點開就不知道
 *
 * @param {{items: object[], at: Record<string, number>}} group `planAbovee()` 的一組
 * @param {{text: string, source: string, slots: number[]}[]} details `warningDetails(group.visit, …)`
 * @param {{customer?: object, equipment?: object[], courses?: object[]}} [o] 合併扣課第二台要問的：這位客戶的警示、器材主檔；
 *   體驗那一句要問的：課程主檔
 * @returns {Record<string, {all: string[], mustSee: string[]}>}
 */
export function warningsByRow(group, details = [], { customer = null, equipment = [], courses = [] } = {}) {
  const out = {};
  for (const item of group?.items ?? []) {
    const at = group.at?.[item.key];
    const mine = (details ?? []).filter((w) => (w.slots ?? []).includes(at));
    const second = [
      ...mergedNotices(item, customer, equipment), ...trialSay(item, courses),
      // 勾著的列簽不簽得成已完成看這一組的（整批組過的），不看讀照片那一下記的
      ...photoRowSays(item, group.blocked?.[item.key] ?? null),
    ];
    out[item.key] = {
      all: [...mine.map((w) => w.text), ...second],
      mustSee: [...mine.filter(mustSee).map((w) => w.text), ...second],
    };
  }
  return out;
}

/**
 * Abovee 寫體驗、這一段卻扣了一次額度（06）：健檢與二返沒有體驗（`canBeGift()`），或她自己按了一筆額度。
 * **收著也看得到**（`warningsByRow()` 放進 `mustSee`）—— 她沒點開就扣了一次。
 */
function trialSay(item, courses = []) {
  if (!isTrialRow(item?.row) || !item?.entitlementId) return [];
  const course = (courses ?? []).find((c) => c.id === item.course?.courseId);
  // 課程認不出來的那一列不知道是不是健檢：講她自己選了扣額度那一句
  return [course && !canBeGift(course, courses)
    ? 'Abovee 上寫體驗 —— 健檢、二返沒有體驗，這一段照扣一次'
    : 'Abovee 上寫體驗，這裡選了扣額度 —— 照扣一次'];
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
