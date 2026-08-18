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
 * 裝置當地的今天。
 *
 * 這是 domain 裡唯一一個不純的函式，因為「今天」本來就不純。
 * 需要判斷的函式一律把 today 當參數收，不要自己呼叫這個 —— 那樣測不了。
 */
export function todayISO() {
  const now = new Date();
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
