// 日曆。SPEC 第 8.6 節。純函式。
//
// 這一頁取代 TimeTree（SPEC 第 4.9 節），所以它要回答的是「那天到底發生什麼事」，
// 不是「這個月排得漂不漂亮」。三種檢視同一份資料，差別只在範圍：
//
//   日 —— 一整天的時段照時間排開，撞在一起的標出來
//   週 —— 七天各自的摘要，手機用（一週是她真正在規劃的單位）
//   月 —— 整月的密度，只在 iPad 橫式出現（手機上一格 9px 看不清）
//
// 這裡不判斷任何事，只把來訪攤平成「某天某個時間有誰」。
// 衝突用 visitTime.js 的 overlaps()，不另外寫一套 —— 來訪編輯器與資料健檢
// 講的是同一件事，三個地方各算一次遲早會不一致。

import { addDays, addMonths, isValidDate, lastDayOf, shortDate, weekdayOf, weekdayLabel } from './dates.js';
import { overlaps, toMinutes, isValidTime, timeLabel } from './visitTime.js';
import { slotName, nameOf } from './naming.js';
import { isActive, statusClass, showsRoom, slotStatus, slotNoteOf } from './visits.js';

export const VIEWS = ['day', 'week', 'month'];

export const VIEW_LABELS = { day: '日', week: '週', month: '月' };

/**
 * 一週從**禮拜一**開始。
 *
 * 2026-08-25 以前這裡是週日起算，而她自己記時間的那一頁（`views/availability.js`）
 * 與客戶填的表單（`js/form/page.js`）是週一起算 —— 同一個產品裡兩種排法，
 * 而且那兩支的註解都寫著「跟她的日曆一樣」，那句話是假的。
 * 她選的是全部改成週一（`.scratch/asks-2026-08-25/issues/12`）。
 *
 * 週一起算本身也比較貼近她講話的方式（「禮拜一三下午」從一數起），
 * 而且月曆上週六與週日並排在同一側，一眼看得出哪幾天是週末。
 */
export function weekStart(date) {
  // (weekday + 6) % 7：週日是 0，往回退 6 天才回到那一週的禮拜一。
  return isValidDate(date) ? addDays(date, -((weekdayOf(date) + 6) % 7)) : null;
}

/** 某一天所在那一週的七天。 */
export function weekDays(date) {
  const start = weekStart(date);
  return start ? Array.from({ length: 7 }, (_, i) => addDays(start, i)) : [];
}

/**
 * 整個月的格子，補滿前後兩端的鄰月日期。
 *
 * 前後補的日子照樣顯示 —— 月初月底的來訪常常跨月，把它們留白會讓她以為那幾天沒事。
 *
 * @returns {{date:string, inMonth:boolean}[][]} 每一列是一週
 */
export function monthWeeks(month) {
  const [y, m] = String(month ?? '').split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return [];

  const pad = (n) => String(n).padStart(2, '0');
  const first = `${y}-${pad(m)}-01`;
  const last = `${y}-${pad(m)}-${pad(lastDayOf(y, m))}`;

  const weeks = [];
  for (let cursor = weekStart(first); cursor <= last; cursor = addDays(cursor, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(cursor, i);
        return { date, inMonth: date >= first && date <= last };
      }),
    );
  }
  return weeks;
}

/** 這個檢視要讀哪一段資料。日曆一次只讀畫得出來的範圍。 */
export function rangeOf(view, date) {
  if (!isValidDate(date)) return null;
  if (view === 'day') return { from: date, to: date };
  if (view === 'week') {
    const days = weekDays(date);
    return { from: days[0], to: days[6] };
  }
  const weeks = monthWeeks(date.slice(0, 7));
  return weeks.length ? { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date } : null;
}

/** 上一頁／下一頁。日是一天、週是七天、月是一個月。 */
export function moveBy(view, date, steps) {
  if (!isValidDate(date)) return date;
  if (view === 'day') return addDays(date, steps);
  if (view === 'week') return addDays(date, steps * 7);
  return addMonths(date, steps);
}

/**
 * 一週算哪個月的第幾週：**那一週有四天以上落在哪個月就算哪個月**。
 *
 * 她 2026-09-13：「週也是，可以寫第幾週這樣就不會變...或是9月w1 w2 w3 w4 等等」，
 * 跨月那一週（8/31–9/6）怎麼算她同意這一條。一週從禮拜一開始（`weekStart()`），
 * 所以「四天以上」就是**週四落在哪個月** —— 第幾週也就是那個月的第幾個週四。
 *
 * @param {string} date 那一週裡的任何一天
 * @returns {{year:number, month:number, n:number}|null}
 */
export function weekOfMonth(date) {
  const start = weekStart(date);
  if (!start) return null;
  const thursday = addDays(start, 3);
  const [year, month, day] = thursday.split('-').map(Number);
  return { year, month, n: Math.ceil(day / 7) };
}

/**
 * 標頭那一行字。
 *
 * 她 2026-09-13：「光是2026年就會占掉手機版的版面導致後面都會變...，就不知道到底是哪一月」。
 * 375 寬時「2026 年 8 月」剛好塞滿 119px，10–12 月就被截；週標題「8/24(一) – 8/30(日)」
 * 在 375 與 414 都被截成「8/24(一) –…」。
 *
 * | 檢視 | 寫法 | 例 |
 * |---|---|---|
 * | 月 | 月份；**不是今年才寫年份** | `9月`、`2027年1月` |
 * | 週 | 那一週歸屬的月份＋第幾週（`weekOfMonth()`） | `9月 W2` |
 * | 日 | 日期 | `9/18(五)` |
 *
 * 不是今年才寫年份：從 12 月滑到 1 月時分得出來，而平常一個字都不佔。
 * **「今年」由呼叫端傳**（純函式才測得了）；沒傳就當作跟那一天同一年 ——
 * 憑空多出一個年份比少一個糟。
 *
 * 週那一段的起訖日期不在標題上 —— 底下每一天的抬頭寫著 `9/7`（issue 09）。
 */
export function titleOf(view, date, today = null) {
  if (!isValidDate(date)) return '';
  if (view === 'day') return shortDate(date);

  const thisYear = isValidDate(today) ? Number(today.slice(0, 4)) : null;
  const label = (year, month) => (thisYear == null || year === thisYear ? `${month}月` : `${year}年${month}月`);

  if (view === 'week') {
    const w = weekOfMonth(date);
    return `${label(w.year, w.month)} W${w.n}`;
  }
  const [y, m] = date.split('-').map(Number);
  return label(y, m);
}

/**
 * 一整天的時段，照開始時間排開。
 *
 * 每個時段是一列，不是每筆來訪一列 —— 她看日曆是為了知道「10:30 那一格有沒有人」，
 * 而一次來訪有 2–3 個時段散在不同時間。
 *
 * @param {object[]} visits 這一天的來訪
 * @param {object} [ctx] { roomsById, staffById, master, includeCancelled }
 *   有 roomsById / staffById 的話就把診間與治療師換成名字。
 *   有 `master`（課程與器材主檔）的話多帶一個 `courseLabel`：
 *   **那天真的做了什麼**（`SIS(60)`，跟月曆同一種寫法），不是額度的名字。沒給就只有
 *   `courseName` 快照，畫面自己退回去（`domain/naming.js`）。
 *
 *   `includeCancelled`：把取消的也攤平出來。**預設 false** ——
 *   壓表與進度追蹤問的是「這一天還排得下嗎」「這個月做了多少」，
 *   而取消的時段已經還回去了。只有日曆的三個檢視要看得見它們，
 *   因為「那天本來有人、後來取消了」正是她會想再排一個人進去的訊號
 *   （ADR-0061）。
 *
 *   **軟刪除的一律不收**，`includeCancelled` 也救不回來 ——
 *   刪掉不是一種狀態，是那一筆不存在。所以這兩件事要分開判斷，
 *   不可以只把 `isActive()` 放寬。
 * @returns {object[]} 每一列帶 clashes：跟它同時段又同診間床位／同治療師的其他列，
 *   以及 `hasNote`：這一筆來訪身上有沒有「記的話」
 */
export function agendaFor(
  visits,
  date,
  { roomsById = {}, staffById = {}, master = null, includeCancelled = false } = {},
) {
  const rows = [];

  for (const visit of visits ?? []) {
    if (visit.date !== date || visit.deletedAt) continue;
    if (!isActive(visit) && !includeCancelled) continue;

    (visit.slots ?? []).forEach((slot, index) => {
      rows.push({
        visitId: visit.id,
        customerId: visit.customerId,
        customerName: visit.customerName ?? '（沒有名字）',
        // **這一列是一段，所以狀態也是那一段自己的**（ADR-0081）。
        // 舊來訪沒有 `slot.status`，`slotStatus()` 退回整筆那一個 ——
        // 那幾百筆畫出來一個字都不會變。
        status: slotStatus(visit, slot) ?? visit.status,
        slotIndex: index,
        startsAt: slot.startsAt ?? '',
        // 匯入的舊來訪沒有時間（ADR-0011）。顯示交給 timeLabel()，
        // startsAt / endsAt 留原樣給排序與撞期判斷用。
        timeLabel: timeLabel(slot),
        endsAt: slot.endsAt ?? '',
        courseName: slot.courseName ?? '',
        courseLabel: master ? slotName(slot, master, 'short') : null,
        // **印簡寫**（2026-09-08）：這一列跟月曆一樣是「她自己看」的地方，
        // 一格只放得下幾個字。沒設簡寫就退回全名（`nameOf()`）。
        //
        // **不要診間的課程一律不印**（`showsRoom()`，ADR-0079）：那六個課程
        // 改成「都不用」之後，既有來訪身上的 `roomId` 留著不動 —— 不畫這件事
        // 只能發生在畫的時候。認不出課程（沒給 `master`、匯進來的舊來訪）就照印。
        room: showsRoom(slot, master?.courses ?? null) && roomsById[slot.roomId]
          ? nameOf(roomsById[slot.roomId], 'short')
          : null,
        bed: slot.bed ?? null,
        therapist: staffById[slot.therapistId]?.name ?? null,
        roomId: slot.roomId ?? null,
        therapistId: slot.therapistId ?? null,
        // 這一筆底下有沒有她自己打的字（來訪編輯器的「記的話」）。
        // **帶的是有沒有，不是那段字** —— 那一列不印它，印了會把一列變兩行，
        // 而它可能有一整段。抽屜上畫一顆小記事本，點開才看得到內容。
        //
        // 空字串是「沒有」不是「有一段空的」（同 `domain/notes.js` 的
        // `normalize()`：空字串與 null 在查詢上是兩件事）。
        // **那一段身上有沒有字**（ADR-0084）。以前讀的是整筆的 `visit.note`，
        // 於是她一天三段只在其中一段記了字，三列都會亮那顆夾板。
        // 讀法只有 `slotNoteOf()` 一支 —— 各寫一次的話會出現「那一列亮著
        // 夾板、點開卻沒有字」。
        hasNote: Boolean(slotNoteOf(visit, slot)),
        clashes: [],
      });
    });
  }

  rows.sort(byStart);
  markClashes(rows);
  return rows;
}

/**
 * 一筆來訪在月檢視上的色條。**一段一條。**
 *
 * 她 2026-09-08：
 *
 * > 同一位客戶同一天三段，月檢視上只畫一條色條、而且只印第一段的名字
 *
 * 排班的原子單位是來訪（SPEC 第 4.4 節），所以同一天壓三次是一筆來訪三個
 * 時段。以前這裡是一筆一條、`visitNames()[0]` —— 她那天做了 INDIBA、SIS 與
 * ILIB，月檢視上只看得到 `IN(30)`。
 *
 * 三件刻意的事：
 *
 * 1. **id 一段一個**（`v1:0`）。`layoutMonth()` 拿 id 當 key，
 *    三條同 id 會互相蓋掉。
 * 2. **`sortKey` 是那一段的開始時間。** 少了它，同一天同樣長的那幾條會落到
 *    「照標題排」，於是 `IL` `IN` `SIS` 照筆畫走，跟她那一天的順序無關
 *    （`domain/events.js` 的 `bySortKey()`）。
 * 3. **不去重。** 同一天兩段點滴就是兩條 —— 那正是她要看到的。
 *    `visitNames()` 的去重留給 LINE 草稿，在那裡它仍然是對的。
 *
 * 一段都沒有的來訪仍然回一條（只有名字）：不然那一天在月檢視上整個不見。
 *
 * 月檢視寫的是**器材別稱**（`'short'`）：一格是七分之一個螢幕寬，
 * 而她真正要認的是「那天是哪一台」——「復能」三個人都一樣，「SIS」才分得出來。
 *
 * @param {object} visit
 * @param {{courses?: object[], equipment?: object[]}} master
 * @returns {object[]} 餵給 `layoutMonth()` 的那種形狀
 */
export function monthBars(visit, master = {}) {
  const name = visit?.customerName ?? '?';
  const base = {
    category: 'visit',
    startDate: visit?.date,
    endDate: visit?.date,
    deletedAt: visit?.deletedAt ?? null,
  };

  /**
   * **顏色也是一段一個**（ADR-0081）。她那天三段裡取消了一段時，
   * 月檢視上要看得出來是哪一條沒了 —— 整條都照整筆上色的話，
   * 那一天看起來像什麼事都沒發生。
   *
   * 不開第八種顏色（ADR-0039：色相已經用完了）—— 取消掉的那一段走
   * 既有的「畫出來但暗掉」（ADR-0061），只是現在逐段暗掉。
   */
  const kindOf = (slot) =>
    statusClass(slot ? (slotStatus(visit, slot) ?? visit?.status) : visit?.status)
    || 'kind-visit';

  // 姓名與課程之間用**半形**間隔號。一格手機上放得下四個多字 ——
  // 全形的空白或「・」等於整整少看到一個字，而被切掉時那一顆懸在邊緣的
  // 全形符號比半形的顯眼得多。
  const bar = (id, course, sortKey, slot) => ({
    ...base,
    id,
    kind: kindOf(slot),
    title: course ? `${name}·${course}` : name,
    sortKey,
  });

  const slots = visit?.slots ?? [];
  if (!slots.length) return [bar(visit?.id, '', null, null)];

  return slots.map((slot, i) =>
    bar(`${visit.id}:${i}`, slotName(slot, master, 'short'), slot.startsAt ?? null, slot));
}

/**
 * 同一格資源被排了兩次。SPEC 第 4.7 節：只提示，不阻擋 ——
 * 這裡看不到同事在 Abovee 上壓的東西，找到的一定是她自己撞的。
 *
 * **取消的那幾列一律跳過**（`includeCancelled` 才會有它們）：那個時段已經
 * 還回去了，標成撞期是假警報 —— 而假警報會讓她學會忽略真的那幾個。
 */
function markClashes(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (a.visitId === b.visitId) continue;
      if (a.status === 'cancelled' || b.status === 'cancelled') continue;
      if (!isValidTime(a.startsAt) || !isValidTime(b.startsAt)) continue;
      if (!overlaps(a, b)) continue;

      const sameRoom = a.roomId && a.roomId === b.roomId && (a.bed ?? null) === (b.bed ?? null);
      const sameTherapist = a.therapistId && a.therapistId === b.therapistId;
      if (!sameRoom && !sameTherapist) continue;

      const what = sameRoom ? `${a.room ?? '同一間'}${a.bed ?? ''}` : (a.therapist ?? '同一位治療師');
      a.clashes.push({ with: b.customerName, what });
      b.clashes.push({ with: a.customerName, what });
    }
  }
}

function byStart(a, b) {
  const at = isValidTime(a.startsAt) ? toMinutes(a.startsAt) : Infinity;
  const bt = isValidTime(b.startsAt) ? toMinutes(b.startsAt) : Infinity;
  return at - bt || String(a.customerName).localeCompare(String(b.customerName), 'zh-TW');
}

/**
 * 每一天有多少事。週檢視與月檢視的格子用。
 *
 * @returns {Record<string, {visits:number, slots:number, names:string[], pending:number}>}
 *   pending 是還在等客戶回覆的**段數** —— 那是最危險的狀態（SPEC 第 4.1 節），
 *   在月檢視上也要看得見。逐段數是因為狀態本來就逐段（ADR-0081）：
 *   一天三段只有一段沒問過的時候，「1」是對的、「3」不是。
 */
export function summaryByDate(visits) {
  const out = {};
  for (const visit of visits ?? []) {
    if (!isActive(visit) || !isValidDate(visit.date)) continue;
    const day = (out[visit.date] ??= { visits: 0, slots: 0, names: [], pending: 0 });
    day.visits += 1;
    day.slots += (visit.slots ?? []).length;
    day.names.push(visit.customerName ?? '（沒有名字）');
    // **逐段數**（ADR-0085）。整筆那一個是推導出來的，一段沒問過就整筆
    // 待確認 —— 那會讓月檢視頂端寫「3 待確認」而底下只有一條琥珀色條。
    // 舊來訪沒有 `slot.status`，`slotStatus()` 退回整筆，數出來一樣。
    day.pending += (visit.slots ?? [])
      .filter((slot) => slotStatus(visit, slot) === 'pending_confirm').length;
  }
  for (const day of Object.values(out)) {
    day.names.sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }
  return out;
}

/**
 * 星期幾的表頭，日曆的第一列。**一 二 三 四 五 六 日**，跟 `weekStart()` 同一個
 * 起點 —— 全站四個畫著格子的地方（日曆、壓表的小日曆、她的「記一次」、
 * 客戶填的表單）都要是同一排字。
 */
export const WEEKDAY_HEADERS = Array.from({ length: 7 }, (_, i) =>
  weekdayLabel(addDays('2026-01-05', i)), // 2026-01-05 是禮拜一
);
