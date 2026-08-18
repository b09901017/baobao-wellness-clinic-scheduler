// 來訪時間推算。純函式。
//
// 一次來訪含 2–3 個連續時段，中間預設隔 15 分鐘。
// 她填完 Abovee 回來記錄時，時間應該用選的、自動帶出來，不要讓她打字。

export const DEFAULT_GAP_MIN = 15;

/** 'HH:MM'，而且真的是一個時間。'25:00' 與 '9:5' 都不算。 */
export function isValidTime(hhmm) {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return false;
  const [h, m] = hhmm.split(':').map(Number);
  return h >= 0 && h < 24 && m >= 0 && m < 60;
}

/** 'HH:MM' → 從當日零時起算的分鐘數 */
export function toMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

/** 分鐘數 → 'HH:MM'。跨日不處理，這裡不會用到。 */
export function toHHMM(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 給起始時間與時長，算出結束時間。 */
export function endOf(startsAt, durationMin) {
  return toHHMM(toMinutes(startsAt) + durationMin);
}

/**
 * 接在前一個時段之後的建議起始時間。
 * 這不是「建議時段」（那個第一版不做），只是把「上一段結束 + 15 分」
 * 這個算術先填好，省她一次心算。
 */
export function nextStart(prevEndsAt, gapMin = DEFAULT_GAP_MIN) {
  return toHHMM(toMinutes(prevEndsAt) + gapMin);
}

/**
 * 依課程時長排出一串連續時段的時間。
 * @param {string} firstStart 'HH:MM'
 * @param {number[]} durations 每個時段的分鐘數
 * @param {number} gapMin
 * @returns {{startsAt:string, endsAt:string}[]}
 */
export function layOutSlots(firstStart, durations, gapMin = DEFAULT_GAP_MIN) {
  const out = [];
  let cursor = firstStart;
  for (const dur of durations) {
    const endsAt = endOf(cursor, dur);
    out.push({ startsAt: cursor, endsAt });
    cursor = nextStart(endsAt, gapMin);
  }
  return out;
}

/** 兩個時段有沒有時間重疊。 */
export function overlaps(a, b) {
  return toMinutes(a.startsAt) < toMinutes(b.endsAt) && toMinutes(b.startsAt) < toMinutes(a.endsAt);
}
