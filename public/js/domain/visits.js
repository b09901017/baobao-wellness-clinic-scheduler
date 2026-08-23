// 來訪的狀態機與送出前的檢查。純函式。
//
// 只有兩種結果：errors 擋下儲存，warnings 顯示在旁邊但存得下去。
// 除了醫療禁忌與「欄位根本沒填」之外，一律是 warnings ——
// 見 docs/adr/0002-app-records-decisions-it-does-not-make-them.md。
// app 看不到同事在 Abovee 上壓的東西，用不完整的資料去擋一個看得到完整畫面的人，
// 只會擋錯。

import { overlaps, isValidTime, toMinutes } from './visitTime.js';
import { validateSlots as contraindicationErrors } from './contraindications.js';
import { counts, slotOutcome } from './entitlements.js';
import { isValidDate, daysBetween } from './dates.js';
import { roomsForCourse, DOCTOR_ROLE } from './masterData.js';

/** 沒有 draft：她是先在 Abovee 壓完表才回來記錄的，app 裡不存在還沒壓表的來訪。 */
export const VISIT_STATUSES = [
  'pending_confirm',
  'confirmed',
  'done',
  'no_show',
  'cancelled',
];

/** 來訪的起點。SPEC 第 4.1 節。 */
/**
 * 來訪身上那一句話的長度上限（SPEC 第 5.3 節的 `note`）。
 *
 * 它是**這一天**的，不是某一個時段的 —— 她記的東西通常是「這次來訪」的事。
 * 跟客戶身上的**備註**是兩回事：備註跟著人一直在，這一句跟著這一筆來訪。
 *
 * 放在這裡而不是放在畫面上：壓表與來訪編輯器寫的是同一個欄位，兩邊各寫一個
 * 數字遲早會變成「在壓表打得下、回來改就被截掉」。
 */
export const NOTE_MAX = 200;

export const INITIAL_STATUS = 'pending_confirm';

/**
 * 一個狀態長什麼樣，只有這一份。
 *
 * 日曆的色條、日檢視的狀態丸、客戶詳情的日期卡、試算表的勾選格，全部讀這裡。
 * 她的原話是「前面說的流程，寫程式的時候都要記得同步，這很重要」——
 * 同一位客戶在兩個畫面顯示成不同狀態或不同顏色，她不會知道哪個算數。
 *
 * 四個欄位各有各的用處，不要互相代用：
 *
 * | 欄位 | 給誰 | 為什麼不能共用 |
 * |---|---|---|
 * | `label` | 狀態按鈕、詳情頁的徽章 | 講得完整：「已壓表，等客戶回覆」 |
 * | `short` | 日曆圖例 | 那裡只放得下三個字 |
 * | `mark`  | 試算表的勾選格 | 一格一個字元 |
 * | `cls`   | CSS | 顏色在 `app.css`，一個狀態一組 `--kind-fg` / `--kind-bg` |
 *
 * 顏色的走向是「暖 → 冷 → 綠」：待確認琥珀（還欠一件事）、
 * 已確認霧藍（談定了、還沒發生）、已完成墨綠（結案）。
 * 未到用紅的 —— 它不急，但「這個人常放鴿子」是要看得見的（SPEC 第 4.2 節）。
 * 取消是灰的，而且日曆上根本不畫（`isActive()` 濾掉了）。
 */
const STATUS_VIEW = {
  pending_confirm: {
    label: '已壓表，等客戶回覆', short: '待確認', mark: '○', cls: 'status-pending',
  },
  confirmed: {
    label: '客戶已確認', short: '已確認', mark: '△', cls: 'status-confirmed',
  },
  done: {
    label: '已完成', short: '已完成', mark: '✓', cls: 'status-done',
  },
  no_show: {
    label: '未到', short: '未到', mark: '✗', cls: 'status-no-show',
  },
  cancelled: {
    label: '已取消', short: '已取消', mark: '', cls: 'status-cancelled',
  },
};

/** 畫圖例時的順序。是流程的順序，不是字母序。 */
export const STATUS_VIEW_ORDER = ['pending_confirm', 'confirmed', 'done', 'no_show'];

/**
 * 同一格裡有好幾種符號時，照這個順序印：**做完的排前面，未到排最後**。
 *
 * 這不是流程順序倒過來 —— 未到是流程的終點之一，但在一格裡它最不重要，
 * 排在最後。所以另外寫一份順序，符號本身還是從 STATUS_VIEW 拿。
 */
const MARK_ORDER_STATUSES = ['done', 'confirmed', 'pending_confirm', 'no_show'];

export const MARK_ORDER = MARK_ORDER_STATUSES
  .map((status) => STATUS_VIEW[status].mark)
  .filter(Boolean);

/** 符號的意思，一行印在試算表上。她不會記得 △ 是哪一種。 */
export const MARK_LEGEND = MARK_ORDER_STATUSES
  .filter((status) => STATUS_VIEW[status].mark)
  .map((status) => `${STATUS_VIEW[status].mark} ${STATUS_VIEW[status].label}`)
  .join('　');

/** 不認得的狀態不給符號 —— 印一個猜的比空白更糟。 */
export function markFor(status) {
  return STATUS_VIEW[status]?.mark ?? '';
}

/**
 * 這個狀態的 CSS class。顏色在 `app.css` 的 `.status-*`。
 *
 * 認不得的狀態回空字串，那一筆就長成預設的灰 —— 看得出「這個怪怪的」，
 * 而不是被畫成某一種正常狀態。
 */
export function statusClass(status) {
  return STATUS_VIEW[status]?.cls ?? '';
}

/** 三個字的版本，給日曆圖例這種放不下整句話的地方。 */
export function shortStatus(status) {
  return STATUS_VIEW[status]?.short ?? String(status ?? '？');
}


// 改期不是改日期，是取消 + 重新排（SPEC 第 7 節規則 9），所以 cancelled 是終點。
// done 也是終點，要改必須走更正流程（SPEC 第 6.4 節）。
const TRANSITIONS = {
  pending_confirm: ['confirmed', 'done', 'no_show', 'cancelled'],
  confirmed: ['done', 'no_show', 'cancelled'],
  no_show: ['confirmed', 'cancelled'],
  done: [],
  cancelled: [],
};

/** 不認得的狀態原樣顯示，不要吞掉 —— 那代表資料有問題，要看得見。 */
export function describeStatus(status) {
  return STATUS_VIEW[status]?.label ?? String(status ?? '（沒有狀態）');
}

export function nextStatuses(from) {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from, to) {
  return nextStatuses(from).includes(to);
}

/** 已完成的來訪是唯讀鎖定區，要改必須填理由走更正流程。SPEC 第 6.4 節。 */
export function isLocked(status) {
  return status === 'done';
}

/**
 * 這筆來訪是從舊試算表匯進來的。
 *
 * 舊表的勾選只有日期 —— 沒有時間、沒有器材、沒有診間、沒有治療師，
 * 那些資訊在舊系統裡從來沒有被記下來過。所以匯入的來訪只保證三件事：
 * 哪一天、上了哪個課程、扣哪一份額度。其餘欄位一律是 null，驗證要放它過。
 *
 * 見 docs/adr/0011-imported-visits-are-incomplete-on-purpose.md
 */
export function isImported(visit) {
  return Boolean(visit?.importedFrom);
}

/** 這筆來訪還算不算佔著次數。取消的不算，時段已經還回去了。 */
export function isActive(visit) {
  return !visit?.deletedAt && visit?.status !== 'cancelled';
}

// ---------- 收尾（客人來了沒、療程單簽了沒） ----------

/**
 * 該結案卻還沒結案的來訪。待辦中心「今天來的」那一列。
 *
 * 是**推導**的，不是任務（ADR-0001 的同一個判斷）：療程單就是「這一次算不算數」
 * 的憑據（`CONTEXT.md`），所以它問的其實是「這筆來訪結案了沒」，
 * 而那個答案就在來訪的狀態上。另外存一筆任務就多一個會對不起來的地方，
 * 而對不起來的那天沒有人會發現。
 *
 * 日子還沒到的不列 —— 客人還沒來就不可能勾。
 * `pending_confirm` 也列：那天已經過了卻還沒問過客人，那更需要收尾。
 *
 * @returns {object[]} 日期舊的排前面（拖最久的最上面）
 */
export function visitsToClose(visits = [], today) {
  return visits
    .filter((v) => !v.deletedAt
      && (v.status === 'confirmed' || v.status === 'pending_confirm')
      && isValidDate(v.date)
      && v.date <= today)
    .slice()
    .sort((a, b) => a.date.localeCompare(b.date)
      || String(a.customerName ?? '').localeCompare(String(b.customerName ?? ''), 'zh-TW'));
}

/**
 * 這個課程當天要不要請客人簽療程單。
 *
 * 療程單是**扣掉那一次的憑據** —— 客人事後對次數有疑問時，拿得出來的就是它
 *（`CONTEXT.md`）。所以幾乎每一種都要簽，只有二返不用：那一次是回院聽報告，
 * 沒有療程可以扣（2026-08-23 使用者確認）。
 *
 * **認不得的課程當成要簽**，沒有欄位的舊資料也一樣。少簽一張單是實際損失，
 * 多問她一次不是。
 */
export function needsForm(course) {
  return course?.needsTreatmentForm !== false;
}

/**
 * 這一筆來訪裡，哪幾段要請客人簽療程單。回的是時段的索引。
 *
 * 空陣列代表整筆都不用簽（例：只有二返的那一天）—— 但**那一筆照樣要結案**，
 * 次數是在結案時扣的（SPEC 第 4.2 節）。「不用簽單」跟「不用收尾」是兩件事。
 */
export function formSlotIndexes(visit, coursesById = {}) {
  return (visit?.slots ?? [])
    .map((slot, i) => (needsForm(coursesById[slot.courseId]) ? i : -1))
    .filter((i) => i >= 0);
}

/**
 * 這一段在畫面上要顯示成哪一個狀態。
 *
 * 和 `slotOutcome()` 差在一件事：那一支是**計數**用的，只回答
 * 「這一段算做了、沒到、還是佔著」，所以待確認與已確認都收斂成 `booked`。
 * 這一支是**顯示**用的，那兩種必須分得出來 —— 她要看的正是
 * 「哪幾段還沒問客人、哪幾段已經談定」。
 *
 * `attended` 的讀法沒有第二份：這裡先問 `slotOutcome()`，
 * 只有它答不出結果（也就是還沒發生）時才退回整筆的狀態。
 * 改 `attended` 的意思時只要改 `slotOutcome()`（ADR-0025）。
 *
 * @returns {string|null} VISIT_STATUSES 裡的一個，或 null（已刪除）
 */
export function slotStatus(visit, slot) {
  const outcome = slotOutcome(visit, slot);
  if (outcome === 'done' || outcome === 'no_show') return outcome;
  if (visit?.deletedAt) return null;
  return visit?.status ?? null;
}

/**
 * 還要去問客人的來訪。待辦中心「跟客人確認時間」那一列。
 *
 * 和 `visitsToClose()` 是同一個切法的兩半，所以寫在一起 ——
 * 分兩個檔案遲早會變成「一邊改了、另一邊沒改」，然後同一筆來訪同時出現在兩列，
 * 或者兩列都不出現。
 *
 * **日子過了的不列。** 「8/3 那個時間可以嗎」在 8/20 問是沒有意義的，
 * 那時唯一做得到的事是收尾（她來了沒），而那一筆已經在 `visitsToClose()` 裡。
 * 當天的兩邊都列 —— 早上問「今天下午可以嗎」與下午問「她來了沒」都成立。
 *
 * 日期壞掉的**留在這一列**，不要讓它從兩邊一起消失 ——
 * 看不見的壞資料比看得見的壞資料難修。
 *
 * @returns {object[]}
 */
export function visitsToConfirm(visits = [], today) {
  return visits.filter((v) => !v.deletedAt
    && v.status === 'pending_confirm'
    && (!isValidDate(v.date) || v.date >= today));
}

/**
 * 收尾：把一筆來訪標成已完成或未到，並逐段記下哪幾段真的做了。
 *
 * 純函式，回傳新的來訪 —— 規則不寫在 UI 的事件處理器裡（SPEC 第 10 節）。
 * 收尾畫面與來訪編輯器的狀態按鈕走同一支，兩邊算出來的東西才會一樣。
 *
 * **一段都沒做就是整筆未到。** 她在收尾畫面把每一段都取消勾選時，意思是
 * 「這個人沒來」，而不是「來了但什麼都沒做」—— 後者不存在。未到不扣次數，
 * 時段還回去（SPEC 第 4.2 節）。
 *
 * 一次來訪一定至少有一個時段（`validateVisit()` 與 `firestore.rules` 兩層都擋），
 * 所以不會出現「沒有時段可以勾，於是被當成未到」的情況。
 *
 * @param {object} visit
 * @param {boolean[]} attended 逐段：這一段做了沒。長度不足的補成有做 ——
 *   少傳的那幾段是「畫面上沒問到」，當成沒做會無聲扣掉她的次數。
 * @param {string} at ISO 時間
 */
export function closeVisit(visit, attended = [], at = new Date().toISOString()) {
  const slots = (visit?.slots ?? []).map((slot, i) => ({
    ...slot,
    attended: attended[i] ?? true,
  }));
  const anyAttended = slots.some((s) => s.attended);

  return {
    ...visit,
    slots,
    status: anyAttended ? 'done' : 'no_show',
    statusAt: at,
  };
}

/**
 * 這筆額度可以排哪些課程。
 *
 * single 的額度自己記著課程，一對一。
 * 擇一池換的是器材不是課程（SPEC 第 4.5 節），所以池上沒有 courseId ——
 * 但時段一定要記課程，因為任務是綁在課程的類別上（SPEC 第 5.5 節）。
 * 這裡用「需要選器材的課程」把它接回去，見
 * docs/adr/0005-pool-slots-get-their-course-from-requires-equipment.md
 *
 * @returns {object[]} 可選的課程，只有一個時 UI 應該直接帶入
 */
export function coursesForEntitlement(entitlement, courses = []) {
  const alive = courses.filter((c) => !c.deletedAt);
  if (entitlement?.type === 'pool') return alive.filter((c) => c.requiresEquipment);
  return alive.filter((c) => c.id === entitlement?.courseId);
}

// ---------- 檢查 ----------

const byId = (rows) => Object.fromEntries((rows ?? []).map((r) => [r.id, r]));

/**
 * 送出前的完整檢查。
 *
 * @param {object} visit 要存的來訪（可以還沒有 id）
 * @param {object} ctx
 * @param {object} ctx.customer
 * @param {object[]} ctx.courses
 * @param {object[]} ctx.equipment
 * @param {object[]} ctx.entitlements 這位客戶的額度
 * @param {object[]} [ctx.rooms]
 * @param {object[]} [ctx.staff] 治療師與醫師，config/staff 全部
 * @param {object[]} [ctx.ivProducts]
 * @param {object[]} [ctx.sameDayVisits] 同一天她自己排的其他來訪（不含這一筆）
 * @param {object[]} [ctx.customerVisits] 這位客戶的其他來訪，看頻率限制用
 * @returns {{errors: string[], warnings: string[]}}
 */
export function validateVisit(visit, ctx) {
  return {
    errors: visitErrors(visit, ctx),
    warnings: visitWarnings(visit, ctx),
  };
}

function visitErrors(visit, {
  customer, courses = [], equipment = [], entitlements = [], ivProducts = [], staff = [],
}) {
  const errors = [];
  // 匯入的舊來訪缺的那些欄位不是漏填，是舊系統從來沒記過。見 isImported()。
  const imported = isImported(visit);
  const coursesById = byId(courses);
  const entsById = byId(entitlements);
  const equipById = byId(equipment);
  const ivById = byId(ivProducts);
  const staffById = byId(staff);

  if (!visit.customerId) errors.push('沒有指定客戶');
  if (!isValidDate(visit.date)) errors.push('來訪日期不合法');
  if (!VISIT_STATUSES.includes(visit.status)) errors.push('來訪狀態不合法');

  const slots = visit.slots ?? [];
  if (!slots.length) errors.push('一次來訪至少要有一個時段');

  slots.forEach((slot, i) => {
    const at = `第 ${i + 1} 個時段`;

    const ent = entsById[slot.entitlementId];
    if (!slot.entitlementId) errors.push(`${at}：要選一個額度`);
    else if (!ent) errors.push(`${at}：指定的額度不存在或已刪除`);

    const course = coursesById[slot.courseId];
    if (!slot.courseId) errors.push(`${at}：要選一個課程`);
    else if (!course) errors.push(`${at}：指定的課程不存在或已刪除`);

    // 匯入的來訪允許整個時間不詳（兩邊都 null）。只填一半仍然是錯的 ——
    // 那是打字打到一半，不是「舊表就沒有」。
    const timeUnknown = imported && slot.startsAt == null && slot.endsAt == null;
    if (!timeUnknown) {
      if (!isValidTime(slot.startsAt) || !isValidTime(slot.endsAt)) {
        errors.push(`${at}：時間格式不對`);
      } else if (toMinutes(slot.endsAt) <= toMinutes(slot.startsAt)) {
        errors.push(`${at}：結束時間要晚於開始時間`);
      }
    }

    if (!imported && course?.requiresEquipment && !slot.equipmentId) {
      errors.push(`${at}：${course.name} 每次都要記錄用了哪一種器材`);
    }
    if (!imported && course?.requiresIvProduct && !slot.ivProductId) {
      errors.push(`${at}：${course.name} 每次都要記錄施打的品項`);
    }
    if (slot.equipmentId && !equipById[slot.equipmentId]) {
      errors.push(`${at}：指定的器材不存在或已刪除`);
    }
    if (slot.ivProductId && !ivById[slot.ivProductId]) {
      errors.push(`${at}：指定的品項不存在或已刪除`);
    }

    // 醫師沒選是 warning 不是 error（見 assignmentWarnings）——
    // 她的舊表上寫過 `二返(8/5)`，日期敲定了、哪位醫師還沒定，那是真實情況。
    // 但**指到一個不存在的人、或指到一位物理治療師**是資料壞了，那要擋。
    // 治療師與醫師是兩種人，混用會讓復能派到醫師身上（CONTEXT.md）。
    if (slot.doctorId) {
      const doctor = staffById[slot.doctorId];
      if (!doctor) errors.push(`${at}：指定的醫師不存在或已刪除`);
      else if (doctor.role !== DOCTOR_ROLE) {
        errors.push(`${at}：${doctor.name} 不是醫師，是${doctor.role ?? '別的角色'}`);
      }
    }

    // 擇一池的次數是共用的，選了池外的器材就會扣到不屬於它的東西上
    if (ent?.type === 'pool' && slot.equipmentId
        && !(ent.optionEquipmentIds ?? []).includes(slot.equipmentId)) {
      errors.push(`${at}：這個器材不在「${ent.label}」的擇一池裡`);
    }
  });

  // 醫療禁忌：整個系統唯一的硬性阻擋
  for (const err of contraindicationErrors(customer, slots, equipById)) {
    errors.push(`第 ${err.slotIndex + 1} 個時段：${err.message}`);
  }

  return errors;
}

function visitWarnings(visit, ctx) {
  return [
    ...overlapWarnings(visit),
    ...entitlementWarnings(visit, ctx),
    ...assignmentWarnings(visit, ctx),
    ...conflictWarnings(visit, ctx),
    ...frequencyWarnings(visit, ctx),
  ];
}

/** 同一次來訪裡自己跟自己重疊。她一次填三段，很容易把時間填錯。 */
function overlapWarnings(visit) {
  const out = [];
  const slots = (visit.slots ?? []).filter((s) => isValidTime(s.startsAt) && isValidTime(s.endsAt));
  for (let i = 0; i < slots.length; i += 1) {
    for (let j = i + 1; j < slots.length; j += 1) {
      if (overlaps(slots[i], slots[j])) {
        out.push(`第 ${i + 1} 與第 ${j + 1} 個時段時間重疊`);
      }
    }
  }
  return out;
}

function entitlementWarnings(visit, { entitlements = [], customerVisits = [] }) {
  const out = [];
  const entsById = byId(entitlements);

  // 把這一筆算進去，才知道存下去之後會不會超用
  const withThis = [...customerVisits.filter((v) => v.id !== visit.id), visit];
  const used = new Set();

  for (const slot of visit.slots ?? []) {
    const ent = entsById[slot.entitlementId];
    if (!ent || used.has(ent.id)) continue;
    used.add(ent.id);

    const c = counts(ent, withThis, ent.id);
    if (c.done + c.booked > c.total) {
      out.push(`「${ent.label}」排完這次會超過總次數（共 ${c.total} 次，已排 ${c.done + c.booked} 次）`);
    }

    if (ent.expiresAt && isValidDate(ent.expiresAt) && isValidDate(visit.date)
        && daysBetween(ent.expiresAt, visit.date) > 0) {
      out.push(`「${ent.label}」在 ${ent.expiresAt} 就到期了，這次排在到期之後`);
    }
  }

  return out;
}

/** 該指派的沒指派、指派了不該指派的、診間不在課程允許的範圍內。 */
function assignmentWarnings(visit, { courses = [], rooms = [] }) {
  const out = [];
  const coursesById = byId(courses);

  (visit.slots ?? []).forEach((slot, i) => {
    const course = coursesById[slot.courseId];
    if (!course) return;
    const at = `第 ${i + 1} 個時段`;

    // 醫師走的是 requiresEquipment / requiresIvProduct 那條路（課程上一個布林、
    // 時段上一個 id），不是 assigns —— assigns 是單選的，而二返同時要診間和醫師。
    // 見 docs/adr/0026-doctors-are-assignable-staff.md
    if (course.requiresDoctor && !slot.doctorId) {
      out.push(`${at}：${course.name} 還沒選醫師`);
    }
    if (!course.requiresDoctor && slot.doctorId) {
      out.push(`${at}：${course.name} 不需要指定醫師`);
    }

    if (course.assigns === 'room') {
      if (!slot.roomId) out.push(`${at}：${course.name} 還沒選診間`);
      else {
        const allowed = roomsForCourse(course, rooms);
        if (allowed.length && !allowed.some((r) => r.id === slot.roomId)) {
          out.push(
            `${at}：${course.name} 一般排在 ${allowed.map((r) => r.name).join('、')}，這次排在別間`,
          );
        }
      }
      if (slot.therapistId) out.push(`${at}：${course.name} 不需要指派治療師`);
    }

    if (course.assigns === 'therapist') {
      if (!slot.therapistId) out.push(`${at}：${course.name} 還沒選治療師`);
      if (slot.roomId) out.push(`${at}：${course.name} 不佔診間`);
    }

    if (course.assigns === 'none' && (slot.roomId || slot.therapistId)) {
      out.push(`${at}：${course.name} 不需要診間也不需要治療師`);
    }
  });

  return out;
}

/**
 * 跟她自己當天排的其他人撞在一起。一天壓十幾個人，自撞很常見。
 * 跨同事的衝突看不到，以 Abovee 為準（SPEC 第 4.7 節）。
 *
 * **醫師刻意不比。** 她看不到醫師的班表（那在 Abovee 上），
 * 用看不到的資料去提示只會提示錯 —— ADR-0002 的同一條判準。
 */
function conflictWarnings(visit, { sameDayVisits = [], rooms = [], staff = [] }) {
  const out = [];
  const roomName = (id) => rooms.find((r) => r.id === id)?.name ?? '某診間';
  const staffName = (id) => staff.find((s) => s.id === id)?.name ?? '某治療師';

  for (const [i, slot] of (visit.slots ?? []).entries()) {
    if (!isValidTime(slot.startsAt) || !isValidTime(slot.endsAt)) continue;
    const at = `第 ${i + 1} 個時段`;

    for (const other of sameDayVisits) {
      if (other.id === visit.id || !isActive(other)) continue;

      for (const theirs of other.slots ?? []) {
        if (!isValidTime(theirs.startsAt) || !isValidTime(theirs.endsAt)) continue;
        if (!overlaps(slot, theirs)) continue;

        const sameRoom = slot.roomId && slot.roomId === theirs.roomId
          && (slot.bed ?? null) === (theirs.bed ?? null);
        const sameTherapist = slot.therapistId && slot.therapistId === theirs.therapistId;

        const who = other.customerId === visit.customerId
          ? `${other.customerName ?? '這位客戶'}自己的另一筆來訪`
          : (other.customerName ?? '另一位客戶');

        if (sameRoom) {
          out.push(
            `${at}：${roomName(slot.roomId)}${slot.bed ?? ''} ${theirs.startsAt}–${theirs.endsAt} `
            + `已經排了 ${who}`,
          );
        }
        if (sameTherapist) {
          out.push(
            `${at}：${staffName(slot.therapistId)} ${theirs.startsAt}–${theirs.endsAt} `
            + `已經排了 ${who}`,
          );
        }
      }
    }
  }

  return out;
}

/** 每季一次那種限制。只說「上次是什麼時候、距今幾天」，不換算季度也不阻擋。 */
function frequencyWarnings(visit, { courses = [], entitlements = [], customerVisits = [] }) {
  const out = [];
  const coursesById = byId(courses);
  const entsById = byId(entitlements);
  if (!isValidDate(visit.date)) return out;

  const seen = new Set();

  for (const slot of visit.slots ?? []) {
    const course = coursesById[slot.courseId];
    const ent = entsById[slot.entitlementId];
    const rule = ent?.frequencyRule ?? course?.frequencyRule;
    if (!rule || !course || seen.has(course.id)) continue;
    seen.add(course.id);

    const previous = customerVisits
      .filter((v) => v.id !== visit.id && isActive(v) && isValidDate(v.date) && v.date < visit.date)
      .filter((v) => (v.slots ?? []).some((s) => s.courseId === course.id))
      .sort((a, b) => (a.date < b.date ? 1 : -1))[0];

    if (!previous) continue;
    out.push(
      `${course.name} 有「${rule}」的限制，上次是 ${previous.date}，`
      + `距這次 ${daysBetween(previous.date, visit.date)} 天`,
    );
  }

  return out;
}

// ---------- 計數欄位 ----------

/**
 * 這幾筆來訪動到哪些額度。改一筆來訪時，舊版本與新版本碰到的都要重算。
 * @param {...object} visits
 * @returns {string[]}
 */
export function touchedEntitlementIds(...visits) {
  const ids = new Set();
  for (const visit of visits) {
    for (const slot of visit?.slots ?? []) {
      if (slot.entitlementId) ids.add(slot.entitlementId);
    }
  }
  return [...ids];
}

/**
 * 重算指定額度的計數欄位。計數欄位只能由這裡算出來，
 * 不可以在畫面上手動加減 —— 它跟著來訪的狀態走（SPEC 第 4.2、6.4 節）。
 *
 * @param {string[]} entitlementIds
 * @param {object[]} visits 這位客戶的全部來訪（含要存的那一筆的新版本）
 * @returns {Record<string, {doneCount:number, bookedCount:number}>}
 */
export function recount(entitlementIds, visits) {
  const out = {};
  for (const id of entitlementIds) {
    const c = counts({ totalQty: 0 }, visits, id);
    out[id] = { doneCount: c.done, bookedCount: c.booked };
  }
  return out;
}
