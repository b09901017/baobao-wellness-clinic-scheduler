// 任務產生規則。純函式，不碰 IO。
//
// 規則綁在「類別」上，不逐課程設定 —— 新增課程時只要選一個類別。
// 舊的 Apps Script 是用課程名稱做字串包含比對，療程一改名就靜默失效。
// 這裡不照抄，見 docs/legacy/README.md。
//
// ## 待辦只記「還沒發生的事」
//
// 2026-08-23 拿掉了兩種任務：「Abovee」與「打電話」。
//
// **壓表就是在 Abovee 上把時段佔住**（CONTEXT.md 的「壓表」），而 app 裡的來訪
// 從「已壓表・待客人確認」開始（SPEC 第 4.1 節）—— 因為她先壓完才回來記。
// 所以「去 Abovee 登記」在那筆來訪存在的那一秒就已經做完了，再產生一張待辦，
// 等於要她把同一件事勾兩次。健檢同理，只是她壓健檢的方式是直接去 Examine。
// 打電話那一件她不再做了。
//
// 留下來的兩種（Examine、耀聖）有一個共同點：**它們發生在壓表之後的另一個
// 時間點**，所以會被忘記，所以需要待辦。見
// docs/adr/0041-the-sheet-is-the-registration.md。

import { addDays } from './dates.js';
import { FOLLOWUP_TASK_KIND, REPORT_TASK_KIND } from './followups.js';

/** @typedef {'A'|'B'|'C'|null} Category */

export const TASK_KINDS = ['Examine', '耀聖'];

/**
 * 會在外部系統留下登記的那幾種。取消來訪時，只有這些已經做過的需要回頭取消。
 *
 * `Abovee` 留在名單上而它已經不是任務種類了 —— 歷史資料裡有勾掉的 Abovee 任務，
 * 那些來訪取消時照樣要回頭去放掉時段。
 */
export const REGISTRATION_KINDS = ['Abovee', 'Examine', '耀聖'];

/**
 * 來訪走到這個狀態，登記任務才長得出來。
 *
 * 她的順序是「壓表 → 問客人 → 客人說可以 → 才去另外那幾個系統登記」。
 * 存成 pending_confirm 的那一刻客人還沒回，那幾件登記要不要做**還不知道**——
 * 壓完一晚上二十幾位就立刻多出幾十件待辦，而其中一部分等客人說不行就會被收掉。
 * 見 docs/adr/0027-registration-tasks-wait-for-the-customer.md
 *
 * 這一條只管「產不產生」，不管「留不留」：已經在的任務一個都不會因為狀態
 * 走到別的地方而被收掉，那是底下依課程比對那一段的事。所以
 * confirmed → done 不會把她還沒做完的登記洗掉，而
 * pending_confirm → done（補記一筆已經上完的課）也不會突然長出一串
 * 死線早就過了的紅字 —— 那天已經過完了，掛號這件事沒有東西要補。
 */
// 刻意不 export：要問「現在可不可以產生」一律走 acceptsNewTasks()。
// 把常數放出去，就會有人在別的地方自己寫一次比對，而那就是第二份實作。
const TASKS_START_AT = 'confirmed';

/** @param {string} status 來訪狀態 */
export function acceptsNewTasks(status) {
  return status === TASKS_START_AT;
}

export const CANCEL_PREFIX = '取消 ';

export const cancelKindFor = (kind) => `${CANCEL_PREFIX}${kind}`;
export const isCancelKind = (kind) => String(kind ?? '').startsWith(CANCEL_PREFIX);

// null 是明確的「不用掛號」，不是漏填。Inbody、物理諮詢、營養諮詢、
// 體適能分析都屬於這一類。設定頁必須把這件事顯示出來，
// 而不是讓使用者看到一片空白自己猜。
export const CATEGORY_OPTIONS = [
  { value: 'A', label: 'A · 門診', hint: '復健科、心臟科、二返' },
  { value: 'B', label: 'B · 健檢', hint: '健檢' },
  { value: 'C', label: 'C · 療程', hint: '復能、靜脈、EECP、營養點滴' },
  { value: null, label: '不用掛號', hint: 'Inbody、諮詢類、體適能分析' },
];

/** 給 UI 用的一句話說明。壓表在哪、確認之後還要做什麼，兩件都講。 */
export function describeCategory(category) {
  const opt = CATEGORY_OPTIONS.find((o) => o.value === (category ?? null));
  if (!opt) return `未知類別（${category}）`;
  const after = tasksForCategory(category);
  const tail = after.length ? `確認後 ${after.join('、')}` : '確認後沒有後續登記';
  return `${opt.label} — ${bookingSystemFor(category)} 壓表，${tail}`;
}

/**
 * 一個類別管兩件事：**壓表登記在哪個系統**，以及**客人確認之後還要去哪幾個**。
 *
 * 不是一串任務了 —— 壓表那一件不是任務（見檔頭），但「她在哪裡壓的」這件事
 * 取消來訪時還要用到（要回去把那個時段放掉），所以它仍然要有一個地方記著。
 *
 * `null`（不用掛號）與 `C` 現在**行為完全一樣**：兩者都在 Abovee 壓、
 * 確認後都沒有後續登記。差別只剩她在主檔上怎麼稱呼它 —— 這不是漏改，
 * 是 2026-08-23 那一輪的結果（Inbody、體適能、兩種諮詢照樣要在 Abovee 佔格子）。
 */
export const RULES = Object.freeze({
  A: Object.freeze({ bookAt: 'Abovee', onConfirm: Object.freeze(['Examine', '耀聖']) }),
  B: Object.freeze({ bookAt: 'Examine', onConfirm: Object.freeze([]) }),
  C: Object.freeze({ bookAt: 'Abovee', onConfirm: Object.freeze([]) }),
});

/**
 * 認不得的類別（含 null）一律當成「Abovee 壓表、沒有後續登記」。
 *
 * 這裡刻意用猜的，跟 `tasksForCategory()` 對未知類別回空陣列不一樣：
 * 猜錯 `bookAt` 的代價是取消時多一張「回去放掉 Abovee 的時段」的提醒，
 * 而猜錯 `onConfirm` 的代價是一批不存在的掛號待辦。多一句提醒她看得懂，
 * 多一批假待辦她只會學會忽略它們。
 */
const DEFAULT_RULE = Object.freeze({ bookAt: 'Abovee', onConfirm: Object.freeze([]) });

const ruleFor = (category) => RULES[category] ?? DEFAULT_RULE;

/** 這個類別的課程，壓表是壓在哪個系統上。 */
export function bookingSystemFor(category) {
  return ruleFor(category).bookAt;
}

/**
 * 一筆來訪動到了哪幾個系統的壓表登記。取消時要回去放掉的就是這幾個。
 *
 * **認不得的課程照樣算一個**，用預設的 Abovee。這一支之前是 `continue`，
 * 那是錯的：這裡不確定的只有「壓在哪個系統」，而「有沒有壓過」是確定的 ——
 * 那筆來訪存在就代表壓過了（ADR-0041 的整個前提）。跳過等於在課程主檔
 * 被刪掉的那幾筆上，把 ADR-0041 要補的洞原樣留著，而那個時段是真的還被佔著。
 *
 * 猜錯的代價是一張寫著錯系統的提醒，她看得懂；不猜的代價是一個時段
 * 永遠佔在那裡而畫面上什麼都沒說。
 */
export function bookingSystemsForVisit(visit, coursesById = {}) {
  const out = new Set();
  for (const slot of visit?.slots ?? []) {
    out.add(bookingSystemFor(coursesById[slot.courseId]?.category));
  }
  return [...out];
}

/** 某個類別在**客人確認之後**會產生哪些任務。未知類別回空陣列，不猜。 */
export function tasksForCategory(category) {
  return [...ruleFor(category).onConfirm];
}

/**
 * 任務死線 = 來訪日的前一天。可以提早做，逾期變紅。
 * @param {string} visitDate 'YYYY-MM-DD'
 * @returns {string} 'YYYY-MM-DD'
 */
export function dueDateFor(visitDate) {
  const [y, m, d] = visitDate.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - 1);
  return dt.toISOString().slice(0, 10);
}

/**
 * 一筆來訪在**客人確認之後**該有哪些任務，純粹看它有哪些課程
 *（SPEC 第 5.5 節那張矩陣）。壓表登記不在裡面 —— 那件事她已經做完了，見檔頭。
 *
 * 「該有」不等於「現在就產生」—— 什麼時候長出來是 acceptsNewTasks() 的事。
 * 兩件事分開是刻意的：這一支同時被用來比對現有的任務（哪些還該留著），
 * 而那個比對不可以跟著狀態變，否則來訪一結案，她還沒做完的登記就會被靜默收掉。
 *
 * 同一次來訪裡有多個時段時，同名任務只產生一次 —— 她不需要為了同一天
 * 掛兩次 Examine。
 *
 * @param {{id:string, customerId:string, customerName:string, date:string,
 *          slots:{courseId:string}[]}} visit
 * @param {Record<string, {category: Category}>} coursesById
 */
export function tasksForVisit(visit, coursesById) {
  const kinds = new Set();
  for (const slot of visit.slots ?? []) {
    const course = coursesById[slot.courseId];
    if (!course) continue;
    for (const kind of tasksForCategory(course.category)) kinds.add(kind);
  }

  const dueDate = dueDateFor(visit.date);
  return [...kinds].map((kind) => ({
    visitId: visit.id,
    customerId: visit.customerId,
    customerName: visit.customerName,
    kind,
    dueDate,
    done: false,
    doneAt: null,
    note: null,
    autoGenerated: true,
  }));
}

/**
 * 一筆來訪存檔之後，它的任務該變成什麼樣。
 *
 * 這是 SPEC 第 4.1 節那句「客人改時間時，如果先前已經登記過，必須自動產生
 * 取消舊時段的任務，不能默默改日期」的實作。任務不是建立來訪時產生一次就算了，
 * 它要跟著來訪的狀態走，否則就會回到現在白紙的狀態：東西改了，該做的事沒人記得。
 *
 * 已完成的任務一律不刪 —— 那件事真的做過了，刪掉等於竄改歷史。
 *
 * 新的任務只在客人確認之後長出來（acceptsNewTasks()）。這一支照樣每次存檔
 * 都要跑：pending_confirm 那一段它仍然要負責把該收的收掉、該移的死線移掉，
 * 只是不會無中生有。
 *
 * @param {object} visit 存檔後的來訪（要有 id）
 * @param {object[]} existingTasks 這筆來訪現有的任務
 * @param {{coursesById: Record<string, {category: Category}>, today: string}} ctx
 * @returns {{create: object[], update: {id:string, changes:object}[],
 *            remove: {id:string, reason:string}[]}}
 */
export function syncTasksForVisit(visit, existingTasks = [], { coursesById = {}, today } = {}) {
  const create = [];
  const update = [];
  const remove = [];

  // 取消類的任務不受來訪現況管轄：它記的是「當初登記過、現在要收回來」這件事，
  // 來訪本身怎麼變都不該動到它。
  //
  // 「追蹤健檢報告」與「約二返」同樣不歸這裡管，但理由不一樣：它們是從額度
  // 推導的，而這一支的視野只有一筆來訪，看不到「另外那兩次健檢的二返已經約掉了」。
  // 不擋掉的話，健檢那一筆一存檔，這裡就會因為「來訪裡沒有需要這個任務的課程」
  // 而把它刪掉。那一段在 domain/followups.js 的 syncFollowupTasks()。
  const CHAIN_KINDS = [FOLLOWUP_TASK_KIND, REPORT_TASK_KIND];
  const auto = (existingTasks ?? []).filter(
    (t) => !t.deletedAt
      && t.autoGenerated
      && !isCancelKind(t.kind)
      && !CHAIN_KINDS.includes(t.kind),
  );

  const gone = visit.deletedAt || visit.status === 'cancelled';

  if (gone) {
    // 同一種取消任務只長一張。這一支每次存檔都會跑，而取消任務不受來訪現況管轄
    // （上面 auto 那一段濾掉它們），所以沒有這一道，存兩次就是兩張。
    const already = new Set(
      (existingTasks ?? [])
        .filter((t) => !t.deletedAt && isCancelKind(t.kind))
        .map((t) => t.kind),
    );

    // kind → 那一句說明。用 Map 是為了讓下面兩個來源自然去重：
    // 一筆健檢的壓表登記在 Examine，而它身上也可能有一張已經勾掉的 Examine 任務。
    const wanted = new Map();

    // 1. 壓表登記本身。**來訪存在就代表她已經在那個系統上把時段佔住了**
    //    —— app 裡的來訪從「已壓表」開始（SPEC 第 4.1 節），所以不需要任何
    //    任務來證明她壓過。取消時那個時段要放回去。
    for (const system of bookingSystemsForVisit(visit, coursesById)) {
      wanted.set(
        cancelKindFor(system),
        `${visit.date} 的來訪取消了，回去把 ${system} 上壓的時段放掉`,
      );
    }

    // 2. 已經勾完成的登記任務。打電話做過就是做過了，沒有東西要收回來。
    for (const t of auto) {
      if (t.done && REGISTRATION_KINDS.includes(t.kind)) {
        wanted.set(
          cancelKindFor(t.kind),
          `${visit.date} 的來訪取消了，回去把 ${t.kind} 的登記取消掉`,
        );
      } else if (!t.done) {
        remove.push({ id: t.id, reason: '來訪已取消' });
      }
    }

    for (const [kind, note] of wanted) {
      if (already.has(kind)) continue;
      create.push(cancelTask(visit, kind, note, today));
    }
    return { create, update, remove };
  }

  const wanted = new Map(tasksForVisit(visit, coursesById).map((t) => [t.kind, t]));

  for (const t of auto) {
    const want = wanted.get(t.kind);
    if (!want) {
      // 這個課程被移出來訪了。沒做的就不用做了，做過的留著。
      if (!t.done) remove.push({ id: t.id, reason: '來訪裡已經沒有需要這個任務的課程' });
      continue;
    }
    wanted.delete(t.kind);

    const changes = {};
    if (t.dueDate !== want.dueDate) changes.dueDate = want.dueDate;
    if ((t.customerName ?? null) !== (visit.customerName ?? null)) {
      changes.customerName = visit.customerName ?? null;
    }
    if (Object.keys(changes).length) update.push({ id: t.id, changes });
  }

  // 還沒問過客人就不產生（acceptsNewTasks()）。上面那一圈照樣跑完，所以
  // 「課程被移出來訪就把沒做的收掉」「改了日期死線跟著移」都不受影響 ——
  // 這裡擋掉的只有「無中生有」那一種。
  if (acceptsNewTasks(visit.status)) create.push(...wanted.values());
  return { create, update, remove };
}

/** 回頭去把已經佔住的東西放掉。這件事沒有寬限期，越快越好。 */
function cancelTask(visit, kind, note, today) {
  const deadline = dueDateFor(visit.date);
  return {
    visitId: visit.id ?? null,
    customerId: visit.customerId,
    customerName: visit.customerName ?? null,
    kind,
    dueDate: today && today < deadline ? today : deadline,
    done: false,
    doneAt: null,
    note,
    autoGenerated: true,
  };
}

/**
 * 任務的緊迫程度，給 UI 上色用。
 * @returns {'overdue'|'soon'|'later'}
 */
export function urgency(dueDate, today) {
  if (dueDate < today) return 'overdue';
  return dueDate <= dueDateFor(addDays(today, 2)) ? 'soon' : 'later';
}
