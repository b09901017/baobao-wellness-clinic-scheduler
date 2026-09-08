// 資料健檢。SPEC 第 6.6 節的對帳，全部是純函式。
//
// 這一支不新增任何一條規則 —— 每一項檢查都是把 /domain 既有的判斷拿去全庫跑一遍：
// 次數對帳與額度超用用 entitlements.js 的 reconcile() / counts() / isOverused()，
// 二返額度用 followups.js 的 missingPairs() / countMismatches()，
// 逾期任務用 taskRules.js 的 urgency()，可用性過期用 availability.js 的
// currentCollection()，衝突殘留用 visitTime.js 的 overlaps()。
// 同一件事有第二套算法就會出現「詳情頁說對、資料健檢說錯」，那比不做這一頁還糟。
//
// 只算不寫：這裡回傳的是差異，不是修好的資料。要不要改是她的決定
//（docs/adr/0002-app-records-decisions-it-does-not-make-them.md）。
// 給得出一鍵修正的是**符合 SPEC 第 6.6 節那三個條件**的那幾項（有明確正解／
// 沒有第二種意思／沒有別的地方做得了）—— 跟 SPEC 一樣寫條件不寫數字，
// 因為那個數字會變，而上一次它變了的時候畫面與規格就對不起來了。
// 今天符合的是計數欄位重算（docs/adr/0007-health-check-reads-only.md）、
// 補上缺的二返額度（docs/adr/0023-health-check-can-also-create-the-missing-followup.md）
// 與備註的舊說法改名（docs/adr/0050-the-health-can-rename-an-imported-note.md）。

import {
  counts, reconcile, isOverused, schedulable, poolName, timedLabel, legacyPoolNames,
} from './entitlements.js';
import { contraindicationTerms } from './contraindications.js';
import { SEED } from './seed.js';
import { clinicalTerms, durationChoicesOf, ASSIGN_LABELS } from './masterData.js';
import { fullNameOf } from './naming.js';
import { missingPairs, countMismatches } from './followups.js';
import { urgency } from './taskRules.js';
import { monthLabel } from './dates.js';
import { currentCollection, collectionsByMonth, summarizeCollection } from './availability.js';
import { overlaps, isValidTime } from './visitTime.js';
import { VISIT_STATUSES, isActive, visitStatusFrom, describeStatus } from './visits.js';
import { readMarks, toCustomerFields } from './customerMarks.js';
import { CHART_NO_PREFIX, OLD_CHART_NO_PREFIX } from './legacyImport.js';

/**
 * 檢查的順序就是畫面上的順序：先資料本身對不對，再輪到要她處理的事。
 * id 會出現在網址與稽核訊息裡，不要改。
 *
 * **每一個 id 在 `RUNNERS` 都要有一支，`ui/views/health.js` 的 `FIX_COPY`
 * 也要有一列**（那一項給不給修正都要，不給的話文案裡不放按鈕就好）。
 */
export const CHECKS = [
  {
    id: 'counts',
    label: '次數對帳',
    hint: 'entitlement 的計數欄位是不是等於從來訪重算的值',
  },
  {
    id: 'followups',
    label: '二返額度',
    hint: '買了健檢卻還沒配到二返額度的客戶（沒有額度，二返就記不進來）',
  },
  {
    id: 'orphans',
    label: '孤兒資料',
    hint: '指向不存在的客戶、額度、課程、診間、器材的來訪、任務或隨手記',
  },
  {
    id: 'visitStatus',
    label: '狀態異常',
    hint: '日期已過但還沒結案的來訪、標成已完成卻一段都沒做的，以及不在合法清單內的狀態',
  },
  {
    id: 'overused',
    label: '額度超用',
    hint: '已排 + 已完成超過總次數',
  },
  {
    id: 'conflicts',
    label: '衝突殘留',
    hint: '她自己排的來訪之間，同診間床位或同治療師撞在一起',
  },
  {
    id: 'overdueTasks',
    label: '逾期任務',
    hint: '死線已過但還沒勾完成',
  },
  {
    id: 'staleAvailability',
    label: '資料過期',
    hint: '本輪可用性已過有效期，排序會失真',
  },
  {
    id: 'duplicateAvailability',
    label: '同一個月有兩份',
    hint: '同一個月記了兩份不能的時間 —— 壓表只挑得到其中一份，另一份是隱形的',
  },
  {
    id: 'ivMismatch',
    label: '品項跟買的不一樣',
    hint: '排出去的營養點滴品項不是那筆額度買的那一款 —— 試算表印的跟次數扣的對不起來',
  },
  {
    id: 'chartNo',
    label: '備註寫著舊的說法',
    hint: '匯入時寫成「姓名欄的編號：」的那幾則，其實那是病歷號',
  },
  {
    id: 'poolLabel',
    label: '復能額度還叫舊名字',
    hint: '以前買的那幾筆叫「復能」或「復能 - 三選一（60）」，新的叫「復能-三選一(60)」'
      + ' —— 同一位客戶身上兩種名字並排，看起來像兩種東西',
  },
  {
    id: 'alertTerm',
    label: '器材上的提醒詞不在警示名單裡',
    hint: '客戶身上打了那個字，壓表卡片牆上卻什麼都不會出現 —— 跟做對了長得一模一樣',
  },
  {
    id: 'seedEquipment',
    label: '器材主檔少了一台',
    hint: '「四選一」那一顆丸子要有一台不屬於復能的器材才畫得出來'
      + ' —— 少了 ILIB 那一台，加購那一排只剩三選一，而畫面上看不出少了什麼',
  },
  {
    id: 'equipmentCourse',
    label: '器材沒有指到課程',
    hint: '「用這台的那一段算哪一個課程」沒填的話，四選一選到 ILIB 也不會變成選診間'
      + ' —— 畫面上跟做對了長得一模一樣',
  },
  {
    id: 'roomList',
    label: '診間清單跟建議的不一樣',
    hint: '2026-09-08 重畫過一次：治療室只有 2 3 5 8、多了 VIP 室、一間 4 號都沒有，'
      + '而月曆那一格印的是簡寫',
  },
  {
    id: 'slotBeds',
    label: '來訪上還記著床位',
    hint: '床位那一層取消了（一間就是一個資源）。舊來訪身上那個 A／B 留著的話，'
      + '撞期判斷會把同一間的兩個人當成不衝突',
  },
  {
    id: 'equipmentNames',
    label: '器材的名字跟建議的不一樣',
    hint: '額度的名字讀器材的全名（`復能-SIS(60)`）、月曆讀別稱（`IN(60)`）——'
      + ' 那兩格還停在舊的，這兩個地方就都印不出她要的字',
  },
  {
    id: 'courseAssigns',
    label: '課程的指派跟建議的不一樣',
    hint: '健檢、體適能、身體組成、營養諮詢、門診與二返都不需要治療室 ——'
      + ' 還指派著治療室的話，壓表時會多問一個不該問的問題，而她會隨便挑一間',
  },
  {
    id: 'visitStatusDerived',
    label: '來訪的狀態跟它的時段對不起來',
    hint: '整筆寫著「已確認」，底下卻有一段還是待確認 ——'
      + ' 日曆上的顏色與待辦中心那一列會各講各的',
  },
  {
    id: 'seedDuration',
    label: '課程沒填可選時長',
    hint: '復能與 ILIB 有 30 與 60 兩種規格。沒填的話加購時「幾分鐘」那一排不出現，'
      + '名字也少了後面那個數字，月檢視更分不出那天排的是 30 還是 60',
  },
];

/** 嚴重度只有兩級。'mismatch' 是資料自己對不起來，'attention' 是要她去處理一件事。 */
export const SEVERITIES = ['mismatch', 'attention'];

const byId = (rows) => Object.fromEntries((rows ?? []).map((r) => [r.id, r]));
const alive = (rows) => (rows ?? []).filter((r) => !r.deletedAt);

/**
 * 全庫掃一次。
 *
 * @param {object} snapshot
 * @param {object[]} snapshot.customers  含已刪除 —— 要分得出「指向已刪除的客戶」與「指向不存在的客戶」
 * @param {object[]} snapshot.entitlements 含已刪除，每筆帶 customerId
 * @param {object[]} snapshot.visits     未刪除
 * @param {object[]} snapshot.tasks      未刪除，含已完成的
 * @param {object[]} snapshot.availability 未刪除，每筆帶 customerId
 * @param {object} snapshot.master       { courses, rooms, staff, equipment, ivProducts }，含已刪除
 * @param {string} today 'YYYY-MM-DD'
 * @returns {{today:string, checks:object[], totals:{findings:number, mismatch:number, attention:number}}}
 */
export function runHealthCheck(snapshot, today) {
  const ctx = prepare(snapshot, today);

  const checks = CHECKS.map((check) => {
    const findings = RUNNERS[check.id](ctx);
    return {
      ...check,
      findings,
      count: findings.length,
      fixable: findings.filter((f) => f.fix).length,
    };
  });

  return { today, checks, totals: totalsOf(checks) };
}

/** 首頁徽章要的一句話。沒有問題時回 null —— 沒事就不要在畫面上佔位置。 */
export function healthBadge(result) {
  const t = result?.totals;
  if (!t?.findings) return null;
  const parts = [];
  if (t.mismatch) parts.push(`${t.mismatch} 筆資料對不起來`);
  if (t.attention) parts.push(`${t.attention} 筆要處理`);
  return parts.join('・');
}

function totalsOf(checks) {
  const all = checks.flatMap((c) => c.findings);
  return {
    findings: all.length,
    mismatch: all.filter((f) => f.severity === 'mismatch').length,
    attention: all.filter((f) => f.severity === 'attention').length,
    fixable: all.filter((f) => f.fix).length,
  };
}

// ---------- 共用的前置整理 ----------
//
// 一半以上的檢查都要「這位客戶的來訪」與「這筆額度屬於誰」，
// 各自再算一次就是七次全表掃描。整理一次，大家共用。

function prepare(snapshot, today) {
  const customers = snapshot.customers ?? [];
  const entitlements = snapshot.entitlements ?? [];
  const visits = alive(snapshot.visits);
  const tasks = alive(snapshot.tasks);
  const availability = alive(snapshot.availability);
  // 快照沒帶隨手記時當成空的 —— 舊的呼叫端與既有測試不必為了這件事全部改。
  const notes = alive(snapshot.notes);
  const master = snapshot.master ?? {};

  const visitsByCustomer = {};
  for (const v of visits) (visitsByCustomer[v.customerId] ??= []).push(v);

  const availByCustomer = {};
  for (const a of availability) (availByCustomer[a.customerId] ??= []).push(a);

  const entsByCustomer = {};
  for (const e of entitlements) (entsByCustomer[e.customerId] ??= []).push(e);

  return {
    today,
    customers,
    customersById: byId(customers),
    entitlements,
    entsByCustomer,
    entitlementsById: byId(entitlements),
    visits,
    visitsById: byId(visits),
    visitsByCustomer,
    tasks,
    notes,
    availByCustomer,
    coursesById: byId(master.courses),
    roomsById: byId(master.rooms),
    staffById: byId(master.staff),
    equipmentById: byId(master.equipment),
    ivProductsById: byId(master.ivProducts),
    // 這兩份是給「復能額度還叫舊名字」與「提醒詞不在警示名單裡」用的，
    // 而它們要的是**陣列**（算名字與比名單都要順序）。
    equipment: alive(master.equipment),
    courses: alive(master.courses),
    clinicalFlags: alive(master.clinicalFlags),
  };
}

/** 客戶的顯示名。已刪除的也要看得到名字，不然差異報告讀不懂。 */
function nameOf(ctx, customerId) {
  return ctx.customersById[customerId]?.name ?? '（找不到這位客戶）';
}

// ---------- 一、次數對帳 ----------

function checkCounts(ctx) {
  const out = [];

  for (const customer of alive(ctx.customers)) {
    const visits = ctx.visitsByCustomer[customer.id] ?? [];

    for (const e of alive(ctx.entsByCustomer[customer.id] ?? [])) {
      const rec = reconcile(e, visits, e.id);
      if (rec.ok) continue;

      out.push({
        severity: 'mismatch',
        title: `${customer.name}・${e.label}`,
        detail:
          `計數欄位是 已完成 ${rec.stored.done}、已排未上 ${rec.stored.booked}，`
          + `從來訪重算是 已完成 ${rec.actual.done}、已排未上 ${rec.actual.booked}`,
        link: `#/customers/${customer.id}`,
        // 真相永遠是 visits（ADR-0004），所以這一項有明確正解，可以一鍵修正。
        fix: {
          kind: 'recount',
          customerId: customer.id,
          entitlementId: e.id,
          label: `${customer.name}・${e.label}`,
          from: { done: rec.stored.done, booked: rec.stored.booked },
          to: { done: rec.actual.done, booked: rec.actual.booked },
        },
      });
    }
  }

  return out;
}

// ---------- 二、二返額度 ----------
//
// 「買了 N 次健檢就有 N 次二返」這條規則是 2026-08 才做進系統的（GitHub issue #15），
// 而額度一旦展開就跟範本脫鉤了（ADR-0003）—— 所以在那之前建立的客戶身上不會有
// 二返額度，包括從舊試算表匯進來的那 21 位。沒有額度，她行事曆上那十筆二返就
// 記不進系統。這一項把那些人列出來。
//
// 這是資料健檢的第二個會寫入的動作（ADR-0007 原本只給計數對帳一個），
// 理由見 docs/adr/0023-health-check-can-also-create-the-missing-followup.md。

function checkFollowups(ctx) {
  const out = [];

  for (const customer of alive(ctx.customers)) {
    if (customer.active === false) continue;
    const ents = alive(ctx.entsByCustomer[customer.id] ?? []);

    for (const miss of missingPairs(ents, ctx.coursesById)) {
      out.push({
        severity: 'mismatch',
        title: `${customer.name}・${miss.source.label}`,
        detail: `健檢有 ${miss.source.totalQty ?? 0} 次，但身上沒有對應的二返額度 ——`
          + '二返記不進來，「約二返」的待辦也不會長出來',
        link: `#/customers/${customer.id}`,
        // 次數就是健檢的次數，不需要任何判斷，所以這一項可以一鍵補。
        fix: {
          kind: 'addFollowup',
          customerId: customer.id,
          label: `${customer.name}・${miss.source.label}`,
          draft: miss.draft,
          qty: miss.draft.totalQty,
        },
      });
    }

    // 次數對不上**不給一鍵修正**：她可能是故意的（其中一次的報告用電話講完了）。
    // 只有「完全沒有」才存在不需要判斷的正解。
    for (const bad of countMismatches(ents, ctx.coursesById)) {
      out.push({
        severity: 'attention',
        title: `${customer.name}・${bad.followup.label}`,
        detail: `健檢是 ${bad.expected} 次，二返卻是 ${bad.actual} 次。`
          + '故意給的就不用管，不是的話到客戶詳情頁改二返那一筆的總次數',
        link: `#/customers/${customer.id}`,
        fix: null,
      });
    }
  }

  return out;
}

// ---------- 三、孤兒資料 ----------
//
// 「指向已刪除的」與「指向根本不存在的」要分開講：前者通常是她自己刪的主檔，
// 後者代表資料真的少了一塊。兩種的處理方式不一樣，混在一起她會分不出哪筆要緊。

function checkOrphans(ctx) {
  const out = [];

  const refState = (id, table) => {
    if (!id) return 'none';
    const row = table[id];
    if (!row) return 'missing';
    return row.deletedAt ? 'deleted' : 'ok';
  };

  const push = (state, { title, what, link }) => {
    if (state === 'ok' || state === 'none') return;
    out.push({
      severity: state === 'missing' ? 'mismatch' : 'attention',
      title,
      detail: state === 'missing' ? `${what}不存在` : `${what}已被刪除`,
      link,
      fix: null,
    });
  };

  for (const visit of ctx.visits) {
    const link = `#/visits/${visit.id}`;
    const who = visit.customerName ?? nameOf(ctx, visit.customerId);
    const head = `來訪 ${visit.date}・${who}`;

    push(refState(visit.customerId, ctx.customersById), {
      title: head, what: '這筆來訪指向的客戶', link,
    });

    (visit.slots ?? []).forEach((slot, i) => {
      const at = `${head}・第 ${i + 1} 個時段`;
      push(refState(slot.entitlementId, ctx.entitlementsById), {
        title: at, what: '這個時段指向的額度', link,
      });
      push(refState(slot.courseId, ctx.coursesById), {
        title: at, what: '這個時段指向的課程', link,
      });
      push(refState(slot.roomId, ctx.roomsById), {
        title: at, what: '這個時段指向的診間', link,
      });
      push(refState(slot.therapistId, ctx.staffById), {
        title: at, what: '這個時段指向的治療師', link,
      });
      // 醫師和治療師都住在 staff 底下，但各指各的欄位 ——
      // 二返有醫師沒有治療師（ADR-0026），少查一個就是少一種孤兒
      push(refState(slot.doctorId, ctx.staffById), {
        title: at, what: '這個時段指向的醫師', link,
      });
      push(refState(slot.equipmentId, ctx.equipmentById), {
        title: at, what: '這個時段指向的器材', link,
      });
      push(refState(slot.ivProductId, ctx.ivProductsById), {
        title: at, what: '這個時段指向的營養點滴品項', link,
      });
    });
  }

  for (const task of ctx.tasks) {
    const who = task.customerName ?? nameOf(ctx, task.customerId);
    const head = `任務 ${task.kind}・${who}`;
    const link = task.visitId ? `#/visits/${task.visitId}` : null;

    push(refState(task.customerId, ctx.customersById), {
      title: head, what: '這筆任務指向的客戶', link,
    });

    // visitId 是 null 代表手動加的獨立待辦，那是正常的，不是孤兒。
    if (task.visitId && !ctx.visitsById[task.visitId]) {
      out.push({
        severity: 'mismatch',
        title: head,
        detail: '這筆任務指向的來訪不存在或已刪除，但任務還開著',
        link: null,
        fix: null,
      });
    }
  }

  // 隨手記。**只看已經勾了人或勾了額度的那些** —— 沒掛人的雜事是正常的
  // （`data/notes.js`：「沒掛人的雜事通常是最容易忘的那些」），不是孤兒。
  //
  // `entitlementId` 那一條是這一段真正的理由：營養品的提醒靠它找到要把
  // 交付寫回哪一包（ADR-0059）。額度被刪掉之後那一筆提醒還在、還勾得動，
  // 而勾下去 `recordDelivery()` 寫不進任何東西 —— 畫面上看起來就只是勾掉了，
  // 那份要進試算表的交付紀錄安靜地沒了。
  for (const note of ctx.notes) {
    const who = note.customerName ?? (note.customerId ? nameOf(ctx, note.customerId) : '');
    const head = `隨手記「${String(note.text ?? '').slice(0, 20)}」${who ? `・${who}` : ''}`;
    const link = note.customerId ? `#/customers/${note.customerId}` : '#/todo/notes';

    push(refState(note.customerId, ctx.customersById), {
      title: head, what: '這則隨手記掛的客戶', link,
    });
    push(refState(note.entitlementId, ctx.entitlementsById), {
      title: head, what: '這則提醒要記回去的那一包營養品', link,
    });
  }

  return out;
}

// ---------- 四、狀態異常 ----------

function checkVisitStatus(ctx) {
  const out = [];

  for (const visit of ctx.visits) {
    const who = visit.customerName ?? nameOf(ctx, visit.customerId);

    // 繞過前端寫進來的狀態。Rules 只驗形狀不驗轉移（ADR-0006），
    // 所以這一項是它唯一會被看見的地方。
    if (!VISIT_STATUSES.includes(visit.status)) {
      out.push({
        severity: 'mismatch',
        title: `來訪 ${visit.date}・${who}`,
        detail: `狀態「${visit.status ?? '（空的）'}」不在合法清單內`,
        link: `#/visits/${visit.id}`,
        fix: null,
      });
      continue;
    }

    if (visit.date < ctx.today
        && (visit.status === 'confirmed' || visit.status === 'pending_confirm')) {
      out.push({
        severity: 'attention',
        title: `來訪 ${visit.date}・${who}`,
        detail: visit.status === 'confirmed'
          ? '日期已過但還是「客戶已確認」，該標已完成或未到了'
          : '日期已過但還在等客戶回覆，該結案了',
        link: `#/visits/${visit.id}`,
        fix: null,
      });
    }

    // 標成已完成、卻一段都沒做。`closeVisit()` 產不出這種東西
    // （一段都沒做就是整筆未到），所以會出現只有一個原因：有人繞過前端改了資料。
    // 它會讓次數看起來扣了、實際上一次都沒扣，而畫面上分不出來。
    // 見 docs/adr/0025-what-happened-is-recorded-per-slot.md
    const slots = visit.slots ?? [];
    if (visit.status === 'done' && slots.length && slots.every((sl) => sl.attended === false)) {
      out.push({
        severity: 'mismatch',
        title: `來訪 ${visit.date}・${who}`,
        detail: '標成「已完成」但每一段都記成沒做，次數一次都沒扣。該標成未到嗎？',
        link: `#/visits/${visit.id}`,
        fix: null,
      });
    }
  }

  return out;
}

// ---------- 五、額度超用 ----------

function checkOverused(ctx) {
  const out = [];

  for (const customer of alive(ctx.customers)) {
    const visits = ctx.visitsByCustomer[customer.id] ?? [];

    for (const e of alive(ctx.entsByCustomer[customer.id] ?? [])) {
      // 刻意用重算值而不是計數欄位：欄位可能正好是歪的那一個，
      // 拿它判斷超用會同時漏掉真的超用、又冤枉沒超用的。
      const c = counts(e, visits, e.id);
      if (!isOverused(c)) continue;

      out.push({
        severity: 'attention',
        title: `${customer.name}・${e.label}`,
        detail: `共 ${c.total} 次，已完成 ${c.done}、已排未上 ${c.booked}，超出 ${
          c.done + c.booked - c.total
        } 次`,
        link: `#/customers/${customer.id}`,
        fix: null,
      });
    }
  }

  return out;
}

// ---------- 六、衝突殘留 ----------
//
// 只看她自己排的來訪彼此之間。跨同事的衝突看不到，以 Abovee 為準（SPEC 第 4.7 節），
// 所以這裡找到的一定是她自己重複排的 —— 那是真的要處理的東西。

function checkConflicts(ctx) {
  const out = [];
  const byDate = {};
  for (const v of ctx.visits) {
    if (!isActive(v)) continue;
    (byDate[v.date] ??= []).push(v);
  }

  for (const [date, visits] of Object.entries(byDate)) {
    // 攤平成時段清單再兩兩比，避免四層迴圈讀不懂
    const slots = visits.flatMap((visit) =>
      (visit.slots ?? [])
        .filter((s) => isValidTime(s.startsAt) && isValidTime(s.endsAt))
        .map((slot) => ({ visit, slot })),
    );

    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const a = slots[i];
        const b = slots[j];
        if (a.visit.id === b.visit.id) continue;
        if (!overlaps(a.slot, b.slot)) continue;

        const sameRoom = a.slot.roomId && a.slot.roomId === b.slot.roomId
          && (a.slot.bed ?? null) === (b.slot.bed ?? null);
        const sameTherapist = a.slot.therapistId && a.slot.therapistId === b.slot.therapistId;
        if (!sameRoom && !sameTherapist) continue;

        const what = sameRoom
          ? `${ctx.roomsById[a.slot.roomId]?.name ?? '某診間'}${a.slot.bed ?? ''}`
          : `${ctx.staffById[a.slot.therapistId]?.name ?? '某治療師'}`;

        out.push({
          severity: 'attention',
          title: `${date} ${what}`,
          detail:
            `${a.slot.startsAt}–${a.slot.endsAt} ${a.visit.customerName ?? nameOf(ctx, a.visit.customerId)}`
            + ` 與 ${b.slot.startsAt}–${b.slot.endsAt} ${b.visit.customerName ?? nameOf(ctx, b.visit.customerId)}`
            + ' 撞在一起',
          link: `#/visits/${a.visit.id}`,
          fix: null,
        });
      }
    }
  }

  return out;
}

// ---------- 七、逾期任務 ----------

function checkOverdueTasks(ctx) {
  return ctx.tasks
    .filter((t) => !t.done && urgency(t.dueDate, ctx.today) === 'overdue')
    .map((t) => ({
      severity: 'attention',
      title: `${t.kind}・${t.customerName ?? nameOf(ctx, t.customerId)}`,
      detail: `死線 ${t.dueDate} 已經過了`,
      link: t.visitId ? `#/visits/${t.visitId}` : '#/',
      fix: null,
    }));
}

// ---------- 八、資料過期 ----------
//
// 過期的可用性不會擋任何事，但會讓壓表的排序失真 ——
// 「可用天數最少的優先」建立在那份資料還有效的前提上。

function checkStaleAvailability(ctx) {
  const out = [];

  for (const customer of alive(ctx.customers)) {
    if (customer.active === false) continue;

    const collections = ctx.availByCustomer[customer.id] ?? [];
    const current = currentCollection(collections, ctx.today);
    if (current) continue;

    // 還有剩餘次數才要緊 —— 沒有次數可排的人不需要被問時間。
    // **營養品不算**（ADR-0057）：只買了兩罐夜態美的客戶不需要被問時間，
    // 而「還有 2 次沒排」那句話講的是兩罐營養品，她會照著去問一個不存在的班。
    const remaining = schedulable(alive(ctx.entsByCustomer[customer.id] ?? [])).reduce((sum, e) => {
      const c = counts(e, ctx.visitsByCustomer[customer.id] ?? [], e.id);
      return sum + Math.max(0, c.remaining);
    }, 0);
    if (remaining <= 0) continue;

    out.push({
      severity: 'attention',
      title: customer.name,
      detail: collections.length
        ? `最近一份可用性收集已過有效期，還有 ${remaining} 次沒排`
        : `從來沒收集過可用性，還有 ${remaining} 次沒排`,
      link: `#/customers/${customer.id}`,
      fix: null,
    });
  }

  return out;
}

// ---------- 九、備註寫著舊的說法 ----------
//
// 舊試算表的姓名格是 `王小明 (高能/sis)3157`，匯入時把那串數字寫成備註
// 「姓名欄的編號：3157」—— 當初刻意不認定它是什麼，因為舊表沒有標題。
// 2026-08-24 她說了：**那就是病歷號。**
//
// 匯入端已經改成寫「病歷號 3157」，但既有的二十幾位身上還掛著舊的說法，
// 而那是她天天看得到的字。這一項把它們列出來，一鍵改掉。
//
// **這是資料健檢第三個會寫入的動作**（ADR-0007 原本只給計數對帳一個，
// ADR-0023 加了補二返額度）。它符合那兩支的條件：有明確正解、
// 而且沒有第二種可能的意思。

/**
 * 同一個月記了兩份不能的時間。
 *
 * **只列不修**（ADR-0053）。壓表挑的是「涵蓋那個月、交集最多」的那一份
 *（`collectionFor()`，ADR-0036），所以它挑得出來 —— 但另一份是隱形的：
 * 她在客戶詳情上看到的是最新的那一份，壓表用的可能是另一份。
 *
 * 不自動合併也不自動刪：兩份的內容可能都對（她問了兩次、客人改口），
 * 而合併是不可逆的；其中一份如果是問錯人記的，錯的那幾天會被永久併進來。
 * 2026-08-25 使用者選的就是「列出來，我自己決定」。
 *
 * 動線上以後不會再長出新的：「記一次 → 新增」那一排已經有的月份不出現
 *（`ui/views/availability.js` 的 `openPicker()`）。這一項掃的是既有資料。
 */
function checkDuplicateAvailability(ctx) {
  const out = [];

  for (const customer of alive(ctx.customers)) {
    for (const group of collectionsByMonth(ctx.availByCustomer[customer.id] ?? [])) {
      if (!group.month || group.records.length < 2) continue;

      out.push({
        severity: 'attention',
        title: `${customer.name}・${monthLabel(`${group.month}-01`)}`,
        detail: `記了 ${group.records.length} 份：${
          group.records.map((c) => summarizeCollection(c)).join('；')
        }。壓表只會用到其中一份，留一份就好。`,
        link: `#/customers/${customer.id}`,
        fix: null,
      });
    }
  }

  return out;
}

function checkChartNo(ctx) {
  const out = [];

  for (const customer of alive(ctx.customers)) {
    const marks = readMarks(customer);
    const stale = marks.filter((m) => m.text.startsWith(OLD_CHART_NO_PREFIX));
    if (!stale.length) continue;

    const next = marks.map((m) => (m.text.startsWith(OLD_CHART_NO_PREFIX)
      ? { ...m, text: `${CHART_NO_PREFIX}${m.text.slice(OLD_CHART_NO_PREFIX.length).trim()}` }
      : m));

    out.push({
      severity: 'attention',
      title: customer.name,
      detail: `${stale.map((m) => m.text).join('、')} → ${
        next.filter((m) => m.text.startsWith(CHART_NO_PREFIX)).map((m) => m.text).join('、')}`,
      link: `#/customers/${customer.id}`,
      fix: {
        kind: 'renameChartNo',
        customerId: customer.id,
        label: customer.name,
        // **兩個欄位一起寫。** `notes` 是那幾則備註接起來的純文字，
        // 試算表報表與壓表卡片讀的是它 —— 只改 marks 會讓兩邊從此對不起來。
        changes: toCustomerFields(next),
      },
    });
  }

  return out;
}

/**
 * 排出去的品項不是那筆額度買的那一款。
 *
 * 2026-09-04 以前排班的兩個入口都是把主檔裡**全部**的品項列出來，
 * 所以「營養點滴・A」那筆額度底下排成 B 是存得下去的。現在畫面預設就是買的
 * 那一款（`ivChoicesFor()`），存檔時也會有一句提醒（`assignmentWarnings()`）——
 * 但**已經存進去的那幾筆不會自己好**，而她看不到。
 *
 * **不自動改**（同 `duplicateAvailability` 的判斷）：改的時候她要知道
 * Abovee 上那一筆也要跟著改，那不是 app 做得到的事。所以只列出來，
 * 一列講清楚是哪一天、哪一筆、買的是哪一款、排成了哪一款。
 *
 * `attention` 不是 `mismatch`：資料本身沒有壞（兩邊都指得到東西），
 * 是**她要去看一眼**那一天到底打了哪一款。
 */
function checkIvMismatch(ctx) {
  const out = [];

  for (const visit of ctx.visits) {
    (visit.slots ?? []).forEach((slot, i) => {
      const bought = ctx.entitlementsById[slot.entitlementId]?.ivProductId ?? null;
      if (!bought || !slot.ivProductId || slot.ivProductId === bought) return;

      const who = visit.customerName ?? nameOf(ctx, visit.customerId);
      const name = (id) => ctx.ivProductsById[id]?.name ?? '（已刪除的品項）';
      out.push({
        severity: 'attention',
        title: `來訪 ${visit.date}・${who}・第 ${i + 1} 個時段`,
        detail: `買的是 ${name(bought)}，排成了 ${name(slot.ivProductId)}`,
        link: `#/visits/${visit.id}`,
        fix: null,
      });
    });
  }

  return out;
}

/**
 * 十二、復能額度還叫舊名字。
 *
 * `04` 之後新買的叫「復能三選一(60)」，而既有客戶身上那一筆叫「復能」——
 * 額度的名字是購買當下的快照（ADR-0003），它不會自己跟上。同一位客戶身上
 * 兩種名字並排，看起來像兩種東西。
 *
 * **判準是形狀不是名字**：只認得出「舊的自動名字」的那幾筆。她自己打的名字
 * 不可以被一顆按鈕改掉，所以認不出來的一律不列（同 ADR-0050 的判斷）。
 *
 * 舊的自動名字有哪幾種寫在 `legacyPoolNames()`（三代格式），
 * 時長那個尾巴半形全形兩種都認 —— 2026-09-07 之前是 `(60)`，之後是 `（60）`。
 */
function checkPoolLabels(ctx) {
  const out = [];

  for (const e of ctx.entitlements) {
    if (e.deletedAt || e.type !== 'pool') continue;

    const ids = e.optionEquipmentIds ?? [];
    const bare = poolName(ids, ctx.equipment, ctx.courses);
    if (!bare) continue;                       // 器材全被刪了，講不出該叫什麼
    const want = timedLabel(bare, e.durationMin);
    const now = String(e.label ?? '').trim();
    if (!now || now === want) continue;

    // 她自己打的名字不動 —— 認得出來的只有歷代自動名字。
    // `bare` 也算一種：算得出名字、但還沒有時長的中間狀態。
    const known = new Set();
    const n = Number(e.durationMin);
    for (const name of [...legacyPoolNames(ids, ctx.equipment, ctx.courses), bare]) {
      known.add(name);
      if (Number.isInteger(n) && n > 0) {
        known.add(`${name}(${n})`);
        known.add(`${name}（${n}）`);
      }
    }
    if (!known.has(now)) continue;

    out.push({
      severity: 'attention',
      title: `${nameOf(ctx, e.customerId)}・${now}`,
      detail: `改成「${want}」`,
      link: `#/customers/${e.customerId}`,
      fix: {
        kind: 'renamePool',
        customerId: e.customerId,
        entitlementId: e.id,
        label: `${nameOf(ctx, e.customerId)}・${now}`,
        from: now,
        to: want,
      },
    });
  }

  return out;
}

/**
 * 十三、器材上的提醒詞不在警示名單裡。
 *
 * ADR-0074 之後，客戶身上的字要進得了警示主檔才畫得到（`splitFlags()` 拿那份
 * 名單分兩層）。器材上有、警示主檔沒有的那幾個字，症狀是**客戶身上打了那個字、
 * 壓表卡片牆上卻什麼都不會出現** —— 跟做對了長得一模一樣，所以它必須被列出來。
 *
 * 這一列**之後也還有用**：她新增一台有新提醒詞的器材時會再出現一次。
 */
function checkAlertTerms(ctx) {
  const known = new Set(clinicalTerms(ctx.clinicalFlags));
  return contraindicationTerms(ctx.equipment)
    .filter((term) => !known.has(term))
    .map((term) => ({
      severity: 'attention',
      title: term,
      detail: '客戶身上打了這個字，壓表卡片牆上不會出現任何東西',
      link: '#/settings/clinicalFlags',
      fix: {
        kind: 'addAlert',
        label: term,
        // 紅・實心：這幾個字本來就是最該看到的那一種（種子上的體內金屬也是）
        data: { name: term, color: 'red', fill: 'solid', active: true },
      },
    }));
}

/**
 * 十四、器材主檔少了一台種子資料裡有的。
 *
 * 症狀是**一顆丸子不見了**：加購那一排的「四選一」要有一台 `courseId`
 * 不是復能的器材才組得出來（`poolChoices()`、ADR-0075），而 ILIB 那一台是
 * 2026-09-06 才進種子資料的 —— 在那之前建的資料庫裡沒有它，
 * 於是「四選一」那一顆按不出來，**而畫面上跟「本來就沒有那一種」長得一模一樣**。
 *
 * 她 2026-09-07 的第一句話就是「復能為什麼沒有四選一？」——
 * 這一列就是為了讓那個問題有地方看得到答案。
 *
 * 兩道護欄，兩道都是為了不要變成一個關不掉的提醒：
 *
 * - **她自己刪掉的不算**：比的是 `equipmentById`（含已刪除的）。
 * - **那一台的課程要真的存在**。種子說 ILIB 那一台屬於 `course-iv-laser`，
 *   而她的主檔裡有那個課程 —— 缺的就只是器材那一列。自己從零建主檔、
 *   一個種子 id 都沒有的資料庫（測試夾具就是）不會被念，因為那時候
 *   缺的不是一台器材，是整份主檔。
 */
function checkSeedEquipment(ctx) {
  return (SEED.equipment ?? [])
    .filter((row) => !ctx.equipmentById[row.id] && ctx.coursesById[row.courseId])
    .map((row) => ({
      severity: 'attention',
      title: row.name,
      detail: '種子資料裡有這一台，你的器材主檔沒有 —— 加購那一排會少一顆丸子',
      link: '#/settings/equipment',
      fix: {
        kind: 'addEquipment',
        label: row.name,
        equipmentId: row.id,
        data: { ...withoutId(row), active: true },
      },
    }));
}

/**
 * 十四之二、器材沒有指到課程。
 *
 * **她 2026-09-08 回報的那件事的根因就是這一列。** 她說：
 *
 * > 我選 IN/SIS/高能量雷射並沒有讓我選治療師…就固定成只能選治療師，
 * > 我點 ILIB 的時候也沒有變成選診間？
 *
 * 而壓表與來訪編輯器**早就共用同一支 `assignsFor()` 了**（ADR-0079，
 * 還有一支測試盯著沒有畫面自己比 `course.assigns`）。壞掉的不是程式：
 *
 * `assignsFor()` 的答案來自課程，而擇一池的課程是**器材身上的 `courseId`**
 * 推出來的（`courseForEquipment()`）。那個欄位是 2026-09-06 才加的，而
 * `data/config.js` 的 `loadSeed()` **只建不覆蓋**（`existingIds.has(row.id)`
 * 就整筆跳過，連欄位都不合併）。所以既有資料庫上那幾台身上沒有它：
 *
 *   1. `courseForEquipment()` 推不出來 → 維持原來的課程（復能）
 *   2. `coursesForEntitlement()` 一台都推不出來 → 退回舊行為 → 只有復能
 *   3. 四選一那一池永遠只有復能一個課程 → 指派永遠是治療師
 *
 * 現有的兩列都抓不到：`seedEquipment` 只在那一列**整個不存在**時才報，
 * `equipmentNames` 只看名字兩格。
 *
 * **只在那一格是空的時候報**（同 `checkSeedDurations()`）：她自己指到別的
 * 課程是一個決定，不可以被一顆按鈕改回去。
 *
 * **那個課程要真的存在才報**（同 `checkSeedEquipment()` 那道護欄）——
 * 自己從零建主檔、一個種子 id 都沒有的資料庫不會被念一整排。
 */
function checkEquipmentCourse(ctx) {
  return (SEED.equipment ?? [])
    .filter((row) => row.courseId && ctx.coursesById[row.courseId])
    .map((row) => ({ row, mine: ctx.equipmentById[row.id] }))
    .filter(({ mine }) => mine && !mine.deletedAt && !mine.courseId)
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: `指到「${ctx.coursesById[row.courseId]?.name ?? row.courseId}」`
        + ' —— 沒填的話這一台排出來的那一段算不出是哪個課程，指派也就跟著錯',
      link: '#/settings/equipment',
      fix: {
        kind: 'setEquipmentCourse',
        equipmentId: row.id,
        label: mine.name ?? row.name,
        courseId: row.courseId,
        courseLabel: ctx.coursesById[row.courseId]?.name ?? row.courseId,
      },
    }));
}

/** 種子的一列去掉 id —— `repo.create()` 收的是資料，id 另外給。 */
function withoutId({ id, ...rest }) {
  return rest;
}

/**
 * 2026-09-08 之前種子上有、現在沒有的那幾間。
 *
 * 治7／治9／治10 不在她新的治療室清單裡（只有 2 3 5 8），
 * ILIB4 那一間有個 4 —— 而她說「均無 4 號」。
 *
 * **只認得出種子建過的那幾間**：她自己加的診間一間都不會被列出來。
 */
const LEGACY_ROOMS = [
  { id: 'room-t7', name: '治7' },
  { id: 'room-t9', name: '治9' },
  { id: 'room-t10', name: '治10' },
  { id: 'room-ilib4', name: 'ILIB4' },
];

/**
 * 十五、診間清單跟建議的不一樣。
 *
 * 三種形狀，一種一個 `mode`：
 *
 *   add    種子有、她沒有            → 建起來（VIP 那五間）
 *   drop   種子拿掉了、她還開著       → 刪掉（治7／治9／治10／ILIB4）
 *   short  種子有簡寫、她那一格是空的 → 填上（`.2`、`vip2`）
 *
 * 三種都**只在她那一格還是原樣的時候報**：她自己改過的名字、她自己加的診間、
 * 她自己填過的簡寫，一個都不動（同 `checkPoolLabels()` 那條）。
 *
 * `drop` 那一種要講清楚代價：**既有來訪上那幾筆會印不出診間名字**
 * （她 2026-09-08 知道並且選了）。刪掉走的是這個 app 既有的刪除，
 * 進「已刪除項目」，還原得回來。
 */
function checkRoomList(ctx) {
  const out = [];
  const byId = ctx.roomsById ?? {};

  // **一間種子診間都沒有的主檔不念「少了誰」。** 那不是「少了 VIP 室」，
  // 那是一份她自己從零建起來的清單（測試夾具就是），而拿建議清單去念它
  // 會一次冒出十七列。同 `checkSeedEquipment()` 那道護欄的判斷。
  const seeded = (SEED.rooms ?? []).some((row) => byId[row.id]);

  for (const row of SEED.rooms ?? []) {
    const mine = byId[row.id];
    if (!mine) {
      if (!seeded) continue;
      out.push({
        severity: 'attention',
        title: row.name,
        detail: '建議清單上有這一間，你的診間主檔沒有',
        link: '#/settings/rooms',
        fix: {
          kind: 'applyRoom', mode: 'add', roomId: row.id, label: row.name,
          data: { ...withoutId(row), active: true },
        },
      });
      continue;
    }
    if (mine.deletedAt) continue;

    // 簡寫那一格是空的才補。她自己填過別的就是一個決定。
    const short = String(mine.shortName ?? '').trim();
    if (row.shortName && !short) {
      out.push({
        severity: 'attention',
        title: mine.name ?? row.name,
        detail: `簡寫填上「${row.shortName}」`,
        link: '#/settings/rooms',
        fix: {
          kind: 'applyRoom', mode: 'short', roomId: row.id,
          label: mine.name ?? row.name, shortName: row.shortName,
        },
      });
    }
  }

  for (const row of LEGACY_ROOMS) {
    const mine = byId[row.id];
    // 她自己改過名字就不動 —— 那代表她把那一間拿去當別的用了
    if (!mine || mine.deletedAt || fullNameOf(mine) !== row.name) continue;
    out.push({
      severity: 'attention',
      title: mine.name,
      detail: '新的清單上沒有這一間了',
      link: '#/settings/rooms',
      fix: { kind: 'applyRoom', mode: 'drop', roomId: row.id, label: mine.name },
    });
  }

  return out;
}

/**
 * 十六、來訪上還記著床位。
 *
 * 「取消任何床位區分」（她 2026-09-08）。主檔那一頁與排班的選項已經沒有床位了，
 * 但**既有來訪身上那個 `A` 還在** —— 而 `conflictWarnings()` 的撞期判斷比的是
 * 「同一間**而且**同一床」，所以那幾筆會把同一間同一個時間的兩個人當成不衝突。
 *
 * 她選的是「連舊資料一起清掉」，而那是一次不可逆的改寫，所以它要
 * **看得到、按得到**：列出來、她按了才清。載入時偷偷改等於一次沒有人按過的寫入。
 *
 * 一筆來訪一個 finding（不是一段一個）：她要處理的是那一筆，
 * 而一筆裡兩段都有床位時列兩次只是同一件事說兩遍。
 */
function checkSlotBeds(ctx) {
  return (ctx.visits ?? [])
    .filter((v) => !v.deletedAt && (v.slots ?? []).some((s) => s.bed))
    .map((visit) => {
      const beds = [...new Set((visit.slots ?? []).map((s) => s.bed).filter(Boolean))];
      const who = visit.customerName ?? nameOf(ctx, visit.customerId);
      return {
        severity: 'attention',
        title: `${who}・${visit.date}`,
        detail: `清掉床位 ${beds.join('、')}`,
        link: '#/calendar',
        fix: {
          kind: 'clearBeds',
          visitId: visit.id,
          label: `${who}・${visit.date}`,
          slots: (visit.slots ?? []).map((s) => ({ ...s, bed: null })),
        },
      };
    });
}

/**
 * 2026-09-08 之前種子上那兩台器材的名字。**只認得出這一代。**
 *
 * 那一輪把兩格名字的分工定下來（她選的）：
 *
 *   全名   她叫它什麼           SIS、INDIBA、高能量雷射、ILIB
 *   別稱   月曆那一格的縮寫     （空）、IN、（空）、IL
 *
 * 額度的名字讀全名（`復能-INDIBA(60)`），月曆讀別稱（`IN(60)`）。在那之前
 * 兩邊都讀別稱，而那一台叫「超磁場」、INDIBA 沒有別稱 —— 所以既有資料庫上
 * 額度會印成 `復能-超磁場(60)`、月曆會印成 `INDIBA(60)`，兩個都不是她要的字。
 *
 * `null` 代表「那一格是空的」。
 */
const LEGACY_EQUIPMENT = {
  'eq-sis': { name: '超磁場', shortName: 'SIS' },
  'eq-indiba': { name: 'INDIBA', shortName: null },
};

/**
 * 十七、器材的名字跟建議的不一樣。
 *
 * **兩格要同時還停在舊的才報**：她自己改過其中一格就是一個決定，
 * 不可以被一顆按鈕改回去（同 `checkPoolLabels()` 那條「她自己打的名字不動」）。
 *
 * 改完之後，**「復能額度還叫舊名字」那一列算出來的新名字才會是對的** ——
 * 兩列的順序是這樣：先把器材改名，再改額度的名字。
 */
function checkEquipmentNames(ctx) {
  const same = (a, b) => (String(a ?? '').trim() || null) === (b ?? null);

  return (SEED.equipment ?? [])
    .filter((row) => LEGACY_EQUIPMENT[row.id])
    .map((row) => ({ row, was: LEGACY_EQUIPMENT[row.id], mine: ctx.equipmentById[row.id] }))
    .filter(({ row, was, mine }) => {
      if (!mine || mine.deletedAt) return false;
      if (same(row.name, was.name) && same(row.shortName, was.shortName)) return false;
      return same(mine.name, was.name) && same(mine.shortName, was.shortName);
    })
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: `全名改成「${row.name}」，別稱${
        row.shortName ? `改成「${row.shortName}」` : '清空'}`,
      link: '#/settings/naming',
      fix: {
        kind: 'renameEquipment',
        equipmentId: row.id,
        label: mine.name ?? row.name,
        name: row.name,
        shortName: row.shortName ?? null,
        fromName: mine.name ?? '',
        fromShort: mine.shortName ?? '（空）',
      },
    }));
}

/**
 * 2026-09-08 之前種子上那六個課程的指派。**只認得出這一代。**
 *
 * 她 2026-09-08 給的三條規則把「需要治療室」收斂成營養點滴、EECP、ILIB 三個，
 * 其餘（健檢、體適能、身體組成分析、營養諮詢、門診、二返）都不需要空間。
 * 但 `data/config.js` 的 `loadSeed()` 只建不覆蓋（她可能改過了），
 * 所以改種子資料對她**現有的**資料庫一點作用都沒有 —— 這一列就是那一步。
 */
const LEGACY_ASSIGNS = {
  'course-checkup': 'room',
  'course-fitness': 'room',
  'course-inbody': 'room',
  'course-nutrition-consult': 'room',
  'course-rehab': 'room',
  'course-followup': 'room',
};

/**
 * 十八、課程的指派跟建議的不一樣。
 *
 * **只在她那一格還停在舊種子那一代的時候報。** 她自己改成第三種值是一個決定，
 * 不可以被一顆按鈕改回去（同 `checkPoolLabels()` 那條「她自己打的名字不動」）
 * —— 不然這一列會變成一個關不掉的提醒，而關不掉的提醒她第三天就不看了。
 *
 * 修正**連診間限制一起清**：`validate('courses')` 擋著「不選診間的課程不該
 * 設定診間限制」，只改 `assigns` 的話那一筆之後她一進設定頁就存不下去。
 */
function checkCourseAssigns(ctx) {
  return (SEED.courses ?? [])
    .filter((row) => LEGACY_ASSIGNS[row.id] && LEGACY_ASSIGNS[row.id] !== row.assigns)
    .map((row) => ({ row, mine: ctx.coursesById[row.id] }))
    .filter(({ row, mine }) =>
      mine && !mine.deletedAt && mine.assigns === LEGACY_ASSIGNS[row.id])
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: `現在是「${ASSIGN_LABELS[mine.assigns] ?? mine.assigns}」，`
        + `建議改成「${ASSIGN_LABELS[row.assigns] ?? row.assigns}」`,
      link: '#/settings/courses',
      fix: {
        kind: 'setAssigns',
        courseId: row.id,
        label: mine.name ?? row.name,
        assigns: row.assigns,
        allowedRoomTypes: row.allowedRoomTypes ?? [],
        allowedRoomIds: row.allowedRoomIds ?? [],
        fromLabel: ASSIGN_LABELS[mine.assigns] ?? mine.assigns,
        toLabel: ASSIGN_LABELS[row.assigns] ?? row.assigns,
      },
    }));
}

/**
 * 十九、課程沒填可選時長。
 *
 * 她 2026-09-07：「目前就復能的那四個先預設有 30 60 這兩個時長，
 * 其他的就預設沒有沒關係」。種子上復能與 ILIB 都是 `[30, 60]`，
 * 而 2026-09-06 之前建的資料庫上那一格是空的 —— 症狀有三個，三個都是「少東西」：
 *
 * - 加購時「幾分鐘」那一排整排不出現
 * - 名字少了後面那個數字（`復能-三選一` 而不是 `復能-三選一(60)`）
 * - 月檢視印不出 `SIS(60)`，30 分與 60 分那兩天長得一模一樣
 *
 * **只在她那一格是空的時候報。** 她自己填成 `[60]` 是一個決定，
 * 不可以被一顆按鈕改回去（同 `checkPoolLabels()` 那條「她自己打的名字不動」）。
 */
function checkSeedDurations(ctx) {
  return (SEED.courses ?? [])
    .filter((row) => durationChoicesOf(row).length >= 2)
    .map((row) => ({ row, mine: ctx.coursesById[row.id] }))
    .filter(({ mine }) => mine && !mine.deletedAt && !(mine.durationChoices ?? []).length)
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: `填上 ${durationChoicesOf(row).join('、')} 分鐘`,
      link: '#/settings/courses',
      fix: {
        kind: 'setDurations',
        courseId: row.id,
        label: mine.name ?? row.name,
        durationChoices: durationChoicesOf(row),
      },
    }));
}

/**
 * 二十、來訪的狀態跟它的時段對不起來。
 *
 * `visit.status` 是**從時段推出來又存起來的**（ADR-0081）。存一份推導值是
 * 刻意的重複 —— 索引、Rules、試算表、備份四個地方讀它 —— 而刻意的重複
 * 就要有一列盯著它。
 *
 * 對不起來的來源有兩種：有人繞過前端改了 Firestore，或某一支忘了重推。
 * 兩種的答案一樣：**重推一次**。
 *
 * **一段都沒有 `status` 的舊來訪不報**：那時候推出來的必然等於它自己
 * （`visitStatusFrom()` 是冪等的），所以真的對不起來才會被列出來。
 */
function checkVisitStatusDerived(ctx) {
  return (ctx.visits ?? [])
    .filter((v) => !v.deletedAt && (v.slots ?? []).some((s) => s?.status))
    .map((visit) => ({ visit, want: visitStatusFrom(visit) }))
    .filter(({ visit, want }) => want && want !== visit.status)
    .map(({ visit, want }) => {
      const who = visit.customerName ?? nameOf(ctx, visit.customerId);
      return {
        severity: 'mismatch',
        title: `來訪 ${visit.date}・${who}`,
        detail: `整筆寫著「${describeStatus(visit.status)}」，`
          + `底下那幾段加起來是「${describeStatus(want)}」`,
        link: '#/calendar',
        fix: {
          kind: 'restatVisit',
          visitId: visit.id,
          label: `${who}・${visit.date}`,
          status: want,
          fromLabel: describeStatus(visit.status),
          toLabel: describeStatus(want),
        },
      };
    });
}

const RUNNERS = {
  visitStatusDerived: checkVisitStatusDerived,
  equipmentCourse: checkEquipmentCourse,
  roomList: checkRoomList,
  slotBeds: checkSlotBeds,
  equipmentNames: checkEquipmentNames,
  courseAssigns: checkCourseAssigns,
  counts: checkCounts,
  followups: checkFollowups,
  orphans: checkOrphans,
  visitStatus: checkVisitStatus,
  overused: checkOverused,
  conflicts: checkConflicts,
  overdueTasks: checkOverdueTasks,
  staleAvailability: checkStaleAvailability,
  duplicateAvailability: checkDuplicateAvailability,
  ivMismatch: checkIvMismatch,
  chartNo: checkChartNo,
  poolLabel: checkPoolLabels,
  alertTerm: checkAlertTerms,
  seedEquipment: checkSeedEquipment,
  seedDuration: checkSeedDurations,
};
