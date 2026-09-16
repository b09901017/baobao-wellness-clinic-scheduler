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
import { followupPlanEntries, followupCourseIdOf } from './followups.js';
import { importedLabel, tierFromLegacyLabel } from './entitlements.js';
import { contraindicationHints } from './contraindications.js';
import { normalize as normalizeNote } from './notes.js';
import { importedTasksFor } from './taskRules.js';
import { toCustomerFields } from './customerMarks.js';
import { DOCTOR_ROLE } from './masterData.js';

/**
 * 合併檔的格式。
 *
 * - **v2（2026-09-13）** 多了購買日、方案與套數、帶顏色的備註（`.scratch/asks-2026-09-13/issues/08`）
 * - **v3（2026-09-15）** 多了額度的時長、客戶的警示與合作機構（`.scratch/merge-answers-2026-09-14/issues/02`）
 *
 * 只加欄位不升版的話，舊版 app 會安靜地吃掉那幾格，而畫面看起來跟匯好了一樣 —— 所以升版。
 */
export const FORMAT = 'baobao-merge/v3';

/** 還收得下的舊版。舊的檔案照舊匯得進去，少的那幾格一律退回以前的值。 */
export const FORMATS = Object.freeze(['baobao-merge/v1', 'baobao-merge/v2', FORMAT]);

/** 額度的時長：正整數才算數，其餘當沒寫。 */
const minutesOf = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);

/**
 * 警示與合作機構：客戶身上存的是**字串**（ADR-0074、ADR-0076），所以只收字串陣列。
 * 其餘形狀一律當成沒有 —— 寫一個非陣列進 `flags`，壓表卡片牆那一排會整個畫不出來。
 */
const stringList = (v) => (Array.isArray(v)
  ? [...new Set(v.filter((x) => typeof x === 'string').map(norm).filter(Boolean))]
  : []);

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
  if (!FORMATS.includes(json.format)) {
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
    // **一台也算數**（ADR-0075）：單買一台 SIS 就是「這一池裡只有一台」。這裡以前寫著
    // 「不到兩種就不匯」，於是單買一台的客戶就算產檔那側寫得出來也匯不進去。零台仍然擋。
    if (e.type === 'pool' && optionIds.length < 1) {
      problem(e.label, (e.optionEquipmentNames ?? []).join('、'), '擇一池一台器材都對不到，這一筆額度沒有匯入');
      continue;
    }
    // 買的是哪一款營養點滴（ADR-0059 的相反面：額度記得住品項，排班時才預設得出來）。
    // **對不到就留空，不要猜** —— 同 `resolveAssignments()` 的判準。
    // 2026-09-16 之前這一格根本不存在：`productName` 只留在計畫物件上，
    // 而寫入端只寫 `doc`，所以「買的那一款排第一顆、預設選好」
    //（`ivChoicesFor()`）與「品項跟買的不一樣」（`assignmentWarnings()`、
    // 資料健檢的 `ivMismatch`）對匯進來的那幾筆全部看不到。
    let ivProductId = null;
    if (norm(e.productName)) {
      const item = byName(ivProducts, e.productName);
      if (item) ivProductId = item.id;
      else problem(e.label, e.productName, '主檔裡沒有這個營養點滴品項，這筆額度不記買了哪一款');
    }

    // 健檢的等級（`12萬健檢` 的 `12萬`）。合併檔 v3 沒有帶這一格，而 ADR-0054
    // 說它住在額度上 —— 解析得出來就補上，認不出來（`x萬健檢`）就留空不要猜。
    // 哪一種課程有等級：**「做完還要再約一次」的那一種**（健檢）。
    // 判斷借 `followupCourseIdOf()` —— `ui/components/buy.js` 決定要不要畫
    // 那一排「幾萬的」時問的是同一支，兩邊各比一次 `followupCourseId`
    // 遲早有一邊漏掉。
    const tier = followupCourseIdOf(course) ? tierFromLegacyLabel(e.label, course.name) : null;

    const doc = {
      type: e.type === 'pool' ? 'pool' : 'single',
      label: e.label,
      courseId: e.type === 'pool' ? null : course?.id ?? null,
      optionEquipmentIds: e.type === 'pool' ? optionIds : null,
      // 買的那一款。沒買特定品項（舊表寫的是「營養針」那種）就是 null，
      // 而 `ivChoicesFor()` 看到 null 會退回「全部列出來」—— 那是對的。
      ivProductId,
      totalQty: Number(e.totalQty) || 0,
      // v3 帶時長（舊表的 `復能(30分）`、`ILIB 30`）。沒帶就是課程的時長，跟以前一樣
      durationMin: minutesOf(e.durationMin) ?? course?.durationMin ?? null,
      frequencyRule: course?.frequencyRule ?? null,
      // v2 帶得出購買日與方案（skill 那一側從 B2 拆出來的，`legacyImport.js` 的
      // `parsePurchaseCell()`）。v1 沒有就是 null，跟以前一模一樣。
      sourcePlanName: e.sourcePlanName ?? null,
      sourcePlanSets: e.sourcePlanSets ?? null,
      sourcePlanQty: e.sourcePlanQty ?? null,
      // 同一次購買共用一個 id（「買過什麼」與客戶抬頭靠它與購買日分組）。
      // 檔案裡只是一個暗號（`plan`／`extras`），換成這位客戶自己的字串，不寫進 purchaseKey
      purchaseId: e.purchaseKey ? `import:${name}:${e.purchaseKey}` : null,
      purchasedAt: e.purchasedAt ?? null,
      expiresAt: null,
      doneCount: 0,
      bookedCount: 0,
      lastReconciledAt: null,
      importedFrom: stamp,
      ...(tier ? { tier } : {}),
    };

    entitlements.push({
      key: e.key,
      productName: e.productName ?? null,
      // **匯進來的名字改成 app 的寫法**（ADR-0095）。算不出來的保留她原本的字 ——
      // 那幾筆由資料健檢列出來讓她逐筆改。
      doc: { ...doc, label: importedLabel(doc, { courses, equipment, ivProducts }) },
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
      purchasedAt: entry.purchasedAt ?? null,
      membershipExpiresAt: null,
      priority: 0,
      // v3 帶警示與合作機構：產檔那側照舊表的字判好的（她 2026-09-07：自動帶、否定句不算，ADR-0092）。
      // v1、v2 沒有就是空的，跟以前一樣
      flags: stringList(entry.flags),
      partners: stringList(entry.partners),
      // v2 帶的是帶顏色的備註（有「尾款」的是紅色）。**marks 是真相，notes 是鏡像**（ADR-0019）。
      // v1 沒有 marks 就不寫 —— `readMarks()` 會把 notes 逐行拆成灰色的。
      ...marksOf(entry),
      active: true,
      importedFrom: stamp,
    },
    // B2 拿應有次數驗過一次、對不上的那幾條。匯入那一頁每位客戶要列出來
    purchaseProblems: Array.isArray(entry.purchaseProblems) ? entry.purchaseProblems : [],
    entitlements,
    visits,
    problems,
    // 舊表沒有「永久限制」這個欄位，所以那幾句話寫在購買名稱或空白處，而合併檔
    // 把它們原封不動收進 `notes`。v3 起產檔那側會替金屬類、血管類帶上警示（ADR-0092），
    // 但判準只認得那兩類的寫法 —— 其餘的字眼照樣只在這裡提示，要她自己去點。
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

/**
 * 器材、品項、診間、人：名字對得到就填，對不到就講一聲留空。
 *
 * **人要看角色。** 行事曆上「*許」寫在同一格裡（產檔那側的 `therapistName`），
 * 而那是一位醫師 —— 醫師與治療師在時段上是**兩個欄位**（ADR-0026）。
 *
 * 2026-09-16 之前這裡不看角色，於是她那份 import 的 9 段二返裡有 8 段把醫師
 * 寫進了 `therapistId`，而 `doctorId` 這一格連 `null` 都沒有。三個後果：
 * 試算表那一格印成「7/17 二返」（`sheetReport.js` 讀的是 `doctorId`，
 * 而空括號在她的寫法裡是「還沒約」的意思，ADR-0026）；她一改那一段再存，
 * `visitEditor.js` 因為二返不指派治療師而把 `therapistId` 清成 null ——
 * **名字安靜地不見了**；撞期判斷刻意不比醫師，但那 8 段是當成治療師比的。
 */
function resolveAssignments(slot, { equipment, ivProducts, rooms, staff }, problem, where) {
  const pick = (list, value, what) => {
    if (!norm(value)) return null;
    const hit = byName(list, value);
    if (!hit) problem(where, value, `主檔裡沒有這個${what}，這個時段的欄位留空`);
    return hit?.id ?? null;
  };

  // 產檔那側只有一格「誰」。對得到主檔才分得出角色 —— 對不到時
  // 講的那一句要照舊說「治療師」，因為那是她在行事曆上寫那個字的位置。
  const whoName = norm(slot.therapistName);
  const who = whoName ? byName(staff, whoName) : null;
  if (whoName && !who) problem(where, whoName, '主檔裡沒有這個治療師，這個時段的欄位留空');
  const isDoctor = who?.role === DOCTOR_ROLE;

  return {
    equipmentId: pick(equipment, slot.equipmentName, '器材'),
    ivProductId: pick(ivProducts, slot.ivProductName, '營養點滴品項'),
    roomId: pick(rooms, slot.roomName, '診間'),
    therapistId: isDoctor ? null : (who?.id ?? null),
    doctorId: isDoctor ? who.id : null,
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

/** v2 的備註。寫入的形狀只有 `toCustomerFields()` 一份；v1 沒有 marks 就只寫 notes。 */
function marksOf(entry) {
  if (!Array.isArray(entry.marks)) return { notes: entry.notes ?? '' };
  const { marks, notes } = toCustomerFields(entry.marks);
  return { marks, notes: notes ?? '' };
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
    purchaseProblems: [],
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
 * **判斷不在這裡。** 呼叫的是寫入端在跑的那一支（`importedTasksFor()`），
 * 這裡只負責數 —— 在 UI 上再判斷一次「哪一種來訪會長任務」，就是第二份實作，
 * 而它一定會跟真正寫入的那一份跑掉。2026-09-16 就跑掉過一次：兩邊都呼叫
 * `syncTasksForVisit()`，數字是對的，但**那 18 張全部是掛在已經發生的來訪上的
 * 「寫紀錄」**，而確認框拿這個數字去寫「還沒發生的那幾筆會產生 N 筆登記待辦」。
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
      (m, v) => m + importedTasksFor(v, { coursesById, today }).length, 0,
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
    // 會匯進去的那幾位身上、文字裡提到的警示。**跳過的那幾位不算** ——
    // 她們根本不會進來，講了只會讓真的要處理的那幾位被稀釋掉。
    contraindications: live
      .filter((p) => (p.contraindications ?? []).length)
      .map((p) => ({
        customerName: p.customerName || p.sheetName,
        terms: [...new Set(p.contraindications.map((h) => h.term))],
        warns: [...new Set(p.contraindications.flatMap((h) => h.warns))],
      })),
  };
}
