// 日期算術。純函式，一律用 'YYYY-MM-DD' 字串進出。
//
// 全部走 Date.UTC：用本地時區的 Date 建構子，在 UTC+8 的午夜前後會整整差一天，
// 而這個 app 裡「今天」「死線」「到期日」都是日曆上的日子，不是時間點。

const pad = (n) => String(n).padStart(2, '0');

/** 格式對且真的存在。2026-02-30 不算合法。 */
export function isValidDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [y, m, d] = iso.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1) return false;
  return d <= lastDayOf(y, m);
}

/** 某年某月有幾天。month 是 1–12。 */
export function lastDayOf(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return dt.toISOString().slice(0, 10);
}

/**
 * 加月份。月底會夾到當月最後一天：1/31 + 1 個月 = 2/28，不是 3/3。
 * 會籍是「一年」而不是「365 天」，所以用月份加。
 */
export function addMonths(iso, months) {
  const [y, m, d] = iso.split('-').map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, lastDayOf(ny, nm)))}`;
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

/** 星期幾，0 是星期日。 */
export function weekdayOf(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 給人看的星期，例：'三'。她的可用性條件全部是用星期講的。 */
export function weekdayLabel(iso) {
  return WEEKDAYS[weekdayOf(iso)];
}

/**
 * 星期的號碼 → 給人看的字，例：`2` → `'二'`。
 *
 * 有些地方手上只有號碼沒有日期（可用性的規則存的是 `weekday: 2`），
 * 而那幾個地方本來各自寫了一份 `['日','一',…]`。**這一份是唯一的一份。**
 */
export function weekdayName(weekday) {
  return WEEKDAYS[weekday] ?? '？';
}

/** 'M/D(週)'，例：'9/3(三)'。LINE 訊息與清單都用這個格式。 */
export function shortDate(iso) {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}(${weekdayLabel(iso)})`;
}

/** to - from，單位是天。to 比較早就是負的。 */
export function daysBetween(from, to) {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  return (Date.UTC(ty, tm - 1, td) - Date.UTC(fy, fm - 1, fd)) / 86400000;
}

/**
 * 「9月」。'YYYY-MM' 與 'YYYY-MM-DD' 都吃得下。
 *
 * **她講的是「九月的表」，不是「2026-09 的表」**（ADR-0036 那一課）。
 * 中間不留空白 —— 「壓 9 月的表」在一行標題裡會斷得很奇怪。
 * 認不出來就原樣回傳，不要吐一個假的月份。
 */
export function monthLabel(iso) {
  const m = Number(String(iso ?? '').slice(5, 7));
  return m >= 1 && m <= 12 ? `${m}月` : String(iso ?? '');
}

/**
 * Firestore 的 Timestamp 與 ISO 字串都吃得下，回 'YYYY-MM-DD'（裝置當地）。
 *
 * 兩種形狀是真的會混在一起：`createdAt` 是伺服器寫的 Timestamp，
 * `followupAt`、`doneAt` 是前端按下去那一刻寫的 ISO 字串。
 * **認不出來回 `null`，不要猜一個日期出來** —— 猜出來的日期會變成一個
 * 看起來很正常的死線，而那比空白難發現得多。
 */
export function dayOf(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  if (Number.isNaN(d.getTime())) return null;
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * 裝置當地的今天。
 *
 * 這是 domain 裡唯一一個不純的函式，因為「今天」本來就不純。
 * 需要判斷的函式一律把 today 當參數收，不要自己呼叫這個 —— 那樣測不了。
 */
export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
