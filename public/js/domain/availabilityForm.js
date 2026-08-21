// 客戶自己填的那份時間。純函式。
//
// 她問時間的流程第一步以前只有一條路：她在 LINE 上問、客戶回一段話、
// 她轉述進 app、解析器去猜。這一支是第二條路 —— **客戶填的東西一出生就是
// 結構化的**，不必猜。設計與取捨見 `.scratch/customer-availability-form/spec.md`。
//
// 這裡有三件事：
//
// 1. **邀請**（一位客戶一個月一條連結）的形狀與有效期
// 2. **客戶勾的東西 → 本輪可用性的規則**（`domain/availability.js` 那四種）
// 3. **客戶勾的東西 → 原文**
//
// 第 3 件有一個不變量，`tests/availability-form.test.js` 盯著它：
// **產生的原文餵回 `parseAvailability()` 要得到同一組規則。**
// 她在收集畫面按「用原文重新解析」時不可以拿到不一樣的東西 ——
// 那會讓她以為系統把客戶的話讀成了別的意思。
//
// 也因為這樣，這裡轉出來的規則**刻意不標 `manual`**：標了會在重新解析時
// 被 `mergeRules()` 再加一次，同一條變成兩份。

import { addDays, daysBetween, isValidDate, lastDayOf, weekdayOf } from './dates.js';

/** 客戶勾的半天。null 表示整天。 */
export const PART_OF_DAY = ['am', 'pm'];

const PART_LABELS = { am: '上午', pm: '下午' };
const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 連續幾天以上才併成一條範圍。兩天併成「9/22 到 9/23」比兩列還難讀。 */
const MERGE_RUN = 3;

/** 自由欄的上限。跟 firestore.rules 的 validNewResponse() 是同一個數字。 */
export const FREE_TEXT_MAX = 500;

// ---------- 邀請 ----------

/**
 * 一位客戶一個月一條連結。
 *
 * 有效期預設就是那個月整月，和收集畫面的 `defaultRange()` 一樣 ——
 * 她問的永遠是「下個月」，收下之後那份收集的有效期也是那個月。
 *
 * @param {{customerId:string, customerName:string, month:string, sentAt:string}} args
 *   month 是 'YYYY-MM'
 * @returns {object|null} 月份不合法就回 null，不要湊一份出來
 */
export function newInvite({ customerId, customerName, month, sentAt }) {
  if (!isMonth(month)) return null;

  const [y, m] = month.split('-').map(Number);
  const validFrom = `${month}-01`;
  const validTo = `${month}-${String(lastDayOf(y, m)).padStart(2, '0')}`;

  return {
    customerId: customerId ?? null,
    customerName: customerName ?? '',
    month,
    validFrom,
    validTo,
    sentAt: isValidDate(sentAt) ? sentAt : null,
  };
}

/**
 * 這條連結還能不能填。
 *
 * 過期的邀請不算「已經發出」—— 客戶填不了了，那一位要回到「該重問了」
 * 那一區去（ADR-0033）。
 *
 * @returns {'open'|'expired'|'used'|'none'}
 */
export function inviteState(invite, today, { submitted = false } = {}) {
  if (!invite || invite.deletedAt) return 'none';
  if (submitted) return 'used';
  if (!isValidDate(invite.validTo) || !isValidDate(today)) return 'none';
  return today > invite.validTo ? 'expired' : 'open';
}

/**
 * 要貼到 LINE 的那條網址。
 *
 * 獨立入口而不是 hash 路由，理由見 ADR-0031 —— 客戶不該為了填三題
 * 而下載一整個排班系統。
 */
export function formLink(origin, token) {
  const base = String(origin ?? '').replace(/\/+$/, '');
  return token ? `${base}/form.html?t=${encodeURIComponent(token)}` : '';
}

/**
 * 「問這輪的時間」那一頁的三區。
 *
 * 前兩區是 ADR-0028 就有的，第三區是表單做出來之後才存在的那一段時間：
 * **連結發出去了、客戶還沒填**。她不該在那時候再問一次。
 *
 * `customersToAsk()` 一個字都不改 —— 它回答的問題沒有變（這一輪的時間
 * 還沒問到誰），連結發出去了確實還沒問到。多出來的軸放在這裡。見 ADR-0033。
 *
 * @param {object} ctx
 * @param {object[]} ctx.rows `domain/scheduling.js` 的 `customersToAsk()` 的結果
 * @param {object[]} ctx.invites 全部邀請
 * @param {string} ctx.today
 * @returns {{never:object[], expired:object[], sent:object[]}}
 */
export function splitByInvite({ rows = [], invites = [], today }) {
  const open = new Map();
  for (const invite of invites) {
    if (inviteState(invite, today) !== 'open') continue;
    // 同一位客戶手上有兩條沒過期的連結時，以晚發的那條為準 ——
    // 她重發就是為了取代舊的（表單不重填，改就是重發一條）。
    const seen = open.get(invite.customerId);
    if (!seen || String(invite.sentAt ?? '') >= String(seen.sentAt ?? '')) {
      open.set(invite.customerId, invite);
    }
  }

  const out = { never: [], expired: [], sent: [] };
  for (const row of rows) {
    const invite = open.get(row.customerId);
    if (invite) out.sent.push({ ...row, invite });
    else if (row.state === 'never') out.never.push(row);
    else out.expired.push(row);
  }
  return out;
}

// ---------- 客戶勾的東西 ----------

/**
 * 把客戶勾的東西清乾淨：去掉不合法的、重複的，排好順序。
 *
 * 前端送什麼過來都要先過這一關 —— 客戶那一頁跑在別人的手機上，
 * 而 Rules 擋得掉形狀不對的，擋不掉「同一天送兩次」。
 */
export function normalizePicks({ weekdays = [], dates = [] } = {}) {
  const byWeekday = new Map();
  for (const pick of weekdays) {
    const weekday = Number(pick?.weekday);
    if (!(weekday >= 0 && weekday <= 6)) continue;
    byWeekday.set(weekday, { weekday, partOfDay: partOf(pick) });
  }

  const byDate = new Map();
  for (const pick of dates) {
    if (!isValidDate(pick?.date)) continue;
    byDate.set(pick.date, { date: pick.date, partOfDay: partOf(pick) });
  }

  return {
    weekdays: [...byWeekday.values()].sort((a, b) => a.weekday - b.weekday),
    dates: [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const partOf = (pick) => (PART_OF_DAY.includes(pick?.partOfDay) ? pick.partOfDay : null);

/**
 * 某一天是不是已經被「固定星期不行」蓋掉了。
 *
 * 客戶那一頁靠它把那幾格畫成不可點的斜線 —— 已經說過「每個禮拜五不行」，
 * 再讓他一個一個點禮拜五是白費力氣，而且點了會產生互相矛盾的兩條規則。
 *
 * @returns {'all'|'am'|'pm'|null}
 */
export function weekdayBlock(weekdays, date) {
  if (!isValidDate(date)) return null;
  const hit = (weekdays ?? []).find((w) => Number(w?.weekday) === weekdayOf(date));
  if (!hit) return null;
  return partOf(hit) ?? 'all';
}

// ---------- 轉成規則 ----------

/**
 * 客戶勾的東西 → `domain/availability.js` 認得的規則。
 *
 * 連續三天以上併成一條 `exclude_range`（出國那種），其餘一天一條。
 * **只有整天不行的才併** —— 「9/22 整天、9/23 只有下午」併成一條範圍
 * 會把 9/23 的上午一起吃掉，而那是客戶真的有空的半天。
 */
export function picksToRules(picks) {
  const { weekdays, dates } = normalizePicks(picks);

  const rules = weekdays.map((w) => ({
    kind: 'exclude_weekday',
    weekday: w.weekday,
    ...(w.partOfDay ? { partOfDay: w.partOfDay } : {}),
  }));

  for (const group of groupDates(dates)) {
    if (group.length >= MERGE_RUN) {
      rules.push({ kind: 'exclude_range', from: group[0].date, to: group[group.length - 1].date });
    } else {
      for (const d of group) {
        rules.push({
          kind: 'exclude_date',
          date: d.date,
          ...(d.partOfDay ? { partOfDay: d.partOfDay } : {}),
        });
      }
    }
  }

  return rules;
}

/** 連續的整天分成一組。半天的自己一組，永遠不會被併進範圍。 */
function groupDates(dates) {
  const groups = [];
  for (const pick of dates) {
    const last = groups[groups.length - 1];
    const canJoin = last
      && !pick.partOfDay
      && !last[last.length - 1].partOfDay
      && addDays(last[last.length - 1].date, 1) === pick.date;
    if (canJoin) last.push(pick);
    else groups.push([pick]);
  }
  return groups;
}

// ---------- 轉成原文 ----------

/**
 * 把客戶勾的東西寫成一句她看得懂的中文。
 *
 * **這句話要能被 `parseAvailability()` 讀回同一組規則**（見檔頭），
 * 所以日期一律寫成 `9/18` 而不是 `9/18(四)` —— 中間那個括號會讓
 * 「9/22 到 9/24」的範圍比對整條失效。給人看的星期在畫面上補，不在原文裡。
 */
export function picksToText(picks) {
  const { weekdays, dates } = normalizePicks(picks);
  const parts = [];

  for (const w of weekdays) {
    parts.push(`每個禮拜${WEEKDAY_NAMES[w.weekday]}${PART_LABELS[w.partOfDay] ?? ''}不行`);
  }

  for (const group of groupDates(dates)) {
    if (group.length >= MERGE_RUN) {
      parts.push(`${md(group[0].date)} 到 ${md(group[group.length - 1].date)} 不行`);
    } else {
      for (const d of group) parts.push(`${md(d.date)} ${PART_LABELS[d.partOfDay] ?? ''}不行`.replace(/\s+/g, ' ').trim());
    }
  }

  return parts.join('、');
}

const md = (iso) => {
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}`;
};

/**
 * 存進收集的原文。
 *
 * 兩行：第一行是把勾選組回去的人話，第二行是客戶自己打的那段**照抄**。
 * SPEC 第 4.3 節的「原文永遠是最終依據」在表單這條路上的等價物就是第二行 ——
 * 勾選的部分是結構化的、不會讀錯，真正可能有意外的永遠是客戶自己講的話。
 *
 * 兩邊都空的時候給一句「這個月都可以」：`validateCollection()` 不收空的原文，
 * 而「他說都可以」本身就是一個要記下來的答案。
 */
export function rawTextFrom({ weekdays, dates, freeText } = {}) {
  const picked = picksToText({ weekdays, dates });
  const free = String(freeText ?? '').trim();

  if (!picked && !free) return '這個月都可以';
  return [picked, free].filter(Boolean).join('\n');
}

/**
 * 給人看的複述。客戶那一頁的清單、送出前的確認頁、她的收件匣都用這一份 ——
 * 三個地方講同一句話，客戶按下送出時看到的字要跟她收到的一模一樣。
 *
 * @returns {string[]} 一句一列
 */
export function describePicks({ weekdays, dates, freeText } = {}) {
  const { weekdays: ws, dates: ds } = normalizePicks({ weekdays, dates });
  const out = [];

  for (const w of ws) {
    out.push(`每個禮拜${WEEKDAY_NAMES[w.weekday]}${partSuffix(w.partOfDay)}`);
  }

  for (const group of groupDates(ds)) {
    if (group.length >= MERGE_RUN) {
      // 全形括號本身就撐開了間距，再補半形空白會變成「）　到　9/24」那種鬆散的樣子
      out.push(`${dateLabel(group[0].date)}到${dateLabel(group[group.length - 1].date)}整天不行`);
    } else {
      for (const d of group) out.push(`${dateLabel(d.date)}${partSuffix(d.partOfDay)}`);
    }
  }

  const free = String(freeText ?? '').trim();
  if (free) out.push(free);

  return out.length ? out : ['這個月都可以，沒有不方便的日子'];
}

const partSuffix = (part) => (part ? `只有${PART_LABELS[part]}不行` : '整天不行');

/** 客戶看的日期一定要有星期 —— 「9/18 是禮拜幾」是他點下去之前唯一要確認的事。 */
export function dateLabel(iso) {
  if (!isValidDate(iso)) return '';
  const [, m, d] = iso.split('-').map(Number);
  return `${m}/${d}（${WEEKDAY_NAMES[weekdayOf(iso)]}）`;
}

// ---------- 收下 ----------

/**
 * 客戶送出的那一份 → 一份本輪可用性。
 *
 * 她按「收下」才會呼叫到這裡（ADR-0032：app 是記錄者，客戶填的不自動生效）。
 *
 * `collectedAt` 用**她收下的那天**，不是客戶送出的那天。這一份收集的意義是
 * 「她手上握有的最新資訊」，而她是今天才握有的；`submittedAt` 留在收件匣那一筆上，
 * 要查「客戶什麼時候填的」看得到。
 *
 * @param {object} response `formResponses` 的一筆
 * @param {object} invite 對應的邀請，有效期從這裡來
 * @param {{today:string}} when
 */
export function collectionFrom(response, invite, { today } = {}) {
  const picks = normalizePicks(response ?? {});

  return {
    collectedAt: isValidDate(today) ? today : null,
    validFrom: invite?.validFrom ?? null,
    validTo: invite?.validTo ?? null,
    rawText: rawTextFrom({ ...picks, freeText: response?.freeText }),
    rules: picksToRules(picks),
    followupNote: null,
    // 畫面上要看得出這一份是客戶自己填的 —— 他自己講的話比她轉述的可信。
    source: 'form',
    sourceToken: response?.token ?? null,
  };
}

// ---------- 驗證 ----------

/**
 * 客戶送出的那一份對不對。客戶那一頁按送出前擋一次，她收下前再擋一次。
 *
 * 這裡只擋「形狀不對」，不擋「填得少」—— 什麼都沒勾是一個合法而且常見的答案
 * （這個月都可以）。
 */
export function validateResponse(response) {
  const errors = [];
  if (!response?.token) errors.push('沒有連結代碼');
  if (!response?.customerId) errors.push('對不到客戶');
  if (!isMonth(response?.month)) errors.push('月份不合法');

  if (String(response?.freeText ?? '').length > FREE_TEXT_MAX) {
    errors.push(`補充的字數超過 ${FREE_TEXT_MAX} 字`);
  }

  for (const pick of response?.weekdays ?? []) {
    if (!(Number(pick?.weekday) >= 0 && Number(pick?.weekday) <= 6)) errors.push('星期不合法');
  }
  for (const pick of response?.dates ?? []) {
    if (!isValidDate(pick?.date)) errors.push('日期不合法');
  }

  return errors;
}

/** 客戶勾的日子有沒有落在這條連結問的那個月以外。畫面上不該點得到，但值得擋一次。 */
export function outOfRange(response, invite) {
  if (!invite?.validFrom || !invite?.validTo) return [];
  return (response?.dates ?? [])
    .map((d) => d?.date)
    .filter((d) => isValidDate(d) && (d < invite.validFrom || d > invite.validTo));
}

// ---------- 客戶那一頁要畫的月曆 ----------

/**
 * 一個月的格子，前面補到禮拜一。
 *
 * 補的那幾格是**空的**，不是鄰月的日子 —— 她的日曆補鄰月是因為「留白會讓她
 * 以為那幾天沒事」（SPEC 第 8.6 節），但客戶這一頁問的是**這一個月**，
 * 畫出上個月的日子只會讓他點下去然後發現點不動。
 *
 * @param {string} month 'YYYY-MM'
 * @param {{today?:string}} [when] 有給就把已經過去的日子標成不可點
 * @returns {{date:string|null, day:number|null, weekday:number, past:boolean}[]}
 */
export function monthGrid(month, { today = null } = {}) {
  if (!isMonth(month)) return [];
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const lead = (weekdayOf(first) + 6) % 7;

  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push({ date: null, day: null, weekday: i, past: false });

  for (let day = 1; day <= lastDayOf(y, m); day += 1) {
    const date = `${month}-${String(day).padStart(2, '0')}`;
    cells.push({
      date,
      day,
      weekday: weekdayOf(date),
      past: Boolean(today && isValidDate(today) && daysBetween(today, date) < 0),
    });
  }
  return cells;
}

function isMonth(value) {
  return typeof value === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
