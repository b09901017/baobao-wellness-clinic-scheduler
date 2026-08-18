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
import { isActive } from './visits.js';

export const VIEWS = ['day', 'week', 'month'];

export const VIEW_LABELS = { day: '日', week: '週', month: '月' };

/** 一週從禮拜日開始。她的可用性條件講的是「禮拜一三下午」，週日起算跟她的講法一致。 */
export function weekStart(date) {
  return isValidDate(date) ? addDays(date, -weekdayOf(date)) : null;
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

/** 標頭那一行字。 */
export function titleOf(view, date) {
  if (!isValidDate(date)) return '';
  if (view === 'day') return `${date.slice(0, 4)} 年 ${shortDate(date)}`;
  if (view === 'week') {
    const days = weekDays(date);
    return `${shortDate(days[0])} – ${shortDate(days[6])}`;
  }
  const [y, m] = date.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

/**
 * 一整天的時段，照開始時間排開。
 *
 * 每個時段是一列，不是每筆來訪一列 —— 她看日曆是為了知道「10:30 那一格有沒有人」，
 * 而一次來訪有 2–3 個時段散在不同時間。
 *
 * @param {object[]} visits 這一天的來訪
 * @param {object} [ctx] { roomsById, staffById } 有的話就把診間與治療師換成名字
 * @returns {object[]} 每一列帶 clashes：跟它同時段又同診間床位／同治療師的其他列
 */
export function agendaFor(visits, date, { roomsById = {}, staffById = {} } = {}) {
  const rows = [];

  for (const visit of visits ?? []) {
    if (visit.date !== date || !isActive(visit)) continue;

    (visit.slots ?? []).forEach((slot, index) => {
      rows.push({
        visitId: visit.id,
        customerId: visit.customerId,
        customerName: visit.customerName ?? '（沒有名字）',
        status: visit.status,
        slotIndex: index,
        startsAt: slot.startsAt ?? '',
        // 匯入的舊來訪沒有時間（ADR-0011）。顯示交給 timeLabel()，
        // startsAt / endsAt 留原樣給排序與撞期判斷用。
        timeLabel: timeLabel(slot),
        endsAt: slot.endsAt ?? '',
        courseName: slot.courseName ?? '',
        room: roomsById[slot.roomId]?.name ?? null,
        bed: slot.bed ?? null,
        therapist: staffById[slot.therapistId]?.name ?? null,
        roomId: slot.roomId ?? null,
        therapistId: slot.therapistId ?? null,
        clashes: [],
      });
    });
  }

  rows.sort(byStart);
  markClashes(rows);
  return rows;
}

/**
 * 同一格資源被排了兩次。SPEC 第 4.7 節：只提示，不阻擋 ——
 * 這裡看不到同事在 Abovee 上壓的東西，找到的一定是她自己撞的。
 */
function markClashes(rows) {
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      const a = rows[i];
      const b = rows[j];
      if (a.visitId === b.visitId) continue;
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
 *   pending 是還在等客戶回覆的筆數 —— 那是最危險的狀態（SPEC 第 4.1 節），
 *   在月檢視上也要看得見。
 */
export function summaryByDate(visits) {
  const out = {};
  for (const visit of visits ?? []) {
    if (!isActive(visit) || !isValidDate(visit.date)) continue;
    const day = (out[visit.date] ??= { visits: 0, slots: 0, names: [], pending: 0 });
    day.visits += 1;
    day.slots += (visit.slots ?? []).length;
    day.names.push(visit.customerName ?? '（沒有名字）');
    if (visit.status === 'pending_confirm') day.pending += 1;
  }
  for (const day of Object.values(out)) {
    day.names.sort((a, b) => a.localeCompare(b, 'zh-TW'));
  }
  return out;
}

/** 星期幾的表頭，日曆的第一列。 */
export const WEEKDAY_HEADERS = Array.from({ length: 7 }, (_, i) =>
  weekdayLabel(addDays('2026-01-04', i)), // 2026-01-04 是禮拜日
);
