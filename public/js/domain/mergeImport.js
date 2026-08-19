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
 * @param {object} ctx    { courses, equipment, ivProducts, rooms, staff, existingCustomers }
 * @param {object} [json] 整份檔案，只用來記來源
 */
export function planForCustomer(entry, ctx = {}, json = null) {
  const {
    courses = [], equipment = [], ivProducts = [], rooms = [], staff = [], existingCustomers = [],
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
  const keys = new Set(entitlements.map((e) => e.key));

  // ---------- 來訪 ----------
  const visits = [];
  for (const v of entry.visits ?? []) {
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
        attended: true,
      });
    }
    if (!slots.length) continue;
    visits.push(visitDoc({ name, date: v.date, status: v.status, slots, stamp }));
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
    counts: {
      entitlements: entitlements.length,
      visits: visits.length,
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

function visitDoc({ name, date, status, slots, stamp }) {
  return {
    customerName: name,
    date,
    status: status === 'confirmed' ? 'confirmed' : 'done',
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
    counts: { entitlements: 0, visits: 0, slots: 0, timed: 0, low: 0 },
  };
}

/**
 * 她勾起來的那幾筆候選，加進對應客戶的計畫裡。
 *
 * 三份候選清單在檔案裡一律 `include: false`（她說要自己一筆一筆決定），
 * UI 勾完之後把勾起來的丟進來。**跟客戶同一個 commit**：分開寫的話，
 * 客戶建好了、補的來訪失敗，會留下一份看起來完整、其實少了幾筆的資料。
 *
 * @param {object[]} plans      planForCustomer() 的結果
 * @param {object[]} extras     { customerName, date, courseName, startsAt, status }
 * @param {object} ctx
 */
export function addExtraVisits(plans, extras, ctx = {}) {
  const { courses = [] } = ctx;
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
      attended: x.status !== 'confirmed',
    };
    // 同一天已經有來訪就併進去 —— 來訪的定義是「某人某天到院一次」（CONTEXT.md）
    const same = plan.visits.find((v) => v.date === x.date);
    if (same) same.slots.push(slot);
    else {
      plan.visits.push(visitDoc({
        name: plan.customerName, date: x.date, status: x.status, slots: [slot],
        stamp: plan.customer.importedFrom,
      }));
    }
    plan.counts.visits = plan.visits.length;
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
 * 她勾起來的個人行程。**不綁客戶、不產生任務、不扣次數**，所以它們走 `events`
 * 不走 `visits`（ADR-0015：合成同一個集合會讓「要不要扣次數」變成到處都要判斷的分支）。
 */
export function eventDocs(candidates) {
  return candidates.map((c) => ({
    title: norm(c.title),
    category: c.category === 'leave' ? 'leave' : 'personal',
    startDate: c.startDate,
    endDate: c.endDate || c.startDate,
    allDay: !isValidTime(c.startTime),
    startTime: isValidTime(c.startTime) ? c.startTime : null,
    endTime: isValidTime(c.endTime) ? c.endTime
      : (isValidTime(c.startTime) ? addMinutes(c.startTime, 60) : null),
    // note 空的時候給 null 不給空字串 —— data/events.js 的 shape() 就是這樣寫的，
    // 兩條路寫出不一樣的空值，之後讀的地方就要判斷兩種。
    note: c.repeats ? '行事曆上是重複事件，匯入的只有這一次' : null,
  }));
}

/** 按下去之前的摘要。數字要跟報告上的對得起來，否則她會以為漏了東西。 */
export function summarize(plans) {
  const live = plans.filter((p) => !p.skip);
  return {
    customers: live.length,
    skipped: plans.filter((p) => p.skip).map((p) => ({ customerName: p.customerName, why: p.skip })),
    entitlements: live.reduce((n, p) => n + p.counts.entitlements, 0),
    visits: live.reduce((n, p) => n + p.counts.visits, 0),
    slots: live.reduce((n, p) => n + p.counts.slots, 0),
    timed: live.reduce((n, p) => n + p.counts.timed, 0),
    low: live.reduce((n, p) => n + p.counts.low, 0),
    problems: plans.reduce((n, p) => n + p.problems.length, 0),
  };
}
