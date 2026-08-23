// 合併檔匯入。純函式，不碰 IO。
//
// 資料的來源是 `.claude/skills/calendar-sheet-merge` 產生的 `import.json`：舊試算表
// 與 TimeTree 行事曆比對過、補好時間的結果。**比對與判斷都在那一側做完了**，
// 這裡不解析 .ics、也不做任何配對 —— 那些規則只能有一份實作，而它在 skill 裡
// （見 `.scratch/legacy-calendar-merge/issues/01-*.md` 的分工）。
//
// 這裡只做四件事：驗證格式、把名字對到她自己主檔的 id、算出要寫什麼、把問題講出來。
//
// 為什麼帶的是名字不是 id：產生檔案的那一側看不到她的 Firestore（也不該看得到），
// 所以 id 只可能在這裡才對得起來。對不到就進 problems，不要猜 ——
// 同一個判準見 `domain/legacyImport.js` 的 `resolveCourse()`。

import { isValidDate } from './dates.js';
import { isValidTime } from './visitTime.js';
import { followupPlanEntries } from './followups.js';
import { contraindicationHints } from './contraindications.js';
import { normalize as normalizeNote } from './notes.js';
import { syncTasksForVisit } from './taskRules.js';

export const FORMAT = 'baobao-merge/v1';

const norm = (v) => String(v ?? '').trim().replace(/\s+/g, ' ');
const alive = (list) => (list ?? []).filter((x) => !x.deletedAt);

/** 名字 → 主檔那一筆。對不到回 null，不做模糊比對。 */
function byName(list, name) {
  const wanted = norm(name);
  if (!wanted) return null;
  return alive(list).find((x) => norm(x.name) === wanted) ?? null;
}

/**
 * 這份檔案認不認得。
 *
 * 貼錯東西（貼成報告、貼成半份、貼成舊版格式）是最容易發生的事，而它的症狀
 * 如果是「匯入了一半」會比整個拒絕嚴重得多，所以寧可在這裡擋死。
 *
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateFile(json) {
  const errors = [];
  const warnings = [];

  if (!json || typeof json !== 'object') return { errors: ['這不是一份合併檔（讀不出 JSON）'], warnings };
  if (json.format !== FORMAT) {
    errors.push(`格式不對：需要 ${FORMAT}，這份是「${json.format ?? '沒有寫'}」`);
    return { errors, warnings };
  }
  if (!Array.isArray(json.customers)) errors.push('少了 customers');
  if (json.customers && !json.customers.length) warnings.push('這份檔案裡沒有任何客戶');

  for (const [i, c] of (json.customers ?? []).entries()) {
    const at = `第 ${i + 1} 位（${c?.name || '沒有名字'}）`;
    if (!norm(c?.name)) errors.push(`${at}：沒有名字`);
    if (!Array.isArray(c?.entitlements)) errors.push(`${at}：少了 entitlements`);
    if (!Array.isArray(c?.visits)) errors.push(`${at}：少了 visits`);
    for (const v of c?.visits ?? []) {
      if (!isValidDate(v?.date)) errors.push(`${at}：來訪日期不合法（${v?.date}）`);
      if (!Array.isArray(v?.slots) || !v.slots.length) errors.push(`${at} ${v?.date}：沒有時段`);
      for (const s of v?.slots ?? []) {
        if (!norm(s?.courseName)) errors.push(`${at} ${v.date}：時段沒有課程`);
        // 時間可以整段不詳（舊表就沒記過，ADR-0011），但只填一半是壞掉的資料
        const half = (s?.startsAt == null) !== (s?.endsAt == null);
        if (half) errors.push(`${at} ${v.date}：時間只填了一半（${s.startsAt ?? '無'}–${s.endsAt ?? '無'}）`);
        if (s?.startsAt != null && !isValidTime(s.startsAt)) errors.push(`${at} ${v.date}：開始時間不合法（${s.startsAt}）`);
        if (s?.endsAt != null && !isValidTime(s.endsAt)) errors.push(`${at} ${v.date}：結束時間不合法（${s.endsAt}）`);
      }
    }
  }

  // 三份候選清單靠名字認人。名字跟 customers[] 對不起來時，勾了也補不進去，
  // 而症狀只是「都沒進去」—— 看不出是名字的問題。先講出來。
  const known = new Set((json.customers ?? []).map((c) => norm(c?.name)));
  const orphan = [...(json.futureVisits ?? []), ...(json.missingFromSheet ?? [])]
    .map((x) => norm(x?.customerName))
    .filter((n) => n && !known.has(n));
  if (orphan.length) {
    warnings.push(`有 ${orphan.length} 筆候選的客戶名字不在這份檔案裡`
      + `（${[...new Set(orphan)].slice(0, 3).join('、')}…），勾了也補不進去`);
  }

  // skill 那側花力氣「不敢猜」，結果 app 這側連提都沒提 —— 那一筆來訪就這樣
  // 消失了，兩邊都沒有錯，但東西不見了。理由跟上面那條一樣：講出來。
  const ambiguous = (json.ambiguous ?? []).length;
  if (ambiguous) {
    warnings.push(`有 ${ambiguous} 筆行事曆事件對得上兩位以上的客戶，`
      + '產檔那側不敢猜，所以一筆都沒有匯入。匯完到日曆上自己補');
  }

  // 「沒有這幾筆」和「讀不到這幾筆」是兩件事。同一條規矩。
  const unreadable = (json.unreadable ?? []).length;
  if (unreadable) {
    warnings.push(`行事曆裡有 ${unreadable} 筆事件產檔那側讀不出日期，`
      + '所以這份檔案裡完全沒有它們（不是「那幾天沒事」）');
  }

  return { errors, warnings };
}

const IMPORT_SOURCE = 'merge-file';

function stampOf(json, sheetName) {
  return {
    source: IMPORT_SOURCE,
    sheetName: sheetName || null,
    importedAt: null,
    calendar: json?.calendar?.file ?? null,
  };
}

/**
 * 一位客戶要建立什麼。形狀跟 `domain/legacyImport.js` 的 `planForSheet()` 一樣，
 * 所以 `data/legacyImport.js` 的 `importPlan()` 原封不動就能寫 ——
 * 一位客戶一個 commit、有稽核、不產生任務。
 *
 * @param {object} entry  合併檔裡的一位客戶
 * @param {object} ctx    { courses, equipment, ivProducts, rooms, staff, existingCustomers, today }
 * @param {object} [json] 整份檔案，只用來記來源
 */
export function planForCustomer(entry, ctx = {}, json = null) {
  const {
    courses = [], equipment = [], ivProducts = [], rooms = [], staff = [], existingCustomers = [],
    today = null,
  } = ctx;
  const problems = [];
  const problem = (where, raw, why) => problems.push({ where, raw: raw || '', why });
  const stamp = stampOf(json, entry.sheetName);
  const name = norm(entry.name);

  const clash = existingCustomers.find((c) => !c.deletedAt && norm(c.name) === name);
  if (clash) {
    return emptyPlan(entry, { skip: `系統裡已經有「${name}」，整位跳過以免建出第二份` });
  }

  // ---------- 額度 ----------
  const entitlements = [];
  for (const e of entry.entitlements ?? []) {
    const course = byName(courses, e.courseName);
    if (e.courseName && !course) {
      problem(e.label, e.courseName, '主檔裡沒有這個課程，這一筆額度沒有匯入（先去主檔建起來再匯一次）');
      continue;
    }
    const optionIds = [];
    for (const eqName of e.optionEquipmentNames ?? []) {
      const eq = byName(equipment, eqName);
      if (!eq) problem(e.label, eqName, '主檔裡沒有這個器材，擇一池少一個選項');
      else optionIds.push(eq.id);
    }
    if (e.type === 'pool' && optionIds.length < 2) {
      problem(e.label, (e.optionEquipmentNames ?? []).join('、'), '擇一池的器材不到兩種，這一筆額度沒有匯入');
      continue;
    }
    entitlements.push({
      key: e.key,
      productName: e.productName ?? null,
      doc: {
        type: e.type === 'pool' ? 'pool' : 'single',
        label: e.label,
        courseId: e.type === 'pool' ? null : course?.id ?? null,
        optionEquipmentIds: e.type === 'pool' ? optionIds : null,
        totalQty: Number(e.totalQty) || 0,
        durationMin: course?.durationMin ?? null,
        frequencyRule: course?.frequencyRule ?? null,
        sourcePlanName: null,
        purchasedAt: null,
        expiresAt: null,
        doneCount: 0,
        bookedCount: 0,
        lastReconciledAt: null,
        importedFrom: stamp,
      },
    });
  }
  // 健檢配二返：買幾次健檢就有幾次二返（GitHub issue #15、ADR-0022）。
  // 這一段就是那 15 筆補不進來的來訪的解法 —— 行事曆上記了二返，但舊表的
  // 療程列裡沒有這一項，所以合併檔的 entitlements 裡也不會有，
  // 補進來的時段就「對不到任何一筆額度」。
  const paired = followupPlanEntries(entitlements, courses, { importedFrom: stamp });
  entitlements.push(...paired);

  const keys = new Set(entitlements.map((e) => e.key));

  // ---------- 來訪 ----------
  const visits = [];
  for (const v of entry.visits ?? []) {
    // 日期先決定狀態，狀態再決定那幾段算不算做過了 —— 順序反過來的話
    // 未來的來訪會帶著 `attended: true` 進去，那是「人來了」的意思。
    const status = statusFor(v.status, v.date, today);
    const slots = [];
    for (const s of v.slots ?? []) {
      if (!keys.has(s.entitlementKey)) {
        problem(`${v.date} ${s.courseName}`, s.entitlementKey ?? '', '這個時段對不到任何一筆額度，沒有匯入');
        continue;
      }
      const course = byName(courses, s.courseName);
      if (!course) {
        problem(`${v.date} ${s.courseName}`, s.courseName, '主檔裡沒有這個課程，這個時段沒有匯入');
        continue;
      }
      slots.push({
        entitlementKey: s.entitlementKey,
        courseId: course.id,
        courseName: course.name,
        ...resolveAssignments(s, { equipment, ivProducts, rooms, staff }, problem, `${v.date} ${s.courseName}`),
        startsAt: s.startsAt ?? null,
        endsAt: s.endsAt ?? null,
        bed: null,
        attended: status !== 'confirmed',
      });
    }
    if (!slots.length) continue;
    visits.push(visitDoc({ name, date: v.date, status, slots, stamp }));
  }

  return {
    sheetName: entry.sheetName ?? '',
    customerName: name,
    source: entry.source ?? null,
    skip: null,
    customer: {
      name,
      phone: null,
      lineId: null,
      source: entry.source || null,
      purchasedAt: null,
      membershipExpiresAt: null,
      priority: 0,
      flags: [],
      notes: entry.notes ?? '',
      active: true,
      importedFrom: stamp,
    },
    entitlements,
    visits,
    problems,
    // 舊表沒有「永久限制」這個欄位，所以那幾句話寫在購買名稱或空白處，而合併檔
    // 把它們原封不動收進 `notes`。**匯進來之後 `customer.flags` 是空的**，
    // 而擋器材是拿 flags 去比對的 —— 沒有那個標記，超磁場與高能量雷射不會被擋，
    // 那是整個系統唯一會造成實際傷害的一條。只提示不自動填（ADR-0002）。
    contraindications: contraindicationHints([
      { where: '購買名稱', text: entry.source },
      { where: '備註', text: entry.notes },
    ], equipment),
    counts: {
      entitlements: entitlements.length,
      followups: paired.length,
      visits: visits.length,
      // 還沒發生的那幾筆。摘要卡要講出來 —— 「67 筆來訪」和
      // 「67 筆來訪，其中 11 筆還沒發生」是兩個不同的畫面。
      future: visits.filter((v) => v.status === 'confirmed').length,
      slots: visits.reduce((n, v) => n + v.slots.length, 0),
      timed: visits.reduce((n, v) => n + v.slots.filter((s) => s.startsAt).length, 0),
      low: (entry.visits ?? []).reduce(
        (n, v) => n + (v.slots ?? []).filter((s) => s.confidence === 'low').length, 0,
      ),
    },
  };
}

/** 器材、品項、診間、治療師：名字對得到就填，對不到就講一聲留空。 */
function resolveAssignments(slot, { equipment, ivProducts, rooms, staff }, problem, where) {
  const pick = (list, value, what) => {
    if (!norm(value)) return null;
    const hit = byName(list, value);
    if (!hit) problem(where, value, `主檔裡沒有這個${what}，這個時段的欄位留空`);
    return hit?.id ?? null;
  };
  return {
    equipmentId: pick(equipment, slot.equipmentName, '器材'),
    ivProductId: pick(ivProducts, slot.ivProductName, '營養點滴品項'),
    roomId: pick(rooms, slot.roomName, '診間'),
    therapistId: pick(staff, slot.therapistName, '治療師'),
  };
}

/**
 * 這一筆來訪要建成哪一種狀態。
 *
 * 舊表上有打勾在她的用法裡是「排了」，不是「來了」—— 她也會先把未來的預約
 * 寫進去。所以合併檔那側一律吐 `done`，而**日期在今天之後的那幾筆是
 * 「已確認、還沒來」**：算進已排未上，次數還不會扣（SPEC 第 4.2 節）。
 *
 * **界線在匯入的那一刻，不是產檔的那一刻。** 一份 8/19 產的檔案她 8/21 才貼，
 * 下個月再貼一次，同一批資料的「未來」會完全不同 —— 所以這個判斷不能寫進檔案，
 * 也不能在 skill 那側做（見 `.scratch/first-real-import/issues/03`）。
 *
 * 檔案說 `confirmed` 就聽它，不管日期：`futureVisits` 那條路已經標過了，
 * 那是有依據的判斷，不要拿一個算出來的結果去蓋掉它。
 *
 * `today` 沒給就只看檔案裡寫什麼（維持舊行為）。UI 那層一律用
 * `domain/dates.js` 的 `todayISO()` 取。
 */
export function statusFor(status, date, today) {
  if (status === 'confirmed') return 'confirmed';
  return today && date > today ? 'confirmed' : 'done';
}

function visitDoc({ name, date, status, slots, stamp }) {
  return {
    customerName: name,
    date,
    status,
    confirmedAt: null,
    cancelledAt: null,
    cancelReason: null,
    released: false,
    slots,
    importedFrom: stamp,
  };
}

function emptyPlan(entry, { skip = null, problems = [] } = {}) {
  return {
    sheetName: entry.sheetName ?? '',
    customerName: norm(entry.name),
    source: entry.source ?? null,
    skip,
    customer: null,
    entitlements: [],
    visits: [],
    problems,
    contraindications: [],
    counts: { entitlements: 0, followups: 0, visits: 0, future: 0, slots: 0, timed: 0, low: 0 },
  };
}

/**
 * 她勾起來的那幾筆候選，加進對應客戶的計畫裡。
 *
 * 三份候選清單她自己勾，UI 勾完之後把勾起來的丟進來（預設值見 `defaultPicks()`：
 * 還沒發生的勾起來、已經發生的不勾）。**跟客戶同一個 commit**：分開寫的話，
 * 客戶建好了、補的來訪失敗，會留下一份看起來完整、其實少了幾筆的資料。
 *
 * @param {object[]} plans      planForCustomer() 的結果
 * @param {object[]} extras     { customerName, date, courseName, startsAt, status }
 * @param {object} ctx          { courses, today }
 */
export function addExtraVisits(plans, extras, ctx = {}) {
  const { courses = [], today = null } = ctx;
  const problems = [];
  for (const x of extras) {
    const plan = plans.find((p) => !p.skip && p.customerName === norm(x.customerName));
    if (!plan) {
      problems.push({ where: `${x.date} ${x.customerName}`, raw: '', why: '這份檔案裡沒有這位客戶，補不進去' });
      continue;
    }
    const course = byName(courses, x.courseName);
    if (!course) {
      problems.push({ where: `${x.date} ${x.customerName}`, raw: x.courseName, why: '主檔裡沒有這個課程，這一筆沒有補進去' });
      continue;
    }
    // 一筆補的來訪要扣哪一份額度：課程對得上的那一筆。對到不只一筆就不猜。
    const hits = plan.entitlements.filter((e) => e.doc.courseId === course.id
      || (e.doc.type === 'pool' && course.requiresEquipment));
    if (hits.length !== 1) {
      problems.push({
        where: `${x.date} ${x.customerName}`,
        raw: x.courseName,
        why: hits.length
          ? '對到不只一份額度，不知道要扣哪一份，這一筆沒有補進去'
          : '這位客戶沒有這個課程的額度，這一筆沒有補進去 ——'
            + '先去客戶詳情頁加一筆額度，再貼一次就補得進來',
      });
      continue;
    }
    const start = isValidTime(x.startsAt) ? x.startsAt : null;
    // 同一條規則要套在這裡，否則她從 missingFromSheet 勾一筆未來的，
    // 又會變回「已完成」—— 那正是 issues/03 要修的東西。
    const status = statusFor(x.status, x.date, today);
    const slot = {
      entitlementKey: hits[0].key,
      courseId: course.id,
      courseName: course.name,
      equipmentId: null,
      ivProductId: null,
      roomId: null,
      therapistId: null,
      startsAt: start,
      endsAt: start ? addMinutes(start, course.durationMin ?? 60) : null,
      bed: null,
      attended: status !== 'confirmed',
    };
    // 同一天已經有來訪就併進去 —— 來訪的定義是「某人某天到院一次」（CONTEXT.md）
    const same = plan.visits.find((v) => v.date === x.date);
    if (same) same.slots.push(slot);
    else {
      plan.visits.push(visitDoc({
        name: plan.customerName, date: x.date, status, slots: [slot],
        stamp: plan.customer.importedFrom,
      }));
    }
    plan.counts.visits = plan.visits.length;
    plan.counts.future = plan.visits.filter((v) => v.status === 'confirmed').length;
    plan.counts.slots += 1;
    if (start) plan.counts.timed += 1;
  }
  return problems;
}

function addMinutes(hhmm, min) {
  const [h, m] = hhmm.split(':').map(Number);
  const t = h * 60 + m + min;
  return `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * 候選清單**先分時間、再分來源**。
 *
 * 原本三張卡是照「這筆資料哪裡來的」分的，而那不是她看這一頁時要問的問題 ——
 * 她要問的是「這件事發生了沒」。198 筆混在一起、過去與未來交錯排列，
 * 等於要她一筆一筆看日期（`.scratch/first-real-import/issues/05`）。
 *
 * 界線一樣用 `today` 現算，不寫進檔案（理由見 `statusFor()`）。
 *
 * 排序是「離今天多遠」：還沒發生的近的在前，已經發生的最近做的在前。
 *
 * @param {object} json  整份合併檔
 * @param {string|null} today
 * @returns {{future: {visits: Ref[], events: Ref[]},
 *            past: {visits: Ref[], events: Ref[]},
 *            plannedFuture: number}}
 *   Ref = { kind: 'future'|'missing'|'events', index: number, date: string, item: object }
 *   `index` 是在原本那三份清單裡的位置 —— 勾選狀態記的是它。
 */
export function groupCandidates(json, today = null) {
  const refs = (list, kind, dateOf) => (list ?? [])
    .map((item, index) => ({ kind, index, date: dateOf(item) ?? '', item }));

  const visits = [
    ...refs(json?.futureVisits, 'future', (x) => x.date),
    ...refs(json?.missingFromSheet, 'missing', (x) => x.date),
  ];
  const events = refs(json?.eventCandidates, 'events', (x) => x.startDate);

  const ahead = (r) => Boolean(today) && r.date > today;
  const soonest = (a, b) => a.date.localeCompare(b.date);
  const latest = (a, b) => b.date.localeCompare(a.date);

  return {
    future: {
      visits: visits.filter(ahead).sort(soonest),
      events: events.filter(ahead).sort(soonest),
    },
    past: {
      visits: visits.filter((r) => !ahead(r)).sort(latest),
      events: events.filter((r) => !ahead(r)).sort(latest),
    },
    // customers[] 裡日期在今天之後的來訪。**它們沒有勾選介面**，一定會匯入
    // （`issues/03`：那是她已經約好的事，日曆上必須看得到）。
    // 要數出來是因為「未來的預約」那張卡本來只列得出十一分之一 ——
    // 一張卡列出十一分之一，比沒有這張卡還糟。
    plannedFuture: (json?.customers ?? []).reduce(
      (n, c) => n + (c?.visits ?? []).filter((v) => today && v?.date > today).length, 0,
    ),
  };
}

/**
 * 一份檔案剛讀進來時哪幾筆預設勾起來。
 *
 * **還沒發生的全部勾起來，已經發生的一筆都不勾**（2026-08-21 使用者拍板，
 * 見 `docs/adr/0030-future-candidates-are-ticked-by-default.md`）。
 *
 * @returns {{future: number[], missing: number[], events: number[]}}
 */
export function defaultPicks(json, today = null) {
  const { future } = groupCandidates(json, today);
  const out = { future: [], missing: [], events: [] };
  for (const r of [...future.visits, ...future.events]) out[r.kind].push(r.index);
  return out;
}

/**
 * 日曆上那三類（ADR-0045 的四類扣掉來訪）。**這是「寫到哪個集合」的分歧點**：
 * `note` 走 `notes`，另外兩個走 `events`。
 *
 * 名字裡刻意沒有 event：日曆上的待辦**不是 `events` 的第三種類別**，
 * 它就是有日期的隨手記（ADR-0044）。叫它 `EVENT_KINDS` 會讓下一個人
 * 去 `events` 裡找待辦。
 */
export const CALENDAR_KINDS = ['note', 'personal', 'leave'];

/** 給人看的名字。用 `CONTEXT.md` 的詞。 */
export const KIND_LABEL = { note: '待辦', personal: '行事備註', leave: '休假' };

/**
 * 這一筆候選在日曆上是哪一類。
 *
 * 產檔那側照標題判好了（`classifyEvent()`），**但那是建議不是結論** ——
 * 她在畫面上改掉的那一個才算數，所以這一支只負責讀檔案裡的預設值。
 *
 * `category` 是舊版合併檔的欄位，只認得 `leave` 與 `personal`：2026-08-23
 * 以前產的檔案沒有 `kind`，那時候也還沒有「待辦」這一類。舊檔案照樣讀得進來，
 * 只是三類變兩類。
 */
export function eventKind(candidate) {
  const kind = candidate?.kind;
  if (CALENDAR_KINDS.includes(kind)) return kind;
  return candidate?.category === 'leave' ? 'leave' : 'personal';
}

/**
 * 她勾起來、而且留在「待辦」那一類的那幾筆 → 隨手記。
 *
 * **掛了日期的隨手記就是日曆上的待辦**（ADR-0044），不是第三份資料，
 * 所以這裡不需要再寫進 `events` 一份 —— 寫兩份就要同步兩份。
 *
 * 不掛客戶：行事曆上那幾筆寫的是「打電話給某某」，那個某某是誰要她自己認，
 * 而認錯人會把一件雜事掛到錯的客戶身上（`domain/legacyImport.js` 同一個判準）。
 * 時間丟掉是刻意的：隨手記存得下日期、存不下時間（`domain/notes.js`），
 * 而產檔那側判待辦的前提就是「她沒在標題最前面寫時間」。
 */
export function noteDocs(candidates, stamp = null) {
  return (candidates ?? []).map((c) => ({
    // **走隨手記自己的 normalize()**，不要在這裡另外拼一份形狀：
    // 沒有日期要收成 null 而不是空字串（日曆是 `where('date','>=',…)` 撈的，
    // 空字串撈得到而 null 撈不到），那條不變量只寫在 `domain/notes.js`。
    ...normalizeNote({ text: c.title, date: c.startDate }),
    doneAt: null,
    // 匯進來的東西都標得出是從哪一次合併來的（SPEC 第 6.10 節）
    ...(stamp ? { importedFrom: stamp } : {}),
  }));
}

/**
 * 她勾起來的雜事，照現在的分類分成兩堆。
 *
 * **分歧點只有這裡一個。** 這句判斷本來寫在那一頁的事件處理器裡，
 * 而「待辦寫進 notes、另外兩種寫進 events」是規則不是畫面（SPEC 第 10 節）。
 *
 * @param {object[]} candidates 檔案裡的 `eventCandidates`
 * @param {(index: number) => string} kindOf 這一列現在算哪一類（她改過的算她的）
 * @param {number[]} chosen 她勾起來的位置
 * @returns {{events: object[], notes: object[]}}
 */
export function looseDocs(candidates, kindOf, chosen, json = null) {
  const stamp = stampOf(json, null);
  const rows = (candidates ?? [])
    .map((c, index) => ({ ...c, kind: kindOf(index), index }))
    .filter((r) => chosen.includes(r.index));
  return {
    events: eventDocs(rows.filter((r) => r.kind !== 'note'), stamp),
    notes: noteDocs(rows.filter((r) => r.kind === 'note'), stamp),
  };
}

/** 勾起來的那幾筆照分類數一遍。畫面拿它寫「休假 4　待辦 2　行事備註 22」。 */
export function looseTally(candidates, kindOf, chosen) {
  const kinds = (candidates ?? [])
    .map((c, index) => ({ kind: kindOf(index), index }))
    .filter((r) => chosen.includes(r.index))
    .map((r) => r.kind);
  return CALENDAR_KINDS.map((k) => ({ kind: k, label: KIND_LABEL[k], count: kinds.filter((x) => x === k).length }));
}

/**
 * 她勾起來的行事備註。**不綁客戶、不產生任務、不扣次數**，所以它們走 `events`
 * 不走 `visits`（ADR-0015：合成同一個集合會讓「要不要扣次數」變成到處都要判斷的分支）。
 */
export function eventDocs(candidates, stamp = null) {
  return candidates.map((c) => {
    const kind = eventKind(c);
    // 有明確欄位就用它（產檔那側從 DTSTART 的 VALUE=DATE 判的），沒有才從
    // 「有沒有時間」反推 —— 舊的合併檔沒有這個欄位，照樣要吃得下。
    //
    // **休假一律整天**，而且這一條要在這裡擋，不能只擋在產檔那側：
    // 她在畫面上可以把一筆 14:00 的行事備註改成休假（那正是這一頁的重點），
    // 而休假講的是「那幾天她根本不在」（`CONTEXT.md`）—— 一筆 14:00 開始的
    // 休假在日曆上會畫成一條一小時的色條，那不是她的意思。
    const allDay = kind === 'leave'
      || (typeof c.allDay === 'boolean' ? c.allDay : !isValidTime(c.startTime));
    // 整天就是整天：時間一律清掉。標成整天卻帶著時間的資料，日曆上會畫成
    // 一條有時有分的色條，而那個時間是沒有來源的。
    const start = !allDay && isValidTime(c.startTime) ? c.startTime : null;
    return {
      title: norm(c.title),
      // 只有兩種進得了 `events`。判成待辦的那幾筆由 `looseDocs()` 分去 `notes`，
      // 走不到這裡 —— 舊的合併檔沒有待辦這一類，所以剩下的一定是這兩種。
      category: kind === 'leave' ? 'leave' : 'personal',
      startDate: c.startDate,
      // 跨天的行事備註是這個系統裡唯一可以跨天的東西（ADR-0015）。
      // 結束日比開始日早的資料進不去（firestore.rules 的 validEvent()），當成單天。
      endDate: c.endDate && c.endDate >= c.startDate ? c.endDate : c.startDate,
      allDay,
      startTime: start,
      endTime: isValidTime(c.endTime) && start ? c.endTime
        : (start ? addMinutes(start, 60) : null),
      // note 空的時候給 null 不給空字串 —— data/events.js 的 shape() 就是這樣寫的，
      // 兩條路寫出不一樣的空值，之後讀的地方就要判斷兩種。
      note: c.repeats ? '行事曆上是重複事件，匯入的只有這一次' : null,
      // 匯進來的東西都標得出是從哪一次合併來的（SPEC 第 6.10 節）
      ...(stamp ? { importedFrom: stamp } : {}),
    };
  });
}

/**
 * 這批計畫會長出幾筆登記待辦。
 *
 * **判斷不在這裡。** 呼叫的是每次存來訪都在跑的那一支（`syncTasksForVisit()`，
 * 它自己會問 `acceptsNewTasks()`），這裡只負責數 —— 在 UI 上再判斷一次
 * 「哪一種來訪會長任務」，就是第二份實作，而它一定會跟真正寫入的那一份跑掉。
 *
 * 這個數字是給確認框看的：那一頁本來寫著「不會產生任何待辦任務」，
 * 而那句話對未來的預約是錯的（`.scratch/first-real-import/issues/04`）。
 *
 * @param {object[]} plans
 * @param {{courses?: object[], today?: string|null}} ctx
 */
export function countNewTasks(plans, { courses = [], today = null } = {}) {
  const coursesById = Object.fromEntries((courses ?? []).map((c) => [c.id, c]));
  return plans
    .filter((p) => !p.skip)
    .reduce((n, p) => n + p.visits.reduce(
      (m, v) => m + syncTasksForVisit(v, [], { coursesById, today }).create.length, 0,
    ), 0);
}

/** 按下去之前的摘要。數字要跟報告上的對得起來，否則她會以為漏了東西。 */
export function summarize(plans) {
  const live = plans.filter((p) => !p.skip);
  return {
    customers: live.length,
    skipped: plans.filter((p) => p.skip).map((p) => ({ customerName: p.customerName, why: p.skip })),
    entitlements: live.reduce((n, p) => n + p.counts.entitlements, 0),
    // 系統配出來的二返額度。合併檔上沒有這一項，所以要分開講一次。
    followups: live.reduce((n, p) => n + (p.counts.followups ?? 0), 0),
    visits: live.reduce((n, p) => n + p.counts.visits, 0),
    // 其中還沒發生的。合併檔那側一律吐 done，日期在今天之後的會建成已確認 ——
    // 那個數字要看得到，否則「67 筆來訪」看起來就是 67 筆都做過了。
    future: live.reduce((n, p) => n + (p.counts.future ?? 0), 0),
    slots: live.reduce((n, p) => n + p.counts.slots, 0),
    timed: live.reduce((n, p) => n + p.counts.timed, 0),
    low: live.reduce((n, p) => n + p.counts.low, 0),
    problems: plans.reduce((n, p) => n + p.problems.length, 0),
    // 會匯進去的那幾位身上、文字裡提到的醫療禁忌。**跳過的那幾位不算** ——
    // 她們根本不會進來，講了只會讓真的要處理的那幾位被稀釋掉。
    contraindications: live
      .filter((p) => (p.contraindications ?? []).length)
      .map((p) => ({
        customerName: p.customerName || p.sheetName,
        terms: [...new Set(p.contraindications.map((h) => h.term))],
        blocks: [...new Set(p.contraindications.flatMap((h) => h.blocks))],
      })),
  };
}
