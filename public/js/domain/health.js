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

import { counts, reconcile, isOverused, schedulable } from './entitlements.js';
import { missingPairs, countMismatches } from './followups.js';
import { urgency } from './taskRules.js';
import { monthLabel } from './dates.js';
import { currentCollection, collectionsByMonth, summarizeCollection } from './availability.js';
import { overlaps, isValidTime } from './visitTime.js';
import { VISIT_STATUSES, isActive } from './visits.js';
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

const RUNNERS = {
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
};
