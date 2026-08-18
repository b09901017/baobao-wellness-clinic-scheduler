// 產生給 Google 試算表的唯讀報表。SPEC 第 4.8 節。純函式。
//
// 試算表從「資料來源」降級成「報表」——app 才是唯一真相（SPEC 第 4.8 節），
// 所以這裡只負責**單向**把資料排成她原本看習慣的樣子。不做讀回來，
// 雙向同步一定會打架。
//
// 保留現行試算表的骨架（一位客戶一張表、療程項目 × 日期的勾選矩陣），
// 因為那是她已經會看的東西；但次數改成三段式（SPEC 第 4.2 節），
// 舊表的「應有／實際」兩欄講不出「已排未上」，而那正是最容易掉東西的地方。
//
// 次數一律從 visits 現算，不讀計數欄位 —— 報表會被存到雲端硬碟當備份看，
// 它必須是對的（ADR-0004：真正不能錯的地方一律現算）。

import { counts } from './entitlements.js';
import { isActive } from './visits.js';
import { shortDate, isValidDate } from './dates.js';

/** 每張表的第一列。SPEC 第 4.8 節要求每張分頁都要有這句。 */
export const READONLY_NOTICE = '⚠️ 本表由系統自動產生，請勿手動編輯。修改請至 app。';

const CHECK = '✓';

/**
 * 一位客戶一張表：療程項目 × 日期的勾選矩陣。
 *
 * @param {object} ctx
 * @param {object} ctx.customer
 * @param {object[]} ctx.entitlements 這位客戶的額度
 * @param {object[]} ctx.visits 這位客戶的來訪
 * @param {string} [ctx.generatedAt] 產生時間，寫在表頭讓她知道這份多舊
 * @returns {{name:string, rows:string[][]}}
 */
export function customerReport({ customer, entitlements = [], visits = [], generatedAt = '' }) {
  const alive = entitlements.filter((e) => !e.deletedAt);
  const used = visits.filter((v) => isActive(v) && isValidDate(v.date));
  const dates = [...new Set(used.map((v) => v.date))].sort();

  const rows = [
    [READONLY_NOTICE],
    ['客戶', customer?.name ?? ''],
    ['購買通路', customer?.source ?? ''],
    ['會籍到期', customer?.membershipExpiresAt ?? ''],
    ['永久限制', (customer?.flags ?? []).join('、')],
    ['產生時間', generatedAt],
    [],
    ['療程項目', '應有', '已完成', '已排未上', '剩餘', ...dates.map(shortDate)],
  ];

  for (const e of alive) {
    const c = counts(e, used, e.id);
    rows.push([
      e.label ?? '',
      String(c.total),
      String(c.done),
      String(c.booked),
      String(c.remaining),
      ...dates.map((date) => mark(used, e.id, date)),
    ]);
  }

  if (!alive.length) rows.push(['（還沒有額度）']);

  return { name: customer?.name ?? '（沒有名字）', rows };
}

/**
 * 那天用掉這筆額度幾次。
 *
 * 同一天同一池用兩次是有的（例如上午一次下午一次），所以不是只印一個勾 ——
 * 舊表的勾選格看不出這件事，對帳時就會少一次。
 */
function mark(visits, entitlementId, date) {
  const hits = visits
    .filter((v) => v.date === date)
    .reduce(
      (n, v) => n + (v.slots ?? []).filter((s) => s.entitlementId === entitlementId).length,
      0,
    );
  if (!hits) return '';
  return hits === 1 ? CHECK : `${CHECK}${hits}`;
}

/**
 * 總表：一位客戶一列。取代她現在「開二十幾張分頁一張一張看」的動作。
 *
 * @param {object} ctx
 * @param {object[]} ctx.customers
 * @param {Record<string, object[]>} ctx.entitlementsBy
 * @param {Record<string, object[]>} ctx.visitsBy
 * @param {string} ctx.today
 * @param {string} [ctx.generatedAt]
 * @returns {{name:string, rows:string[][]}}
 */
export function overviewReport({
  customers = [], entitlementsBy = {}, visitsBy = {}, today, generatedAt = '',
}) {
  const rows = [
    [READONLY_NOTICE],
    ['產生時間', generatedAt],
    [],
    ['姓名', '購買通路', '會籍到期', '應有', '已完成', '已排未上', '剩餘',
      '上次來訪', '下次預約', '永久限制'],
  ];

  const sorted = customers
    .filter((c) => !c.deletedAt)
    .slice()
    .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? ''), 'zh-TW'));

  for (const customer of sorted) {
    const visits = (visitsBy[customer.id] ?? []).filter((v) => isActive(v) && isValidDate(v.date));
    const total = { total: 0, done: 0, booked: 0, remaining: 0 };

    for (const e of (entitlementsBy[customer.id] ?? []).filter((x) => !x.deletedAt)) {
      const c = counts(e, visits, e.id);
      total.total += c.total;
      total.done += c.done;
      total.booked += c.booked;
      total.remaining += c.remaining;
    }

    const past = visits.filter((v) => v.date <= today).map((v) => v.date).sort();
    const future = visits.filter((v) => v.date > today).map((v) => v.date).sort();

    rows.push([
      customer.name ?? '',
      customer.source ?? '',
      customer.membershipExpiresAt ?? '',
      String(total.total),
      String(total.done),
      String(total.booked),
      String(total.remaining),
      past[past.length - 1] ?? '',
      future[0] ?? '',
      (customer.flags ?? []).join('、'),
    ]);
  }

  return { name: '總表', rows };
}

/**
 * 貼進試算表用。她選一格貼上，整份就會攤成表格。
 *
 * 儲存格裡的定位與換行一律換成空白 —— 留著會把一列拆成好幾列，
 * 而她要到很後面才會發現表格錯位了。
 */
export function toTSV({ rows }) {
  return rows
    .map((row) => row.map((cell) => String(cell ?? '').replace(/[\t\r\n]+/g, ' ')).join('\t'))
    .join('\n');
}

/** 下載成檔案用。逗號、引號、換行都要包起來，否則 Excel 開起來會錯位。 */
export function toCSV({ rows }) {
  return rows
    .map((row) => row.map(csvCell).join(','))
    .join('\r\n');
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}
