// 來訪的狀態機與送出前的檢查。純函式。
//
// 只有兩種結果：errors 擋下儲存，warnings 顯示在旁邊但存得下去。
// **除了「欄位根本沒填」與「指到一筆不存在的東西」之外，一律是 warnings** ——
// 見 docs/adr/0002-app-records-decisions-it-does-not-make-them.md。
// app 看不到同事在 Abovee 上壓的東西，用不完整的資料去擋一個看得到完整畫面的人，
// 只會擋錯。
//
// 2026-09-06 之前這裡還有一個例外：醫療禁忌。它是全站唯一會擋下儲存的檢查，
// 而 2026-09-06 之後它也變成 warning 了（ADR-0074）——
// **所以現在真的一個業務規則都不擋**。剩下的 errors 全部是「這筆資料寫下去
// 會壞掉」，不是「這件事不該做」。

import { overlaps, isValidTime, toMinutes } from './visitTime.js';
import { equipmentNotices } from './contraindications.js';
import { counts, slotOutcome } from './entitlements.js';
import { isValidDate, daysBetween } from './dates.js';
import { roomsForCourse, picksDoctor, DOCTOR_ROLE } from './masterData.js';
import { slotName } from './naming.js';
import {
  isNthSlot, nthOf, nthLabel, examEntitlementIds, isExamVisit,
  followupsOfExam, secondFollowupIds, MIN_NTH, MAX_NTH,
} from './nthFollowup.js';

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
 * 取消是灰的。日曆上**畫得出來但整列暗掉**（ADR-0061）——
 * 「那天本來有人、後來取消了」是她會想再排一個人進去的訊號。
 * 但它不算進任何一個數字：`summaryByDate()` 與日曆頂端那一行都濾掉它，
 * 而 `agendaFor()` 預設也不收（只有日曆三個檢視傳 `includeCancelled`）。
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


// 改期不是改日期，是取消 + 重新排（SPEC 第 7 節規則 10），所以 cancelled 是終點。
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

// ---------- 同一天再記一段 ----------
//
// 排班的原子單位是「某人某天來一次」（SPEC 第 4.4 節），所以同一天再壓一段
// 是併進既有的那一筆，不是開第二筆。但**併進去的是時段，不是進度** ——
// 那一段她還沒跟客人講過，不能因為那一筆來訪走得比較前面就跟著算數。

/**
 * 這一筆來訪還收不收得下新的時段。
 *
 * 已完成與未到都**收不下**：那一天已經結案了。收下去的話那一段會當場被
 * `slotOutcome()` 算成「做完了」或「沒來」，額度立刻扣一次，而且不會長出
 * 任何一張「簽療程單」——她回頭想改還會撞上「已完成是唯讀鎖定區」
 *（SPEC 第 6.4 節，`isLocked()`）。壓表那一頁的日期選得到今天，
 * 而今天那一筆可能早上就結案了，所以這不是理論上的邊緣狀況。
 *
 * 取消的也收不下，`isActive()` 已經濾掉了 —— 這一支只回答狀態那一半。
 */
export function acceptsMoreSlots(status) {
  return status === 'pending_confirm' || status === 'confirmed';
}

/**
 * 把一段併進同一天已經有的那一筆來訪。
 *
 * **併進一筆已確認的來訪會把整筆退回「等客戶回覆」。** 一筆來訪只有一個狀態，
 * 而她確實還沒跟客人講過新加的這一段 —— 不退回去的話，「跟客人確認時間」
 * 那一列（從 `pending_confirm` 推導的，見 ADR-0001）根本不會出現，
 * 於是那一段的時間從頭到尾沒有人問過客人。
 *
 * 多問一次的代價，遠小於一段沒問過的時間被當成談定了。
 *
 * 已經長出來的登記任務不動：`syncTasksForVisit()` 本來就不會因為狀態往回走
 * 而收掉既有任務（見那一支的檔頭），所以她已經做掉的 Examine 不會被洗掉。
 *
 * @param {object} visit 同一天已經有的那一筆
 * @param {object} slot 要加上去的時段
 * @param {{note?: string|null}} [opts] 「這一次記一句」，沒給就留原本那一句
 * @returns {{visit: object, reopened: boolean}} reopened = 有沒有退回等客戶回覆
 */
export function withExtraSlot(visit, slot, { note } = {}) {
  const reopened = visit.status === 'confirmed';
  return {
    reopened,
    visit: {
      ...visit,
      note: note === undefined ? (visit.note ?? null) : note,
      // **既有那幾段先把自己現在的狀態落下來**（ADR-0081）：整筆退回「待確認」
      // 之後，沒有 `slot.status` 的舊時段會跟著退回去 —— 而她其實已經跟客人
      // 談定那兩段了。落下來之後確認動線只會問新加的這一段。
      slots: [
        ...(visit.slots ?? []).map((s) => ({ ...s, status: slotStatus(visit, s) ?? visit.status })),
        // 新加的這一段還沒問過客人 —— 整筆退回「待確認」就是這樣推出來的
        { ...slot, status: slot?.status ?? INITIAL_STATUS },
      ],
      ...(reopened
        // confirmedAt 一起清掉 —— 留著的話詳情頁會寫「客戶已確認」的時間戳，
        // 而那一筆現在是待確認的。
        ? { status: INITIAL_STATUS, confirmedAt: null, statusAt: new Date().toISOString() }
        : {}),
    },
  };
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
 * 這一筆來訪那天做什麼，講成一句話。
 *
 * 同一個名字只印一次 —— 那天做兩節 SIS 就是「SIS」，不是「SIS、SIS」。
 *
 * ## 帶主檔就講顯示名稱（2026-09-08）
 *
 * 這一支以前一律讀 `slot.courseName`，而 `CLAUDE.md` 寫著那一格是
 * **快照不是顯示名稱** —— 症狀是同一筆來訪在客戶詳情那一列寫「復能」、
 * 在日曆上寫「SIS(60)」，而她會以為那是兩筆。ADR-0078 的後果那一節記過
 * 這條分岔，這裡把它收掉：**呼叫端手上有主檔就傳進來**，走的是跟日曆
 * 同一支 `slotName()`。
 *
 * **沒帶就退回快照**，所以既有呼叫端一個字都不用改。稽核紀錄刻意不帶
 *（`domain/audit.js`）：那一份記的是**當時寫下去的字**，主檔之後改名，
 * 歷史紀錄不該跟著變。
 *
 * **一個時段都認不出來時退回「N 段」**，不要回空字串：她在「跟客人確認時間」
 * 那一排丸子上看到空白，會以為那顆丸子壞了。
 *
 * @param {object} visit
 * @param {{courses?:object[], equipment?:object[]}|null} [master]
 */
export function visitCourseLabel(visit, master = null) {
  const slots = visit?.slots ?? [];
  const names = [...new Set(
    slots.map((s) => (master ? slotName(s, master, 'short') : s.courseName)).filter(Boolean),
  )];
  return names.join('、') || `${slots.length} 段`;
}

/**
 * 讀取卡片要畫哪幾段。
 *
 * 她 2026-09-08：
 *
 * > 我在日曆點開詳情的時候，為甚麼我點的是復能(INDIBA)，
 * > 但是卻會一次呈現三個復能(INDIBA)、復能(超磁場)、靜脈(IL)？
 *
 * 排班的原子單位是**來訪**（SPEC 第 4.4 節）：同一位客戶同一天壓第二次，
 * 壓表那一頁會併進同一筆來訪。所以她眼裡的「三筆」在資料庫上是
 * 一筆來訪、三個時段，而讀取卡片一直是把整筆畫出來的。
 *
 * 日／週檢視那一份清單**是一段一列**的（`domain/calendar.js` 的 `agendaFor()`
 * 一路算出了 `slotIndex`），只是畫成按鈕的那一下把它丟掉了。這一支就是把
 * 那個 index 接回來的地方。
 *
 * ## 為什麼是一支 domain 而不是在畫面上判斷
 *
 * `visitReadHtml()` 是**四個畫面共用**的（ADR-0018、0056），而另外三頁
 * （客戶詳情、待辦中心、進度追蹤）列的本來就是整筆來訪 —— 它們是對的，
 * 不可以跟著變。所以「畫哪幾段」是一條規則，規則寫在 domain。
 *
 * ## 兩條刻意的退路
 *
 * 1. **沒指定就是全部。** `undefined` 是「沒有人告訴我是哪一段」，
 *    不是「第 0 段」—— 另外三頁一個字都不用改。
 * 2. **指到一個不存在的段落也退回全部。** 畫成空白的話她會以為那一筆壞了，
 *    而畫太多只是回到修好之前的樣子。兩種錯法的代價差很多。
 *
 * @param {{slots?: object[]}|null} visit
 * @param {number|null} [focusSlot] 要單獨看的那一段，從 0 起算
 * @returns {{slots: {slot: object, index: number}[], hidden: number, focused: boolean}}
 *   `hidden` 是「這一天還有幾段沒畫」，呼叫端拿它畫那一行「還有另外 N 段」。
 */
export function slotsToShow(visit, focusSlot = null) {
  const all = (visit?.slots ?? []).map((slot, index) => ({ slot, index }));
  const every = { slots: all, hidden: 0, focused: false };

  // `Number.isInteger()` 一次擋掉 null、undefined、NaN、'1' 與 1.5
  if (!Number.isInteger(focusSlot)) return every;
  const one = all[focusSlot];
  if (!one) return every;

  return { slots: [one], hidden: all.length - 1, focused: true };
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
  if (!visit || visit.deletedAt) return null;

  // **整筆取消蓋過時段上還沒定案的那一格。** 2026-09-08 之前的 app 只寫整筆，
  // 而一格停在 `confirmed` 的舊時段不可以推翻它 —— 那一段會一直佔著次數。
  // 刪掉與取消是同一種「什麼都沒發生」，所以兩條擺在一起。
  if (visit.status === 'cancelled') return 'cancelled';

  // 時段自己說了算（ADR-0081）。認不得的值當成沒寫過 —— 退回舊的推法
  // 比吐一個沒有人認得的狀態好。
  const own = slot?.status ?? null;
  if (own && VISIT_STATUSES.includes(own)) return own;

  // 舊資料：從整筆推。**這一段跟 2026-09-08 之前一模一樣**，
  // 所以那幾百筆來訪一個字都不用改。
  const outcome = slotOutcome(visit, slot);
  if (outcome === 'done' || outcome === 'no_show') return outcome;
  return visit.status ?? null;
}

/**
 * 整筆的狀態是**從時段推出來的**（ADR-0081）。
 *
 * 她 2026-09-08：「本來就應該可以只取消某一段或是可以一起取消整天啊？」
 * 排班的原子單位因此下移到時段，來訪退化成「那一天的容器」。
 *
 * **推出來的值照樣存進文件**，因為有四個地方讀 `visit.status` 而它們都不該
 * 為這件事動：`firestore.indexes.json` 的複合索引、`firestore.rules` 的
 * `validVisit()`、試算表報表、備份還原。存一份推導出來的值是刻意的重複，
 * 資料健檢有一列盯著它有沒有對不起來。
 *
 * 由「還沒定案」往「定案」比，**第一個對上的算數** —— 順序就是她做事的順序
 * （同 `dayReview.js` 的 `STAGES`）：
 *
 *   1  全部取消              → cancelled
 *   2  有一段還沒問過客人    → pending_confirm
 *   3  有一段談定了          → confirmed
 *   4  有一段做了            → done
 *   5  其餘                  → no_show
 *
 * 第 4、5 條把 `closeVisit()` 那句「一段都沒做就是整筆未到」原封不動接了過來。
 *
 * **舊資料上是冪等的**：沒有 `slot.status` 的來訪，每一段都退回整筆那一個，
 * 所以推出來的還是它自己。一段都沒有時也維持原本那一個 —— 吐 `null` 的話
 * 呼叫端會寫一個沒有狀態的來訪進去，而 Rules 會擋下來（畫面上看不出為什麼）。
 */
export function visitStatusFrom(visit) {
  const slots = visit?.slots ?? [];
  if (!slots.length) return visit?.status ?? null;

  const each = slots.map((slot) => slotStatus(visit, slot));
  if (each.every((x) => x === 'cancelled')) return 'cancelled';
  if (each.includes('pending_confirm')) return 'pending_confirm';
  if (each.includes('confirmed')) return 'confirmed';
  if (each.includes('done')) return 'done';
  if (each.includes('no_show')) return 'no_show';
  return visit?.status ?? null;
}

/**
 * 一段蓋上新的狀態。整筆改狀態時**已經取消掉的那一段不會被救回來** ——
 * 取消是定案，而她按的「客戶說可以」講的是還在談的那幾段。
 */
function stampSlot(slot, to) {
  if (to !== 'cancelled' && slot?.status === 'cancelled') return slot;
  return { ...slot, status: to };
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
 * 客人說「可以」之後，最後成立的是哪幾段。
 *
 * 她按下「確認 N 段，加進日曆」的那一刻是這條動線唯一一次不可逆的寫入
 *（狀態轉 confirmed、登記任務長出來），而她剛剛才逐段點掉了其中幾段 ——
 * 畫面要把「最後成立的是哪幾段」講出來，不能只丟一句「已排進日曆」。
 *
 * 這裡只回事實（誰、哪一天、幾點、做什麼、退掉幾段），排版是畫面的事。
 *
 * @param {object[]} visits 這位客戶還在等回覆的那幾筆
 * @param {Set<string>} rejected 被退掉的那幾段，key 是 `${visit.id}:${索引}`
 * @returns {{name: string, rows: {date:string, slot:object}[], rejected: number}}
 */
export function describeConfirmed(visits = [], rejected = new Set()) {
  const rows = [];
  let dropped = 0;

  for (const v of visits ?? []) {
    (v.slots ?? []).forEach((slot, i) => {
      if (rejected.has(`${v.id}:${i}`)) {
        dropped += 1;
        return;
      }
      rows.push({ date: v.date, slot });
    });
  }

  rows.sort((a, b) => String(a.date).localeCompare(String(b.date))
    || String(a.slot.startsAt ?? '').localeCompare(String(b.slot.startsAt ?? '')));

  return {
    name: (visits ?? []).find((v) => v.customerName)?.customerName ?? '',
    rows,
    rejected: dropped,
  };
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
  const slots = (visit?.slots ?? []).map((slot, i) => {
    // **取消掉的那一段不參與收尾** —— 那天它本來就不會發生（ADR-0081）。
    // 蓋過去的話它會被算成「沒來」，而未到是會被她看到的一個數字。
    if (slot?.status === 'cancelled') return slot;
    const did = attended[i] ?? true;
    // 兩個欄位一起寫：`attended` 是 ADR-0025 的，既有資料與對帳讀它；
    // `status` 是 ADR-0081 的。少寫一邊就會有一個畫面講另一句話。
    return { ...slot, attended: did, status: did ? 'done' : 'no_show' };
  });

  const live = slots.filter((s) => s?.status !== 'cancelled');
  // 每一段都先取消掉了才走到這裡：那一天就是取消，不是未到
  if (!live.length) return { ...visit, slots, status: 'cancelled', statusAt: at };

  const anyAttended = live.some((s) => s.attended);

  return {
    ...visit,
    slots,
    status: anyAttended ? 'done' : 'no_show',
    statusAt: at,
  };
}

// ---------- 換一個狀態 ----------

/**
 * 換一個狀態之後那一筆來訪長什麼樣。**只算，不寫。**
 *
 * 來訪編輯器的狀態卡與日曆的快捷選單（ADR-0060）共用這一支 ——
 * 兩邊各寫一次的話，遲早有一邊忘了補 `cancelledAt`，
 * 而那一筆從此在稽核紀錄裡看不出是什麼時候取消的。
 *
 * 收尾（`done` / `no_show`）走 `closeVisit()`，**整筆一起標** ——
 * 每一段都給同一個結果。要逐段分開記（客人做了兩段就走）走待辦中心的
 * 「簽療程單」那一頁，那裡才問得出「哪一段沒做」（ADR-0025）。
 *
 * @param {object} visit
 * @param {string} to 要換成哪一個狀態
 * @param {{at?: string, reason?: string|null}} [o] reason 只有取消才用得到
 * @returns {object} 新的那一筆（原本那一份一個字都不動）
 */
export function applyStatus(
  visit, to, { at = new Date().toISOString(), reason = null, slotIndex = null } = {},
) {
  const slots = visit?.slots ?? [];

  // ---------- 只動一段（ADR-0081） ----------
  //
  // 她 2026-09-08：「僅能取消被選中的該筆時段來訪，嚴禁一次連帶將該客戶
  // 當天的所有時段預約全部取消！」
  //
  // **指到一個不存在的段落什麼都不做。** 退回去改整筆是最壞的一種答案 ——
  // 她按的是一列，而那一下會取消掉整天。同 `slotsToShow()` 的判斷：
  // 兩種錯法的代價差很多。
  if (Number.isInteger(slotIndex)) {
    if (!slots[slotIndex]) return visit;
    return settle(
      { ...visit, slots: slots.map((s, i) => (i === slotIndex ? { ...s, status: to } : s)) },
      { at, reason },
    );
  }

  // ---------- 一整天 ----------
  let next = to === 'done' || to === 'no_show'
    ? closeVisit(visit, slots.map(() => to === 'done'), at)
    : { ...visit, slots: slots.map((s) => stampSlot(s, to)), status: to, statusAt: at };

  if (to === 'confirmed') next = { ...next, confirmedAt: at };
  if (to === 'cancelled') {
    next = { ...next, cancelledAt: at, cancelReason: reason, released: false };
  }
  return next;
}

/**
 * 時段改過之後，整筆的狀態重推一次。
 *
 * **沒變就不要蓋時間戳**：三段取消掉第一段時整筆還是「已確認」，
 * 而那一刻沒有任何狀態轉換發生 —— 蓋上去的話稽核紀錄會多一筆
 * 「狀態從已確認改成已確認」，而她在找的是真正變過的那幾次。
 */
function settle(visit, { at, reason = null }) {
  const derived = visitStatusFrom(visit) ?? visit.status ?? null;
  if (derived === visit.status) return visit;

  const next = { ...visit, status: derived, statusAt: at };
  if (derived === 'confirmed') next.confirmedAt = at;
  if (derived === 'cancelled') {
    next.cancelledAt = at;
    next.cancelReason = reason;
    next.released = false;
  }
  return next;
}

/**
 * 長按一筆來訪，快捷選單上有哪幾顆（ADR-0060）。
 *
 * 狀態那幾顆**直接借 `nextStatuses()`**，不要在畫面上另外列一份 ——
 * 兩份遲早會有一份准了一個 `TRANSITIONS` 不准的轉移，而 Rules 不擋狀態機
 * （ADR-0006），所以那一下會真的寫進去。
 *
 * **「已完成」與「未到」不放進來。** 那兩個是**逐段**的結果
 * （`slotOutcome()`，ADR-0025），整筆一起標會把「客人做了兩段就走」記錯 ——
 * 而次數就是跟著它扣的。所以日子到了的那幾筆給的是一顆「去簽療程單」，
 * 通到待辦中心那張逐段的抽屜。
 *
 * 順序就是畫面上的順序：**最常按的在最上面**，破壞性的在最下面。
 * 最多五顆（加上選單自己的「先不要」剛好六顆，`openActions()` 的上限）。
 *
 * @param {object} visit
 * @param {{today: string}} o
 * @returns {{id:string, label:string, icon?:string, tone?:string}[]}
 */
export function visitActions(visit, { today } = {}) {
  const next = nextStatuses(visit?.status);
  const out = [];

  if (next.includes('confirmed')) {
    out.push({
      id: 'confirmed',
      label: '客戶說可以',
      note: `改成「${describeStatus('confirmed')}」`,
      icon: 'check',
      tone: 'primary',
    });
  }

  // 日子到了才有。還沒到的那一筆點進去只會看到一張空的收尾抽屜
  // （`visitsToClose()` 撈的是 `date <= today`）。
  if (today && typeof visit?.date === 'string' && visit.date <= today
      && (visit.status === 'pending_confirm' || visit.status === 'confirmed')) {
    out.push({
      id: 'close',
      label: '客人來了，去簽療程單',
      note: '逐段勾，次數在那裡才扣',
      icon: 'todo',
    });
  }

  if (!isLocked(visit?.status) && visit?.status !== 'cancelled') {
    out.push({ id: 'edit', label: '改這一筆', icon: 'pencil' });
  }

  if (next.includes('cancelled')) {
    out.push({ id: 'cancelled', label: '取消這一筆', icon: 'close', tone: 'danger' });
  }

  return out;
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
export function coursesForEntitlement(entitlement, courses = [], equipment = []) {
  const alive = courses.filter((c) => !c.deletedAt);
  if (entitlement?.type !== 'pool') return alive.filter((c) => c.id === entitlement?.courseId);

  // 池裡每一台器材各自指到的課程，去重、維持池上的順序（ADR-0075）。
  // 復能四選一 → 復能與 ILIB 兩個；三選一與單台 → 復能一個。
  const ids = entitlement.optionEquipmentIds ?? [];
  const seen = new Set();
  const out = [];
  for (const id of ids) {
    const courseId = (equipment ?? []).find((e) => e.id === id)?.courseId ?? null;
    if (!courseId || seen.has(courseId)) continue;
    const course = alive.find((c) => c.id === courseId);
    if (course) { seen.add(courseId); out.push(course); }
  }
  // 一台都推不出課程就退回舊行為（ADR-0005）—— 舊資料的器材身上沒有
  // `courseId`，而那時候「擇一池的課程」就是唯一那個要選器材的課程。
  if (!out.length) return alive.filter((c) => c.requiresEquipment);

  // **「家」排第一**（2026-09-08）。呼叫端拿 `[0]` 當「她還沒挑器材時的預設」，
  // 而上面那一圈的順序來自 `optionEquipmentIds`，也就是主檔讀回來的順序 ——
  // `data/repo.js` 的 `list()` 沒有 orderBy，Firestore 回的是文件 id 升冪，
  // 於是 `eq-ilib` 剛好排在最前面。結果是四選一的預設課程變成 ILIB（要診間），
  // 她還沒選器材，畫面就已經替她答了一個錯的（她 2026-09-08 回報的那件事）。
  //
  // 判準是 `requiresEquipment` 而不是名字：擇一池的「家」就是那個要選器材的
  // 課程，跟 `buy.js` 的 `poolCourseOf()` 問的是同一句話。
  // **池裡根本沒有它的時候不要硬塞**（單買 ILIB 的池就是 ILIB）。
  const homeAt = out.findIndex((c) => c.requiresEquipment);
  if (homeAt > 0) out.unshift(...out.splice(homeAt, 1));
  return out;
}

/**
 * 這一段要不要記器材。
 *
 * **擇一池一定要**，不管從器材推出來的課程是哪一個 —— 四選一選到 ILIB 那一段，
 * 課程變成 ILIB（`requiresEquipment` 是 false），但那一段記的仍然是「用了 ILIB」，
 * 而額度的池成員檢查靠的就是那個 id。只看課程的話，她一選 ILIB 器材那一排
 * 就整個消失，存下去也少了一個欄位。
 *
 * 其餘看課程（目前只有復能開著 `requiresEquipment`）。
 */
export const picksEquipment = (entitlement, course) =>
  entitlement?.type === 'pool' || Boolean(course?.requiresEquipment);

/**
 * 這一段在畫面上要不要印診間。
 *
 * 她 2026-09-08 把健檢、體適能、身體組成、營養諮詢、門診與二返六個課程改成
 * 「都不用」（ADR-0079），而那一題的答案裡寫著：
 *
 * > 既有來訪身上的 `roomId` 留著不動、**畫面上不畫**
 *
 * 資料一個字都不動是刻意的（改既有的幾百筆是一次沒有人按過的寫入），
 * 所以「不畫」這件事只能發生在畫的時候 —— 也就是這一支。
 *
 * ## 它跟 `assignsFor()` 問的不是同一句話
 *
 * `assignsFor()` 是**壓表當下**的問題：「現在要請她挑治療師還是治療室？」
 * 所以擇一池還沒挑器材時它回 `null`。這一支是**畫已經存下去的那一段**：
 * 課程早就定了（`courseForEquipment()` 在存檔那一刻就跑過），所以只問課程。
 *
 * **認不出課程就照印。** 匯進來的舊來訪（ADR-0011）與被刪掉的課程都走這一條
 * —— 少印一個診間比多印一個糟：她會以為那一筆的資料掉了。
 *
 * @param {{courseId?:string, roomId?:string}|null} slot
 * @param {object[]} courses 課程主檔（含已刪除的，呼叫端本來就是這樣讀）
 */
export function showsRoom(slot, courses = []) {
  if (!slot?.roomId) return false;
  const course = (courses ?? []).find((c) => c.id === slot.courseId) ?? null;
  return course ? course.assigns === 'room' : true;
}

/**
 * 這一段**現在**要指派什麼。`null` = 還答不出來。
 *
 * 她 2026-09-08：
 *
 * > 三選一 / 四選一器材動態連動：當器材選擇 INDIBA、SIS 或 高能量雷射 時
 * > → 必須且只能選擇「物理治療師」。當四選一器材選擇 ILIB 時 → 「治療室」。
 *
 * 指派是**課程說了算**，而擇一池的課程是選到的那一台器材推出來的（ADR-0075）。
 * 所以在她挑器材之前，這個問題**沒有答案** —— 而現在的畫面會照著預設課程
 * 畫一排出來，等於替她答了一個她還沒回答的問題。
 *
 * 回 `null` 的時候呼叫端該做的是「先說一句話，兩排都不畫」，
 * 不是挑一個預設值：挑一個就回到這個 bug 本身。
 *
 * **不用選器材的課程一開始就答得出來**（單買 ILIB 的 single 額度、二返、
 * n返），所以那一道門要問 `picksEquipment()` 而不是「是不是池」。
 *
 * 兩個入口共用（壓表、來訪編輯器）—— 各判斷一次的話，會出現「畫面上要她選
 * 治療師、存進去的卻是一段要診間的 ILIB」。
 *
 * @param {object|null} entitlement 這一段扣的那一筆
 * @param {object|null} course 已經由 `courseForEquipment()` 推好的那一個
 * @param {string|null} equipmentId 她挑了哪一台
 * @returns {'therapist'|'room'|'none'|null}
 */
export function assignsFor(entitlement, course, equipmentId) {
  if (picksEquipment(entitlement, course) && !equipmentId) return null;
  return course?.assigns ?? 'none';
}

/**
 * 這一段選了這台器材，那它算哪一個課程。
 *
 * **只有這一支做這個推導**（ADR-0075）。壓表與來訪編輯器兩個入口都呼叫它，
 * 兩邊各寫一次的話會出現一邊寫「復能」一邊寫「ILIB」的資料，
 * 而那要等到她看試算表才會發現。
 *
 * 推不出來時**維持原來的課程**，不要回 `null` —— 那會把時段上的 courseId
 * 清掉，而沒有課程的時段存不下去。
 *
 * @param {string|null} equipmentId
 * @param {object[]} equipment 器材主檔
 * @param {string|null} fallbackCourseId 推不出來時維持的那一個
 * @returns {string|null}
 */
export function courseForEquipment(equipmentId, equipment = [], fallbackCourseId = null) {
  if (!equipmentId) return fallbackCourseId;
  const eq = (equipment ?? []).find((e) => e.id === equipmentId) ?? null;
  return eq?.courseId ?? fallbackCourseId;
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
  customerVisits = [],
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

  // 哪幾筆額度是健檢。n返 指到的那一筆來訪要靠它驗（判斷跟
  // `domain/followups.js` 走同一條路：課程主檔上設了 followupCourseId 的）。
  const examIds = examEntitlementIds(entitlements, coursesById);

  slots.forEach((slot, i) => {
    const at = `第 ${i + 1} 個時段`;

    const ent = entsById[slot.entitlementId];

    // **n返 排不進任何額度**（`domain/nthFollowup.js` 的檔頭）：它沒有被買、
    // 沒有次數、扣不掉。所以這一段不要求額度 —— 但它多要求兩件事，底下驗。
    //
    // 反過來也要擋：帶著 `followupNth` **又**指了一筆額度，那一段會同時
    // 被算進那筆額度的次數、又被畫成一場 n返。兩種身分只能挑一種。
    const nth = isNthSlot(slot);
    if (!slot.entitlementId) {
      if (!nth) errors.push(`${at}：要選一個額度`);
    } else if (nth) {
      errors.push(`${at}：n返 不扣任何次數，不可以同時指定額度`);
    } else if (!ent) {
      errors.push(`${at}：指定的額度不存在或已刪除`);
    }

    // 返數本身。`isNthSlot()` 看的是「填過沒」，`nthOf()` 看的是「合不合法」——
    // 分開問才講得出真正錯的是什麼（填了 33 的時候不要抱怨「要選一個額度」）。
    if (nth && nthOf(slot) == null) {
      errors.push(
        `${at}：返數要是 ${MIN_NTH} 到 ${MAX_NTH} 之間的整數 —— 二返走額度那條路，不是這裡`,
      );
    }

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

    // **問的是「這一段要不要記器材」，不是「課程要不要」**（2026-09-08）。
    // 四選一那一筆池選到 ILIB 時課程會換成 ILIB，而它的 `requiresEquipment`
    // 是 false —— 只看課程的話，一段扣著四選一、卻沒有器材的來訪存得進去。
    // 那一筆之後在月檢視與試算表上都印不出是哪一台，額度的池成員檢查
    // 也沒有 id 可以比。閘門只有一個：`picksEquipment()`（ADR-0075）。
    //
    // 訊息裡寫**額度**不寫課程：「ILIB 每次都要記錄器材」是一句她看不懂的話，
    // 而她剛剛按的那一顆丸子上寫的就是額度的名字。
    if (!imported && picksEquipment(ent, course) && !slot.equipmentId) {
      const what = ent?.label ?? course?.name ?? '這一段';
      errors.push(`${at}：${what} 每次都要記錄用了哪一種器材`);
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

    // 「這一段二返接在哪一次健檢後面」。**沒選是 warning 不是 error**
    // （見 assignmentWarnings）—— 舊資料一筆都沒有這個欄位，擋下來等於
    // 她連改一個時間都存不回去。但指到一筆對不上的健檢是資料壞了，那要擋。
    if (slot.followupForVisitId) {
      const exam = (customerVisits ?? []).find((v) => v.id === slot.followupForVisitId) ?? null;
      if (!exam) errors.push(`${at}：指定的健檢來訪不存在`);
      // 指到的那一筆要真的用掉這一段二返所配的那筆健檢額度 —— 不然
      // 試算表會把二返註記寫到一個不相干的日期底下。
      else if (ent?.followupForEntitlementId
          && !(exam.slots ?? []).some((x) => x.entitlementId === ent.followupForEntitlementId)) {
        errors.push(`${at}：指定的那一筆來訪裡沒有「${ent.label}」對應的健檢`);
      }
      // n返 沒有額度可以比，所以改問「那一筆是不是一次已完成的健檢」。
      // 沒做完的健檢沒有報告可以再聽一次（同二返的 `examChoicesFor()`）。
      else if (nth && !(exam.status === 'done' && isExamVisit(exam, examIds))) {
        errors.push(`${at}：指定的那一筆不是一次已完成的健檢`);
      }
    } else if (nth) {
      // **n返 的這一格是必填，二返只是 warning。** 兩者的理由不一樣：
      // 二返有一整批舊資料身上沒有這個欄位（ADR-0011 的同一條原則），
      // 擋下來她連改一個時間都存不回去；n返 是全新的，一筆舊資料都沒有，
      // 而且沒有那個連結它在試算表上根本沒有位置可以印。
      errors.push(`${at}：${nthLabel(nthOf(slot)) ?? 'n返'} 一定要指定是哪一次健檢的`);
    }
  });

  return errors;
}

function visitWarnings(visit, ctx) {
  return [
    ...equipmentNoticeWarnings(visit, ctx),
    ...overlapWarnings(visit),
    ...entitlementWarnings(visit, ctx),
    ...assignmentWarnings(visit, ctx),
    ...nthWarnings(visit, ctx),
    ...conflictWarnings(visit, ctx),
    ...frequencyWarnings(visit, ctx),
  ];
}

/**
 * 選到的那一台對這位客戶要提醒。
 *
 * **排在 warnings 的最前面**：其餘幾種（時間重疊、診間撞、次數不夠）都是
 * 她自己看得出來的排班問題，這一種是客戶身上的事，而她壓表那一刻要把它抄進
 * Abovee 的註記欄。
 *
 * 2026-09-06 之前這一段是 error（`visitErrors()` 的最後一圈）——
 * 她那天說「只要儀器不要在金屬的上方或附近」就做得了，而那件事 app 看不到。
 * 見 ADR-0074。
 */
function equipmentNoticeWarnings(visit, { customer, equipment = [] }) {
  const equipById = byId(equipment);
  return equipmentNotices(customer, visit.slots ?? [], equipById)
    .map((n) => `第 ${n.slotIndex + 1} 個時段：${n.message}`);
}

/**
 * 同一次健檢底下已經有一場同樣的返數了。
 *
 * **只提醒不擋**（ADR-0002：app 記錄決定，不做決定）—— 改期就是取消再排一筆，
 * 那兩筆會同時存在一下下；她也可能真的要在同一次健檢底下約兩場三返
 * （客人第一場沒來，重約一場）。擋下來的話她會卡在一個存不進去的畫面上。
 */
function nthWarnings(visit, { entitlements = [], customerVisits = [] }) {
  const out = [];
  const second = secondFollowupIds(entitlements);
  const others = (customerVisits ?? []).filter((v) => v.id !== visit.id);

  (visit.slots ?? []).forEach((slot, i) => {
    const nth = nthOf(slot);
    if (!nth || !slot.followupForVisitId) return;

    const same = followupsOfExam(slot.followupForVisitId, others, second)
      .filter((f) => f.nth === nth);
    if (same.length) {
      out.push(`第 ${i + 1} 個時段：這一次健檢的${nthLabel(nth)}已經約在 ${same[0].visit.date} 了`);
    }
  });

  return out;
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
function assignmentWarnings(visit, {
  courses = [], rooms = [], entitlements = [], ivProducts = [],
}) {
  const out = [];
  const coursesById = byId(courses);
  const entsById = byId(entitlements);
  const ivById = byId(ivProducts);

  (visit.slots ?? []).forEach((slot, i) => {
    const course = coursesById[slot.courseId];
    if (!course) return;
    const at = `第 ${i + 1} 個時段`;

    // 二返沒指到健檢。**只提醒不擋** —— 舊資料一筆都沒有這個欄位（ADR-0011 的
    // 同一條原則），而且她可能就是還沒決定要接哪一次。
    // 「這一段是二返嗎」看額度上的 `followupForEntitlementId`，不看課程名字。
    if (entsById[slot.entitlementId]?.followupForEntitlementId && !slot.followupForVisitId) {
      out.push(`${at}：${course.name} 還沒指定是哪一次健檢的`);
    }

    // 哪些課程選得到醫師只寫在 `masterData.js` 的 `picksDoctor()`（A 類一律選得到，
    // 其餘看課程上的旗標）。這裡不自己比對類別 —— 兩份判斷遲早會分岔，
    // 而症狀是「壓表選得到、來訪編輯器說不需要」。
    //
    // 兩句都是 warning 不是 error：她說「不用強制要選」，而醫師常常是當天才定的。
    if (picksDoctor(course) && !slot.doctorId) {
      out.push(`${at}：${course.name} 還沒選醫師`);
    }
    if (!picksDoctor(course) && slot.doctorId) {
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

    // 排的品項不是她買的那一款。2026-09-04 她問的：「我營養點滴如果一開始
    // 加購的是 A，但是我排來訪的時候，選營養點滴還能排到其他 BCD？」
    //
    // **只提醒不擋**（她 2026-09-04 選的）。硬擋的話「今天 A 剛好用完，
    // 先打了 B」這一筆永遠記不進系統。2026-09-06 之後**整個 app 都沒有硬性
    // 阻擋了**（ADR-0074），所以這一條不再是唯一的例外，是常態。
    //
    // 額度上沒有 ivProductId 的不比：舊資料與匯入進來的來訪都沒有這個欄位。
    // n返 也不比 —— 它沒有額度（`entitlementId` 是 null）。
    const bought = entsById[slot.entitlementId]?.ivProductId ?? null;
    if (bought && slot.ivProductId && slot.ivProductId !== bought) {
      const name = ivById[bought]?.name ?? '（已刪除的品項）';
      out.push(`${at}：這一段的品項跟買的不一樣（買的是 ${name}）`);
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
