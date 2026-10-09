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
  counts, reconcile, isOverused, schedulable, poolName, timedLabel, legacyPoolNames, autoLabel,
} from './entitlements.js';
import { contraindicationTerms } from './contraindications.js';
import { SEED, seedData } from './seed.js';
import {
  clinicalTerms, durationChoicesOf, bookingMinutesOf, hasAlias, ASSIGN_LABELS, normalizeAlias, DOCTOR_ROLE, THERAPIST_ROLE, bedRoomOf,
} from './masterData.js';
import { fullNameOf } from './naming.js';
import {
  missingPairs, countMismatches, strandedFollowups, doneAheadOfExam, doubleClaimedExams,
} from './followups.js';
import { urgency } from './taskRules.js';
import { monthLabel } from './dates.js';
import { currentCollection, collectionsByMonth, summarizeCollection } from './availability.js';
import { overlaps, isValidTime, toMinutes } from './visitTime.js';
import {
  VISIT_STATUSES, isActive, isOpenStatus, visitStatusFrom, describeStatus, roomCapacityOf, slotStatus, slotMinutes, shortStatus,
} from './visits.js';
import { readMarks, toCustomerFields } from './customerMarks.js';
import { CHART_NO_PREFIX, OLD_CHART_NO_PREFIX } from './legacyImport.js';

/**
 * ## 「去看看」只剩指向主檔設定的那幾顆（2026-09-16）
 *
 * 2026-09-16 先拿掉的是指 `#/visits/:id` 的那幾顆：那條路由是
 * `visitEditor.renderEdit()` —— **整天全部的段、日期欄、每一段的 ×**。
 * ADR-0056 說一筆來訪改得動的地方只有日曆，ADR-0085 說只改她點的那一段，
 * ADR-0089 說改整天的日期一條路都沒有；那幾個決定在那一頁上全部不成立。
 *
 * 同一天稍晚她看到剩下的那幾顆，說：
 *
 * > 資料健檢中同一天有兩筆來訪以及逾期任務 資料過期都還有去看看的按鈕？
 * > 可以不用有 應該說去看看這個按鈕都不要了
 *
 * 她點名的三列剛好各佔一種（`#/calendar`、`#/`、`#/customers/:id`），
 * 所以那三類 13 顆全部拿掉。**留下來的只有 `#/settings/*`**，因為那幾列的
 * 出口就是那一頁：「器材主檔少了一台」把她帶去建那一台，拿掉之後那一列
 * 就是「講了問題卻沒有任何出口」。
 *
 * 拿掉出口的那幾列，**`detail` 要自己把話講完整**（沒有一鍵修正的更要）——
 * 那一列從此是她唯一的資訊來源。`tests/health.test.js` 盯著：
 * 每一個 finding 的 `link` 要嘛是 `null`，要嘛以 `#/settings/` 開頭。
 *
 * **`who`／`whoId`（選填）是那一筆講的是哪一位客戶**（名字與 id，2026-10-07，issue 18）：畫面照 `whoId`
 * 把同一位的好幾筆收成一列、抬頭印 `who`。只有講得出是哪一位的那幾種才帶；沒有它的照舊一筆一列。
 *
 * 檢查的順序就是畫面上的順序：先資料對不起來的，再輪到要她處理的事（畫面上照嚴重度再分兩組）。
 * id 會出現在網址與稽核訊息裡，不要改。
 *
 * **每一個 id 在 `RUNNERS` 都要有一支，`ui/views/health.js` 的 `FIX_COPY`
 * 也要有一列**（那一項給不給修正都要，不給的話文案裡不放按鈕就好）。
 */
export const CHECKS = [
  {
    id: 'counts',
    label: '次數對帳',
    hint: '額度上記著的次數，是不是等於從來訪重算出來的次數',
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
    id: 'sameDayVisits',
    label: '同一天有兩筆來訪',
    hint: '同一位客戶同一天記了兩筆 —— 現在只會有一筆，這是舊資料',
  },
  {
    id: 'overused',
    label: '額度超用',
    hint: '已排 + 已完成超過總次數',
  },
  {
    id: 'conflicts',
    label: '衝突殘留',
    hint: '你自己排的來訪之間，同診間或同治療師撞在一起',
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
    id: 'entitlementMinutes',
    label: '額度上記著的時長跟課程不一樣',
    hint: '排這一筆的時候照額度上那個數字排，不是課程的 —— 健檢記著 60 分的話，那一段就排成一小時',
  },
  {
    id: 'slotMinutes',
    label: '照錯的時長排出去的那幾段',
    hint: '上一項那幾筆額度排出去、還沒做的那幾段 —— 結束時間已經存下去了，不會自己變長',
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
    id: 'importedLabel',
    label: '匯進來的額度還叫舊表的名字',
    hint: '匯入時算不出 app 的寫法（健檢的金額與部位、營養針、EECP體驗），'
      + '所以原字留著等你自己改 —— 改一筆少一列',
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
    hint: '建議的診間清單改過幾次（多了 VIP 室、治6、治7、VIP1，點滴8 與 VIP7 拆成 A／B 各自一間）。原本的點滴8、VIP7 停用不刪 —— 沒選床位的舊來訪照樣印得出來',
  },
  {
    id: 'slotBeds',
    label: '來訪上還記著床位',
    hint: '床位那一層取消了（一間就是一個資源）。點滴8、VIP7 的床 A／B 現在是各自的診間（8A、8B、7A、7B），'
      + '所以那幾筆是搬到那一間（要先在「診間清單」那一項把那幾間建起來）；別間的床位照舊清掉',
  },
  {
    id: 'equipmentNames',
    label: '器材的名字跟建議的不一樣',
    hint: '額度的名字讀器材的全名（復能-SIS(60)）、月曆讀別稱（IN(60)）——'
      + ' 那兩格還停在舊的，這兩個地方就都印不出你要的字',
  },
  {
    id: 'courseAssigns',
    label: '課程的指派跟建議的不一樣',
    hint: '健檢、體適能、身體組成、營養諮詢、門診與二返都不需要治療室 ——'
      + ' 還指派著治療室的話，壓表時會多問一個不該問的問題，而你只能隨便挑一間',
  },
  {
    id: 'visitStatusDerived',
    label: '來訪的狀態跟它的時段對不起來',
    hint: '整筆寫著「已確認」，底下卻有一段還是待確認 ——'
      + ' 日曆上的顏色與待辦中心那一列會各講各的',
  },
  {
    id: 'courseNames',
    label: '課程的名字跟建議的不一樣',
    hint: 'ILIB 那個課程 2026-09-06 正名過。還停在「靜脈」的話，'
      + '額度、月曆、LINE 草稿三個地方寫的都是舊字',
  },
  {
    id: 'courseRecord',
    label: '課程的「做完要不要寫紀錄」跟建議的不一樣',
    hint: '復健科醫師門診做完要去曜聖補一份紀錄 —— 沒勾的話那一場結案時'
      + '不會長出「寫紀錄」，而畫面上看不出少了什麼',
  },
  {
    id: 'seedCourse',
    label: '課程主檔少了一門',
    hint: '種子資料裡有、你的主檔沒有。「載入種子資料」那顆只在整份主檔是空的時候'
      + '才畫得出來，所以既有資料庫上新加的課程一條路都沒有',
  },
  {
    id: 'courseDuration',
    label: '課程的時長跟建議的不一樣',
    hint: '主檔上的時長還是舊的（EECP 60 分、營養點滴 120 分、EECP體驗 20 分）—— 排出去的那一段會照舊的長度算',
  },
  {
    id: 'seedIvProduct',
    label: '營養點滴品項少了幾款',
    hint: '少了的那幾款拍 Abovee 認不出來，加購與排班也選不到',
  },
  {
    id: 'seedStaff',
    label: '治療師與醫師少了幾位',
    hint: '少了的那幾位拍 Abovee 認不出來，排班也選不到。建起來的醫師帶著科別',
  },
  {
    id: 'ivProductDuration',
    label: '點滴品項沒填時長',
    hint: '護心抗老要打 180 分。那一格空著的話它跟著課程走（120 分），'
      + '而排出去的那一段會短一個小時',
  },
  {
    id: 'seedDuration',
    label: '課程沒填可選時長',
    hint: '復能與 ILIB 有 30 與 60 兩種規格。沒填的話加購時「幾分鐘」那一排不出現，'
      + '名字也少了後面那個數字，月檢視更分不出那天排的是 30 還是 60',
  },
  {
    id: 'seedBlanks',
    label: '主檔有幾格還沒跟上',
    hint: '後來多的那幾格（課程的分類、要哪一科的醫師、Abovee 上的寫法、醫師的科別）還空著 —— 空著的話拍 Abovee 認不得幾種寫法、醫師那一排也分不出科別。你自己填過的不會被動到',
  },
  // 2026-10-09（ADR-0145）：接在最後，前面那幾項的編號（註解裡的「第 32 項」）不動
  {
    id: 'followupLinks',
    label: '二返接的健檢對不上',
    hint: '二返接在取消或沒來的那一次健檢上，或二返先做了、接的那一次健檢還沒做完 —— 只列出來，不自動改',
  },
  {
    id: 'followupDouble',
    label: '同一次健檢接了兩場二返',
    hint: '一次健檢配一場二返，要多約一場用「＋ n返」—— 只列出來，不自動改',
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
    // 還開著的診間（陣列）：「她是不是已經有一間同名的」要掃一遍
    rooms: alive(master.rooms),
    // 還開著的治療師與醫師：「她是不是已經自己建了那一位」（`checkSeedStaff()`）
    staff: alive(master.staff),
    // 這兩份是給「復能額度還叫舊名字」與「提醒詞不在警示名單裡」用的，
    // 而它們要的是**陣列**（算名字與比名單都要順序）。
    equipment: alive(master.equipment),
    courses: alive(master.courses),
    clinicalFlags: alive(master.clinicalFlags),
    // `autoLabel()` 要的是**陣列**（它自己 `find()`），而上面那幾個 `*ById`
    // 是給「指到的東西還在不在」用的 —— 兩種形狀，不要互相將就。
    ivProducts: alive(master.ivProducts),
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
        who: customer.name,
        whoId: customer.id,
        title: `${customer.name}・${e.label}`,
        detail:
          `計數欄位是 已完成 ${rec.stored.done}、已排未上 ${rec.stored.booked}，`
          + `從來訪重算是 已完成 ${rec.actual.done}、已排未上 ${rec.actual.booked}`,
        link: null,
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
        who: customer.name,
        whoId: customer.id,
        title: `${customer.name}・${miss.source.label}`,
        detail: `健檢有 ${miss.source.totalQty ?? 0} 次，但身上沒有對應的二返額度 ——`
          + '二返記不進來，「約二返」的待辦也不會長出來',
        link: null,
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
        who: customer.name,
        whoId: customer.id,
        title: `${customer.name}・${bad.followup.label}`,
        detail: `健檢是 ${bad.expected} 次，二返卻是 ${bad.actual} 次。`
          + '故意給的就不用管，不是的話到「客戶」那一頁點開這位客戶，改二返那一筆的總次數',
        link: null,
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
    const link = null;
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
    const link = null;

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
        who: who,
        whoId: visit.customerId,
        title: `來訪 ${visit.date}・${who}`,
        detail: `狀態「${visit.status ?? '（空的）'}」不在合法清單內`,
        link: null,
        fix: null,
      });
      continue;
    }

    if (visit.date < ctx.today
        && (visit.status === 'confirmed' || visit.status === 'pending_confirm')) {
      out.push({
        severity: 'attention',
        who: who,
        whoId: visit.customerId,
        title: `來訪 ${visit.date}・${who}`,
        detail: visit.status === 'confirmed'
          ? '日期已過但還是「客戶已確認」，該標已完成或未到了'
          : '日期已過但還在等客戶回覆，該結案了',
        link: null,
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
        who: who,
        whoId: visit.customerId,
        title: `來訪 ${visit.date}・${who}`,
        detail: '標成「已完成」但每一段都記成沒做，次數一次都沒扣。該標成未到嗎？',
        link: null,
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
        who: customer.name,
        whoId: customer.id,
        title: `${customer.name}・${e.label}`,
        detail: `共 ${c.total} 次，已完成 ${c.done}、已排未上 ${c.booked}，超出 ${
          c.done + c.booked - c.total
        } 次。故意的就不用管，不是的話到「客戶」那一頁點開這位客戶，加購或改那一筆的總次數`,
        link: null,
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

/** 那一間、跟 `a` 這一格時間重疊的**總人數**（含 `a` 自己）。 */
function countInRoom(slots, a, roomId) {
  return slots.filter(
    (x) => x.slot.roomId === roomId
      && (x === a || (x.visit.id !== a.visit.id && overlaps(a.slot, x.slot))),
  ).length;
}

function checkConflicts(ctx) {
  const out = [];
  const byDate = {};
  for (const v of ctx.visits) {
    if (!isActive(v)) continue;
    (byDate[v.date] ??= []).push(v);
  }

  for (const [date, visits] of Object.entries(byDate)) {
    // 攤平成時段清單再兩兩比，避免四層迴圈讀不懂
    // **取消掉的那一段不算**（ADR-0081）：那一格已經還回去了。整筆取消的
    // 那幾筆上面已經濾掉（`isActive()`），這裡濾的是「整筆還活著、其中一段
    // 取消了」的那一種 —— 排班時的提醒（`conflictWarnings()`）也是這樣問的，
    // 兩邊不一樣的話她會看到一列「按了修正也不會消失」的假警報。
    const slots = visits.flatMap((visit) =>
      (visit.slots ?? [])
        .filter((s) => isValidTime(s.startsAt) && isValidTime(s.endsAt))
        .filter((s) => slotStatus(visit, s) !== 'cancelled')
        .map((slot) => ({ visit, slot })),
    );

    for (let i = 0; i < slots.length; i += 1) {
      for (let j = i + 1; j < slots.length; j += 1) {
        const a = slots[i];
        const b = slots[j];
        if (a.visit.id === b.visit.id) continue;
        if (!overlaps(a.slot, b.slot)) continue;

        // **診間算人頭**（ADR-0094）：一間裝得下幾個人寫在主檔上（預設 1）。
        // 兩兩比的前提是「一間就是一個資源」，而點滴8 不是 —— 她的 9 月壓表
        // 白紙上有一對夫妻同時排在那一間。**容量是幾就准幾個人同時在**，
        // 所以這裡問的是「加上這一格之後超過了嗎」。
        //
        // `bed` 不比了（床位那一層 2026-09-08 拿掉，ADR-0079 第六條）：
        // 照舊比的話，舊資料上帶著 A／B 的那幾筆永遠不算撞。
        const room = a.slot.roomId ? (ctx.roomsById[a.slot.roomId] ?? null) : null;
        const sameRoom = a.slot.roomId && a.slot.roomId === b.slot.roomId
          && countInRoom(slots, a, a.slot.roomId) > roomCapacityOf(room);
        const sameTherapist = a.slot.therapistId && a.slot.therapistId === b.slot.therapistId;
        if (!sameRoom && !sameTherapist) continue;

        const what = sameRoom
          ? `${ctx.roomsById[a.slot.roomId]?.name ?? '某診間'}`
          : `${fullNameOf(ctx.staffById[a.slot.therapistId]) || '某治療師'}`;

        out.push({
          severity: 'attention',
          title: `${date} ${what}`,
          detail:
            `${a.slot.startsAt}–${a.slot.endsAt} ${a.visit.customerName ?? nameOf(ctx, a.visit.customerId)}`
            + ` 與 ${b.slot.startsAt}–${b.slot.endsAt} ${b.visit.customerName ?? nameOf(ctx, b.visit.customerId)}`
            + ' 撞在一起',
          link: null,
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
      who: t.customerName ?? nameOf(ctx, t.customerId),
      whoId: t.customerId,
      title: `${t.kind}・${t.customerName ?? nameOf(ctx, t.customerId)}`,
      detail: `死線 ${t.dueDate} 已經過了。做完了就到「待辦」把那一張勾掉`,
      link: null,
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
      who: customer.name,
      whoId: customer.id,
      title: customer.name,
      detail: collections.length
        ? `最近一份可用性收集已過有效期，還有 ${remaining} 次沒排。到「待辦」的「問這輪的時間」問這位客戶一次`
        : `從來沒收集過可用性，還有 ${remaining} 次沒排。到「待辦」的「問這輪的時間」問這位客戶一次`,
      link: null,
      fix: null,
    });
  }

  return out;
}

// ---------- 九、備註寫著舊的說法 ----------
//
// 舊試算表的姓名格是 `王小明 (高能/sis)1234`，匯入時把那串數字寫成備註
// 「姓名欄的編號：1234」—— 當初刻意不認定它是什麼，因為舊表沒有標題。
// 2026-08-24 她說了：**那就是病歷號。**
//
// 匯入端已經改成寫「病歷號 1234」，但既有的二十幾位身上還掛著舊的說法，
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
        who: customer.name,
        whoId: customer.id,
        title: `${customer.name}・${monthLabel(`${group.month}-01`)}`,
        detail: `記了 ${group.records.length} 份：${
          group.records.map((c) => summarizeCollection(c)).join('；')
        }。壓表只會用到其中一份 —— 到「客戶」那一頁點開這位客戶，在「不能的時間」把多的那幾份刪掉。`,
        link: null,
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
      who: customer.name,
      whoId: customer.id,
      title: customer.name,
      detail: `${stale.map((m) => m.text).join('、')} → ${
        next.filter((m) => m.text.startsWith(CHART_NO_PREFIX)).map((m) => m.text).join('、')}`,
      link: null,
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
        who: who,
        whoId: visit.customerId,
        title: `來訪 ${visit.date}・${who}・第 ${i + 1} 個時段`,
        detail: `買的是 ${name(bought)}，排成了 ${name(slot.ivProductId)}`,
        link: null,
        fix: null,
      });
    });
  }

  return out;
}

/** 第 32 項的那一種額度：單一課程、不是營養點滴、記著的時長不是課程的（第 33 項也問它）。 */
function minutesOff(e, course) {
  if (!e || e.deletedAt || e.type !== 'single' || e.durationMin == null) return false;
  if (!course || course.requiresIvProduct) return false;
  const n = Number(e.durationMin);
  const choices = durationChoicesOf(course);
  return !(choices.length ? choices.includes(n) : n === Number(course.durationMin));
}

/**
 * 十一之二、額度上記著的時長跟課程不一樣（2026-10-07，issue 15）。
 *
 * 加購時換一門課，上一門的時長會跟著過來：先點 ILIB（自動帶 60）再點健檢，存下去的健檢額度
 * 是 60 分 —— 而排那一段時先問額度（`slotMinutes()`），健檢就排成 60 分不是 120。那個洞補了
 * （`buy.js` 的 `minutesAfterPick()`），這一列收的是**補之前已經存成這樣的**。
 *
 * **只列不修**（她：「有的話資料健檢只列不修」）：那一格她在客戶詳情「進階設定」自己打得了，
 * 分不出哪幾筆是她設的、哪幾筆是帶過來的 —— 一顆按鈕會把她自己設的一起清掉。
 *
 * 只看單一課程的額度：
 * - 那門課沒有「買的時候可選」：記著的數字跟課程現在的不一樣就列
 * - 有（ILIB）：記著的數字不在名單上才列
 * - **營養點滴不看**（`requiresIvProduct`）：排的時候品項的時長排在額度前面，而既有額度上那一格
 *   是建額度時抄的舊數字（`slotMinutes()` 的註解）—— 列出來整頁都是不用處理的
 * - 擇一池不看：那一格是她按的那一排，名字另有一列在盯（`checkPoolLabels()`）
 */
function checkEntitlementMinutes(ctx) {
  const out = [];

  for (const e of ctx.entitlements) {
    const course = ctx.coursesById[e.courseId];
    if (!minutesOff(e, course)) continue;

    const n = Number(e.durationMin);
    const choices = durationChoicesOf(course);

    out.push({
      severity: 'attention',
      who: nameOf(ctx, e.customerId),
      whoId: e.customerId,
      title: `${nameOf(ctx, e.customerId)}・${e.label}`,
      detail: `這一筆記著 ${n} 分，${course.name}${choices.length
        ? `買的時候只有 ${choices.join('／')} 分`
        : `現在是 ${course.durationMin ?? '（沒填）'} 分`} —— 排這一筆的時候照 ${n} 分排。`
        + '是你自己設的就不用理它；不是的話到「客戶」那一頁點開這位客戶，在那一筆額度按「調整」→「進階設定」把時長清空',
      link: null,
      fix: null,
    });
  }

  return out;
}

/**
 * 十一之三、照錯的時長排出去的那幾段（2026-10-06，issue 20）。她：「排錯長度的舊來訪要不要多一列資料健檢：要」。
 *
 * 上一項（`entitlementMinutes`）列的是額度；照那個數字排出去的**那幾段**結束時間已經存下去了 ——
 * 日曆上那一格短了一截，撞期也照短的那一截算。收的段：
 *
 * - 還活著、**還開著**（待確認／已確認）。已完成鎖著改不了，列出來只是噪音
 * - 扣的那一筆是上一項會列的那一種（`minutesOff()`）、**那一段自己沒選「排多久」**（`slot.minutes` 是她選的）
 * - 長度**剛好等於**額度上那個數字（＝是它排出來的；她在日曆改過的不是）
 *
 * 應該多長：拿掉額度那一層再問 `slotMinutes()`（順序不在這裡重寫）。**只列不修**（ADR-0056：來訪改得動的地方只有日曆）——
 * 那一句講怎麼處理：先照上一項清空那一筆的時長，再在日曆「改這一段」→ 存（`endsAt` 每次存檔都重算）。
 */
function checkSlotMinutes(ctx) {
  const out = [];
  for (const visit of ctx.visits) {
    if (visit.deletedAt || !isActive(visit)) continue;
    (visit.slots ?? []).forEach((slot) => {
      if (!isOpenStatus(slotStatus(visit, slot))) return;
      if (slot.minutes != null || !isValidTime(slot.startsAt) || !isValidTime(slot.endsAt)) return;
      const e = ctx.entitlementsById[slot.entitlementId];
      if (!minutesOff(e, ctx.coursesById[e?.courseId])) return;
      const length = toMinutes(slot.endsAt) - toMinutes(slot.startsAt);
      if (length !== Number(e.durationMin)) return;
      const course = ctx.coursesById[slot.courseId] ?? ctx.coursesById[e.courseId];
      const should = slotMinutes({ entitlement: null, course, ivProduct: null, minutes: null });
      if (should === length) return;

      const who = visit.customerName ?? nameOf(ctx, visit.customerId);
      out.push({
        severity: 'attention',
        who: who,
        whoId: visit.customerId,
        title: `${who}・${visit.date} ${slot.startsAt}–${slot.endsAt} ${course?.name ?? e.label ?? ''}`,
        detail: `排了 ${length} 分，照課程應該是 ${should} 分 —— 是那一筆額度記著 ${e.durationMin} 分（上一項）排出來的。`
          // 分不出是她自己設的還是加購時帶過來的（同第 32 項）—— 那一句一樣要講
          + '是你自己設的就不用理它；不是的話先照上一項把那一筆額度的時長清空，再到日曆那一天點這一段 →「改這一段」→ 存，結束時間會重算',
        link: null,
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
      who: nameOf(ctx, e.customerId),
      whoId: e.customerId,
      title: `${nameOf(ctx, e.customerId)}・${now}`,
      detail: `改成「${want}」`,
      link: null,
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
 * 十二之二、匯進來的額度還叫舊表的名字。
 *
 * 匯入時算得出 app 寫法的已經改掉了（ADR-0095），這一列收的是**算不出來、
 * 所以原字留著**的那幾筆：`12萬健檢`、`5萬健檢(腸道)`、`營養針`、`EECP體驗`。
 * 她 2026-09-16：「讓我之後逐筆改」。
 *
 * **沒有修正鈕。** 保留原字正是因為算出來的會掉字 —— 一鍵改掉等於把匯入時
 * 刻意留下來的東西洗掉（同 `checkPoolLabels()` 那句「她自己打的名字不可以被
 * 一顆按鈕改掉」，只是這一次連按鈕都不該存在）。
 *
 * **只看匯進來的那幾筆**（`importedFrom`）。她自己在 app 裡建的額度本來就
 * 可以取任何名字，列出來只會是一頁她永遠不會處理的雜訊。
 *
 * **配出來的二返也不看**（`followupForEntitlementId`）。它的名字是 app 自己
 * 接的（`followupDraft()` 的 `二返（12萬健檢）`），不是舊表的字 —— 拿
 * `autoLabel()` 去比它一定不一樣（那一支算出來的是「二返」），而那 12 筆
 * 沒有任何東西要她改。
 */
function checkImportedLabels(ctx) {
  const master = { courses: ctx.courses, equipment: ctx.equipment, ivProducts: ctx.ivProducts };

  return ctx.entitlements
    .filter((e) => !e.deletedAt && e.importedFrom && !e.followupForEntitlementId)
    .map((e) => ({ e, want: autoLabel(e, master) }))
    .filter(({ e, want }) => want && want !== String(e.label ?? '').trim())
    .map(({ e, want }) => ({
      severity: 'attention',
      who: nameOf(ctx, e.customerId),
      whoId: e.customerId,
      title: `${nameOf(ctx, e.customerId)}・${e.label}`,
      detail: `匯入時算出來的是「${want}」，但那樣會掉字，所以原字留著 ——`
        + ' 要改的話到「客戶」那一頁點開這位客戶，在那一筆額度上改',
      link: null,
      fix: null,
    }));
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
        data: seedData(row),
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

// 種子的一列 → 要建起來的那一份（去掉 id、啟不啟用照種子寫的）：`seed.js` 的 `seedData()`。
// 這裡以前有一支只去掉 id 的 `withoutId()`，每一個呼叫端再自己補 `active: true` ——
// 種子有了停用的列（點滴8、VIP7，ADR-0127）之後那樣寫會把它們建成啟用的。

/**
 * 她還開著的那幾筆裡，有沒有一筆叫這個名字（**id 不是種子的也算**）。
 *
 * 「種子有、她沒有」那幾列比的是 id。但她可以自己在設定頁先建一筆同名的
 * （功醫門診她 2026-10-05 之前就建得起來）—— 那時候再建一筆種子 id 的，主檔上就是
 * 兩筆同名：設定頁本來擋著的那件事（`validate()` 的同名檢查），被一顆按鈕繞過去。ADR-0125。
 */
const sameNamed = (rows, name) => (rows ?? [])
  .find((r) => String(r.name ?? '').trim() === String(name ?? '').trim());

/**
 * 2026-09-08 之前種子上有、現在沒有的那幾間。
 *
 * 治9／治10 不在她新的治療室清單裡，ILIB4 那一間有個 4 —— 而她說「均無 4 號」。
 * **治7 2026-10-05 從這份名單拿掉了**（ADR-0124）：它回到種子上，見 `RETURNED_ROOMS`。
 *
 * **只認得出種子建過的那幾間**：她自己加的診間一間都不會被列出來。
 */
const LEGACY_ROOMS = [
  { id: 'room-t9', name: '治9' },
  { id: 'room-t10', name: '治10' },
  { id: 'room-ilib4', name: 'ILIB4' },
];

/**
 * 2026-09-08 照這一頁的建議刪掉、2026-10-05 回到清單上的那一間（ADR-0124）。
 *
 * 她：「加回去」—— Abovee 上 EECP60 有 10 筆排在治療室7。這一間在既有資料庫上可能是
 * 三種樣子：沒有（走 `add`）、已刪除（走 `restore`）、還開著（什麼都不報）。
 * **別的她刪掉的種子診間照舊不報**（那是她的決定）；只有這一間是「當初是這一頁叫她刪的」。
 */
const RETURNED_ROOMS = ['room-t7'];

/**
 * 十五、診間清單跟建議的不一樣。
 *
 * 四種形狀，一種一個 `mode`：
 *
 *   add      種子有、她沒有            → 建起來（VIP 那五間、治7）
 *   restore  種子有、她照建議刪掉了     → 還原（只有治7）
 *   drop     種子拿掉了、她還開著       → 刪掉（治9／治10／ILIB4）
 *   short    種子有簡寫、她那一格是空的 → 填上（`.2`、`vip2`）
 *   retire   種子上停用、她還開著       → **停用，不刪**（點滴8、VIP7，ADR-0127）
 *
 * `retire` 那一種：點滴8 拆成 8A／8B、VIP7 拆成 7A／7B 四間各自的診間，原本那兩間是「沒選床位」的那一間。
 * **不可以放進 `LEGACY_ROOMS`**（那一份走的是刪掉）—— 既有來訪還指著它，她要的是照樣印得出 `.8`。
 * 排在「建起來」的後面：一次全按時新的那幾間同一個 commit 建好。種子上停用的那一間她主檔上沒有時不建。
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

  const retire = [];

  for (const row of SEED.rooms ?? []) {
    const mine = byId[row.id];
    // 她自己另外建了一間同名的 → 那一間就是它，不建也不還原第二間
    const twin = sameNamed(ctx.rooms, row.name);
    const retired = row.active === false;
    if (!mine) {
      if (!seeded || twin || retired) continue;
      out.push({
        severity: 'attention',
        title: row.name,
        detail: '建議清單上有這一間，你的診間主檔沒有',
        link: '#/settings/rooms',
        fix: {
          kind: 'applyRoom', mode: 'add', roomId: row.id, label: row.name,
          data: seedData(row),
        },
      });
      continue;
    }
    if (mine.deletedAt) {
      if (RETURNED_ROOMS.includes(row.id) && !twin) {
        out.push({
          severity: 'attention',
          title: row.name,
          detail: '2026-09-08 照這一頁的建議刪掉的那一間。Abovee 上 EECP 還排在治療室7，'
            + '所以它回到清單上了 —— 還原之後排班才選得到',
          link: '#/settings/rooms',
          fix: { kind: 'applyRoom', mode: 'restore', roomId: row.id, label: row.name },
        });
      }
      continue;
    }

    // 種子上停用的那一間（點滴8、VIP7）：她還開著、名字也還是原樣才請她停用。
    // 改過名字就是拿去當別的用了；已經停用的不念
    if (retired && mine.active !== false && fullNameOf(mine) === row.name) {
      retire.push({
        severity: 'attention',
        title: mine.name,
        detail: `新的清單上它拆成 ${row.name}A、${row.name}B 兩間各自的診間。停用之後排班時選不到「${row.name}」，`
          + '已經排在那一間的來訪一個字都不動、照樣印得出來（沒選床位的就是它）',
        link: '#/settings/rooms',
        fix: { kind: 'applyRoom', mode: 'retire', roomId: row.id, label: mine.name },
      });
    }

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

  out.push(...retire);

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
 *
 * ## 2026-10-06：點滴8、VIP7 的床位是**搬到那一間**，不是清掉（ADR-0127）
 *
 * 點滴8A／8B、VIP7A／7B 現在是四間各自的診間。舊來訪 `點滴8＋床 A` 的那個 A 正是「它是 8A」——
 * 清掉就把這件事丟了。所以每一段三條路：
 *
 *   搬   那一間＋床位在主檔上對得到一間（`bedRoomOf()`：名字是「點滴8A」）→ `roomId` 換過去、`bed` 清空
 *   等   建議清單上有那一間、她的主檔還沒有 → **只列不修**，請她先按「診間清單」把它建起來。
 *        不可以落到「清掉」：她一按，A／B 就永遠沒了、之後搬不了家
 *   清   其餘（別間的床位、認不得的字）→ 照舊清掉
 *
 * 一筆裡有任何一段在「等」→ 整筆先不給按（別段也不清）：這一筆之後還要再處理一次，
 * 分兩次寫只是多一筆稽核。有「搬」的那一筆是另一種修正（`moveBedToRoom`）——
 * 借 `clearBeds` 的話稽核上寫的是「清掉來訪上的床位」，講的不是發生的事。
 *
 * **每一段除了 `roomId` 與 `bed` 一個字都不變**（測試釘著）；已完成的那幾筆照樣搬
 * （這是資料修正不是改來訪，舊資料幾乎全是已完成 —— 同 `clearBeds`，直接寫整包 `slots`）。
 * 沒記床位、還排在點滴8 的段不念：沒選床位就是 `.8`（她 2026-10-06）。
 */
function checkSlotBeds(ctx) {
  const upper = (bed) => String(bed ?? '').trim().toUpperCase();
  // 建議清單上叫這個名字的那一間（她的主檔還沒有時用來說「先去建」）
  const suggested = (name) => (SEED.rooms ?? []).find((r) => r.active !== false && fullNameOf(r) === name) ?? null;

  const planFor = (slot) => {
    if (!slot.bed) return { slot };
    const room = ctx.roomsById[slot.roomId];
    const alive = room && !room.deletedAt ? room : null;
    const target = alive ? bedRoomOf(alive, slot.bed, ctx.rooms) : null;
    if (target) {
      return { slot: { ...slot, roomId: target.id, bed: null }, moved: `${fullNameOf(alive)} 床 ${upper(slot.bed)} 搬到 ${fullNameOf(target)}` };
    }
    const waiting = alive ? suggested(`${fullNameOf(alive)}${upper(slot.bed)}`) : null;
    if (waiting) return { slot, waiting: fullNameOf(waiting) };
    return { slot: { ...slot, bed: null }, cleared: slot.bed };
  };

  return (ctx.visits ?? [])
    .filter((v) => !v.deletedAt && (v.slots ?? []).some((s) => s.bed))
    .map((visit) => {
      const plans = (visit.slots ?? []).map(planFor);
      const who = visit.customerName ?? nameOf(ctx, visit.customerId);
      const label = `${who}・${visit.date}`;
      const uniq = (list) => [...new Set(list.filter(Boolean))];
      const waiting = uniq(plans.map((x) => x.waiting));
      const moved = uniq(plans.map((x) => x.moved));
      const cleared = uniq(plans.map((x) => x.cleared));

      if (waiting.length) {
        return {
          severity: 'attention',
          title: label,
          detail: `床位要搬到「${waiting.join('」「')}」，但你的診間主檔上還沒有那一間 —— `
            + '先按上面「診間清單跟建議的不一樣」把它建起來，這一列就會變成可以搬的',
          link: null,
          fix: null,
        };
      }
      const slots = plans.map((x) => x.slot);
      if (moved.length) {
        return {
          severity: 'attention',
          title: label,
          detail: `${moved.join('、')}${cleared.length ? `；清掉床位 ${cleared.join('、')}` : ''}`,
          link: null,
          fix: { kind: 'moveBedToRoom', visitId: visit.id, label, slots, moves: moved, cleared },
        };
      }
      return {
        severity: 'attention',
        title: label,
        detail: `清掉床位 ${cleared.join('、')}`,
        link: null,
        fix: { kind: 'clearBeds', visitId: visit.id, label, slots },
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
        who: who,
        whoId: visit.customerId,
        title: `來訪 ${visit.date}・${who}`,
        detail: `整筆寫著「${describeStatus(visit.status)}」，`
          + `底下那幾段加起來是「${describeStatus(want)}」`,
        link: null,
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

/**
 * 二十一、課程的「做完要不要寫紀錄」跟建議的不一樣。
 *
 * 她 2026-09-08：「除了二返、營養諮詢之外，復健科門診也要事後寫記錄，
 * 幫我預設這三個都要寫紀錄」。種子改好了，但 `loadSeed()` 只建不覆蓋。
 *
 * **只認「從來沒設過」（`undefined`），不認 `false`。** 那兩種在資料上分得
 * 出來，而 `false` 是她自己關掉的 —— 不可以被一顆按鈕改回去（同
 * `checkSeedDurations()` 那條）。這一條是這一列唯一需要小心的地方。
 */
function checkCourseRecord(ctx) {
  return (SEED.courses ?? [])
    .filter((row) => row.needsRecord === true)
    .map((row) => ({ row, mine: ctx.coursesById[row.id] }))
    .filter(({ mine }) => mine && !mine.deletedAt && mine.needsRecord === undefined)
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: '做完那一場之後要去曜聖補一份紀錄 —— 勾起來才會長出「寫紀錄」',
      link: '#/settings/courses',
      fix: {
        kind: 'setNeedsRecord',
        courseId: row.id,
        label: mine.name ?? row.name,
        needsRecord: true,
      },
    }));
}

/**
 * 二十三之二、課程主檔少了一門（issue 12）。
 *
 * **`ui/views/settings.js` 的「載入種子資料」只在整份主檔是空的時候才畫**
 * （`${empty ? seedCard() : ''}`）。所以種子新加一門課之後，既有資料庫上
 * 那一門**一條路都沒有** —— 而症狀跟「本來就沒有那一種」長得一模一樣
 * （同 `checkSeedEquipment()` 檔頭講的 ILIB 那一台）。
 *
 * 2026-09-16 那一門 `EECP體驗` 就是第一個踩到的（ADR-0098 那一輪的 issue 06）。
 *
 * **護欄跟器材那一列同一個理由**：自己從零建主檔、一個種子 id 都沒有的資料庫
 * （測試夾具就是）不可以被念 —— 那時候缺的不是一門課，是整份主檔。
 * 她自己刪掉的也不算（比的是含已刪除的那一份 `coursesById`）。
 *
 * **她自己已經建了一門同名的也不算**（`sameNamed()`，2026-10-05）：功醫門診她在這一列
 * 出現之前就建得起來，再建一門種子 id 的就是兩門同名。
 */
function checkSeedCourse(ctx) {
  const seeded = (SEED.courses ?? []).some((row) => ctx.coursesById[row.id]);
  if (!seeded) return [];

  return (SEED.courses ?? [])
    .filter((row) => !ctx.coursesById[row.id] && !sameNamed(ctx.courses, row.name))
    .map((row) => ({
      severity: 'attention',
      title: row.name,
      detail: `${row.durationMin} 分。種子資料裡有這一門，你的課程主檔沒有 ——`
        + '「載入種子資料」那顆只在主檔是空的時候才出得來',
      link: '#/settings/courses',
      fix: {
        kind: 'addCourse',
        label: row.name,
        courseId: row.id,
        data: seedData(row),
      },
    }));
}

/**
 * 二十三之三、營養點滴品項少了幾款（2026-10-05，abovee-and-master/12）。
 *
 * Abovee 的營養點滴那一類有 13 款，種子原本只有其中 6 款。形狀照抄 `checkSeedCourse()`，
 * 三道護欄一樣：一個種子 id 都沒有的主檔不念、她刪掉的不算、她自己建了同名的不算。
 * 她改過名字的那一款 id 還在，所以不會被當成少了。
 *
 * 皮蛇疫苗帶著 30 分一起建（她說先給 30 分、要改得動）。
 */
function checkSeedIvProduct(ctx) {
  const seeded = (SEED.ivProducts ?? []).some((row) => ctx.ivProductsById[row.id]);
  if (!seeded) return [];

  return (SEED.ivProducts ?? [])
    .filter((row) => !ctx.ivProductsById[row.id] && !sameNamed(ctx.ivProducts, row.name))
    .map((row) => ({
      severity: 'attention',
      title: row.name,
      detail: `建議清單上有這一款${row.durationMin ? `（${row.durationMin} 分）` : ''}，你的品項主檔沒有 ——`
        + ' 拍 Abovee 碰到它認不出來，加購與排班也選不到',
      link: '#/settings/ivProducts',
      fix: {
        kind: 'addIvProduct',
        label: row.name,
        ivProductId: row.id,
        data: seedData(row),
      },
    }));
}

/**
 * 二十三之四、治療師與醫師少了幾位（2026-10-06，course-form-and-sheet/04）。
 *
 * Abovee 的服務資源清單有 13 位治療師、8 位醫師，種子原本 9＋3。形狀照抄 `checkSeedCourse()`，
 * 護欄多兩條 —— 因為拍 Abovee 認人靠的是名字的**一部分**（`abovee.js` 的 `staffFrom()`：
 * 治療師的名字是全名的結尾、醫師的姓是全名的開頭），「同名」要比 `sameNamed()` 寬：
 *
 * - **她已經用全名自己建了那一位**（同一種角色裡有一位的名字以種子那個姓開頭／以種子那個名字結尾）
 *   → 當成同一位，不建
 * - **反方向**：種子要建的名字以她既有某一位的名字開頭／結尾（她有一位只寫「張」的醫師，種子要建
 *   「張雅」「張正」）→ **不建，只列出來**。建了的話 `staffFrom()` 對兩位張的全名都會同時符合
 *   「張」與那一位 → 誰都不是，本來認得的變成認不得
 *
 * 其餘照舊：一個種子 id 都沒有的主檔不念、她刪掉的不算、補上去的值要存得下去。
 *
 * ## 建新醫師的那一顆同時補既有醫師空著的科別（`fix.also`）
 *
 * 「建新醫師」與「補科別」本來是兩列。她只按前一列的話，功能／二返那一科只有新的兩位張，
 * `doctorChoicesFor()` 會把原本那三位收進「其他醫師」—— 二返那一排最前面變成兩位從來不看二返的人。
 * 所以：要建的那一位帶著某一科、而**種子上同一科的既有醫師那一格還是空的**時，這一顆一起補
 * （同一個 commit，`data/health.js` 的 `addStaff`），而且那一列講得出來（ADR-0070）。
 * 她填過別的科別的那一位不動；只補科別的那一列在 `checkSeedBlanks()`。
 */
function checkSeedStaff(ctx) {
  const seeded = (SEED.staff ?? []).some((row) => ctx.staffById[row.id]);
  if (!seeded) return [];

  const norm = (s) => normalizeAlias(s?.name ?? s);
  // 名字的「一部分」對得上：醫師比開頭、治療師比結尾（跟 `staffFrom()` 同一條）
  const partOf = (role, whole, part) => Boolean(whole && part)
    && (role === DOCTOR_ROLE ? whole.startsWith(part) : role === THERAPIST_ROLE && whole.endsWith(part));
  const out = [];

  for (const row of SEED.staff ?? []) {
    if (ctx.staffById[row.id]) continue;
    const peers = ctx.staff.filter((s) => s.role === row.role);
    const mine = norm(row);
    // 她把那一位改成全名之後，種子的名字就是那一位的簡寫（ADR-0141）
    if (peers.some((s) => norm(s) === mine || normalizeAlias(s.shortName) === mine || hasAlias(s, mine)
      || partOf(row.role, norm(s), mine))) continue;

    const shadow = peers.find((s) => partOf(row.role, mine, norm(s)));
    if (shadow) {
      out.push({
        severity: 'attention',
        title: row.name,
        detail: `建議清單上有「${row.name}」，但你的主檔上已經有一位「${shadow.name}」——`
          + ` 再建這一位的話，拍 Abovee 會分不出兩位。先到 設定 → 治療師與醫師 把「${shadow.name}」改成他完整的顯示名，這一列就會換成可以建的`,
        link: '#/settings/staff',
        fix: null,
      });
      continue;
    }

    // 這一位帶著的科別裡，種子上同一科的既有醫師還空著那一格的 → 一起補
    const also = (row.specialties ?? []).length
      ? (SEED.staff ?? [])
        .filter((old) => old.id !== row.id && (old.specialties ?? []).some((sp) => row.specialties.includes(sp)))
        .map((old) => ({ old, has: ctx.staffById[old.id] }))
        .filter(({ has }) => has && !has.deletedAt && has.role === DOCTOR_ROLE && !(has.specialties ?? []).length)
        .map(({ old, has }) => ({ id: old.id, label: has.name ?? old.name, changes: { specialties: [...old.specialties] } }))
      : [];
    const what = row.role === DOCTOR_ROLE
      ? `醫師${(row.specialties ?? []).length ? `（${row.specialties.join('、')}）` : '（科別先不填 —— 每一門要醫師的課都選得到他）'}`
      : '物理治療師';
    out.push({
      severity: 'attention',
      title: row.name,
      detail: `${what}。建議清單上有這一位，你的主檔沒有 —— 拍 Abovee 碰到他認不出來，排班也選不到`
        + (also.length
          ? `。同時把 ${also.map((a) => a.label).join('、')} 空著的科別補上「${row.specialties.join('、')}」`
            + '（不補的話那一科只剩新的這幾位，原本的醫師會被收進「其他醫師」）'
          : ''),
      link: '#/settings/staff',
      fix: {
        kind: 'addStaff',
        label: row.name,
        staffId: row.id,
        data: seedData(row),
        also,
      },
    });
  }
  return out;
}

/**
 * 2026-10-05 之前種子上 EECP 那兩門課只准排的那兩間。治7 回來之後多一間（ADR-0124）。
 * **她那一份還跟這個一模一樣才建議改** —— 她自己收窄或放寬過就是一個決定。
 */
const LEGACY_ROOM_LIMITS = {
  'course-eecp': ['room-t5', 'room-t8'],
  'course-eecp-trial': ['room-t5', 'room-t8'],
};

/**
 * 二十六、主檔有幾格還沒跟上（2026-10-05，abovee-and-master/12）。
 *
 * 這一輪主檔多了好幾格（分類 02、要哪一科的醫師 04、約的時候選時長 06、Abovee 上的寫法 07），
 * 種子都填好了，而 `loadSeed()` 只建不覆蓋。每一格**讀的那一側都有退路**（沒填就照舊的算），
 * 所以既有資料庫不會壞 —— 但拍 Abovee 靠 `aboveeNames` 認字，空著就是認不得：
 * `高能量60`、`雪顏亮采` 認不出來，`EECP20` 拆成「EECP＋20 分」認成正式課。
 *
 * **一格一列**（她看得到補的是哪一格、補成什麼），修正一律只寫那一格。護欄：
 *
 * - **空的才補**。分類只認「從來沒有那一格」（`undefined`）—— 她放到「其他」存的是 `null`，
 *   那是一個決定（同 `checkCourseRecord()` 只認 `undefined` 不認 `false`）。清單那幾格
 *   空陣列也算空的（同 `checkSeedDurations()`）
 * - **補了要存得下去**：約的時候選時長跟「可選時長」只能填一格、而且要包含預設時長
 *   （`validate('courses')`）；Abovee 上的寫法已經是她另一筆的就不補（同一種主檔裡不准重複）。
 *   不守這兩條的話，按了這顆之後她一進設定頁那一筆就存不回去
 * - 刪掉的不念；她的主檔沒有那一筆也不念（那是「少了一門」那幾列的事）
 *
 * EECP 的「只能排在這幾間」不是空格，是**還停在舊種子值**才改（同 `checkCourseAssigns()`）。
 * 治7 的 id 照她主檔上那一間的（她自己另外建的也算）。
 */
function checkSeedBlanks(ctx) {
  const out = [];
  const empty = (list) => !(list ?? []).length;
  const sorted = (list) => JSON.stringify([...(list ?? [])].sort());

  const push = (type, mine, { what, to, why, changes, detail }) => out.push({
    severity: 'attention',
    title: mine.name,
    detail: detail ?? `${what}補上「${to}」`,
    link: `#/settings/${type}`,
    fix: { kind: 'setMasterFields', type, id: mine.id, label: mine.name, what, to, why, changes },
  });

  // 種子上的診間 id → 她主檔上那一間（還開著、同 id；不然找同名的；都沒有就照種子的 id，
  // 等她把那一間建起來／還原之後就接得上）
  const roomIdOf = (seedId) => {
    if (ctx.roomsById[seedId] && !ctx.roomsById[seedId].deletedAt) return seedId;
    const seedRoom = (SEED.rooms ?? []).find((r) => r.id === seedId);
    return sameNamed(ctx.rooms, seedRoom?.name)?.id ?? seedId;
  };
  const roomNames = (seedIds) => seedIds
    .map((id) => (SEED.rooms ?? []).find((r) => r.id === id)?.name ?? id).join('、');

  const sources = {
    courses: [ctx.coursesById, ctx.courses],
    equipment: [ctx.equipmentById, ctx.equipment],
    ivProducts: [ctx.ivProductsById, ctx.ivProducts],
    // 2026-10-06：醫師的科別（ADR-0120 那一格，種子現在填了）
    staff: [ctx.staffById, ctx.staff],
  };

  for (const [type, [byIdOf, mineAlive]] of Object.entries(sources)) {
    for (const row of SEED[type] ?? []) {
      const mine = byIdOf[row.id];
      if (!mine || mine.deletedAt) continue;

      if (type === 'courses') {
        if (row.group && mine.group === undefined) {
          push(type, mine, {
            what: '分類', to: row.group, changes: { group: row.group },
            why: '設定 → 課程 那一頁照它分組。它不改任何規則',
          });
        }
        if (row.doctorPick && mine.doctorPick == null) {
          push(type, mine, {
            what: '要哪一科的醫師', to: row.doctorPick, changes: { doctorPick: row.doctorPick },
            why: '排這門課時那一科的醫師排前面，其餘收在「其他醫師」後面 —— 是順序不是限制',
          });
        }
        const booking = bookingMinutesOf(row);
        if (booking.length && empty(mine.bookingMinutes) && empty(mine.durationChoices)
            && booking.includes(Number(mine.durationMin))) {
          push(type, mine, {
            what: '約的時候選時長', to: `${booking.join('、')} 分`, changes: { bookingMinutes: booking },
            why: `約的時候多一排「排多久」，預設 ${mine.durationMin} 分；已經排出去的不動`,
          });
        }

        const old = LEGACY_ROOM_LIMITS[row.id];
        if (old && sorted(mine.allowedRoomIds) === sorted(old)
            && sorted(row.allowedRoomIds) !== sorted(old)) {
          const changes = { allowedRoomIds: row.allowedRoomIds.map(roomIdOf) };
          // 順序那一格也還是舊的才一起改；她自己排過的不動
          const alsoOrder = JSON.stringify(mine.preferredRoomIds ?? []) === JSON.stringify(old);
          if (alsoOrder) changes.preferredRoomIds = (row.preferredRoomIds ?? []).map(roomIdOf);
          const to = roomNames(row.allowedRoomIds);
          push(type, mine, {
            what: '只能排在這幾間', to, changes,
            detail: `只能排在這幾間：${roomNames(old)} → ${to}（治7 回來了，Abovee 上 EECP 還排在那一間）`,
            why: '之後排這門課選得到治7（治7 要先在「診間清單」那一列建起來或還原）；已經排出去的來訪不動'
              // 這一列可能寫兩格 —— 確認框要講出來（ADR-0070：只講真的會發生的事）
              + (alsoOrder ? '。「常用診間」那一排還是舊的那兩間，一起加上治7' : '。「常用診間」你自己排過，不動'),
          });
        }
      }

      // 醫師的科別：**那一格是空的才補**，她填過別的就是一個決定。只補還是醫師的那幾位 ——
      // 她改成治療師的補了存不下去（`validate('staff')`：只有醫師有科別）
      if (type === 'staff' && (row.specialties ?? []).length
          && mine.role === DOCTOR_ROLE && empty(mine.specialties)) {
        push(type, mine, {
          what: '科別', to: row.specialties.join('、'), changes: { specialties: [...row.specialties] },
          why: '排指定這一科的課時他排在前面，其餘醫師收在「其他醫師」後面 —— 是順序不是限制；那一科剛好一位時會先選好',
        });
      }

      const free = (row.aboveeNames ?? [])
        .filter((a) => !mineAlive.some((r) => r.id !== mine.id && hasAlias(r, a)));
      if (free.length && empty(mine.aboveeNames)) {
        push(type, mine, {
          what: 'Abovee 上的寫法', to: free.join('、'), changes: { aboveeNames: free },
          why: '拍 Abovee 時課程那一格寫這幾個字就認得它；改了名字照樣認得',
        });
      }
    }
  }
  return out;
}

/**
 * 二十四、課程的時長跟建議的不一樣（ADR-0098、issue 06）。
 *
 * `loadSeed()` **只建不覆蓋**，所以 2026-09-16 那兩個改動（EECP 30→60、
 * 營養點滴 60→120）在既有資料庫上一格都不會變。症狀最壞的地方是
 * **改好了、上線了、畫面上看起來什麼都沒發生** —— 要到某天排了一段點滴、
 * 發現只佔一小時才知道。
 *
 * **這一列比的是值，不是「有沒有填過」**（`durationMin` 是必填的，沒有空的
 * 狀態）。所以她真的可能自己改過 —— `detail` 把兩個數字都印出來，讓她自己
 * 決定按不按（同 `checkPoolLabels()` 那條「她自己打的名字不動」的精神）。
 */
function checkCourseDuration(ctx) {
  return (SEED.courses ?? [])
    .map((row) => ({ row, mine: ctx.coursesById[row.id] }))
    .filter(({ row, mine }) => mine && !mine.deletedAt
      && Number.isInteger(row.durationMin)
      && Number(mine.durationMin) !== row.durationMin)
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: `現在是 ${mine.durationMin ?? '（空的）'} 分，建議 ${row.durationMin} 分`
        + '。自己改過的就不用管',
      link: '#/settings/courses',
      fix: {
        kind: 'setCourseDuration',
        courseId: row.id,
        label: mine.name ?? row.name,
        from: mine.durationMin ?? null,
        durationMin: row.durationMin,
      },
    }));
}

/**
 * 二十五、點滴品項沒填時長（ADR-0098）。
 *
 * 她 2026-09-16：「一般120分，護心抗老180分」。品項身上那一格是 2026-09-16
 * 才加的，而 `loadSeed()` 只建不覆蓋。
 *
 * **只在她那一格是空的時候報**（同 `checkSeedDurations()`）：她自己填了
 * 別的數字是一個決定，不可以被一顆按鈕改回去。
 */
function checkIvProductDuration(ctx) {
  const mineById = byId(ctx.ivProducts ?? []);
  return (SEED.ivProducts ?? [])
    .filter((row) => Number.isInteger(row.durationMin))
    .map((row) => ({ row, mine: mineById[row.id] }))
    .filter(({ mine }) => mine && !mine.deletedAt && mine.durationMin == null)
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: `這一款要打 ${row.durationMin} 分。空著的話它跟著「營養點滴」走`,
      link: '#/settings/ivProducts',
      fix: {
        kind: 'setIvDuration',
        ivProductId: row.id,
        label: mine.name ?? row.name,
        durationMin: row.durationMin,
      },
    }));
}

/**
 * 2026-09-06 之前種子上那個課程的三格名字。**只認得出這一代。**
 *
 * 她 2026-09-08：「只要 line 是靜脈雷射就好，我不想在其他地方看到『靜脈』，
 * 像是好像目前有課程名稱叫做『靜脈』？如果是舊資料庫的問題那沒關係」。
 *
 * 是舊資料庫的問題：種子上早就是 `ILIB` / `IL` / `靜脈雷射` 了，
 * 而 `loadSeed()` 只建不覆蓋。
 *
 * `null` 代表「那一格是空的」。
 */
const LEGACY_COURSES = {
  'course-iv-laser': { name: '靜脈', shortName: null, lineName: null },
};

/**
 * 二十二、課程的名字跟建議的不一樣。形狀照抄 `checkEquipmentNames()`。
 *
 * **三格要同時還停在舊的才報**：她自己改過其中一格就是一個決定，
 * 不可以被一顆按鈕改回去。
 */
function checkCourseNames(ctx) {
  const same = (a, b) => (String(a ?? '').trim() || null) === (b ?? null);

  return (SEED.courses ?? [])
    .filter((row) => LEGACY_COURSES[row.id])
    .map((row) => ({ row, was: LEGACY_COURSES[row.id], mine: ctx.coursesById[row.id] }))
    .filter(({ was, mine }) => mine && !mine.deletedAt
      && same(mine.name, was.name)
      && same(mine.shortName, was.shortName)
      && same(mine.lineName, was.lineName))
    .map(({ row, mine }) => ({
      severity: 'attention',
      title: mine.name ?? row.name,
      detail: `全名改成「${row.name}」、月曆簡寫「${row.shortName ?? '（空）'}」、`
        + `LINE 草稿「${row.lineName ?? '（空）'}」`,
      link: '#/settings/naming',
      fix: {
        kind: 'renameCourse',
        courseId: row.id,
        label: mine.name ?? row.name,
        name: row.name,
        shortName: row.shortName ?? null,
        lineName: row.lineName ?? null,
        fromName: mine.name ?? '',
      },
    }));
}

/**
 * 同一位客戶同一天有兩筆來訪。
 *
 * **只列不修**（同 `checkDuplicateAvailability()` 的判斷）。2026-09-09 之後
 * 兩個入口都會併進同一筆（ADR-0083），所以不會再長出新的；這一項掃的是
 * 既有資料。
 *
 * 不自動合併的理由跟那一項一樣，只是更硬：合併要搬時段、刪掉一筆來訪、
 * 重算次數、重推任務，而**其中一筆可能是刻意分開的**（那一天她先做完了
 * 一場、下午又臨時排了一場，前一筆是 `done`）。合併掉的話那一場的
 * 「已完成」會被拖回「待確認」，而次數跟著退回去。
 *
 * 所以這裡只回答「這幾天長得不一樣，去看一眼」。
 */
function checkSameDayVisits(ctx) {
  const byKey = new Map();
  for (const v of ctx.visits ?? []) {
    if (!v || v.deletedAt || !v.customerId || !v.date) continue;
    const key = `${v.customerId}|${v.date}`;
    byKey.set(key, [...(byKey.get(key) ?? []), v]);
  }

  const out = [];
  for (const [key, rows] of byKey) {
    if (rows.length < 2) continue;
    const [customerId] = key.split('|');
    const who = rows[0].customerName ?? nameOf(ctx, customerId);
    out.push({
      severity: 'attention',
      who: who,
      whoId: customerId,
      title: `${who}・${rows[0].date}`,
      detail: `這一天記了 ${rows.length} 筆來訪（共 ${
        rows.reduce((n, v) => n + (v.slots ?? []).length, 0)
      } 段）。現在同一天只會有一筆，這是舊資料 —— 只列出來，不自動合併`
        + '（其中一筆可能是刻意分開的）。',
      link: null,
      fix: null,
    });
  }
  return out;
}

/**
 * 二返接的那一次健檢對不上（2026-10-09，ADR-0145）。**只列不修** —— 她：「連結只是記錄，任何一邊被取消或改期都只提醒、不連動」。
 *
 * - 接在取消、未到的那一次上（`strandedFollowups()`）：那一次不會有報告。健檢改期＝取消＋另約一天，二返還接在舊的那一次。
 *   「退回簽療程單」之後那一次又接得上了，這一列自己消失（現算的）
 * - 二返已經做了、接的那一次還沒做完（`doneAheadOfExam()`）：簽療程單擋住之前就存在的；那一次做完時追蹤健檢報告不會長
 *
 * 判斷只在 `followups.js`，這裡只組句子。
 */
function checkFollowupLinks(ctx) {
  const out = [];
  for (const customer of alive(ctx.customers)) {
    const ents = alive(ctx.entsByCustomer[customer.id] ?? []);
    const visits = ctx.visitsByCustomer[customer.id] ?? [];
    const row = (f, detail) => out.push({
      severity: 'attention',
      who: customer.name,
      whoId: customer.id,
      title: `${customer.name}・${f.visit.date} 那一場${f.slot.courseName || '二返'}`,
      detail,
      link: null,
      fix: null,
    });
    for (const f of strandedFollowups(ents, ctx.coursesById, visits)) {
      row(f, `接在 ${f.exam.date} 那一次健檢上，那一次是「${shortStatus(f.status)}」—— 不會有報告。`
        + `重新約好健檢之後：日曆 → ${f.visit.date} → 點那一場 → 改這一段 → 換「這是哪一次健檢的」`);
    }
    for (const f of doneAheadOfExam(ents, ctx.coursesById, visits)) {
      row(f, `已經做了，但接的 ${f.exam.date} 那一次健檢還沒做完（「${shortStatus(f.status)}」）—— `
        + '那一次做完時「追蹤健檢報告」不會長。去日曆看那兩天');
    }
  }
  return out;
}

/** 同一次健檢接了兩場活著的二返（`doubleClaimedExams()`）。只列不修：哪一場要換成別次、或改成 n返，是她的決定。 */
function checkFollowupDouble(ctx) {
  const out = [];
  for (const customer of alive(ctx.customers)) {
    const ents = alive(ctx.entsByCustomer[customer.id] ?? []);
    for (const d of doubleClaimedExams(ents, ctx.coursesById, ctx.visitsByCustomer[customer.id] ?? [])) {
      out.push({
        severity: 'attention',
        who: customer.name,
        whoId: customer.id,
        title: `${customer.name}・${d.exam?.date ?? '（找不到那一次）'} 那一次健檢`,
        detail: `接了 ${d.holders.length} 場二返：${d.holders.map((h) => h.visit.date).join('、')} —— `
          + '一次健檢配一場，其中一場去日曆換「這是哪一次健檢的」，或改成「＋ n返」',
        link: null,
        fix: null,
      });
    }
  }
  return out;
}

const RUNNERS = {
  visitStatusDerived: checkVisitStatusDerived,
  sameDayVisits: checkSameDayVisits,
  followupLinks: checkFollowupLinks,
  followupDouble: checkFollowupDouble,
  courseNames: checkCourseNames,
  courseRecord: checkCourseRecord,
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
  entitlementMinutes: checkEntitlementMinutes,
  slotMinutes: checkSlotMinutes,
  chartNo: checkChartNo,
  poolLabel: checkPoolLabels,
  importedLabel: checkImportedLabels,
  alertTerm: checkAlertTerms,
  seedEquipment: checkSeedEquipment,
  seedDuration: checkSeedDurations,
  seedCourse: checkSeedCourse,
  seedIvProduct: checkSeedIvProduct,
  seedStaff: checkSeedStaff,
  seedBlanks: checkSeedBlanks,
  courseDuration: checkCourseDuration,
  ivProductDuration: checkIvProductDuration,
};
